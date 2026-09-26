import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../src/services/generation.js';
import { HttpError } from '../src/errors.js';
import { errorDiagnostic } from '../src/logging.js';

test('failed generation preserves partial text and the original explanation in its single outcome', async () => {
  async function* stream() {
    yield { delta: 'partial text' };
    throw new HttpError('UPSTREAM_ERROR', '厂商限流，请稍后重试');
  }
  const deltas: string[] = [],
    errors: unknown[] = [];
  const result = await generateReply(
    stream(),
    new AbortController().signal,
    (value) => deltas.push(value),
    async () => {},
    (error) => errors.push(error),
  );
  assert.deepEqual(deltas, ['partial text']);
  assert.equal(result.status, 'failed');
  assert.equal(result.content, 'partial text');
  assert.equal(result.error?.message, '厂商限流，请稍后重试');
  assert.equal(result.error?.code, 'UPSTREAM_ERROR');
  assert.equal(errors.length, 1);
});
test('cancelled streams keep partial content without reporting a provider failure', async () => {
  const controller = new AbortController();
  async function* stream() {
    yield { delta: 'partial' };
    controller.abort();
    throw new Error('aborted');
  }
  const result = await generateReply(
    stream(),
    controller.signal,
    () => {},
    async () => {},
    () => assert.fail('cancellation is not an upstream failure'),
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(result.content, 'partial');
});
test('diagnostics retain stack locations without exposing credential-bearing error messages', () => {
  const error = Object.assign(
    new Error('Authorization: Bearer fixture-secret\nrequest-body: private text'),
    { code: 'ECONNRESET' },
  );
  const diagnostic = errorDiagnostic(error);
  assert.equal(diagnostic.code, 'ECONNRESET');
  assert.match(diagnostic.stack!, /generation\.test/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /fixture-secret|private text/);
});
