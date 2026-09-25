import { pool } from '../db.js';

// Only a successful export of this exact version is a published GitHub link.
export async function githubPublicationUrl(
  skill: string,
  version: string | null,
): Promise<string | null> {
  if (!version) return null;
  const row = (
    await pool.query(
      `
    SELECT COALESCE(result->>'skill_url', result->>'commit_url') AS url
    FROM jobs
    WHERE type='github' AND status='succeeded'
      AND payload->>'skill_id'=$1 AND payload->>'version_id'=$2
      AND COALESCE(result->>'skill_url', result->>'commit_url') IS NOT NULL
    ORDER BY created_at DESC, id DESC LIMIT 1`,
      [skill, version],
    )
  ).rows[0];
  return row?.url ?? null;
}
