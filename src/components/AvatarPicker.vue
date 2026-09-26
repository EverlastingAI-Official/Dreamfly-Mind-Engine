<template>
  <view class="avatar-options" role="group" :aria-label="tr('选择形象', 'Choose an avatar')">
    <n-button
      v-for="avatar in avatarPresets"
      :key="avatar.id"
      type="button"
      class="avatar-option"
      :class="{ selected: selected.id === avatar.id }"
      :aria-pressed="selected.id === avatar.id"
      @click="$emit('update:modelValue', avatar.id)"
    >
      <skill-avatar :avatar-id="avatar.id" :size="72" />
      <span>{{ tr(avatar.name, avatar.name_en) }}</span>
      <span class="avatar-choice-state">
        {{ selected.id === avatar.id ? tr('✓ 已选择', '✓ Selected') : tr('选择', 'Choose') }}
      </span>
    </n-button>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { avatarPresets, avatarPreset } from '../../packages/mind-format/index.js';
import { tr } from '../services/locale.js';
import { NButton } from './native.js';
import SkillAvatar from './SkillAvatar.vue';
const props = defineProps({ modelValue: String });
defineEmits(['update:modelValue']);
const selected = computed(() => avatarPreset(props.modelValue));
</script>

<style scoped>
.avatar-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 10px;
}
.platform .avatar-option {
  flex-direction: column;
  padding: 12px 6px;
  font-size: 12px;
  gap: 8px;
}
.platform .avatar-option.selected {
  border-color: #357554;
  background: #edf3ed;
}
.platform .avatar-option:focus-visible {
  outline: 2px solid #357554;
  outline-offset: 2px;
}
.avatar-choice-state {
  color: #58794f;
  font-size: 11px;
}
</style>
