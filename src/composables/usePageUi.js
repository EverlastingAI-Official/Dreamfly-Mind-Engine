import { inject, ref } from 'vue';
import { publicError } from '../services/locale.js';

export const pageUiKey = Symbol('page-ui');
export const usePageUi = () => inject(pageUiKey);
export function createPageUi() {
  const busy = ref(false);
  const notice = ref('');
  const noticeType = ref('');
  function notify(message, type = 'success') {
    notice.value = message;
    noticeType.value = type;
  }
  async function run(action) {
    if (busy.value) return;
    busy.value = true;
    notice.value = '';
    try {
      return await action();
    } catch (error) {
      notify(error.code ? publicError(error) : error.message, 'error');
    } finally {
      busy.value = false;
    }
  }
  return { busy, notice, noticeType, notify, run };
}
