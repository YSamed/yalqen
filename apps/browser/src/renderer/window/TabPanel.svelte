<script lang="ts">
  import type {
    DownloadsSummary,
    Favorite,
    ProfileKind,
    SidebarMenuKind,
    SidebarFooterItem,
    AnchorRect,
    TabId,
    TabSnapshot,
  } from '../../shared/types';
  import type { MediaInfo } from '../../shared/sidebar-widgets';
  import { t } from '../../shared/i18n';
  import { placeSidebarFooterItem } from '../../shared/types';
  import { cubicOut } from 'svelte/easing';
  import { flip } from 'svelte/animate';
  import { devStates } from './format';
  import Icon, { type IconName } from '../ui/Icon.svelte';
  import NewTabButton from './NewTabButton.svelte';
  import MediaPlayer from './MediaPlayer.svelte';
  import LiveFolders from './LiveFolders.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { createHoverPreviews } from './hover-previews';
  import type { TabGroup } from '../../shared/tab-groups';
  import type { LiveFolderView } from '../../shared/live-folders';
  import type { SpaceView } from '../../shared/workspaces';

  let {
    tabs,
    listOrder,
    developer,
    activeTabId,
    selectedTabIds,
    splitTabIds,
    splitGroups = [],
    groups,
    slide = 0,
    topInset,
    fullWidth,
    profile,
    tabCleanup = false,
    favorites,
    liveFolders,
    spaces,
    activeSpaceId,
    media,
    pageRect,
    onSplitDrop,
    agents = { waiting: 0, working: 0 },
    updateReady = false,
    downloads = { active: 0, progress: null, started: 0 },
    footerItems = [],
  }: {
    tabs: TabSnapshot[];
    listOrder: TabId[];
    developer: boolean;
    activeTabId: TabId | null;
    selectedTabIds: TabId[];
    splitTabIds: TabId[];
    splitGroups?: TabId[][];
    groups: TabGroup[];
    slide?: number;
    topInset: number;
    fullWidth: number;
    profile: ProfileKind;
    tabCleanup?: boolean;
    favorites: Favorite[];
    liveFolders: LiveFolderView[];
    spaces: SpaceView[];
    activeSpaceId: string;
    media: MediaInfo | null;
    pageRect?: () => DOMRect | undefined;
    onSplitDrop?: (side: SplitSide | null) => void;
    agents?: { waiting: number; working: number };
    updateReady?: boolean;
    downloads?: DownloadsSummary;
    footerItems?: SidebarFooterItem[];
  } = $props();

  type DragGroup = 'pinned' | 'listed';
  type SplitSide = 'left' | 'right';
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

  let press: Press | null = null;
  let pointer = { x: 0, y: 0 };
  let splitSide: SplitSide | null = null;
  let scrollFrame = 0;
  let lists: HTMLElement | undefined = $state();
  let dragId: TabId | null = $state(null);
  let dragGroup: DragGroup | null = $state(null);
  let dragOffset = $state({ x: 0, y: 0 });
  let dropIndex: number | null = $state(null);
  let settleOrder: string | null = $state(null);
  let returningId: TabId | null = $state(null);
  let settleTimer = 0;
  let returnTimer = 0;
  let brokenIcons: Record<string, true> = $state({});
  let folderPress: { name: string; x: number; y: number; dragging: boolean } | null = null;
  let dropFolder: string | null = $state(null);
  let renaming: string | null = $state(null);
  let renameValue = $state('');
  let addingLiveFolder = $state(false);
  const SPACE_SWIPE_COMMIT = 64;
  const SPACE_SWIPE_IDLE_MS = 160;
  const SPACE_SHIFT = 48;
  const SPACE_SETTLE_MS = 300;
  let spaceShift = $state(0);
  let spaceShifting = $state(false);
  let spaceFollowing = $state(false);
  let swipeTotal = 0;
  let swipeCross = 0;
  let swipeAxis: 'x' | 'y' | null = null;
  let swipeLastDx = 0;
  let swipeLocked = false;
  let swipeIdle: ReturnType<typeof setTimeout> | undefined;
  let spaceSettle: ReturnType<typeof setTimeout> | undefined;
  let shownSpaceId: string | undefined;
  let swipedDirection: 1 | -1 | null = null;
  let moreButton: HTMLButtonElement | undefined = $state();

  $effect(() => window.yalqen.onAddLiveFolder(() => (addingLiveFolder = true)));

  function rectOf(element: Element): AnchorRect {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }

  function openSidebarMenu(kind: SidebarMenuKind, from: HTMLElement | undefined = moreButton): void {
    if (!from) return;
    send({
      type: 'open-sidebar-menu',
      kind,
      anchor: rectOf(from),
      ...(footerTools ? { footer: rectOf(footerTools) } : {}),
    });
  }

  const FOOTER_ITEM_TYPE = 'application/x-yalqen-footer-item';
  const FOOTER_SLOT_WIDTH = 35;
  let footerTools: HTMLElement | undefined = $state();
  let draggedFooterItem: SidebarFooterItem | null = null;

  function footerSlot(event: DragEvent): number {
    return footerTools ? Math.floor((event.clientX - footerTools.getBoundingClientRect().left) / FOOTER_SLOT_WIDTH) : 0;
  }

  function setFooterItems(items: SidebarFooterItem[]): void {
    send({ type: 'set-sidebar-footer-items', items });
  }

  function footerButton(item: SidebarFooterItem): {
    icon: IconName;
    label: string;
    popup?: boolean;
    run: (button: HTMLElement) => void;
  } {
    switch (item) {
      case 'history':
        return { icon: 'history', label: t('toolbar.history'), run: () => send({ type: 'open-history' }) };
      case 'bookmarks':
        return {
          icon: 'bookmarks',
          label: t('toolbar.bookmarks'),
          run: () => send({ type: 'toggle-bookmarks-panel' }),
        };
      case 'spaces':
        return {
          icon: 'sidebar',
          label: t('spaces.switcher'),
          popup: true,
          run: (button) => openSidebarMenu('spaces', button),
        };
      case 'downloads':
        return {
          icon: 'download',
          label: t('toolbar.downloads'),
          popup: true,
          run: (button) => openSidebarMenu('downloads', button),
        };
      case 'extensions':
        return {
          icon: 'extensions',
          label: t('toolbar.extensions'),
          popup: true,
          run: (button) => send({ type: 'open-extensions-menu', anchor: rectOf(button) }),
        };
      case 'screenshot':
        return {
          icon: 'screenshot',
          label: t('toolbar.fullPageScreenshot'),
          run: () => send({ type: 'dev-command', id: 'full-page-screenshot' }),
        };
      case 'settings':
        return { icon: 'settings', label: t('toolbar.settings'), run: () => send({ type: 'open-settings' }) };
      case 'profile':
        return {
          icon: 'profile',
          label: t('toolbar.profile'),
          popup: true,
          run: () => send({ type: 'open-profile-menu' }),
        };
    }
  }

  const send = window.yalqen.send;
  const previews = createHoverPreviews(send);
  const selected = $derived(new Set(selectedTabIds));
  const split = $derived(new Set(splitTabIds));

  function selectTab(event: MouseEvent, id: TabId): void {
    if (event.shiftKey) send({ type: 'select-tab', id, mode: 'range' });
    else if (event.metaKey || event.ctrlKey) send({ type: 'select-tab', id, mode: 'toggle' });
    else send({ type: 'activate-tab', id, animate: event.detail > 0 });
  }

  const pinned = $derived(tabs.filter((tab) => tab.pinned));
  const tabsById = $derived(new Map(tabs.map((tab) => [tab.id, tab])));
  const listed = $derived(
    listOrder.map((id) => tabsById.get(id)).filter((tab): tab is TabSnapshot => !!tab && !tab.pinned),
  );
  const idleCount = $derived(
    tabCleanup ? listed.filter((tab) => !tab.live && !tab.isPrivate && tab.id !== activeTabId).length : 0,
  );
  const listedIndex = $derived(new Map(listed.map((tab, index) => [tab.id, index])));
  const mergedSplits = $derived.by(() => {
    const merged = splitGroups.flatMap((group) => {
      const members = group.flatMap((id) => tabsById.get(id) ?? []);
      if (members.length !== group.length || members.some((tab) => !listedIndex.has(tab.id))) return [];
      const head = members.reduce((first, tab) =>
        listedIndex.get(tab.id)! < listedIndex.get(first.id)! ? tab : first,
      );
      return [{ head, members }];
    });
    return {
      heads: new Map(merged.map(({ head, members }) => [head.id, members])),
      hidden: new Set(
        merged.flatMap(({ head, members }) => members.filter((tab) => tab !== head).map((tab) => tab.id)),
      ),
    };
  });
  const orderKey = $derived(tabs.map((tab) => tab.id).join(','));
  const activeSpace = $derived(spaces.find((space) => space.id === activeSpaceId));
  const visibleEntries = $derived(
    listOrder.flatMap((id) => {
      const tab = tabsById.get(id);
      return tab ? [tab] : [];
    }),
  );
  const entriesByGroup = $derived(
    new Map(
      [...new Set(visibleEntries.map((tab) => tab.group || ''))].map((key) => [
        key,
        visibleEntries.filter((tab) => (tab.group || '') === key),
      ]),
    ),
  );
  const groupsByName = $derived(new Map(groups.map((group) => [group.name, group])));
  const sections = $derived(
    [
      { key: 'ungrouped', group: null, depth: 0, entries: entriesByGroup.get('') ?? [] },
      ...groups.flatMap((group) => {
        const ancestors = groupAncestors(group);
        return ancestors.some((ancestor) => ancestor.collapsed)
          ? []
          : [
              {
                key: 'group:' + group.name,
                group,
                depth: ancestors.length,
                entries: entriesByGroup.get(group.name) ?? [],
              },
            ];
      }),
    ].filter((section) => section.entries.length > 0 || (section.group && section.group.count === 0)),
  );

  function groupAncestors(group: TabGroup): TabGroup[] {
    const chain: TabGroup[] = [];
    for (let next = groupsByName.get(group.parent ?? ''); next; next = groupsByName.get(next.parent ?? ''))
      chain.push(next);
    return chain;
  }

  function folderAt(): string | null {
    for (const element of document.elementsFromPoint(pointer.x, pointer.y)) {
      const name = (element as HTMLElement).dataset?.folder;
      if (name) return name;
    }
    return null;
  }

  function canDropFolder(name: string, target: string): boolean {
    const folder = groupsByName.get(name),
      destination = groupsByName.get(target);
    return (
      !!folder &&
      !!destination &&
      folder.parent !== target &&
      !groupAncestors(destination).some((ancestor) => ancestor.name === name) &&
      name !== target
    );
  }

  function onFolderPointerDown(event: PointerEvent, name: string): void {
    if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey) return;
    folderPress = { name, x: event.clientX, y: event.clientY, dragging: false };
  }

  function moveFolderDrag(event: PointerEvent): void {
    if (!folderPress || !event.isPrimary) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!folderPress.dragging && Math.hypot(pointer.x - folderPress.x, pointer.y - folderPress.y) < DRAG_THRESHOLD)
      return;
    folderPress.dragging = true;
    const target = folderAt();
    dropFolder = target && canDropFolder(folderPress.name, target) ? target : null;
  }

  function finishFolderDrag(): void {
    if (folderPress?.dragging) {
      suppressNextClick();
      if (dropFolder) send({ type: 'move-tab-group', name: folderPress.name, parent: dropFolder });
    }
    cancelFolderDrag();
  }

  function cancelFolderDrag(): void {
    folderPress = null;
    dropFolder = null;
  }

  function startRename(name: string): void {
    renaming = name;
    renameValue = name;
  }

  function commitRename(): void {
    if (renaming === null) return;
    const name = renaming;
    renaming = null;
    if (renameValue.trim() && renameValue !== name) send({ type: 'rename-tab-group', name, next: renameValue });
  }

  function shiftSpace(offset: number, following: boolean): void {
    if (reducedMotion.matches) return;
    clearTimeout(spaceSettle);
    spaceShifting = true;
    spaceFollowing = following;
    spaceShift = offset;
    if (!following && offset === 0) spaceSettle = setTimeout(() => (spaceShifting = false), SPACE_SETTLE_MS);
  }

  function switchSpaceBySwipe(event: WheelEvent): void {
    if (spaces.length < 2 || event.ctrlKey) return;
    const dx = Math.abs(event.deltaX);
    // Momentum only slows down, so a sharp rise in horizontal speed is a new swipe, not the old one's tail.
    if ((swipeLocked || swipeAxis === 'y') && dx > 4 && dx > swipeLastDx * 2.5) endSpaceSwipe();
    swipeLastDx = dx;
    clearTimeout(swipeIdle);
    swipeIdle = setTimeout(endSpaceSwipe, SPACE_SWIPE_IDLE_MS);
    if (swipeLocked) return;
    swipeTotal -= event.deltaX;
    swipeCross += Math.abs(event.deltaY);
    if (!swipeAxis) {
      if (Math.abs(swipeTotal) + swipeCross < 8) return;
      swipeAxis = Math.abs(swipeTotal) > swipeCross ? 'x' : 'y';
    }
    if (swipeAxis === 'y') return;
    const direction = swipeTotal < 0 ? 1 : -1;
    if (Math.abs(swipeTotal) >= SPACE_SWIPE_COMMIT) {
      const index = spaces.findIndex((space) => space.id === activeSpaceId);
      swipeLocked = true;
      swipedDirection = direction;
      send({ type: 'switch-space', id: spaces[(index + direction + spaces.length) % spaces.length].id });
      return;
    }
    shiftSpace(swipeTotal * 0.6, true);
  }

  function endSpaceSwipe(): void {
    swipeTotal = 0;
    swipeCross = 0;
    swipeAxis = null;
    swipeLocked = false;
    if (spaceFollowing) shiftSpace(0, false);
  }

  $effect(() => {
    const previous = shownSpaceId;
    shownSpaceId = activeSpaceId;
    if (previous === undefined || previous === activeSpaceId) return;
    const from = spaces.findIndex((space) => space.id === previous);
    const to = spaces.findIndex((space) => space.id === activeSpaceId);
    const direction = swipedDirection ?? (to > from ? 1 : -1);
    swipedDirection = null;
    if (from < 0 || to < 0) return;
    shiftSpace(direction * SPACE_SHIFT, true);
    requestAnimationFrame(() => requestAnimationFrame(() => shiftSpace(0, false)));
  });

  function focusSelect(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reorder(node: Element, { from, to }: { from: DOMRect; to: DOMRect }) {
    return flip(node, { from, to }, { duration: reducedMotion.matches ? 0 : 200, easing: cubicOut });
  }
  const draggingPinned = $derived(dragGroup === 'pinned');
  const draggingListed = $derived(dragGroup === 'listed');

  function favoriteUnread(url: string): boolean {
    try {
      const { host } = new URL(url);
      return tabs.some((tab) => tab.unread && !tab.isPrivate && new URL(tab.url).host === host);
    } catch {
      return false;
    }
  }

  function label(tab: TabSnapshot): string {
    const states = [
      tab.id === activeTabId ? t('tabPanel.stateActive') : null,
      selected.has(tab.id) ? t('tabPanel.stateSelected') : null,
      split.has(tab.id) ? t('tabPanel.stateSplit') : null,
      developer ? t('tabPanel.stateDeveloper') : tab.isPrivate ? t('tabPanel.statePrivate') : null,
      tab.live ? null : t('tabPanel.stateUnloaded'),
      tab.frozen ? t('tabPanel.stateFrozen') : null,
      tab.pinned ? t('tabPanel.statePinned') : null,
      tab.muted ? t('tabPanel.stateMuted') : tab.audible ? t('tabPanel.stateAudible') : null,
      tab.unread ? t('tabPanel.stateUnread') : null,
      ...devStates(tab),
    ].filter(Boolean);
    return states.length > 0 ? `${tab.title} (${states.join(', ')})` : tab.title;
  }

  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }, id: TabId, group: DragGroup): void {
    if (event.button !== 0 || !event.isPrimary || !lists || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (settleOrder !== null) resetDragState();
    press = {
      id,
      group,
      list: event.currentTarget.parentElement!,
      item: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      scrollTop: lists.scrollTop,
      home: event.currentTarget.getBoundingClientRect(),
      dragging: false,
      cancelled: false,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (folderPress) {
      moveFolderDrag(event);
      return;
    }
    if (!press || press.cancelled || !event.isPrimary) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!press.dragging) {
      if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < DRAG_THRESHOLD) return;
      press.dragging = true;
      dragId = press.id;
      dragGroup = press.group;
    }
    track();
    setSplitSide(splitSideAt(), press.id);
    const folder = press.group === 'listed' && !splitSide ? folderAt() : null;
    dropFolder = folder && folder !== tabsById.get(press.id)?.group ? folder : null;
    if (splitSide || dropFolder) dropIndex = null;
    if (scrollSpeed() !== 0 && !scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
  }

  function splitSideAt(): SplitSide | null {
    const page = pageRect?.();
    if (!press || press.id === activeTabId || !page) return null;
    if (pointer.x < page.left || pointer.x > page.right || pointer.y < page.top || pointer.y > page.bottom) return null;
    return pointer.x < page.left + page.width / 2 ? 'left' : 'right';
  }

  function setSplitSide(next: SplitSide | null, id: TabId | null = null): void {
    if (next === splitSide) return;
    splitSide = next;
    send({ type: 'preview-split', id: next ? id : null, side: next ?? 'right' });
    onSplitDrop?.(next);
  }

  function onPointerUp(event: PointerEvent): void {
    if (folderPress) {
      finishFolderDrag();
      return;
    }
    if (!press || !event.isPrimary) return;
    if (press.dragging) {
      suppressNextClick();
      if (!press.cancelled && splitSide) {
        send({ type: 'split-tab', id: press.id, side: splitSide });
        splitSide = null;
        onSplitDrop?.(null);
        endDrag();
        return;
      }
      if (!press.cancelled && dropFolder) {
        send({ type: 'move-tab-to-group', id: press.id, name: dropFolder });
        endDrag();
        return;
      }
      if (!press.cancelled && commitMove(press.id, press.group === 'pinned' ? pinned : listed)) {
        settle();
        return;
      }
      returnHome(press.id);
    }
    endDrag();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && folderPress) {
      cancelFolderDrag();
      return;
    }
    if (event.key === 'Escape' && selectedTabIds.length > 0 && !press?.dragging) {
      send({ type: 'clear-tab-selection' });
      return;
    }
    if (event.key !== 'Escape' || !press?.dragging) return;
    press.cancelled = true;
    resetDragState();
  }

  function track(): void {
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
    dragOffset = {
      x: horizontal ? Math.min(Math.max(pointer.x - press.x, minX), maxX) : 0,
      y: Math.min(Math.max(pointer.y - press.y + scrolled, minY), maxY),
    };
    dropIndex = slotAt(press, horizontal);
  }

  function slotAt(current: Press, horizontal: boolean): number | null {
    let nearest: { index: number; rect: DOMRect } | null = null;
    let nearestDistance = Infinity;
    for (const item of current.list.querySelectorAll<HTMLElement>(':scope > [data-drag-index]')) {
      const rect = item.getBoundingClientRect();
      if (item === current.item) {
        rect.x -= dragOffset.x;
        rect.y -= dragOffset.y;
      }
      const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
      const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { index: Number(item.dataset.dragIndex), rect };
      }
    }
    if (!nearest) return null;
    const { index, rect } = nearest;
    const before = horizontal ? pointer.x < rect.left + rect.width / 2 : pointer.y < rect.top + rect.height / 2;
    const slot = before ? index : index + 1;
    const from = (current.group === 'pinned' ? pinned : listed).findIndex((tab) => tab.id === current.id);
    return slot === from || slot === from + 1 ? null : slot;
  }

  function scrollSpeed(): number {
    if (!lists) return 0;
    const { top, bottom } = lists.getBoundingClientRect();
    if (pointer.y < top + SCROLL_EDGE && lists.scrollTop > 0) return -SCROLL_STEP;
    if (pointer.y > bottom - SCROLL_EDGE && lists.scrollTop + lists.clientHeight < lists.scrollHeight)
      return SCROLL_STEP;
    return 0;
  }

  function autoScroll(): void {
    const speed = press?.dragging && !press.cancelled ? scrollSpeed() : 0;
    if (speed === 0 || !lists) {
      scrollFrame = 0;
      return;
    }
    lists.scrollTop += speed;
    track();
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function commitMove(id: TabId, group: TabSnapshot[]): boolean {
    if (dropIndex === null || !group.some((tab) => tab.id === id)) return false;
    const from = tabs.findIndex((tab) => tab.id === id);
    const before = group[dropIndex];
    const target = before ? tabs.indexOf(before) : tabs.indexOf(group[group.length - 1]) + 1;
    const toIndex = target > from ? target - 1 : target;
    if (toIndex === from) return false;
    send({ type: 'move-tab', id, toIndex });
    return true;
  }

  function settle(): void {
    press = null;
    dropIndex = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    settleOrder = orderKey;
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(resetDragState, 400);
  }

  function returnHome(id: TabId): void {
    returningId = id;
    clearTimeout(returnTimer);
    returnTimer = window.setTimeout(() => (returningId = null), 220);
  }

  function suppressNextClick(): void {
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
  }

  function resetDragState(): void {
    setSplitSide(null);
    dragId = null;
    dragGroup = null;
    dropFolder = null;
    dropIndex = null;
    dragOffset = { x: 0, y: 0 };
    settleOrder = null;
    clearTimeout(settleTimer);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }

  function endDrag(): void {
    cancelFolderDrag();
    press = null;
    resetDragState();
  }

  function dragStyle(id: TabId): string | undefined {
    return id === dragId && (settleOrder === null || settleOrder === orderKey)
      ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
      : undefined;
  }

  $effect(() => {
    if (settleOrder !== null && settleOrder !== orderKey) resetDragState();
  });
</script>

{#snippet favicon(tab: Pick<TabSnapshot, 'faviconUrl'>, size: number, unread = false)}
  <span class="favicon" style:width="{size}px" style:height="{size}px">
    {#if tab.faviconUrl && !brokenIcons[tab.faviconUrl]}
      <img
        src={tab.faviconUrl}
        alt=""
        draggable="false"
        width={size}
        height={size}
        onerror={() => (brokenIcons[tab.faviconUrl!] = true)}
      />
    {:else}
      <Icon name="globe" {size} />
    {/if}
    {#if unread}<span class="unread-dot" aria-hidden="true"></span>{/if}
  </span>
{/snippet}

{#snippet tabRow(tab: TabSnapshot)}
  {@const tabLabel = label(tab)}
  <IconButton
    size="lg"
    variant={tab.id === activeTabId ? 'surface' : 'ghost'}
    class="tab-icon"
    label={tabLabel}
    tabindex={-1}
    aria-pressed={selected.has(tab.id)}
    onclick={(e) => selectTab(e, tab.id)}
    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
  >
    {@render favicon(tab, 16)}
  </IconButton>
  <div class="pill">
    {@render selectButton(tab, tabLabel)}
    {#if tab.unread}<span class="unread-dot trailing" aria-hidden="true"></span>{/if}
    <span class="actions">
      <IconButton
        size="sm"
        tone="muted"
        icon="close"
        label={t('tabPanel.close')}
        title={t('tabPanel.closeTitle')}
        onclick={() => send({ type: 'close-tab', id: tab.id })}
      />
    </span>
  </div>
{/snippet}

{#snippet splitRow(members: TabSnapshot[])}
  <div class="split-row">
    {#each members as member (member.id)}
      <button
        class="split-half"
        class:current={member.id === activeTabId}
        title={member.url}
        aria-label={label(member)}
        aria-current={member.id === activeTabId ? 'page' : undefined}
        onclick={(e) => selectTab(e, member.id)}
        onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: member.id })}
      >
        {@render favicon(member, 16, member.unread)}
        <span class="title">{member.title}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet selectButton(tab: TabSnapshot, tabLabel: string)}
  <button
    class="select"
    title={tab.url}
    aria-label={tabLabel}
    aria-current={tab.id === activeTabId ? 'page' : undefined}
    aria-pressed={selected.has(tab.id)}
    onclick={(e) => selectTab(e, tab.id)}
    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
  >
    <span class="title">{tab.title}</span>
    {#if split.has(tab.id)}<span class="mark" title={t('tabPanel.splitTab')}><Icon name="split" size={13} /></span>{/if}
    {#if developer}<span class="mark" title={t('tabPanel.developerTab')}><Icon name="gauge" size={13} /></span
      >{:else if tab.isPrivate}<span class="mark" title={t('tabPanel.privateTab')}
        ><Icon name="private" size={13} /></span
      >{/if}
  </button>
  {#if tab.audible || tab.muted}
    <IconButton
      size="sm"
      tone="muted"
      icon={tab.muted ? 'muted' : 'sound'}
      class="audio"
      label={tab.muted ? t('tabPanel.unmute') : t('tabPanel.mute')}
      aria-pressed={tab.muted}
      onclick={() => send({ type: 'toggle-mute', id: tab.id })}
    />
  {/if}
{/snippet}

{#snippet sectionBody(section: (typeof sections)[number])}
  {#if section.group}
    {@const group = section.group}
    {#if renaming === group.name}
      <input
        class="group-rename"
        aria-label={t('tabPanel.renameFolder')}
        maxlength="80"
        bind:value={renameValue}
        use:focusSelect
        onblur={commitRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') renaming = null;
          e.stopPropagation();
        }}
      />
    {:else}
      <button
        class="group-heading"
        class:drop-target={dropFolder === group.name}
        data-folder={group.name}
        title={group.name}
        aria-label={`${group.name} (${group.count})`}
        aria-expanded={!group.collapsed}
        onclick={() => send({ type: 'toggle-tab-group', name: group.name })}
        ondblclick={() => startRename(group.name)}
        onpointerdown={(e) => onFolderPointerDown(e, group.name)}
        oncontextmenu={(e) => {
          e.preventDefault();
          send({ type: 'open-folder-menu', name: group.name });
        }}
        onkeydown={(e) => e.key === 'F2' && startRename(group.name)}
      >
        <Icon name="folder" size={15} />
        <span class="folder-name">{group.name}</span>
        <Icon name={group.collapsed ? 'down' : 'up'} size={12} />
        {#if group.collapsed}
          <span class="folder-peek" aria-hidden="true">
            {#each section.entries.slice(0, 3) as tab (tab.id)}{@render favicon(tab, 14)}{/each}
          </span>
          <small>{group.count}</small>
        {/if}
      </button>
    {/if}
  {/if}
  {#if !section.group?.collapsed}
    <ol class="rows">
      {#each section.entries.filter((entry) => !mergedSplits.hidden.has(entry.id)) as tab (tab.id)}
        {@const index = listedIndex.get(tab.id) ?? -1}
        {@const merged = mergedSplits.heads.get(tab.id)}
        <li
          class="row"
          class:private={tab.isPrivate}
          class:active={tab.id === activeTabId || !!merged?.some((member) => member.id === activeTabId)}
          class:selected={selected.has(tab.id)}
          class:discarded={!tab.live}
          class:lifted={index >= 0 && tab.id === dragId}
          class:returning={index >= 0 && tab.id === returningId}
          class:drop-before={index >= 0 && draggingListed && dropIndex === index}
          class:drop-after={index >= 0 &&
            draggingListed &&
            dropIndex === index + 1 &&
            tab.id === section.entries.filter((entry) => !entry.pinned).at(-1)?.id}
          data-drag-index={index >= 0 ? index : undefined}
          data-hover-preview={!tab.isPrivate ? '' : undefined}
          animate:reorder
          style:transform={index >= 0 ? dragStyle(tab.id) : undefined}
          onpointerenter={(e) => !tab.isPrivate && previews.enter(e.currentTarget, tab.id, tab.url)}
          onpointerleave={previews.leave}
          onpointerdown={(e) => index >= 0 && onPointerDown(e, tab.id, 'listed')}
          oncontextmenu={(e) => {
            e.preventDefault();
            send({ type: 'open-tab-menu', id: tab.id });
          }}
        >
          {#if merged}{@render splitRow(merged)}{:else}{@render tabRow(tab)}{/if}
        </li>
      {/each}
    </ol>
  {/if}
{/snippet}

<svelte:window
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={endDrag}
  onkeydown={onKeyDown}
  onblur={endDrag}
/>

<aside
  class="panel card"
  class:dragging={dragId !== null}
  aria-label={t('tabPanel.tabs')}
  onwheel={switchSpaceBySwipe}
  style:--panel-full-width="{fullWidth}px"
>
  <div class="top" style:height="{topInset}px"></div>

  <div class="body" style:transform={slide ? `translateX(${slide}px)` : undefined}>
    <div
      class="lists"
      class:space-shifting={spaceShifting}
      class:space-settling={spaceShifting && !spaceFollowing}
      style:--space-shift="{spaceShift}px"
      style:--space-fade={1 - Math.min(Math.abs(spaceShift) / 120, 0.6)}
      bind:this={lists}
    >
      {#if favorites.length > 0}
        <ul class="favorites global" aria-label={t('tabPanel.favorites')}>
          {#each favorites as favorite (favorite.url)}
            <li
              class="favorite"
              class:active={tabsById.get(activeTabId ?? '')?.url === favorite.url}
              data-hover-preview={previews.has(favorite.url) ? '' : undefined}
              onpointerenter={(e) => previews.enter(e.currentTarget, null, favorite.url)}
              onpointerleave={previews.leave}
              oncontextmenu={(e) => {
                e.preventDefault();
                send({ type: 'open-favorite-menu', url: favorite.url });
              }}
            >
              <IconButton
                size="lg"
                variant="surface"
                class="tile"
                label={favorite.title}
                onclick={() => send({ type: 'open-favorite', url: favorite.url })}
              >
                {@render favicon(favorite, 18, favoriteUnread(favorite.url))}
              </IconButton>
            </li>
          {/each}
        </ul>
      {/if}

      {#if pinned.length > 0}
        <ul class="favorites" aria-label={t('tabPanel.pinned')}>
          {#each pinned as tab, index (tab.id)}
            <li
              class="favorite"
              class:active={tab.id === activeTabId}
              class:selected={selected.has(tab.id)}
              class:discarded={!tab.live}
              class:lifted={tab.id === dragId}
              class:returning={tab.id === returningId}
              class:drop-before={draggingPinned && dropIndex === index}
              class:drop-after={draggingPinned && dropIndex === index + 1 && index === pinned.length - 1}
              data-drag-index={index}
              data-hover-preview={!tab.isPrivate ? '' : undefined}
              animate:reorder
              style:transform={dragStyle(tab.id)}
              onpointerenter={(e) => !tab.isPrivate && previews.enter(e.currentTarget, tab.id, tab.url)}
              onpointerleave={previews.leave}
              onpointerdown={(e) => onPointerDown(e, tab.id, 'pinned')}
              oncontextmenu={(e) => {
                e.preventDefault();
                send({ type: 'open-tab-menu', id: tab.id });
              }}
            >
              <IconButton
                size="lg"
                variant="surface"
                class="tile"
                label={label(tab)}
                aria-current={tab.id === activeTabId ? 'page' : undefined}
                aria-pressed={selected.has(tab.id)}
                onclick={(e) => selectTab(e, tab.id)}
                onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
              >
                {@render favicon(tab, 18, tab.unread)}
                {#if tab.audible && !tab.muted}<span class="audible-dot" aria-hidden="true"></span>{/if}
              </IconButton>
            </li>
          {/each}
        </ul>
      {/if}

      {#if tabCleanup && listed.length > 0}
        <div class="tab-cleanup">
          <span class="cleanup-line" aria-hidden="true"></span>
          <IconButton
            size="sm"
            icon="broom"
            tone="muted"
            class="tab-cleanup-button"
            label={idleCount > 0 ? t('tabPanel.cleanTabs', { count: idleCount }) : t('tabPanel.noTabsToClean')}
            title={idleCount > 0 ? t('tabPanel.cleanTabsTitle', { count: idleCount }) : t('tabPanel.noTabsToClean')}
            aria-disabled={idleCount === 0}
            onclick={() => {
              if (idleCount > 0) send({ type: 'clean-tabs' });
            }}
          >
            <span class="tidy-label">{t('tabPanel.tidy')}</span>
          </IconButton>
        </div>
      {:else if favorites.length > 0 || pinned.length > 0}
        <span class="section-divider" aria-hidden="true"></span>
      {/if}

      {#each sections as section (section.key)}
        {#if section.group}
          <div
            class="folder"
            class:open={!section.group.collapsed}
            style:margin-inline-start={section.depth ? `${section.depth * 12}px` : undefined}
          >
            {@render sectionBody(section)}
          </div>
        {:else}
          {@render sectionBody(section)}
        {/if}
      {/each}

      <div class="new-tab-row">
        <NewTabButton compact={false} />
      </div>
    </div>

    {#if profile !== 'private'}
      <LiveFolders folders={liveFolders} bind:adding={addingLiveFolder} />
    {/if}

    <div class="spacer"></div>

    {#if media}
      <MediaPlayer {media} />
    {/if}

    {#if agents.waiting + agents.working > 0}
      <button
        type="button"
        class="agents"
        class:waiting={agents.waiting > 0}
        onclick={() => send({ type: 'toggle-agent-panel' })}
      >
        <span class="orb" aria-hidden="true"></span>
        {#if agents.waiting > 0}<span class="agents-waiting"
            >{t('tabPanel.agentsWaiting', { count: agents.waiting })}</span
          >{/if}
        <span class="agents-count">{t('tabPanel.agentsWorking', { count: agents.waiting + agents.working })}</span>
        <Icon name="up" size={12} />
      </button>
    {/if}

    {#if updateReady}
      <div class="update-card">
        <Icon name="download" size={16} />
        <span class="update-label">{t('tabPanel.updateReady')}</span>
        <button type="button" class="update-restart" onclick={() => send({ type: 'install-update' })}>
          {t('tabPanel.restart')}
        </button>
      </div>
    {/if}

    {#if spaces.length > 0}
      <div class="spaces">
        {#if profile === 'developer'}
          <button type="button" class="footer-button chats-button" onclick={() => openSidebarMenu('chats')}>
            <Icon name="chats" size={16} />
            <span class="footer-label">{t('sidebarMenu.chats')}</span>
          </button>
        {:else}
          <div
            class="footer-tools"
            role="toolbar"
            tabindex="-1"
            aria-label={t('sidebarMenu.footerTools')}
            bind:this={footerTools}
            ondragover={(e) => {
              if (!draggedFooterItem) return;
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            }}
            ondrop={(e) => {
              if (!draggedFooterItem) return;
              e.preventDefault();
              setFooterItems(placeSidebarFooterItem(footerItems, draggedFooterItem, footerSlot(e)));
              draggedFooterItem = null;
            }}
          >
            {#each footerItems as item (item)}
              {#if item !== 'spaces' || spaces.length > 0}
                {@const button = footerButton(item)}
                <button
                  type="button"
                  class="footer-button tool-button"
                  aria-label={button.label}
                  title={button.label}
                  aria-haspopup={button.popup ? 'dialog' : undefined}
                  disabled={item === 'screenshot' && !activeTabId}
                  draggable="true"
                  ondragstart={(e) => {
                    draggedFooterItem = item;
                    e.dataTransfer?.setData(FOOTER_ITEM_TYPE, item);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                  }}
                  ondragend={(e) => {
                    // Dropped anywhere outside the footer takes the button off it.
                    if (draggedFooterItem === item && e.dataTransfer?.dropEffect === 'none')
                      setFooterItems(footerItems.filter((candidate) => candidate !== item));
                    draggedFooterItem = null;
                  }}
                  onclick={(e) => button.run(e.currentTarget)}
                >
                  {#if item === 'spaces' && activeSpace?.icon}<span class="space-icon">{activeSpace.icon}</span
                    >{:else}<Icon name={button.icon} size={16} />{/if}
                  {#if item === 'downloads' && downloads.active > 0}<span class="download-dot" aria-hidden="true"
                    ></span>{/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
        <button
          bind:this={moreButton}
          type="button"
          class="footer-button more-button"
          aria-label={t('sidebarMenu.more')}
          title={t('sidebarMenu.more')}
          aria-haspopup="dialog"
          onclick={() => openSidebarMenu('tabs')}
        >
          <Icon name="down" size={16} />
          {#if downloads.active > 0 && profile === 'developer'}<span class="download-dot" aria-hidden="true"
            ></span>{/if}
        </button>
      </div>
    {/if}

    {#if selectedTabIds.length > 1}
      <footer class="footer">
        <div
          class="selection"
          aria-label={t('tabPanel.selected', { count: selectedTabIds.length })}
          title={t('tabPanel.selectionHint')}
        >
          <span aria-live="polite">{t('tabPanel.selected', { count: selectedTabIds.length })}</span>
          <IconButton
            icon="close"
            size="sm"
            label={t('window.closeSelectedTabs', { count: selectedTabIds.length })}
            onclick={() => send({ type: 'close-selected-tabs' })}
          />
          <button
            class="clear-selection"
            aria-label={t('tabPanel.clearSelection')}
            onclick={() => send({ type: 'clear-tab-selection' })}>Esc</button
          >
        </div>
      </footer>
    {/if}
  </div>
</aside>

<style>
  .group-heading {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    justify-content: space-between;
    border: 0;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-muted);
    padding: 6px;
    font-size: 12px;
    margin: 6px 0 3px;
  }
  .group-heading.drop-target,
  .group-rename:focus {
    outline: 2px solid var(--accent);
  }
  .group-rename {
    flex: none;
    border: 0;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    padding: 6px;
    font-size: 12px;
    margin: 6px 0 3px;
  }
  .group-heading span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-heading small {
    font-size: 10px;
  }
  .panel {
    position: relative;
    display: flex;
    grid-area: panel;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: 0 6px 8px;
    overflow-x: clip;
  }

  .panel.card .lists {
    padding-top: 4px;
  }

  .top {
    flex: none;
    -webkit-app-region: drag;
  }

  .lists {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .lists.space-shifting > :not(.global) {
    opacity: var(--space-fade);
    transform: translateX(var(--space-shift));
  }

  .lists.space-settling > :not(.global) {
    transition:
      transform 280ms var(--ease-out),
      opacity 280ms var(--ease-out);
  }

  .lists::-webkit-scrollbar {
    display: none;
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    transition: opacity 120ms ease-out;
  }

  .body > :not(.lists, .spaces, .footer),
  .spaces > :global(:not(.panel-toggle)),
  .footer > :global(:not(.panel-toggle)) {
    transition: opacity 120ms ease-out;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    transition:
      gap 160ms var(--ease-out),
      padding 160ms var(--ease-out);
  }

  .favorites:not(.rows) {
    display: grid;
    grid-template-columns: repeat(4, var(--chrome-control-size));
    gap: 6px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }

  .section-divider {
    flex: none;
    height: 1px;
    margin: 0 10px 6px;
    background: var(--page-divider);
  }

  .tab-cleanup {
    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;
    margin: -4px 4px 2px 10px;
  }

  .cleanup-line {
    flex: 1;
    height: 1px;
    background: var(--page-divider);
  }

  .tab-cleanup :global(.tab-cleanup-button[aria-disabled='true']) {
    opacity: 0.4;
  }

  .favorite {
    position: relative;
  }

  .favorite.active :global(.tile) {
    background-color: var(--surface-strong);
    box-shadow:
      var(--shadow),
      inset 0 0 0 1.5px var(--accent);
  }

  .favorite.selected :global(.icon-btn),
  .row.selected .pill {
    box-shadow: inset 0 0 0 1.5px var(--accent);
    background-color: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .selection {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 100%;
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }
  .selection span {
    flex: 1;
  }
  .clear-selection {
    border: 0;
    border-radius: 5px;
    padding: 4px;
    background: var(--surface);
    color: inherit;
    font: inherit;
  }

  .favorite.discarded .favicon {
    opacity: 0.45;
    filter: grayscale(1);
  }

  .audible-dot {
    position: absolute;
    bottom: 3px;
    left: 50%;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--accent);
  }

  .favorite.drop-before::before,
  .favorite.drop-after::after {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .favorite.drop-before::before {
    left: -2px;
  }

  .favorite.drop-after::after {
    right: -2px;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    height: var(--chrome-control-size);
    border-radius: var(--pill-radius, 999px);
    color: var(--text-muted);
    transition:
      background var(--transition),
      color var(--transition);
  }

  .panel.card .row {
    gap: 6px;
  }

  .pill {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    border-radius: var(--pill-radius, 999px);
    transition:
      background var(--transition),
      box-shadow var(--transition);
  }

  .panel:not(.dragging) .row:not(.active):hover .pill {
    background: var(--surface-hover);
  }

  .row:hover {
    color: var(--text);
  }

  .row.active {
    color: var(--text);
  }

  .row.active .pill {
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .row.discarded :global(.tab-icon) {
    opacity: 0.55;
  }

  :global([data-material='glass']) .row.active .pill {
    box-shadow: var(--shadow), var(--rim);
  }

  .card .favorites:not(.rows) {
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 6px;
  }

  .card .favorites:not(.rows) :global(.tile) {
    width: 100%;
    height: 41px;
    border-radius: 10px;
    background: var(--card-tile);
    box-shadow: none;
  }

  .card .favorites:not(.rows) :global(.tile:hover) {
    background: var(--surface-hover);
  }

  .card .favorite.active :global(.tile) {
    background: var(--card-active);
    box-shadow: var(--card-shadow);
  }

  .panel.card .rows {
    gap: 5px;
  }

  .panel.card .row {
    gap: 0;
    height: 36px;
    border-radius: 10px;
  }

  .panel.card .row :global(.tab-icon),
  .panel.card .row .pill {
    background: transparent;
    box-shadow: none;
  }

  .panel.card:not(.dragging) .row:not(.active):hover .pill {
    background: transparent;
  }

  .panel.card .body {
    width: calc(var(--panel-full-width) - 12px);
  }

  .panel.card .select {
    padding-left: 0;
    font-size: 13px;
    font-weight: 500;
  }

  .panel.card .row,
  .panel.card .row.discarded .title {
    color: var(--text);
    opacity: 1;
  }

  .panel.card .row .favicon,
  .panel.card .row.discarded .favicon img,
  .panel.card .row.discarded .favicon > :global(svg),
  .panel.card .row.discarded :global(.tab-icon),
  .panel.card .favorite.discarded .favicon {
    opacity: 1;
    filter: none;
  }

  .card:not(.dragging) .row:not(.active):hover {
    background: var(--surface-hover);
  }

  .panel.card .row.active {
    background: var(--card-active);
    box-shadow: var(--card-shadow);
  }

  .panel.card .row.selected {
    box-shadow: inset 0 0 0 1.5px var(--accent);
    background-color: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .folder {
    flex: none;
    margin: 4px 0;
    padding: 2px 4px 4px;
    border-radius: 12px;
    background: var(--card-tile);
  }

  .folder:not(.open) {
    padding-bottom: 2px;
  }

  .folder .group-heading {
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 8px 6px;
    background: transparent;
    color: var(--text);
    font-size: 14px;
  }

  .folder .folder-name {
    flex: 0 1 auto;
  }

  .folder-peek {
    display: flex;
    gap: 3px;
    margin-left: auto;
  }

  .folder .group-heading small {
    color: var(--text-muted);
    font-size: 13px;
  }

  .unread-dot.trailing {
    position: static;
    flex: none;
    width: 6px;
    height: 6px;
    margin: 0 10px;
    background: var(--text-muted);
    box-shadow: none;
  }

  .tab-cleanup :global(.tab-cleanup-button:has(.tidy-label)) {
    width: auto;
    gap: 4px;
    padding: 0 6px;
  }

  .tidy-label {
    font-size: 13px;
  }

  .agents {
    --agents-gold: light-dark(#8a5a00, #e6c278);
    display: flex;
    flex: none;
    align-items: center;
    gap: 9px;
    height: 32px;
    margin-top: 8px;
    padding: 0 12px 0 8px;
    white-space: nowrap;
    border: 0;
    border-radius: 999px;
    background: var(--card-tile);
    color: color-mix(in srgb, var(--agents-gold) 75%, transparent);
    font-size: 14px;
  }

  .agents.waiting {
    background: color-mix(in srgb, var(--agents-gold) 12%, var(--card-tile));
  }

  .agents:hover {
    background: var(--surface-hover);
  }

  .agents-waiting {
    color: var(--agents-gold);
  }

  .agents-count {
    margin-left: auto;
  }

  .orb {
    --orb-light: light-dark(#7a6a40, #f4e2b0);
    --orb-dark: light-dark(#3a3020, #6b5a30);
    display: block;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--orb-light), var(--orb-dark) 75%);
    mask: radial-gradient(circle, #000 0.85px, transparent 1.1px) 0 0 / 2.4px 2.4px;
  }

  .update-card {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 32px;
    margin-top: 5px;
    padding: 0 4px 0 11px;
    border-radius: 16px;
    background: var(--card-tile);
    color: var(--text-muted);
  }

  .update-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .update-restart {
    flex: none;
    height: 24px;
    padding: 0 11px;
    border: 0;
    border-radius: 999px;
    background: light-dark(#1d1d22, #f4f4f5);
    color: light-dark(#ffffff, #18181b);
    font-size: 13px;
    font-weight: 500;
  }

  .update-restart:hover {
    background: light-dark(#34343b, #ffffff);
  }

  .download-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: light-dark(#b07a00, #e6c278);
  }

  .footer-button {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 35px;
    padding: 0 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
  }

  .footer-button:hover {
    background: var(--card-tile);
    color: var(--text);
  }

  .chats-button {
    flex: 1;
    min-width: 0;
  }

  .footer-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more-button {
    position: relative;
    flex: none;
    justify-content: center;
    width: 35px;
    padding: 0;
  }

  .footer-tools {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .tool-button {
    position: relative;
    justify-content: center;
    width: 35px;
    padding: 0;
  }

  .tool-button:disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .space-icon {
    font-size: 15px;
    line-height: 1;
  }

  .split-row {
    display: flex;
    flex: 1;
    gap: 2px;
    min-width: 0;
    height: 100%;
  }

  .split-half {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 0 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font-size: 14px;
    text-align: left;
  }

  .split-half .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card .section-divider {
    display: none;
  }

  .card .spaces :global(.icon-btn.surface),
  .card .footer :global(.icon-btn.surface) {
    background: transparent;
    box-shadow: none;
  }

  .new-tab-row {
    flex: none;
    margin-top: 4px;
  }

  .new-tab-row :global(.btn.new-tab-wide) {
    height: 36px;
    gap: 9px;
    padding-left: 9px;
    border-radius: var(--pill-radius, 999px);
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
  }

  .new-tab-row :global(.btn.new-tab-wide:hover) {
    background: var(--surface-hover);
    color: var(--text);
  }

  .row:not(.active) .favicon {
    opacity: 0.7;
  }

  .select {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    height: 100%;
    padding: 0 6px 0 10px;
    border: 0;
    border-radius: var(--pill-radius, 999px);
    background: transparent;
    color: inherit;
    font-size: var(--font-size);
    text-align: left;
  }

  .favicon {
    display: grid;
    flex: none;
    place-items: center;
    color: var(--text-muted);
  }

  .favicon img {
    width: 100%;
    height: 100%;
    border-radius: 4px;
  }

  .favicon {
    position: relative;
  }

  .unread-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--surface-strong);
    pointer-events: none;
  }

  .row.discarded .favicon img,
  .row.discarded .favicon > :global(svg) {
    opacity: 0.45;
    filter: grayscale(1);
  }

  .row.discarded .title {
    opacity: 0.7;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row.private .title {
    font-style: italic;
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    margin-left: auto;
    color: var(--text-muted);
  }
  .mark + .mark {
    margin-left: 4px;
  }

  .actions {
    display: flex;
    padding-right: 4px;
  }

  .row:not(:hover, :focus-within) .actions {
    display: none;
  }

  .row:not(:hover, :focus-within) :global(.audio) {
    margin-right: 4px;
  }

  .dragging,
  .dragging :global(*) {
    cursor: grabbing;
  }

  .lifted {
    z-index: 1;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    .returning {
      transition: transform 200ms var(--ease-out);
    }
  }

  .row.lifted .pill,
  .row.lifted :global(.tab-icon) {
    background: linear-gradient(var(--surface), var(--surface)), var(--page);
    box-shadow: var(--shadow);
  }

  .row.lifted .actions {
    display: none;
  }

  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    right: 10px;
    left: 10px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .row.drop-before::before {
    top: -2px;
  }

  .row.drop-after::after {
    bottom: -2px;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    flex: none;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--chrome-control-size);
    margin-top: auto;
    gap: 2px;
    padding-top: 8px;
  }

  .spacer {
    flex: 1;
  }

  .spaces {
    display: flex;
    flex: none;
    align-items: center;
    padding-top: 8px;
  }
</style>
