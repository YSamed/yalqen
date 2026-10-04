const MASK = '[masked]';
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);
const SENSITIVE_PATTERN = /token|secret|api[-_]?key|session/;

export type Headers = Record<string, string>;

function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADERS.has(lower) || SENSITIVE_PATTERN.test(lower);
}

export function maskHeaders(headers: Headers | undefined): Headers {
  const masked: Headers = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    masked[name] = isSensitiveHeader(name) ? MASK : String(value);
  }
  return masked;
}

export interface Truncated {
  text: string;
  truncated: boolean;
}

export function truncateBytes(text: string, maxBytes: number): Truncated {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, truncated: false };
  // Cutting inside a multi-byte character leaves a replacement character at the end.
  return { text: bytes.subarray(0, maxBytes).toString('utf8').replace(/�$/, ''), truncated: true };
}
