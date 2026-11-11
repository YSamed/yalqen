export type SwipeDirection = -1 | 0 | 1;

export function createSwipeTracker(
  distance = 80,
  gapMs = 200,
): (dx: number, dy: number, now: number) => SwipeDirection {
  let total = 0;
  let last = -Infinity;
  let done = false;
  return (dx, dy, now) => {
    if (now - last > gapMs) {
      total = 0;
      done = false;
    }
    last = now;
    if (done || Math.abs(dx) <= Math.abs(dy)) return 0;
    total += dx;
    if (Math.abs(total) < distance) return 0;
    // one switch per gesture: trackpad momentum keeps sending events after the fingers lift
    done = true;
    return total > 0 ? 1 : -1;
  };
}
