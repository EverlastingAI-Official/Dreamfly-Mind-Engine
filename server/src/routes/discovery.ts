import type { ApiRoute } from '../../../packages/api/index.js';
import type { FastifyInstance } from 'fastify';
import { uid } from '../auth.js';
import { pool, transaction } from '../db.js';
import { check, id, params, query } from '../errors.js';
import { bodies } from '../../../packages/api/schemas.js';

import { publicSkill, reactions, reactionState, visible } from '../services/discovery.js';
export async function discoveryRoutes(app: FastifyInstance) {
  app.get<ApiRoute<'GET /skills'>>('/skills', { config: { public: true } }, async (r) => {
    const q = query(r),
      scope = q.scope || 'public',
      collection = q.collection || 'all',
      sort = q.sort || 'newest';
    check(
      ['public', 'mine'].includes(scope) &&
        ['all', 'liked', 'favorites'].includes(collection) &&
        ['newest', 'oldest', 'name', 'likes'].includes(sort),
      'INVALID_QUERY',
    );
    const mine = scope === 'mine',
      user = mine || collection !== 'all' ? uid(r) : r.user?.id || null;
    const page = Number(q.page || 1),
      size = Number(q.page_size || 24);
    check(
      Number.isSafeInteger(page) &&
        page > 0 &&
        page <= 1000000 &&
        Number.isInteger(size) &&
        size > 0 &&
        size <= 100,
      'INVALID_QUERY',
      '分页参数无效',
    );
    check(!q.language || ['zh', 'en'].includes(q.language), 'INVALID_QUERY', '语言筛选无效');
    for (const key of ['download', 'chat'])
      check(
        q[key] === undefined || ['true', 'false'].includes(q[key]),
        'INVALID_QUERY',
        '权限筛选无效',
      );
    const term = (q.search || '').trim().slice(0, 200);
    const name = mine ? 's.name' : "v.content->>'name'",
      description = mine ? 's.description' : "v.content->>'description'";
    const language = mine ? "s.draft->>'language'" : "v.content->>'language'";
    const avatar = mine ? "s.draft->>'avatar_id'" : "v.content->>'avatar_id'";
    const values: unknown[] = [user];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const where = [mine ? 's.owner_id=$1::uuid' : visible];
    if (term) {
      const literal = term.replace(/[\\%_]/g, '\\$&');
      const match = add(`%${literal}%`),
        prefix = add(`${literal}%`);
      where.push(
        `((${name}) ILIKE ${match} OR (${description}) ILIKE ${match} OR u.display_name ILIKE ${match} OR s.id::text ILIKE ${prefix} OR s.slug ILIKE ${prefix})`,
      );
    }
    if (q.language) where.push(`split_part(lower(${language}),'-',1)=${add(q.language)}`);
    for (const key of ['download', 'chat'])
      if (q[key] !== undefined)
        where.push(`COALESCE((s.publication->>'${key}')::boolean,false)=${add(q[key] === 'true')}`);
    if (collection !== 'all')
      where.push(
        `EXISTS(SELECT 1 FROM skill_reactions WHERE skill_id=s.id AND user_id=$1::uuid AND kind=${add(collection === 'liked' ? 'like' : 'favorite')})`,
      );
    const time = mine ? 's.updated_at' : 'v.created_at';
    const order =
      sort === 'name'
        ? 'name ASC'
        : sort === 'likes'
          ? 'like_count DESC'
          : `${time} ${sort === 'oldest' ? 'ASC' : 'DESC'}`;
    // One snapshot for both total and rows, including empty/out-of-range pages.
    const result = (
      await pool.query(
        `WITH matches AS (
      SELECT s.id,s.slug,${name} AS name,${description} AS description,s.status,s.published_version_id,
      u.display_name AS author,${language} AS language,${avatar} AS avatar_id,v.version,${time} AS listed_at,
      jsonb_build_object('listed',COALESCE((s.publication->>'listed')::boolean,false),'chat',COALESCE((s.publication->>'chat')::boolean,false),'download',COALESCE((s.publication->>'download')::boolean,false)) AS publication,
      ${reactions},row_number() OVER(ORDER BY ${sort === 'name' ? `(${name}) ASC` : sort === 'likes' ? "(SELECT count(*) FROM skill_reactions WHERE skill_id=s.id AND kind='like') DESC" : order},s.id) AS position
      FROM skills s JOIN users u ON u.id=s.owner_id LEFT JOIN skill_versions v ON v.id=s.published_version_id
      WHERE ${where.join(' AND ')}
    ) SELECT (SELECT count(*)::int FROM matches) AS total,
      COALESCE((SELECT jsonb_agg(to_jsonb(item)-'position' ORDER BY item.position) FROM (SELECT * FROM matches ORDER BY position LIMIT ${add(size)} OFFSET ${add((page - 1) * size)}) item),'[]'::jsonb) AS items`,
        values,
      )
    ).rows[0];
    return { ...result, page, page_size: size };
  });
  app.get<ApiRoute<'GET /skills/:id/public'>>(
    '/skills/:id/public',
    { config: { public: true } },
    async (r) => publicSkill(id(params(r).id), r.user?.id || null),
  );
  app.put<ApiRoute<'PUT /skills/:id/reactions/:kind'>>(
    '/skills/:id/reactions/:kind',
    { schema: { body: bodies.reaction } },
    async (r) => {
      const user = uid(r),
        skill = id(params(r).id),
        kind = params(r).kind,
        active = r.body.active;
      check(
        ['like', 'favorite'].includes(kind) && typeof active === 'boolean',
        'INVALID_QUERY',
        '反馈类型或状态无效',
      );
      return transaction(async (db) => {
        const row = (
          await db.query(
            `SELECT s.id FROM skills s JOIN users u ON u.id=s.owner_id WHERE s.id=$1 AND ${visible} FOR SHARE OF s,u`,
            [skill],
          )
        ).rows[0];
        check(row || !active, 'NOT_FOUND', 'Skill 不存在或已下架');
        if (active)
          await db.query(
            'INSERT INTO skill_reactions(user_id,skill_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [user, skill, kind],
          );
        else
          await db.query(
            'DELETE FROM skill_reactions WHERE user_id=$1 AND skill_id=$2 AND kind=$3',
            [user, skill, kind],
          );
        return (
          (await reactionState(skill, user, db)) || {
            like_count: 0,
            liked: false,
            favorited: false,
          }
        );
      });
    },
  );
}
