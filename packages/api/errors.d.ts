import definitions from './errors.json';

export type ErrorCode = keyof typeof definitions;
export interface ErrorInfo {
  status: number;
  zh: string;
  en: string;
}
export const errorDefinitions: typeof definitions;
export function errorInfo(code: string): ErrorInfo;
export function isErrorCode(code: unknown): code is ErrorCode;
export interface ApiFailure {
  code: ErrorCode;
  message: string;
  details?: unknown;
}
export interface ErrorResponse {
  error: ApiFailure;
  request_id: string;
}
export interface SuccessResponse<T> {
  data: T;
  request_id: string;
}
