export const PEEK_INSET = 24;
export const PEEK_HEADER = 44;
export const PEEK_MAX_WIDTH = 1200;

export interface PeekBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function peekLayout(width: number, height: number, inset = PEEK_INSET): { card: PeekBox; body: PeekBox } {
  const cardWidth = Math.max(0, Math.min(PEEK_MAX_WIDTH, width - 2 * inset));
  const cardHeight = Math.max(0, height - 2 * inset);
  const header = Math.min(PEEK_HEADER, cardHeight);
  const card = { x: Math.round((width - cardWidth) / 2), y: inset, width: cardWidth, height: cardHeight };
  return { card, body: { x: card.x, y: card.y + header, width: cardWidth, height: cardHeight - header } };
}
