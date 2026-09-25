import { readFileSync } from 'node:fs';
import path from 'node:path';

export function secret(name: string, required = false): string {
  const value = process.env[`${name}_FILE`] ? readFileSync(process.env[`${name}_FILE`]!, 'utf8').trim() : process.env[name] || '';
  if (required && !value) throw new Error(`Missing ${name} or ${name}_FILE`);
  return value;
}
const num = (key: string, fallback: number) => Number(process.env[key] || fallback);
export const config = {
  production: process.env.NODE_ENV === 'production',
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
  host: process.env.HOST || '127.0.0.1', port: num('PORT', 3001),
  cookie: process.env.SESSION_COOKIE_NAME || (process.env.NODE_ENV === 'production' ? '__Host-dreamfly_session' : 'dreamfly_session_dev'),
  idle: num('SESSION_IDLE_SECONDS', 86400), absolute: num('SESSION_ABSOLUTE_SECONDS', 604800),
  codeTTL: num('EMAIL_CODE_TTL_SECONDS', 600), resend: num('EMAIL_CODE_RESEND_SECONDS', 60), attempts: num('EMAIL_CODE_MAX_ATTEMPTS', 5),
  assets: path.resolve(process.env.ASSET_STORAGE_DIR || '../data/assets'),
  keyVersion: process.env.API_KEY_ENCRYPTION_KEY_VERSION || '1',
  concurrency: num('MODEL_USER_MAX_CONCURRENCY', 2),
  modelTimeout: num('MODEL_TIMEOUT_SECONDS',120),
  uploadJSON: num('UPLOAD_JSON_MAX_BYTES',10485760), uploadZIP: num('UPLOAD_ZIP_MAX_BYTES',52428800),
  extracted: num('UPLOAD_EXTRACTED_MAX_BYTES',104857600), uploadFiles: num('UPLOAD_MAX_FILES',100),
  lease: num('WORKER_JOB_LEASE_SECONDS',120),
  githubEnabled: process.env.GITHUB_SYNC_ENABLED === 'true',
};
if (config.production && (!config.origin.startsWith('https://') || !config.cookie.startsWith('__Host-'))) {
  throw new Error('Production requires HTTPS origin and a __Host- session cookie');
}
