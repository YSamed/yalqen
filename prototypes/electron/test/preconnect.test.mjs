// Runs against the compiled main-process modules (npm test builds them first).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import preconnect from '../dist/main/preconnect.js';
import search from '../dist/main/search.js';

const { Preconnector, destinationOrigin } = preconnect;
const { resolveSearchEngine } = search;
const google = resolveSearchEngine('google', null);

test('input maps to the origin it would load', () => {
  assert.equal(destinationOrigin('example.com/a?b=1', google), 'https://example.com');
  assert.equal(destinationOrigin('localhost:3000', google), 'http://localhost:3000');
  assert.equal(destinationOrigin('how fast is this', google), 'https://www.google.com');
  assert.equal(destinationOrigin('   ', google), null);
  assert.equal(destinationOrigin('about:blank', google), null);
  assert.equal(destinationOrigin('file:///tmp/a.html', google), null);
});

test('typing connects once it pauses, to the last destination only', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const connected = [];
  const preconnector = new Preconnector((origin) => connected.push(origin), () => 0);
  preconnector.typed('exa', google);
  preconnector.typed('example.co', google);
  preconnector.typed('example.com', google);
  t.mock.timers.tick(149);
  assert.deepEqual(connected, []);
  t.mock.timers.tick(1);
  assert.deepEqual(connected, ['https://example.com']);
});

test('cancel drops a pending connection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const connected = [];
  const preconnector = new Preconnector((origin) => connected.push(origin), () => 0);
  preconnector.typed('example.com', google);
  preconnector.cancel();
  t.mock.timers.tick(1000);
  assert.deepEqual(connected, []);
});

test('an origin is not connected to again while its socket is recent', () => {
  let now = 0;
  const connected = [];
  const preconnector = new Preconnector((origin) => connected.push(origin), () => now);
  preconnector.opened(google);
  now = 9_999;
  preconnector.opened(google);
  assert.deepEqual(connected, ['https://www.google.com']);
  now = 10_000;
  preconnector.opened(google);
  assert.deepEqual(connected, ['https://www.google.com', 'https://www.google.com']);
});
