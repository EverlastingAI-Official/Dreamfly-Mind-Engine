import { errorInfo, isErrorCode } from '../../packages/api/errors.js';

export class ApiError extends Error {
  constructor(message, code, details, status, requestId) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
    this.requestId = requestId;
  }
}

// The transport owns JSON, authentication errors and SSE framing. Vue owns state.
export function createClient({
  base,
  session,
  clearSession,
  fetch: request = (...args) => fetch(...args),
}) {
  async function response(path, options = {}) {
    const csrf = session().csrf;
    const headers = new Headers(options.headers);
    const multipart = options.body instanceof FormData;
    if (options.body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    if (csrf) headers.set('X-CSRF-Token', csrf);
    let result;
    try {
      result = await request(`${base}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers,
        body: options.body === undefined || multipart ? options.body : JSON.stringify(options.body),
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError(errorInfo('NETWORK_ERROR').zh, 'NETWORK_ERROR');
    }
    if (!result.ok) {
      if (result.status === 401 && session().csrf === csrf) clearSession();
      let payload;
      try {
        payload = await result.json();
      } catch {
        /* Proxies may return HTML or malformed JSON. */
      }
      const code = isErrorCode(payload?.error?.code) ? payload.error.code : 'HTTP_ERROR';
      throw new ApiError(
        payload?.error?.message || errorInfo(code).zh,
        code,
        payload?.error?.details,
        result.status,
        payload?.request_id,
      );
    }
    return result;
  }
  async function api(path, { download, ...options } = {}) {
    const result = await response(path, options);
    return download ? result.blob() : readData(result);
  }
  async function readData(result) {
    let payload;
    try {
      payload = await result.json();
    } catch {
      throw new ApiError(
        errorInfo('INVALID_RESPONSE').zh,
        'INVALID_RESPONSE',
        undefined,
        result.status,
      );
    }
    if (!payload || !Object.hasOwn(payload, 'data'))
      throw new ApiError(
        errorInfo('INVALID_RESPONSE').zh,
        'INVALID_RESPONSE',
        undefined,
        result.status,
        payload?.request_id,
      );
    return payload.data;
  }
  async function sendMessage(conversation, content, onEvent, signal) {
    const result = await response(`/conversations/${conversation}/messages`, {
      method: 'POST',
      signal,
      body: { content, client_request_id: crypto.randomUUID() },
    });
    if (!result.headers.get('content-type')?.includes('text/event-stream')) return readData(result);
    const reader = result.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new ApiError('回复连接提前结束，请重试', 'INCOMPLETE_STREAM');
        buffer += decoder.decode(value, { stream: true });
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const lines = buffer.slice(0, match.index).split(/\r?\n/);
          buffer = buffer.slice(match.index + match[0].length);
          const event = lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim();
          const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!event || !data) continue;
          let payload;
          try {
            payload = JSON.parse(data);
          } catch {
            throw new ApiError(errorInfo('INVALID_RESPONSE').zh, 'INVALID_RESPONSE');
          }
          onEvent(event, payload);
          if (['message.completed', 'message.failed', 'message.cancelled'].includes(event)) return;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }
  return { api, sendMessage };
}
