<script lang="ts">
  import type { PanelSide, PendingUpdate, ProfileKind, TabId, TabSnapshot } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { cubicOut } from 'svelte/easing';
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
    shrinking,
    side,
    topInset,
    rowInset,
    edgeInset,
    fullWidth,
    pendingUpdate,
    profile,
  }: {
    tabs: TabSnapshot[];
    listOrder: TabId[];
    developer: boolean;
    activeTabId: TabId | null;
    collapsed: boolean;
    shrinking: boolean;
    side: PanelSide;
    topInset: number;
    rowInset: number;
    edgeInset: number;
    fullWidth: number;
    pendingUpdate: PendingUpdate | null;
    profile: ProfileKind;
  } = $props();

  let dragId: TabId | null = $state(null);
  let dropIndex: number | null = $state(null);
  let brokenIcons: Record<string, true> = $state({});

  const send = window.yalqen.send;

  const pinned = $derived(tabs.filter((tab) => tab.pinned));
  const listed = $derived(tabs.filter((tab) => !tab.pinned));
  const tabsById = $derived(new Map(tabs.map((tab) => [tab.id, tab])));
  const entries = $derived(
    listOrder
      .map((id) => tabsById.get(id))
      .filter((tab): tab is TabSnapshot => tab !== undefined && (!collapsed || !tab.pinned)),
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
      duration: reducedMotion.matches ? 0 : 220,
      easing: cubicOut,
    });
  }
  const draggingPinned = $derived(pinned.some((tab) => tab.id === dragId));

  function openUpdatePopup(event: MouseEvent & { currentTarget: HTMLElement }): void {
    const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
    send({ type: 'open-update-popup', anchor: { x, y, width, height } });
  }

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

  function onDragOver(event: DragEvent, group: TabSnapshot[], index: number, horizontal = false): void {
    if (!group.some((tab) => tab.id === dragId)) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const before = horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2;
    dropIndex = before ? index : index + 1;
  }

  function onDrop(event: DragEvent, group: TabSnapshot[]): void {
    event.preventDefault();
    if (dragId && dropIndex !== null && group.some((tab) => tab.id === dragId)) {
      const from = tabs.findIndex((tab) => tab.id === dragId);
      const before = group[dropIndex];
      const target = before ? tabs.indexOf(before) : tabs.indexOf(group[group.length - 1]) + 1;
      const toIndex = target > from ? target - 1 : target;
      if (toIndex !== from) send({ type: 'move-tab', id: dragId, toIndex });
    }
    endDrag();
  }

  function endDrag(): void {
    dragId = null;
    dropIndex = null;
  }
</script>

{#snippet favicon(tab: TabSnapshot, size: number)}
  <span class="favicon" style:width="{size}px" style:height="{size}px">
    {#if tab.faviconUrl && !brokenIcons[tab.faviconUrl]}
      <img
        src={tab.faviconUrl}
        alt=""
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
  <IconButton
    size="lg"
    variant={tab.id === activeTabId ? 'surface' : 'ghost'}
    class="tab-icon"
    label={label(tab)}
    tabindex={-1}
    onclick={() => send({ type: 'activate-tab', id: tab.id })}
    onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
  >
    {@render favicon(tab, 16)}
  </IconButton>
  <div class="pill">
    {@render selectButton(tab)}
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

{#snippet selectButton(tab: TabSnapshot)}
  <button
    class="select"
    title={tab.url}
    aria-label={label(tab)}
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

<aside
  class="panel"
  class:collapsed
  class:shrinking
  class:right={side === 'right'}
  aria-label={t('tabPanel.tabs')}
  style={`--panel-row-inset: ${rowInset}px; --panel-edge-inset: ${edgeInset}px; --panel-full-width: ${fullWidth}px`}
>
  <div class="top" style:height="{topInset}px"></div>

  {#key collapsed}
    <div class="body" in:reveal>
      <div class="lists">
        {#if pinned.length > 0}
          <ul
            class="favorites"
            class:rows={collapsed}
            aria-label={t('tabPanel.pinned')}
            ondrop={(e) => onDrop(e, pinned)}
            ondragover={(e) => draggingPinned && e.preventDefault()}
          >
            {#each pinned as tab, index (tab.id)}
              <li
                class="favorite"
                class:active={tab.id === activeTabId}
                class:discarded={!tab.live}
                class:drop-before={draggingPinned && dropIndex === index}
                class:drop-after={draggingPinned && dropIndex === index + 1 && index === pinned.length - 1}
                draggable="true"
                ondragstart={() => (dragId = tab.id)}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  send({ type: 'open-tab-menu', id: tab.id });
                }}
                ondragend={endDrag}
                ondragover={(e) => onDragOver(e, pinned, index, !collapsed)}
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

        {#if collapsed && pinned.length > 0 && listed.length > 0}
          <span class="divider" aria-hidden="true"></span>
        {/if}

        {#if entries.length > 0}
          <ol
            class="rows"
            ondrop={(e) => onDrop(e, listed)}
            ondragover={(e) => dragId && !draggingPinned && e.preventDefault()}
          >
            {#each entries as tab (tab.id)}
              {@const index = listed.indexOf(tab)}
              <li
                class="row"
                class:private={tab.isPrivate}
                class:active={tab.id === activeTabId}
                class:discarded={!tab.live}
                class:drop-before={index >= 0 && !draggingPinned && dropIndex === index}
                class:drop-after={index >= 0 &&
                  !draggingPinned &&
                  dropIndex === index + 1 &&
                  index === listed.length - 1}
                draggable={index >= 0}
                ondragstart={() => (dragId = tab.id)}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  send({ type: 'open-tab-menu', id: tab.id });
                }}
                ondragend={endDrag}
                ondragover={(e) => index >= 0 && onDragOver(e, listed, index)}
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

      {#if !collapsed && pendingUpdate}
        {#if pendingUpdate.state === 'ready'}
          <button class="card" onclick={openUpdatePopup}>
            <span class="card-line">
              <Icon name="sparkle" size={15} />
              <span class="card-title">{t('tabPanel.updateReady', { version: pendingUpdate.version })}</span>
              <span class="card-action">{t('tabPanel.update')}</span>
            </span>
          </button>
        {:else}
          <button class="card" onclick={() => send({ type: 'open-settings' })}>
            <span class="card-line">
              <Icon name="update" size={15} />
              <span class="card-title">{t('tabPanel.updateDownloading')}</span>
              <span class="card-meta">{t('tabPanel.percent', { percent: pendingUpdate.percent })}</span>
            </span>
            <span class="meter"><span style:width="{Math.max(4, pendingUpdate.percent)}%"></span></span>
          </button>
        {/if}
      {/if}

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

  .shrinking .body {
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

  .divider {
    width: 16px;
    height: 1px;
    margin: 4px 0;
    background: var(--page-divider);
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

  .row:not(.active):hover .pill {
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

  :global([data-material='glass']) .row.active .pill,
  :global([data-material='glass']) .card {
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

  .card {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-top: auto;
    padding: 10px 12px;
    border: 0;
    border-radius: var(--panel-radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    text-align: left;
  }

  .card-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .card-line > :global(svg) {
    flex: none;
    color: var(--text-muted);
  }

  .card-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-meta {
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
  }

  .card-action {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--font-size-small);
  }

  .meter {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--well);
  }

  .meter > span {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: 999px;
    background: var(--accent);
    transition: width 300ms var(--ease-out);
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

  .card + .footer {
    margin-top: 8px;
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
