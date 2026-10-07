import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import unload from '../../../dist/main/tabs/before-unload.js';

const { checkBeforeUnload } = unload;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.executeJavaScriptInIsolatedWorld = async () => true;
  contents.calls = [];
  contents.close = (options) => contents.calls.push(options);
  contents.fire = (proceed) => {
    let prevented = false;
    contents.emit(
      '-before-unload-fired',
      {
        preventDefault: () => {
          prevented = true;
        },
      },
      proceed,
    );
    assert.equal(prevented, true, 'the consent check must not unload the page');
  };
  return contents;
}

test('native consent checks preserve the contents for both stay and leave', async () => {
  for (const proceed of [false, true]) {
    const contents = fixture();
    const result = checkBeforeUnload(contents);
    await tick();
    assert.deepEqual(contents.calls, [{ waitForBeforeUnload: true }]);
    contents.fire(proceed);
    assert.equal(await result, proceed);
    assert.equal(contents.listenerCount('-before-unload-fired'), 0);
    assert.equal(contents.listenerCount('destroyed'), 0);
  }
});

test('simultaneous close requests share one check and a later request checks again', async () => {
  const contents = fixture();
  const first = checkBeforeUnload(contents);
  assert.equal(checkBeforeUnload(contents), first);
  await tick();
  assert.equal(contents.calls.length, 1);
  contents.fire(false);
  await first;
  const retry = checkBeforeUnload(contents);
  await tick();
  assert.equal(contents.calls.length, 2);
  contents.fire(true);
  assert.equal(await retry, true);
});

test('destroyed contents do not block a close and dispose pending listeners', async () => {
  const contents = fixture();
  const result = checkBeforeUnload(contents);
  contents.isDestroyed = () => true;
  contents.emit('destroyed');
  assert.equal(await result, true);
  await tick();
  assert.deepEqual(contents.calls, []);
  assert.equal(await checkBeforeUnload(contents), true);
});

test('a stalled or failed check refuses to discard the page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const contents = fixture();
  let loaded;
  contents.executeJavaScriptInIsolatedWorld = () =>
    new Promise((resolve) => {
      loaded = resolve;
    });
  const pending = checkBeforeUnload(contents);
  t.mock.timers.tick(15_000);
  assert.equal(await pending, false);
  loaded(true);
  await tick();
  assert.deepEqual(contents.calls, []);
  assert.equal(contents.listenerCount('-before-unload-fired'), 0);
  contents.executeJavaScriptInIsolatedWorld = async () => {
    throw new Error('renderer unavailable');
  };
  assert.equal(await checkBeforeUnload(contents), false);
});
