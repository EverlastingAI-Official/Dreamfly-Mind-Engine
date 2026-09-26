import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';
import { errorInfo, isErrorCode } from '../../packages/api/errors.js';

// Run the real startup and error handling code, replacing only browser/API dependencies.
function loadModule(path, names, dependencies) {
  const source = readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8')
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/export /g, '');
  return new Function(...Object.keys(dependencies), source + `\nreturn { ${names} };`)(
    ...Object.values(dependencies),
  );
}
const { publicError, locale } = loadModule('services/locale.js', 'publicError, locale', {
  ref,
  watch() {},
  uni: { getStorageSync: () => 'zh' },
  errorInfo,
  isErrorCode,
});
const skill = { id: 'skill-id', published_version_id: 'version-id' };
function startup(api, navigate = async () => {}) {
  const { startChat } = loadModule('services/skillActions.js', 'startChat', {
    api,
    auth: { user: { id: 'owner' } },
    navigate,
  });
  return loadModule('composables/useStartChat.js', 'useStartChat', {
    ref,
    startChat,
    publicError,
  }).useStartChat();
}

for (const code of ['NO_PROFILE', 'PROFILE_NOT_READY', 'NETWORK_ERROR']) {
  test(`startup reports ${code} and allows retry`, async () => {
    let fail = true;
    const destinations = [];
    const state = startup(
      async (path, options) => {
        assert.equal(path, '/mindcopies/skill-id/sessions');
        assert.deepEqual(options, {
          method: 'POST',
          body: { version_id: 'version-id', profile_id: 'connection-id' },
        });
        if (fail) throw Object.assign(new Error(errorInfo(code).zh), { code });
        return { id: 'conversation-id' };
      },
      async (...args) => destinations.push(args),
    );
    await state.beginChat(skill, 'connection-id');
    assert.equal(state.startError.value, errorInfo(code).zh);
    assert.equal(state.starting.value, false);
    assert.deepEqual(destinations, []);
    fail = false;
    await state.beginChat(skill, 'connection-id');
    assert.equal(state.startError.value, '');
    assert.equal(state.starting.value, false);
    assert.deepEqual(destinations, [['chat', { id: 'conversation-id' }]]);
  });
}

test('navigation rejection with errMsg remains visible instead of an empty notice', async () => {
  const state = startup(
    async () => ({ id: 'conversation-id' }),
    async () => {
      throw { errMsg: 'navigateTo:fail 页面无法打开' };
    },
  );
  await state.beginChat(skill);
  assert.equal(state.startError.value, 'navigateTo:fail 页面无法打开');
  assert.equal(state.starting.value, false);
});

test('startup stays busy until navigation finishes and ignores repeated clicks', async () => {
  let finishNavigation;
  const navigationFinished = new Promise((resolve) => {
    finishNavigation = resolve;
  });
  let calls = 0;
  const state = startup(
    async () => {
      calls++;
      return { id: 'conversation-id' };
    },
    () => navigationFinished,
  );
  const first = state.beginChat(skill);
  await state.beginChat(skill);
  assert.equal(state.starting.value, true);
  assert.equal(calls, 1);
  finishNavigation();
  await first;
  assert.equal(state.starting.value, false);
});

test('unstructured errors have a nonempty fallback in both supported languages', () => {
  for (const language of ['zh', 'en']) {
    locale.value = language;
    assert.equal(publicError({}), errorInfo('HTTP_ERROR')[language]);
  }
  locale.value = 'zh';
});
