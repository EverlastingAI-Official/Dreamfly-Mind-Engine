export class ApiError extends Error {
  constructor(message, code, details, status) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
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
    const result = await request(`${base}${path}`, {
      ...options,
      credentials: 'same-origin',
      headers,
      body: options.body === undefined || multipart ? options.body : JSON.stringify(options.body),
    });
    if (!result.ok) {
      if (result.status === 401 && session().csrf === csrf) clearSession();
      const payload = result.headers.get('content-type')?.includes('json')
        ? await result.json()
        : null;
      throw new ApiError(
        payload?.error?.message || '请求失败，请稍后重试',
        payload?.error?.code || 'HTTP_ERROR',
        payload?.error?.details,
        result.status,
      );
    }
    return result;
  }
  async function api(path, { download, ...options } = {}) {
    const result = await response(path, options);
    return download ? result.blob() : (await result.json()).data;
  }
  async function sendMessage(conversation, content, onEvent, signal) {
    const result = await response(`/conversations/${conversation}/messages`, {
      method: 'POST',
      signal,
      body: { content, client_request_id: crypto.randomUUID() },
    });
    if (!result.headers.get('content-type')?.includes('text/event-stream'))
      return (await result.json()).data;
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
          onEvent(event, JSON.parse(data));
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
