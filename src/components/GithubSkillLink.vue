<template>
  <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" class="github-skill-link">
    {{ tr('在 GitHub 查看', 'View on GitHub') }} ↗
  </a>
</template>

<script setup>
import { tr } from '../services/locale.js';
defineProps({ url: String });
</script>

<style scoped>
.github-skill-link {
  display: inline-block;
  margin: 12px 0;
  color: #28563d;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
