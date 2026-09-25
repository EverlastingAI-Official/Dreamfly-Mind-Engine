import type { FastifyInstance } from 'fastify';
import { rate, uid } from '../auth.js';
import { decrypt } from '../crypto.js';
import { pool } from '../db.js';
import { body, check, params, text } from '../errors.js';
import { bodies } from './schemas.js';
import { profile, profileView, saveModelProfile } from '../services/model-profiles.js';
import {
  listModels,
  providers,
  streamChat,
  type ModelListTransport,
} from '../services/model-provider.js';
import type { ModelProfile, ModelProfileInput } from '../types.js';
export async function providerRoutes(
  app: FastifyInstance,
  discover: ModelListTransport = listModels,
) {
  app.get('/model-providers', async () => providers);
  app.post(
    '/model-providers/:id/models',
    { schema: { body: bodies.discoverModels } },
    async (r) => {
      const user = uid(r),
        b = body<{ api_key?: string; profile_id?: string }>(r);
      await rate(`model-list:${user}`, 10, 60);
      const preset = providers.find((p) => p.id === params(r).id);
      check(preset, 422, 'INVALID_PROVIDER', '未知厂商');
      const saved = b.profile_id ? await profile(user, b.profile_id) : null;
      const matching = saved?.provider === preset.id ? saved : null;
      check(preset.id !== 'custom' || matching, 422, 'INVALID_PROVIDER', '请选择预设厂商');
      const key = b.api_key
        ? text(b.api_key, 'API Key', 4096)
        : matching?.key_cipher
          ? decrypt(matching.key_cipher, `${user}:${matching.id}`)
          : '';
      check(key, 422, 'NO_KEY', '请先输入 API Key，再获取模型列表');
      const endpoint =
        preset.id === 'custom'
          ? matching!
          : { provider: preset.id, protocol: preset.protocol, base_url: preset.base_url };
      return discover(endpoint, key);
    },
  );
  app.get('/model-profiles', async (r) => ({
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
  app.post('/model-profiles', { schema: { body: bodies.modelProfile } }, (r) =>
    saveModelProfile(uid(r), body<ModelProfileInput>(r)),
  );
  app.patch('/model-profiles/:id', { schema: { body: bodies.modelProfileUpdate } }, async (r) =>
    saveModelProfile(uid(r), body<ModelProfileInput>(r), await profile(uid(r), params(r).id)),
  );
  app.delete('/model-profiles/:id', async (r) => {
    await profile(uid(r), params(r).id);
    await pool.query('DELETE FROM model_profiles WHERE id=$1 AND user_id=$2', [
      params(r).id,
      uid(r),
    ]);
    return { deleted: true };
  });
  app.put(
    '/users/me/default-model-profile',
    { schema: { body: bodies.defaultProfile } },
    async (r) => {
      const p = await profile(uid(r), body<{ profile_id: string }>(r).profile_id);
      check(
        p.key_cipher && p.consent && p.verified_at,
        422,
        'UNVERIFIED_PROFILE',
        '请先确认数据发送范围并测试连接',
      );
      await pool.query(
        'INSERT INTO user_preferences VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_profile_id=$2',
        [uid(r), p.id],
      );
      return { profile_id: p.id };
    },
  );
  app.post('/model-profiles/:id/test', async (r) => {
    await rate(`model-test:${uid(r)}`, 10, 60);
    const p = await profile(uid(r), params(r).id);
    check(p.key_cipher && p.consent, 422, 'PROFILE_NOT_READY', '请输入密钥并确认发送文本至该厂商');
    let count = 0;
    for await (const e of streamChat(
      { ...p, parameters: { ...p.parameters, max_tokens: 32 } },
      [{ role: 'user', content: 'Reply with OK.' }],
      new AbortController().signal,
    ))
      if (e.delta) count += e.delta.length;
    check(count, 502, 'NO_TEXT', '未返回文本');
    await pool.query('UPDATE model_profiles SET verified_at=now() WHERE id=$1', [p.id]);
    return { verified: true };
  });
  app.post('/model-profiles/:id/models', async (r) => {
    await rate(`model-list:${uid(r)}`, 10, 60);
    const p = await profile(uid(r), params(r).id);
    check(p.key_cipher, 422, 'NO_KEY', '请输入 API Key');
    return discover(p, decrypt(p.key_cipher, `${p.user_id}:${p.id}`));
  });
}
