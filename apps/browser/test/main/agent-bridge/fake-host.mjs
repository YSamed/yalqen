import buffers from '../../../dist/main/agent-bridge/runtime-buffer.js';

export function fakeHost() {
  const runtime = new buffers.TabRuntime();
  const calls = [];
  const host = {
    calls,
    runtimeOf: runtime,
    tabs: () => [
      { id: 't1', url: 'http://localhost:3000/', title: 'Shop', active: true },
      { id: 't2', url: 'http://localhost:5173/', title: 'Admin', active: false },
    ],
    runtime: (id) => (id === 't1' ? runtime : undefined),
    pageInfo: async (id) => ({
      url: 'http://localhost:3000/',
      title: `tab ${id}`,
      viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
      device: null,
      colorScheme: null,
      overrides: [],
    }),
    screenshot: async (id, fullPage) => {
      calls.push(['screenshot', id, fullPage]);
      return Buffer.from('png');
    },
    reload: async (id, ignoreCache) => {
      calls.push(['reload', id, ignoreCache]);
    },
    responseBody: async (id, requestId) => {
      calls.push(['body', id, requestId]);
      return { body: Buffer.from('{"error":"boom"}').toString('base64'), base64Encoded: true };
    },
    onRead: (id) => calls.push(['read', id]),
  };
  runtime.handle('Runtime.consoleAPICalled', {
    type: 'warning',
    timestamp: 100,
    args: [{ type: 'string', value: 'careful' }],
  });
  runtime.handle('Runtime.exceptionThrown', {
    timestamp: 200,
    exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is undefined' } },
  });
  runtime.handle('Network.requestWillBeSent', {
    requestId: 'ok',
    timestamp: 1,
    request: { url: 'http://localhost:3000/api/products', method: 'GET', headers: {} },
    initiator: { type: 'script' },
  });
  runtime.handle('Network.responseReceived', { requestId: 'ok', response: { status: 200, headers: {} } });
  runtime.handle('Network.requestWillBeSent', {
    requestId: 'bad',
    timestamp: 2,
    request: {
      url: 'http://localhost:3000/api/users',
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      postData: '{}',
    },
    initiator: { type: 'script' },
  });
  runtime.handle('Network.responseReceived', {
    requestId: 'bad',
    response: { status: 500, headers: { 'Set-Cookie': 'a' } },
  });
  return host;
}
