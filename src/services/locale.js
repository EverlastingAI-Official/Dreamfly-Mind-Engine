import { errorInfo, isErrorCode } from '../../packages/api/errors.js';
import { ref, watch } from 'vue';

const saved = uni.getStorageSync('dreamfly-language');
export const locale = ref(saved === 'en' || saved === 'zh' ? saved : 'zh');
export const tr = (zh, en) => (locale.value === 'en' ? en : zh);
watch(
  locale,
  (value) => {
    uni.setStorageSync('dreamfly-language', value);
    document.documentElement.lang = value === 'en' ? 'en' : 'zh-CN';
  },
  { immediate: true },
);

export function publicError(error) {
  const known = isErrorCode(error?.code);
  const info = errorInfo(known ? error.code : 'HTTP_ERROR');
  if (locale.value === 'en' && known) return info.en;
  return error?.message || error?.errMsg || info[locale.value];
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied)
    throw new Error(
      tr(
        '复制失败，请检查剪贴板权限后重试。',
        'Copy failed. Please check clipboard permissions and try again.',
      ),
    );
}
