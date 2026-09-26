import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, normalizeError, publicFailure } from '../src/errors.js';
import { errorInfo } from '../../packages/api/errors.js';
import { modelProfileInput } from '../../src/services/payloads.js';
import { Ajv } from 'ajv';
import { bodies } from '../../packages/api/schemas.js';

test('HTTP and stream failures share codes, details and safe messages', () => {
  const upstream = new HttpError('UPSTREAM_ERROR', '厂商限流', { upstream_status: 429 });
  assert.equal(upstream.statusCode, errorInfo(upstream.code).status);
  assert.deepEqual(publicFailure(upstream), {
    code: 'UPSTREAM_ERROR',
    message: '厂商限流',
    details: { upstream_status: 429 },
  });
  assert.equal(normalizeError({ code: '23505' }).code, 'ALREADY_EXISTS');
  assert.equal(normalizeError({ statusCode: 415 }).code, 'UNSUPPORTED_MEDIA_TYPE');
  const failure = publicFailure(new Error('password=do-not-expose'));
  assert.equal(failure.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(failure), /do-not-expose/);
});

test('profile forms omit read-only fields and credentials retain their write action', () => {
  const form = {
    name: 'Profile',
    provider: 'deepseek',
    model: 'model',
    id: 'private',
    verified_at: 'forged',
    api_key_configured: true,
    api_key: ' test-key ',
  };
  const input = modelProfileInput(form);
  const validate = new Ajv().compile(bodies.modelProfile);
  assert.equal(validate(input), true, JSON.stringify(validate.errors));
  assert.equal(validate(form), false);
  assert.equal(input.api_key, 'test-key');
  assert.equal(input.api_key_action, 'replace');
  assert.equal(modelProfileInput(form, 'clear').api_key_action, 'clear');
  assert.equal('verified_at' in input, false);
  assert.equal('api_key_configured' in input, false);
});
