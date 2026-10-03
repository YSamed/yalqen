import type { PageLanguage } from '../../shared/types.js';

export const TRANSLATE_WORLD_ID = 1002;

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHUNK_CHARS = 4000;
const MAX_CHUNK_ITEMS = 50;
const MAX_PAGE_CHARS = 80_000;
const CONCURRENCY = 4;
const SEPARATOR = '\n';

export interface FetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<FetchResponse>;

export interface ScriptTarget {
  isDestroyed(): boolean;
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown>;
}

export interface Collected {
  token: string;
  texts: string[];
}

export const DETECT_LANGUAGE_SCRIPT = `(() => (document.documentElement.lang || '').trim().toLowerCase().split(/[-_]/)[0] || null)()`;

export const COLLECT_SCRIPT = `(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'SVG', 'MATH', 'IFRAME']);
  const skipped = (element) =>
    element.closest('[translate="no"], .notranslate, [contenteditable=""], [contenteditable="true"]') !== null;
  const nodes = [];
  const texts = [];
  let total = 0;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName.toUpperCase()) || skipped(parent)) return NodeFilter.FILTER_REJECT;
      return /\\p{L}/u.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.replace(/\\s+/g, ' ').trim();
    total += text.length;
    if (total > ${MAX_PAGE_CHARS}) break;
    nodes.push(node);
    texts.push(text);
  }
  const token = Math.random().toString(36).slice(2);
  window.__yalqenTranslation = { token, nodes, originals: nodes.map((node) => node.nodeValue) };
  return { token, texts };
})()`;

export const COLLECT_SELECTION_SCRIPT = `(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT']);
  const selection = window.getSelection();
  const nodes = [];
  let total = 0;
  for (let index = 0; index < (selection?.rangeCount ?? 0); index++) {
    const range = selection.getRangeAt(index);
    const { startContainer, startOffset, endContainer, endOffset } = range;
    const root = range.commonAncestorContainer;
    const candidates = [];
    if (root.nodeType === Node.TEXT_NODE) {
      candidates.push(root);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) candidates.push(node);
    }
    for (let node of candidates) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName.toUpperCase()) || parent.isContentEditable) continue;
      if ((node === endContainer && endOffset === 0) || (node === startContainer && startOffset === node.length)) {
        continue;
      }
      if (node === endContainer && endOffset < node.length) node.splitText(endOffset);
      if (node === startContainer && startOffset > 0) node = node.splitText(startOffset);
      if (!/\\p{L}/u.test(node.nodeValue ?? '')) continue;
      total += node.nodeValue.length;
      if (total > ${MAX_PAGE_CHARS}) break;
      nodes.push(node);
    }
  }
  const token = Math.random().toString(36).slice(2);
  window.__yalqenSelectionTranslation = { token, nodes, originals: nodes.map((node) => node.nodeValue) };
  return { token, texts: nodes.map((node) => node.nodeValue.replace(/\\s+/g, ' ').trim()) };
})()`;

function applyStateScript(stateKey: string, token: string, translations: string[]): string {
  return `((token, translations) => {
    const state = window.${stateKey};
    if (!state || state.token !== token || state.nodes.length !== translations.length) return false;
    state.nodes.forEach((node, index) => {
      if (!node.isConnected) return;
      const original = state.originals[index];
      const lead = original.match(/^\\s*/)[0];
      const trail = original.match(/\\s*$/)[0];
      node.nodeValue = lead + translations[index] + trail;
    });
    return true;
  })(${JSON.stringify(token)}, ${JSON.stringify(translations)})`;
}

export function applyScript(token: string, translations: string[]): string {
  return applyStateScript('__yalqenTranslation', token, translations);
}

export function applySelectionScript(token: string, translations: string[]): string {
  return `(() => {
    const applied = ${applyStateScript('__yalqenSelectionTranslation', token, translations)};
    delete window.__yalqenSelectionTranslation;
    return applied;
  })()`;
}

export const RESTORE_SCRIPT = `(() => {
  const state = window.__yalqenTranslation;
  if (!state) return false;
  state.nodes.forEach((node, index) => {
    if (node.isConnected) node.nodeValue = state.originals[index];
  });
  delete window.__yalqenTranslation;
  return true;
})()`;

export function parseCollected(raw: unknown): Collected | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { token, texts } = raw as { token?: unknown; texts?: unknown };
  if (typeof token !== 'string' || !Array.isArray(texts) || !texts.every((text) => typeof text === 'string')) {
    return null;
  }
  return { token, texts };
}

export function normalizeLanguage(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z]{2,3}$/.test(value) ? value : null;
}

export function chunkTexts(texts: readonly string[]): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let size = 0;
  texts.forEach((text, index) => {
    const cost = text.length + SEPARATOR.length;
    if (current.length > 0 && (size + cost > MAX_CHUNK_CHARS || current.length >= MAX_CHUNK_ITEMS)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(index);
    size += cost;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function parseTranslation(raw: unknown): { text: string; source: string | null } | null {
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return null;
  let text = '';
  for (const segment of raw[0] as unknown[]) {
    if (!Array.isArray(segment)) continue;
    if (typeof segment[0] === 'string') text += segment[0];
  }
  return { text, source: normalizeLanguage(raw[2]) };
}

async function translateChunk(
  fetchLike: FetchLike,
  text: string,
  target: PageLanguage,
): Promise<{ text: string; source: string | null }> {
  const url = `${ENDPOINT}?client=gtx&sl=auto&tl=${target}&dt=t`;
  const response = await fetchLike(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `q=${encodeURIComponent(text)}`,
  });
  if (!response.ok) throw new Error('translation request failed');
  const parsed = parseTranslation(await response.json());
  if (!parsed) throw new Error('translation response unreadable');
  return parsed;
}

async function translateGroup(
  fetchLike: FetchLike,
  group: readonly string[],
  target: PageLanguage,
  isCancelled: () => boolean,
): Promise<{ texts: string[]; source: string | null } | null> {
  const joined = await translateChunk(fetchLike, group.join(SEPARATOR), target);
  if (isCancelled()) return null;
  const lines = joined.text.split(SEPARATOR);
  if (lines.length === group.length) return { texts: lines.map((line) => line.trim()), source: joined.source };
  // The engine merged or split lines, so the batch cannot be mapped back reliably; go one by one.
  const texts: string[] = [];
  let source = joined.source;
  for (const text of group) {
    if (isCancelled()) return null;
    const single = await translateChunk(fetchLike, text, target);
    texts.push(single.text.replace(/\s+/g, ' ').trim());
    source ??= single.source;
  }
  return { texts, source };
}

export async function translateTexts(
  fetchLike: FetchLike,
  texts: readonly string[],
  target: PageLanguage,
  isCancelled: () => boolean = () => false,
): Promise<{ texts: string[]; source: string | null }> {
  // Repeated labels and navigation text need only one translation per run. The
  // index is local to this page/selection; no page text is cached across runs.
  const unique: string[] = [];
  const positions = new Map<string, number>();
  const indices = texts.map((text) => {
    let index = positions.get(text);
    if (index === undefined) {
      index = unique.length;
      positions.set(text, index);
      unique.push(text);
    }
    return index;
  });
  const chunks = chunkTexts(unique);
  const result = [...unique];
  let source: string | null = null;
  let next = 0;
  let failed = false;
  const stopped = () => failed || isCancelled();
  const worker = async () => {
    try {
      while (next < chunks.length && !stopped()) {
        const indices = chunks[next++];
        const group = await translateGroup(
          fetchLike,
          indices.map((index) => unique[index]),
          target,
          stopped,
        );
        if (!group || stopped()) return;
        indices.forEach((index, position) => {
          if (group.texts[position]) result[index] = group.texts[position];
        });
        source ??= group.source;
      }
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return { texts: indices.map((index) => result[index]), source };
}

export async function detectLanguage(target: ScriptTarget): Promise<string | null> {
  if (target.isDestroyed()) return null;
  const raw = await target.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: DETECT_LANGUAGE_SCRIPT }]);
  return normalizeLanguage(raw);
}

export interface TranslationRun {
  cancelled(): boolean;
}

export async function translatePage(
  target: ScriptTarget,
  fetchLike: FetchLike,
  language: PageLanguage,
  run: TranslationRun,
): Promise<{ source: string | null } | null> {
  const collected = parseCollected(
    await target.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: COLLECT_SCRIPT }]),
  );
  if (!collected || collected.texts.length === 0) throw new Error('nothing to translate');
  const { texts, source } = await translateTexts(fetchLike, collected.texts, language, run.cancelled);
  if (run.cancelled() || target.isDestroyed()) return null;
  const applied = await target.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [
    { code: applyScript(collected.token, texts) },
  ]);
  if (applied !== true) return null;
  return { source };
}

export async function restorePage(target: ScriptTarget): Promise<void> {
  if (target.isDestroyed()) return;
  await target.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: RESTORE_SCRIPT }]);
}

export async function translateSelection(
  target: ScriptTarget,
  fetchLike: FetchLike,
  language: PageLanguage,
): Promise<boolean> {
  if (target.isDestroyed()) return false;
  const collected = parseCollected(
    await target.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: COLLECT_SELECTION_SCRIPT }]),
  );
  if (!collected || collected.texts.length === 0) throw new Error('nothing selected to translate');
  const { texts } = await translateTexts(fetchLike, collected.texts, language);
  if (target.isDestroyed()) return false;
  const applied = await target.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [
    { code: applySelectionScript(collected.token, texts) },
  ]);
  return applied === true;
}
