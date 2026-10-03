import type { WebContents } from 'electron';
import { truncateBytes } from '../agent-bridge/redact.js';
import {
  OUTER_HTML_LIMIT,
  attributeMap,
  boxFromQuad,
  elementLabel,
  layoutStyles,
  newSelectionId,
  shortText,
  type Box,
  type ElementSelection,
} from '../agent-bridge/selection.js';

const MAX_SHOT_SIDE = 2000;
const HIGHLIGHT = {
  showInfo: true,
  showStyles: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
};

// Runs on the picked node in the page; reads only what DevTools would show for it.
const DESCRIBE_NODE = `function () {
  const short = (value) => (value || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  const classes = (el) => [...el.classList].slice(0, 2).map((name) => '.' + CSS.escape(name)).join('');
  const step = (el) => {
    if (el.id) return el.localName + '#' + CSS.escape(el.id);
    const siblings = el.parentElement ? [...el.parentElement.children].filter((child) => child.localName === el.localName) : [];
    return el.localName + classes(el) + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')' : '');
  };
  const path = [];
  for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
    path.unshift(step(el));
    if (el.id) break;
  }
  const ancestors = [];
  for (let el = this.parentElement; el && ancestors.length < 12; el = el.parentElement) {
    ancestors.push(el.localName + (el.id ? '#' + el.id : '') + classes(el));
  }
  return { text: short(this.innerText || this.textContent), selector: path.join(' > '), ancestors };
}`;

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface PickSession {
  result: Promise<number | null>;
  cancel(): void;
}

export function startPicking(contents: WebContents): PickSession {
  const dbg = contents.debugger;
  let settle: (value: number | null) => void = () => {};
  const result = new Promise<number | null>((resolve) => (settle = resolve));
  let done = false;
  const finish = (backendNodeId: number | null) => {
    if (done) return;
    done = true;
    dbg.off('message', onMessage);
    contents.off('before-input-event', onInput);
    contents.off('did-start-navigation', onNavigation);
    contents.off('destroyed', onDestroyed);
    if (!contents.isDestroyed() && dbg.isAttached()) {
      dbg.sendCommand('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} }).catch(() => undefined);
    }
    settle(backendNodeId);
  };
  const onMessage = (_event: Electron.Event, method: string, params: { backendNodeId?: number }) => {
    if (method === 'Overlay.inspectNodeRequested') finish(params.backendNodeId ?? null);
  };
  const onInput = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    event.preventDefault();
    finish(null);
  };
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) finish(null);
  };
  const onDestroyed = () => finish(null);
  dbg.on('message', onMessage);
  contents.on('before-input-event', onInput);
  contents.on('did-start-navigation', onNavigation);
  contents.once('destroyed', onDestroyed);
  void (async () => {
    await dbg.sendCommand('DOM.enable');
    await dbg.sendCommand('Overlay.enable');
    await dbg.sendCommand('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: HIGHLIGHT });
  })().catch((error: unknown) => {
    console.warn(`[picker] could not start: ${(error as Error).message}`);
    finish(null);
  });
  return { result, cancel: () => finish(null) };
}

async function computedStyles(send: Send, backendNodeId: number): Promise<Record<string, string>> {
  await send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = (await send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] })) as {
    nodeIds: number[];
  };
  await send('CSS.enable');
  const { computedStyle } = (await send('CSS.getComputedStyleForNode', { nodeId: nodeIds[0] })) as {
    computedStyle: { name: string; value: string }[];
  };
  return layoutStyles(computedStyle);
}

async function accessibleName(
  send: Send,
  backendNodeId: number,
): Promise<{ role: string | null; name: string | null }> {
  const { nodes } = (await send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false })) as {
    nodes: { role?: { value?: string }; name?: { value?: string } }[];
  };
  const node = nodes.at(-1);
  return { role: node?.role?.value ?? null, name: node?.name?.value || null };
}

async function describeInPage(send: Send, backendNodeId: number) {
  const { object } = (await send('DOM.resolveNode', { backendNodeId })) as { object: { objectId: string } };
  try {
    const { result } = (await send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: DESCRIBE_NODE,
      returnByValue: true,
    })) as { result: { value?: { text: string; selector: string; ancestors: string[] } } };
    return result.value ?? { text: '', selector: '', ancestors: [] };
  } finally {
    await send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined);
  }
}

async function elementShot(send: Send, box: Box | null): Promise<string | null> {
  if (!box || box.width < 1 || box.height < 1) return null;
  const { cssVisualViewport } = (await send('Page.getLayoutMetrics')) as {
    cssVisualViewport: { pageX: number; pageY: number };
  };
  const { data } = (await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: box.x + cssVisualViewport.pageX,
      y: box.y + cssVisualViewport.pageY,
      width: Math.min(box.width, MAX_SHOT_SIDE),
      height: Math.min(box.height, MAX_SHOT_SIDE),
      scale: 1,
    },
  })) as { data: string };
  return data;
}

const optional = <T>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);

export async function captureSelection(
  contents: WebContents,
  backendNodeId: number,
  tab: { id: string; url: string },
): Promise<ElementSelection> {
  const send: Send = (method, params) => contents.debugger.sendCommand(method, params);
  try {
    const { node } = (await send('DOM.describeNode', { backendNodeId })) as {
      node: { localName: string; nodeName: string; attributes?: string[] };
    };
    const { outerHTML } = (await send('DOM.getOuterHTML', { backendNodeId })) as { outerHTML: string };
    const { model } = (await optional(send('DOM.getBoxModel', { backendNodeId }), { model: null })) as {
      model: { border: number[] } | null;
    };
    const box = boxFromQuad(model?.border);
    const [page, styles, accessibility, screenshot] = await Promise.all([
      optional(describeInPage(send, backendNodeId), { text: '', selector: '', ancestors: [] }),
      optional(computedStyles(send, backendNodeId), {}),
      optional(accessibleName(send, backendNodeId), { role: null, name: null }),
      optional(elementShot(send, box), null),
    ]);
    const tag = node.localName || node.nodeName.toLowerCase();
    const attributes = attributeMap(node.attributes);
    return {
      id: newSelectionId(),
      tabId: tab.id,
      url: tab.url,
      time: Date.now(),
      label: elementLabel(tag, attributes, page.text),
      tag,
      attributes,
      text: shortText(page.text, 200),
      role: accessibility.role,
      name: accessibility.name,
      selector: page.selector,
      ancestors: page.ancestors,
      html: truncateBytes(outerHTML, OUTER_HTML_LIMIT),
      styles,
      box,
      screenshot,
    };
  } finally {
    for (const method of ['CSS.disable', 'Overlay.disable', 'DOM.disable']) {
      await send(method).catch(() => undefined);
    }
  }
}
