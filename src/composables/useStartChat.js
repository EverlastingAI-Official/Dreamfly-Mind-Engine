import { ref } from 'vue';
import { startChat } from '../services/skillActions.js';
import { publicError } from '../services/locale.js';

// Keep startup feedback beside the action, including failures to open the chat page.
export function useStartChat() {
  const starting = ref(false),
    startError = ref('');
  async function beginChat(skill, profileId) {
    if (starting.value) return;
    starting.value = true;
    startError.value = '';
    try {
      await startChat(skill, profileId);
    } catch (error) {
      startError.value = publicError(error);
    } finally {
      starting.value = false;
    }
  }
  return { starting, startError, beginChat };
}
