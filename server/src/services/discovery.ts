import type { Mind, Publication } from '../types.js';
interface ReactionState {
  like_count: number;
  liked: boolean;
  favorited: boolean;
}
interface PublicSkillRow extends ReactionState {
  id: string;
  slug: string;
  owner_id: string;
  published_version_id: string;
  author: string;
  content: Mind;
  version: string;
  published_at: Date;
  publication: Publication;
}
import { pool, type DB } from '../db.js';
import { check } from '../errors.js';
import { githubPublicationUrl } from './github-publication.js';
import { publicMind } from '../public-mind.js';
export const visible =
  "s.status='published' AND s.publication->>'listed'='true' AND u.status='active'";
export const reactions = `(SELECT count(*)::int FROM skill_reactions WHERE skill_id=s.id AND kind='like') AS like_count,
 EXISTS(SELECT 1 FROM skill_reactions WHERE skill_id=s.id AND user_id=$1::uuid AND kind='like') AS liked,
 EXISTS(SELECT 1 FROM skill_reactions WHERE skill_id=s.id AND user_id=$1::uuid AND kind='favorite') AS favorited`;

export async function reactionState(skill: string, user: string | null, db: DB = pool) {
  return (
    await db.query<ReactionState>(`SELECT ${reactions} FROM skills s WHERE s.id=$2`, [user, skill])
  ).rows[0];
}

export async function publicSkill(skill: string, user: string | null) {
  const row = (
    await pool.query<PublicSkillRow>(
      `SELECT s.id,s.slug,s.owner_id,s.published_version_id,u.display_name AS author,
    v.content,v.version,v.created_at AS published_at,v.publication,${reactions}
    FROM skills s JOIN users u ON u.id=s.owner_id JOIN skill_versions v ON v.id=s.published_version_id
    WHERE s.id=$2 AND ${visible}`,
      [user, skill],
    )
  ).rows[0];
  check(row, 404, 'NOT_FOUND', 'Skill 不存在或已下架');
  const content = publicMind(row.content, row.publication);
  // Listing permission does not grant access to the full persona or memories.
  const preview =
    user && row.publication.download ? { persona: content.persona, memory: content.memory } : null;
  return {
    id: row.id,
    slug: row.slug,
    is_owner: row.owner_id === user,
    name: content.name,
    description: content.description,
    author: row.author,
    language: content.language,
    version: row.version,
    published_at: row.published_at,
    published_version_id: row.published_version_id,
    publication: { chat: !!row.publication.chat, download: !!row.publication.download },
    memory_count: content.memory.fragments.length,
    asset_count: Object.keys(content.assets).length,
    like_count: row.like_count,
    liked: row.liked,
    favorited: row.favorited,
    preview,
    github_url: row.publication.github
      ? await githubPublicationUrl(row.id, row.published_version_id)
      : null,
  };
}
