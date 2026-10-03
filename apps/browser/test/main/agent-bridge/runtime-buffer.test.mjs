import assert from 'node:assert/strict';
import { test } from 'node:test';
import buffers from '../../../dist/main/agent-bridge/runtime-buffer.js';

const { CappedMap, RingBuffer, TabRuntime, CONSOLE_LIMIT, NETWORK_LIMIT } = buffers;

test('RingBuffer drops the oldest entry at its limit', () => {
  const ring = new RingBuffer(3);
  for (const n of [1, 2, 3, 4, 5]) ring.push(n);
  assert.deepEqual(ring.values(), [3, 4, 5]);
  ring.clear();
  assert.equal(ring.size, 0);
});

test('CappedMap drops the oldest key and keeps updated keys in place', () => {
  const map = new CappedMap(2);
  map.set('a', 1);
  map.set('b', 2);
  map.set('a', 10);
  map.set('c', 3);
  assert.deepEqual(map.values(), [2, 3]);
});

test('TabRuntime keeps the last 200 console entries and 300 requests', () => {
  const runtime = new TabRuntime();
  for (let i = 0; i < CONSOLE_LIMIT + 5; i++) {
    runtime.handle('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'number', value: i }], timestamp: i });
  }
  for (let i = 0; i < NETWORK_LIMIT + 5; i++) {
    runtime.handle('Network.requestWillBeSent', {
      requestId: `r${i}`,
      request: { url: `http://localhost/${i}`, method: 'GET', headers: {} },
      timestamp: i,
      wallTime: i,
      initiator: { type: 'script' },
    });
  }
  assert.equal(runtime.console.size, CONSOLE_LIMIT);
  assert.equal(runtime.console.values()[0].text, '5');
  assert.equal(runtime.network.size, NETWORK_LIMIT);
  assert.equal(runtime.network.values()[0].id, 'r5');
  runtime.clear();
  assert.equal(runtime.console.size + runtime.network.size, 0);
});

test('TabRuntime ignores responses for requests it never saw', () => {
  const runtime = new TabRuntime();
  runtime.handle('Network.responseReceived', { requestId: 'x', response: { status: 500 } });
  runtime.handle('Page.loadEventFired', {});
  assert.equal(runtime.network.size, 0);
});
