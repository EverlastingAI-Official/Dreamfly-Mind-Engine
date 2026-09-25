import { tr } from './locale.js';
export function validatePassword(value) {
  if (value.length < 8 || value.length > 128 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error(
      tr(
        '密码须为 8–128 位，且包含字母和数字',
        'Use 8–128 characters including letters and digits',
      ),
    );
  }
}
