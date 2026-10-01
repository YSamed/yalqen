import assert from 'node:assert/strict';
import { test } from 'node:test';
import popups from '../dist/main/popups.js';
import i18n from '../dist/shared/i18n.js';

i18n.setLocale('tr');

const { ACTIVATION_MS, MAX_BLOCKED, blockedPopupsTemplate, isActivation, mayOpenWindow, recordBlocked } = popups;

test('a recent click or key press lets a page open a window', () => {
  assert.equal(mayOpenWindow(0, 10_000, false), false);
  assert.equal(mayOpenWindow(10_000, 10_000 + ACTIVATION_MS, false), true);
  assert.equal(mayOpenWindow(10_000, 10_001 + ACTIVATION_MS, false), false);
  assert.equal(mayOpenWindow(0, 10_000, true), true);
  assert.equal(isActivation('mouseDown'), true);
  assert.equal(isActivation('rawKeyDown'), true);
  assert.equal(isActivation('mouseMove'), false);
  assert.equal(isActivation('mouseWheel'), false);
});

test('blocked addresses are kept newest last, without duplicates or scripts', () => {
  let blocked = [];
  for (let i = 0; i < MAX_BLOCKED + 2; i++) blocked = recordBlocked(blocked, `https://a.com/${i}`);
  assert.equal(blocked.length, MAX_BLOCKED);
  assert.equal(blocked[0], 'https://a.com/2');
  blocked = recordBlocked(blocked, 'https://a.com/2');
  assert.equal(blocked.at(-1), 'https://a.com/2');
  assert.equal(blocked.length, MAX_BLOCKED);
  assert.deepEqual(recordBlocked([], 'javascript:alert(1)'), []);
  assert.deepEqual(recordBlocked([], 'about:blank'), []);
});

test('the menu opens a blocked page or allows the site', () => {
  const calls = [];
  const long = `https://a.com/${'x'.repeat(80)}`;
  const items = blockedPopupsTemplate('a.com', ['https://a.com/1', long], {
    open: (url) => calls.push(['open', url]),
    allowSite: () => calls.push(['allow']),
  });
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    [
      'Açılır pencere engellendi',
      'https://a.com/1',
      `${long.slice(0, 59)}…`,
      '-',
      'a.com için açılır pencerelere her zaman izin ver',
    ],
  );
  items[2].click();
  items[4].click();
  assert.deepEqual(calls, [['open', long], ['allow']]);
});
