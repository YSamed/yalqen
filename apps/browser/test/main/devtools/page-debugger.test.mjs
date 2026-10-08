import assert from 'node:assert/strict';
import { test } from 'node:test';
import debuggerTools from '../../../dist/main/devtools/page-debugger.js';

test('concurrent protocol operations keep their debugger until the last operation settles', async () => {
  let attached = false;
  let detachments = 0;
  const contents = {
    isDestroyed: () => false,
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
        detachments++;
      },
    },
  };
  let finish;
  const pending = debuggerTools.withDebugger(
    contents,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await assert.rejects(
    debuggerTools.withDebugger(contents, async () => {
      throw new Error('cancelled');
    }),
  );
  debuggerTools.detachDebugger(contents);
  assert.equal(attached, true);
  assert.equal(detachments, 0);
  finish();
  await pending;
  debuggerTools.detachDebugger(contents);
  assert.equal(attached, false);
  assert.equal(detachments, 1);
});
