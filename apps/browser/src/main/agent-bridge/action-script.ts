import { ACTION_BINDING } from './runtime-buffer.js';

export const ACTION_WORLD = 'yalqen-agent';

// Runs in an isolated world of local development pages: it sees the page's DOM events but not its
// scripts, and the page cannot see it. Values typed into fields are never sent, only their length.
export const ACTION_SCRIPT = `(() => {
  if (globalThis.__yalqenActionsInstalled) return;
  globalThis.__yalqenActionsInstalled = true;
  const report = (phase, kind, element, extra) => {
    try {
      globalThis.${ACTION_BINDING}(JSON.stringify({ phase, kind, time: Date.now(), target: describe(element), ...extra }));
    } catch {}
  };
  const short = (value) => (value || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const isSecret = (element) => element instanceof HTMLInputElement && element.type === 'password';
  const step = (element) => {
    if (element.id) return element.localName + '#' + CSS.escape(element.id);
    const parent = element.parentElement;
    const same = parent ? [...parent.children].filter((child) => child.localName === element.localName) : [];
    return element.localName + (same.length > 1 ? ':nth-of-type(' + (same.indexOf(element) + 1) + ')' : '');
  };
  const selectorOf = (element) => {
    const name = element.getAttribute('name');
    if (!element.id && name && document.querySelectorAll(element.localName + '[name="' + CSS.escape(name) + '"]').length === 1) {
      return element.localName + '[name="' + CSS.escape(name) + '"]';
    }
    const path = [];
    for (let node = element; node && node.nodeType === 1 && path.length < 12; node = node.parentElement) {
      path.unshift(step(node));
      if (node.id) break;
    }
    return path.join(' > ');
  };
  const describe = (element) => {
    if (!(element instanceof Element)) return { tag: 'document' };
    const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    const label = element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('title') ||
      (field && element.labels && element.labels[0] ? element.labels[0].innerText : '');
    return {
      tag: element.localName,
      id: element.id || undefined,
      name: element.getAttribute('name') || undefined,
      type: element.getAttribute('type') || undefined,
      role: element.getAttribute('role') || undefined,
      text: short(label || (field ? '' : element.innerText)),
      selector: selectorOf(element),
    };
  };
  const clickable = (target) =>
    target instanceof Element
      ? target.closest('button, a, [role=button], [role=link], [role=tab], [role=menuitem], input, select, label, summary') || target
      : target;
  const listen = (type, kind, pick, extra = () => ({})) => {
    addEventListener(type, (event) => {
      const element = pick(event);
      if (element) report('start', kind, element, extra(event, element));
    }, true);
    addEventListener(type, (event) => {
      if (pick(event)) report('end', kind, null, {});
    }, false);
  };
  listen('click', 'click', (event) => event.isTrusted && clickable(event.target));
  listen('submit', 'submit', (event) => event.target);
  listen('change', 'input', (event) => !isSecret(event.target) && event.target, (event, element) =>
    'value' in element && typeof element.value === 'string' ? { valueLength: element.value.length } : {});
  listen('keydown', 'key', (event) => event.key === 'Enter' && !event.isComposing && !isSecret(event.target) && event.target,
    () => ({ key: 'Enter' }));
})();`;
