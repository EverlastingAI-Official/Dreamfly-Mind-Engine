CREATE TABLE github_schedule (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 timezone text NOT NULL, weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 local_time time NOT NULL, next_run_at timestamptz NOT NULL, last_error text
);
INSERT INTO github_schedule(timezone,weekday,local_time,next_run_at)
SELECT 'Asia/Shanghai',1,'03:00',
 (date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') + interval '3 hours'
 + CASE WHEN now() AT TIME ZONE 'Asia/Shanghai' >= date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') + interval '3 hours'
   THEN interval '7 days' ELSE interval '0 days' END) AT TIME ZONE 'Asia/Shanghai';

CREATE TABLE github_batches (
 id uuid PRIMARY KEY, target jsonb NOT NULL, scheduled_for timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(target,scheduled_for)
);
CREATE TABLE github_batch_jobs (
 batch_id uuid NOT NULL REFERENCES github_batches(id), job_id uuid NOT NULL REFERENCES jobs(id),
 PRIMARY KEY(batch_id,job_id)
);
CREATE INDEX github_batch_jobs_job ON github_batch_jobs(job_id);
CREATE INDEX github_jobs_version ON jobs ((payload->>'version_id')) WHERE type='github';

-- Stop the old worker before migration. Keep task IDs/remote markers for recovery.
UPDATE jobs SET status='skipped',lease_until=NULL,last_error='已切换每周同步，最新版本将在下次批次重新评估'
 WHERE type='github' AND status IN ('queued','running','failed')
 AND payload->'target'->>'auth_mode'='owner';
