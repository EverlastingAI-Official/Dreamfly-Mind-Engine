<template>
  <h1>账号设置</h1>
  <view class="panel narrow">
    <h2>{{ auth.user?.display_name }}</h2>
    <p>{{ auth.user?.email }}</p>
    <n-label>
      当前密码
      <n-input v-model="passwords.old_password" type="password" autocomplete="current-password" />
    </n-label>
    <n-label>
      新密码（8–128 位，包含字母和数字）
      <n-input v-model="passwords.password" type="password" autocomplete="new-password" />
    </n-label>
    <n-button class="primary" @click="run(changePassword)"> 修改密码并退出所有设备 </n-button>
    <view class="row separated">
      <n-button @click="run(() => logout(false))">退出当前账号</n-button>
      <n-button @click="run(() => logout(true))">退出所有设备</n-button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { auth, api, clearSession } from '../../services/platform.js';
import { navigate } from '../../services/navigation.mjs';
import { validatePassword } from '../../services/account.js';
import { NInput, NButton, NLabel } from '../native.js';
const { run } = usePageUi();
const passwords = ref({ old_password: '', password: '' });
async function logout(all) {
  await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST' });
  clearSession();
  await navigate('login', {}, true);
}
async function changePassword() {
  validatePassword(passwords.value.password);
  await api('/auth/change-password', { method: 'POST', body: passwords.value });
  passwords.value = { old_password: '', password: '' };
  clearSession();
  await navigate('login', {}, true);
}
</script>
