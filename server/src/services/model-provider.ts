import ipaddr from 'ipaddr.js';
import dns from 'node:dns/promises';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { decrypt } from '../crypto.js';
import { check, HttpError } from '../errors.js';
import type { ChatMessage, ModelEvent, ModelProfile, Usage } from '../types.js';

export const providers = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-chat', base_url: 'https://api.openai.com/v1' },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai-chat',
    base_url: 'https://api.deepseek.com/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-chat',
    base_url: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    protocol: 'openai-chat',
    base_url: 'https://api.siliconflow.cn/v1',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic-messages',
    base_url: 'https://api.anthropic.com',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini-generate-content',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
  },
  { id: 'custom', name: '自定义 HTTPS 服务', protocol: 'openai-chat', base_url: '' },
];
export function publicAddress(address: string) {
  try {
    let a = ipaddr.parse(address);
    if (a.kind() === 'ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress())
      a = (a as ipaddr.IPv6).toIPv4Address();
    return a.range() === 'unicast';
  } catch {
    return false;
  }
}
export function providerProxyAddress(raw: string, address: string) {
  const url = new URL(raw);
  const preset = providers.some(
    (p) =>
      p.id !== 'custom' &&
      url.origin === new URL(p.base_url).origin &&
      (url.pathname === new URL(p.base_url).pathname ||
        url.pathname.startsWith(new URL(p.base_url).pathname.replace(/\/$/, '') + '/')),
  );
  // Local proxy Fake-IP mode uses this range. Only fixed vendor endpoints may use it.
  return (
    preset &&
    ipaddr.isValid(address) &&
    ipaddr.parse(address).kind() === 'ipv4' &&
    ipaddr.parse(address).match(ipaddr.parseCIDR('198.18.0.0/15'))
  );
}
export async function checkedURL(raw: string, allowProviderProxy = false) {
  const url = new URL(raw);
  check(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      !url.hash,
    422,
    'UNSAFE_ENDPOINT',
    '仅支持公开 HTTPS 地址和 443 端口',
  );
  const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  check(
    addresses.length &&
      addresses.every(
        (x) =>
          publicAddress(x.address) || (allowProviderProxy && providerProxyAddress(raw, x.address)),
      ),
    422,
    'UNSAFE_ENDPOINT',
    '不能访问回环、私有或保留网络',
  );
  return { url, addresses };
}
export async function upstream(
  raw: string,
  method: string,
  headers: Record<string, string>,
  data: unknown,
  signal?: AbortSignal,
  timeout = 120000,
) {
  const { url, addresses } = await checkedURL(raw, true);
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    // Bind the connection to the addresses just validated, while preserving hostname/SNI.
    const lookup: LookupFunction = (_host, options, cb) =>
      options.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family);
    const req = https.request(url, { method, headers, lookup, signal }, (res) => {
      if ((res.statusCode || 500) >= 300) {
        res.resume();
        reject(
          new HttpError(
            502,
            `UPSTREAM_${res.statusCode}`,
            res.statusCode === 401 || res.statusCode === 403
              ? '模型凭据无效或无权限'
              : res.statusCode === 429
                ? '模型服务限流，请稍后重试'
                : `模型服务返回 ${res.statusCode}`,
          ),
        );
      } else resolve(res);
    });
    const timer = setTimeout(() => req.destroy(new Error('模型请求超时')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EACCES' || error.code === 'EPERM'
          ? new HttpError(
              503,
              'MODEL_NETWORK_BLOCKED',
              '后端运行环境禁止连接模型服务，请以允许联网的方式重启后端',
            )
          : error,
      );
    });
    if (data !== undefined) req.write(JSON.stringify(data));
    req.end();
  });
}
export async function responseJSON<T = unknown>(res: AsyncIterable<Buffer>): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of res) {
    size += c.length;
    check(size < 8 * 1024 * 1024, 502, 'UPSTREAM_TOO_LARGE', '上游响应过大');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function* sseEvents<T = unknown>(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    check(buffer.length < 2 * 1024 * 1024, 502, 'INVALID_STREAM', '流事件过大');
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = block
        .split(/\r?\n/)
        .filter((x) => x.startsWith('data:'))
        .map((x) => x.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  check(
    !buffer.trim() || buffer.trim().startsWith(':'),
    502,
    'INCOMPLETE_STREAM',
    '模型流未完整结束',
  );
}
export type Message = ChatMessage;
function modelHeaders(protocol: string, key: string): Record<string, string> {
  if (protocol === 'anthropic-messages')
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (protocol === 'gemini-generate-content') return { 'x-goog-api-key': key };
  return { Authorization: `Bearer ${key}` };
}
type ModelEndpoint = { provider: string; protocol: string; base_url: string };
type ModelOption = { id: string; name: string };
export async function listModels(
  p: ModelEndpoint,
  key: string,
  request = async (url: string, headers: Record<string, string>) =>
    responseJSON<ModelList>(await upstream(url, 'GET', headers, undefined, undefined, 30000)),
): Promise<ModelOption[]> {
  const url = new URL(`${p.base_url}${p.protocol === 'anthropic-messages' ? '/v1' : ''}/models`);
  if (p.provider === 'siliconflow') url.searchParams.set('sub_type', 'chat');
  if (p.protocol === 'anthropic-messages') url.searchParams.set('limit', '1000');
  if (p.protocol === 'gemini-generate-content') url.searchParams.set('pageSize', '1000');
  const models = new Map<string, ModelOption>();
  let next: string | undefined;
  do {
    const payload = await request(url.href, modelHeaders(p.protocol, key));
    const entries = payload.data || payload.models;
    check(Array.isArray(entries), 502, 'INVALID_MODEL_LIST', '厂商返回了无法识别的模型列表');
    for (const entry of entries) {
      if (
        p.protocol === 'gemini-generate-content' &&
        !entry.supportedGenerationMethods?.includes('generateContent')
      )
        continue;
      if (
        p.provider === 'openrouter' &&
        entry.architecture?.output_modalities &&
        !entry.architecture.output_modalities.includes('text')
      )
        continue;
      const model = String(entry.id || entry.name || '').replace(/^models\//, '');
      if (!model) continue;
      models.set(model, {
        id: model,
        name: entry.display_name || entry.displayName || entry.name || model,
      });
    }
    const cursor =
      p.protocol === 'gemini-generate-content'
        ? payload.nextPageToken
        : p.protocol === 'anthropic-messages' && payload.has_more
          ? payload.last_id
          : undefined;
    check(!cursor || cursor !== next, 502, 'INVALID_MODEL_LIST', '厂商模型列表分页异常');
    next = cursor;
    if (next)
      url.searchParams.set(
        p.protocol === 'gemini-generate-content' ? 'pageToken' : 'after_id',
        next,
      );
  } while (next);
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export type ModelListTransport = (p: ModelEndpoint, key: string) => Promise<ModelOption[]>;
interface ModelList {
  data?: ModelEntry[];
  models?: ModelEntry[];
  nextPageToken?: string;
  has_more?: boolean;
  last_id?: string;
}
interface ModelEntry {
  id?: string;
  name?: string;
  display_name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  architecture?: { output_modalities?: string[] };
}
interface ProviderEvent {
  error?: unknown;
  type?: string;
  delta?: { type?: string; text?: string };
  usage?: Usage;
  message?: { usage?: Usage };
  usageMetadata?: Usage;
  candidates?: {
    content?: { parts?: { thought?: boolean; text?: string }[] };
    finishReason?: string;
  }[];
  choices?: { delta?: { content?: string }; finish_reason?: string }[];
}
export function requestConfig(p: ModelProfile, messages: Message[], stream = true) {
  check(p.key_cipher, 422, 'NO_KEY', '请输入 API Key');
  const key = decrypt(p.key_cipher, p.user_id + ':' + p.id);
  const headers = { 'Content-Type': 'application/json', ...modelHeaders(p.protocol, key) };
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
  const conversation = messages.filter((message) => message.role !== 'system');
  const maxTokens = p.parameters?.max_tokens || 1024;
  const temperature = p.parameters?.temperature;
  if (p.protocol === 'anthropic-messages') {
    return {
      url: p.base_url + '/v1/messages',
      headers,
      data: {
        model: p.model,
        system,
        messages: conversation,
        max_tokens: maxTokens,
        stream,
        temperature,
      },
    };
  }
  if (p.protocol === 'gemini-generate-content') {
    const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return {
      url: p.base_url + '/models/' + encodeURIComponent(p.model) + ':' + action,
      headers,
      data: {
        systemInstruction: { parts: [{ text: system }] },
        contents: conversation.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      },
    };
  }
  return {
    url: p.base_url + '/chat/completions',
    headers,
    data: {
      model: p.model,
      messages,
      max_tokens: maxTokens,
      stream,
      temperature,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    },
  };
}
export async function* streamChat(
  p: ModelProfile,
  messages: Message[],
  signal: AbortSignal,
): AsyncGenerator<ModelEvent> {
  const req = requestConfig(p, messages);
  const response = await upstream(
    req.url,
    'POST',
    req.headers,
    req.data,
    signal,
    (p.parameters?.timeout_seconds || 120) * 1000,
  );
  let content = false,
    terminal = false;
  for await (const e of sseEvents<ProviderEvent>(response)) {
    if (e.error || e.type === 'error') throw new HttpError(502, 'MODEL_ERROR', '模型生成失败');
    let delta: string | undefined;
    let usage: Usage | undefined;
    if (p.protocol === 'anthropic-messages') {
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') delta = e.delta.text;
      usage = e.usage || e.message?.usage;
      if (e.type === 'message_stop') terminal = true;
    } else if (p.protocol === 'gemini-generate-content') {
      delta = e.candidates?.[0]?.content?.parts
        ?.filter((x) => !x.thought)
        .map((x) => x.text || '')
        .join('');
      usage = e.usageMetadata;
      if (e.candidates?.[0]?.finishReason) terminal = true;
    } else {
      delta = e.choices?.[0]?.delta?.content;
      usage = e.usage;
      if (e.choices?.[0]?.finish_reason) terminal = true;
    }
    if (typeof delta === 'string' && delta) {
      content = true;
      yield { delta };
    }
    if (usage) yield { usage };
  }
  check(content && terminal, 502, 'INCOMPLETE_STREAM', '模型未返回完整文本结果');
}
