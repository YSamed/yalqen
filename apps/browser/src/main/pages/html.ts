export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// A string replacement would expand `$&`, `` $` `` and similar patterns found in page titles.
export function fillSlot(page: string, marker: string, content: string): string {
  return page.replace(marker, () => content);
}

export const FORGET_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>';
