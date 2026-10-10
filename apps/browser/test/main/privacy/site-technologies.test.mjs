import assert from 'node:assert/strict';
import { test } from 'node:test';
import technologies from '../../../dist/main/privacy/site-technologies.js';

const { detectTechnologies, parseTechnologySignals } = technologies;

const signals = (overrides = {}) => ({ resources: [], generator: '', selectors: [], globals: [], ...overrides });

test('technologies are matched from scripts, generator, markers and globals', () => {
  const found = detectTechnologies(
    signals({
      resources: ['/wp-content/themes/a/app.js', 'https://code.jquery.com/jquery-3.7.1.min.js'],
      generator: 'WordPress 6.5',
      selectors: ['#__next'],
      globals: ['jQuery'],
    }),
    [],
  );
  assert.deepEqual(found, ['jQuery', 'Next.js', 'WordPress']);
});

test('cookie names alone identify a technology', () => {
  assert.deepEqual(detectTechnologies(null, ['_ga_ABC123', 'PHPSESSID']), ['Google Analytics', 'PHP']);
});

test('an empty page reports nothing', () => {
  assert.deepEqual(detectTechnologies(signals(), []), []);
});

test('hostile page output is reduced to bounded strings', () => {
  assert.equal(parseTechnologySignals('x'), null);
  const parsed = parseTechnologySignals({
    resources: [1, 'a'.repeat(5000), ...new Array(1000).fill('b')],
    generator: { toString: 'x' },
    selectors: 'nope',
    globals: ['jQuery', null],
  });
  assert.equal(parsed.resources.length, 399);
  assert.equal(parsed.resources[0].length, 300);
  assert.equal(parsed.generator, '');
  assert.deepEqual(parsed.selectors, []);
  assert.deepEqual(parsed.globals, ['jQuery']);
});
