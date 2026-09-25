<template>
  <view v-if="notice" class="notice" :class="noticeType" role="status">
    {{ notice }}<n-button class="dismiss" @click="notice = ''">×</n-button>
  </view>
  <view v-if="busy" class="loading" role="status">{{ tr('正在处理…', 'Working…') }}</view>
  <explore-skills
    v-if="['explore', 'detail'].includes(pageName)"
    :query="query"
    :detail-page="pageName === 'detail'"
    :active="active"
    @create="newSkill"
    @import="run(importSkill)"
    @edit="openSkill"
    @chat="(skill, profile) => run(() => startChat(skill, profile))"
    @models="navigate('models')"
  />
  <auth-panel
    v-else-if="['login', 'register', 'reset'].includes(pageName)"
    :page-name="pageName"
    :query="query"
  />
  <my-skills-panel v-else-if="pageName === 'mine'" :active="active" />
  <skill-editor-panel v-else-if="['new', 'edit'].includes(pageName)" v-bind="props" />
  <chat-panel v-else-if="pageName === 'chat'" :query="query" :active="active" />
  <models-panel v-else-if="pageName === 'models'" />
  <account-panel v-else-if="pageName === 'account'" />
  <admin-panel v-else-if="pageName === 'admin'" />
  <view v-else class="empty panel"
    ><h1>404</h1>
    <p>{{ tr('页面不存在', 'Page not found') }}</p></view
  >
</template>
<script setup>
import { provide } from 'vue';
import { createPageUi, pageUiKey } from '../../composables/usePageUi.js';
import { tr } from '../../services/locale.js';
import { navigate } from '../../services/navigation.mjs';
import { newSkill, importSkill, openSkill, startChat } from '../../services/skillActions.js';
import { NButton } from '../native.js';
import ExploreSkills from '../ExploreSkills.vue';
import AuthPanel from './AuthPanel.vue';
import MySkillsPanel from './MySkillsPanel.vue';
import SkillEditorPanel from './SkillEditorPanel.vue';
import ChatPanel from './ChatPanel.vue';
import ModelsPanel from './ModelsPanel.vue';
import AccountPanel from './AccountPanel.vue';
import AdminPanel from './AdminPanel.vue';
const props = defineProps({ pageName: String, query: Object, active: Boolean });
const ui = createPageUi();
provide(pageUiKey, ui);
const { notice, noticeType, busy, run } = ui;
</script>
