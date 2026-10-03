import assert from 'node:assert/strict';
import { test } from 'node:test';
import cdpEvents from '../../../dist/main/agent-bridge/cdp-events.js';

const { consoleEntry, describeRemoteObject, formatConsoleArgs, isFailedRequest, networkUpdate } = cdpEvents;

const frame = (functionName, url, lineNumber, columnNumber) => ({ functionName, url, lineNumber, columnNumber });

test('console calls keep level, joined arguments and a one-based source location', () => {
  const entry = consoleEntry('Runtime.consoleAPICalled', {
    type: 'error',
    timestamp: 1000,
    args: [
      { type: 'string', value: 'Failed:' },
      { type: 'number', value: 42 },
      { type: 'object', subtype: 'null', value: null },
      { type: 'object', className: 'Object', description: 'Object' },
    ],
    stackTrace: { callFrames: [frame('save', 'http://localhost:3000/src/form.tsx', 9, 4)] },
  });
  assert.deepEqual(entry, {
    time: 1000,
    level: 'error',
    source: 'console',
    text: 'Failed: 42 null Object',
    url: 'http://localhost:3000/src/form.tsx',
    line: 10,
    column: 5,
    stack: [{ functionName: 'save', url: 'http://localhost:3000/src/form.tsx', line: 10, column: 5 }],
  });
});

test('console.warn and console.assert map to warning and error', () => {
  assert.equal(consoleEntry('Runtime.consoleAPICalled', { type: 'warning', args: [] }).level, 'warning');
  assert.equal(consoleEntry('Runtime.consoleAPICalled', { type: 'assert', args: [] }).level, 'error');
  assert.equal(consoleEntry('Runtime.consoleAPICalled', { type: 'table', args: [] }).level, 'log');
});

test('uncaught exceptions use the exception description and stack', () => {
  const entry = consoleEntry('Runtime.exceptionThrown', {
    timestamp: 2000,
    exceptionDetails: {
      text: 'Uncaught',
      lineNumber: 83,
      columnNumber: 12,
      url: 'http://localhost:3000/app.js',
      exception: {
        type: 'object',
        subtype: 'error',
        description: "TypeError: Cannot read properties of undefined (reading 'id')",
      },
      stackTrace: { callFrames: [frame('', 'http://localhost:3000/app.js', 83, 12)] },
    },
  });
  assert.equal(entry.level, 'error');
  assert.equal(entry.source, 'exception');
  assert.equal(entry.text, "TypeError: Cannot read properties of undefined (reading 'id')");
  assert.equal(entry.line, 84);
  assert.equal(entry.stack[0].functionName, '(anonymous)');
});

test('browser log entries are kept as browser errors', () => {
  const entry = consoleEntry('Log.entryAdded', {
    entry: { source: 'security', level: 'error', text: 'Refused to load the script', timestamp: 3000 },
  });
  assert.deepEqual(entry, { time: 3000, level: 'error', source: 'browser', text: 'Refused to load the script' });
});

test('unrelated events give no console entry', () => {
  assert.equal(consoleEntry('Page.loadEventFired', {}), null);
});

test('describeRemoteObject prints primitives and falls back to the description', () => {
  assert.equal(describeRemoteObject({ type: 'undefined' }), 'undefined');
  assert.equal(describeRemoteObject({ type: 'number', unserializableValue: 'NaN' }), 'NaN');
  assert.equal(describeRemoteObject({ type: 'boolean', value: false }), 'false');
  assert.equal(describeRemoteObject({ type: 'function', description: 'function f() {}' }), 'function f() {}');
});

test('long console text is clipped', () => {
  const entry = consoleEntry('Runtime.consoleAPICalled', {
    type: 'log',
    args: [{ type: 'string', value: 'x'.repeat(5000) }],
  });
  assert.equal(entry.text.length, 2001);
});

test('a request goes from sent to response to finished', () => {
  const sent = networkUpdate('Network.requestWillBeSent', {
    requestId: '7',
    type: 'Fetch',
    timestamp: 10,
    wallTime: 1_700_000_000.5,
    request: {
      url: 'http://localhost:3000/api/users',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      postData: '{"a":1}',
    },
    initiator: { type: 'script', stack: { callFrames: [frame('submit', 'http://localhost:3000/form.js', 0, 0)] } },
  });
  assert.equal(sent.startTime, 1_700_000_000_500);
  assert.equal(sent.finished, false);
  assert.equal(sent.initiator.stack[0].functionName, 'submit');
  assert.equal(isFailedRequest(sent), false);

  const answered = networkUpdate(
    'Network.responseReceived',
    {
      requestId: '7',
      type: 'Fetch',
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        mimeType: 'application/json',
        headers: { 'X-Id': 1 },
      },
    },
    sent,
  );
  assert.equal(answered.status, 500);
  assert.deepEqual(answered.responseHeaders, { 'X-Id': '1' });
  assert.equal(isFailedRequest(answered), true);

  const done = networkUpdate('Network.loadingFinished', { requestId: '7', timestamp: 10.25 }, answered);
  assert.equal(done.finished, true);
  assert.equal(done.durationMs, 250);
});

test('a failed request records why it failed', () => {
  const sent = networkUpdate('Network.requestWillBeSent', {
    requestId: '8',
    timestamp: 1,
    request: { url: 'http://localhost/x', method: 'GET', headers: {} },
    initiator: { type: 'parser' },
  });
  const failed = networkUpdate(
    'Network.loadingFailed',
    { requestId: '8', timestamp: 2, errorText: 'net::ERR_CONNECTION_REFUSED' },
    sent,
  );
  assert.equal(failed.failure, 'net::ERR_CONNECTION_REFUSED');
  assert.equal(failed.durationMs, 1000);
  assert.equal(isFailedRequest(failed), true);
  const canceled = networkUpdate('Network.loadingFailed', { requestId: '8', canceled: true, errorText: 'x' }, sent);
  assert.equal(canceled.failure, 'canceled');
});

test('follow-up events without a known request are ignored', () => {
  assert.equal(networkUpdate('Network.responseReceived', { requestId: '9', response: {} }), null);
  assert.equal(networkUpdate('Network.requestWillBeSent', {}), null);
});

test('console format specifiers are applied and %c styles dropped', () => {
  const str = (value) => ({ type: 'string', value });
  assert.equal(formatConsoleArgs([str('%cWarning%c done'), str('color:red'), str('')]), 'Warning done');
  assert.equal(
    formatConsoleArgs([str('%s has %d items'), str('cart'), { type: 'number', value: 3 }, str('extra')]),
    'cart has 3 items extra',
  );
  assert.equal(formatConsoleArgs([str('100%% sure')]), '100%% sure');
  assert.equal(formatConsoleArgs([{ type: 'number', value: 1 }, str('%s')]), '1 %s');
});
