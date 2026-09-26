import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { errorInfo, isErrorCode } from '../../packages/api/errors.js';
import {
  installNavigationHooks,
  navigate,
  takeNavigationFeedback,
} from '../../src/services/navigation.mjs';
const vueDependencies = Object.fromEntries(
  ['ref', 'computed', 'watch', 'nextTick', 'onScopeDispose', 'defineComponent', 'h', 'inject'].map(
    (name) => [name, Vue[name]],
  ),
);

function moduleSource(path) {
  return readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8');
}
function loadModule(path, names, dependencies) {
  const source = moduleSource(path)
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/export /g, '');
  return new Function(...Object.keys(dependencies), source + `\nreturn { ${names} };`)(
    ...Object.values(dependencies),
  );
}
const locale = loadModule('services/locale.js', 'publicError, tr', {
  ...vueDependencies,
  watch() {},
  uni: { getStorageSync: () => 'zh' },
  errorInfo,
  isErrorCode,
});
const pageUi = loadModule('composables/usePageUi.js', 'createPageUi, pageUiKey, usePageUi', {
  ...vueDependencies,
  ...locale,
});
const native = loadModule('components/native.js', 'NButton, NForm', {
  ...vueDependencies,
  ...locale,
  ...pageUi,
});
const { descriptor } = parse(moduleSource('components/ActionFeedback.vue'));
const source = compileScript(descriptor, { id: 'feedback-test', inlineTemplate: true })
  .content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, path) => {
    const dependency = path === 'vue' ? 'Vue' : `dependencies[${JSON.stringify(path)}]`;
    return `const ${bindings.replace(/\s+as\s+/g, ': ')} = ${dependency};`;
  })
  .replace('export default', 'return');
const Feedback = new Function('Vue', 'dependencies', source)(Vue, {
  '../composables/usePageUi.js': pageUi,
  '../services/locale.js': locale,
  './native.js': native,
});
function mount(component) {
  const node = (type, text = '') => ({ type, text, children: [], props: {}, parent: null });
  const renderer = Vue.createRenderer({
    createElement: node,
    createText: (text) => node('text', text),
    createComment: () => node('comment'),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, _previous, value) => {
      node.props[key] = value;
    },
    insert(child, parent, anchor) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      parent.children.splice(
        anchor ? parent.children.indexOf(anchor) : parent.children.length,
        0,
        child,
      );
      child.parent = parent;
    },
    remove(child) {
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    },
  });
  const root = node('root'),
    app = renderer.createApp(component);
  app.mount(root);
  return { root, app };
}
const text = (node) => node.text + node.children.map(text).join('');
const find = (node, predicate) =>
  predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);

for (const [Control, eventName] of [
  [native.NButton, 'onClick'],
  [native.NForm, 'onSubmit'],
]) {
  test(`${eventName} shows pending feedback, catches rejection, and can retry`, async () => {
    const ui = pageUi.createPageUi();
    let reject,
      calls = 0;
    const task = new Promise((_resolve, fail) => {
      reject = fail;
    });
    const { root, app } = mount({
      setup() {
        Vue.provide(pageUi.pageUiKey, ui);
        return () =>
          Vue.h('main', [
            Vue.h(
              Control,
              {
                [eventName]: () => {
                  calls++;
                  return task;
                },
              },
              () => '执行',
            ),
            Vue.h(Feedback, { active: true }),
          ]);
      },
    });
    const control = find(root, (node) => !!node.props[eventName]);
    const running = control.props[eventName]({ preventDefault() {} });
    await Vue.nextTick();
    assert.equal(control.props['aria-busy'], true);
    assert.match(text(root), /处理中/);
    await control.props[eventName]({ preventDefault() {} });
    assert.equal(calls, 1);
    reject({ errMsg: '页面无法打开' });
    await running;
    await Vue.nextTick();
    assert.equal(control.props['aria-busy'], false);
    assert.equal(ui.notice.value, '页面无法打开');
    assert.match(text(find(root, (node) => node.props.role === 'alert')), /页面无法打开/);
    await control.props[eventName]({ preventDefault() {} });
    assert.equal(calls, 2);
    app.unmount();
  });
}

test('page actions report concurrent clicks and always release busy state on failure', async () => {
  const ui = pageUi.createPageUi();
  let reject;
  const task = new Promise((_resolve, fail) => {
    reject = fail;
  });
  const first = ui.run(() => task);
  await ui.run(() => assert.fail('must not submit a second mutation'));
  assert.equal(ui.busy.value, true);
  assert.match(ui.notice.value, /请稍候/);
  reject(null);
  await first;
  assert.equal(ui.busy.value, false);
  assert.equal(ui.noticeType.value, 'error');
  assert.ok(ui.notice.value);
});

test('remounted panels retain workspace feedback without inheriting an old submission lock', async () => {
  const workspace = pageUi.createPageUi();
  const previous = pageUi.createPageUi(workspace);
  let reject;
  const running = previous.run(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const next = pageUi.createPageUi(workspace);
  assert.equal(next.busy.value, false);
  reject(new Error('登录后无法打开目标页面'));
  await running;
  assert.equal(workspace.notice.value, '登录后无法打开目标页面');
  assert.equal(next.noticeType.value, 'error');
});

test('failed conversation pagination preserves the visible page and content', async () => {
  const scope = Vue.effectScope();
  let fail = false;
  const { useConversations } = loadModule('composables/useConversations.js', 'useConversations', {
    ...vueDependencies,
    ...locale,
    api: async () => {
      if (fail) throw new Error('网络错误');
      return [{ id: 'old' }];
    },
  });
  const state = scope.run(() => useConversations({ notify() {} }));
  await state.loadConversations();
  fail = true;
  await assert.rejects(state.loadConversations(2), /网络错误/);
  assert.equal(state.page.value, 1);
  assert.equal(state.conversations.value[0].id, 'old');
  scope.stop();
});

test('navigation feedback reaches only the destination, and failed transitions discard it', async (t) => {
  const previousWindow = globalThis.window,
    previousUni = globalThis.uni;
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.uni = previousUni;
  });
  globalThis.window = {
    location: { origin: 'http://localhost', pathname: '/explore', search: '' },
  };
  let transition;
  globalThis.uni = {
    navigateTo: (options) => {
      transition = options;
    },
    redirectTo: (options) => {
      transition = options;
    },
  };
  installNavigationHooks({ beforeEach: () => () => {} });
  const pending = navigate('login', {}, true, '注册成功，请登录');
  assert.equal(takeNavigationFeedback(), null);
  window.location.pathname = '/login';
  transition.success();
  await pending;
  assert.equal(takeNavigationFeedback(), '注册成功，请登录');
  assert.equal(takeNavigationFeedback(), null);
  const failed = navigate('chat', {}, false, '会话已删除');
  transition.fail({ errMsg: '无法跳转' });
  await assert.rejects(failed, { errMsg: '无法跳转' });
  window.location.pathname = '/chat';
  assert.equal(takeNavigationFeedback(), null);
});
