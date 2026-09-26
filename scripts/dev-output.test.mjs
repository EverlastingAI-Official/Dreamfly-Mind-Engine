import test from 'node:test';
import assert from 'node:assert/strict';
import { errorSummary } from './dev-output.mjs';

test('quiet output hides request logs and tool notices but retains actionable failures', () => {
  assert.equal(errorSummary('{"level":30,"msg":"request completed"}'), null);
  assert.equal(errorSummary('Browserslist: browsers data is 10 months old.'), null);
  assert.equal(errorSummary('uni-app 有新版本发布'), null);
  assert.equal(errorSummary('Compiling...'), null);
  assert.equal(
    errorSummary(
      '{"level":50,"msg":"Request failed","diagnostic":{"message":"database unavailable"}}',
    ),
    'Request failed: database unavailable',
  );
  assert.equal(
    errorSummary('\u001b[31m[vite] Internal server error: invalid template\u001b[0m'),
    '[vite] Internal server error: invalid template',
  );
});
