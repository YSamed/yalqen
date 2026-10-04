import assert from 'node:assert/strict';
import { test } from 'node:test';
import reference from '../../../dist/main/agent-bridge/reference.js';

const { DESCRIBE_REFERENCE, newReferenceId, referencePrompt, referenceRef, referenceStyles } = reference;

test('reference ids are yk_ref_ and six hex digits', () => {
  assert.match(newReferenceId(), /^yk_ref_[0-9a-f]{6}$/);
  assert.notEqual(newReferenceId(), newReferenceId());
});

test('the in-page describer is a valid function', () => {
  assert.equal(typeof new Function(`return ${DESCRIBE_REFERENCE}`)(), 'function');
});

test('reference styles keep design properties and drop empty defaults', () => {
  const styles = referenceStyles([
    { name: 'display', value: 'grid' },
    { name: 'box-shadow', value: '0 1px 2px rgba(0, 0, 0, 0.1)' },
    { name: 'background-color', value: 'rgba(0, 0, 0, 0)' },
    { name: 'letter-spacing', value: 'normal' },
    { name: 'cursor', value: 'pointer' },
    { name: 'position', value: 'static' },
    { name: 'flex-direction', value: 'row' },
    { name: 'border-top-color', value: 'rgb(0, 0, 0)' },
  ]);
  assert.deepEqual(styles, { display: 'grid', 'box-shadow': '0 1px 2px rgba(0, 0, 0, 0.1)' });
});

test('a reference becomes a chip marked as a reference', () => {
  const ref = referenceRef({ id: 'yk_ref_000001', url: 'https://example.com/', label: 'nav.top' }, 'tab-2');
  assert.deepEqual(ref, {
    id: 'yk_ref_000001',
    tabId: 'tab-2',
    url: 'https://example.com/',
    label: 'nav.top',
    component: null,
    source: null,
    reference: true,
  });
});

test('no references add nothing to the prompt', () => {
  assert.equal(referencePrompt([]), '');
});

test('the prompt marks truncated HTML', () => {
  const prompt = referencePrompt([
    {
      id: 'yk_ref_000002',
      url: 'https://example.com/',
      title: 'Example',
      label: 'footer',
      selector: 'footer',
      box: null,
      styles: {},
      design: {},
      outline: 'footer',
      html: { text: '<footer>', truncated: true },
      screenshot: null,
    },
  ]);
  assert.match(prompt, /a part of another website/);
  assert.match(prompt, /HTML \(truncated\):\n<footer>/);
});
