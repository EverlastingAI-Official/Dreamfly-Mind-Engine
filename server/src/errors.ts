import type { FastifyRequest } from 'fastify';
import { errorInfo, type ErrorCode, type ApiFailure } from '../../packages/api/errors.js';
export class HttpError extends Error {
  public statusCode: number;
  constructor(
    public code: ErrorCode,
    message: string = errorInfo(code).zh,
    public details?: unknown,
  ) {
    super(message);
    this.statusCode = errorInfo(code).status;
  }
}
export interface RequestFailure {
  code?: string;
  status?: number;
  statusCode?: number;
  message?: string;
  response?: { headers?: Record<string, string | number> };
}
export function requestFailure(error: unknown): RequestFailure {
  return error && typeof error === 'object' ? (error as RequestFailure) : {};
}
export function check(condition: unknown, code: ErrorCode, message?: string): asserts condition {
  if (!condition) throw new HttpError(code, message);
}
export function publicFailure(error: unknown, fallback: ErrorCode = 'INTERNAL_ERROR'): ApiFailure {
  return error instanceof HttpError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: fallback, message: errorInfo(fallback).zh };
}
export function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const failure = requestFailure(error);
  if (failure.code === '23505') return new HttpError('ALREADY_EXISTS');
  const codes: Record<number, ErrorCode> = {
    400: 'INVALID_REQUEST',
    401: 'LOGIN_REQUIRED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    413: 'FILE_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    422: 'INVALID_BODY',
    429: 'RATE_LIMIT',
  };
  return new HttpError(codes[failure.statusCode || 500] || 'INTERNAL_ERROR');
}
export const body = <T = Record<string, unknown>>(r: FastifyRequest): T => {
  check(r.body && typeof r.body === 'object' && !Array.isArray(r.body), 'INVALID_BODY');
  return r.body as T;
};
export const params = (r: FastifyRequest) => r.params as Record<string, string>;
export const query = (r: FastifyRequest) => (r.query || {}) as Record<string, string>;
export function text(value: unknown, field: string, max = 200, min = 1): string {
  check(
    typeof value === 'string' && value.trim().length >= min && value.length <= max,
    'INVALID_FIELD',
    `${field} 长度须为 ${min}–${max}`,
  );
  return value.trim();
}
export function id(value: unknown): string {
  check(
    typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value),
    'INVALID_ID',
  );
  return value;
}
