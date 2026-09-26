import type { ApiRoute } from '../../../packages/api/index.js';
import { Octokit } from '@octokit/rest';
import type { FastifyInstance } from 'fastify';
import { admin, uid } from '../auth.js';
import { secret } from '../config.js';
import { pool } from '../db.js';
import { check, id, params, query, requestFailure } from '../errors.js';
import { githubStatus, githubTarget } from '../github-config.js';
import { listBatches, weeklyStatus } from '../services/github-schedule.js';
import { ownedSkill } from '../services/skills.js';

function pageNumber(value?: string) {
  const page = Number(value || 1);
  check(Number.isInteger(page) && page > 0 && page <= 100000, 'INVALID_PAGE');
  return page;
}

async function retryJob(jobId: string, user: string | null) {
  const j = (
    await pool.query(
      "SELECT * FROM jobs WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND type='github'",
      [id(jobId), user],
    )
  ).rows[0];
  check(j, 'NOT_FOUND', '任务不存在');
  check(j.payload.target?.auth_mode === 'owner', 'GITHUB_LEGACY_JOB');
  check(j.status === 'failed', 'NOT_RETRYABLE');
  check(
    (await pool.query('SELECT 1 FROM github_batch_jobs WHERE job_id=$1', [j.id])).rowCount,
    'NOT_RETRYABLE',
    '旧即时任务等待每周调度',
  );
  const t = githubTarget();
  check(
    j.payload.target.owner.toLowerCase() === t.owner &&
      j.payload.target.repo.toLowerCase() === t.repo &&
      j.payload.target.branch === t.branch,
    'GITHUB_TARGET_CHANGED',
  );
  const result = await pool.query(
    "UPDATE jobs SET status='queued',attempts=0,run_after=now(),last_error=NULL,result=NULL WHERE id=$1 AND status='failed' RETURNING id",
    [j.id],
  );
  check(result.rowCount, 'NOT_RETRYABLE', '任务已被重试');
  return { queued: true };
}

export async function githubRoutes(app: FastifyInstance) {
  app.get<ApiRoute<'GET /github/status'>>('/github/status', async (r) => {
    const user = uid(r),
      batches = await listBatches(user);
    return { ...githubStatus(), schedule: await weeklyStatus(), latest_batch: batches[0] || null };
  });
  app.get<ApiRoute<'GET /github/batches'>>('/github/batches', async (r) =>
    listBatches(uid(r), pageNumber(query(r).page)),
  );
  app.get<ApiRoute<'GET /admin/github/batches'>>('/admin/github/batches', async (r) => {
    admin(r);
    return listBatches(null, pageNumber(query(r).page));
  });
  app.post<ApiRoute<'POST /admin/sync-jobs/:id/retry'>>('/admin/sync-jobs/:id/retry', async (r) => {
    admin(r);
    return retryJob(params(r).id, null);
  });
  app.post<ApiRoute<'POST /admin/github/check'>>('/admin/github/check', async (r) => {
    admin(r);
    const t = githubTarget(),
      api = new Octokit({ auth: secret('GITHUB_OWNER_TOKEN'), request: { timeout: 30000 } });
    try {
      const repo = (await api.repos.get({ owner: t.owner, repo: t.repo })).data;
      check(repo.permissions?.push, 'GITHUB_PERMISSION_REQUIRED');
      await api.git.getRef({ owner: t.owner, repo: t.repo, ref: 'heads/' + t.branch });
      return {
        reachable: true,
        message: '仓库和分支可访问；令牌的 Contents 写权限及分支规则需由管理员确认',
      };
    } catch (error) {
      const e = requestFailure(error);
      if (e.code?.startsWith('GITHUB')) throw error;
      check(
        false,
        'GITHUB_CHECK_FAILED',
        '无法访问仓库或分支 (' + (e.status || 'network') + ')，请检查 Owner 令牌、权限与目标分支',
      );
    }
  });
  async function jobs(user: string | null, q: Record<string, string>) {
    if (q.skill_id) {
      id(q.skill_id);
      if (user) await ownedSkill(q.skill_id, user);
    }
    if (q.batch_id) id(q.batch_id);
    if (q.status)
      check(
        ['queued', 'running', 'succeeded', 'failed', 'skipped'].includes(q.status),
        'INVALID_STATUS',
        '同步状态无效',
      );
    for (const date of [q.from, q.to])
      if (date) check(Number.isFinite(Date.parse(date)), 'INVALID_DATE');
    const page = pageNumber(q.page);
    return (
      await pool.query(
        `SELECT j.id,j.status,j.attempts,j.last_error,j.result,j.created_at,j.payload->>'skill_id' AS skill_id,
      j.payload->>'version_id' AS version_id,j.payload->'content'->>'version' AS version,j.payload->'target' AS target
      FROM jobs j WHERE ($1::uuid IS NULL OR j.user_id=$1) AND j.type='github'
      AND ($2::text IS NULL OR j.payload->>'skill_id'=$2) AND ($3::text IS NULL OR j.status=$3)
      AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM github_batch_jobs bj WHERE bj.job_id=j.id AND bj.batch_id=$4))
      AND ($5::timestamptz IS NULL OR j.created_at>=$5) AND ($6::timestamptz IS NULL OR j.created_at<$6)
      ORDER BY j.created_at DESC,j.id DESC LIMIT 50 OFFSET $7`,
        [
          user,
          q.skill_id || null,
          q.status || null,
          q.batch_id || null,
          q.from ? new Date(q.from) : null,
          q.to ? new Date(q.to) : null,
          (page - 1) * 50,
        ],
      )
    ).rows;
  }
  app.get<ApiRoute<'GET /sync-jobs'>>('/sync-jobs', async (r) => jobs(uid(r), query(r)));
  app.get<ApiRoute<'GET /admin/sync-jobs'>>('/admin/sync-jobs', async (r) => {
    admin(r);
    return jobs(null, query(r));
  });
  app.get<ApiRoute<'GET /sync-jobs/:id'>>('/sync-jobs/:id', async (r) => {
    const j = (
      await pool.query(
        "SELECT id,status,attempts,last_error,result FROM jobs WHERE id=$1 AND user_id=$2 AND type='github'",
        [id(params(r).id), uid(r)],
      )
    ).rows[0];
    check(j, 'NOT_FOUND', '任务不存在');
    return j;
  });
  app.post<ApiRoute<'POST /sync-jobs/:id/retry'>>('/sync-jobs/:id/retry', async (r) =>
    retryJob(params(r).id, uid(r)),
  );
}
