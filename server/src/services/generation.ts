import { check, HttpError } from '../errors.js';
import type { ModelEvent, Usage } from '../types.js';
export async function generateReply(
  events: AsyncIterable<ModelEvent>,
  signal: AbortSignal,
  delta: (text: string) => void,
  savePartial: (content: string) => Promise<void>,
  reportError: (error: unknown) => void,
) {
  let content = '',
    usage: Usage | null = null,
    lastSave = Date.now();
  let status: 'completed' | 'failed' | 'cancelled' = 'completed';
  let message: string | undefined;
  try {
    for await (const event of events) {
      if (event.delta) {
        content += event.delta;
        check(content.length <= 200000, 502, 'OUTPUT_TOO_LARGE', '模型输出过大');
        delta(event.delta);
      }
      if (event.usage) {
        usage ??= {};
        Object.assign(usage, event.usage);
      }
      if (Date.now() - lastSave > 1500) {
        await savePartial(content);
        lastSave = Date.now();
      }
    }
    if (signal.aborted) status = 'cancelled';
  } catch (error) {
    status = signal.aborted ? 'cancelled' : 'failed';
    if (status === 'failed') {
      reportError(error);
      message = error instanceof HttpError ? error.message : '模型连接中断，请检查配置或稍后重试';
    }
  }
  return { content, usage, status, message };
}
