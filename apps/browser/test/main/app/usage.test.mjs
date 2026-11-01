import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import usageModule from '../../../dist/main/app/usage.js';

const { UsageReporter, USAGE_ENDPOINT, USAGE_FIRST_DELAY_MS, USAGE_INTERVAL_MS } = usageModule;

function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-usage-'));
  const calls = [];
  let enabled = true;
  let active = true;
  let now = Date.parse('2026-10-02T11:00:00Z');
  const options = {
    directory,
    endpoint: USAGE_ENDPOINT,
    enabled: () => enabled,
    active: () => active,
    now: () => now,
    send: async (url, init) => {
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
    ...overrides,
  };
  const reporter = new UsageReporter(options);
  t.after(() => {
    reporter.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    calls,
    options,
    reporter,
    setEnabled: (value) => (enabled = value),
    setActive: (value) => (active = value),
    nextDay: () => (now += 24 * 60 * 60 * 1000),
  };
}

test('opt-out, private-only sessions and development builds send nothing and create no identity', async (t) => {
  const state = setup(t);
  state.setEnabled(false);
  await state.reporter.report();
  state.setEnabled(true);
  state.setActive(false);
  await state.reporter.report();
  state.setActive(true);
  await new UsageReporter({ ...state.options, endpoint: null }).report();
  assert.equal(state.calls.length, 0);
  assert.deepEqual(fs.readdirSync(state.directory), []);
});

test('only a random ID is sent, once per UTC day across restarts, without cookies or redirects', async (t) => {
  const state = setup(t);
  await state.reporter.report();
  await state.reporter.report();
  const restarted = new UsageReporter(state.options);
  await restarted.report();
  assert.equal(state.calls.length, 1);
  const request = state.calls[0];
  assert.deepEqual(Object.keys(request.body), ['installationId']);
  assert.match(request.body.installationId, /^[0-9a-f-]{36}$/);
  assert.equal(request.credentials, 'omit');
  assert.equal(request.redirect, 'error');
  assert.equal(request.url, USAGE_ENDPOINT);
  state.nextDay();
  await restarted.report();
  assert.equal(state.calls.length, 2);
  assert.deepEqual(state.calls[1].body, request.body);
});

test('a failed collector response retries using the same ID rather than marking the day as sent', async (t) => {
  let attempts = 0;
  const ids = [];
  const state = setup(t, {
    send: async (_url, init) => {
      ids.push(JSON.parse(init.body).installationId);
      return new Response(null, { status: ++attempts === 1 ? 503 : 204 });
    },
  });
  await state.reporter.report();
  await state.reporter.report();
  await state.reporter.report();
  assert.equal(attempts, 2);
  assert.equal(ids[0], ids[1]);
});

test('concurrent reports are deduplicated and disabling aborts an in-flight report', async (t) => {
  let pending;
  let signal;
  let attempts = 0;
  const state = setup(t, {
    send: async (_url, init) => {
      attempts++;
      signal = init.signal;
      return new Promise((resolve) => (pending = resolve));
    },
  });
  const first = state.reporter.report();
  await state.reporter.report();
  assert.equal(attempts, 1);
  state.setEnabled(false);
  state.reporter.schedule();
  assert.equal(signal.aborted, true);
  pending(new Response(null, { status: 204 }));
  await first;
  assert.equal(JSON.parse(fs.readFileSync(path.join(state.directory, 'usage.json'))).lastSentDay, null);
});

test('scheduled reports retry hourly and stop immediately on opt-out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setup(t);
  state.reporter.schedule();
  t.mock.timers.tick(USAGE_FIRST_DELAY_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls.length, 1);
  state.nextDay();
  t.mock.timers.tick(USAGE_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls.length, 2);
  state.setEnabled(false);
  state.reporter.schedule();
  state.nextDay();
  t.mock.timers.tick(USAGE_INTERVAL_MS);
  assert.equal(state.calls.length, 2);
});
