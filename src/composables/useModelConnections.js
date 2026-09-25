import { ref, computed } from 'vue';
import { api } from '../services/platform.js';
export function useModelConnections({ notify }) {
  const profiles = ref([]),
    defaultProfile = ref(''),
    selectedProfile = ref(''),
    providerCatalog = ref([]),
    modelList = ref([]);
  const modelForm = ref({});
  const modelsLoading = ref(false),
    modelsLoaded = ref(false),
    modelListError = ref('');
  const canLoadModels = computed(
    () => !!(modelForm.value.api_key?.trim() || modelForm.value.api_key_configured),
  );
  const selectableProviders = computed(() =>
    providerCatalog.value.filter((p) => p.id !== 'custom' || modelForm.value.provider === 'custom'),
  );
  let modelListRequest = 0;
  async function loadProfiles() {
    const data = await api('/model-profiles');
    profiles.value = data.profiles;
    defaultProfile.value = data.default_profile_id;
    if (!profiles.value.some((x) => x.id === selectedProfile.value))
      selectedProfile.value = defaultProfile.value || '';
  }
  function invalidateModels() {
    modelListRequest++;
    modelsLoading.value = false;
    modelsLoaded.value = false;
    modelListError.value = '';
    modelList.value = [];
  }
  function resetModel() {
    invalidateModels();
    const p = providerCatalog.value.find((x) => x.id === 'deepseek');
    modelForm.value = {
      name: '',
      provider: p?.id || 'deepseek',
      protocol: p?.protocol,
      base_url: p?.base_url || '',
      model: '',
      api_key: '',
      consent: false,
    };
  }
  function providerChanged() {
    invalidateModels();
    const p = providerCatalog.value.find((x) => x.id === modelForm.value.provider);
    Object.assign(modelForm.value, {
      base_url: p.base_url,
      protocol: p.protocol,
      model: '',
      api_key: '',
      api_key_configured: false,
      consent: false,
    });
  }
  function modelKeyChanged() {
    invalidateModels();
    modelForm.value.model = '';
  }
  function editModel(p) {
    invalidateModels();
    modelForm.value = {
      ...JSON.parse(JSON.stringify(p)),
      api_key: '',
    };
    modelList.value = [
      {
        id: p.model,
        name: p.model,
      },
    ];
    autoLoadModels();
  }
  async function saveModel(action) {
    const f = modelForm.value;
    if (!f.model) throw new Error('请先获取模型列表并选择模型');
    const data = await api(f.id ? `/model-profiles/${f.id}` : '/model-profiles', {
      method: f.id ? 'PATCH' : 'POST',
      body: {
        ...f,
        api_key: f.api_key.trim(),
        api_key_action: action || (f.api_key.trim() ? 'replace' : 'keep'),
      },
    });
    modelForm.value = {
      ...data,
      api_key: '',
    };
    await loadProfiles();
    notify('配置已保存，请测试连接');
  }
  async function testModel() {
    await saveModel();
    await api(`/model-profiles/${modelForm.value.id}/test`, {
      method: 'POST',
    });
    await loadProfiles();
    modelForm.value = {
      ...profiles.value.find((x) => x.id === modelForm.value.id),
      api_key: '',
    };
    notify('连接测试通过，可设为默认');
  }
  async function clearKey() {
    const saved = profiles.value.find((p) => p.id === modelForm.value.id);
    await api(`/model-profiles/${saved.id}`, {
      method: 'PATCH',
      body: {
        ...saved,
        api_key_action: 'clear',
      },
    });
    await loadProfiles();
    editModel(profiles.value.find((p) => p.id === saved.id));
    notify('密钥已清除');
  }
  function autoLoadModels() {
    if (canLoadModels.value && !modelsLoaded.value && !modelsLoading.value) loadModelList();
  }
  async function loadModelList() {
    if (!canLoadModels.value || modelsLoading.value) return;
    const request = ++modelListRequest,
      f = modelForm.value;
    modelsLoading.value = true;
    modelListError.value = '';
    try {
      const models = await api(`/model-providers/${f.provider}/models`, {
        method: 'POST',
        body: {
          api_key: f.api_key.trim(),
          ...(f.id
            ? {
                profile_id: f.id,
              }
            : {}),
        },
      });
      if (request !== modelListRequest) return;
      modelList.value = models;
      modelsLoaded.value = true;
      if (!models.some((m) => m.id === f.model)) f.model = '';
    } catch (e) {
      if (request === modelListRequest)
        modelListError.value = e.message + '；请检查 API Key 或网络后重试。';
    } finally {
      if (request === modelListRequest) modelsLoading.value = false;
    }
  }
  async function setDefault(p) {
    await api('/users/me/default-model-profile', {
      method: 'PUT',
      body: {
        profile_id: p.id,
      },
    });
    await loadProfiles();
    notify('已设为默认连接');
  }
  async function deleteModel(p) {
    if (!window.confirm('删除连接后，使用此连接的会话需要重新选择模型。继续？')) return;
    await api(`/model-profiles/${p.id}`, {
      method: 'DELETE',
    });
    await loadProfiles();
    if (modelForm.value.id === p.id) resetModel();
  }
  return {
    profiles,
    defaultProfile,
    selectedProfile,
    providerCatalog,
    modelList,
    modelForm,
    modelsLoading,
    modelsLoaded,
    modelListError,
    canLoadModels,
    selectableProviders,
    loadProfiles,
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
  };
}
