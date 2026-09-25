import { reactive } from 'vue';
import { createClient } from './http.mjs';

export const auth = reactive({ user: null, csrf: '' });
let sessionRevision = 0;
export function setSession(state) {
  sessionRevision++;
  Object.assign(auth, state);
}
export function clearSession() {
  setSession({ user: null, csrf: '' });
}
export const { api, sendMessage } = createClient({
  base: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  session: () => auth,
  clearSession,
});
let restoring;
export async function restoreSession() {
  if (restoring) return restoring;
  const revision = sessionRevision;
  restoring = api('/auth/me')
    .then((state) => {
      if (revision === sessionRevision) setSession(state);
    })
    .catch((error) => {
      if (error.code !== 'LOGIN_REQUIRED') throw error;
    })
    .finally(() => {
      restoring = null;
    });
  return restoring;
}
export function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
