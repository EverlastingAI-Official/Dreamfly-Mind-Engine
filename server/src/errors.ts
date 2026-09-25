import type { FastifyRequest } from 'fastify';
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function check(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new HttpError(status, code, message);
}
export const body = (r: FastifyRequest): Record<string, any> => {
  check(r.body && typeof r.body === 'object' && !Array.isArray(r.body), 422, 'INVALID_BODY', '请提供 JSON 对象');
  return r.body as Record<string, any>;
};
export const params = (r: FastifyRequest) => r.params as Record<string, string>;
export const query = (r: FastifyRequest) => (r.query || {}) as Record<string, string>;
export function text(value: unknown, field: string, max = 200, min = 1): string {
  check(typeof value === 'string' && value.trim().length >= min && value.length <= max, 422, 'INVALID_FIELD', `${field} 长度须为 ${min}–${max}`);
  return value.trim();
}
export function id(value: unknown): string {
  check(typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value), 422, 'INVALID_ID', '无效的资源 ID');
  return value;
}
