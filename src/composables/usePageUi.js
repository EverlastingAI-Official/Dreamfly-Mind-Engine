import { inject, ref } from 'vue';
import { publicError, tr } from '../services/locale.js';

export const pageUiKey = Symbol('page-ui');
export const usePageUi = () => inject(pageUiKey);
export function createPageUi(feedback) {
  const busy = ref(false);
  // Business panels keep their own submission lock, while the workspace owns
  // notices so authentication-related remounts cannot discard an action's error.
  const notice = feedback?.notice || ref('');
  const noticeType = feedback?.noticeType || ref('');
  function notify(message, type = 'success') {
    notice.value = message;
    noticeType.value = type;
  }
  async function run(action) {
    if (busy.value) {
      notify(
        tr('正在处理上一项操作，请稍候。', 'Please wait for the current action to finish.'),
        'info',
      );
      return;
    }
    busy.value = true;
    notice.value = '';
    try {
      return await action();
    } catch (error) {
      notify(publicError(error), 'error');
    } finally {
      busy.value = false;
    }
  }
  return { busy, notice, noticeType, notify, run };
}
