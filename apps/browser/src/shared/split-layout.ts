export const SPLIT_GAP = 6;

export const MIN_PANE_WIDTH = 240;

export interface PaneSlot {
  index: number;
  count: number;
  weights?: readonly number[];
}

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function slotRect(bounds: PaneRect, { index, count, weights }: PaneSlot, gap = SPLIT_GAP): PaneRect {
  if (count < 2) return bounds;
  const free = Math.max(0, bounds.width - gap * (count - 1));
  const shares = weights?.length === count ? weights : Array<number>(count).fill(1 / count);
  const before = (end: number) => shares.slice(0, end).reduce((sum, share) => sum + share, 0);
  const left = Math.round(free * before(index));
  const right = Math.round(free * before(index + 1));
  return { x: bounds.x + left + gap * index, y: bounds.y, width: right - left, height: bounds.height };
}

// Moves the boundary after pane `index` to `x`, keeping the two neighbours' combined share and a minimum width.
export function resizeWeights(
  bounds: PaneRect,
  weights: readonly number[] | undefined,
  count: number,
  index: number,
  x: number,
  gap = SPLIT_GAP,
): number[] {
  const shares = weights?.length === count ? [...weights] : Array<number>(count).fill(1 / count);
  const free = Math.max(1, bounds.width - gap * (count - 1));
  const start = shares.slice(0, index).reduce((sum, share) => sum + share, 0);
  const pair = shares[index] + shares[index + 1];
  const min = Math.min(MIN_PANE_WIDTH / free, pair / 2);
  const boundary = (x - bounds.x - gap * index - gap / 2) / free;
  shares[index] = Math.min(Math.max(boundary - start, min), pair - min);
  shares[index + 1] = pair - shares[index];
  return shares;
}
