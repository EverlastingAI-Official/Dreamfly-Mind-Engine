<template>
  <platform-layout :current="pageName" :navigation="navigation" @navigate="go">
    <view v-if="pageError" class="empty panel" role="alert">
      <h1>{{ tr('无法打开此页面', 'Page unavailable') }}</h1>
      <p>{{ pageError }}</p>
      <n-button @click="loadPage">{{ tr('重试', 'Retry') }}</n-button>
      <n-button @click="go('explore')">{{ tr('返回探索', 'Explore minds') }}</n-button>
    </view>
    <page-content
      v-else-if="ready && allowed && contentIdentity === identity"
      :key="identity"
      v-bind="props"
    />
    <view v-else class="loading" role="status">{{ tr('正在加载…', 'Loading…') }}</view>
  </platform-layout>
</template>
<script setup>
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue';
import PlatformLayout from './PlatformLayout.vue';
import PageContent from './platform/PageContent.vue';
import { NButton } from './native.js';
import { auth, restoreSession } from '../services/platform.js';
import { tr, publicError } from '../services/locale.js';
import {
  authPages,
  privatePages,
  navigate,
  navigateUrl,
  loginUrl,
  safeReturnTo,
  restoreScroll,
  installNavigationHooks,
} from '../services/navigation.mjs';
import { sessionIdentity, canOpenPage } from '../services/pageAccess.mjs';
const props = defineProps({ pageName: String, query: Object, active: Boolean });
const ready = ref(false),
  pageError = ref('');
const identity = computed(() => sessionIdentity(auth.user));
const contentIdentity = ref(null);
const needsLogin = computed(
  () =>
    privatePages.includes(props.pageName) ||
    (props.pageName === 'explore' && ['liked', 'favorites'].includes(props.query.collection)),
);
const allowed = computed(() =>
  canOpenPage(auth.user, needsLogin.value, props.pageName === 'admin'),
);
const navigation = computed(() => [
  { id: 'explore', name: tr('探索思想', 'Explore minds'), icon: '◇' },
  { id: 'mine', name: tr('我的 Skills', 'My Skills'), icon: '◈' },
  { id: 'chat', name: tr('MindCopy 对话', 'Conversations'), icon: '◎' },
  { id: 'models', name: tr('模型连接', 'Model connections'), icon: '⚙' },
  ...(auth.user?.role === 'admin'
    ? [{ id: 'admin', name: tr('管理空间', 'Administration'), icon: '▣' }]
    : []),
]);
installNavigationHooks(getCurrentInstance().proxy.$router);
function go(name) {
  const query =
    authPages.includes(name) && authPages.includes(props.pageName) && props.query.returnTo
      ? { returnTo: safeReturnTo(props.query.returnTo) }
      : {};
  return navigate(name, query);
}
function checkAccess() {
  if (!props.active) return;
  if (needsLogin.value && !auth.user) return navigateUrl(loginUrl(), true);
  if (!allowed.value) pageError.value = tr('需要管理员权限', 'Administrator access required');
}
async function loadPage() {
  pageError.value = '';
  try {
    await restoreSession();
    await checkAccess();
    ready.value = true;
    await nextTick();
    if (props.active) restoreScroll();
  } catch (error) {
    pageError.value = publicError(error);
  }
}
// A different account or role gives every business panel a fresh component scope.
watch(identity, () => {
  pageError.value = '';
  checkAccess();
});
watch(
  [identity, () => props.active],
  ([current, active]) => {
    if (active) contentIdentity.value = current;
  },
  { immediate: true },
);
watch(
  () => props.active,
  (active) => {
    if (active) loadPage();
  },
  { immediate: true },
);
</script>
