import type { ApiRoute } from '../../../packages/api/index.js';
import type { FastifyInstance } from 'fastify';
import { rate, uid } from '../auth.js';
import { decrypt } from '../crypto.js';
import { pool } from '../db.js';
import { check, params, text } from '../errors.js';
import { bodies } from '../../../packages/api/schemas.js';
import { profile, profileView, saveModelProfile } from '../services/model-profiles.js';
import {
  listModels,
  providers,
  streamChat,
  type ModelListTransport,
} from '../services/model-provider.js';
import type { ModelProfile } from '../types.js';
export async function providerRoutes(
  app: FastifyInstance,
  discover: ModelListTransport = listModels,
) {
  app.get<ApiRoute<'GET /model-providers'>>('/model-providers', async () => providers);
  app.post<ApiRoute<'POST /model-providers/:id/models'>>(
    '/model-providers/:id/models',
    { schema: { body: bodies.discoverModels } },
    async (r) => {
      const user = uid(r),
        b = r.body;
      await rate(`model-list:${user}`, 10, 60);
      const preset = providers.find((p) => p.id === params(r).id);
      check(preset, 'INVALID_PROVIDER');
      const saved = b.profile_id ? await profile(user, b.profile_id) : null;
      const matching = saved?.provider === preset.id ? saved : null;
      check(preset.id !== 'custom' || matching, 'INVALID_PROVIDER', '请选择预设厂商');
      const key = b.api_key
        ? text(b.api_key, 'API Key', 4096)
        : matching?.key_cipher
          ? decrypt(matching.key_cipher, `${user}:${matching.id}`)
          : '';
      check(key, 'NO_KEY');
      const endpoint =
        preset.id === 'custom'
          ? matching!
          : { provider: preset.id, protocol: preset.protocol, base_url: preset.base_url };
      return discover(endpoint, key);
    },
  );
  app.get<ApiRoute<'GET /model-profiles'>>('/model-profiles', async (r) => ({
    profiles: (
      await pool.query<ModelProfile>(
        'SELECT * FROM model_profiles WHERE user_id=$1 ORDER BY created_at',
        [uid(r)],
      )
    ).rows.map(profileView),
    default_profile_id:
      (
        await pool.query('SELECT default_profile_id FROM user_preferences WHERE user_id=$1', [
          uid(r),
        ])
      ).rows[0]?.default_profile_id || null,
  }));
  app.post<ApiRoute<'POST /model-profiles'>>(
    '/model-profiles',
    { schema: { body: bodies.modelProfile } },
    (r) => saveModelProfile(uid(r), r.body),
  );
  app.patch<ApiRoute<'PATCH /model-profiles/:id'>>(
    '/model-profiles/:id',
    { schema: { body: bodies.modelProfileUpdate } },
    async (r) => saveModelProfile(uid(r), r.body, await profile(uid(r), params(r).id)),
  );
  app.delete<ApiRoute<'DELETE /model-profiles/:id'>>('/model-profiles/:id', async (r) => {
    await profile(uid(r), params(r).id);
    await pool.query('DELETE FROM model_profiles WHERE id=$1 AND user_id=$2', [
      params(r).id,
      uid(r),
    ]);
    return { deleted: true };
  });
  app.put<ApiRoute<'PUT /users/me/default-model-profile'>>(
    '/users/me/default-model-profile',
    { schema: { body: bodies.defaultProfile } },
    async (r) => {
      const p = await profile(uid(r), r.body.profile_id);
      check(
        p.key_cipher && p.consent && p.verified_at,
        'PROFILE_NOT_READY',
        '请先确认数据发送范围并测试连接',
      );
      await pool.query(
        'INSERT INTO user_preferences VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_profile_id=$2',
        [uid(r), p.id],
      );
      return { profile_id: p.id };
    },
  );
  app.post<ApiRoute<'POST /model-profiles/:id/test'>>('/model-profiles/:id/test', async (r) => {
    await rate(`model-test:${uid(r)}`, 10, 60);
    const p = await profile(uid(r), params(r).id);
    check(p.key_cipher && p.consent, 'PROFILE_NOT_READY');
    let count = 0;
    for await (const e of streamChat(
      { ...p, parameters: { ...p.parameters, max_tokens: 32 } },
      [{ role: 'user', content: 'Reply with OK.' }],
      new AbortController().signal,
    ))
      if (e.delta) count += e.delta.length;
    check(count, 'NO_TEXT');
    await pool.query('UPDATE model_profiles SET verified_at=now() WHERE id=$1', [p.id]);
    return { verified: true };
  });
  app.post<ApiRoute<'POST /model-profiles/:id/models'>>('/model-profiles/:id/models', async (r) => {
    await rate(`model-list:${uid(r)}`, 10, 60);
    const p = await profile(uid(r), params(r).id);
    check(p.key_cipher, 'NO_KEY', '请输入 API Key');
    return discover(p, decrypt(p.key_cipher, `${p.user_id}:${p.id}`));
  });
}
