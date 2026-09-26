import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pool, transaction, type DB } from '../db.js';
import { check, id } from '../errors.js';
import { publicationSettings, skillSlug, validateSkillSubmission } from '../format.js';
import { publicMind } from '../public-mind.js';
import type {
  Mind,
  PublicationChoices,
  Skill,
  SkillVersion,
  SkillWrite,
  SkillWriteResult,
} from '../types.js';
import { assetId, validateAssets } from './assets.js';
import { publicSkill } from './discovery.js';
import { githubPublicationUrl } from './github-publication.js';
function publicationFor(content: Mind, choices: PublicationChoices) {
  const pub = publicationSettings(content, choices);
  check(
    pub.memory_ids.every((x) => content.memory.fragments.some((m) => m.id === x)),
    'INVALID_PUBLICATION',
  );
  return pub;
}

// Lock one Skill for both draft writes and publication. Network I/O belongs to the worker.
export async function writeSkill(
  user: string,
  skill: string,
  input: SkillWrite,
  { publish, create }: { publish: boolean; create: boolean },
): Promise<SkillWriteResult> {
  if (publish) {
    id(input.request_id);
    check(input.compliance_confirmed === true, 'COMPLIANCE_CONFIRMATION_REQUIRED');
  }
  return transaction(async (db) => {
    if (create) {
      check(input.content, 'INVALID_SKILL', '请提供 Skill 内容');
      const name = input.content.name || '我的 MindCopy';
      const initial = {
        ...input.content,
        slug: skillSlug(skill),
        name,
        version: '1.0.0',
        description: `${name}的人格与记忆`,
      };
      await db.query(
        'INSERT INTO skills(id,owner_id,slug,name,description,draft,revision) VALUES($1,$2,$3,$4,$5,$6,0) ON CONFLICT(id) DO NOTHING',
        [skill, user, initial.slug, name, initial.description, initial],
      );
    }
    const skillRow = (
      await db.query<Skill>('SELECT * FROM skills WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
        skill,
        user,
      ])
    ).rows[0];
    check(skillRow, 'NOT_FOUND', '未找到 Skill');
    check(skillRow.status !== 'blocked', 'BLOCKED');
    if (publish) {
      const previous = (
        await db.query<{ request: SkillWrite; result: SkillWriteResult }>(
          'SELECT request,result FROM skill_submissions WHERE skill_id=$1 AND request_id=$2',
          [skill, input.request_id],
        )
      ).rows[0];
      if (previous) {
        check(
          isDeepStrictEqual(previous.request, JSON.parse(JSON.stringify(input))),
          'REQUEST_REUSED',
        );
        return previous.result;
      }
    }
    check(
      Number.isInteger(input.revision) && input.revision === skillRow.revision,
      'DRAFT_CHANGED',
    );
    const supplied = input.content || skillRow.draft;
    check(skillRow.revision === 0 || supplied.slug === skillRow.slug, 'SLUG_READONLY');
    const content = validateSkillSubmission({
      ...supplied,
      slug: skillRow.slug,
      version: skillRow.draft.version,
      name: supplied.name || skillRow.name,
      description: `${supplied.name || skillRow.name}的人格与记忆`,
    });
    await validateAssets(content, user, db);
    const choices =
      input.publication ||
      (publish
        ? input
        : Object.keys(skillRow.draft_publication).length
          ? skillRow.draft_publication
          : {
              listed: true,
              chat: true,
              download: true,
              memory_ids: content.memory.fragments.map((m) => m.id),
            });
    const pub = publicationFor(content, choices);
    const changed =
      skillRow.revision === 0 ||
      !isDeepStrictEqual(content, skillRow.draft) ||
      !isDeepStrictEqual(pub, skillRow.draft_publication);
    let revision = skillRow.revision + (changed ? 1 : 0);
    await db.query(
      'UPDATE skills SET name=$1,description=$2,draft=$3,draft_publication=$4,revision=$5,updated_at=now() WHERE id=$6',
      [content.name, content.description, content, pub, revision, skill],
    );
    let result: SkillWriteResult = { id: skill, slug: skillRow.slug, revision, published: false };
    if (!publish) return result;
    const publishedPub = { ...pub, compliance_confirmed: true };
    const current = skillRow.published_version_id
      ? (
          await db.query<SkillVersion>('SELECT * FROM skill_versions WHERE id=$1', [
            skillRow.published_version_id,
          ])
        ).rows[0]
      : null;
    if (
      skillRow.status === 'published' &&
      current &&
      isDeepStrictEqual({ ...content, version: current.version }, current.content) &&
      isDeepStrictEqual(publishedPub, current.publication)
    ) {
      result = {
        ...result,
        published: true,
        version_id: current.id,
        version: current.version,
        unchanged: true,
      };
    } else {
      const latest = (
        await db.query(
          "SELECT version FROM skill_versions WHERE skill_id=$1 ORDER BY split_part(version,'.',1)::numeric DESC,split_part(version,'.',2)::numeric DESC,split_part(version,'.',3)::numeric DESC LIMIT 1",
          [skill],
        )
      ).rows[0];
      const parts = latest?.version.split('.');
      content.version = parts ? `${parts[0]}.${parts[1]}.${BigInt(parts[2]) + 1n}` : '1.0.0';
      const version = randomUUID();
      await db.query(
        'INSERT INTO skill_versions(id,skill_id,version,content,publication) VALUES($1,$2,$3,$4,$5)',
        [version, skill, content.version, content, publishedPub],
      );
      for (const ref of Object.values(content.assets) as string[])
        await db.query('INSERT INTO version_assets VALUES($1,$2)', [version, assetId(ref)]);
      revision++;
      await db.query(
        "UPDATE skills SET draft=$1,published_version_id=$2,publication=$3,status='published',revision=$4 WHERE id=$5",
        [content, version, publishedPub, revision, skill],
      );
      result = {
        ...result,
        revision,
        published: true,
        version_id: version,
        version: content.version,
      };
    }
    result.sync_job_id = null;
    result.sync_policy = pub.github ? 'weekly' : 'disabled';
    await rememberSubmission(db, skill, input, result);
    return result;
  });
}

async function rememberSubmission(db: DB, skill: string, b: SkillWrite, result: SkillWriteResult) {
  await db.query(
    'INSERT INTO skill_submissions(skill_id,request_id,request,result) VALUES($1,$2,$3,$4)',
    [skill, b.request_id, b, result],
  );
}

export async function ownedSkill(skillId: string, user: string, db: DB = pool) {
  const s = (
    await db.query<Skill>('SELECT * FROM skills WHERE id=$1 AND owner_id=$2', [id(skillId), user])
  ).rows[0];
  check(s, 'NOT_FOUND', '未找到 Skill');
  return s;
}
export async function accessibleVersion(
  versionId: string,
  user: string,
  capability: 'chat' | 'download' = 'chat',
) {
  const s = (
    await pool.query<
      SkillVersion & {
        owner_id: string;
        status: string;
        current_publication: PublicationChoices;
        owner_status: string;
      }
    >(
      `SELECT v.*,s.owner_id,s.status,s.publication AS current_publication,u.status AS owner_status FROM skill_versions v JOIN skills s ON s.id=v.skill_id JOIN users u ON u.id=s.owner_id WHERE v.id=$1`,
      [id(versionId)],
    )
  ).rows[0];
  check(
    s &&
      s.owner_status === 'active' &&
      s.status !== 'blocked' &&
      (s.owner_id === user ||
        (s.status === 'published' &&
          s.current_publication[capability] &&
          s.publication[capability])),
    'NOT_FOUND',
    '此 Skill 版本不可访问',
  );
  return { ...s, content: s.owner_id === user ? s.content : publicMind(s.content, s.publication) };
}

export async function skillDetail(
  skillId: string,
  user?: string,
): Promise<import('../../../packages/api/index.js').SkillDetailDto> {
  const skill = (
    await pool.query<Skill & { author: string; owner_status: string }>(
      'SELECT s.*,u.display_name AS author,u.status AS owner_status FROM skills s JOIN users u ON u.id=s.owner_id WHERE s.id=$1',
      [id(skillId)],
    )
  ).rows[0];
  check(
    skill &&
      (skill.owner_id === user ||
        (skill.status === 'published' &&
          skill.publication.listed &&
          skill.owner_status === 'active')),
    'NOT_FOUND',
    'Skill 不存在',
  );
  if (skill.owner_id !== user) return publicSkill(skill.id, user || null);
  const versions = (
    await pool.query<{ id: string; version: string; created_at: Date }>(
      'SELECT id,version,created_at FROM skill_versions WHERE skill_id=$1 ORDER BY created_at DESC',
      [skill.id],
    )
  ).rows;
  return {
    id: skill.id,
    owner_id: skill.owner_id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    draft: skill.draft,
    draft_publication: skill.draft_publication,
    publication: skill.publication,
    published_version_id: skill.published_version_id,
    revision: skill.revision,
    status: skill.status,
    author: skill.author,
    versions: versions.map((version) => ({
      ...version,
      created_at: version.created_at.toISOString(),
    })),
    github_url: await githubPublicationUrl(skill.id, skill.published_version_id),
  };
}
export async function createVersion(skillId: string, user: string) {
  const skill = await ownedSkill(skillId, user);
  validateSkillSubmission(skill.draft);
  await validateAssets(skill.draft, user);
  const version = randomUUID();
  await transaction(async (db) => {
    await db.query('INSERT INTO skill_versions(id,skill_id,version,content) VALUES($1,$2,$3,$4)', [
      version,
      skill.id,
      skill.draft.version,
      skill.draft,
    ]);
    for (const ref of Object.values(skill.draft.assets))
      await db.query('INSERT INTO version_assets VALUES($1,$2)', [version, assetId(ref)]);
  });
  return { id: version };
}
export async function unpublishSkill(skillId: string, user: string) {
  const skill = await ownedSkill(skillId, user);
  check(skill.status !== 'blocked', 'BLOCKED', '已被管理下架');
  await pool.query(
    "UPDATE skills SET status='draft',revision=revision+1 WHERE id=$1 AND status<>'blocked'",
    [skill.id],
  );
  return { unpublished: true };
}
