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
  check(Number.isInteger(page) && page > 0 && page <= 100000, 422, 'INVALID_PAGE', '页码无效');
  return page;
}

async function retryJob(jobId: string, user: string | null) {
  const j = (
    await pool.query(
      "SELECT * FROM jobs WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND type='github'",
      [id(jobId), user],
    )
  ).rows[0];
  check(j, 404, 'NOT_FOUND', '任务不存在');
  check(
    j.payload.target?.auth_mode === 'owner',
    409,
    'GITHUB_LEGACY_JOB',
    '旧 App 任务不能转投统一仓库，请联系管理员核对原提交',
  );
  check(j.status === 'failed', 409, 'NOT_RETRYABLE', '仅失败任务可以重试');
  check(
    (await pool.query('SELECT 1 FROM github_batch_jobs WHERE job_id=$1', [j.id])).rowCount,
    409,
    'NOT_RETRYABLE',
    '旧即时任务等待每周调度',
  );
  const t = githubTarget();
  check(
    j.payload.target.owner.toLowerCase() === t.owner &&
      j.payload.target.repo.toLowerCase() === t.repo &&
      j.payload.target.branch === t.branch,
    409,
    'GITHUB_TARGET_CHANGED',
    '目标已变更，不能重试旧目标任务',
  );
  const result = await pool.query(
    "UPDATE jobs SET status='queued',attempts=0,run_after=now(),last_error=NULL,result=NULL WHERE id=$1 AND status='failed' RETURNING id",
    [j.id],
  );
  check(result.rowCount, 409, 'NOT_RETRYABLE', '任务已被重试');
  return { queued: true };
}

export async function githubRoutes(app: FastifyInstance) {
  app.get('/github/status', async (r) => {
    const user = uid(r),
      batches = await listBatches(user);
    return { ...githubStatus(), schedule: await weeklyStatus(), latest_batch: batches[0] || null };
  });
  app.get('/github/batches', async (r) => listBatches(uid(r), pageNumber(query(r).page)));
  app.get('/admin/github/batches', async (r) => {
    admin(r);
    return listBatches(null, pageNumber(query(r).page));
  });
  app.post('/admin/sync-jobs/:id/retry', async (r) => {
    admin(r);
    return retryJob(params(r).id, null);
  });
  app.post('/admin/github/check', async (r) => {
    admin(r);
    const t = githubTarget(),
      api = new Octokit({ auth: secret('GITHUB_OWNER_TOKEN'), request: { timeout: 30000 } });
    try {
      const repo = (await api.repos.get({ owner: t.owner, repo: t.repo })).data;
      check(
        repo.permissions?.push,
        422,
        'GITHUB_PERMISSION_REQUIRED',
        'Owner 令牌没有目标仓库的写入权限',
      );
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
        422,
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
        422,
        'INVALID_STATUS',
        '同步状态无效',
      );
    for (const date of [q.from, q.to])
      if (date) check(Number.isFinite(Date.parse(date)), 422, 'INVALID_DATE', '同步日期无效');
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
  app.get('/sync-jobs', async (r) => jobs(uid(r), query(r)));
  app.get('/admin/sync-jobs', async (r) => {
    admin(r);
    return jobs(null, query(r));
  });
  app.get('/sync-jobs/:id', async (r) => {
    const j = (
      await pool.query(
        "SELECT id,status,attempts,last_error,result FROM jobs WHERE id=$1 AND user_id=$2 AND type='github'",
        [id(params(r).id), uid(r)],
      )
    ).rows[0];
    check(j, 404, 'NOT_FOUND', '任务不存在');
    return j;
  });
  app.post('/sync-jobs/:id/retry', async (r) => retryJob(params(r).id, uid(r)));
}
