import { api, auth, chooseFile } from './platform.js';
import { navigate, pageUrl, signIn, stageImport } from './navigation.mjs';
import { copyText, tr } from './locale.js';

export const newSkill = () => navigate('new');
export const openSkill = (id) => navigate('edit', { id });
export async function importSkill() {
  if (!auth.user) return signIn(pageUrl('new'));
  const file = await chooseFile('.mind,.js,.json,.md,.zip');
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const owner = auth.user.id;
  const result = await api('/skills/import', { method: 'POST', body: form });
  if (auth.user?.id !== owner) return;
  stageImport(result, owner);
  await newSkill();
}
export async function startChat(skill, profileId) {
  if (!auth.user) return signIn(pageUrl('detail', { id: skill.id }));
  const result = await api(`/mindcopies/${skill.id}/sessions`, {
    method: 'POST',
    body: {
      version_id: skill.published_version_id,
      ...(profileId ? { profile_id: profileId } : {}),
    },
  });
  await navigate('chat', { id: result.id });
}
export async function copySkill(value, notify) {
  await copyText(value);
  notify(tr('已复制，可分享给其他人。', 'Copied. Ready to share.'));
}
