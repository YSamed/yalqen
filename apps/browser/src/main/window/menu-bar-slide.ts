// Between reveals AppKit parks the strip above the screen in one jump; a real slide moves a few points per frame.
const PARK_JUMP = 20;
const EASE = 0.3;

export interface MenuBarSlide {
  edge: number | null;
  target: number;
  inset: number;
}

export const RESTING_SLIDE: MenuBarSlide = { edge: null, target: 0, inset: 0 };

// AppKit's own slide stalls near the end, so it only sets the direction and the content eases on its own.
export function slideMenuBar(slide: MenuBarSlide, edge: number | null, height: number): MenuBarSlide {
  if (edge === null) return RESTING_SLIDE;
  const step = slide.edge === null ? 0 : edge - slide.edge;
  const target = step !== 0 && Math.abs(step) < PARK_JUMP ? (step > 0 ? height : 0) : slide.target;
  const gap = target - slide.inset;
  return { edge, target, inset: Math.abs(gap) < 0.5 ? target : slide.inset + gap * EASE };
}
