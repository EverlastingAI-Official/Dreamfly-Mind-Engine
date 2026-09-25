import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { encrypt } from '../crypto.js';
import { pool } from '../db.js';
import { check, id, text } from '../errors.js';
import type { ModelParameters, ModelProfile, ModelProfileInput } from '../types.js';
import { checkedURL, providers } from './model-provider.js';
export async function profile(user: string, profileId: string) {
  const p = (
    await pool.query<ModelProfile>('SELECT * FROM model_profiles WHERE id=$1 AND user_id=$2', [
      id(profileId),
      user,
    ])
  ).rows[0];
  check(p, 404, 'NOT_FOUND', '未找到模型配置');
  return p;
}
export const profileView = (p: ModelProfile) => ({
  id: p.id,
  name: p.name,
  provider: p.provider,
  protocol: p.protocol,
  base_url: p.base_url,
  model: p.model,
  parameters: p.parameters,
  consent: p.consent,
  verified_at: p.verified_at,
  api_key_configured: !!p.key_cipher,
});
export function snapshot(p: ModelProfile) {
  return {
    provider: p.provider,
    protocol: p.protocol,
    base_url: p.base_url,
    model: p.model,
    parameters: p.parameters,
  };
}
export async function saveModelProfile(
  user: string,
  b: ModelProfileInput,
  existing?: ModelProfile,
) {
  const profileId = existing?.id || randomUUID();
  const preset = providers.find((x) => x.id === b.provider);
  check(preset, 422, 'INVALID_PROVIDER', '未知厂商');
  const protocol = preset.id === 'custom' ? b.protocol : preset.protocol;
  check(
    ['openai-chat', 'anthropic-messages', 'gemini-generate-content'].includes(protocol),
    422,
    'INVALID_PROTOCOL',
    '不支持的协议',
  );
  const base =
    preset.id === 'custom' ? text(b.base_url, 'API 地址', 500).replace(/\/$/, '') : preset.base_url;
  if (preset.id === 'custom') await checkedURL(base);
  const values = b.parameters || {};
  const timeout = Number(values.timeout_seconds || config.modelTimeout),
    max = Number(values.max_tokens || 1024),
    context = Number(values.context_chars || 24000);
  check(
    Number.isFinite(timeout) &&
      timeout >= 10 &&
      timeout <= 600 &&
      Number.isInteger(max) &&
      max >= 16 &&
      max <= 16384,
    422,
    'INVALID_PARAMETERS',
    '超时 10–600 秒，输出上限 16–16384',
  );
  check(
    Number.isInteger(context) && context >= 4000 && context <= 200000,
    422,
    'INVALID_PARAMETERS',
    '输入字符预算须为 4000–200000',
  );
  const parameters: ModelParameters = {
    timeout_seconds: timeout,
    max_tokens: max,
    context_chars: context,
  };
  if (values.temperature !== undefined) {
    check(
      Number.isFinite(Number(values.temperature)) &&
        Number(values.temperature) >= 0 &&
        Number(values.temperature) <= 2,
      422,
      'INVALID_PARAMETERS',
      'temperature 须为 0–2',
    );
    parameters.temperature = Number(values.temperature);
  }
  let cipher = existing?.key_cipher;
  const changed = existing && (existing.base_url !== base || existing.provider !== b.provider);
  if (changed) cipher = null;
  const action = b.api_key_action || 'keep';
  check(['keep', 'replace', 'clear'].includes(action), 422, 'INVALID_KEY_ACTION', '无效的密钥操作');
  if (action === 'clear') cipher = null;
  if (action === 'replace')
    cipher = encrypt(text(b.api_key, 'API Key', 4096), `${user}:${profileId}`);
  const name = text(b.name, '连接名称', 100),
    model = text(b.model, '模型 ID', 200);
  const consent = b.consent === true;
  if (existing)
    await pool.query(
      'UPDATE model_profiles SET name=$1,provider=$2,protocol=$3,base_url=$4,model=$5,parameters=$6,key_cipher=$7,consent=$8,verified_at=NULL WHERE id=$9 AND user_id=$10',
      [name, b.provider, protocol, base, model, parameters, cipher, consent, profileId, user],
    );
  else
    await pool.query(
      'INSERT INTO model_profiles(id,user_id,name,provider,protocol,base_url,model,parameters,key_cipher,consent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [profileId, user, name, b.provider, protocol, base, model, parameters, cipher, consent],
    );
  return profileView(await profile(user, profileId));
}
