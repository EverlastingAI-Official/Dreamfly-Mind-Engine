import { config } from './config.js';
import { decrypt } from './crypto.js';
import { pool, transaction } from './db.js';
import { HttpError, requestFailure } from './errors.js';
import { scheduleWeeklyGithub } from './services/github-schedule.js';
import { errorDiagnostic } from './logging.js';
import { sendEmailCode } from './mail.js';
import { syncGithub } from './services/github-sync.js';
import type { JobResult, QueuedJob } from './types.js';

export async function runOnce(
  queue: 'email' | 'github' = 'email',
  sync: typeof syncGithub = syncGithub,
) {
  if (queue === 'github' && !config.githubEnabled) return false;
  const job = await transaction(
    async (db) =>
      (
        await db.query<QueuedJob>(
          `WITH next AS (
    SELECT j.id FROM jobs j WHERE j.type=$2 AND ((j.status='queued' AND j.run_after<=now()) OR (j.status='running' AND j.lease_until<now()))
    ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
    UPDATE jobs SET status='running',attempts=attempts+1,lease_until=now()+$1*interval '1 second' FROM next WHERE jobs.id=next.id RETURNING jobs.*`,
          [config.lease, queue],
        )
      ).rows[0],
  );
  if (!job) return false;
  const heartbeat = setInterval(
    () => {
      void pool
        .query(
          "UPDATE jobs SET lease_until=now()+$3*interval '1 second' WHERE id=$1 AND status='running' AND attempts=$2",
          [job.id, job.attempts, config.lease],
        )
        .catch((error) => console.error('Worker lease renewal failed', errorDiagnostic(error)));
    },
    (config.lease * 1000) / 4,
  );
  try {
    let result: JobResult;
    if (job.type === 'email') {
      const c = (
        await pool.query(
          'SELECT * FROM email_challenges WHERE id=$1 AND consumed_at IS NULL AND expires_at>now()',
          [job.payload.challenge_id],
        )
      ).rows[0];
      if (c) {
        await sendEmailCode(c.email, c.purpose, decrypt(job.payload.code, `email:${c.id}`));
      }
      result = { status: 'succeeded' };
    } else result = await sync(job);
    if (result.status === 'deferred') {
      await pool.query(
        "UPDATE jobs SET status='queued',attempts=attempts-1,lease_until=NULL,run_after=now()+interval '2 seconds' WHERE id=$1 AND status='running' AND attempts=$2",
        [job.id, job.attempts],
      );
      return true;
    }
    await pool.query(
      "UPDATE jobs SET status=$1,result=$2,last_error=NULL,lease_until=NULL,payload=CASE WHEN type='email' THEN jsonb_build_object('challenge_id',payload->>'challenge_id') ELSE payload END WHERE id=$3 AND status='running' AND attempts=$4",
      [result.status, result, job.id, job.attempts],
    );
  } catch (error) {
    const e = requestFailure(error);
    console.error('Job failed', { job_id: job.id, ...errorDiagnostic(error) });
    const headers = e.response?.headers || {},
      limited =
        e.status === 429 ||
        (e.status === 403 && (headers['retry-after'] || headers['x-ratelimit-remaining'] === '0'));
    const permanent =
      !limited && [400, 401, 403, 404, 409, 422].includes(e.status || e.statusCode || 0);
    const exhausted = job.attempts >= 5;
    const retrySeconds = limited
      ? Math.max(
          60,
          Number(headers['retry-after']) || 0,
          (Number(headers['x-ratelimit-reset']) || 0) - Math.floor(Date.now() / 1000),
        )
      : Math.min(300, 2 ** job.attempts * 5);
    const message =
      job.type === 'email'
        ? '邮件投递失败，请检查 SMTP 配置或重试'
        : error instanceof HttpError
          ? error.message
          : limited
            ? 'GitHub 请求限流，稍后自动重试'
            : `GitHub 请求失败 (${e.status || 'network'})，请管理员检查 Owner 令牌、仓库权限及分支规则`;
    await pool.query(
      "UPDATE jobs SET status=$1,last_error=$2,lease_until=NULL,run_after=now()+$3*interval '1 second',payload=CASE WHEN type='email' AND $1='failed' THEN jsonb_build_object('challenge_id',payload->>'challenge_id') ELSE payload END WHERE id=$4 AND status='running' AND attempts=$5",
      [permanent || exhausted ? 'failed' : 'queued', message, retrySeconds, job.id, job.attempts],
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
  });
  process.on('SIGTERM', () => {
    stopping = true;
  });
  const queue = process.env.WORKER_QUEUE || 'all';
  if (!['all', 'email', 'github'].includes(queue))
    throw new Error('WORKER_QUEUE must be all, email or github');
  const queues: ('email' | 'github')[] =
    queue === 'all' ? ['email', 'github'] : [queue as 'email' | 'github'];
  await Promise.all(
    queues.map(async (lane) => {
      let nextScheduleCheck = 0;
      while (!stopping) {
        if (lane === 'github' && Date.now() >= nextScheduleCheck) {
          nextScheduleCheck = Date.now() + 60000;
          try {
            await scheduleWeeklyGithub();
          } catch (error) {
            console.error('GitHub weekly scheduling failed', errorDiagnostic(error));
          }
        }
        try {
          await runOnce(lane);
        } catch (error) {
          console.error(`${lane} worker unavailable; retrying`, errorDiagnostic(error));
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Number(process.env.WORKER_POLL_INTERVAL_MS || 1000)),
        );
      }
    }),
  );
  await pool.end();
}
