import { ref, nextTick, onScopeDispose } from 'vue';
import { api, sendMessage } from '../services/platform.js';
import { navigate, validId } from '../services/navigation.mjs';
import { tr, publicError } from '../services/locale.js';
export function useConversations({ notify }) {
  const conversations = ref([]),
    currentConversation = ref(null),
    messages = ref([]);
  const input = ref(''),
    generating = ref(false),
    stopping = ref(false),
    messageBox = ref(null);
  const page = ref(1),
    hasMore = ref(false);
  let generationId,
    controller,
    disposed = false;
  onScopeDispose(() => {
    disposed = true;
    controller?.abort();
  });
  async function loadConversations(targetPage = page.value) {
    const items = await api('/conversations?page=' + targetPage + '&page_size=50');
    page.value = targetPage;
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
    messages.value = history;
  }
  async function load(id) {
    await loadConversations();
    if (id) await loadConversation(id);
  }
  const openConversation = (conversation) => navigate('chat', { id: conversation.id });
  function scrollMessages() {
    return nextTick(() => {
      const element = messageBox.value?.$el || messageBox.value;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }
  async function chat() {
    if (generating.value || !currentConversation.value || !input.value.trim()) return;
    const conversationId = currentConversation.value.id,
      content = input.value;
    input.value = '';
    generating.value = true;
    notify('');
    controller = new AbortController();
    messages.value.push({ id: crypto.randomUUID(), role: 'user', content, status: 'completed' });
    scrollMessages();
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
            notify(publicError(data.error), 'error');
          }
          scrollMessages();
        },
        controller.signal,
      );
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') {
        failed = true;
        if (!assistantId) input.value = content;
        notify(publicError(error), 'error');
      }
    } finally {
      controller = null;
      generationId = null;
      if (!disposed) {
        try {
          messages.value = await api('/conversations/' + conversationId + '/messages');
        } catch (error) {
          if (!failed) notify(publicError(error), 'error');
        }
      }
      generating.value = false;
      stopping.value = false;
    }
  }
  async function cancelGeneration() {
    if (stopping.value) return;
    stopping.value = true;
    try {
      if (generationId) {
        await api(
          '/conversations/' +
            currentConversation.value.id +
            '/messages/' +
            generationId +
            '/cancel',
          { method: 'POST' },
        );
        notify('已请求停止生成', 'info');
      } else {
        controller?.abort();
        notify('已停止生成', 'info');
      }
    } catch (error) {
      stopping.value = false;
      throw error;
    }
  }
  async function renameConversation() {
    const conversation = currentConversation.value;
    const title = window.prompt('新的会话名称', conversation.title);
    if (!title) return;
    await api('/conversations/' + conversation.id, { method: 'PATCH', body: { title } });
    conversation.title = title;
    await loadConversations();
    notify('会话已重命名');
  }
  async function deleteConversation() {
    if (!window.confirm('删除此会话及其消息？')) return;
    await api('/conversations/' + currentConversation.value.id, { method: 'DELETE' });
    await navigate('chat', {}, true, '会话已删除');
  }
  return {
    conversations,
    currentConversation,
    messages,
    input,
    generating,
    stopping,
    messageBox,
    page,
    hasMore,
    load,
    loadConversations,
    openConversation,
    chat,
    cancelGeneration,
    renameConversation,
    deleteConversation,
  };
}
