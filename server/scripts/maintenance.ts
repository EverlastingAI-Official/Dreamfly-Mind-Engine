import { pool,transaction } from '../src/db.js';
const count=await transaction(async db=>{
  await db.query('DELETE FROM auth_sessions WHERE expires_at<now() OR absolute_expires_at<now()');
  await db.query('DELETE FROM rate_limits WHERE expires_at<now()');
  await db.query('DELETE FROM github_states WHERE expires_at<now()');
  await db.query("UPDATE jobs SET payload=jsonb_build_object('challenge_id',payload->>'challenge_id'),status='failed',last_error='验证码已过期' WHERE type='email' AND status IN ('queued','failed') AND EXISTS(SELECT 1 FROM email_challenges c WHERE c.id::text=jobs.payload->>'challenge_id' AND c.expires_at<now())");
  await db.query("DELETE FROM email_challenges WHERE expires_at<now()-interval '1 day'");
  return (await db.query("DELETE FROM jobs WHERE type='email' AND created_at<now()-interval '7 days' AND status IN ('succeeded','failed')")).rowCount;
});
console.log(`Expired sessions/challenges cleaned; ${count} old mail jobs removed.`);await pool.end();
