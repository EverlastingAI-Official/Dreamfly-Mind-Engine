<template>
  <h1>管理空间</h1>
  <view class="panel">
    <h2>下架 Skill</h2>
    <n-label>
      Skill ID
      <n-input v-model="adminSkill" />
    </n-label>
    <n-button class="danger" @click="run(blockSkill)">管理下架</n-button>
  </view>
  <view class="panel" v-for="u in users" :key="u.id">
    <view class="row spaced">
      <text>{{ u.display_name }} · {{ u.email }} · {{ u.status }}</text>
      <n-button class="small" :disabled="u.id === auth.user.id" @click="run(() => toggleUser(u))">
        {{ u.status === 'active' ? '停用' : '恢复' }}
      </n-button>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { auth, api } from '../../services/platform.js';
import { NInput, NButton, NLabel } from '../native.js';
const { run, notify } = usePageUi();
const users = ref([]),
  adminSkill = ref('');
async function loadUsers() {
  users.value = await api('/admin/users');
}
async function blockSkill() {
  await api('/admin/skills/' + adminSkill.value + '/unpublish', { method: 'POST' });
  notify('已下架');
}
async function toggleUser(user) {
  await api('/admin/users/' + user.id + '/status', {
    method: 'PATCH',
    body: { status: user.status === 'active' ? 'disabled' : 'active' },
  });
  await loadUsers();
}
onMounted(() => run(loadUsers));
</script>
