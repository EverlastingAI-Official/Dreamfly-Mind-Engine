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
  if (locale.value === 'zh') return error.message;
  return (
    {
      LOGIN_REQUIRED: 'Please sign in to continue.',
      NOT_FOUND: 'This Skill is unavailable, has changed, or is no longer public.',
      INVALID_QUERY: 'Please check your search filters.',
      INTERNAL_ERROR: 'The service is temporarily unavailable. Please try again.',
      MODEL_NETWORK_BLOCKED:
        'The backend cannot access the model service. Restart it with network access enabled.',
      ORIGIN_REJECTED: 'This request could not be verified. Please reload the page.',
      CSRF_REJECTED: 'Your session has changed. Please sign in again.',
      INVALID_LOGIN: 'The email or password is incorrect, or the account is unavailable.',
      INVALID_CODE: 'The verification code is invalid, expired or already used.',
      INVALID_EMAIL: 'Please enter a valid email address.',
      INVALID_PASSWORD: 'Use 8–128 characters including letters and digits.',
      RATE_LIMIT: 'Too many requests. Please try again later.',
    }[error.code] || 'The request failed. Please try again.'
  );
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
