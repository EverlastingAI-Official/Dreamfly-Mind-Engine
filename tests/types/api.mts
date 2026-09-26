import { api } from '../../src/services/platform.js';
import { createClient } from '../../src/services/http.mjs';
import type { ModelProfileDto, SessionDto, PublicSkillDto } from '../../packages/api/index.js';

// Compile-only regressions: methods, route segments and writable fields must agree.
const session: Promise<SessionDto> = api('/auth/login', {
  method: 'POST',
  body: { email: 'user@example.test', password: 'example123' },
});
const profiles = await api('/model-profiles');
const profile: ModelProfileDto = profiles.profiles[0];
const id: string = 'resource-id';
const publicSkill: PublicSkillDto = await api(`/skills/${id}/public`);
const history = await api(`/conversations/${id}/messages`);
const content: string = history[0].content;
const list = await api('/skills?page=2');
const total: number = list.total;
await api(`/skills/${id}/export?version=1`, { download: true });
// @ts-expect-error A mutation must include its required DTO fields.
api('/auth/login', { method: 'POST', body: { email: 'user@example.test' } });
api('/model-profiles', {
  method: 'POST',
  // @ts-expect-error Server verification fields cannot be submitted as profile input.
  body: { name: 'Test', provider: 'deepseek', model: 'test', verified_at: 'forged' },
});
// @ts-expect-error Database secrets are not public profile fields.
profile.key_cipher;
// @ts-expect-error Unknown endpoints should not silently return any.
api('/does-not-exist');
// @ts-expect-error Password confirmation is a UI field, not a login field.
api('/auth/login', { method: 'POST', body: { email: '', password: '', confirm: '' } });
// @ts-expect-error DELETE is not a valid method for this route.
api('/auth/me', { method: 'DELETE' });
const client = createClient({
  base: '',
  session: () => ({ user: null, csrf: '' }),
  clearSession() {},
});
client.sendMessage(id, 'hello', (event, data) => {
  if (event === 'message.failed') {
    const code: string = data.error.code;
    const requestId: string = data.request_id;
  }
});
