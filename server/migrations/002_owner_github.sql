ALTER TABLE skills ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE skills ADD COLUMN draft_publication jsonb NOT NULL DEFAULT '{}';
UPDATE skills SET draft_publication=publication;

CREATE TABLE skill_submissions (
 skill_id uuid NOT NULL REFERENCES skills(id), request_id uuid NOT NULL,
 request jsonb NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(skill_id,request_id)
);

CREATE INDEX github_jobs_target_order ON jobs ((payload->'target'),created_at,id)
 WHERE type='github' AND status IN ('queued','running');

-- Legacy App jobs retain their original payload and remote links for inspection.
UPDATE jobs SET status='failed', lease_until=NULL,
 last_error='旧 GitHub App 任务已停止，请管理员核对原仓库和 PR；不会自动转投统一仓库'
 WHERE type='github' AND status IN ('queued','running','awaiting_merge')
 AND payload->'target'->>'auth_mode' IS DISTINCT FROM 'owner';
