import assert from 'node:assert/strict';
import { test } from 'node:test';
import accent from '../../dist/shared/accent.js';
import windowColor from '../../dist/shared/window-color.js';

const { ACCENT_COLORS } = accent;
const { MIN_CONTRAST, WINDOW_BASES, contrastRatio, isWindowColor, windowColorHex, windowTint, windowTintVars } =
  windowColor;

const hexOf = (wanted) => ACCENT_COLORS.find(({ id }) => id === wanted).hex;

test('every accent keeps text readable on tinted chrome in light and dark', () => {
  for (const { id, hex } of ACCENT_COLORS) {
    const tint = windowTint(hex);
    for (const scheme of ['light', 'dark']) {
      const { text } = WINDOW_BASES[scheme];
      for (const surface of [tint[scheme].bg, tint[scheme].glass]) {
        assert.ok(contrastRatio(text, surface) >= MIN_CONTRAST, `${id} ${scheme} text`);
        assert.ok(contrastRatio(tint[scheme].muted, surface) >= MIN_CONTRAST, `${id} ${scheme} muted`);
      }
    }
  }
});

test('the tint moves the surfaces toward the color', () => {
  const tint = windowTint('#ec5f4b');
  assert.notDeepEqual(tint.light.bg, WINDOW_BASES.light.bg);
  assert.ok(tint.light.bg[0] > tint.light.bg[2]);
  assert.ok(tint.dark.bg[0] > tint.dark.bg[2]);
});

test('window color resolves to a hex or to no tint', () => {
  assert.equal(windowColorHex('none', 'ocean'), null);
  assert.equal(windowColorHex('accent', 'ocean'), hexOf('ocean'));
  assert.equal(windowColorHex('mint', 'ocean'), hexOf('mint'));
  assert.ok(Object.values(windowTintVars(null)).every((value) => value === null));
  assert.ok(Object.values(windowTintVars('#3a8ee6')).every((value) => /^rgb\(\d+ \d+ \d+\)$/.test(value)));
});

test('only known window colors are accepted', () => {
  assert.ok(isWindowColor('none') && isWindowColor('accent') && isWindowColor('lavender'));
  assert.ok(!isWindowColor('#ff0000') && !isWindowColor(undefined));
});
