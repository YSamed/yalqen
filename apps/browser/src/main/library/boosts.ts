import fs from 'node:fs';
import path from 'node:path';
import { BOOST_FONTS, type Boost, type BoostFont, type BoostSite } from '../../shared/boosts.js';
import { readingUrl } from '../../shared/reading-list.js';
import { writeFileAtomic } from '../storage/json-file.js';

const MAX_SITES = 200;
const MAX_HIDDEN = 50;
const MAX_SELECTOR = 200;
const MAX_CSS = 20_000;
const MAX_FILE = 8 * 1024 * 1024;
const FONT_STACKS: Record<BoostFont, string> = {
  system: 'system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
};
const CLOSERS: Record<string, string> = { '[': ']', '(': ')' };

export function boostOrigin(value: unknown): string | null {
  const url = readingUrl(value);
  return url ? new URL(url).origin : null;
}

// A selector goes into a stylesheet rule, so anything that could end the rule, open a block,
// swallow the rules after it or start an at-rule is refused.
export function boostSelector(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const selector = value.trim();
  if (!selector || selector.length > MAX_SELECTOR || /\p{Cc}/u.test(selector)) return null;
  const open: string[] = [];
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === '\\') {
      if (++i === selector.length) return null;
    } else if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (CLOSERS[char]) open.push(CLOSERS[char]);
    else if (char === ']' || char === ')') {
      if (open.pop() !== char) return null;
    } else if ('{};@'.includes(char) || (char === '/' && selector[i + 1] === '*')) return null;
  }
  return quote || open.length ? null : selector;
}

const color = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;

export function sanitizeBoost(value: unknown): Boost | null {
  if (!value || typeof value !== 'object') return null;
  const { enabled, accent, background, font, hidden, css } = value as Record<string, unknown>;
  const selectors = Array.isArray(hidden) && hidden.length <= MAX_HIDDEN ? hidden.map(boostSelector) : null;
  if (
    typeof enabled !== 'boolean' ||
    color(accent) === undefined ||
    color(background) === undefined ||
    (font !== null && !BOOST_FONTS.includes(font as BoostFont)) ||
    !selectors ||
    selectors.includes(null) ||
    typeof css !== 'string' ||
    css.length > MAX_CSS
  )
    return null;
  return {
    enabled,
    accent: color(accent) as string | null,
    background: color(background) as string | null,
    font: font as BoostFont | null,
    hidden: [...new Set(selectors as string[])],
    css,
  };
}

export function boostStyles(boost: Boost): string {
  const rules: string[] = [];
  if (boost.accent)
    rules.push(`:root{accent-color:${boost.accent}!important}a:link,a:visited{color:${boost.accent}!important}`);
  if (boost.background) rules.push(`html,body{background-color:${boost.background}!important}`);
  if (boost.font)
    rules.push(
      `body,body :where(p,h1,h2,h3,h4,h5,h6,a,li,td,th,label,input,button,textarea,select,blockquote){font-family:${FONT_STACKS[boost.font]}!important}`,
    );
  for (const selector of boost.hidden) rules.push(`${selector}{display:none!important}`);
  if (boost.css) rules.push(boost.css);
  return rules.join('\n');
}

export class BoostStore {
  readonly file: string;
  private sites = new Map<string, Boost>();
  constructor(directory: string) {
    this.file = path.join(directory, 'boosts.json');
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return;
      const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      for (const [key, value] of Object.entries(data).slice(0, MAX_SITES)) {
        const origin = boostOrigin(key),
          boost = sanitizeBoost(value);
        if (origin === key && boost) this.sites.set(origin, boost);
      }
    } catch {}
  }
  get(origin: string): Boost | null {
    const boost = this.sites.get(origin);
    return boost ? { ...boost, hidden: [...boost.hidden] } : null;
  }
  list(): BoostSite[] {
    return [...this.sites.keys()].sort().map((origin) => ({ origin, boost: this.get(origin)! }));
  }
  save(origin: unknown, value: unknown): boolean {
    const key = boostOrigin(origin),
      boost = sanitizeBoost(value);
    if (!key || !boost || (!this.sites.has(key) && this.sites.size >= MAX_SITES)) return false;
    return this.replace(new Map(this.sites).set(key, boost));
  }
  hide(origin: unknown, selector: unknown): boolean {
    const key = boostOrigin(origin),
      hidden = boostSelector(selector);
    if (!key || !hidden) return false;
    const current = this.get(key) ?? { enabled: true, accent: null, background: null, font: null, hidden: [], css: '' };
    return this.save(key, { ...current, enabled: true, hidden: [...current.hidden, hidden] });
  }
  remove(origin: unknown): boolean {
    const key = boostOrigin(origin);
    if (!key || !this.sites.has(key)) return false;
    const next = new Map(this.sites);
    next.delete(key);
    return this.replace(next);
  }
  private replace(sites: Map<string, Boost>): boolean {
    const json = JSON.stringify(Object.fromEntries(sites));
    const saved = json.length <= MAX_FILE && writeFileAtomic(this.file, json);
    if (saved) this.sites = sites;
    return saved;
  }
}
