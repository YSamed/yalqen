import { consoleEntry, networkUpdate, type ConsoleEntry, type NetworkRecord } from './cdp-events.js';
import type { RequestRule } from '../../shared/types.js';
import { CappedMap, RingBuffer } from './ring-buffer.js';
import { SELECTION_LIMIT, type ElementSelection } from './selection.js';
import { Timeline, type PageAction } from './timeline.js';
import { isNotable, type BackendSpan } from './tracing.js';

export { CappedMap, RingBuffer };

export const CONSOLE_LIMIT = 200;
export const NETWORK_LIMIT = 300;

export const ACTION_BINDING = '__yalqenAgentAction';
const TRACE_LIMIT = 100;
const SPANS_PER_TRACE = 100;

export class TabRuntime {
  readonly console = new RingBuffer<ConsoleEntry>(CONSOLE_LIMIT);
  readonly network = new CappedMap<string, NetworkRecord>(NETWORK_LIMIT);
  readonly selections = new RingBuffer<ElementSelection>(SELECTION_LIMIT);
  readonly timeline: Timeline;
  // The identifier of the action listener script, needed to remove it again.
  actionScriptId: string | null = null;
  webMcpScriptId: string | null = null;
  // Temporary request rules the agent set for this tab; they go away with the observation.
  rules: RequestRule[] = [];
  // Trace ids Yalqen put on requests, and the backend spans that came back for them.
  readonly traces = new CappedMap<string, string>(NETWORK_LIMIT);
  readonly spans = new CappedMap<string, BackendSpan[]>(TRACE_LIMIT);

  constructor(pageUrl: () => string = () => '') {
    this.timeline = new Timeline(pageUrl);
  }

  handle(method: string, params: unknown): void {
    const entry = consoleEntry(method, params);
    if (entry) {
      this.console.push(entry);
      this.timeline.console(entry);
      return;
    }
    if (method === 'Runtime.bindingCalled') {
      this.handleBinding(params);
      return;
    }
    if (!method.startsWith('Network.')) return;
    const id = (params as { requestId?: unknown } | null)?.requestId;
    const existing = typeof id === 'string' ? this.network.get(id) : undefined;
    const updated = networkUpdate(method, params, existing);
    if (!updated) return;
    this.network.set(updated.id, updated);
    if (method === 'Network.requestWillBeSent' && !existing) this.timeline.request(updated);
    else if (method === 'Network.responseReceived' || method === 'Network.loadingFailed')
      this.timeline.response(updated);
  }

  traceRequest(traceId: string, requestId: string): void {
    this.traces.set(traceId, requestId);
  }

  addSpans(spans: readonly BackendSpan[]): number {
    let matched = 0;
    for (const span of spans) {
      const requestId = this.traces.get(span.traceId);
      if (!requestId) continue;
      matched++;
      const list = this.spans.get(span.traceId) ?? [];
      if (list.length < SPANS_PER_TRACE) list.push(span);
      this.spans.set(span.traceId, list);
      if (isNotable(span)) this.timeline.backend(span, requestId);
    }
    return matched;
  }

  spansForRequest(requestId: string): BackendSpan[] {
    for (const [traceId, id] of this.traces.pairs()) {
      if (id === requestId) return this.spans.get(traceId) ?? [];
    }
    return [];
  }

  private handleBinding(params: unknown): void {
    const { name, payload } = (params ?? {}) as { name?: unknown; payload?: unknown };
    if (name !== ACTION_BINDING || typeof payload !== 'string') return;
    const action = parsePageAction(payload);
    if (action) this.timeline.action(action);
  }

  clear(): void {
    this.console.clear();
    this.network.clear();
    this.selections.clear();
    this.timeline.clear();
  }
}

const ACTION_KINDS = new Set(['click', 'submit', 'input', 'key']);

// The payload comes from a script in the page's isolated world, but the page can still shape the
// event it reports, so every field is checked.
export function parsePageAction(payload: string): PageAction | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
  const target = (typeof data.target === 'object' && data.target !== null ? data.target : {}) as Record<
    string,
    unknown
  >;
  const text = (value: unknown) => (typeof value === 'string' && value ? value.slice(0, 200) : undefined);
  if ((data.phase !== 'start' && data.phase !== 'end') || !ACTION_KINDS.has(data.kind as string)) return null;
  return {
    phase: data.phase,
    kind: data.kind as PageAction['kind'],
    time: typeof data.time === 'number' && Number.isFinite(data.time) ? data.time : Date.now(),
    target: {
      tag: text(target.tag) ?? 'element',
      id: text(target.id),
      name: text(target.name),
      type: text(target.type),
      role: text(target.role),
      text: text(target.text),
      selector: typeof target.selector === 'string' && target.selector ? target.selector.slice(0, 500) : undefined,
    },
    valueLength: typeof data.valueLength === 'number' ? data.valueLength : undefined,
    key: text(data.key),
  };
}
