import type { Headers } from './redact.js';

type ConsoleLevel = 'error' | 'warning' | 'info' | 'log' | 'debug';
type ConsoleSource = 'console' | 'exception' | 'browser';

export interface StackFrame {
  functionName: string;
  url: string;
  line: number;
  column: number;
}

export interface ConsoleEntry {
  time: number;
  level: ConsoleLevel;
  source: ConsoleSource;
  text: string;
  url?: string;
  line?: number;
  column?: number;
  stack?: StackFrame[];
}

interface Initiator {
  type: string;
  url?: string;
  line?: number;
  stack?: StackFrame[];
}

export interface NetworkRecord {
  id: string;
  method: string;
  url: string;
  resourceType?: string;
  startTime: number;
  // CDP's monotonic clock in seconds; only differences between two of its values mean anything.
  monotonicStart: number;
  durationMs?: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  failure?: string;
  finished: boolean;
  initiator: Initiator;
  requestHeaders: Headers;
  responseHeaders?: Headers;
  postData?: string;
}

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
}

interface CallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface StackTrace {
  callFrames?: CallFrame[];
}

const MAX_TEXT_LENGTH = 2000;
const MAX_STACK_FRAMES = 20;
const CONSOLE_LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  assert: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
  verbose: 'debug',
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clip(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}…` : value;
}

// CDP line and column numbers start at 0; editors and agents expect them to start at 1.
function oneBased(value: unknown): number | undefined {
  const n = number(value);
  return n === undefined ? undefined : n + 1;
}

function stackFrames(trace: unknown): StackFrame[] | undefined {
  const frames = record(trace as StackTrace).callFrames;
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  return frames.slice(0, MAX_STACK_FRAMES).map((frame: CallFrame) => ({
    functionName: text(frame.functionName) || '(anonymous)',
    url: text(frame.url) ?? '',
    line: oneBased(frame.lineNumber) ?? 0,
    column: oneBased(frame.columnNumber) ?? 0,
  }));
}

export function describeRemoteObject(value: unknown): string {
  const object = record(value) as RemoteObject;
  if (object.unserializableValue !== undefined) return object.unserializableValue;
  if (object.type === 'string') return String(object.value);
  if (object.type === 'undefined') return 'undefined';
  if (object.subtype === 'null') return 'null';
  if (object.value !== undefined && object.type !== 'object') return String(object.value);
  return object.description ?? object.type ?? '';
}

// Applies console format specifiers the way DevTools shows them; %c only carries CSS, so it prints nothing.
export function formatConsoleArgs(args: readonly unknown[]): string {
  const parts = args.map(describeRemoteObject);
  if (record(args[0]).type !== 'string' || parts.length < 2) return parts.join(' ');
  let next = 1;
  const formatted = parts[0].replace(/%[sdifoOc%]/g, (spec) => {
    if (spec === '%%') return '%';
    if (next >= parts.length) return spec;
    const value = parts[next++];
    return spec === '%c' ? '' : value;
  });
  return [formatted, ...parts.slice(next)].join(' ');
}

function withTopFrame(entry: ConsoleEntry): ConsoleEntry {
  const top = entry.stack?.find((frame) => frame.url);
  const located = !top || entry.url ? entry : { ...entry, url: top.url, line: top.line, column: top.column };
  return Object.fromEntries(Object.entries(located).filter(([, value]) => value !== undefined)) as ConsoleEntry;
}

export function consoleEntry(method: string, params: unknown): ConsoleEntry | null {
  const data = record(params);
  if (method === 'Runtime.consoleAPICalled') {
    const level = CONSOLE_LEVELS[text(data.type) ?? ''] ?? 'log';
    const args = Array.isArray(data.args) ? data.args : [];
    return withTopFrame({
      time: number(data.timestamp) ?? Date.now(),
      level,
      source: 'console',
      text: clip(formatConsoleArgs(args)),
      stack: stackFrames(data.stackTrace),
    });
  }
  if (method === 'Runtime.exceptionThrown') {
    const details = record(data.exceptionDetails);
    const description = text(record(details.exception).description);
    return withTopFrame({
      time: number(data.timestamp) ?? Date.now(),
      level: 'error',
      source: 'exception',
      text: clip(description ?? text(details.text) ?? 'Uncaught exception'),
      url: text(details.url) || undefined,
      line: details.url ? oneBased(details.lineNumber) : undefined,
      column: details.url ? oneBased(details.columnNumber) : undefined,
      stack: stackFrames(details.stackTrace),
    });
  }
  if (method === 'Log.entryAdded') {
    const entry = record(data.entry);
    return withTopFrame({
      time: number(entry.timestamp) ?? Date.now(),
      level: CONSOLE_LEVELS[text(entry.level) ?? ''] ?? 'info',
      source: 'browser',
      text: clip(text(entry.text) ?? ''),
      url: text(entry.url) || undefined,
      line: entry.url ? oneBased(entry.lineNumber) : undefined,
      stack: stackFrames(entry.stackTrace),
    });
  }
  return null;
}

function headers(value: unknown): Headers {
  const result: Headers = {};
  for (const [name, header] of Object.entries(record(value))) result[name] = String(header);
  return result;
}

function initiator(value: unknown): Initiator {
  const data = record(value);
  return {
    type: text(data.type) ?? 'other',
    url: text(data.url) || undefined,
    line: data.url ? oneBased(data.lineNumber) : undefined,
    stack: stackFrames(data.stack),
  };
}

function elapsedMs(record: NetworkRecord, timestamp: unknown): number | undefined {
  const end = number(timestamp);
  return end === undefined ? record.durationMs : Math.max(0, Math.round((end - record.monotonicStart) * 1000));
}

export function networkUpdate(method: string, params: unknown, existing?: NetworkRecord): NetworkRecord | null {
  const data = record(params);
  const id = text(data.requestId);
  if (!id) return null;
  if (method === 'Network.requestWillBeSent') {
    const request = record(data.request);
    const wallTime = number(data.wallTime);
    return {
      id,
      method: text(request.method) ?? 'GET',
      url: text(request.url) ?? '',
      resourceType: text(data.type),
      startTime: wallTime === undefined ? Date.now() : Math.round(wallTime * 1000),
      monotonicStart: number(data.timestamp) ?? 0,
      finished: false,
      initiator: initiator(data.initiator),
      requestHeaders: headers(request.headers),
      postData: text(request.postData),
    };
  }
  if (!existing) return null;
  if (method === 'Network.responseReceived') {
    const response = record(data.response);
    return {
      ...existing,
      resourceType: text(data.type) ?? existing.resourceType,
      status: number(response.status),
      statusText: text(response.statusText),
      mimeType: text(response.mimeType),
      responseHeaders: headers(response.headers),
    };
  }
  if (method === 'Network.loadingFinished') {
    return { ...existing, finished: true, durationMs: elapsedMs(existing, data.timestamp) };
  }
  if (method === 'Network.loadingFailed') {
    const reason = data.canceled ? 'canceled' : (text(data.blockedReason) ?? text(data.errorText) ?? 'failed');
    return { ...existing, finished: true, failure: reason, durationMs: elapsedMs(existing, data.timestamp) };
  }
  return null;
}

export function isFailedRequest(request: NetworkRecord): boolean {
  return request.failure !== undefined || (request.status ?? 0) >= 400;
}
