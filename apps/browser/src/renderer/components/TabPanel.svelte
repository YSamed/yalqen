<script lang="ts">
  import type { PanelSide, PinnedDisplay, ProfileKind, TabId, TabSnapshot } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { cubicOut } from 'svelte/easing';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { devStates } from '../format';
  import Icon from './Icon.svelte';
  import NewTabButton from './NewTabButton.svelte';
  import IconButton from './ui/IconButton.svelte';

  let {
    tabs,
    listOrder,
    developer,
    activeTabId,
    collapsed,
    fading,
    side,
    topInset,
    rowInset,
    edgeInset,
    fullWidth,
    profile,
    pinnedDisplay,
  }: {
    tabs: TabSnapshot[];
    listOrder: TabId[];
    developer: boolean;
    activeTabId: TabId | null;
    collapsed: boolean;
    fading: boolean;
    side: PanelSide;
    topInset: number;
    rowInset: number;
    edgeInset: number;
    fullWidth: number;
    profile: ProfileKind;
    pinnedDisplay: PinnedDisplay;
  } = $props();

  type DragGroup = 'pinned' | 'listed';
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

  const send = window.yalqen.send;

  const pinned = $derived(tabs.filter((tab) => tab.pinned));
  const listed = $derived(tabs.filter((tab) => !tab.pinned));
  const listedIndex = $derived(new Map(listed.map((tab, index) => [tab.id, index])));
  const orderKey = $derived(tabs.map((tab) => tab.id).join(','));
  const tabsById = $derived(new Map(tabs.map((tab) => [tab.id, tab])));
  const showPinned = $derived(pinnedDisplay === 'always' || (pinnedDisplay === 'expanded' && !collapsed));
  const entries = $derived(
    listOrder
      .map((id) => tabsById.get(id))
      .filter((tab): tab is TabSnapshot => tab !== undefined && (!showPinned || !collapsed || !tab.pinned)),
  );
  const profiles: { id: ProfileKind; name: string }[] = [
    { id: 'personal', name: t('tabPanel.profilePersonal') },
    { id: 'developer', name: t('tabPanel.profileDeveloper') },
    { id: 'private', name: t('tabPanel.profilePrivate') },
  ];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reveal(node: Element) {
    return fly(node, {
      x: side === 'left' ? -8 : 8,
      duration: reducedMotion.matches ? 0 : 160,
      easing: cubicOut,
    });
  }
  function reorder(node: Element, { from, to }: { from: DOMRect; to: DOMRect }) {
    return flip(node, { from, to }, { duration: reducedMotion.matches ? 0 : 200, easing: cubicOut });
  }
  const draggingPinned = $derived(dragGroup === 'pinned');
  const draggingListed = $derived(dragGroup === 'listed');

  function label(tab: TabSnapshot): string {
    const states = [
      tab.id === activeTabId ? t('tabPanel.stateActive') : null,
      developer ? t('tabPanel.stateDeveloper') : tab.isPrivate ? t('tabPanel.statePrivate') : null,
      tab.live ? null : t('tabPanel.stateUnloaded'),
      tab.frozen ? t('tabPanel.stateFrozen') : null,
      tab.pinned ? t('tabPanel.statePinned') : null,
      tab.muted ? t('tabPanel.stateMuted') : tab.audible ? t('tabPanel.stateAudible') : null,
      ...devStates(tab),
    ].filter(Boolean);
    return states.length > 0 ? `${tab.title} (${states.join(', ')})` : tab.title;
  }

  // Pointer events instead of HTML drag and drop, so reordering does not depend on the
  // native macOS drag session inside the transparent glass window.
  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }, id: TabId, group: DragGroup): void {
    if (event.button !== 0 || !event.isPrimary || !lists) return;
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
    if (!press || press.cancelled || !event.isPrimary) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!press.dragging) {
      if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < DRAG_THRESHOLD) return;
      press.dragging = true;
      dragId = press.id;
      dragGroup = press.group;
    }
    track();
    if (scrollSpeed() !== 0 && !scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!press || !event.isPrimary) return;
    if (press.dragging) {
      suppressNextClick();
      if (!press.cancelled && commitMove(press.id, press.group === 'pinned' ? pinned : listed)) {
        settle();
        return;
      }
      returnHome(press.id);
    }
    endDrag();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !press?.dragging) return;
    press.cancelled = true;
    resetDragState();
  }

  function track(): void {
    if (!press || !lists) return;
    const horizontal = press.group === 'pinned' && !collapsed;
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

  // The dropped row stays where it was released until the new order arrives, so the reorder
  // animates from the release point instead of snapping back first.
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

  // The release lands on a row button, which would otherwise activate the tab that was just dropped.
  function suppressNextClick(): void {
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
  }

  function resetDragState(): void {
    dragId = null;
    dragGroup = null;
    dropIndex = null;
    dragOffset = { x: 0, y: 0 };
    settleOrder = null;
    clearTimeout(settleTimer);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }

  function endDrag(): void {
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

{#snippet favicon(tab: TabSnapshot, size: number)}
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
  </span>
{/snippet}

{#snippet compactTab(tab: TabSnapshot)}
  <IconButton
    size="lg"
    variant={tab.id === activeTabId ? 'surface' : 'ghost'}
    label={label(tab)}
    aria-current={tab.id === activeTabId ? 'page' : undefined}
    onclick={() => send({ type: 'activate-tab', id: tab.id })}
    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
  >
    {@render favicon(tab, 16)}
  </IconButton>
{/snippet}

{#snippet tabRow(tab: TabSnapshot)}
  {@const tabLabel = label(tab)}
  <IconButton
    size="lg"
    variant={tab.id === activeTabId ? 'surface' : 'ghost'}
    class="tab-icon"
    label={tabLabel}
    tabindex={-1}
    onclick={() => send({ type: 'activate-tab', id: tab.id })}
    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
  >
    {@render favicon(tab, 16)}
  </IconButton>
  <div class="pill">
    {@render selectButton(tab, tabLabel)}
    <span class="actions">
      <IconButton
        size="sm"
        tone="muted"
        icon="close"
        label={t('tabPanel.close')}
        onclick={() => send({ type: 'close-tab', id: tab.id })}
      />
    </span>
  </div>
{/snippet}

{#snippet selectButton(tab: TabSnapshot, tabLabel: string)}
  <button
    class="select"
    title={tab.url}
    aria-label={tabLabel}
    aria-current={tab.id === activeTabId ? 'page' : undefined}
    onclick={() => send({ type: 'activate-tab', id: tab.id })}
    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
  >
    <span class="title">{tab.title}</span>
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

<svelte:window
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={endDrag}
  onkeydown={onKeyDown}
  onblur={endDrag}
/>

<aside
  class="panel"
  class:collapsed
  class:dragging={dragId !== null}
  class:fading
  class:right={side === 'right'}
  aria-label={t('tabPanel.tabs')}
  style={`--panel-row-inset: ${rowInset}px; --panel-edge-inset: ${edgeInset}px; --panel-full-width: ${fullWidth}px`}
>
  <div class="top" style:height="{topInset}px"></div>

  {#key collapsed}
    <div class="body" in:reveal>
      <div class="lists" bind:this={lists}>
        {#if showPinned && pinned.length > 0}
          <ul class="favorites" class:rows={collapsed} aria-label={t('tabPanel.pinned')}>
            {#each pinned as tab, index (tab.id)}
              <li
                class="favorite"
                class:active={tab.id === activeTabId}
                class:discarded={!tab.live}
                class:lifted={tab.id === dragId}
                class:returning={tab.id === returningId}
                class:drop-before={draggingPinned && dropIndex === index}
                class:drop-after={draggingPinned && dropIndex === index + 1 && index === pinned.length - 1}
                data-drag-index={index}
                animate:reorder
                style:transform={dragStyle(tab.id)}
                onpointerdown={(e) => onPointerDown(e, tab.id, 'pinned')}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  send({ type: 'open-tab-menu', id: tab.id });
                }}
              >
                {#if collapsed}
                  {@render compactTab(tab)}
                {:else}
                  <IconButton
                    size="lg"
                    variant="surface"
                    class="tile"
                    label={label(tab)}
                    aria-current={tab.id === activeTabId ? 'page' : undefined}
                    onclick={() => send({ type: 'activate-tab', id: tab.id })}
                    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
                  >
                    {@render favicon(tab, 16)}
                    {#if tab.audible && !tab.muted}<span class="audible-dot" aria-hidden="true"></span>{/if}
                  </IconButton>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if showPinned && collapsed && pinned.length > 0 && listed.length > 0}
          <span class="divider" aria-hidden="true"></span>
        {/if}

        {#if entries.length > 0}
          <ol class="rows">
            {#each entries as tab (tab.id)}
              {@const index = listedIndex.get(tab.id) ?? -1}
              <li
                class="row"
                class:private={tab.isPrivate}
                class:active={tab.id === activeTabId}
                class:discarded={!tab.live}
                class:lifted={index >= 0 && tab.id === dragId}
                class:returning={index >= 0 && tab.id === returningId}
                class:drop-before={index >= 0 && draggingListed && dropIndex === index}
                class:drop-after={index >= 0 &&
                  draggingListed &&
                  dropIndex === index + 1 &&
                  index === listed.length - 1}
                data-drag-index={index >= 0 ? index : undefined}
                animate:reorder
                style:transform={index >= 0 ? dragStyle(tab.id) : undefined}
                onpointerdown={(e) => index >= 0 && onPointerDown(e, tab.id, 'listed')}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  send({ type: 'open-tab-menu', id: tab.id });
                }}
              >
                {#if collapsed}
                  {@render compactTab(tab)}
                {:else}
                  {@render tabRow(tab)}
                {/if}
              </li>
            {/each}
          </ol>
        {/if}

        {#if collapsed}
          <div class="new-tab-position">
            <NewTabButton />
          </div>
        {/if}
      </div>

      <footer class="footer" class:compact={collapsed}>
        <div class="profiles" role="group" aria-label={t('tabPanel.profiles')}>
          {#each profiles as item (item.id)}
            <button
              class="profile {item.id}"
              aria-pressed={item.id === profile}
              aria-label={t('tabPanel.profileLabel', { name: item.name })}
              title={item.id === profile
                ? t('tabPanel.profileCurrent', { name: item.name })
                : t('tabPanel.profileSwitch', { name: item.name })}
              onclick={() => send({ type: 'switch-profile', profile: item.id })}
            >
              <Icon name={item.id === 'developer' ? 'code' : item.id === 'private' ? 'private' : 'profile'} size={14} />
            </button>
          {/each}
        </div>
        <IconButton
          size="lg"
          variant="surface"
          tone="muted"
          icon={side === 'left'
            ? collapsed
              ? 'panel-expand'
              : 'panel-close'
            : collapsed
              ? 'panel-expand-right'
              : 'panel-close-right'}
          label={collapsed ? t('tabPanel.expandSidebar') : t('tabPanel.collapseSidebar')}
          title={collapsed ? t('tabPanel.expandSidebarTitle') : t('tabPanel.collapseSidebarTitle')}
          aria-expanded={!collapsed}
          onclick={() => send({ type: 'toggle-panel' })}
        />
      </footer>
    </div>
  {/key}
</aside>

<style>
  .panel {
    position: relative;
    display: flex;
    grid-area: panel;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: 0 var(--panel-row-inset) 8px var(--panel-edge-inset);
    overflow-x: clip;
  }

  .panel.right {
    padding: 0 var(--panel-edge-inset) 8px var(--panel-row-inset);
  }

  .panel:not(.collapsed) .lists {
    padding-top: 4px;
  }

  .panel.collapsed {
    align-items: center;
    padding: 0 0 8px;
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

  .lists::-webkit-scrollbar {
    display: none;
  }

  .collapsed .lists {
    align-items: center;
    width: 100%;
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    transition: opacity 120ms ease-out;
  }

  .collapsed .body {
    align-items: center;
    width: 100%;
  }

  .fading .body {
    opacity: 0;
  }

  /* Expanded rows keep their full width while the panel animates, so they are uncovered
     instead of squeezed into whatever width the panel has reached. */
  .panel:not(.collapsed) .body {
    width: calc(var(--panel-full-width) - var(--panel-row-inset) - var(--panel-edge-inset));
  }

  .panel.right:not(.collapsed) .body {
    align-self: flex-end;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .collapsed .rows {
    gap: 6px;
    padding: 4px 0;
  }

  .favorites:not(.rows) {
    display: grid;
    grid-template-columns: repeat(4, var(--chrome-control-size));
    gap: 6px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }

  .divider {
    width: 16px;
    height: 1px;
    margin: 4px 0;
    background: var(--page-divider);
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

  .favorite:not(.active) .favicon {
    opacity: 0.7;
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

  .collapsed .favorite.drop-before::before,
  .collapsed .favorite.drop-after::after {
    top: auto;
    bottom: auto;
    right: 6px;
    left: 6px;
    width: auto;
    height: 2px;
  }

  .collapsed .favorite.drop-before::before {
    top: -4px;
  }

  .collapsed .favorite.drop-after::after {
    bottom: -4px;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    height: var(--chrome-control-size);
    border-radius: 999px;
    color: var(--text-muted);
    transition:
      background var(--transition),
      color var(--transition);
  }

  .collapsed .row {
    height: auto;
  }

  .panel:not(.collapsed) .row {
    gap: 6px;
  }

  .pill {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    border-radius: 999px;
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
    border-radius: 999px;
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

  /* Glass surfaces are translucent; backing them with the page color keeps covered rows from showing through. */
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

  .new-tab-position {
    flex: none;
    margin-top: 6px;
  }

  .footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--chrome-control-size);
    margin-top: auto;
    gap: 2px;
    padding-top: 8px;
  }

  .footer.compact {
    flex-direction: column;
    gap: 6px;
    padding: 8px 0 0;
  }

  .profiles {
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--chrome-control-size);
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  :global([data-material='glass']) .profiles {
    box-shadow: var(--shadow), var(--rim);
  }

  .compact .profiles {
    flex-direction: column;
    width: var(--chrome-control-size);
    height: auto;
  }

  .profile {
    --profile-color: var(--accent);
    display: grid;
    flex: none;
    place-items: center;
    width: var(--control-md);
    height: var(--control-md);
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    transition:
      background var(--transition),
      color var(--transition);
  }

  .profile.developer {
    --profile-color: var(--profile-developer);
  }

  .profile.private {
    --profile-color: var(--text);
  }

  .profile:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .profile[aria-pressed='true'] {
    background: color-mix(in srgb, var(--profile-color) 18%, transparent);
    color: var(--profile-color);
    cursor: default;
  }
</style>
