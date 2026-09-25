import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../../src/services/http.mjs';

function client(fetch) {
  const state = { user: { id: 'alice' }, csrf: 'alice-token' };
  return {
    state,
    ...createClient({
      base: '/api/v1',
      session: () => state,
      clearSession: () => Object.assign(state, { user: null, csrf: '' }),
      fetch,
    }),
  };
}
const unauthorized = () =>
  new Response(
    JSON.stringify({
      error: { code: 'LOGIN_REQUIRED', message: '请先登录', details: { expired: true } },
    }),
    {
      status: 401,
      headers: { 'content-type': 'application/json' },
    },
  );
test('JSON and streaming requests clear expired sessions and preserve structured errors', async () => {
  for (const streaming of [false, true]) {
    const transport = client(async () => unauthorized());
    await assert.rejects(
      () => (streaming ? transport.sendMessage('id', 'hello', () => {}) : transport.api('/skills')),
      {
        code: 'LOGIN_REQUIRED',
        status: 401,
        details: { expired: true },
      },
    );
    assert.equal(transport.state.user, null);
    assert.equal(transport.state.csrf, '');
  }
});
test('an expired request cannot log out a subsequently authenticated account', async () => {
  let respond;
  const transport = client(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const pending = transport.api('/skills');
  transport.state.user = { id: 'bob' };
  transport.state.csrf = 'bob-token';
  respond(unauthorized());
  await assert.rejects(pending);
  assert.equal(transport.state.user.id, 'bob');
});
test('stream requires a terminal event, handles split UTF-8, and delivers failure only once', async () => {
  const start = 'event: message.start\ndata: {"id":"reply"}\n\n';
  const delta = 'event: message.delta\ndata: {"text":"你好🦋"}\n\n';
  const failure =
    'event: message.failed\ndata: {"status":"failed","message":"specific failure"}\n\n';
  function streaming(payload) {
    return client(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of new TextEncoder().encode(payload))
                controller.enqueue(Uint8Array.of(byte));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
  }
  await assert.rejects(() => streaming(start + delta).sendMessage('id', 'hello', () => {}), {
    code: 'INCOMPLETE_STREAM',
  });
  const received = [];
  await streaming(start + delta + failure + failure).sendMessage('id', 'hello', (event, data) =>
    received.push({ event, data }),
  );
  assert.equal(received[1].data.text, '你好🦋');
  assert.equal(received.filter((item) => item.event === 'message.failed').length, 1);
  assert.equal(received.at(-1).data.message, 'specific failure');
});
