import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import runnerModule from '../../../dist/main/agent-bridge/action-runner.js';
import flow from '../../../dist/main/agent-bridge/flow-verification.js';
import buffer from '../../../dist/main/agent-bridge/runtime-buffer.js';
import pageWork from '../../../dist/main/tabs/page-work.js';

const { ActionRunner } = runnerModule;
const { validateFlowPlan } = flow;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const plan = (extra = {}) =>
  validateFlowPlan({
    name: 'Add to cart',
    start_url: 'http://localhost:3000/',
    steps: [{ action: 'click', selector: '#add' }],
    assertions: [{ kind: 'count', selector: '.item', expected: 2 }],
    assertion_timeout_ms: 0,
    ...extra,
  });

function fixture(extra = {}) {
  const state = {
    url: 'http://localhost:3000/',
    policy: 'allow',
    observed: true,
    count: 1,
    commands: [],
    confirms: [],
    shown: 0,
    hidden: 0,
    verifications: [],
    ...extra,
  };
  const contents = new EventEmitter();
  contents.getURL = () => state.url;
  contents.isDestroyed = () => false;
  contents.loadURL = async (url) => {
    state.url = url;
  };
  contents.debugger = {
    sendCommand: async (method, params) => {
      state.commands.push([method, params]);
      if (state.command) {
        const result = await state.command(method, params);
        if (result !== undefined) return result;
      }
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelectorAll') return { nodeIds: state.ambiguous ? [2, 3] : [2] };
      if (method === 'DOM.querySelector') return { nodeId: 2 };
      if (method === 'DOM.getBoxModel')
        return { model: { width: 20, height: 20, content: [0, 0, 20, 0, 20, 20, 0, 20] } };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      if (method === 'Runtime.evaluate')
        return { result: { value: { url: state.url, count: state.count, visible: state.count } } };
      return {};
    },
  };
  const runtime = new buffer.TabRuntime();
  const tab = { id: 't1', agent: runtime };
  const window = {
    tabs: {
      observedTab: (id) => (id === 't1' && state.observed ? { tab, contents } : null),
      activate() {},
      activeTabId: 't1',
    },
    confirm: async (message, detail) => {
      state.confirms.push([message, detail]);
      return state.confirm ? state.confirm() : true;
    },
    showControl: (stop) => {
      state.shown++;
      state.stop = stop;
    },
    hideControl: () => state.hidden++,
    showVerification: (result) => state.verifications.push(result),
  };
  const runner = new ActionRunner({
    policy: () => state.policy,
    windows: () => [window],
    inScope: (url) => /^http:\/\/localhost:3000\//.test(url),
  });
  return { state, contents, runner, window };
}

test('flow uses one policy approval/control session and fails the actual count with a clean console', async () => {
  const { runner, state, contents } = fixture({ policy: 'ask' });
  const result = await runner.runFlow('t1', plan());
  assert.equal(result.result, 'failed');
  assert.equal(result.assertions[0].actual, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(state.confirms.length, 1);
  assert.equal(state.shown, 1);
  assert.equal(state.hidden, 1);
  assert.equal(pageWork.pageWorkBusy(contents), false);
  assert.equal(state.commands.find(([method]) => method === 'Runtime.evaluate')[1].contextId, 7);
});

test('flow succeeds only when actual UI evidence meets the expected outcome', async () => {
  const { runner, state } = fixture({ count: 2 });
  const result = await runner.runFlow('t1', plan());
  assert.equal(result.result, 'passed');
  assert.equal(result.assertions[0].actual, 2);
  assert.equal(result.steps[0].passed, true);
  assert.equal(state.verifications[0].result, 'passed');
});

test('off policy, denied approval, external plans and ambiguous selectors never click', async () => {
  for (const change of [{ policy: 'off' }, { policy: 'ask', confirm: async () => false }]) {
    const { runner, state } = fixture(change);
    await assert.rejects(runner.runFlow('t1', plan()));
    assert.equal(state.commands.length, 0);
  }
  const { runner, state } = fixture();
  await assert.rejects(
    runner.runFlow('t1', plan({ steps: [{ action: 'navigate', url: 'https://example.com/' }] })),
    /not a local/,
  );
  assert.equal(state.commands.length, 0);
  state.ambiguous = true;
  const result = await runner.runFlow('t1', plan());
  assert.match(result.steps[0].error, /multiple/);
  assert.equal(
    state.commands.some(([method]) => method === 'Input.dispatchMouseEvent'),
    false,
  );
});

test('a page leaving scope while permission is pending is refused before any action', async () => {
  let allow;
  const { runner, state } = fixture({
    policy: 'ask',
    confirm: () =>
      new Promise((resolve) => {
        allow = resolve;
      }),
  });
  const running = runner.runFlow('t1', plan());
  await tick();
  state.url = 'https://example.com/private';
  allow(true);
  await assert.rejects(running, /changed while waiting/);
  assert.equal(state.commands.length, 0);
});

test('external redirect aborts in-flight input and cannot proceed to a later step', async () => {
  const { runner, state, contents } = fixture();
  let prevented = false;
  state.command = async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed')
      contents.emit('will-redirect', {
        url: 'https://example.com/',
        isMainFrame: true,
        preventDefault: () => {
          prevented = true;
        },
      });
  };
  const result = await runner.runFlow(
    't1',
    plan({
      steps: [
        { action: 'click', selector: '#external' },
        { action: 'fill', selector: '#other', value: 'must not type' },
      ],
    }),
  );
  assert.equal(result.result, 'failed');
  assert.match(result.errors[0], /leave local/);
  assert.equal(prevented, true);
  assert.equal(
    state.commands.some(([method]) => method === 'Input.insertText'),
    false,
  );
  assert.equal(contents.listenerCount('will-redirect'), 0);
  assert.equal(pageWork.pageWorkBusy(contents), false);
});

test('scoped project permission is rechecked between CDP operations', async () => {
  const { runner, state } = fixture();
  let allowed = true;
  state.command = async (method) => {
    if (method === 'DOM.scrollIntoViewIfNeeded') allowed = false;
  };
  const result = await runner.runFlow('t1', plan(), () => allowed);
  assert.equal(result.result, 'failed');
  assert.match(result.errors[0], /scope allowed/);
  assert.equal(
    state.commands.some(([method]) => method === 'Input.dispatchMouseEvent'),
    false,
  );
});

test('Stop aborts pending work, releases the page lease, and next allowed flow asks again', async () => {
  const { runner, state, contents } = fixture();
  state.command = async (method) => (method === 'DOM.getDocument' ? new Promise(() => {}) : undefined);
  const running = runner.runFlow('t1', plan());
  await tick();
  assert.equal(pageWork.pageWorkBusy(contents), true);
  state.stop();
  const result = await running;
  assert.match(result.errors[0], /Stopped/);
  assert.equal(pageWork.pageWorkBusy(contents), false);
  state.command = null;
  await runner.runFlow('t1', plan());
  assert.equal(state.confirms.length, 1);
});

test('shared scan lease rejects flow, selector wait, and planning reads', async () => {
  const { runner, contents, state } = fixture();
  const release = pageWork.acquirePageWork(contents);
  await assert.rejects(runner.runFlow('t1', plan()), /already using this tab/);
  await assert.rejects(
    runner.waitFor('t1', { selector: '#add', networkIdle: false, timeoutMs: 1 }),
    /already using this tab/,
  );
  await assert.rejects(runner.pageStructure('t1'), /already using this tab/);
  assert.equal(state.commands.length, 0);
  release();
  assert.equal(pageWork.pageWorkBusy(contents), false);
});
