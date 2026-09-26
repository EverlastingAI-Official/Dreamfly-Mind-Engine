import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('production proxy preserves separate client IPs for authentication rate limits', async () => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = 'uniquelocal';
  const app = await buildApp({ logger: false });
  try {
    app.get('/client-ip', async request => ({ ip: request.ip }));
    for (const ip of ['198.51.100.10', '198.51.100.20']) {
      const result = await app.inject({
        url: '/client-ip',
        remoteAddress: '172.20.0.3',
        headers: { 'x-forwarded-for': `203.0.113.99, ${ip}` },
      });
      assert.equal(result.json().data.ip, ip);
    }
    const direct = await app.inject({
      url: '/client-ip',
      remoteAddress: '198.51.100.30',
      headers: { 'x-forwarded-for': '203.0.113.99' },
    });
    assert.equal(direct.json().data.ip, '198.51.100.30');
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  }
});

test('development ignores forged proxy headers by default', async () => {
  const previous = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  const app = await buildApp({ logger: false });
  try {
    app.get('/client-ip', async request => ({ ip: request.ip }));
    const result = await app.inject({
      url: '/client-ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.99' },
    });
    assert.equal(result.json().data.ip, '127.0.0.1');
  } finally {
    await app.close();
    if (previous !== undefined) process.env.TRUST_PROXY = previous;
  }
});
