import { Octokit } from '@octokit/rest';
import { secret } from '../config.js';
import { pool } from '../db.js';
import { check, requestFailure } from '../errors.js';
import { githubTarget } from '../github-config.js';
import type { GithubJob, JobResult } from '../types.js';
import { exportFiles } from './assets.js';
import { ownedSkill } from './skills.js';
async function authorizeGithub(job: GithubJob) {
  const configured = githubTarget(),
    target = job.payload.target;
  check(
    target?.auth_mode === 'owner',
    422,
    'GITHUB_LEGACY_JOB',
    '旧 App 任务已停止，请管理员核对原仓库；不会自动转投统一仓库',
  );
  check(
    target.owner.toLowerCase() === configured.owner.toLowerCase() &&
      target.repo.toLowerCase() === configured.repo.toLowerCase() &&
      target.branch === configured.branch,
    422,
    'GITHUB_TARGET_CHANGED',
    '平台同步目标已变更，此任务仍保留原目标，请管理员核对',
  );
  return {
    repo: { owner: target.owner, name: target.repo },
    api: new Octokit({ auth: secret('GITHUB_OWNER_TOKEN'), request: { timeout: 30000 } }),
  };
}

async function publicationAllowed(job: GithubJob) {
  const skill = await ownedSkill(job.payload.skill_id, job.user_id);
  const owner = (await pool.query('SELECT status FROM users WHERE id=$1', [job.user_id])).rows[0];
  return (
    owner?.status === 'active' &&
    skill.status === 'published' &&
    skill.publication.github &&
    job.payload.content.memory.fragments.every((m) => skill.publication.memory_ids?.includes(m.id))
  );
}

export async function syncGithub(
  job: GithubJob,
  authorize: typeof authorizeGithub = authorizeGithub,
): Promise<JobResult> {
  check(
    job.payload.target?.auth_mode === 'owner',
    422,
    'GITHUB_LEGACY_JOB',
    '旧 App 任务已停止，不会自动转投统一仓库',
  );
  const skipped: JobResult = { status: 'skipped', reason: '已下架、账号停用或记忆公开范围已撤销' };
  if (!(await publicationAllowed(job))) return skipped;
  const { repo, api } = await authorize(job),
    t = job.payload.target;
  const owner = repo.owner,
    repoName = repo.name,
    branch = t.branch;
  const content = job.payload.content,
    dir = `skills/${job.user_id}/${job.payload.skill_id}/${content.version}/${content.slug}`;
  const marker = `DreamFly publication ${job.id}`;
  const lockKey = `${owner.toLowerCase()}/${repoName.toLowerCase()}:${branch}`,
    lock = await pool.connect();
  let locked = false;
  try {
    locked = (await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]))
      .rows[0].locked;
    if (!locked) return { status: 'deferred' };
    if (!(await publicationAllowed(job))) return skipped;
    let head: string;
    try {
      head = (await api.git.getRef({ owner, repo: repoName, ref: 'heads/' + branch })).data.object
        .sha;
    } catch (error) {
      const e = requestFailure(error);
      if (e.status !== 404 && e.status !== 409) throw error;
      const branches = (await api.repos.listBranches({ owner, repo: repoName })).data;
      check(branches.length === 0, 422, 'GITHUB_BRANCH_NOT_FOUND', '目标分支不存在，请联系管理员');
      const initial = await api.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: 'README.md',
        message: 'Initialize DreamFly content repository',
        content: Buffer.from('# Mind Skills\n').toString('base64'),
        branch,
      });
      head = initial.data.commit.sha!;
    }
    const previous = await api.repos.listCommits({
      owner,
      repo: repoName,
      sha: branch,
      path: dir + '/mind.json',
      per_page: 100,
    });
    let commit: { sha: string; html_url: string } | undefined = previous.data.find(
      (x) => x.commit.message === marker,
    );
    if (!commit) {
      const files = await exportFiles(content),
        entries = [];
      for (const [name, data] of files) {
        const blob = await api.git.createBlob({
          owner,
          repo: repoName,
          content: data.toString('base64'),
          encoding: 'base64',
        });
        entries.push({
          path: dir + '/' + name,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.data.sha,
        });
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await publicationAllowed(job))) return skipped;
        const parent = await api.git.getCommit({ owner, repo: repoName, commit_sha: head });
        const tree = await api.git.createTree({
          owner,
          repo: repoName,
          base_tree: parent.data.tree.sha,
          tree: entries,
        });
        const created = await api.git.createCommit({
          owner,
          repo: repoName,
          message: marker,
          tree: tree.data.sha,
          parents: [head],
        });
        try {
          await api.git.updateRef({
            owner,
            repo: repoName,
            ref: 'heads/' + branch,
            sha: created.data.sha,
            force: false,
          });
          commit = { sha: created.data.sha, html_url: created.data.html_url };
          break;
        } catch (error) {
          const e = requestFailure(error);
          if (![409, 422].includes(e.status || 0) || attempt === 2) throw e;
          head = (await api.git.getRef({ owner, repo: repoName, ref: 'heads/' + branch })).data
            .object.sha;
        }
      }
    }
    check(commit, 502, 'GITHUB_COMMIT_FAILED', '无法创建提交');
    const skillUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/tree/${encodeURIComponent(commit.sha)}/${dir.split('/').map(encodeURIComponent).join('/')}`;
    return { status: 'succeeded', commit_url: commit.html_url, skill_url: skillUrl };
  } finally {
    try {
      if (locked) await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
    } finally {
      lock.release();
    }
  }
}
