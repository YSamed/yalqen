import fs from 'node:fs';
import type { WebContents } from 'electron';
import { componentInfo, needsInlineMap, NO_COMPONENT, type ComponentInfo } from '../agent-bridge/component-source.js';
import type { ComponentInspection, InspectedSource } from '../../shared/component-inspection.js';
import { pageScriptPath } from '../app/paths.js';
import { inlineSourceMap, originalPosition, type RawSourceMap } from '../agent-bridge/source-map.js';
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
// Resolving a React 19 location fetches the dev server's source map, which can be slow on big apps.
const INSPECT_TIMEOUT_MS = 4000;
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

const HIGHLIGHT_MS = 1600;
const highlightTimers = new WeakMap<WebContents, NodeJS.Timeout>();

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

export async function highlightSelector(contents: WebContents, selector: string): Promise<boolean> {
  if (!selector || contents.isDestroyed() || !contents.debugger.isAttached()) return false;
  const send: Send = (method, params) => contents.debugger.sendCommand(method, params);
  const hide = () => {
    highlightTimers.delete(contents);
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    void (async () => {
      for (const method of ['Overlay.hideHighlight', 'Overlay.disable', 'DOM.disable']) {
        await send(method).catch(() => undefined);
      }
    })();
  };
  try {
    await send('DOM.enable');
    const { root } = (await send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
    const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number };
    if (!nodeId) return false;
    await send('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => undefined);
    await send('Overlay.enable');
    await send('Overlay.highlightNode', { nodeId, highlightConfig: HIGHLIGHT });
    clearTimeout(highlightTimers.get(contents));
    highlightTimers.set(contents, setTimeout(hide, HIGHLIGHT_MS));
    return true;
  } catch {
    return false;
  }
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

let componentInspector: string | null = null;

function componentInspectorFunction(): string {
  componentInspector ??= `async function () {\n${fs.readFileSync(pageScriptPath('component-inspector'), 'utf8')}\nreturn YalqenComponentInspector.inspect(this);\n}`;
  return componentInspector;
}

async function inlineSourceMaps(contents: WebContents, urls: Set<string>): Promise<Map<string, RawSourceMap>> {
  const maps = new Map<string, RawSourceMap>();
  if (urls.size === 0) return maps;
  const onMessage = (_event: Electron.Event, method: string, params: { url?: string; sourceMapURL?: string }) => {
    if (method !== 'Debugger.scriptParsed' || !params.url || !params.sourceMapURL || !urls.has(params.url)) return;
    const map = inlineSourceMap(params.sourceMapURL);
    if (map) maps.set(params.url, map);
  };
  contents.debugger.on('message', onMessage);
  try {
    // Enabling the debugger reports every script already loaded, with its source map URL.
    await contents.debugger.sendCommand('Debugger.enable');
  } finally {
    contents.debugger.off('message', onMessage);
    await contents.debugger.sendCommand('Debugger.disable').catch(() => undefined);
  }
  return maps;
}

async function withInlineMaps(contents: WebContents, inspection: ComponentInspection): Promise<ComponentInspection> {
  const pending = [inspection.source, inspection.componentSource].filter(needsInlineMap);
  if (pending.length === 0) return inspection;
  const maps = await inlineSourceMaps(contents, new Set(pending.map((source) => source.raw.file)));
  const resolve = (source: InspectedSource | null): InspectedSource | null => {
    if (!needsInlineMap(source) || !source.raw.line || !source.raw.column) return source;
    const map = maps.get(source.raw.file);
    const position = map && originalPosition(map, source.raw.line, source.raw.column);
    return position
      ? { ...source, file: position.source, line: position.line, column: position.column, raw: null }
      : source;
  };
  return { ...inspection, source: resolve(inspection.source), componentSource: resolve(inspection.componentSource) };
}

async function inspectComponent(contents: WebContents, send: Send, backendNodeId: number): Promise<ComponentInfo> {
  const { object } = (await send('DOM.resolveNode', { backendNodeId })) as { object: { objectId: string } };
  let timer: NodeJS.Timeout | undefined;
  try {
    const inspected = (
      send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: componentInspectorFunction(),
        returnByValue: true,
        awaitPromise: true,
      }) as Promise<{ result: { value?: ComponentInspection } }>
    ).then(({ result }) => (result.value ? withInlineMaps(contents, result.value) : null));
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), INSPECT_TIMEOUT_MS)));
    return componentInfo(await Promise.race([inspected, timeout]));
  } finally {
    clearTimeout(timer);
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
    const [page, styles, accessibility, screenshot, component] = await Promise.all([
      optional(describeInPage(send, backendNodeId), { text: '', selector: '', ancestors: [] }),
      optional(computedStyles(send, backendNodeId), {}),
      optional(accessibleName(send, backendNodeId), { role: null, name: null }),
      optional(elementShot(send, box), null),
      optional(inspectComponent(contents, send, backendNodeId), NO_COMPONENT),
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
      component,
    };
  } finally {
    for (const method of ['CSS.disable', 'Overlay.disable', 'DOM.disable']) {
      await send(method).catch(() => undefined);
    }
  }
}
