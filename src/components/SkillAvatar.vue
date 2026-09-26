<template>
  <img
    class="skill-avatar"
    :src="`/static/avatars/${avatar.id}.webp`"
    :alt="name ? tr(`${name}的头像`, `Avatar for ${name}`) : tr(avatar.name, avatar.name_en)"
    :width="size"
    :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }"
    loading="lazy"
    decoding="async"
  />
</template>

<script setup>
import { computed } from 'vue';
import { avatarPreset } from '../../packages/mind-format/index.js';
import { tr } from '../services/locale.js';
const props = defineProps({ avatarId: String, name: String, size: { type: Number, default: 64 } });
const avatar = computed(() => avatarPreset(props.avatarId));
</script>

<style scoped>
.skill-avatar {
  display: block;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 14px;
  background: #f3f1ec;
  border: 1px solid #e5e6de;
}
</style>
