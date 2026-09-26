<template>
  <action-feedback :active="active" :show-notice="false" />
  <explore-skills
    v-if="['explore', 'detail'].includes(pageName)"
    :query="query"
    :detail-page="pageName === 'detail'"
    :active="active"
    @create="run(newSkill)"
    @import="run(importSkill)"
    @edit="(id) => run(() => openSkill(id))"
    @models="run(() => navigate('models'))"
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
import { createPageUi, pageUiKey, usePageUi } from '../../composables/usePageUi.js';
import ActionFeedback from '../ActionFeedback.vue';
import { tr } from '../../services/locale.js';
import { navigate } from '../../services/navigation.mjs';
import { newSkill, importSkill, openSkill } from '../../services/skillActions.js';
import ExploreSkills from '../ExploreSkills.vue';
import AuthPanel from './AuthPanel.vue';
import MySkillsPanel from './MySkillsPanel.vue';
import SkillEditorPanel from './SkillEditorPanel.vue';
import ChatPanel from './ChatPanel.vue';
import ModelsPanel from './ModelsPanel.vue';
import AccountPanel from './AccountPanel.vue';
import AdminPanel from './AdminPanel.vue';
const props = defineProps({ pageName: String, query: Object, active: Boolean });
const ui = createPageUi(usePageUi());
provide(pageUiKey, ui);
const { run } = ui;
</script>
