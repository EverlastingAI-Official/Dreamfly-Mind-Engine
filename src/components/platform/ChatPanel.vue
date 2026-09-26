<template>
  <text class="eyebrow">MINDCOPY CONVERSATIONS</text>
  <h1>让对话持续。</h1>
  <view class="chat-grid">
    <view class="panel">
      <h3>我的会话</h3>
      <n-button
        v-for="c in conversations"
        :key="c.id"
        class="conversation-item"
        :class="{ selected: c.id === currentConversation?.id }"
        @click="run(() => openConversation(c))"
      >
        <skill-avatar :avatar-id="c.avatar_id" :name="c.title" :size="36" />
        <span class="conversation-title">{{ c.title }}</span>
      </n-button>
      <view class="row pagination">
        <n-button :disabled="busy || page === 1" @click="run(() => loadConversations(page - 1))"
          >上一页</n-button
        >
        <text>第 {{ page }} 页</text>
        <n-button :disabled="busy || !hasMore" @click="run(() => loadConversations(page + 1))"
          >下一页</n-button
        >
      </view>
      <p v-if="!busy && !conversations.length" class="muted">从 Skill 详情页开始一段对话。</p>
    </view>
    <view class="panel chat-panel">
      <template v-if="currentConversation">
        <view class="row spaced">
          <view class="row chat-identity">
            <skill-avatar
              :avatar-id="currentConversation.avatar_id"
              :name="currentConversation.title"
              :size="48"
            />
            <h2>{{ currentConversation.title }}</h2>
          </view>
          <view class="row">
            <n-button class="small" @click="run(renameConversation)"> 重命名 </n-button>
            <n-button class="small danger" :disabled="generating" @click="run(deleteConversation)">
              删除
            </n-button>
          </view>
        </view>
        <p class="muted">会话记忆不会自动写入公开 Skill。</p>
        <view class="messages" ref="messageBox">
          <view v-for="m in messages" :key="m.id" class="message" :class="m.role">
            <view class="message-identity">
              <skill-avatar
                v-if="m.role === 'assistant'"
                :avatar-id="currentConversation.avatar_id"
                :size="32"
              />
              <text class="message-role">{{ m.role === 'user' ? '你' : 'MindCopy' }}</text>
            </view>
            <view class="message-content">
              {{ m.content || (m.status === 'generating' ? '正在思考…' : '未生成文本') }}
            </view>
            <small v-if="m.role === 'assistant' && m.status !== 'completed'" class="muted">
              {{ statusName(m.status) }}
            </small>
          </view>
        </view>
        <n-form @submit.prevent="chat">
          <n-textarea
            v-model="input"
            rows="3"
            maxlength="10000"
            placeholder="说说你的想法…"
            :disabled="generating"
          />
          <view class="row spaced">
            <text class="muted">私有会话</text>
            <n-button
              v-if="generating"
              type="button"
              :disabled="stopping"
              @click="run(cancelGeneration)"
            >
              {{ stopping ? '正在停止…' : '停止生成' }}
            </n-button>
            <n-button v-else class="primary" type="submit" :disabled="busy || !input.trim()">
              发送
            </n-button>
          </view>
        </n-form>
      </template>
      <view v-else class="empty">
        <text class="empty-icon">◎</text>
        <h3>选择一段会话</h3>
        <n-button @click="go('explore')">探索 Skills</n-button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { getCurrentInstance, onMounted, onUnmounted } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { useConversations } from '../../composables/useConversations.js';
import { statusName } from '../../services/presentation.js';
import { auth } from '../../services/platform.js';
import { navigate as go } from '../../services/navigation.mjs';
const props = defineProps({ query: Object, active: Boolean });
const { run, notify, busy } = usePageUi();
import { NTextarea, NButton, NForm } from '../native.js';
import SkillAvatar from '../SkillAvatar.vue';
const {
  conversations,
  currentConversation,
  messages,
  input,
  generating,
  stopping,
  messageBox,
  openConversation,
  chat,
  cancelGeneration,
  renameConversation,
  deleteConversation,
  page,
  hasMore,
  load,
  loadConversations,
} = useConversations({ notify });
const owner = auth.user.id;
const removeGuard = getCurrentInstance().proxy.$router.beforeEach(() => {
  if (props.active && auth.user?.id === owner && generating.value) {
    notify('请先停止当前生成', 'info');
    return false;
  }
});
onUnmounted(removeGuard);
onMounted(() => run(() => load(props.query.id)));
</script>

<style scoped>
.platform .conversation-item {
  display: flex;
  justify-content: flex-start;
}
.conversation-title {
  min-width: 0;
  overflow-wrap: anywhere;
}
.chat-identity {
  flex-wrap: nowrap;
  min-width: 0;
}
.chat-identity h2 {
  margin: 0;
  overflow-wrap: anywhere;
}
.message-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.message-identity .message-role {
  margin-bottom: 0;
}
</style>
