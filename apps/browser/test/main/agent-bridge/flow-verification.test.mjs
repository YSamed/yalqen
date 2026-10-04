import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import flow from '../../../dist/main/agent-bridge/flow-verification.js';

const { validateFlowPlan, executeFlow, assertionResult, assertionExpression, PAGE_STRUCTURE_EXPRESSION } = flow;
const plan = (extra = {}) =>
  validateFlowPlan({
    steps: [],
    assertions: [{ kind: 'count', selector: '.item', expected: 2 }],
    assertion_timeout_ms: 0,
    ...extra,
  });
const observe = (extra = {}) => ({ url: 'http://localhost:3000/', count: 1, visible: 1, ...extra });
const driver = (extra = {}) => ({
  ensure() {},
  url: () => 'http://localhost:3000/',
  perform: async () => {},
  observe: async () => observe({ count: 2, visible: 2 }),
  runtimeErrors: () => [],
  ...extra,
});

test('flows require bounded deterministic assertions and reject malformed steps and unknown fields', () => {
  assert.equal(plan().timeout_ms, 15_000);
  for (const input of [
    { assertions: [] },
    { steps: Array.from({ length: 21 }, () => ({ action: 'click', selector: '#save' })) },
    { assertions: [{ kind: 'count', selector: '.item' }] },
    { assertions: [{ kind: 'count', selector: '.item', expected: -1 }] },
    { assertions: [{ kind: 'text', selector: '#result', expected: '', match: 'contains' }] },
    { steps: [{ action: 'press', selector: '#search', key: 'Escape' }] },
    { steps: [{ action: 'click', selector: '#save', script: 'dangerous()' }] },
    { timeout_ms: 30_001 },
    { assertion_timeout_ms: 10_001 },
    { check_runtime_errors: 'yes' },
    { typo: true },
  ])
    assert.throws(() => plan(input));
  assert.equal(plan({ assertions: [{ kind: 'count', selector: '.item', expected: 0 }] }).assertions[0].expected, 0);
});

test('clean runtime does not prove a UI outcome passed', async () => {
  const output = await executeFlow(
    plan(),
    driver({ observe: async () => observe({ count: 1 }) }),
    new AbortController().signal,
  );
  assert.equal(output.result, 'failed');
  assert.equal(output.assertions[0].actual, 1);
  assert.equal(output.assertions[0].expected, 2);
  assert.equal(output.assertions[0].passed, false);
  assert.deepEqual(output.errors, []);
});

test('assertions poll actual page state until expected content appears', async () => {
  let reads = 0;
  const output = await executeFlow(
    plan({ assertion_timeout_ms: 500 }),
    driver({ observe: async () => observe({ count: ++reads === 1 ? 1 : 2 }) }),
    new AbortController().signal,
  );
  assert.equal(output.result, 'passed');
  assert.ok(reads >= 2);
  assert.equal(output.assertions[0].actual, 2);
});

test('start URL guard fails before performing any actions', async () => {
  let performed = 0;
  const output = await executeFlow(
    plan({ start_url: 'http://localhost:3000/old', steps: [{ action: 'click', selector: '#save' }] }),
    driver({ perform: async () => performed++ }),
    new AbortController().signal,
  );
  assert.equal(output.result, 'failed');
  assert.equal(performed, 0);
  assert.match(output.errors[0], /URL changed/);
  assert.equal(output.assertions[0].actual, null);
  assert.match(output.assertions[0].error, /stopped before/);
});

test('runtime failures fail a matching UI outcome unless their check is explicitly disabled', async () => {
  const checked = driver({ runtimeErrors: () => ['POST /checkout: 500'] });
  assert.equal((await executeFlow(plan(), checked, new AbortController().signal)).result, 'failed');
  assert.equal(
    (await executeFlow(plan({ check_runtime_errors: false }), checked, new AbortController().signal)).result,
    'passed',
  );
});

test('scope changes and Stop prevent later actions and do not claim unchecked assertions', async () => {
  let allowed = true;
  let performed = 0;
  const scoped = driver({
    ensure: () => {
      if (!allowed) throw new Error('Left development scope');
    },
    perform: async () => {
      performed++;
      allowed = false;
    },
  });
  const steps = [
    { action: 'click', selector: '#one' },
    { action: 'click', selector: '#two' },
  ];
  const output = await executeFlow(plan({ steps }), scoped, new AbortController().signal);
  assert.equal(output.result, 'failed');
  assert.equal(performed, 1);
  assert.equal(output.steps[0].passed, false);
  assert.equal(output.assertions[0].passed, false);
  const controller = new AbortController();
  const stopped = executeFlow(plan({ steps }), driver({ perform: () => new Promise(() => {}) }), controller.signal);
  controller.abort(new Error('Stopped by the user'));
  const result = await stopped;
  assert.match(result.errors[0], /Stopped/);
  assert.equal(result.steps.length, 1);
});

test('whole-flow deadline bounds a hung browser operation', async () => {
  const output = await executeFlow(
    plan({ timeout_ms: 1000, steps: [{ action: 'click', selector: '#hung' }] }),
    driver({ perform: () => new Promise(() => {}) }),
    new AbortController().signal,
  );
  assert.equal(output.result, 'failed');
  assert.match(output.errors[0], /deadline/);
  assert.ok(output.duration_ms < 1800);
});

test('text and value assertions are exact by default, bounded, and never pass ambiguous or redacted evidence', () => {
  const text = { kind: 'text', selector: '#label', expected: 'Cart\n total: 10', match: 'exact' };
  assert.equal(assertionResult(text, observe({ text: 'Cart total: 10' })).passed, true);
  assert.equal(assertionResult(text, observe({ text: 'Cart total: 10', count: 2 })).passed, false);
  assert.equal(assertionResult(text, observe({ text: 'Cart total: 10', visible: 0 })).passed, false);
  assert.equal(assertionResult(text, observe({ text: 'Cart total: 10', truncated: true })).passed, false);
  assert.equal(
    assertionResult(
      { kind: 'value', selector: '#password', expected: 'secret', match: 'exact' },
      observe({ redacted: true, error: 'Password values are never read.' }),
    ).passed,
    false,
  );
  assert.equal(assertionResult({ kind: 'hidden', selector: '#gone' }, observe({ count: 0, visible: 0 })).passed, true);
  assert.equal(assertionResult({ kind: 'visible', selector: '.all' }, observe({ count: 2, visible: 1 })).passed, false);
});

function domFixture() {
  class Element {
    constructor(tag, text = '', extra = {}) {
      this.localName = tag;
      this.textContent = text;
      this.id = '';
      this.isConnected = true;
      this.parentElement = null;
      this.hidden = false;
      this.style = { display: 'block', visibility: 'visible', opacity: '1' };
      this.attributes = {};
      Object.assign(this, extra);
    }
    getClientRects() {
      return this.style.display === 'none' ? [] : [{}];
    }
    getBoundingClientRect() {
      return { width: 10, height: 10 };
    }
    getAttribute(key) {
      return this.attributes[key] ?? null;
    }
    matches(selector) {
      return selector
        .split(',')
        .some(
          (part) =>
            part === this.localName ||
            (part === '[contenteditable]' && this.attributes.contenteditable !== undefined) ||
            (part === 'input[type=password]' && this.localName === 'input' && this.attributes.type === 'password') ||
            (part === 'input[type=hidden]' && this.localName === 'input' && this.attributes.type === 'hidden'),
        );
    }
    cloneNode() {
      return { textContent: this.textContent, querySelectorAll: () => [] };
    }
  }
  const nodes = {
    '#save': new Element('button', 'Save', { id: 'save' }),
    '#name': new Element('input', '', { id: 'name', attributes: { type: 'text', placeholder: 'Name' } }),
    '#secret': new Element('input', '', { id: 'secret', attributes: { type: 'password' } }),
    '#transparent': new Element('button', 'Transparent', {
      id: 'transparent',
      style: { display: 'block', visibility: 'visible', opacity: '0' },
    }),
    '#gone': new Element('button', 'Gone', { id: 'gone', style: { display: 'none', visibility: 'visible' } }),
  };
  Object.defineProperty(nodes['#name'], 'value', {
    get() {
      throw new Error('User field value was read');
    },
  });
  Object.defineProperty(nodes['#secret'], 'value', {
    get() {
      throw new Error('Password value was read');
    },
  });
  const context = vm.createContext({
    Element,
    CSS: { escape: (text) => text },
    location: { href: 'http://localhost:3000/' },
    getComputedStyle: (element) => element.style,
    document: {
      title: 'Shop',
      querySelectorAll: (selector) =>
        selector.startsWith('button,') ? Object.values(nodes) : nodes[selector] ? [nodes[selector]] : [],
    },
  });
  return { nodes, context };
}

test('page structure exposes safe labels/selectors without evaluating field values or scripts', () => {
  const { context } = domFixture();
  const structure = JSON.parse(JSON.stringify(vm.runInContext(PAGE_STRUCTURE_EXPRESSION, context)));
  assert.equal(structure.url, 'http://localhost:3000/');
  assert.equal(structure.elements.find((element) => element.selector === '#name').label, 'Name');
  assert.equal(structure.elements.find((element) => element.selector === '#secret').type, 'password');
  assert.equal(
    structure.elements.some((element) => element.selector === '#gone'),
    false,
  );
  assert.equal(
    structure.elements.some((element) => 'value' in element),
    false,
  );
});

test('DOM assertions distinguish rendered opacity-zero elements from hidden elements and never read passwords', () => {
  const { context } = domFixture();
  const read = (check) => JSON.parse(JSON.stringify(vm.runInContext(assertionExpression(check), context)));
  assert.equal(read({ kind: 'hidden', selector: '#transparent' }).visible, 1);
  assert.equal(read({ kind: 'hidden', selector: '#gone' }).visible, 0);
  const secret = read({ kind: 'value', selector: '#secret', expected: 'ignored', match: 'exact' });
  assert.equal(secret.redacted, true);
  assert.equal('value' in secret, false);
  assert.match(secret.error, /never read/);
});
