<template>
  <view class="explore-skills">
    <template v-if="!detailPage">
      <view class="hero">
        <text class="eyebrow">THE MIND COMMONS</text>
        <h1>{{ tr('与不同的思想相遇。', 'Meet a different mind.') }}</h1>
        <p>
          {{
            tr(
              '探索公开的人格与记忆，收藏感兴趣的思想，下载可使用的 Skill。',
              'Discover public minds and memories. Save your favorites and download Skills to use.',
            )
          }}
        </p>
        <view class="row">
          <n-button class="primary" @click="$emit('create')">
            {{ tr('创建 Skill', 'Create Skill') }}
          </n-button>
          <n-button @click="$emit('import')">
            {{ tr('导入 .mind / Skill 包', 'Import .mind / Skill package') }}
          </n-button>
        </view>
      </view>
      <n-form class="panel filters" @submit.prevent="searchSkills">
        <n-label class="search-field">
          {{ tr('查询', 'Search') }}
          <n-input
            v-model="filters.search"
            maxlength="200"
            :placeholder="
              tr('名称、说明、作者或 Skill ID', 'Name, description, author or Skill ID')
            "
          />
        </n-label>
        <view class="filter-grid">
          <n-label>
            {{ tr('浏览范围', 'Collection') }}
            <select v-model="filters.collection">
              <option value="all">
                {{ tr('全部公开 Skills', 'All public Skills') }}
              </option>
              <option value="liked">{{ tr('我喜欢的', 'My likes') }}</option>
              <option value="favorites">
                {{ tr('我的收藏', 'My favorites') }}
              </option>
            </select>
          </n-label>
          <n-label>
            {{ tr('内容语言', 'Content language') }}
            <select v-model="filters.language">
              <option value="">{{ tr('全部语言', 'All languages') }}</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </n-label>
          <n-label>
            {{ tr('排序', 'Sort by') }}
            <select v-model="filters.sort">
              <option value="newest">
                {{ tr('最新发布', 'Newest first') }}
              </option>
              <option value="oldest">
                {{ tr('最早发布', 'Oldest first') }}
              </option>
              <option value="name">{{ tr('名称', 'Name') }}</option>
              <option value="likes">{{ tr('最多喜欢', 'Most liked') }}</option>
            </select>
          </n-label>
        </view>
        <view class="row spaced">
          <view class="row">
            <n-label class="check">
              <n-input type="checkbox" v-model="filters.download" />
              {{ tr('仅可下载', 'Downloadable only') }}
            </n-label>
            <n-label class="check">
              <n-input type="checkbox" v-model="filters.chat" />
              {{ tr('仅可交互', 'Chat enabled only') }}
            </n-label>
          </view>
          <view class="row">
            <n-button :disabled="loading" @click="resetFilters">
              {{ tr('清空', 'Clear') }}
            </n-button>
            <n-button class="primary" type="submit" :disabled="loading">
              {{ tr('查询', 'Search') }}
            </n-button>
          </view>
        </view>
      </n-form>
      <view class="section-heading">
        <h2>{{ tr('探索思想', 'Explore minds') }}</h2>
        <text class="muted" aria-live="polite">
          {{
            loading ? tr('正在查询…', 'Searching…') : tr(`共 ${total} 个结果`, `${total} results`)
          }}
        </text>
      </view>
      <view v-if="!loading && !items.length && !failed" class="empty panel">
        <h3>{{ tr('没有找到匹配的 Skill', 'No matching Skills') }}</h3>
        <p>
          {{ tr('试试其他关键词或清空筛选条件。', 'Try another keyword or clear your filters.') }}
        </p>
      </view>
      <view v-if="failed && !loading" class="row">
        <n-button @click="loadList">{{ tr('重试', 'Retry') }}</n-button>
      </view>
      <view class="cards" :aria-busy="loading">
        <view v-for="skill in items" :key="skill.id" class="skill-card panel">
          <view class="row spaced">
            <skill-avatar :avatar-id="skill.avatar_id" :name="skill.name" />
            <text class="badge">{{ skill.language || '—' }}</text>
          </view>
          <h3>{{ skill.name }}</h3>
          <p>{{ skill.description }}</p>
          <text class="muted">{{ skill.author }} · v{{ skill.version }}</text>
          <view class="row">
            <n-button class="small link" @click="copy(skill.id)">
              {{ tr('复制 ID', 'Copy ID') }}
            </n-button>
          </view>
          <view class="row card-actions">
            <n-button class="small primary" @click="openDetail(skill.id)">
              {{ tr('查看详情', 'View details') }}
            </n-button>
            <n-button
              class="small"
              :disabled="!skill.publication.download || downloading === skill.id"
              @click="download(skill)"
            >
              {{
                downloading === skill.id
                  ? tr('下载中…', 'Downloading…')
                  : skill.publication.download
                    ? tr('下载', 'Download')
                    : tr('未开放下载', 'Download unavailable')
              }}
            </n-button>
          </view>
          <view class="row reaction-actions">
            <n-button
              class="small"
              :class="{ selected: skill.liked }"
              :aria-pressed="skill.liked"
              :disabled="reacting.has(skill.id)"
              @click="react(skill, 'like')"
            >
              {{ skill.liked ? '♥' : '♡' }} {{ tr('喜欢', 'Like') }}
              {{ skill.like_count }}
            </n-button>
            <n-button
              class="small"
              :class="{ selected: skill.favorited }"
              :aria-pressed="skill.favorited"
              :disabled="reacting.has(skill.id)"
              @click="react(skill, 'favorite')"
            >
              {{ skill.favorited ? '★' : '☆' }}
              {{ skill.favorited ? tr('已收藏', 'Saved') : tr('收藏', 'Save') }}
            </n-button>
          </view>
        </view>
      </view>
      <view class="row pagination">
        <n-button class="small" :disabled="loading || page === 1" @click="changePage(page - 1)">
          {{ tr('上一页', 'Previous') }}
        </n-button>
        <text>
          {{ tr(`第 ${page} / ${pages} 页`, `Page ${page} of ${pages}`) }}
        </text>
        <n-button class="small" :disabled="loading || page >= pages" @click="changePage(page + 1)">
          {{ tr('下一页', 'Next') }}
        </n-button>
      </view>
    </template>
    <template v-else>
      <n-button class="small" @click="backToResults">
        ← {{ tr('返回搜索结果', 'Back to results') }}
      </n-button>
      <p v-if="detailLoading" role="status">
        {{ tr('正在读取详情…', 'Loading details…') }}
      </p>
      <view v-else-if="!detail" class="empty panel">
        <h3>{{ tr('无法读取此 Skill', 'This Skill is unavailable') }}</h3>
        <n-button @click="loadDetail">{{ tr('重试', 'Retry') }}</n-button>
      </view>
      <template v-else>
        <text class="eyebrow detail-heading">MIND SKILL</text>
        <skill-avatar :avatar-id="detail.avatar_id" :name="detail.name" :size="88" />
        <h1>{{ detail.name }}</h1>
        <p class="lead">{{ detail.description }}</p>
        <view class="panel">
          <view class="row spaced">
            <h2>{{ tr('发布信息', 'Publication') }}</h2>
            <n-button v-if="detail.is_owner" class="small" @click="$emit('edit', detail.id)">
              {{ tr('管理 Skill', 'Manage Skill') }}
            </n-button>
          </view>
          <github-skill-link :url="detail.github_url" />
          <view class="row">
            <n-button class="small" @click="copy(detail.id)">
              {{ tr('复制 ID', 'Copy ID') }}
            </n-button>
          </view>
          <p>
            {{ tr('作者', 'Author') }}: {{ detail.author }} · v{{ detail.version }} ·
            {{ formatDate(detail.published_at) }}
          </p>
          <p>
            {{ tr('内容语言', 'Content language') }}: {{ detail.language || '—' }} ·
            {{
              tr(
                `公开记忆 ${detail.memory_count} 条，素材 ${detail.asset_count} 个`,
                `${detail.memory_count} public memories, ${detail.asset_count} assets`,
              )
            }}
          </p>
          <view class="row">
            <n-button
              :class="{ selected: detail.liked }"
              :aria-pressed="detail.liked"
              :disabled="reacting.has(detail.id)"
              @click="react(detail, 'like')"
            >
              {{ detail.liked ? '♥' : '♡' }} {{ tr('喜欢', 'Like') }}
              {{ detail.like_count }}
            </n-button>
            <n-button
              :class="{ selected: detail.favorited }"
              :aria-pressed="detail.favorited"
              :disabled="reacting.has(detail.id)"
              @click="react(detail, 'favorite')"
            >
              {{ detail.favorited ? '★' : '☆' }}
              {{ detail.favorited ? tr('已收藏', 'Saved') : tr('收藏', 'Save') }}
            </n-button>
            <n-button
              class="primary"
              :disabled="!detail.publication.download || downloading === detail.id"
              @click="download(detail)"
            >
              {{
                downloading === detail.id
                  ? tr('下载中…', 'Downloading…')
                  : detail.publication.download
                    ? tr('下载 Skill 包', 'Download Skill package')
                    : tr('作者未开放下载', 'Downloads disabled by author')
              }}
            </n-button>
          </view>
        </view>
        <view class="panel">
          <h2>{{ tr('内容详情', 'Content details') }}</h2>
          <template v-if="detail.preview">
            <h3>{{ tr('人格与表达方式', 'Personality and expression') }}</h3>
            <p class="public-content">
              {{ detail.preview.persona.instructions }}
            </p>
            <h3>{{ tr('自我认知', 'Self-description') }}</h3>
            <p class="public-content">
              {{ detail.preview.persona.self_description }}
            </p>
            <h3>{{ tr('公开记忆', 'Public memories') }}</h3>
            <view v-for="memory in detail.preview.memory.fragments" :key="memory.id" class="memory">
              <text class="muted">{{ memory.time }}</text>
              <p class="public-content">{{ memory.content }}</p>
            </view>
          </template>
          <p v-else>
            {{
              !auth.user && detail.publication.download
                ? tr(
                    '登录后可查看获准下载的人格与公开记忆。',
                    'Sign in to preview the persona and public memories available for download.',
                  )
                : tr(
                    '此 Skill 未开放原文下载，可根据作者设置进行对话。',
                    'Full content is not available for download. You can chat if the author allows it.',
                  )
            }}
          </p>
          <n-button v-if="!auth.user && detail.publication.download" @click="login()">
            {{ tr('登录查看', 'Sign in to view') }}
          </n-button>
        </view>
        <view class="panel">
          <h2>{{ tr('开始交互', 'Start a conversation') }}</h2>
          <p>
            {{
              tr(
                '使用你自己的模型连接，人格与获准公开的记忆将发送至所选厂商。',
                'Use your own model connection. The persona and permitted memories will be sent to your selected provider.',
              )
            }}
          </p>
          <n-label v-if="auth.user">
            {{ tr('模型连接', 'Model connection') }}
            <select v-model="selectedModel" :disabled="modelsLoading || starting">
              <option value="">
                {{
                  modelsLoading
                    ? tr('正在读取连接…', 'Loading connections…')
                    : tr('请选择模型连接', 'Choose a model connection')
                }}
              </option>
              <option v-for="model in modelChoices" :key="model.id" :value="model.id">
                {{ model.name }} · {{ model.model }}
              </option>
            </select>
          </n-label>
          <p v-if="modelError" class="validation-error" role="alert">{{ modelError }}</p>
          <p v-else-if="auth.user && !modelsLoading && !modelChoices.length" class="muted">
            {{
              tr(
                '请先配置模型连接，再开始对话。',
                'Configure a model connection before starting a chat.',
              )
            }}
          </p>
          <p v-if="startError" class="validation-error" role="alert">
            {{ tr('无法开始对话：', 'Unable to start chat: ') }}{{ startError }}
          </p>
          <view class="row">
            <n-button
              class="primary"
              :disabled="!detail.publication.chat || starting"
              @click="beginChat(detail, selectedModel)"
            >
              {{
                starting
                  ? tr('正在启动…', 'Starting…')
                  : detail.publication.chat
                    ? tr('开始对话', 'Start chat')
                    : tr('作者未开放交互', 'Chat disabled by author')
              }}
            </n-button>
            <n-button @click="$emit('models')">
              {{ tr('配置模型', 'Configure model') }}
            </n-button>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { NButton, NForm, NInput, NLabel } from './native.js';
import GithubSkillLink from './GithubSkillLink.vue';
import SkillAvatar from './SkillAvatar.vue';
import { useStartChat } from '../composables/useStartChat.js';
import { usePageUi } from '../composables/usePageUi.js';
import { api, auth } from '../services/platform.js';
import { locale, tr, copyText, publicError } from '../services/locale.js';
import {
  exploreQuery,
  pageUrl,
  navigate,
  navigateUrl,
  signIn,
  signInForSkill,
  takeSkillIntent,
  validId,
  currentUrl,
  restoreScroll,
  rememberExplore,
  backToExplore,
} from '../services/navigation.mjs';

const props = defineProps({
  query: { type: Object, default: () => ({}) },
  detailPage: Boolean,
  active: Boolean,
});
defineEmits(['create', 'import', 'edit', 'models']);
const { starting, startError, beginChat } = useStartChat();
const { notify } = usePageUi();
const defaults = () => ({
  search: '',
  collection: 'all',
  language: '',
  sort: 'newest',
  download: false,
  chat: false,
});
const routeFilters = () => ({
  ...defaults(),
  ...exploreQuery(props.query),
  download: props.query.download === 'true',
  chat: props.query.chat === 'true',
});
const filters = reactive(routeFilters()),
  applied = computed(routeFilters),
  items = ref([]),
  total = ref(0),
  page = computed(() => Number(exploreQuery(props.query).page || 1));
const loading = ref(false),
  failed = ref(false),
  detailId = computed(() => props.query.id || ''),
  detail = ref(null),
  detailLoading = ref(false);
const downloading = ref(''),
  reacting = reactive(new Set()),
  pages = computed(() => Math.max(1, Math.ceil(total.value / 24)));
const modelChoices = ref([]),
  modelsLoading = ref(false),
  selectedModel = ref(''),
  modelError = ref('');
let requestNumber = 0,
  detailRequest = 0;
function error(e) {
  notify(publicError(e), 'error');
  failed.value = true;
}
function login() {
  return signIn();
}
async function copy(value) {
  try {
    await copyText(value);
    notify(tr('已复制 ID，可分享给其他人。', 'ID copied. Ready to share.'));
  } catch (e) {
    notify(publicError(e), 'error');
  }
}
function formatDate(value) {
  return new Date(value).toLocaleString(locale.value === 'en' ? 'en-US' : 'zh-CN');
}
async function loadList() {
  const request = ++requestNumber;
  loading.value = true;
  notify('');
  failed.value = false;
  const params = new URLSearchParams({
    scope: 'public',
    page: String(page.value),
    search: applied.value.search,
    sort: applied.value.sort,
    collection: applied.value.collection,
  });
  if (applied.value.language) params.set('language', applied.value.language);
  for (const key of ['download', 'chat']) if (applied.value[key]) params.set(key, 'true');
  try {
    const result = await api(`/skills?${params}`);
    if (request !== requestNumber) return;
    items.value = result.items;
    total.value = result.total;
    if (page.value > pages.value) {
      await navigate('explore', { ...applied.value, page: pages.value }, true);
      return;
    }
    await nextTick();
    restoreScroll();
  } catch (e) {
    if (request === requestNumber) {
      items.value = [];
      total.value = 0;
      error(e);
    }
  } finally {
    if (request === requestNumber) loading.value = false;
  }
}
function searchSkills() {
  const target = pageUrl('explore', { ...filters, page: 1 });
  if (filters.collection !== 'all' && !auth.user) return signIn(target);
  return target === currentUrl() ? loadList() : navigateUrl(target);
}
function resetFilters() {
  Object.assign(filters, defaults());
  return searchSkills();
}
function changePage(value) {
  return navigate('explore', { ...applied.value, page: value });
}
function openDetail(id) {
  return navigate('detail', { id });
}
async function loadDetail() {
  const request = ++detailRequest;
  detail.value = null;
  detailLoading.value = true;
  notify('');
  failed.value = false;
  try {
    if (!validId(detailId.value)) throw new Error(tr('Skill ID 无效', 'Invalid Skill ID'));
    const result = await api(`/skills/${detailId.value}/public`);
    if (request === detailRequest) {
      detail.value = result;
      loadModels(request);
      const intent = auth.user ? takeSkillIntent(result.id) : null;
      if (intent === 'download') await download(result);
      if (intent === 'like' && !result.liked) await react(result, 'like');
      if (intent === 'favorite' && !result.favorited) await react(result, 'favorite');
    }
  } catch (e) {
    if (request === detailRequest) error(e);
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
  await nextTick();
  restoreScroll();
}
async function loadModels(request) {
  modelChoices.value = [];
  modelError.value = '';
  modelsLoading.value = false;
  if (!auth.user) return;
  modelsLoading.value = true;
  try {
    const result = await api('/model-profiles');
    if (request !== detailRequest) return;
    modelChoices.value = result.profiles;
    if (!modelChoices.value.some((m) => m.id === selectedModel.value))
      selectedModel.value = result.default_profile_id || '';
  } catch (e) {
    if (request === detailRequest) modelError.value = publicError(e);
  } finally {
    if (request === detailRequest) modelsLoading.value = false;
  }
}
function backToResults() {
  return backToExplore();
}
async function react(skill, kind) {
  if (!auth.user) {
    return signInForSkill(skill, kind);
  }
  if (reacting.has(skill.id)) return;
  reacting.add(skill.id);
  notify('');
  try {
    const state = await api(`/skills/${skill.id}/reactions/${kind}`, {
      method: 'PUT',
      body: { active: !(kind === 'like' ? skill.liked : skill.favorited) },
    });
    Object.assign(skill, state);
    const card = items.value.find((s) => s.id === skill.id);
    if (card) Object.assign(card, state);
    if (!props.detailPage && (applied.value.collection !== 'all' || applied.value.sort === 'likes'))
      await loadList();
    notify(
      kind === 'like'
        ? state.liked
          ? tr('已喜欢', 'Liked')
          : tr('已取消喜欢', 'Like removed')
        : state.favorited
          ? tr('已收藏', 'Saved')
          : tr('已取消收藏', 'Removed from saved Skills'),
    );
  } catch (e) {
    notify(publicError(e), 'error');
  } finally {
    reacting.delete(skill.id);
  }
}
async function download(skill) {
  if (!auth.user) {
    return signInForSkill(skill, 'download');
  }
  if (downloading.value) return;
  downloading.value = skill.id;
  notify('');
  try {
    const blob = await api(
      `/skills/${skill.id}/export?scope=public&version=${skill.published_version_id}`,
      { download: true },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `${skill.slug}-${skill.version}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(tr('已开始下载 Skill 包。', 'Skill package download started.'));
  } catch (e) {
    notify(publicError(e), 'error');
  } finally {
    downloading.value = '';
  }
}
function loadRoute() {
  if (props.detailPage) return loadDetail();
  rememberExplore(props.query);
  return loadList();
}
watch(
  () => auth.user?.id,
  () => {
    items.value = [];
    detail.value = null;
    if (props.active) loadRoute();
  },
);
watch(
  () => props.active,
  (active) => {
    if (active) loadRoute();
  },
);
onMounted(loadRoute);
onUnmounted(() => {
  requestNumber++;
  detailRequest++;
});
</script>

<style>
.explore-skills .filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.explore-skills .filters .search-field {
  margin-bottom: 20px;
}
.explore-skills .reaction-actions {
  margin-top: 12px;
}
.platform .reaction-actions .selected,
.explore-skills .native-button.selected {
  background: #e4ede3;
  color: #28563d;
  border-color: #90b19a;
}
.explore-skills .detail-heading {
  margin-top: 28px;
}
.explore-skills .public-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.explore-skills h3 {
  overflow-wrap: anywhere;
}
@media (max-width: 740px) {
  .explore-skills .filter-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
