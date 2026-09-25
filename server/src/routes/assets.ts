import type { FastifyInstance } from 'fastify';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { uid } from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { check, HttpError, id, params } from '../errors.js';
import { assetId, media, storeAsset } from '../services/assets.js';
import { accessibleVersion } from '../services/skills.js';
export async function assetRoutes(app: FastifyInstance) {
  app.post('/assets', async (r) => {
    const f = await r.file();
    check(f, 422, 'NO_FILE', '请选择素材');
    const data = await f.toBuffer(),
      kind = (f.fields.kind as { value?: unknown })?.value;
    if (kind !== undefined) {
      check(
        kind === 'image' || kind === 'audio',
        422,
        'INVALID_ASSET_KIND',
        '请选择图片或声音素材',
      );
      check(
        media(data)[0].startsWith(`${kind}/`),
        422,
        'ASSET_KIND_MISMATCH',
        kind === 'image' ? '此入口仅接受图片' : '此入口仅接受声音',
      );
    }
    return storeAsset(uid(r), f.filename, data);
  });
  app.get(
    '/assets',
    async (r) =>
      (
        await pool.query(
          'SELECT id,name,mime,size FROM assets WHERE user_id=$1 ORDER BY created_at DESC',
          [uid(r)],
        )
      ).rows,
  );
  app.get('/assets/:id', async (r, p) => {
    const a = (await pool.query('SELECT * FROM assets WHERE id=$1', [id(params(r).id)])).rows[0];
    check(a, 404, 'NOT_FOUND', '素材不存在');
    if (a.user_id !== uid(r)) {
      const versions = (
        await pool.query('SELECT version_id FROM version_assets WHERE asset_id=$1', [a.id])
      ).rows;
      let allowed = false;
      for (const v of versions) {
        try {
          const x = await accessibleVersion(v.version_id, uid(r), 'download');
          if (Object.values(x.content.assets).some((ref) => assetId(ref) === a.id)) allowed = true;
        } catch (error) {
          if (!(error instanceof HttpError && error.statusCode === 404)) throw error;
        }
      }
      check(allowed, 404, 'NOT_FOUND', '素材不存在');
    }
    return p
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(a.mime)
      .send(await readFile(path.join(config.assets, a.id)));
  });
  app.delete('/assets/:id', async (r) => {
    const a = id(params(r).id);
    check(
      !(await pool.query('SELECT 1 FROM version_assets WHERE asset_id=$1', [a])).rowCount,
      409,
      'ASSET_IN_USE',
      '发布版本仍在引用此素材',
    );
    check(
      !(
        await pool.query('SELECT 1 FROM skills WHERE owner_id=$1 AND draft::text LIKE $2', [
          uid(r),
          `%${a}%`,
        ])
      ).rowCount,
      409,
      'ASSET_IN_USE',
      '草稿仍在引用此素材',
    );
    const deleted = await pool.query('DELETE FROM assets WHERE id=$1 AND user_id=$2 RETURNING id', [
      a,
      uid(r),
    ]);
    check(deleted.rowCount, 404, 'NOT_FOUND', '素材不存在');
    await unlink(path.join(config.assets, a));
    return { deleted: true };
  });
}
