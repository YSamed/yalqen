import assert from 'node:assert/strict';
import { test } from 'node:test';
import tracing from '../../../dist/main/agent-bridge/tracing.js';
import buffers from '../../../dist/main/agent-bridge/runtime-buffer.js';
import serverModule from '../../../dist/main/agent-bridge/server.js';
import { fakeHost } from './fake-host.mjs';

const { newTraceparent, parseOtlpTraces, spanSummary } = tracing;
const { TabRuntime } = buffers;
const TRACE = '0af7651916cd43dd8448eb211c80319c';

export function otlp(spans, service = 'api') {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

const span = (fields) => ({
  traceId: TRACE,
  spanId: 'b7ad6b7169203331',
  name: 'POST /api/users',
  kind: 2,
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000000042000000',
  attributes: [{ key: 'http.response.status_code', value: { intValue: '500' } }],
  ...fields,
});

test('traceparent headers follow W3C Trace Context', () => {
  const { traceId, header } = newTraceparent();
  assert.match(header, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.equal(header.split('-')[1], traceId);
});

test('OTLP JSON spans are parsed with their errors', () => {
  const [server, query] = parseOtlpTraces(
    otlp([
      span({ status: { code: 2 } }),
      span({
        spanId: 'c7ad6b7169203332',
        parentSpanId: 'b7ad6b7169203331',
        name: 'SELECT users',
        kind: 3,
        events: [
          {
            name: 'exception',
            attributes: [
              { key: 'exception.type', value: { stringValue: 'ConnectionError' } },
              { key: 'exception.message', value: { stringValue: 'connect ECONNREFUSED 127.0.0.1:5432' } },
            ],
          },
        ],
      }),
    ]),
  );
  assert.equal(server.service, 'api');
  assert.equal(server.server, true);
  assert.equal(server.durationMs, 42);
  assert.equal(server.error, 'HTTP 500');
  assert.equal(server.attributes['http.response.status_code'], 500);
  assert.equal(query.parentSpanId, 'b7ad6b7169203331');
  assert.equal(query.error, 'ConnectionError: connect ECONNREFUSED 127.0.0.1:5432');
  assert.equal(
    spanSummary(query),
    'Backend api: SELECT users (42 ms) failed: ConnectionError: connect ECONNREFUSED 127.0.0.1:5432',
  );
});

test('base64 ids are accepted and garbage is skipped', () => {
  const base64 = Buffer.from(TRACE, 'hex').toString('base64');
  const spans = parseOtlpTraces(otlp([span({ traceId: base64 }), span({ traceId: 'nope' })]));
  assert.deepEqual(
    spans.map((item) => item.traceId),
    [TRACE],
  );
  assert.deepEqual(parseOtlpTraces({ nothing: true }), []);
});

test('spans for a traced request join the timeline and its episode, even when late', () => {
  const runtime = new TabRuntime(() => 'http://localhost:3000/');
  runtime.handle('Network.requestWillBeSent', {
    requestId: 'r1',
    type: 'Fetch',
    timestamp: 1,
    wallTime: Date.now() / 1000,
    request: { url: 'http://localhost:3000/api/users', method: 'POST', headers: {} },
    initiator: { type: 'script' },
  });
  runtime.traceRequest(TRACE, 'r1');
  runtime.handle('Network.responseReceived', {
    requestId: 'r1',
    type: 'Fetch',
    response: { status: 500, headers: {} },
  });
  runtime.timeline.closeEpisode();
  const quiet = span({ spanId: 'd7ad6b7169203333', name: 'cache lookup', kind: 1 });
  const matched = runtime.addSpans(
    parseOtlpTraces(otlp([span({ status: { code: 2 } }), quiet, span({ traceId: 'f'.repeat(32) })])),
  );
  assert.equal(matched, 2);
  assert.equal(runtime.spansForRequest('r1').length, 2);
  const backend = runtime.timeline.events.values().filter((event) => event.kind === 'backend');
  assert.equal(backend.length, 1);
  assert.equal(backend[0].causeConfidence, 'direct');
  assert.ok(runtime.timeline.latestEpisode.events.some((event) => event.kind === 'backend'));
});

test('the bridge accepts OTLP JSON on /v1/traces with the same token', async () => {
  const received = [];
  const server = await serverModule.startBridgeServer(
    { host: fakeHost(), token: () => 'tok', version: '0', onTraces: (body) => received.push(body) },
    0,
  );
  try {
    const url = `http://127.0.0.1:${server.port}/v1/traces`;
    const post = (headers, body = JSON.stringify(otlp([span({})]))) =>
      fetch(url, { method: 'POST', headers: { Authorization: 'Bearer tok', ...headers }, body });
    assert.equal((await post({ 'Content-Type': 'application/json' })).status, 200);
    assert.equal((await post({ 'Content-Type': 'application/x-protobuf' })).status, 415);
    assert.equal((await post({ 'Content-Type': 'application/json', Authorization: 'Bearer no' })).status, 401);
    assert.equal(received.length, 1);
  } finally {
    await server.close();
  }
});
