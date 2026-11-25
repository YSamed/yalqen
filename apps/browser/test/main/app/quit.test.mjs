import assert from 'node:assert/strict';
import { test } from 'node:test';
import quitModule from '../../../dist/main/app/quit.js';
import closeModule from '../../../dist/main/window/close-windows.js';

const { QuitController } = quitModule;
const { WindowClose } = closeModule;
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function closeEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function setup(confirmCloseAll) {
  const calls = [];
  const tabs = { confirmCloseAll };
  const native = {
    isDestroyed: () => false,
    close: () => {
      const event = closeEvent();
      if (windowClose.handle(event)) calls.push('close window');
      assert.equal(event.defaultPrevented, false);
    },
  };
  const windowClose = new WindowClose(native, tabs);
  const quit = new QuitController({
    windows: [{ tabs, setCloseApproval: (approval) => windowClose.setApproval(approval) }],
    beforeClose: async () => calls.push('prepare'),
    saveSession: (resume) => calls.push(['save', resume]),
    quit: () => {
      calls.push('quit');
      const event = closeEvent();
      quit.beforeQuit(event);
      assert.equal(event.defaultPrevented, false);
      native.close();
    },
  });
  return { calls, quit, windowClose };
}

test('native window close prevents duplicate prompts and continues with the approved close', async () => {
  let prompts = 0;
  let answer;
  const { calls, windowClose } = setup(() => {
    prompts++;
    return new Promise((resolve) => (answer = resolve));
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const event = closeEvent();
    assert.equal(windowClose.handle(event), false);
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(prompts, 1);
  answer(() => true);
  await nextTurn();
  assert.deepEqual(calls, ['close window']);
});

test('native application quit prepares, saves the session and then closes the window', async () => {
  const { calls, quit } = setup(async () => () => true);
  const event = closeEvent();
  quit.beforeQuit(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(quit.isQuitting, false);
  await nextTurn();
  assert.equal(quit.isQuitting, true);
  assert.deepEqual(calls, ['prepare', ['save', false], 'quit', 'close window']);
});

test('a cancelled quit leaves the session open and a subsequent relaunch saves before scheduling', async () => {
  let answer;
  const { calls, quit } = setup(() => new Promise((resolve) => (answer = resolve)));
  quit.beforeQuit(closeEvent());
  quit.relaunch(() => assert.fail('a relaunch cannot overtake pending consent'));
  answer(null);
  await nextTurn();
  assert.deepEqual(calls, []);
  assert.equal(quit.isQuitting, false);

  quit.relaunch(() => calls.push('relaunch'));
  answer(() => true);
  await nextTurn();
  assert.deepEqual(calls, ['prepare', ['save', false], 'relaunch', 'quit', 'close window']);
});

test('update preparation saves a resumable session and a stale native approval resets exit state', async () => {
  let valid = true;
  const { calls, quit, windowClose } = setup(async () => () => valid);
  assert.equal(await quit.prepareUpdate(), true);
  assert.deepEqual(calls, ['prepare', ['save', true]]);
  assert.equal(quit.isQuitting, true);

  valid = false;
  const event = closeEvent();
  assert.equal(windowClose.handle(event), false);
  assert.equal(event.defaultPrevented, true);
  assert.equal(quit.isQuitting, false);

  quit.lastWindowClosing();
  assert.equal(quit.isQuitting, true);
  assert.deepEqual(calls, ['prepare', ['save', true], ['save', false]]);
});
