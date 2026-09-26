<template>
  <view v-if="active && (busy || (showNotice && notice))" class="action-feedback">
    <view v-if="busy" class="notice info" role="status" aria-live="polite">
      <span class="action-spinner" aria-hidden="true"></span>
      {{ tr('正在处理，请稍候…', 'Working, please wait…') }}
    </view>
    <view
      v-if="showNotice && notice"
      class="notice"
      :class="noticeType"
      :role="noticeType === 'error' ? 'alert' : 'status'"
      aria-atomic="true"
    >
      {{ notice }}
      <n-button class="dismiss" :aria-label="tr('关闭提示', 'Dismiss')" @click="notify('')">
        ×
      </n-button>
    </view>
  </view>
</template>

<script setup>
import { usePageUi } from '../composables/usePageUi.js';
import { tr } from '../services/locale.js';
import { NButton } from './native.js';
defineProps({ active: Boolean, showNotice: { type: Boolean, default: true } });
const { busy, notice, noticeType, notify } = usePageUi();
</script>
