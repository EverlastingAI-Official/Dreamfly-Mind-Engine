import type { ApiRoute } from '../../../packages/api/index.js';
import type { VerificationRequest } from '../../../packages/api/requests.js';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomInt, randomUUID } from 'node:crypto';
import { rate, uid } from '../auth.js';
import { config } from '../config.js';
import { codeDigest, digest, encrypt, equal, token } from '../crypto.js';
import { pool, transaction, type DB } from '../db.js';
import { check, text } from '../errors.js';
import { bodies } from '../../../packages/api/schemas.js';

const email = (v: unknown) => {
  const e = text(v, '邮箱', 254).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 'INVALID_EMAIL');
  return e;
};
function password(v: unknown): string {
  check(
    typeof v === 'string' &&
      v.length >= 8 &&
      v.length <= 128 &&
      /[A-Za-z]/.test(v) &&
      /[0-9]/.test(v),
    'INVALID_PASSWORD',
  );
  return v;
}
const cookieOptions = () => ({
  path: '/',
  httpOnly: true,
  secure: config.production,
  sameSite: 'lax' as const,
});
async function consume(db: DB, b: VerificationRequest, purpose: string) {
  const { rows } = await db.query(
    'SELECT * FROM email_challenges WHERE id=$1 AND email=$2 AND purpose=$3 FOR UPDATE',
    [b.challenge_id, email(b.email), purpose],
  );
  const c = rows[0];
  if (!c || c.consumed_at || c.expires_at <= new Date() || c.attempts >= config.attempts)
    return false;
  await db.query('UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1', [c.id]);
  if (!equal(c.code_digest, codeDigest(`${c.id}:${c.email}:${purpose}:${b.code}`))) return false;
  await db.query('UPDATE email_challenges SET consumed_at=now() WHERE id=$1', [c.id]);
  return true;
}
export async function authRoutes(app: FastifyInstance) {
  const dummy = await argon2.hash(token());
  const pub = { config: { public: true } };
  app.post<ApiRoute<'POST /auth/email-codes'>>(
    '/auth/email-codes',
    { ...pub, schema: { body: bodies.emailCode } },
    async (r) => {
      const b = r.body,
        e = email(b.email);
      check(['register', 'reset_password'].includes(b.purpose), 'INVALID_PURPOSE');
      await rate(`mail:ip:${r.ip}`, 20, 3600);
      await rate(`mail:${e}`, 1, config.resend);
      const challenge = randomUUID();
      const code = String(randomInt(100000, 1000000));
      await transaction(async (db) => {
        await db.query(
          'UPDATE email_challenges SET consumed_at=now() WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL',
          [e, b.purpose],
        );
        const exists = (
          await db.query('SELECT 1 FROM users WHERE email=$1 AND status=$2', [e, 'active'])
        ).rowCount;
        if ((b.purpose === 'register' && exists) || (b.purpose === 'reset_password' && !exists))
          return;
        await db.query(
          "INSERT INTO email_challenges(id,email,purpose,code_digest,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second')",
          [
            challenge,
            e,
            b.purpose,
            codeDigest(`${challenge}:${e}:${b.purpose}:${code}`),
            config.codeTTL,
          ],
        );
        await db.query("INSERT INTO jobs(id,type,payload) VALUES($1,'email',$2)", [
          randomUUID(),
          { challenge_id: challenge, code: encrypt(code, `email:${challenge}`) },
        ]);
      });
      return {
        challenge_id: challenge,
        message: '请求已受理，请检查邮箱',
        expires_in: config.codeTTL,
      };
    },
  );
  app.post<ApiRoute<'POST /auth/register'>>(
    '/auth/register',
    { ...pub, schema: { body: bodies.register } },
    async (r) => {
      const b = r.body,
        e = email(b.email),
        p = password(b.password),
        name = text(b.display_name, '显示名称', 80);
      check(
        typeof b.challenge_id === 'string' && /^[0-9a-f-]{36}$/.test(b.challenge_id),
        'INVALID_CODE',
      );
      await rate(`verify:${r.ip}`, 30, 600);
      const hash = await argon2.hash(p);
      const success = await transaction(async (db) => {
        if (!(await consume(db, b, 'register'))) return false;
        const added = await db.query(
          'INSERT INTO users(id,email,password_digest,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',
          [randomUUID(), e, hash, name],
        );
        return Boolean(added.rowCount);
      });
      check(success, 'INVALID_CODE', '验证码无效、已使用或账号已存在');
      return { message: '注册成功，请登录' };
    },
  );
  app.post<ApiRoute<'POST /auth/login'>>(
    '/auth/login',
    { ...pub, schema: { body: bodies.login } },
    async (r, reply) => {
      const b = r.body,
        e = email(b.email);
      check(
        typeof b.password === 'string' && b.password.length <= 128,
        'INVALID_PASSWORD',
        '密码格式无效',
      );
      await rate(`login:ip:${r.ip}`, 50, 600);
      await rate(`login:${e}`, 10, 600);
      const u = (await pool.query('SELECT * FROM users WHERE email=$1', [e])).rows[0];
      const valid = await argon2.verify(u?.password_digest || dummy, b.password);
      check(u && valid && u.status === 'active', 'INVALID_LOGIN');
      const t = token(),
        csrf = token();
      if (r.session)
        await pool.query('DELETE FROM auth_sessions WHERE session_digest=$1', [
          r.session.session_digest,
        ]);
      await pool.query(
        "INSERT INTO auth_sessions VALUES($1,$2,$3,now()+$4*interval '1 second',now()+$5*interval '1 second',now())",
        [digest(t), u.id, csrf, Math.min(config.idle, config.absolute), config.absolute],
      );
      reply.setCookie(config.cookie, t, { ...cookieOptions(), maxAge: config.absolute });
      return {
        user: { id: u.id, email: u.email, display_name: u.display_name, role: u.role },
        csrf,
      };
    },
  );
  app.get<ApiRoute<'GET /auth/me'>>('/auth/me', async (r) => ({
    user: r.user!,
    csrf: r.session!.csrf,
  }));
  const logout = async (r: FastifyRequest, reply: FastifyReply, all = false) => {
    await pool.query(
      all
        ? 'DELETE FROM auth_sessions WHERE user_id=$1'
        : 'DELETE FROM auth_sessions WHERE session_digest=$1',
      [all ? uid(r) : r.session!.session_digest],
    );
    reply.clearCookie(config.cookie, cookieOptions());
    return { message: '已退出' };
  };
  app.post<ApiRoute<'POST /auth/logout'>>('/auth/logout', (r, p) => logout(r, p));
  app.post<ApiRoute<'POST /auth/logout-all'>>('/auth/logout-all', (r, p) => logout(r, p, true));
  app.post<ApiRoute<'POST /auth/reset-password'>>(
    '/auth/reset-password',
    { ...pub, schema: { body: bodies.resetPassword } },
    async (r) => {
      const b = r.body,
        e = email(b.email),
        hash = await argon2.hash(password(b.password));
      check(
        typeof b.challenge_id === 'string' && /^[0-9a-f-]{36}$/.test(b.challenge_id),
        'INVALID_CODE',
      );
      await rate(`verify:${r.ip}`, 30, 600);
      const success = await transaction(async (db) => {
        if (!(await consume(db, b, 'reset_password'))) return false;
        const u = (
          await db.query('UPDATE users SET password_digest=$1 WHERE email=$2 RETURNING id', [
            hash,
            e,
          ])
        ).rows[0];
        if (u) await db.query('DELETE FROM auth_sessions WHERE user_id=$1', [u.id]);
        return Boolean(u);
      });
      check(success, 'INVALID_CODE', '验证码无效或已过期');
      return { message: '密码已重置，请重新登录' };
    },
  );
  app.post<ApiRoute<'POST /auth/change-password'>>(
    '/auth/change-password',
    { schema: { body: bodies.changePassword } },
    async (r, p) => {
      const b = r.body,
        hash = await argon2.hash(password(b.password));
      const u = (await pool.query('SELECT password_digest FROM users WHERE id=$1', [uid(r)]))
        .rows[0];
      check(
        typeof b.old_password === 'string' &&
          (await argon2.verify(u.password_digest, b.old_password)),
        'CURRENT_PASSWORD_INCORRECT',
      );
      await transaction(async (db) => {
        await db.query('UPDATE users SET password_digest=$1 WHERE id=$2', [hash, uid(r)]);
        await db.query('DELETE FROM auth_sessions WHERE user_id=$1', [uid(r)]);
      });
      p.clearCookie(config.cookie, cookieOptions());
      return { message: '密码已修改，请重新登录' };
    },
  );
}
