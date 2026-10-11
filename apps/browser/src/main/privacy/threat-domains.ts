import { domainToASCII } from 'node:url';

// Only Node built-ins here: the parser also runs in a worker thread.
export const MAX_ENTRIES = 500_000;
// Marks a cached list that was already validated, normalized and sorted, so it loads without reparsing.
const NORMALIZED_HEADER = '# yalqen normalized domains v1\n';

export function parseThreatDomains(text: string): Set<string> {
  const domains = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const domain = domainToASCII(value.toLowerCase());
    if (
      !domain ||
      domain.length > 253 ||
      !domain.includes('.') ||
      !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error('Invalid domain list');
    domains.add(domain);
    if (domains.size > MAX_ENTRIES) throw new Error('Domain list too large');
  }
  if (!domains.size) throw new Error('Empty domain list');
  return domains;
}

export interface NormalizedDomains {
  text: string;
  starts: Uint32Array<ArrayBuffer>;
}

export function normalizeThreatDomains(text: string): NormalizedDomains {
  return indexNormalized(NORMALIZED_HEADER + [...parseThreatDomains(text)].sort().join('\n'));
}

// A cached list from before normalization still goes through full validation.
export function loadThreatDomains(text: string): NormalizedDomains {
  return text.startsWith(NORMALIZED_HEADER) ? indexNormalized(text) : normalizeThreatDomains(text);
}

function indexNormalized(text: string): NormalizedDomains {
  const starts: number[] = [];
  for (let start = NORMALIZED_HEADER.length; start < text.length;) {
    starts.push(start);
    const end = text.indexOf('\n', start);
    if (end < 0) break;
    start = end + 1;
  }
  return { text, starts: Uint32Array.from(starts) };
}

// One sorted string with line offsets: building it costs no per-domain allocations on the main
// thread, which a Set of several hundred thousand strings would.
export class DomainList {
  constructor(
    readonly text = '',
    private readonly starts: Uint32Array = new Uint32Array(0),
  ) {}

  get size(): number {
    return this.starts.length;
  }

  has(domain: string): boolean {
    let low = 0;
    let high = this.starts.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const start = this.starts[middle];
      const next = this.text.indexOf('\n', start);
      const entry = this.text.slice(start, next < 0 ? this.text.length : next);
      if (entry === domain) return true;
      if (entry < domain) low = middle + 1;
      else high = middle - 1;
    }
    return false;
  }
}
