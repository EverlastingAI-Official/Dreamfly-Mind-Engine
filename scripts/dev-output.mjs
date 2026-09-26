import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

export function errorSummary(line) {
  const text = stripVTControlCharacters(line).trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const entry = JSON.parse(text);
      if (entry.level < 50 || !entry.level) return null;
      const detail =
        entry.diagnostic?.message ||
        entry.err?.message ||
        entry.diagnostic?.code ||
        entry.err?.code;
      return [entry.msg, detail].filter(Boolean).join(': ');
    } catch {
      // Compiler output can contain braces without being structured logs.
    }
  }
  return /(?:\berror\b|\bfailed\b|\bexception\b|错误|失败)/i.test(text) ? text : null;
}

export function pipeOutput(stream, { name, log, verbose }) {
  stream.on('data', (chunk) => {
    log.write(chunk);
    if (verbose) process.stdout.write(`[${name}] ${chunk}`);
  });
  if (!verbose) {
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => {
      const error = errorSummary(line);
      if (error) console.error(`[${name}] ${error}（详情：data/dev-logs/${name}.log）`);
    });
  }
}
