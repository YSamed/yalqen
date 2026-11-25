<script lang="ts">
  import { onDestroy } from 'svelte';
  import type {
    DownloadsSummary,
    Favorite,
    ProfileKind,
    SidebarFooterItem,
    TabId,
    TabSnapshot,
  } from '../../shared/types';
  import type { MediaInfo } from '../../shared/sidebar-widgets';
  import { t } from '../../shared/i18n';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';
  import SidebarFooter from './SidebarFooter.svelte';
  import { SpaceSwipe } from './space-swipe.svelte';
  import { TabDrag, type SplitSide } from './tab-drag.svelte';
  import { flip } from 'svelte/animate';
  import { devStates } from './format';
  import Icon from '../ui/Icon.svelte';
  import NewTabButton from './NewTabButton.svelte';
  import MediaPlayer from './MediaPlayer.svelte';
  import LiveFolders from './LiveFolders.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { createHoverPreviews } from './hover-previews';
  import type { TabGroup } from '../../shared/tab-groups';
  import type { LiveFolderView } from '../../shared/live-folders';
  import type { SpaceView } from '../../shared/workspaces';
  import type { LiveFolderKind } from '../../shared/live-folders';
  import { hostOf } from '../../shared/hosts';

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

  let brokenIcons: Record<string, true> = $state({});
  let renaming: string | null = $state(null);
  let renameValue = $state('');
  let addingLiveFolder = $state(false);

  let liveFolderKind = $state<LiveFolderKind>('feed');
  $effect(() =>
    window.yalqen.onAddLiveFolder((kind) => {
      if (kind) liveFolderKind = kind;
      addingLiveFolder = true;
    }),
  );

  const send = window.yalqen.send;
  const previews = createHoverPreviews(send);
  onDestroy(previews.dismiss);
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
  const mergedSplits = $derived.by(() => {
    const shownIndex = new Map(listOrder.map((id, index) => [id, index]));
    const merged = splitGroups.flatMap((group) => {
      const members = group.flatMap((id) => tabsById.get(id) ?? []);
      const shown = members.filter((tab) => shownIndex.has(tab.id));
      if (members.length < 2 || shown.length === 0) return [];
      const head = shown.reduce((first, tab) => (shownIndex.get(tab.id)! < shownIndex.get(first.id)! ? tab : first));
      return [{ head, members }];
    });
    return {
      heads: new Map(merged.map(({ head, members }) => [head.id, members])),
      hidden: new Set(
        merged.flatMap(({ head, members }) => members.filter((tab) => tab !== head).map((tab) => tab.id)),
      ),
    };
  });
  const orderKey = $derived(`${tabs.map((tab) => tab.id).join(',')}|${listOrder.join(',')}`);
  const visibleEntries = $derived(
    listOrder.flatMap((id) => {
      const tab = tabsById.get(id);
      return tab ? [tab] : [];
    }),
  );
  const entriesByGroup = $derived(Map.groupBy(visibleEntries, (tab) => tab.group || ''));
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

  const spaceSwipe = new SpaceSwipe((id) => send({ type: 'switch-space', id }));
  $effect(() => spaceSwipe.showSpace(activeSpaceId, spaces));

  function focusSelect(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  function reorder(node: Element, { from, to }: { from: DOMRect; to: DOMRect }) {
    return flip(node, { from, to }, { duration: prefersReducedMotion.current ? 0 : 200, easing: cubicOut });
  }
  const drag = new TabDrag({
    tabs: () => tabs,
    pinned: () => pinned,
    listed: () => listed,
    orderKey: () => orderKey,
    activeTabId: () => activeTabId,
    groupOf: (id) => tabsById.get(id)?.group,
    canNestFolder: canDropFolder,
    pageRect: () => pageRect?.(),
    onSplitDrop: (side) => onSplitDrop?.(side),
    send,
  });
  const draggingPinned = $derived(drag.group === 'pinned');
  const draggingListed = $derived(drag.group === 'listed');

  const unreadHosts = $derived(
    new Set(tabs.flatMap((tab) => (tab.unread && !tab.isPrivate ? (hostOf(tab.url) ?? []) : []))),
  );

  function favoriteUnread(url: string): boolean {
    const host = hostOf(url);
    return host !== null && unreadHosts.has(host);
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

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || drag.escape()) return;
    if (selectedTabIds.length > 0) send({ type: 'clear-tab-selection' });
  }
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
  <div class="split-row" class:compact={members.length > 2}>
    {#each members as member (member.id)}
      <div class="split-half">
        <button
          class="split-select"
          title={member.url}
          aria-label={label(member)}
          aria-current={member.id === activeTabId ? 'page' : undefined}
          onclick={(e) => selectTab(e, member.id)}
          onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: member.id })}
        >
          {@render favicon(member, 16, member.unread)}
          <span class="title">{member.title}</span>
        </button>
        <IconButton
          size="sm"
          tone="muted"
          icon="close"
          class="split-close"
          label={t('tabPanel.close')}
          title={t('tabPanel.closeTitle')}
          onclick={() => send({ type: 'close-tab', id: member.id })}
        />
      </div>
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
    {#if developer}<span class="mark" title={t('tabPanel.developerTab')}>
        <Icon name="gauge" size={13} />
      </span>{:else if tab.isPrivate}<span class="mark" title={t('tabPanel.privateTab')}>
        <Icon name="private" size={13} />
      </span>{/if}
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
        class:drop-target={drag.dropFolder === group.name}
        data-folder={group.name}
        title={group.name}
        aria-label={`${group.name} (${group.count})`}
        aria-expanded={!group.collapsed}
        onclick={() => send({ type: 'toggle-tab-group', name: group.name })}
        ondblclick={() => startRename(group.name)}
        onpointerdown={(e) => drag.pressFolder(e, group.name)}
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
    <ol class="rows" class:shifting={draggingListed}>
      {#each section.entries.filter((entry) => !mergedSplits.hidden.has(entry.id)) as tab (tab.id)}
        {@const merged = mergedSplits.heads.get(tab.id)}
        <li
          class="row"
          class:private={tab.isPrivate}
          class:active={tab.id === activeTabId || !!merged?.some((member) => member.id === activeTabId)}
          class:split={!!merged}
          class:selected={selected.has(tab.id)}
          class:lifted={draggingListed && tab.id === drag.dragId}
          class:returning={tab.id === drag.returningId}
          class:split-drop={drag.dropTab === tab.id}
          data-tab-id={tab.id}
          data-hover-preview={!tab.isPrivate ? '' : undefined}
          animate:reorder
          style:transform={draggingListed ? drag.style(tab.id) : undefined}
          onpointerenter={(e) => !tab.isPrivate && previews.enter(e.currentTarget, tab.id, tab.url)}
          onpointerleave={previews.leave}
          onpointerdown={(e) => drag.pressTab(e, tab.id, 'listed')}
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
  onpointerdowncapture={previews.dismiss}
  onwheelcapture={previews.dismiss}
  onkeydowncapture={previews.dismiss}
  onpointermove={(e) => drag.move(e)}
  onpointerup={(e) => drag.release(e)}
  onpointercancel={() => drag.end()}
  onkeydown={onKeyDown}
  onblur={() => drag.end()}
/>

<aside
  class="panel card"
  class:dragging={drag.dragId !== null}
  aria-label={t('tabPanel.tabs')}
  onwheel={(event) => spaceSwipe.wheel(event, spaces, activeSpaceId)}
  oncontextmenu={(event) => {
    // Rows open their own menus first; only empty sidebar space gets the sidebar menu.
    if (event.defaultPrevented || (event.target as Element).closest('input, textarea, [contenteditable="true"]'))
      return;
    event.preventDefault();
    send({ type: 'open-sidebar-context-menu' });
  }}
  style:--panel-full-width="{fullWidth}px"
>
  <div class="top" style:height="{topInset}px"></div>

  <div class="body" style:transform={slide ? `translateX(${slide}px)` : undefined}>
    <div
      class="lists"
      class:space-shifting={spaceSwipe.shifting}
      class:space-settling={spaceSwipe.shifting && !spaceSwipe.following}
      style:--space-shift="{spaceSwipe.shift}px"
      style:--space-fade={1 - Math.min(Math.abs(spaceSwipe.shift) / 120, 0.6)}
      bind:this={drag.lists}
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
              class:lifted={draggingPinned && tab.id === drag.dragId}
              class:returning={tab.id === drag.returningId}
              class:drop-before={draggingPinned && drag.dropIndex === index}
              class:drop-after={draggingPinned && drag.dropIndex === index + 1 && index === pinned.length - 1}
              class:split-drop={drag.dropTab === tab.id}
              data-drag-index={index}
              data-tab-id={tab.id}
              data-hover-preview={!tab.isPrivate ? '' : undefined}
              animate:reorder
              style:transform={draggingPinned ? drag.style(tab.id) : undefined}
              onpointerenter={(e) => !tab.isPrivate && previews.enter(e.currentTarget, tab.id, tab.url)}
              onpointerleave={previews.leave}
              onpointerdown={(e) => drag.pressTab(e, tab.id, 'pinned')}
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
      <LiveFolders folders={liveFolders} bind:adding={addingLiveFolder} bind:kind={liveFolderKind} />
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
        {#if agents.waiting > 0}<span class="agents-waiting">
            {t('tabPanel.agentsWaiting', { count: agents.waiting })}
          </span>{/if}
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
      <SidebarFooter {profile} {spaces} {activeSpaceId} {footerItems} {activeTabId} {downloads} />
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
            onclick={() => send({ type: 'clear-tab-selection' })}
          >
            Esc
          </button>
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
  .split-drop,
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

  .top {
    flex: none;
    -webkit-app-region: drag;
  }

  .lists {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
    padding-top: 4px;
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
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 6px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
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

  .favorite.selected :global(.icon-btn) {
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
    height: 36px;
    border-radius: 10px;
    color: var(--text);
    transition: background var(--transition);
  }

  .pill {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    border-radius: 8px;
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

  .panel.card .row :global(.tab-icon) {
    background: transparent;
    box-shadow: none;
  }

  .panel.card .body {
    width: calc(var(--panel-full-width) - 12px);
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

  .panel.card .row.split:not(.active) {
    background: var(--card-tile);
  }

  .split-row {
    display: flex;
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  .split-half {
    position: relative;
    display: flex;
    flex: 1 1 0;
    min-width: 0;
  }

  .split-select {
    display: flex;
    flex: 1;
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

  .split-select .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .split-row.compact .split-select {
    justify-content: center;
    padding: 0;
  }

  .split-row.compact .title {
    display: none;
  }

  .split-half :global(.split-close) {
    position: absolute;
    top: 50%;
    left: 5px;
    transform: translateY(-50%);
    opacity: 0;
    pointer-events: none;
  }

  .split-row.compact .split-half :global(.split-close) {
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .row:is(:hover, :has(:focus-visible)) .split-half :global(.split-close) {
    opacity: 1;
    pointer-events: auto;
  }

  .row:is(:hover, :has(:focus-visible)) .split-select .favicon {
    visibility: hidden;
  }

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
    border-radius: 8px;
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

  .select {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    height: 100%;
    padding: 0 6px 0 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 500;
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
    .returning,
    .rows.shifting > .row:not(.lifted) {
      transition: transform 200ms var(--ease-out);
    }
  }

  .row.lifted .actions {
    display: none;
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
</style>
