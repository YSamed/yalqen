import { prefersReducedMotion } from 'svelte/motion';
import type { SpaceView } from '../../shared/workspaces';

const COMMIT_DISTANCE = 64;
const IDLE_MS = 160;
const SWITCH_SHIFT = 48;
const SETTLE_MS = 300;

// A horizontal trackpad swipe over the sidebar drags the space list and switches space past a threshold.
export class SpaceSwipe {
  shift = $state(0);
  shifting = $state(false);
  following = $state(false);
  #total = 0;
  #cross = 0;
  #axis: 'x' | 'y' | null = null;
  #lastDx = 0;
  #locked = false;
  #idle: ReturnType<typeof setTimeout> | undefined;
  #settle: ReturnType<typeof setTimeout> | undefined;
  #shownSpaceId: string | undefined;
  #swipedDirection: 1 | -1 | null = null;
  #switchTo: (id: string) => void;

  constructor(switchTo: (id: string) => void) {
    this.#switchTo = switchTo;
  }

  wheel(event: WheelEvent, spaces: SpaceView[], activeSpaceId: string): void {
    if (spaces.length < 2 || event.ctrlKey) return;
    const dx = Math.abs(event.deltaX);
    // Momentum only slows down, so a sharp rise in horizontal speed is a new swipe, not the old one's tail.
    if ((this.#locked || this.#axis === 'y') && dx > 4 && dx > this.#lastDx * 2.5) this.#end();
    this.#lastDx = dx;
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.#end(), IDLE_MS);
    if (this.#locked) return;
    this.#total -= event.deltaX;
    this.#cross += Math.abs(event.deltaY);
    if (!this.#axis) {
      if (Math.abs(this.#total) + this.#cross < 8) return;
      this.#axis = Math.abs(this.#total) > this.#cross ? 'x' : 'y';
    }
    if (this.#axis === 'y') return;
    const direction = this.#total < 0 ? 1 : -1;
    if (Math.abs(this.#total) >= COMMIT_DISTANCE) {
      const index = spaces.findIndex((space) => space.id === activeSpaceId);
      this.#locked = true;
      this.#swipedDirection = direction;
      this.#switchTo(spaces[(index + direction + spaces.length) % spaces.length].id);
      return;
    }
    this.#move(this.#total * 0.6, true);
  }

  showSpace(activeSpaceId: string, spaces: SpaceView[]): void {
    const previous = this.#shownSpaceId;
    this.#shownSpaceId = activeSpaceId;
    if (previous === undefined || previous === activeSpaceId) return;
    const from = spaces.findIndex((space) => space.id === previous);
    const to = spaces.findIndex((space) => space.id === activeSpaceId);
    const direction = this.#swipedDirection ?? (to > from ? 1 : -1);
    this.#swipedDirection = null;
    if (from < 0 || to < 0) return;
    this.#move(direction * SWITCH_SHIFT, true);
    requestAnimationFrame(() => requestAnimationFrame(() => this.#move(0, false)));
  }

  #move(offset: number, following: boolean): void {
    if (prefersReducedMotion.current) return;
    clearTimeout(this.#settle);
    this.shifting = true;
    this.following = following;
    this.shift = offset;
    if (!following && offset === 0) this.#settle = setTimeout(() => (this.shifting = false), SETTLE_MS);
  }

  #end(): void {
    this.#total = 0;
    this.#cross = 0;
    this.#axis = null;
    this.#locked = false;
    if (this.following) this.#move(0, false);
  }
}
