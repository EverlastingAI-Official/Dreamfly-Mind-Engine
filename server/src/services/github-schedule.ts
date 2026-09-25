import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { pool, transaction, type DB } from '../db.js';
import { check, HttpError } from '../errors.js';
import { githubTarget } from '../github-config.js';
import { publicMind } from '../public-mind.js';

export function weeklySettings() {
  const timezone = process.env.GITHUB_SYNC_TIMEZONE || 'Asia/Shanghai';
  const weekday = Number(process.env.GITHUB_SYNC_WEEKDAY || 1),
    time = process.env.GITHUB_SYNC_TIME || '03:00';
  check(
    Number.isInteger(weekday) &&
      weekday >= 1 &&
      weekday <= 7 &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
    422,
    'GITHUB_SCHEDULE_INVALID',
    '每周同步时间配置无效',
  );
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    check(false, 422, 'GITHUB_SCHEDULE_INVALID', '每周同步时区配置无效');
  }
  return { timezone, weekday, time };
}

// Calendar weeks are calculated in the configured zone, independently of host time.
export async function weeklyWindow(db: DB, now: Date, settings = weeklySettings()) {
  return (
    await db.query(
      `WITH local AS (
    SELECT $1::timestamptz AT TIME ZONE $2 AS now_local
  ), slot AS (
    SELECT now_local,date_trunc('week',now_local)+($3::int-1)*interval '1 day'+($4::time-time '00:00') AS at FROM local
  ) SELECT (CASE WHEN at<=now_local THEN at ELSE at-interval '7 days' END) AT TIME ZONE $2 AS previous,
    (CASE WHEN at>now_local THEN at ELSE at+interval '7 days' END) AT TIME ZONE $2 AS next FROM slot`,
      [now, settings.timezone, settings.weekday, settings.time],
    )
  ).rows[0];
}

export async function scheduleWeeklyGithub(now = new Date()) {
  const settings = weeklySettings();
  return transaction(async (db) => {
    const schedule = (await db.query('SELECT * FROM github_schedule WHERE id=true FOR UPDATE'))
      .rows[0];
    const window = await weeklyWindow(db, now, settings);
    if (
      schedule.timezone !== settings.timezone ||
      schedule.weekday !== settings.weekday ||
      schedule.local_time.slice(0, 5) !== settings.time
    ) {
      await db.query(
        'UPDATE github_schedule SET timezone=$1,weekday=$2,local_time=$3,next_run_at=$4,last_error=NULL WHERE id=true',
        [settings.timezone, settings.weekday, settings.time, window.next],
      );
      return null;
    }
    if (!config.githubEnabled || schedule.next_run_at > now) return null;
    let target: ReturnType<typeof githubTarget>;
    try {
      target = githubTarget();
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await db.query('UPDATE github_schedule SET last_error=$1 WHERE id=true', [e.message]);
      return null;
    }
    const batch = randomUUID();
    const inserted = await db.query(
      'INSERT INTO github_batches(id,target,scheduled_for) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
      [batch, target, window.previous],
    );
    if (inserted.rowCount) {
      // One SQL snapshot captures each current published version; drafts never enter a batch.
      const versions = (
        await db.query(`SELECT s.id AS skill_id,s.owner_id,v.id AS version_id,v.content,v.publication
        FROM skills s JOIN skill_versions v ON v.id=s.published_version_id JOIN users u ON u.id=s.owner_id
        WHERE s.status='published' AND s.publication->>'github'='true' AND u.status='active'`)
      ).rows;
      for (const v of versions) {
        const key = `${v.version_id}:${target.owner}/${target.repo}:${target.branch}`;
        const existing = (
          await db.query(
            `SELECT id,status FROM jobs WHERE type='github' AND
          payload->>'version_id'=$1 AND payload->'target'->>'auth_mode'='owner'
          AND lower(payload->'target'->>'owner')=$2 AND lower(payload->'target'->>'repo')=$3
          AND payload->'target'->>'branch'=$4
          ORDER BY (status='succeeded') DESC,created_at DESC LIMIT 1 FOR UPDATE`,
            [v.version_id, target.owner, target.repo, target.branch],
          )
        ).rows[0];
        if (existing && ['succeeded', 'queued', 'running'].includes(existing.status)) continue;
        const job = existing?.id || randomUUID();
        if (existing) {
          // Preserve the ID and payload: a previous remote commit may already exist.
          await db.query(
            "UPDATE jobs SET status='queued',attempts=0,run_after=now(),last_error=NULL,result=NULL,lease_until=NULL WHERE id=$1",
            [job],
          );
        } else {
          await db.query(
            "INSERT INTO jobs(id,user_id,type,payload,unique_key) VALUES($1,$2,'github',$3,$4)",
            [
              job,
              v.owner_id,
              {
                skill_id: v.skill_id,
                version_id: v.version_id,
                target,
                content: publicMind(v.content, v.publication),
              },
              key,
            ],
          );
        }
        await db.query('INSERT INTO github_batch_jobs(batch_id,job_id) VALUES($1,$2)', [
          batch,
          job,
        ]);
      }
    }
    await db.query('UPDATE github_schedule SET next_run_at=$1,last_error=NULL WHERE id=true', [
      window.next,
    ]);
    return inserted.rowCount ? batch : null;
  });
}

export async function weeklyStatus() {
  const row = (
    await pool.query(
      'SELECT timezone,weekday,local_time,next_run_at,last_error FROM github_schedule WHERE id=true',
    )
  ).rows[0];
  return { frequency: 'weekly', ...row };
}

export async function listBatches(user: string | null, page = 1) {
  return (
    await pool.query(
      `SELECT b.id,b.scheduled_for,b.created_at,
    count(j.id)::int AS total,
    count(j.id) FILTER(WHERE j.status='succeeded')::int AS succeeded,
    count(j.id) FILTER(WHERE j.status='failed')::int AS failed,
    count(j.id) FILTER(WHERE j.status='skipped')::int AS skipped,
    count(j.id) FILTER(WHERE j.status IN ('queued','running'))::int AS pending
    FROM github_batches b LEFT JOIN github_batch_jobs bj ON bj.batch_id=b.id
    LEFT JOIN jobs j ON j.id=bj.job_id AND ($1::uuid IS NULL OR j.user_id=$1)
    GROUP BY b.id HAVING $1::uuid IS NULL OR count(j.id)>0
    ORDER BY b.created_at DESC,b.id DESC LIMIT 20 OFFSET $2`,
      [user, (page - 1) * 20],
    )
  ).rows;
}
