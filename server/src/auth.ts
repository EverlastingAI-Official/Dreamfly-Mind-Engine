import { randomInt, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool, transaction, type DB } from './db.js';
import { config } from './config.js';
import { body, check, HttpError, text } from './errors.js';
import { token, digest, codeDigest, encrypt, equal } from './crypto.js';

declare module 'fastify' {
  interface FastifyRequest { user?: { id: string; email: string; display_name: string; role: string }; session?: { csrf: string; session_digest: string } }
  interface FastifyContextConfig { public?: boolean; webhook?: boolean }
}
export const uid = (r: FastifyRequest) => { check(r.user, 401, 'LOGIN_REQUIRED', '请先登录'); return r.user.id; };
export function admin(r: FastifyRequest) { uid(r); check(r.user!.role === 'admin', 403, 'FORBIDDEN', '需要管理员权限'); }
const email = (v: unknown) => { const e = text(v, '邮箱', 254).toLowerCase(); check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 422, 'INVALID_EMAIL', '邮箱格式无效'); return e; };
function password(v: unknown): string { check(typeof v === 'string' && v.length >= 12 && v.length <= 128, 422, 'INVALID_PASSWORD', '密码长度须为 12–128 字符'); return v; }
export async function rate(key: string, max: number, seconds: number) {
  const { rows } = await pool.query(`INSERT INTO rate_limits VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`, [key, seconds]);
  check(rows[0].count <= max, 429, 'RATE_LIMIT', '请求过于频繁，请稍后再试');
}
const cookieOptions = () => ({ path: '/', httpOnly: true, secure: config.production, sameSite: 'lax' as const });
async function consume(db: DB, b: Record<string, any>, purpose: string) {
  const { rows } = await db.query('SELECT * FROM email_challenges WHERE id=$1 AND email=$2 AND purpose=$3 FOR UPDATE', [b.challenge_id, email(b.email), purpose]);
  const c = rows[0];
  if (!c || c.consumed_at || c.expires_at <= new Date() || c.attempts >= config.attempts) return false;
  await db.query('UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1', [c.id]);
  if (!equal(c.code_digest, codeDigest(`${c.id}:${c.email}:${purpose}:${b.code}`))) return false;
  await db.query('UPDATE email_challenges SET consumed_at=now() WHERE id=$1', [c.id]);
  return true;
}
export async function auth(app: FastifyInstance) {
  const dummy = await argon2.hash(token());
  app.decorateRequest('user', undefined); app.decorateRequest('session', undefined);
  app.addHook('onRequest', async r => {
    const t = r.cookies[config.cookie];
    if (t) {
      const { rows } = await pool.query(`UPDATE auth_sessions s SET expires_at=LEAST(s.absolute_expires_at,now()+$2*interval '1 second')
        FROM users u WHERE s.session_digest=$1 AND s.user_id=u.id AND u.status='active'
        AND s.expires_at>now() AND s.absolute_expires_at>now() RETURNING u.id,u.email,u.display_name,u.role,s.csrf,s.session_digest`, [digest(t), config.idle]);
      if (rows[0]) { const u=rows[0];r.user = {id:u.id,email:u.email,display_name:u.display_name,role:u.role}; r.session = {csrf:u.csrf,session_digest:u.session_digest}; }
    }
    if (!r.routeOptions.config.public && !r.routeOptions.config.webhook) uid(r);
    if (!['GET','HEAD','OPTIONS'].includes(r.method) && !r.routeOptions.config.webhook) {
      check(r.headers.origin === config.origin, 403, 'ORIGIN_REJECTED', '请求来源不被允许');
      if (!r.routeOptions.config.public) check(r.session && equal(String(r.headers['x-csrf-token'] || ''), r.session.csrf), 403, 'CSRF_REJECTED', '会话校验失败，请刷新重试');
    }
  });
  const pub = { config: { public: true } };
  app.post('/auth/email-codes', pub, async r => {
    const b = body(r), e = email(b.email); check(['register','reset_password'].includes(b.purpose),422,'INVALID_PURPOSE','验证码用途无效');
    await rate(`mail:ip:${r.ip}`,20,3600); await rate(`mail:${e}`,1,config.resend);
    const challenge = randomUUID(); const code = String(randomInt(100000,1000000));
    await transaction(async db => {
      await db.query('UPDATE email_challenges SET consumed_at=now() WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL',[e,b.purpose]);
      const exists = (await db.query('SELECT 1 FROM users WHERE email=$1 AND status=$2',[e,'active'])).rowCount;
      if ((b.purpose === 'register' && exists) || (b.purpose === 'reset_password' && !exists)) return;
      await db.query("INSERT INTO email_challenges(id,email,purpose,code_digest,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second')",[challenge,e,b.purpose,codeDigest(`${challenge}:${e}:${b.purpose}:${code}`),config.codeTTL]);
      await db.query("INSERT INTO jobs(id,type,payload) VALUES($1,'email',$2)",[randomUUID(),{challenge_id:challenge,code:encrypt(code,`email:${challenge}`)}]);
    });
    return { challenge_id: challenge, message: '请求已受理，请检查邮箱', expires_in:config.codeTTL };
  });
  app.post('/auth/register', pub, async r => {
    const b=body(r), e=email(b.email), p=password(b.password), name=text(b.display_name,'显示名称',80);
    check(typeof b.challenge_id==='string' && /^[0-9a-f-]{36}$/.test(b.challenge_id),422,'INVALID_CODE','验证码无效');
    await rate(`verify:${r.ip}`,30,600);
    const hash=await argon2.hash(p);
    const success=await transaction(async db=> {
      if (!await consume(db,b,'register')) return false;
      const added=await db.query('INSERT INTO users(id,email,password_digest,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',[randomUUID(),e,hash,name]);
      return Boolean(added.rowCount);
    });
    check(success,422,'INVALID_CODE','验证码无效、已使用或账号已存在'); return { message:'注册成功，请登录' };
  });
  app.post('/auth/login',pub,async(r,reply)=>{
    const b=body(r), e=email(b.email); check(typeof b.password==='string' && b.password.length<=128,422,'INVALID_PASSWORD','密码格式无效');
    await rate(`login:ip:${r.ip}`,50,600); await rate(`login:${e}`,10,600);
    const u=(await pool.query('SELECT * FROM users WHERE email=$1',[e])).rows[0];
    const valid=await argon2.verify(u?.password_digest || dummy,b.password);
    check(u && valid && u.status==='active',401,'INVALID_LOGIN','邮箱或密码错误，或账号不可用');
    const t=token(), csrf=token();
    if(r.session) await pool.query('DELETE FROM auth_sessions WHERE session_digest=$1',[r.session.session_digest]);
    await pool.query("INSERT INTO auth_sessions VALUES($1,$2,$3,now()+$4*interval '1 second',now()+$5*interval '1 second',now())",[digest(t),u.id,csrf,Math.min(config.idle,config.absolute),config.absolute]);
    reply.setCookie(config.cookie,t,{...cookieOptions(),maxAge:config.absolute});
    return { user:{id:u.id,email:u.email,display_name:u.display_name,role:u.role},csrf };
  });
  app.get('/auth/me',async r=>({user:r.user,csrf:r.session!.csrf}));
  const logout=async(r:FastifyRequest,reply:FastifyReply,all=false)=>{
    await pool.query(all?'DELETE FROM auth_sessions WHERE user_id=$1':'DELETE FROM auth_sessions WHERE session_digest=$1',[all?uid(r):r.session!.session_digest]);
    reply.clearCookie(config.cookie,cookieOptions());return {message:'已退出'};
  };
  app.post('/auth/logout',(r,p)=>logout(r,p)); app.post('/auth/logout-all',(r,p)=>logout(r,p,true));
  app.post('/auth/reset-password',pub,async r=>{
    const b=body(r),e=email(b.email),hash=await argon2.hash(password(b.password));
    check(typeof b.challenge_id==='string' && /^[0-9a-f-]{36}$/.test(b.challenge_id),422,'INVALID_CODE','验证码无效');
    await rate(`verify:${r.ip}`,30,600);
    const success=await transaction(async db=>{
      if(!await consume(db,b,'reset_password'))return false;
      const u=(await db.query('UPDATE users SET password_digest=$1 WHERE email=$2 RETURNING id',[hash,e])).rows[0];
      if(u)await db.query('DELETE FROM auth_sessions WHERE user_id=$1',[u.id]); return Boolean(u);
    });
    check(success,422,'INVALID_CODE','验证码无效或已过期'); return {message:'密码已重置，请重新登录'};
  });
  app.post('/auth/change-password',async(r,p)=>{
    const b=body(r),hash=await argon2.hash(password(b.password));
    const u=(await pool.query('SELECT password_digest FROM users WHERE id=$1',[uid(r)])).rows[0];
    check(typeof b.old_password==='string' && await argon2.verify(u.password_digest,b.old_password),401,'INVALID_PASSWORD','当前密码错误');
    await transaction(async db=>{await db.query('UPDATE users SET password_digest=$1 WHERE id=$2',[hash,uid(r)]);await db.query('DELETE FROM auth_sessions WHERE user_id=$1',[uid(r)]);});
    p.clearCookie(config.cookie,cookieOptions());return {message:'密码已修改，请重新登录'};
  });
}
