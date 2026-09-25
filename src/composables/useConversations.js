import { ref, nextTick, onScopeDispose } from 'vue';
import { api, sendMessage } from '../services/platform.js';
import { navigate, validId } from '../services/navigation.mjs';
import { tr } from '../services/locale.js';
export function useConversations({ notify }) {
  const conversations = ref([]),
    currentConversation = ref(null),
    messages = ref([]);
  const input = ref(''),
    generating = ref(false),
    messageBox = ref(null);
  const profiles = ref([]),
    selectedProfile = ref(''),
    page = ref(1),
    hasMore = ref(false);
  let generationId,
    controller,
    disposed = false;
  onScopeDispose(() => {
    disposed = true;
    controller?.abort();
  });
  async function loadConversations() {
    const items = await api('/conversations?page=' + page.value + '&page_size=50');
    conversations.value = items;
    hasMore.value = items.length === 50;
  }
  async function loadConversation(id) {
    if (!validId(id)) throw new Error(tr('会话 ID 无效', 'Invalid conversation ID'));
    const [conversation, history] = await Promise.all([
      api('/conversations/' + id),
      api('/conversations/' + id + '/messages'),
    ]);
    currentConversation.value = conversation;
    selectedProfile.value = conversation.profile_id || '';
    messages.value = history;
  }
  async function load(id) {
    const connections = await api('/model-profiles');
    profiles.value = connections.profiles;
    await loadConversations();
    if (id) await loadConversation(id);
  }
  const openConversation = (conversation) => navigate('chat', { id: conversation.id });
  async function chat() {
    if (generating.value || !currentConversation.value || !input.value.trim()) return;
    const conversationId = currentConversation.value.id,
      content = input.value;
    input.value = '';
    generating.value = true;
    notify('');
    controller = new AbortController();
    messages.value.push({ id: crypto.randomUUID(), role: 'user', content, status: 'completed' });
    let assistantId,
      failed = false;
    try {
      await sendMessage(
        conversationId,
        content,
        (event, data) => {
          if (event === 'message.start') {
            generationId = data.id;
            assistantId = data.id;
            messages.value.push({
              id: data.id,
              role: 'assistant',
              content: '',
              status: 'generating',
            });
          }
          const assistant = messages.value.find((message) => message.id === assistantId);
          if (event === 'message.delta' && assistant) assistant.content += data.text;
          if (data.status && assistant)
            Object.assign(assistant, { status: data.status, usage: data.usage });
          if (event === 'message.failed') {
            failed = true;
            notify(data.message || '生成失败', 'error');
          }
          nextTick(() => {
            const element = messageBox.value?.$el || messageBox.value;
            if (element) element.scrollTop = element.scrollHeight;
          });
        },
        controller.signal,
      );
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') {
        failed = true;
        notify(error.message, 'error');
      }
    } finally {
      generating.value = false;
      controller = null;
      generationId = null;
      if (!disposed) {
        try {
          messages.value = await api('/conversations/' + conversationId + '/messages');
        } catch (error) {
          if (!failed) notify(error.message, 'error');
        }
      }
    }
  }
  async function cancelGeneration() {
    if (generationId) {
      await api(
        '/conversations/' + currentConversation.value.id + '/messages/' + generationId + '/cancel',
        { method: 'POST' },
      );
    } else controller?.abort();
  }
  async function switchModel() {
    const id = currentConversation.value.id;
    await api('/conversations/' + id + '/model-profile', {
      method: 'PUT',
      body: { profile_id: selectedProfile.value },
    });
    await loadConversation(id);
    await loadConversations();
    notify('后续消息将使用所选模型');
  }
  async function renameConversation() {
    const conversation = currentConversation.value;
    const title = window.prompt('新的会话名称', conversation.title);
    if (!title) return;
    await api('/conversations/' + conversation.id, { method: 'PATCH', body: { title } });
    conversation.title = title;
    await loadConversations();
  }
  async function deleteConversation() {
    if (!window.confirm('删除此会话及其消息？')) return;
    await api('/conversations/' + currentConversation.value.id, { method: 'DELETE' });
    await navigate('chat', {}, true);
  }
  return {
    conversations,
    currentConversation,
    messages,
    input,
    generating,
    messageBox,
    profiles,
    selectedProfile,
    page,
    hasMore,
    load,
    loadConversations,
    openConversation,
    chat,
    cancelGeneration,
    switchModel,
    renameConversation,
    deleteConversation,
  };
}
