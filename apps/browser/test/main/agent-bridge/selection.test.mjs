import assert from 'node:assert/strict';
import { test } from 'node:test';
import selection from '../../../dist/main/agent-bridge/selection.js';

const { attributeMap, boxFromQuad, elementLabel, layoutStyles, newSelectionId, selectionRef, shortText } = selection;

test('selection ids are yk_ and six hex digits', () => {
  assert.match(newSelectionId(), /^yk_[0-9a-f]{6}$/);
  assert.notEqual(newSelectionId(), newSelectionId());
});

test('attribute lists become maps', () => {
  assert.deepEqual(attributeMap(['class', 'primary big', 'id', 'buy', 'dangling']), {
    class: 'primary big',
    id: 'buy',
  });
  assert.deepEqual(attributeMap(undefined), {});
});

test('labels show tag, id, two classes and short visible text', () => {
  assert.equal(
    elementLabel('button', { class: 'primary big wide' }, 'Add to cart'),
    'button.primary.big "Add to cart"',
  );
  assert.equal(elementLabel('input', { id: 'email', placeholder: 'Email' }, ''), 'input#email "Email"');
  assert.equal(elementLabel('div', {}, ''), 'div');
  assert.equal(elementLabel('p', {}, 'x'.repeat(80)), `p "${'x'.repeat(39)}…"`);
});

test('shortText collapses whitespace and clips', () => {
  assert.equal(shortText('  a \n  b  '), 'a b');
  assert.equal(shortText('abcdef', 4), 'abc…');
});

test('boxFromQuad turns corners into a box', () => {
  assert.deepEqual(boxFromQuad([10, 20, 110, 20, 110, 70, 10, 70]), { x: 10, y: 20, width: 100, height: 50 });
  assert.equal(boxFromQuad([1, 2]), null);
  assert.equal(boxFromQuad(undefined), null);
});

test('layoutStyles keeps layout properties and drops unremarkable defaults', () => {
  const styles = layoutStyles([
    { name: 'display', value: 'flex' },
    { name: 'position', value: 'static' },
    { name: 'width', value: 'auto' },
    { name: 'max-width', value: 'none' },
    { name: 'margin-top', value: '0px' },
    { name: 'padding-left', value: '20px' },
    { name: 'cursor', value: 'pointer' },
  ]);
  assert.deepEqual(styles, { display: 'flex', position: 'static', width: 'auto', 'padding-left': '20px' });
});

test('a selection reference keeps only what the chat shows', () => {
  const base = { id: 'yk_a1b2c3', tabId: 'tab-1', url: 'http://localhost:3000/', label: 'div' };
  const full = {
    ...base,
    html: { text: '<div>secret</div>', truncated: false },
    screenshot: 'AAAA',
    component: { component: 'Card', source: { file: 'src/Card.tsx', line: 8, column: 3 } },
  };
  assert.deepEqual(selectionRef(full), { ...base, component: 'Card', source: 'src/Card.tsx:8' });
  assert.deepEqual(selectionRef({ ...base, component: { component: null, source: null } }), {
    ...base,
    component: null,
    source: null,
  });
});
