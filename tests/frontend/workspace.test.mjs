import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as navigation from '../../src/services/navigation.mjs';
import * as access from '../../src/services/pageAccess.mjs';

// Compile the real shell; replace its IO and child panels, not its lifecycle logic.
const { descriptor } = parse(
  readFileSync(new URL('../../src/components/PlatformWorkspace.vue', import.meta.url), 'utf8'),
);
const compiled = compileScript(descriptor, { id: 'workspace-test', inlineTemplate: true }).content;
function workspace(dependencies) {
  dependencies['../composables/usePageUi.js'] = {
    pageUiKey: Symbol('page-ui'),
    createPageUi: () => ({ run: (action) => action(), notify() {} }),
  };
  dependencies['./ActionFeedback.vue'] = { render: () => null };
  dependencies['../services/navigation.mjs'].takeNavigationFeedback = () => null;
  const source = compiled
    .replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, module) => {
      const value = module === 'vue' ? 'Vue' : `dependencies[${JSON.stringify(module)}]`;
      return `const ${bindings.replace(/\s+as\s+/g, ': ')} = ${value};`;
    })
    .replace('export default', 'return');
  return new Function('Vue', 'dependencies', source)(Vue, dependencies);
}
function renderer() {
  const node = (type, text = '') => ({ type, text, children: [], parent: null });
  const host = Vue.createRenderer({
    createElement: (type) => node(type),
    createText: (text) => node('text', text),
    createComment: (text) => node('comment', text),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: () => {},
    insert(child, parent, anchor = null) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
      parent.children.splice(index, 0, child);
      child.parent = parent;
    },
    remove(child) {
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = null;
    },
  });
  return { ...host, root: node('root') };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const text = (node) =>
  node.type === 'comment' ? '' : node.text + node.children.map(text).join('');

test('cached private pages discard the previous account, and hidden pages wait before loading the next account', async () => {
  const auth = Vue.reactive({ user: { id: 'alice', role: 'user' } });
  const props = Vue.reactive({ pageName: 'chat', query: {}, active: true });
  const mounted = [],
    removed = [],
    redirects = [];
  const PageContent = {
    setup() {
      const owner = auth.user.id;
      mounted.push(owner);
      Vue.onUnmounted(() => removed.push(owner));
      return () => Vue.h('p', owner + ' private conversations');
    },
  };
  const Workspace = workspace({
    './PlatformLayout.vue': {
      setup:
        (_, { slots }) =>
        () =>
          Vue.h('layout', slots.default()),
    },
    './platform/PageContent.vue': PageContent,
    './native.js': {
      NButton: {
        setup:
          (_, { slots }) =>
          () =>
            Vue.h('button', slots.default?.()),
      },
    },
    '../services/platform.js': { auth, restoreSession: async () => {} },
    '../services/locale.js': { tr: (value) => value, publicError: (error) => error.message },
    '../services/navigation.mjs': {
      ...navigation,
      installNavigationHooks() {},
      restoreScroll() {},
      loginUrl: () => '/login',
      navigateUrl: async (url) => redirects.push(url),
    },
    '../services/pageAccess.mjs': access,
  });
  const host = renderer();
  const app = host.createApp({ setup: () => () => Vue.h(Workspace, props) });
  app.mount(host.root);
  await settle();
  assert.match(text(host.root), /alice private/);
  props.active = false;
  await settle();
  auth.user = { id: 'bob', role: 'user' };
  await settle();
  assert.deepEqual(removed, ['alice']);
  assert.deepEqual(mounted, ['alice']);
  assert.doesNotMatch(text(host.root), /alice private/);
  props.active = true;
  await settle();
  assert.match(text(host.root), /bob private/);
  assert.deepEqual(mounted, ['alice', 'bob']);
  auth.user = null;
  await settle();
  assert.doesNotMatch(text(host.root), /private conversations/);
  assert.deepEqual(redirects, ['/login']);
  app.unmount();
});

test('a cached administrator page loses its data when the account role is downgraded', async () => {
  const auth = Vue.reactive({ user: { id: 'alice', role: 'admin' } });
  let disposed = false;
  const Workspace = workspace({
    './PlatformLayout.vue': {
      setup:
        (_, { slots }) =>
        () =>
          Vue.h('layout', slots.default()),
    },
    './platform/PageContent.vue': {
      setup() {
        Vue.onUnmounted(() => {
          disposed = true;
        });
        return () => Vue.h('p', 'private admin records');
      },
    },
    './native.js': {
      NButton: {
        setup:
          (_, { slots }) =>
          () =>
            Vue.h('button', slots.default?.()),
      },
    },
    '../services/platform.js': { auth, restoreSession: async () => {} },
    '../services/locale.js': { tr: (value) => value, publicError: (error) => error.message },
    '../services/navigation.mjs': {
      ...navigation,
      installNavigationHooks() {},
      restoreScroll() {},
    },
    '../services/pageAccess.mjs': access,
  });
  const host = renderer(),
    app = host.createApp(Workspace, { pageName: 'admin', query: {}, active: true });
  app.mount(host.root);
  await settle();
  assert.match(text(host.root), /private admin records/);
  auth.user.role = 'user';
  await settle();
  assert.equal(disposed, true);
  assert.doesNotMatch(text(host.root), /private admin records/);
  assert.match(text(host.root), /需要管理员权限/);
  app.unmount();
});
