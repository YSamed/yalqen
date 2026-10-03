import { randomBytes } from 'node:crypto';

export const TRACES_PATH = '/v1/traces';
const MAX_SPANS = 2000;
const MAX_TEXT = 500;
const SPAN_KIND_SERVER = 2;
const STATUS_ERROR = 2;

export interface Traceparent {
  traceId: string;
  header: string;
}

export interface BackendSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  service: string | null;
  name: string;
  server: boolean;
  start: number;
  durationMs: number;
  error: string | null;
  attributes: Record<string, string | number | boolean>;
}

// W3C Trace Context: version, trace id, parent span id, flags (sampled).
export function newTraceparent(): Traceparent {
  const traceId = randomBytes(16).toString('hex');
  return { traceId, header: `00-${traceId}-${randomBytes(8).toString('hex')}-01` };
}

type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};

interface KeyValue {
  key?: string;
  value?: AnyValue;
}

function attributeValue(value: AnyValue | undefined): string | number | boolean | undefined {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return String(value.stringValue).slice(0, MAX_TEXT);
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.boolValue !== undefined) return Boolean(value.boolValue);
  return undefined;
}

function attributes(list: unknown): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!Array.isArray(list)) return result;
  for (const { key, value } of list as KeyValue[]) {
    const parsed = attributeValue(value);
    if (typeof key === 'string' && parsed !== undefined) result[key] = parsed;
  }
  return result;
}

function nanosToMs(value: unknown): number {
  const nanos = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(nanos) ? nanos / 1e6 : 0;
}

// OTLP/JSON spells ids as hex; some exporters still send base64, which is decoded here.
function hexId(value: unknown, bytes: number): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'i').test(value)) return value.toLowerCase();
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === bytes ? decoded.toString('hex') : null;
}

function spanError(span: Record<string, unknown>, attrs: Record<string, string | number | boolean>): string | null {
  const events = Array.isArray(span.events) ? (span.events as Record<string, unknown>[]) : [];
  const exception = events.find((event) => event.name === 'exception');
  if (exception) {
    const details = attributes(exception.attributes);
    const type = details['exception.type'];
    const message = details['exception.message'];
    return [type, message].filter(Boolean).join(': ') || 'exception';
  }
  const status = (span.status ?? {}) as { code?: number | string; message?: string };
  const failed = status.code === STATUS_ERROR || status.code === 'STATUS_CODE_ERROR';
  if (!failed) return null;
  const httpStatus = attrs['http.response.status_code'] ?? attrs['http.status_code'];
  return (status.message || (httpStatus ? `HTTP ${httpStatus}` : 'error status')).slice(0, MAX_TEXT);
}

export function parseOtlpTraces(body: unknown): BackendSpan[] {
  const spans: BackendSpan[] = [];
  const resourceSpans = (body as { resourceSpans?: unknown })?.resourceSpans;
  if (!Array.isArray(resourceSpans)) return spans;
  for (const resource of resourceSpans as Record<string, unknown>[]) {
    const service = attributes((resource.resource as { attributes?: unknown } | undefined)?.attributes)['service.name'];
    const scopes = Array.isArray(resource.scopeSpans) ? (resource.scopeSpans as Record<string, unknown>[]) : [];
    for (const scope of scopes) {
      for (const span of Array.isArray(scope.spans) ? (scope.spans as Record<string, unknown>[]) : []) {
        const traceId = hexId(span.traceId, 16);
        const spanId = hexId(span.spanId, 8);
        if (!traceId || !spanId || spans.length >= MAX_SPANS) continue;
        const attrs = attributes(span.attributes);
        const start = nanosToMs(span.startTimeUnixNano);
        spans.push({
          traceId,
          spanId,
          parentSpanId: hexId(span.parentSpanId, 8),
          service: typeof service === 'string' ? service : null,
          name: typeof span.name === 'string' ? span.name.slice(0, MAX_TEXT) : 'span',
          server: span.kind === SPAN_KIND_SERVER || span.kind === 'SPAN_KIND_SERVER',
          start,
          durationMs: Math.max(0, Math.round(nanosToMs(span.endTimeUnixNano) - start)),
          error: spanError(span, attrs),
          attributes: attrs,
        });
      }
    }
  }
  return spans;
}

// The timeline keeps the request's server span and every failing span; the rest stays in the trace.
export function isNotable(span: BackendSpan): boolean {
  return span.server || span.error !== null;
}

export function spanSummary(span: BackendSpan): string {
  const service = span.service ? `${span.service}: ` : '';
  const error = span.error ? ` failed: ${span.error}` : '';
  return `Backend ${service}${span.name} (${span.durationMs} ms)${error}`.split('\n')[0];
}
