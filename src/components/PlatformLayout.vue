<template>
  <view class="platform">
    <view class="topbar">
      <n-button class="brand" @click="$emit('navigate', 'explore')">
        <text class="brand-icon">◈</text>
        <text>
          云己
          <text class="brand-en">DreamFly</text>
        </text>
      </n-button>
      <view class="top-actions">
        <text class="muted">
          {{ tr('让思想被理解，让记忆可传承', 'Let minds connect and memories live on') }}
        </text>
        <select v-model="locale" class="language-switch" aria-label="界面语言 / Interface language">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
        <n-button v-if="!auth.user" class="small primary" @click="$emit('navigate', 'login')">
          {{ tr('登录 / 注册', 'Sign in / Register') }}
        </n-button>
        <n-button v-else class="small" @click="$emit('navigate', 'account')">
          {{ auth.user.display_name }}
        </n-button>
      </view>
    </view>
    <view class="shell">
      <view class="sidebar">
        <text class="nav-label">{{ tr('工作空间', 'WORKSPACE') }}</text>
        <n-button
          v-for="item in navigation"
          :key="item.id"
          class="nav"
          :class="{
            selected: current === item.id || (current === 'detail' && item.id === 'explore'),
          }"
          @click="$emit('navigate', item.id)"
        >
          <text>{{ item.icon }}</text>
          {{ item.name }}
        </n-button>
        <view class="sidebar-note">
          {{ tr('Skill 保存你的人格与记忆。', 'Your personality and memories.') }}
          <br />
          {{ tr('模型连接由你自己掌握。', 'Your own model connections.') }}
        </view>
      </view>
      <view class="main"><slot /></view>
    </view>
  </view>
</template>

<script setup>
import { NButton } from './native.js';
import { auth } from '../services/platform.js';
import { locale, tr } from '../services/locale.js';
defineProps({ current: String, navigation: Array });
defineEmits(['navigate']);
</script>
