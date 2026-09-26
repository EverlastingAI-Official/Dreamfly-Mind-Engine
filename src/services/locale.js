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
  const info = errorInfo(isErrorCode(error.code) ? error.code : 'HTTP_ERROR');
  return locale.value === 'en' ? info.en : error.message || info.zh;
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
        '无法自动复制，请手动选择 ID 复制。',
        'Copy failed. Please select and copy the ID manually.',
      ),
    );
}
