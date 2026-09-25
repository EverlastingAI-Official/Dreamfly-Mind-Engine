import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { digest, equal } from './crypto.js';
import { pool } from './db.js';
import { check } from './errors.js';
import { allowedOrigins } from './origins.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string; display_name: string; role: string };
    session?: { csrf: string; session_digest: string };
  }
  interface FastifyContextConfig {
    public?: boolean;
    webhook?: boolean;
  }
}
export const uid = (r: FastifyRequest) => {
  check(r.user, 401, 'LOGIN_REQUIRED', '请先登录');
  return r.user.id;
};
export function admin(r: FastifyRequest) {
  uid(r);
  check(r.user!.role === 'admin', 403, 'FORBIDDEN', '需要管理员权限');
}
export async function rate(key: string, max: number, seconds: number) {
  const { rows } = await pool.query(
    `INSERT INTO rate_limits VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  check(rows[0].count <= max, 429, 'RATE_LIMIT', '请求过于频繁，请稍后再试');
}
export async function auth(app: FastifyInstance) {
  const origins = allowedOrigins(config.origin, config.production);
  app.decorateRequest('user', undefined);
  app.decorateRequest('session', undefined);
  app.addHook('onRequest', async (r) => {
    const t = r.cookies[config.cookie];
    if (t) {
      const { rows } = await pool.query(
        `UPDATE auth_sessions s SET expires_at=LEAST(s.absolute_expires_at,now()+$2*interval '1 second')
        FROM users u WHERE s.session_digest=$1 AND s.user_id=u.id AND u.status='active'
        AND s.expires_at>now() AND s.absolute_expires_at>now() RETURNING u.id,u.email,u.display_name,u.role,s.csrf,s.session_digest`,
        [digest(t), config.idle],
      );
      if (rows[0]) {
        const u = rows[0];
        r.user = { id: u.id, email: u.email, display_name: u.display_name, role: u.role };
        r.session = { csrf: u.csrf, session_digest: u.session_digest };
      }
    }
    if (!r.routeOptions.config.public && !r.routeOptions.config.webhook) uid(r);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method) && !r.routeOptions.config.webhook) {
      check(origins.has(r.headers.origin || ''), 403, 'ORIGIN_REJECTED', '请求来源不被允许');
      if (!r.routeOptions.config.public)
        check(
          r.session && equal(String(r.headers['x-csrf-token'] || ''), r.session.csrf),
          403,
          'CSRF_REJECTED',
          '会话校验失败，请刷新重试',
        );
    }
  });
}
