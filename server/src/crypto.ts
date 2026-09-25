import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, secret } from './config.js';
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const codeDigest = (value: string) => createHmac('sha256', secret('EMAIL_CODE_SECRET', true)).update(value).digest('hex');
export function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function key(version: string) {
  const raw = version === config.keyVersion ? secret('API_KEY_ENCRYPTION_KEY', true) : secret(`API_KEY_ENCRYPTION_KEY_V${version}`, true);
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('API encryption key must be 32 bytes encoded as 64 hex characters');
  return Buffer.from(raw, 'hex');
}
export function encrypt(value: string, scope: string) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(config.keyVersion), nonce);
  cipher.setAAD(Buffer.from(scope)); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [config.keyVersion, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function decrypt(value: string, scope: string) {
  const [version, nonce, tag, data] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', key(version), Buffer.from(nonce, 'base64url'));
  cipher.setAAD(Buffer.from(scope)); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8');
}
