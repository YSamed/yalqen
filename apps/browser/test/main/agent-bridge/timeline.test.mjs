import assert from 'node:assert/strict';
import { test } from 'node:test';
import timelineModule from '../../../dist/main/agent-bridge/timeline.js';
import buffers from '../../../dist/main/agent-bridge/runtime-buffer.js';

const { Timeline, actionSummary, episodePreview, sharesUserFrame, shortUrl } = timelineModule;
const { parsePageAction, TabRuntime } = buffers;
const PAGE = 'http://localhost:3000/users';

const click = (time, text = 'Save') => ({ phase: 'start', kind: 'click', time, target: { tag: 'button', text } });
const request = (id, time, extra = {}) => ({
  id,
  method: 'POST',
  url: 'http://localhost:3000/api/users',
  resourceType: 'Fetch',
  startTime: time,
  monotonicStart: 0,
  finished: false,
  initiator: { type: 'script' },
  requestHeaders: {},
  ...extra,
});

test('a request made while the click is being handled is directly caused by it', () => {
  const timeline = new Timeline(() => PAGE);
  timeline.action(click(1000));
  timeline.request(request('r1', 1005));
  timeline.action({ ...click(1006), phase: 'end' });
  timeline.request(request('r2', 1500));
  timeline.request(request('r3', 4000));
  const [action, r1, r2, r3] = timeline.events.values();
  assert.equal(action.summary, 'Clicked button "Save"');
  assert.equal(r1.summary, 'POST /api/users');
  assert.deepEqual([r1.causeId, r1.causeConfidence], [action.id, 'direct']);
  assert.deepEqual([r2.causeId, r2.causeConfidence], [action.id, 'likely']);
  assert.equal(r3.causeId, undefined);
});

test('an action whose end never arrives stops counting as open', () => {
  const timeline = new Timeline(() => PAGE);
  timeline.action(click(1000));
  timeline.request(request('r1', 1600));
  assert.equal(timeline.events.values()[1].causeConfidence, 'likely');
});

test('assets are left out unless they fail', () => {
  const timeline = new Timeline(() => PAGE);
  timeline.request(request('img', 1, { resourceType: 'Image', method: 'GET', url: 'http://localhost:3000/logo.png' }));
  timeline.response({ ...request('ok', 1, { resourceType: 'Image' }), status: 200 }, 2);
  timeline.response(
    { ...request('img', 1, { resourceType: 'Image', method: 'GET' }), status: 404, statusText: 'Not Found' },
    3,
  );
  assert.deepEqual(
    timeline.events.values().map((event) => event.summary),
    ['404 Not Found GET /api/users'],
  );
});

test('a failed response opens an episode with the preceding ten seconds', () => {
  const timeline = new Timeline(() => PAGE);
  timeline.navigation('http://localhost:3000/users', 0);
  timeline.action(click(10_000));
  timeline.request(request('r1', 10_010));
  timeline.response({ ...request('r1', 10_010), status: 500, statusText: 'Internal Server Error' }, 10_200);
  timeline.console({
    time: 10_300,
    level: 'error',
    source: 'exception',
    text: "TypeError: Cannot read properties of undefined (reading 'id')\n    at x",
  });
  timeline.console({ time: 20_000, level: 'error', source: 'console', text: 'console errors alone do not start one' });
  timeline.console({ time: 30_000, level: 'error', source: 'exception', text: 'later' });
  const episodes = timeline.episodes.values();
  assert.equal(episodes.length, 2);
  const [first] = episodes;
  assert.match(first.id, /^yk_ep_[0-9a-f]{5}$/);
  assert.deepEqual(
    first.events.map((event) => event.summary),
    [
      'Clicked button "Save"',
      'POST /api/users',
      '500 Internal Server Error POST /api/users',
      "TypeError: Cannot read properties of undefined (reading 'id')",
    ],
  );
  const [, req, res, error] = first.events;
  assert.deepEqual([res.causeId, res.causeConfidence], [req.id, 'direct']);
  assert.deepEqual([error.causeId, error.causeConfidence], [res.id, 'likely']);
  assert.equal(first.summary, '500 Internal Server Error POST /api/users');
  const preview = episodePreview(first);
  assert.equal(preview.id, first.id);
  assert.equal(preview.lines.length, 4);
  assert.match(preview.lines[0], /^\d\d:\d\d:\d\d {2}Clicked/);
});

test('an exception from the function that made the request is directly linked to its response', () => {
  const timeline = new Timeline(() => PAGE);
  const frame = { functionName: 'saveUser', url: 'http://localhost:3000/src/api.ts', line: 10, column: 3 };
  timeline.request(request('r1', 100, { initiator: { type: 'script', stack: [frame] } }));
  timeline.response({ ...request('r1', 100), status: 500 }, 5000);
  timeline.console({ time: 9000, level: 'error', source: 'exception', text: 'boom', stack: [{ ...frame, line: 14 }] });
  const error = timeline.events.values().at(-1);
  assert.equal(error.causeConfidence, 'direct');
});

test('sharesUserFrame ignores anonymous and library frames', () => {
  const lib = {
    functionName: 'fetchJson',
    url: 'http://localhost:3000/node_modules/.vite/deps/x.js',
    line: 1,
    column: 1,
  };
  const anon = { functionName: '(anonymous)', url: 'http://localhost:3000/src/a.ts', line: 1, column: 1 };
  assert.equal(sharesUserFrame([lib, anon], [lib, anon]), false);
});

test('canceled requests and repeated errors do not start new episodes', () => {
  const timeline = new Timeline(() => PAGE);
  timeline.response({ ...request('c', 1), failure: 'canceled' }, 2);
  assert.equal(timeline.events.size, 0);
  timeline.console({ time: 1000, level: 'error', source: 'exception', text: 'a' });
  timeline.console({ time: 2500, level: 'error', source: 'exception', text: 'b' });
  assert.equal(timeline.episodes.size, 1);
  assert.equal(timeline.latestEpisode.events.length, 2);
});

test('summaries describe actions without values and shorten same-origin URLs', () => {
  assert.equal(
    actionSummary({ phase: 'start', kind: 'input', time: 0, target: { tag: 'input', name: 'email' }, valueLength: 12 }),
    'Changed input[name=email] (12 characters)',
  );
  assert.equal(
    actionSummary({ phase: 'start', kind: 'key', time: 0, target: { tag: 'input', id: 'q' }, key: 'Enter' }),
    'Pressed Enter in input#q',
  );
  assert.equal(shortUrl('http://localhost:3000/api?x=1', PAGE), '/api?x=1');
  assert.equal(shortUrl('https://api.example.com/v1', PAGE), 'https://api.example.com/v1');
});

test('page action payloads are validated', () => {
  assert.equal(parsePageAction('not json'), null);
  assert.equal(parsePageAction(JSON.stringify({ phase: 'start', kind: 'hack', target: {} })), null);
  const action = parsePageAction(
    JSON.stringify({ phase: 'start', kind: 'click', time: 5, target: { tag: 'a', text: 'x'.repeat(500), id: 7 } }),
  );
  assert.equal(action.target.text.length, 200);
  assert.equal(action.target.id, undefined);
});

test('TabRuntime feeds the timeline from CDP events and bindings', () => {
  const runtime = new TabRuntime(() => PAGE);
  runtime.handle('Runtime.bindingCalled', { name: '__yalqenAgentAction', payload: JSON.stringify(click(Date.now())) });
  runtime.handle('Runtime.bindingCalled', { name: 'somethingElse', payload: '{}' });
  runtime.handle('Network.requestWillBeSent', {
    requestId: 'r1',
    type: 'Fetch',
    timestamp: 1,
    wallTime: Date.now() / 1000,
    request: { url: 'http://localhost:3000/api/users', method: 'POST', headers: {} },
    initiator: { type: 'script' },
  });
  runtime.handle('Network.responseReceived', {
    requestId: 'r1',
    type: 'Fetch',
    response: { status: 500, headers: {} },
  });
  assert.deepEqual(
    runtime.timeline.events.values().map((event) => event.kind),
    ['click', 'request', 'response'],
  );
  assert.equal(runtime.timeline.episodes.size, 1);
});

test('closing an episode keeps later events out of it', () => {
  const timeline = new Timeline(() => PAGE);
  timeline.console({ time: 1000, level: 'error', source: 'exception', text: 'a' });
  timeline.closeEpisode();
  timeline.request(request('r1', 1500));
  assert.equal(timeline.latestEpisode.events.length, 1);
});
