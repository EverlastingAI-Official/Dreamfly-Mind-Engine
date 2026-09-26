import type { ApiClient, ClientOptions, ErrorCode } from '../../packages/api/index.js';
export class ApiError extends Error {
  constructor(
    message: string,
    code: ErrorCode,
    details?: unknown,
    status?: number,
    requestId?: string,
  );
  code: ErrorCode;
  details?: unknown;
  status?: number;
  requestId?: string;
}
export function createClient(options: ClientOptions): ApiClient;
