import type { ApiRoute } from '../../../packages/api/index.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { admin, uid } from '../auth.js';
import { pool, transaction } from '../db.js';
import { check, id, params } from '../errors.js';
import { bodies } from '../../../packages/api/schemas.js';
export async function adminRoutes(app: FastifyInstance) {
  app.get<ApiRoute<'GET /admin/users'>>('/admin/users', async (r) => {
    admin(r);
    return (
      await pool.query(
        'SELECT id,email,display_name,status,role FROM users ORDER BY created_at DESC LIMIT 100',
      )
    ).rows;
  });
  app.post<ApiRoute<'POST /admin/skills/:id/unpublish'>>(
    '/admin/skills/:id/unpublish',
    async (r) => {
      admin(r);
      await transaction(async (db) => {
        await db.query("UPDATE skills SET status='blocked' WHERE id=$1", [id(params(r).id)]);
        await db.query(
          'INSERT INTO admin_events(id,user_id,action,resource_id) VALUES($1,$2,$3,$4)',
          [randomUUID(), uid(r), 'unpublish', params(r).id],
        );
      });
      return { unpublished: true };
    },
  );
  app.patch<ApiRoute<'PATCH /admin/users/:id/status'>>(
    '/admin/users/:id/status',
    { schema: { body: bodies.userStatus } },
    async (r) => {
      admin(r);
      const status = r.body.status;
      check(['active', 'disabled'].includes(status) && params(r).id !== uid(r), 'INVALID_STATUS');
      await transaction(async (db) => {
        await db.query('UPDATE users SET status=$1 WHERE id=$2', [status, id(params(r).id)]);
        await db.query('DELETE FROM auth_sessions WHERE user_id=$1', [params(r).id]);
        await db.query(
          'INSERT INTO admin_events(id,user_id,action,resource_id) VALUES($1,$2,$3,$4)',
          [randomUUID(), uid(r), status, params(r).id],
        );
      });
      return { status };
    },
  );
}
