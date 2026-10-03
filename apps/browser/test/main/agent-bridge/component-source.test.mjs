import assert from 'node:assert/strict';
import { test } from 'node:test';
import componentSource from '../../../dist/main/agent-bridge/component-source.js';

const { NO_COMPONENT, componentInfo, formatLocation, needsInlineMap, projectPath } = componentSource;

test('projectPath turns bundler spellings into project paths', () => {
  const cases = [
    ['webpack-internal:///(app-pages-browser)/./src/components/Button.tsx', 'src/components/Button.tsx'],
    ['webpack-internal:///./src/App.jsx', 'src/App.jsx'],
    ['webpack://my-app/./src/App.jsx', 'src/App.jsx'],
    ['turbopack://[project]/app/page.tsx', 'app/page.tsx'],
    ['http://localhost:5173/src/features/Cart.tsx?t=1712', 'src/features/Cart.tsx'],
    ['/src/features/product/AddToCartButton.jsx', 'src/features/product/AddToCartButton.jsx'],
    ['/@fs/Users/me/shared/ui/Button.tsx', '/Users/me/shared/ui/Button.tsx'],
    ['file:///Users/me/app/src/App.tsx', '/Users/me/app/src/App.tsx'],
    ['/Users/me/app/app/product/AddToCartButton.jsx', '/Users/me/app/app/product/AddToCartButton.jsx'],
    ['/private/tmp/app/src/x.jsx', '/private/tmp/app/src/x.jsx'],
    ['/(rsc)/./app/page.jsx', 'app/page.jsx'],
    ['webpack://_N_E/./app/product/AddToCartButton.jsx?1a2b', 'app/product/AddToCartButton.jsx'],
  ];
  for (const [input, expected] of cases) assert.equal(projectPath(input), expected, input);
});

const inspection = (overrides = {}) => ({
  framework: 'react',
  development: true,
  component: 'AddToCartButton',
  source: { file: '/src/AddToCartButton.jsx', line: 4, column: 5, mapped: true, raw: null },
  componentSource: { file: '/src/PurchaseActions.jsx', line: 7, column: 7, mapped: true, raw: null },
  owners: ['AddToCartButton', 'PurchaseActions', 'ProductPage'],
  props: { label: '"Add"' },
  children: [],
  ...overrides,
});

test('a mapped line is exact and the owner chain reads from the root down', () => {
  const info = componentInfo(inspection());
  assert.equal(info.confidence, 'exact');
  assert.deepEqual(info.source, { file: 'src/AddToCartButton.jsx', line: 4, column: 5 });
  assert.deepEqual(info.usedAt, { file: 'src/PurchaseActions.jsx', line: 7, column: 7 });
  assert.deepEqual(info.ownerChain, ['ProductPage', 'PurchaseActions', 'AddToCartButton']);
  assert.equal(formatLocation(info.source), 'src/AddToCartButton.jsx:4');
});

test('an unmapped location is dropped and only the component name remains', () => {
  const info = componentInfo(
    inspection({
      source: { file: '/app/.next/server/chunks/x.js', line: 22, column: 1, mapped: false },
      componentSource: null,
    }),
  );
  assert.equal(info.confidence, 'component');
  assert.equal(info.source, null);
  assert.equal(info.component, 'AddToCartButton');
});

test('pages without React, or a failed inspection, fall back to DOM only', () => {
  assert.equal(componentInfo(null), NO_COMPONENT);
  assert.equal(componentInfo({ ...inspection(), framework: null }), NO_COMPONENT);
  assert.equal(componentInfo(inspection({ component: null, source: null })).confidence, 'dom');
});

test('production builds keep readable component names but drop minified ones', () => {
  const production = { source: null, componentSource: null, development: false };
  assert.equal(componentInfo(inspection({ ...production, component: 'yh', owners: ['yh', 'mh'] })), NO_COMPONENT);
  const readable = componentInfo(inspection({ ...production, component: 'CheckoutForm', owners: ['CheckoutForm'] }));
  assert.equal(readable.confidence, 'component');
  assert.equal(readable.component, 'CheckoutForm');
});

test('server component frames keep only the file', () => {
  const info = componentInfo(
    inspection({
      component: 'Page',
      source: {
        file: '/(rsc)/./app/page.jsx',
        line: 13,
        column: 88,
        mapped: true,
        raw: { file: 'about://React/Server/webpack-internal:///(rsc)/./app/page.jsx?3', line: 13, column: 88 },
      },
    }),
  );
  assert.equal(info.confidence, 'component');
  assert.deepEqual(info.source, { file: 'app/page.jsx', line: null, column: null });
});

test('webpack frames that were never mapped are not reported as exact', () => {
  const compiled = {
    file: './app/Button.jsx',
    line: 9,
    column: 87,
    mapped: true,
    raw: { file: 'webpack-internal:///(app-pages-browser)/./app/Button.jsx', line: 9, column: 87 },
  };
  assert.equal(needsInlineMap(compiled), true);
  assert.equal(needsInlineMap({ ...compiled, line: 6, column: 5 }), false);
  assert.equal(componentInfo(inspection({ source: compiled })).confidence, 'component');
});

test('Vue gives the component file without a line', () => {
  const info = componentInfo(
    inspection({
      framework: 'vue',
      component: 'AddToCartButton',
      source: { file: '/Users/me/app/src/AddToCartButton.vue', line: null, column: null, mapped: true, raw: null },
      componentSource: null,
    }),
  );
  assert.equal(info.framework, 'vue');
  assert.equal(info.confidence, 'component');
  assert.deepEqual(info.source, { file: '/Users/me/app/src/AddToCartButton.vue', line: null, column: null });
});
