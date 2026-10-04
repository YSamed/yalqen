import { randomBytes } from 'node:crypto';
import type { ConsoleEntry, NetworkRecord, StackFrame } from './cdp-events.js';
import { RingBuffer } from './ring-buffer.js';
import { spanSummary, type BackendSpan } from './tracing.js';

const EVENT_LIMIT = 1000;
const EPISODE_LIMIT = 20;
export const EPISODE_LOOKBACK_MS = 10_000;
// Errors that follow each other this closely belong to the same episode.
const EPISODE_GAP_MS = 3000;
const LIKELY_CAUSE_MS = 1000;
const EPISODE_EVENT_LIMIT = 60;
const SUMMARY_LENGTH = 160;
// Assets only matter when they fail; requests the app's code makes always do.
const TRACKED_TYPES = new Set(['Document', 'Fetch', 'XHR', 'EventSource', 'WebSocket', 'Other']);

type ActionKind = 'click' | 'submit' | 'input' | 'key';
type TimelineKind = 'navigation' | ActionKind | 'request' | 'response' | 'backend' | 'console' | 'exception';
type CauseConfidence = 'direct' | 'likely';

interface ActionTarget {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  role?: string;
  text?: string;
  selector?: string;
}

export interface PageAction {
  phase: 'start' | 'end';
  kind: ActionKind;
  time: number;
  target: ActionTarget;
  valueLength?: number;
  key?: string;
}

interface RecordedAction {
  kind: ActionKind;
  selector?: string;
  key?: string;
}

export interface TimelineEvent {
  id: string;
  time: number;
  kind: TimelineKind;
  summary: string;
  // Kept for actions so an episode can be replayed; typed values are never part of it.
  action?: RecordedAction;
  // Method and short URL of a request, and the status it got (0 when it failed without one).
  target?: string;
  status?: number;
  requestId?: string;
  causeId?: string;
  causeConfidence?: CauseConfidence;
}

export interface ErrorEpisode {
  id: string;
  start: number;
  end: number;
  summary: string;
  events: TimelineEvent[];
}

const PREVIEW_LINES = 8;

function clockTime(time: number): string {
  return new Date(time).toTimeString().slice(0, 8);
}

export function episodePreview(episode: ErrorEpisode | null): { id: string; lines: string[] } | null {
  if (!episode) return null;
  const lines = episode.events.slice(-PREVIEW_LINES).map((event) => `${clockTime(event.time)}  ${event.summary}`);
  return { id: episode.id, lines };
}

function newEpisodeId(): string {
  return `yk_ep_${randomBytes(3).toString('hex').slice(0, 5)}`;
}

function clip(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > SUMMARY_LENGTH ? `${line.slice(0, SUMMARY_LENGTH - 1)}…` : line;
}

function describeTarget(target: ActionTarget): string {
  const id = target.id ? `#${target.id}` : '';
  const name = !id && target.name ? `[name=${target.name}]` : '';
  const text = target.text ? ` "${clip(target.text).slice(0, 40)}"` : '';
  return `${target.tag}${id}${name}${text}`;
}

export function actionSummary(action: PageAction): string {
  const target = describeTarget(action.target);
  switch (action.kind) {
    case 'click':
      return `Clicked ${target}`;
    case 'submit':
      return `Submitted ${target}`;
    case 'input':
      return `Changed ${target}${action.valueLength !== undefined ? ` (${action.valueLength} characters)` : ''}`;
    case 'key':
      return `Pressed ${action.key ?? 'a key'} in ${target}`;
  }
}

export function shortUrl(url: string, pageUrl: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(pageUrl).origin ? `${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url;
  }
}

function frameKey(frame: StackFrame): string | null {
  if (!frame.url || frame.functionName === '(anonymous)' || /node_modules|\/_next\/static\/chunks\//.test(frame.url)) {
    return null;
  }
  return `${frame.url}#${frame.functionName}`;
}

// An exception thrown by the same function that made the request most likely came from its result.
export function sharesUserFrame(a: readonly StackFrame[] = [], b: readonly StackFrame[] = []): boolean {
  const keys = new Set(a.map(frameKey).filter((key) => key !== null));
  return b.some((frame) => {
    const key = frameKey(frame);
    return key !== null && keys.has(key);
  });
}

interface OpenAction {
  eventId: string;
  kind: ActionKind;
  time: number;
}

// A handler that stops propagation never lets the end of its event through, so an open action
// only counts for as long as a synchronous handler could plausibly run.
const OPEN_ACTION_MS = 250;

interface OpenEpisode {
  episode: ErrorEpisode;
  lastTrigger: number;
}

export class Timeline {
  readonly events = new RingBuffer<TimelineEvent>(EVENT_LIMIT);
  readonly episodes = new RingBuffer<ErrorEpisode>(EPISODE_LIMIT);
  private counter = 0;
  private openAction: OpenAction | null = null;
  private lastAction: TimelineEvent | null = null;
  private readonly requestEvents = new Map<string, TimelineEvent>();
  private readonly requestStacks = new Map<string, StackFrame[]>();
  private openEpisode: OpenEpisode | null = null;

  constructor(private readonly pageUrl: () => string) {}

  get latestEpisode(): ErrorEpisode | null {
    return this.episodes.values().at(-1) ?? null;
  }

  navigation(url: string, time = Date.now()): void {
    this.openAction = null;
    this.push({ time, kind: 'navigation', summary: `Navigated to ${shortUrl(url, url)}` });
  }

  action(action: PageAction): void {
    if (action.phase === 'end') {
      if (this.openAction?.kind === action.kind) this.openAction = null;
      return;
    }
    const event = this.push({
      time: action.time,
      kind: action.kind,
      summary: actionSummary(action),
      action: { kind: action.kind, selector: action.target.selector, key: action.key },
    });
    this.openAction = { eventId: event.id, kind: action.kind, time: action.time };
    this.lastAction = event;
  }

  request(record: NetworkRecord): void {
    if (!TRACKED_TYPES.has(record.resourceType ?? 'Other')) return;
    const cause = this.actionCause(record.startTime);
    const target = `${record.method} ${shortUrl(record.url, this.pageUrl())}`;
    const event = this.push({
      time: record.startTime,
      kind: 'request',
      summary: target,
      requestId: record.id,
      target,
      ...cause,
    });
    this.requestEvents.set(record.id, event);
    if (record.initiator.stack) this.requestStacks.set(record.id, record.initiator.stack);
    this.trimRequestIndex();
  }

  response(record: NetworkRecord, time = Date.now()): void {
    if (record.failure === 'canceled') return;
    const failed = record.failure !== undefined && record.failure !== 'canceled';
    const status = record.status ?? 0;
    const request = this.requestEvents.get(record.id);
    if (!request && !failed && status < 400) return;
    const target = `${record.method} ${shortUrl(record.url, this.pageUrl())}`;
    const summary = failed ? `Failed ${target} (${record.failure})` : `${status} ${record.statusText ?? ''} ${target}`;
    const event = this.push({
      time,
      kind: 'response',
      summary: clip(summary.replace(/\s+/g, ' ')),
      requestId: record.id,
      target,
      status: failed ? 0 : status,
      ...(request && { causeId: request.id, causeConfidence: 'direct' as const }),
    });
    if (failed || status >= 400) this.trigger(event);
  }

  // Backend spans arrive after the response, often after its episode has closed, so they are also
  // added to any episode that already holds their request.
  backend(span: BackendSpan, requestId: string): void {
    const request = this.requestEvents.get(requestId);
    const event = this.push({
      time: span.start,
      kind: 'backend',
      summary: spanSummary(span),
      requestId,
      ...(request && { causeId: request.id, causeConfidence: 'direct' as const }),
    });
    for (const episode of this.episodes.values()) {
      const related = episode.events.some((item) => item.requestId === requestId);
      if (related && !episode.events.includes(event) && episode.events.length < EPISODE_EVENT_LIMIT) {
        episode.events.push(event);
      }
    }
  }

  console(entry: ConsoleEntry): void {
    if (entry.level !== 'error') return;
    const kind = entry.source === 'exception' ? 'exception' : 'console';
    const event = this.push({
      time: entry.time,
      kind,
      summary: clip(kind === 'console' ? `console.error: ${entry.text}` : entry.text),
      ...this.errorCause(entry),
    });
    if (kind === 'exception') this.trigger(event);
  }

  // What the agent does next is its own story, not part of the error the user ran into.
  closeEpisode(): void {
    this.openEpisode = null;
  }

  clear(): void {
    this.events.clear();
    this.episodes.clear();
    this.requestEvents.clear();
    this.requestStacks.clear();
    this.openAction = null;
    this.lastAction = null;
    this.openEpisode = null;
  }

  private isOpen(time: number): boolean {
    return this.openAction !== null && time - this.openAction.time <= OPEN_ACTION_MS;
  }

  private actionCause(time: number): Pick<TimelineEvent, 'causeId' | 'causeConfidence'> {
    if (this.openAction && this.isOpen(time)) return { causeId: this.openAction.eventId, causeConfidence: 'direct' };
    if (this.lastAction && time - this.lastAction.time <= LIKELY_CAUSE_MS) {
      return { causeId: this.lastAction.id, causeConfidence: 'likely' };
    }
    return {};
  }

  private errorCause(entry: ConsoleEntry): Pick<TimelineEvent, 'causeId' | 'causeConfidence'> {
    if (this.openAction && this.isOpen(entry.time)) {
      return { causeId: this.openAction.eventId, causeConfidence: 'direct' };
    }
    const recent = this.events.values().filter((event) => event.time >= entry.time - EPISODE_LOOKBACK_MS);
    for (const event of [...recent].reverse()) {
      if (event.kind !== 'response' || !event.requestId) continue;
      if (sharesUserFrame(this.requestStacks.get(event.requestId), entry.stack)) {
        return { causeId: event.id, causeConfidence: 'direct' };
      }
    }
    const failed = [...recent]
      .reverse()
      .find((event) => event.kind === 'response' && entry.time - event.time <= LIKELY_CAUSE_MS);
    return failed ? { causeId: failed.id, causeConfidence: 'likely' } : {};
  }

  private push(fields: Omit<TimelineEvent, 'id'>): TimelineEvent {
    const event: TimelineEvent = { id: `e${++this.counter}`, ...fields };
    this.events.push(event);
    const open = this.openEpisode;
    if (open && event.time - open.lastTrigger <= EPISODE_GAP_MS && open.episode.events.length < EPISODE_EVENT_LIMIT) {
      open.episode.events.push(event);
      open.episode.end = Math.max(open.episode.end, event.time);
    }
    return event;
  }

  private trigger(event: TimelineEvent): void {
    const open = this.openEpisode;
    if (open && event.time - open.lastTrigger <= EPISODE_GAP_MS) {
      open.lastTrigger = event.time;
      return;
    }
    const events = this.events
      .values()
      .filter((item) => item.time >= event.time - EPISODE_LOOKBACK_MS)
      .slice(-EPISODE_EVENT_LIMIT);
    const episode: ErrorEpisode = {
      id: newEpisodeId(),
      start: events[0]?.time ?? event.time,
      end: event.time,
      summary: event.summary,
      events,
    };
    this.episodes.push(episode);
    this.openEpisode = { episode, lastTrigger: event.time };
  }

  private trimRequestIndex(): void {
    while (this.requestEvents.size > EVENT_LIMIT) {
      const oldest = this.requestEvents.keys().next().value as string;
      this.requestEvents.delete(oldest);
      this.requestStacks.delete(oldest);
    }
  }
}
