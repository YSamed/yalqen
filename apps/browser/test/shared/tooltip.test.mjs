import assert from 'node:assert/strict';
import { test } from 'node:test';
import tooltip from '../../dist/shared/tooltip.js';
import previews from '../../dist/shared/previews.js';

const { splitShortcut, placeTooltip, validTooltip, TOOLTIP_EDGE, TOOLTIP_GAP } = tooltip;

test('a trailing shortcut becomes key caps', () => {
  assert.deepEqual(splitShortcut('Reload (⌘R)'), { text: 'Reload', keys: ['⌘', 'R'] });
  assert.deepEqual(splitShortcut('AI panel (⇧⌘A)'), { text: 'AI panel', keys: ['⇧', '⌘', 'A'] });
  assert.deepEqual(splitShortcut('Settings (⌘,)'), { text: 'Settings', keys: ['⌘', ','] });
  assert.deepEqual(splitShortcut('Sekmeyi kapat (⌘w)'), { text: 'Sekmeyi kapat', keys: ['⌘', 'W'] });
});

test('titles without a modifier shortcut stay as text', () => {
  assert.deepEqual(splitShortcut('Close'), { text: 'Close', keys: [] });
  assert.deepEqual(splitShortcut('Downloads (3)'), { text: 'Downloads (3)', keys: [] });
  assert.deepEqual(splitShortcut('https://example.com/a(b)'), { text: 'https://example.com/a(b)', keys: [] });
  assert.deepEqual(splitShortcut('(⌘R)'), { text: '(⌘R)', keys: [] });
});

test('the tooltip sits centred below its anchor', () => {
  const place = placeTooltip(
    { x: 100, y: 10, width: 40, height: 30 },
    { width: 80, height: 26 },
    { width: 800, height: 600 },
  );
  assert.deepEqual(place, { x: 80, y: 10 + 30 + TOOLTIP_GAP });
});

test('the tooltip stays inside the window', () => {
  const left = placeTooltip(
    { x: 0, y: 10, width: 20, height: 20 },
    { width: 120, height: 26 },
    { width: 800, height: 600 },
  );
  assert.equal(left.x, TOOLTIP_EDGE);
  const right = placeTooltip(
    { x: 790, y: 10, width: 10, height: 20 },
    { width: 120, height: 26 },
    { width: 800, height: 600 },
  );
  assert.equal(right.x, 800 - 120 - TOOLTIP_EDGE);
});

test('an anchor at the bottom of the window gets its tooltip above', () => {
  const place = placeTooltip(
    { x: 10, y: 560, width: 34, height: 34 },
    { width: 100, height: 26 },
    { width: 800, height: 600 },
  );
  assert.equal(place.y, 560 - TOOLTIP_GAP - 26);
});

const request = {
  text: 'Reload',
  keys: ['⌘', 'R'],
  anchor: { x: 1, y: 2, width: 3, height: 4 },
  theme: { dark: false, surface: '#fff', text: '#000', accent: 'rgb(10 132 255)', border: 'rgb(0 0 0 / 0.1)' },
};

test('a well-formed tooltip request is accepted as is', () => {
  assert.deepEqual(validTooltip(request), request);
});

test('malformed tooltip requests are dropped', () => {
  assert.equal(validTooltip(null), null);
  assert.equal(validTooltip({ ...request, text: '' }), null);
  assert.equal(validTooltip({ ...request, text: 'x'.repeat(201) }), null);
  assert.equal(validTooltip({ ...request, keys: 'R' }), null);
  assert.equal(validTooltip({ ...request, keys: ['toolongkey'] }), null);
  assert.equal(validTooltip({ ...request, anchor: { x: 1, y: 2, width: Infinity, height: 4 } }), null);
  assert.equal(validTooltip({ ...request, theme: { ...request.theme, dark: 'no' } }), null);
  assert.equal(validTooltip({ ...request, theme: { ...request.theme, accent: 'x'.repeat(121) } }), null);
});

test('overlay shadows stay inside the room around their surface', () => {
  const { shadowFits, TOOLTIP_PAD, TOOLTIP_SHADOW } = tooltip;
  // A shadow that reaches past the view is cut off into a hard edge.
  assert.equal(shadowFits(TOOLTIP_SHADOW, TOOLTIP_PAD), true);
  assert.equal(shadowFits(previews.PREVIEW_SHADOW, previews.PREVIEW_PAD), true);
  assert.equal(shadowFits({ y: 6, blur: 18 }, 10), false);
  assert.equal(shadowFits({ y: -3, blur: 8 }, 10), false);
});
