import type { AnchorRect } from '../../shared/types';

export function anchorRect(element: Element): AnchorRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}
