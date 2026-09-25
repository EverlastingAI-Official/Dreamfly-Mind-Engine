import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins } from '../src/origins.js';

test('development aliases keep the configured scheme and port', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const origins = allowedOrigins(`http://${host}:5173`, false);
    assert.deepEqual([...origins].sort(), ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'].sort());
    for (const value of ['', 'null', 'http://localhost:5174', 'https://localhost:5173', 'http://localhost.attacker.test:5173']) {
      assert.equal(origins.has(value), false, value);
    }
  }
});

test('production and non-loopback origins retain an exact allowlist', () => {
  for (const origin of ['https://mind.example.com', 'https://localhost:5173']) {
    assert.deepEqual([...allowedOrigins(origin, true)], [origin]);
  }
  assert.deepEqual([...allowedOrigins('http://dev.example.com:5173', false)], ['http://dev.example.com:5173']);
});
