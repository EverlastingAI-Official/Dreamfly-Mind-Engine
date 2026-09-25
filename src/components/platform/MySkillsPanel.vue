<template>
  <view class="hero">
    <text class="eyebrow">MY MIND SKILLS</text>
    <h1>{{ tr('你的思想，持续生长。', 'Your mind, always growing.') }}</h1>
    <p>
      {{
        tr(
          '创建、整理并发布你的意识 Skill。每个版本都留下清晰的记录。',
          'Create, organize and publish your Skills. Every version has a clear record.',
        )
      }}
    </p>
    <view class="row">
      <n-button class="primary" @click="newSkill">
        {{ tr('创建 Skill', 'Create Skill') }}
      </n-button>
      <n-button @click="run(importSkill)">
        {{ tr('导入 .mind / Skill 包', 'Import .mind / Skill package') }}
      </n-button>
    </view>
  </view>
  <view class="section-heading">
    <h2>{{ tr('我的 Skills', 'My Skills') }}</h2>
    <view class="row">
      <n-input
        class="search"
        v-model="search"
        :placeholder="tr('搜索名称或 ID', 'Search name or ID')"
        @keyup.enter="
          page = 1;
          run(loadSkills);
        "
      />
      <n-button
        class="small"
        @click="
          page = 1;
          run(loadSkills);
        "
      >
        {{ tr('搜索', 'Search') }}
      </n-button>
    </view>
  </view>
  <view v-if="!skills.length" class="empty panel">
    <text class="empty-icon">◇</text>
    <h3>
      {{
        search
          ? tr('没有找到匹配的 Skill', 'No matching Skills')
          : tr('从一个故事开始', 'Start with a story')
      }}
    </h3>
    <p class="muted">
      {{
        tr(
          '写下你在乎的事，或导入已有的 .mind 文件。',
          'Write about what matters to you, or import a .mind file.',
        )
      }}
    </p>
  </view>
  <view class="cards">
    <view v-for="skill in skills" :key="skill.id" class="skill-card panel">
      <view class="row spaced">
        <text class="avatar">{{ skill.name.slice(0, 1) }}</text>
        <text class="badge">{{ statusName(skill.status) }}</text>
      </view>
      <h3>{{ skill.name }}</h3>
      <p>{{ skill.description }}</p>
      <text class="muted">{{ skill.author }}</text>
      <text class="skill-id">ID: {{ skill.id }}</text>
      <view class="row">
        <n-button class="small" @click="run(() => copySkill(skill.id))">
          {{ tr('复制 ID', 'Copy ID') }}
        </n-button>
        <n-button
          v-if="skill.status === 'published' && skill.publication.listed"
          class="small"
          @click="run(() => copySkill(skillShareUrl(skill.id)))"
        >
          {{ tr('分享链接', 'Share link') }}
        </n-button>
      </view>
      <view class="row card-actions">
        <n-button class="small primary" @click="run(() => openSkill(skill.id))">
          {{ tr('管理 Skill', 'Manage Skill') }}
        </n-button>
      </view>
    </view>
  </view>
  <view class="row pagination">
    <n-button
      class="small"
      :disabled="busy || page === 1"
      @click="
        page--;
        run(loadSkills);
      "
    >
      {{ tr('上一页', 'Previous') }}
    </n-button>
    <text>
      {{ tr(`第 ${page} 页 / 共 ${skillTotal} 个`, `Page ${page} / ${skillTotal} Skills`) }}
    </text>
    <n-button
      class="small"
      :disabled="busy || page * 24 >= skillTotal"
      @click="
        page++;
        run(loadSkills);
      "
    >
      {{ tr('下一页', 'Next') }}
    </n-button>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { api } from '../../services/platform.js';
import { tr } from '../../services/locale.js';
import { skillShareUrl } from '../../services/navigation.mjs';
import {
  newSkill,
  importSkill,
  openSkill,
  copySkill as copy,
} from '../../services/skillActions.js';
import { statusName } from '../../services/presentation.js';
import { NInput, NButton } from '../native.js';
const props = defineProps({ active: Boolean });
const { busy, run, notify } = usePageUi();
const search = ref(''),
  page = ref(1),
  skills = ref([]),
  skillTotal = ref(0);
const copySkill = (value) => copy(value, notify);
async function loadSkills() {
  const result = await api(
    '/skills?scope=mine&search=' + encodeURIComponent(search.value) + '&page=' + page.value,
  );
  skills.value = result.items;
  skillTotal.value = result.total;
}
watch(
  () => props.active,
  (active) => {
    if (active) run(loadSkills);
  },
  { immediate: true },
);
</script>
