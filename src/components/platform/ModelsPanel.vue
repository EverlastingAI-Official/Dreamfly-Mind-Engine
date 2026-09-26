<template>
  <text class="eyebrow">YOUR MODELS</text>
  <h1>选择你的思考引擎。</h1>
  <p class="lead">选择厂商，填写 API Key，再选择模型。密钥仅由服务端加密保存。</p>
  <view class="editor-grid">
    <view class="panel">
      <view class="section-heading">
        <h2>{{ modelForm.id ? '编辑连接' : '新增模型连接' }}</h2>
        <n-button class="small" :disabled="busy" @click="createModel"> 新建 </n-button>
      </view>
      <n-label>
        连接名称
        <n-input v-model="modelForm.name" :disabled="busy" placeholder="我的 DeepSeek" />
      </n-label>
      <n-label>
        厂商
        <select v-model="modelForm.provider" :disabled="busy" @change="providerChanged">
          <option
            v-for="p in selectableProviders"
            :value="p.id"
            :key="p.id"
            :disabled="p.id === 'custom'"
          >
            {{ p.name }}
          </option>
        </select>
      </n-label>
      <n-label>
        API 地址
        <n-input :model-value="modelForm.base_url" readonly />
      </n-label>
      <n-label>
        API Key
        <n-input
          v-model="modelForm.api_key"
          :disabled="busy"
          type="password"
          autocomplete="off"
          :placeholder="
            modelForm.api_key_configured ? '已保存；留空保留原密钥' : '输入 API Key 后获取模型'
          "
          @input="modelKeyChanged"
          @blur="autoLoadModels"
        />
      </n-label>
      <n-label>
        模型
        <select v-model="modelForm.model" :disabled="busy || modelsLoading || !modelList.length">
          <option value="" disabled>
            {{
              modelsLoading ? '正在获取模型…' : modelList.length ? '请选择模型' : '请先获取模型列表'
            }}
          </option>
          <option v-for="m in modelList" :key="m.id" :value="m.id">
            {{ m.name === m.id ? m.id : m.name + ' · ' + m.id }}
          </option>
        </select>
      </n-label>
      <view class="row">
        <n-button
          class="small"
          :disabled="busy || modelsLoading || !canLoadModels"
          @click="loadModelList"
        >
          {{ modelsLoading ? '正在获取…' : modelList.length ? '刷新模型列表' : '获取模型列表' }}
        </n-button>
        <text class="muted">无需先保存连接</text>
      </view>
      <p v-if="modelListError" class="model-list-error" role="alert">
        {{ modelListError }}
      </p>
      <p v-else-if="modelsLoaded && !modelList.length" class="muted">
        此 API Key 暂未返回可用的对话模型，请检查厂商账号权限后重试。
      </p>
      <n-label class="check">
        <n-input v-model="modelForm.consent" :disabled="busy" type="checkbox" />
        同意将对话及获准使用的人格、记忆发送至此厂商
      </n-label>
      <p class="muted">测试连接会发送最小请求，可能产生少量模型费用。</p>
      <view class="row">
        <n-button
          class="primary"
          :disabled="busy || modelsLoading || !modelForm.model"
          @click="run(saveModel)"
        >
          保存配置
        </n-button>
        <n-button
          :disabled="
            busy || modelsLoading || !modelForm.model || !canLoadModels || !modelForm.consent
          "
          @click="run(testModel)"
        >
          保存并测试
        </n-button>
        <n-button
          v-if="modelForm.api_key_configured"
          :disabled="busy"
          class="danger"
          @click="run(clearKey)"
        >
          清除密钥
        </n-button>
      </view>
    </view>
    <view>
      <view v-for="p in profiles" :key="p.id" class="panel">
        <view class="row spaced">
          <h3>{{ p.name }}</h3>
          <text class="badge">
            {{ defaultProfile === p.id ? '默认连接' : p.verified_at ? '已验证' : '未验证' }}
          </text>
        </view>
        <p>{{ p.model }}</p>
        <p class="muted">
          {{ p.provider }} ·
          {{ p.api_key_configured ? '已保存密钥' : '缺少密钥' }}
        </p>
        <view class="row">
          <n-button class="small" :disabled="busy" @click="selectModel(p)"> 编辑 </n-button>
          <n-button
            class="small"
            :disabled="busy || !p.verified_at"
            @click="run(() => setDefault(p))"
          >
            设为默认
          </n-button>
          <n-button class="small danger" :disabled="busy" @click="run(() => deleteModel(p))">
            删除
          </n-button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onMounted } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { useModelConnections } from '../../composables/useModelConnections.js';
import { api } from '../../services/platform.js';
const { busy, run, notify } = usePageUi();
import { NInput, NButton, NLabel } from '../native.js';
const {
  profiles,
  defaultProfile,
  modelList,
  modelForm,
  modelsLoading,
  modelsLoaded,
  modelListError,
  canLoadModels,
  selectableProviders,
  resetModel,
  providerChanged,
  modelKeyChanged,
  editModel,
  saveModel,
  testModel,
  clearKey,
  autoLoadModels,
  loadModelList,
  setDefault,
  deleteModel,
  providerCatalog,
  loadProfiles,
} = useModelConnections({ notify });
function createModel() {
  resetModel();
  notify('已打开新连接表单，请填写后保存', 'info');
}
function selectModel(profile) {
  editModel(profile);
  notify('正在编辑连接：' + profile.name, 'info');
}
onMounted(() =>
  run(async () => {
    providerCatalog.value = await api('/model-providers');
    await loadProfiles();
    resetModel();
  }),
);
</script>
