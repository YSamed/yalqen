export interface PageText {
  text: string;
  selection: string;
  truncated: boolean;
}

export const PAGE_TEXT_WORLD_ID = 1003;
const MAX_PAGE_TEXT = 50_000;
const MAX_SELECTION = 10_000;

export const PAGE_TEXT_SCRIPT = `(() => {
  const root = document.querySelector('main, article, [role="main"]') || document.body;
  const text = root ? root.innerText : '';
  const selection = String(window.getSelection() || '');
  return { text: text.slice(0, ${MAX_PAGE_TEXT + 1}), selection: selection.slice(0, ${MAX_SELECTION}) };
})()`;

export function parsePageText(value: unknown): PageText | null {
  if (!value || typeof value !== 'object') return null;
  const { text, selection } = value as Record<string, unknown>;
  if (typeof text !== 'string' || typeof selection !== 'string') return null;
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: clean.slice(0, MAX_PAGE_TEXT),
    selection: selection.trim().slice(0, MAX_SELECTION),
    truncated: clean.length > MAX_PAGE_TEXT,
  };
}
