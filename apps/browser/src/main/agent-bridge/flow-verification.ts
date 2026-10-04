import type { WebContents } from 'electron';

export const MAX_FLOW_STEPS = 20;
export const MAX_FLOW_ASSERTIONS = 20;
const MAX_SELECTOR = 1024;
const MAX_VALUE = 4096;
const POLL_MS = 100;

export type FlowStep =
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'press'; selector: string; key: 'Enter' }
  | { action: 'navigate'; url: string };
export type FlowAssertion =
  | { kind: 'visible' | 'hidden'; selector: string }
  | { kind: 'text' | 'value'; selector: string; expected: string; match: 'exact' | 'contains' }
  | { kind: 'count'; selector: string; expected: number }
  | { kind: 'url'; expected: string; match: 'exact' | 'contains' };
export interface FlowPlan {
  name: string;
  start_url?: string;
  steps: FlowStep[];
  assertions: FlowAssertion[];
  timeout_ms: number;
  assertion_timeout_ms: number;
  check_runtime_errors: boolean;
}
export interface FlowObservation {
  url: string;
  count: number;
  visible: number;
  text?: string;
  value?: string;
  redacted?: boolean;
  truncated?: boolean;
  error?: string;
}
export interface FlowAssertionResult {
  kind: FlowAssertion['kind'];
  selector?: string;
  expected?: string | number;
  match?: 'exact' | 'contains';
  actual: string | number | boolean | null;
  passed: boolean;
  missing: boolean;
  summary: string;
  error?: string;
  truncated?: boolean;
}
export interface FlowResult {
  result: 'passed' | 'failed';
  name: string;
  steps: { action: FlowStep['action']; target: string; passed: boolean; error?: string }[];
  assertions: FlowAssertionResult[];
  errors: string[];
  duration_ms: number;
}
export interface FlowDriver {
  ensure(): void;
  url(): string;
  perform(step: FlowStep, signal: AbortSignal): Promise<void>;
  observe(assertion: FlowAssertion, signal: AbortSignal): Promise<FlowObservation>;
  runtimeErrors(): string[];
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown flow input field.');
}
function bounded(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max)
    throw new Error(`${name} must be ${empty ? 'a' : 'a non-empty'} string of at most ${max} characters.`);
  return value;
}
function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return Number(value);
}

export function validateFlowPlan(value: unknown): FlowPlan {
  const input = record(value, 'flow');
  keys(input, [
    'tab',
    'name',
    'start_url',
    'steps',
    'assertions',
    'timeout_ms',
    'assertion_timeout_ms',
    'check_runtime_errors',
  ]);
  if (!Array.isArray(input.steps) || input.steps.length > MAX_FLOW_STEPS)
    throw new Error(`steps must be an array of at most ${MAX_FLOW_STEPS} actions.`);
  if (
    !Array.isArray(input.assertions) ||
    input.assertions.length === 0 ||
    input.assertions.length > MAX_FLOW_ASSERTIONS
  )
    throw new Error(`assertions must include 1-${MAX_FLOW_ASSERTIONS} expected UI outcomes.`);
  const steps: FlowStep[] = input.steps.map((value) => {
    const step = record(value, 'step');
    if (step.action === 'navigate') {
      keys(step, ['action', 'url']);
      const url = bounded(step.url, 'url', 2048);
      if (!/^https?:\/\//.test(url)) throw new Error('navigate url must be an absolute http or https address.');
      return { action: 'navigate', url };
    }
    const selector = bounded(step.selector, 'selector', MAX_SELECTOR);
    if (step.action === 'click') {
      keys(step, ['action', 'selector']);
      return { action: 'click', selector };
    }
    if (step.action === 'fill') {
      keys(step, ['action', 'selector', 'value']);
      return { action: 'fill', selector, value: bounded(step.value, 'value', MAX_VALUE, true) };
    }
    if (step.action === 'press' && step.key === 'Enter') {
      keys(step, ['action', 'selector', 'key']);
      return { action: 'press', selector, key: 'Enter' };
    }
    throw new Error('A flow step must click, fill, press Enter, or navigate.');
  });
  const assertions: FlowAssertion[] = input.assertions.map((value) => {
    const assertion = record(value, 'assertion');
    const kind = assertion.kind;
    const match = assertion.match ?? 'exact';
    if (kind === 'url') {
      keys(assertion, ['kind', 'expected', 'match']);
      if (match !== 'exact' && match !== 'contains') throw new Error('match must be exact or contains.');
      return { kind, expected: bounded(assertion.expected, 'expected', 2048), match };
    }
    const selector = bounded(assertion.selector, 'selector', MAX_SELECTOR);
    if (kind === 'visible' || kind === 'hidden') {
      keys(assertion, ['kind', 'selector']);
      return { kind, selector };
    }
    if (kind === 'count') {
      keys(assertion, ['kind', 'selector', 'expected']);
      if (assertion.expected === undefined) throw new Error('count assertions need an expected count.');
      return { kind, selector, expected: integer(assertion.expected, 0, 0, 10_000, 'expected count') };
    }
    if (kind === 'text' || kind === 'value') {
      keys(assertion, ['kind', 'selector', 'expected', 'match']);
      if (match !== 'exact' && match !== 'contains') throw new Error('match must be exact or contains.');
      return { kind, selector, expected: bounded(assertion.expected, 'expected', MAX_VALUE, match === 'exact'), match };
    }
    throw new Error('An assertion must check visible, hidden, text, value, count, or url.');
  });
  if (input.check_runtime_errors !== undefined && typeof input.check_runtime_errors !== 'boolean')
    throw new Error('check_runtime_errors must be a boolean.');
  return {
    name: input.name === undefined ? 'User flow' : bounded(input.name, 'name', 120),
    ...(input.start_url !== undefined && { start_url: bounded(input.start_url, 'start_url', 2048) }),
    steps,
    assertions,
    timeout_ms: integer(input.timeout_ms, 15_000, 1000, 30_000, 'timeout_ms'),
    assertion_timeout_ms: integer(input.assertion_timeout_ms, 3000, 0, 10_000, 'assertion_timeout_ms'),
    check_runtime_errors: input.check_runtime_errors !== false,
  };
}

// Read in an isolated world. Layout visibility matches browser-test semantics: an opacity-zero
// element still has a rendered box and is not considered removed/hidden.
const DOM_READ_HELPERS = `
  const short = (text, limit = 200) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const visible = (element) => {
    if (!element.isConnected || !element.getClientRects().length) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || node.hidden) return false;
    }
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const safeText = (element, limit = 4096) => {
    if (element.matches('input,textarea,select,[contenteditable]')) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,input,textarea,select,[contenteditable]').forEach((node) => node.remove());
    return short(clone.textContent, limit);
  };
`;

export const PAGE_STRUCTURE_EXPRESSION = `(() => {
  ${DOM_READ_HELPERS}
  const selectorOf = (element) => {
    if (element.id && element.id.length <= 512 && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    const testId = element.getAttribute('data-testid');
    if (testId && testId.length <= 512) {
      const selector = '[data-testid="' + CSS.escape(testId) + '"]';
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const path = [];
    for (let node = element; node && path.length < 20; node = node.parentElement) {
      const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.localName === node.localName) : [node];
      path.unshift(node.localName + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
    }
    const selector = path.join(' > ');
    return selector.length <= 1024 && document.querySelectorAll(selector).length === 1 ? selector : null;
  };
  const nodes = [...document.querySelectorAll('button,a[href],input,textarea,select,form,h1,h2,h3,[role=button],[role=tab],[role=dialog],[data-testid]')];
  const shown = nodes.slice(0, 1000).filter(visible);
  return {
    url: location.href,
    title: short(document.title, 200),
    elements: shown.slice(0, 120).map((element) => {
      const field = element.matches('input,textarea,select');
      const label = element.getAttribute('aria-label') || (field && element.labels && [...element.labels].map((node) => safeText(node, 200)).join(' ')) || element.getAttribute('placeholder') || '';
      return {
        selector: selectorOf(element),
        tag: element.localName,
        role: short(element.getAttribute('role'), 60),
        label: short(label),
        text: field || element.localName === 'form' ? '' : safeText(element, 200),
        ...(field && { type: short(element.getAttribute('type') || element.localName, 60), required: element.required === true, disabled: element.disabled === true, readonly: element.readOnly === true }),
        ...(element.form && { form: selectorOf(element.form) })
      };
    }),
    truncated: nodes.length > 1000 || shown.length > 120,
    note: 'Visible controls, fields and headings only; field values, hidden fields and scripts are omitted. Selectors address the main document, not iframes or shadow roots.'
  };
})()`;

export function assertionExpression(assertion: FlowAssertion): string {
  return `(() => {
    ${DOM_READ_HELPERS}
    const check = ${JSON.stringify(assertion)};
    const base = { url: location.href, count: 0, visible: 0 };
    if (check.kind === 'url') return base;
    let nodes;
    try { nodes = [...document.querySelectorAll(check.selector)]; }
    catch { return { ...base, error: 'Invalid CSS selector.' }; }
    base.count = nodes.length;
    base.visible = nodes.filter(visible).length;
    if (nodes.length !== 1 || !['text','value'].includes(check.kind)) return base;
    const element = nodes[0];
    if (check.kind === 'value') {
      if (!element.matches('input,textarea,select')) return { ...base, error: 'Value assertions require a form field.' };
      if (element.matches('input[type=password],input[type=hidden]')) return { ...base, redacted: true, error: 'Password and hidden field values are never read.' };
      const value = element.value;
      return { ...base, value: value.slice(0, 4096), truncated: value.length > 4096 };
    }
    const text = safeText(element, 4097);
    return { ...base, text: text.slice(0, 4096), truncated: text.length > 4096 };
  })()`;
}

export function assertionResult(assertion: FlowAssertion, observed: FlowObservation): FlowAssertionResult {
  let passed = false;
  let actual: FlowAssertionResult['actual'] = null;
  let error = observed.error;
  if (assertion.kind === 'visible') passed = actual = observed.count > 0 && observed.visible === observed.count;
  else if (assertion.kind === 'hidden') passed = actual = observed.visible === 0;
  else if (assertion.kind === 'count') passed = (actual = observed.count) === assertion.expected;
  else if (assertion.kind === 'url') {
    actual = observed.url;
    passed = assertion.match === 'contains' ? actual.includes(assertion.expected) : actual === assertion.expected;
  } else if (observed.count !== 1)
    error ??= observed.count === 0 ? 'Element not found.' : 'Selector matches multiple elements.';
  else if (assertion.kind === 'value') {
    actual = observed.value ?? null;
    passed =
      typeof actual === 'string' &&
      (assertion.match === 'contains'
        ? actual.includes(assertion.expected)
        : !observed.truncated && actual === assertion.expected);
  } else if (assertion.kind === 'text') {
    actual = observed.text ?? null;
    const expected = assertion.expected.replace(/\s+/g, ' ').trim();
    passed =
      observed.visible === 1 &&
      typeof actual === 'string' &&
      (assertion.match === 'contains' ? actual.includes(expected) : !observed.truncated && actual === expected);
  }
  if (error || observed.redacted) passed = false;
  return {
    ...assertion,
    actual: typeof actual === 'string' ? actual.slice(0, 512) : actual,
    passed,
    missing: assertion.kind !== 'url' && observed.count === 0,
    summary: `${assertion.kind} ${'selector' in assertion ? assertion.selector : assertion.expected}: ${passed ? 'passed' : 'failed'}`,
    ...(error && { error }),
    ...((observed.truncated || (typeof actual === 'string' && actual.length > 512)) && { truncated: true }),
  };
}

export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('Stopped by the user in Yalqen.'));
    if (signal.aborted) {
      operation.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function readFlowDom(
  contents: WebContents,
  expression: string,
  signal: AbortSignal,
  ensure: () => void,
): Promise<unknown> {
  const send = async (method: string, params?: Record<string, unknown>) => {
    ensure();
    signal.throwIfAborted();
    const result = await abortable(contents.debugger.sendCommand(method, params), signal);
    ensure();
    signal.throwIfAborted();
    return result;
  };
  const { frameTree } = (await send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
  const { executionContextId } = (await send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: 'yalqen-flow',
  })) as { executionContextId: number };
  const response = (await send('Runtime.evaluate', {
    expression,
    contextId: executionContextId,
    returnByValue: true,
  })) as {
    result: { value?: unknown };
    exceptionDetails?: unknown;
  };
  if (response.exceptionDetails || response.result?.value === undefined) throw new Error('The page could not be read.');
  return response.result.value;
}

export async function executeFlow(plan: FlowPlan, driver: FlowDriver, outerSignal: AbortSignal): Promise<FlowResult> {
  const started = Date.now();
  const deadline = started + plan.timeout_ms;
  const controller = new AbortController();
  const stop = () =>
    controller.abort(
      outerSignal.reason instanceof Error ? outerSignal.reason : new Error('Stopped by the user in Yalqen.'),
    );
  outerSignal.addEventListener('abort', stop, { once: true });
  if (outerSignal.aborted) stop();
  const timer = setTimeout(() => controller.abort(new Error('The flow deadline expired.')), plan.timeout_ms);
  const signal = controller.signal;
  const output: FlowResult = {
    result: 'failed',
    name: plan.name,
    steps: [],
    assertions: [],
    errors: [],
    duration_ms: 0,
  };
  let activeStep: FlowResult['steps'][number] | null = null;
  const ensure = () => {
    signal.throwIfAborted();
    driver.ensure();
  };
  try {
    ensure();
    if (plan.start_url !== undefined && driver.url() !== plan.start_url)
      throw new Error('The tab URL changed before the flow started.');
    for (const step of plan.steps) {
      ensure();
      activeStep = {
        action: step.action,
        target: step.action === 'navigate' ? step.url : step.selector,
        passed: false,
      };
      output.steps.push(activeStep);
      await abortable(driver.perform(step, signal), signal);
      ensure();
      activeStep.passed = true;
      activeStep = null;
    }
    for (const assertion of plan.assertions) {
      const until = Math.min(deadline, Date.now() + plan.assertion_timeout_ms);
      let checked: FlowAssertionResult;
      for (;;) {
        ensure();
        try {
          checked = assertionResult(assertion, await abortable(driver.observe(assertion, signal), signal));
        } catch (error) {
          ensure();
          checked = {
            ...assertion,
            actual: null,
            passed: false,
            missing: false,
            summary: `${assertion.kind}: failed`,
            error: error instanceof Error ? error.message.slice(0, 512) : 'The page could not be read.',
          };
        }
        if (
          checked.passed ||
          Date.now() >= until ||
          checked.error === 'Invalid CSS selector.' ||
          checked.error?.startsWith('Password')
        )
          break;
        await abortable(
          new Promise<void>((resolve) => setTimeout(resolve, Math.min(POLL_MS, until - Date.now()))),
          signal,
        );
      }
      output.assertions.push(checked);
    }
    ensure();
    if (plan.check_runtime_errors)
      output.errors = driver
        .runtimeErrors()
        .slice(0, 20)
        .map((error) => error.slice(0, 512));
    output.result =
      output.assertions.length === plan.assertions.length &&
      output.assertions.every((assertion) => assertion.passed) &&
      output.errors.length === 0
        ? 'passed'
        : 'failed';
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 512) : 'The flow failed.';
    if (activeStep) activeStep.error = message;
    output.errors.push(message);
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener('abort', stop);
    for (const assertion of plan.assertions.slice(output.assertions.length))
      output.assertions.push({
        ...assertion,
        actual: null,
        passed: false,
        missing: false,
        summary: `${assertion.kind}: not checked`,
        error: 'The flow stopped before this assertion could be checked.',
      });
    output.duration_ms = Date.now() - started;
  }
  return output;
}
