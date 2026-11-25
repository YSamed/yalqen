import type { TabId, TabSnapshot, UiAction } from '../../shared/types';

export type DragGroup = 'pinned' | 'listed';
export type SplitSide = 'left' | 'right';

export interface TabDragHost {
  tabs(): TabSnapshot[];
  pinned(): TabSnapshot[];
  orderKey(): string;
  activeTabId(): TabId | null;
  groupOf(id: TabId): TabSnapshot['group'];
  canNestFolder(name: string, target: string): boolean;
  pageRect?(): DOMRect | undefined;
  onSplitDrop?(side: SplitSide | null): void;
  send(action: UiAction): void;
}

interface Press {
  id: TabId;
  group: DragGroup;
  list: HTMLElement;
  item: HTMLElement;
  x: number;
  y: number;
  scrollTop: number;
  home: DOMRect;
  dragging: boolean;
  cancelled: boolean;
}

const DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 28;
const SCROLL_STEP = 8;

// Pointer dragging of tab rows and folders in the sidebar: reorder, drop into a folder, nest folders, split the page.
export class TabDrag {
  lists: HTMLElement | undefined = $state();
  dragId: TabId | null = $state(null);
  group: DragGroup | null = $state(null);
  offset = $state({ x: 0, y: 0 });
  dropIndex: number | null = $state(null);
  dropFolder: string | null = $state(null);
  dropPinRoot = $state(false);
  dropTab: TabId | null = $state(null);
  dropRow: number | null = $state(null);
  returningId: TabId | null = $state(null);
  #settleOrder: string | null = $state(null);
  #press: Press | null = null;
  #folderPress: { name: string; x: number; y: number; dragging: boolean } | null = null;
  #pointer = { x: 0, y: 0 };
  #splitSide: SplitSide | null = null;
  #rows: { id: TabId; top: number; bottom: number }[] = [];
  #from = -1;
  #scrollFrame = 0;
  #settleTimer = 0;
  #returnTimer = 0;
  #host: TabDragHost;

  constructor(host: TabDragHost) {
    this.#host = host;
    $effect(() => {
      if (this.#settleOrder !== null && this.#settleOrder !== host.orderKey()) this.#reset();
    });
  }

  get dragging(): boolean {
    return this.#press?.dragging ?? false;
  }

  style(id: TabId): string | undefined {
    if (id !== this.dragId) {
      const shift = this.#shift(id);
      return shift ? `translateY(${shift}px)` : undefined;
    }
    return this.#settleOrder === null || this.#settleOrder === this.#host.orderKey()
      ? `translate(${this.offset.x}px, ${this.offset.y}px)`
      : undefined;
  }

  // Rows between the dragged row and its slot step aside by one row, so the list shows the new order live.
  #shift(id: TabId): number {
    const slot = this.dropRow;
    const from = this.#from;
    if (slot === null || from < 0 || this.group !== 'listed') return 0;
    const index = this.#rows.findIndex((row) => row.id === id);
    if (index < 0) return 0;
    const step = this.#rows.length > 1 ? this.#rows[1].top - this.#rows[0].top : 0;
    if (from < slot && index > from && index < slot) return -step;
    if (slot <= from && index >= slot && index < from) return step;
    return 0;
  }

  pressTab(event: PointerEvent & { currentTarget: HTMLElement }, id: TabId, group: DragGroup): void {
    if (event.button !== 0 || !event.isPrimary || !this.lists || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (this.#settleOrder !== null) this.#reset();
    this.#press = {
      id,
      group,
      list: event.currentTarget.parentElement!,
      item: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      scrollTop: this.lists.scrollTop,
      home: event.currentTarget.getBoundingClientRect(),
      dragging: false,
      cancelled: false,
    };
  }

  pressFolder(event: PointerEvent, name: string): void {
    if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey) return;
    this.#folderPress = { name, x: event.clientX, y: event.clientY, dragging: false };
  }

  move(event: PointerEvent): void {
    if (this.#folderPress) {
      this.#moveFolder(event);
      return;
    }
    const press = this.#press;
    if (!press || press.cancelled || !event.isPrimary) return;
    this.#pointer = { x: event.clientX, y: event.clientY };
    if (!press.dragging) {
      if (Math.hypot(this.#pointer.x - press.x, this.#pointer.y - press.y) < DRAG_THRESHOLD) return;
      press.dragging = true;
      this.dragId = press.id;
      this.group = press.group;
      this.#captureRows(press);
    }
    this.#track();
    if (this.#scrollSpeed() !== 0 && !this.#scrollFrame) this.#scrollFrame = requestAnimationFrame(this.#autoScroll);
  }

  release(event: PointerEvent): void {
    if (this.#folderPress) {
      this.#finishFolder();
      return;
    }
    const press = this.#press;
    if (!press || !event.isPrimary) return;
    if (press.dragging) {
      suppressNextClick();
      if (!press.cancelled && this.#splitSide) {
        this.#host.send({ type: 'split-tab', id: press.id, side: this.#splitSide });
        this.#splitSide = null;
        this.#host.onSplitDrop?.(null);
        this.end();
        return;
      }
      if (!press.cancelled && this.dropTab) {
        this.#host.send({ type: 'split-into', id: press.id, target: this.dropTab });
        this.end();
        return;
      }
      if (!press.cancelled && (this.dropFolder || this.dropPinRoot)) {
        this.#host.send({ type: 'move-tab-to-group', id: press.id, name: this.dropFolder });
        this.end();
        return;
      }
      if (!press.cancelled && (press.group === 'listed' ? this.#commitRow(press) : this.#commitMove(press))) {
        this.#settle();
        return;
      }
      this.#returnHome(press.id);
    }
    this.end();
  }

  // Escape: returns false when no drag was in progress, so the caller can use the key itself.
  escape(): boolean {
    if (this.#folderPress) {
      this.#cancelFolder();
      return true;
    }
    if (!this.#press?.dragging) return false;
    this.#press.cancelled = true;
    this.#reset();
    return true;
  }

  end(): void {
    this.#cancelFolder();
    this.#press = null;
    this.#reset();
  }

  #moveFolder(event: PointerEvent): void {
    const press = this.#folderPress;
    if (!press || !event.isPrimary) return;
    this.#pointer = { x: event.clientX, y: event.clientY };
    if (!press.dragging && Math.hypot(this.#pointer.x - press.x, this.#pointer.y - press.y) < DRAG_THRESHOLD) return;
    press.dragging = true;
    const target = this.#folderDropAt()?.dataset.folder;
    this.dropFolder = target && this.#host.canNestFolder(press.name, target) ? target : null;
  }

  #finishFolder(): void {
    const press = this.#folderPress;
    if (press?.dragging) {
      suppressNextClick();
      if (this.dropFolder) this.#host.send({ type: 'move-tab-group', name: press.name, parent: this.dropFolder });
    }
    this.#cancelFolder();
  }

  #cancelFolder(): void {
    this.#folderPress = null;
    this.dropFolder = null;
  }

  #folderDropAt(): HTMLElement | undefined {
    return document
      .elementsFromPoint(this.#pointer.x, this.#pointer.y)
      .find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          (element.hasAttribute('data-folder') || element.hasAttribute('data-pin-root')),
      );
  }

  // The middle half of a row (or a favorite tile) splits with that tab; its edges still reorder.
  #tabAt(press: Press): TabId | null {
    const { x, y } = this.#pointer;
    // Rows of the dragged row's own list move aside, so they are judged where they stood when the drag began.
    const scrolled = y + (this.lists?.scrollTop ?? 0);
    const row = this.#rows.find((item) => scrolled >= item.top && scrolled < item.bottom);
    if (row) return row.id !== press.id && inMiddle((scrolled - row.top) / (row.bottom - row.top)) ? row.id : null;
    for (const element of document.elementsFromPoint(x, y)) {
      const item = (element as HTMLElement).closest<HTMLElement>('[data-tab-id]');
      if (!item || item === press.item || item.parentElement === press.list) continue;
      const rect = item.getBoundingClientRect();
      const across = rect.width > rect.height * 2 ? (y - rect.top) / rect.height : (x - rect.left) / rect.width;
      return inMiddle(across) && item.dataset.tabId !== press.id ? item.dataset.tabId! : null;
    }
    return null;
  }

  #captureRows(press: Press): void {
    const scroll = this.lists?.scrollTop ?? 0;
    this.#rows =
      press.group === 'listed'
        ? [...press.list.querySelectorAll<HTMLElement>(':scope > [data-tab-id]')].map((item) => {
            const rect = item.getBoundingClientRect();
            return { id: item.dataset.tabId!, top: rect.top + scroll, bottom: rect.bottom + scroll };
          })
        : [];
    this.#from = this.#rows.findIndex((row) => row.id === press.id);
  }

  #rowSlotAt(): number | null {
    if (this.#from < 0) return null;
    const y = this.#pointer.y + (this.lists?.scrollTop ?? 0);
    const index = this.#rows.findIndex((row) => y < (row.top + row.bottom) / 2);
    const slot = index < 0 ? this.#rows.length : index;
    return slot === this.#from || slot === this.#from + 1 ? null : slot;
  }

  #commitRow(press: Press): boolean {
    const slot = this.dropRow;
    if (slot === null) return false;
    const after = slot >= this.#rows.length;
    const target = this.#rows[after ? this.#rows.length - 1 : slot];
    if (!target || target.id === press.id) return false;
    this.#host.send({ type: 'move-row', id: press.id, target: target.id, after });
    return true;
  }

  #splitSideAt(): SplitSide | null {
    const page = this.#host.pageRect?.();
    const { x, y } = this.#pointer;
    if (!this.#press || this.#press.id === this.#host.activeTabId() || !page) return null;
    if (x < page.left || x > page.right || y < page.top || y > page.bottom) return null;
    return x < page.left + page.width / 2 ? 'left' : 'right';
  }

  #setSplitSide(next: SplitSide | null, id: TabId | null = null): void {
    if (next === this.#splitSide) return;
    this.#splitSide = next;
    this.#host.send({ type: 'preview-split', id: next ? id : null, side: next ?? 'right' });
    this.#host.onSplitDrop?.(next);
  }

  #track(): void {
    const press = this.#press;
    const lists = this.lists;
    if (!press || !lists) return;
    const horizontal = press.group === 'pinned';
    const bounds = lists.getBoundingClientRect();
    const scrolled = lists.scrollTop - press.scrollTop;
    const content = lists.lastElementChild?.getBoundingClientRect();
    const homeTop = press.home.top - bounds.top + press.scrollTop;
    const contentHeight = (content?.bottom ?? bounds.bottom) - bounds.top + lists.scrollTop;
    const minY = -homeTop;
    const maxY = contentHeight - press.home.height - homeTop;
    const minX = bounds.left - press.home.left;
    const maxX = bounds.right - press.home.right;
    this.offset = {
      x: horizontal ? Math.min(Math.max(this.#pointer.x - press.x, minX), maxX) : 0,
      y: Math.min(Math.max(this.#pointer.y - press.y + scrolled, minY), maxY),
    };
    if (horizontal) this.dropIndex = this.#slotAt(press);
    else this.dropRow = this.#rowSlotAt();
    this.#setSplitSide(this.#splitSideAt(), press.id);
    const folderTarget = this.#splitSide ? undefined : this.#folderDropAt();
    const folder = folderTarget?.dataset.folder;
    this.dropFolder = folder && folder !== this.#host.groupOf(press.id) ? folder : null;
    this.dropPinRoot = folderTarget?.hasAttribute('data-pin-root') ?? false;
    this.dropTab = this.#splitSide || folder || this.dropPinRoot ? null : this.#tabAt(press);
    if (this.#splitSide || folder || this.dropPinRoot || this.dropTab) {
      this.dropIndex = null;
      this.dropRow = null;
    }
  }

  #slotAt(press: Press): number | null {
    const { x, y } = this.#pointer;
    let nearest: { index: number; rect: DOMRect } | null = null;
    let nearestDistance = Infinity;
    for (const item of press.list.querySelectorAll<HTMLElement>(':scope > [data-drag-index]')) {
      const rect = item.getBoundingClientRect();
      if (item === press.item) {
        rect.x -= this.offset.x;
        rect.y -= this.offset.y;
      }
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { index: Number(item.dataset.dragIndex), rect };
      }
    }
    if (!nearest) return null;
    const { index, rect } = nearest;
    const before = x < rect.left + rect.width / 2;
    const slot = before ? index : index + 1;
    const from = this.#host.pinned().findIndex((tab) => tab.id === press.id);
    return from < 0 || slot === from || slot === from + 1 ? null : slot;
  }

  #scrollSpeed(): number {
    const lists = this.lists;
    if (!lists) return 0;
    const { top, bottom } = lists.getBoundingClientRect();
    if (this.#pointer.y < top + SCROLL_EDGE && lists.scrollTop > 0) return -SCROLL_STEP;
    if (this.#pointer.y > bottom - SCROLL_EDGE && lists.scrollTop + lists.clientHeight < lists.scrollHeight)
      return SCROLL_STEP;
    return 0;
  }

  #autoScroll = (): void => {
    const speed = this.#press?.dragging && !this.#press.cancelled ? this.#scrollSpeed() : 0;
    if (speed === 0 || !this.lists) {
      this.#scrollFrame = 0;
      return;
    }
    this.lists.scrollTop += speed;
    this.#track();
    this.#scrollFrame = requestAnimationFrame(this.#autoScroll);
  };

  #commitMove(press: Press): boolean {
    const group = this.#host.pinned();
    if (this.dropIndex === null || !group.some((tab) => tab.id === press.id)) return false;
    const tabs = this.#host.tabs();
    const from = tabs.findIndex((tab) => tab.id === press.id);
    const before = group[this.dropIndex];
    const target = before ? tabs.indexOf(before) : tabs.indexOf(group[group.length - 1]) + 1;
    const toIndex = target > from ? target - 1 : target;
    if (toIndex === from) return false;
    this.#host.send({ type: 'move-tab', id: press.id, toIndex });
    return true;
  }

  #settle(): void {
    this.#press = null;
    this.dropIndex = null;
    cancelAnimationFrame(this.#scrollFrame);
    this.#scrollFrame = 0;
    this.#settleOrder = this.#host.orderKey();
    clearTimeout(this.#settleTimer);
    this.#settleTimer = window.setTimeout(() => this.#reset(), 400);
  }

  #returnHome(id: TabId): void {
    this.returningId = id;
    clearTimeout(this.#returnTimer);
    this.#returnTimer = window.setTimeout(() => (this.returningId = null), 220);
  }

  #reset(): void {
    this.#setSplitSide(null);
    this.dragId = null;
    this.group = null;
    this.dropFolder = null;
    this.dropPinRoot = false;
    this.dropTab = null;
    this.dropIndex = null;
    this.dropRow = null;
    this.#rows = [];
    this.#from = -1;
    this.offset = { x: 0, y: 0 };
    this.#settleOrder = null;
    clearTimeout(this.#settleTimer);
    cancelAnimationFrame(this.#scrollFrame);
    this.#scrollFrame = 0;
  }
}

function inMiddle(fraction: number): boolean {
  return fraction > 0.3 && fraction < 0.7;
}

function suppressNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
}
