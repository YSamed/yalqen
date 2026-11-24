<script lang="ts">
  import type { DownloadsSummary, TabId, TabSnapshot, ToolbarButtonId, TranslationStatus } from '../../shared/types';
  import type { AgentSessionState } from '../../shared/agent';
  import { untrack } from 'svelte';
  import { t } from '../../shared/i18n';
  import { devStates, isNewTab, siteLabel } from './format';
  import Capsule from './Capsule.svelte';
  import Icon from '../ui/Icon.svelte';
  import NewTabButton from './NewTabButton.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { modeOf, TAB_MODES, type TabMode } from '../../shared/tab-modes';
  import type { MessageKey } from '../../shared/i18n';
  import type { IconName } from '../ui/Icon.svelte';

  const MODE_LABEL: Record<TabMode, MessageKey> = {
    normal: 'tabModes.normal',
    developer: 'tabModes.developer',
    private: 'tabModes.private',
  };

  function moveModeFocus(event: KeyboardEvent): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const radios = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (step !== undefined) next = (Math.max(index, 0) + step + radios.length) % radios.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = radios.length - 1;
    if (next < 0) return;
    event.preventDefault();
    for (const [position, radio] of radios.entries()) radio.tabIndex = position === next ? 0 : -1;
    radios[next].focus();
  }

  function modeIcon(mode: TabMode, tab: TabSnapshot): IconName {
    if (mode === 'developer') return 'code';
    if (mode === 'private') return 'private';
    return tab.security === 'local' ? 'profile' : 'lock';
  }

  let {
    sidebarMenu = false,
    panelCollapsed = false,
    panes = [],
    leadingWidth = 0,
    span = false,
    activeTab,
    developer,
    zoom,
    defaultZoom,
    downloads,
    ready,
    extensions,
    buttons,
    leadingInset,
    trailingInset,
    centerOffset,
    alignLeading = false,
    agentAvailable,
    agentPanelOpen,
    agentStatus,
    modeSwitch = false,
    bookmarksPanelOpen = false,
  }: {
    sidebarMenu?: boolean;
    panelCollapsed?: boolean;
    panes?: { tab: TabSnapshot | null; x: number; width: number }[];
    leadingWidth?: number;
    span?: boolean;
    activeTab: TabSnapshot | null;
    developer: boolean;
    zoom: number;
    defaultZoom: number;
    downloads: DownloadsSummary;
    ready: boolean;
    extensions: boolean;
    buttons: ToolbarButtonId[];
    leadingInset: number;
    trailingInset: number;
    centerOffset: number;
    alignLeading?: boolean;
    agentAvailable: boolean;
    agentPanelOpen: boolean;
    agentStatus: AgentSessionState['status'];
    modeSwitch?: boolean;
    bookmarksPanelOpen?: boolean;
  } = $props();

  let toolbar: HTMLElement | undefined = $state();
  let group: HTMLElement | undefined = $state();
  let strip: HTMLElement | undefined = $state();
  let trailing: HTMLElement | undefined = $state();
  let groupOffset = 0;
  const send = window.yalqen.send;
  const translateTitle: Record<TranslationStatus, string> = {
    idle: t('toolbar.translatePage'),
    translating: t('toolbar.translatingPage'),
    translated: t('toolbar.showOriginalPage'),
    failed: t('toolbar.translationFailed'),
  };
  let dropKey = $state(0);
  let seenStarts: number | null = null;
  const split = $derived(span && panes.length > 1);
  let trailingWidth = $state(0);
  const PANE_CLOSE_WIDTH = 36;

  function paneAction(id: TabId, action: Parameters<typeof send>[0]): void {
    if (id !== activeTab?.id) send({ type: 'activate-tab', id });
    send(action);
  }
  const surface = $derived(span && activeTab && !isNewTab(activeTab.url) ? (activeTab.pageColor ?? null) : null);
  const surfaceTone = $derived(surface === null ? null : toneScheme(surface));
  const chatPill = $derived(span && agentAvailable && activeTab !== null && !isNewTab(activeTab.url));
  const bookmarkable = $derived(
    activeTab !== null && (activeTab.url.startsWith('http') || activeTab.url.startsWith('file:')),
  );
  const states = $derived(activeTab ? devStates(activeTab) : []);
  const zoomChanged = $derived(Math.round(zoom * 100) !== Math.round(defaultZoom * 100));
  const hasActions = $derived(
    bookmarkable ||
      zoomChanged ||
      states.length > 0 ||
      activeTab?.translation.available === true ||
      (activeTab?.blockedPopups ?? 0) > 0,
  );

  function openExtensionsMenu(event: MouseEvent & { currentTarget: HTMLElement }): void {
    const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
    send({ type: 'open-extensions-menu', anchor: { x, y, width, height } });
  }

  $effect(() => {
    if (!ready) return;
    const started = downloads.started;
    if (seenStarts !== null && started > seenStarts) dropKey++;
    seenStarts = started;
  });

  let alignGroup: (() => void) | null = null;
  $effect(() => {
    // The active chip is keyed by tab id, so only a new id replaces the element the observer watches.
    void activeTab?.id;
    if (!toolbar || !group || !strip || !trailing) return;
    const header = toolbar;
    const tabGroup = group;
    const tabStrip = strip;
    const controls = trailing.firstElementChild;
    const active = tabStrip.querySelector('.chip.active');
    if (!active || !controls) return;

    const align = () => {
      if (span) {
        groupOffset = 0;
        tabGroup.style.transform = '';
        return;
      }
      const headerBounds = header.getBoundingClientRect();
      const groupBounds = tabGroup.getBoundingClientRect();
      const contentRight =
        tabGroup.querySelector('.new-tab-slot > *')?.getBoundingClientRect().right ?? groupBounds.right;
      const contentCenter = (contentRight - groupBounds.left) / 2;
      const leftLimit = headerBounds.left + leadingInset + 8;
      const targetLeft = alignLeading
        ? leftLimit
        : headerBounds.left + headerBounds.width / 2 + centerOffset - contentCenter;
      const rightLimit = controls.getBoundingClientRect().left - 8 - groupBounds.width;
      const left = Math.max(leftLimit, Math.min(targetLeft, rightLimit));
      groupOffset = Math.round((left - (groupBounds.left - groupOffset)) * devicePixelRatio) / devicePixelRatio;
      tabGroup.style.transform = `translateX(${groupOffset}px)`;
    };

    const observer = new ResizeObserver(align);
    for (const node of [header, tabGroup, tabStrip, active, controls]) observer.observe(node);
    tabStrip.addEventListener('scroll', align, { passive: true });
    untrack(align);
    alignGroup = align;
    return () => {
      alignGroup = null;
      observer.disconnect();
      tabStrip.removeEventListener('scroll', align);
    };
  });

  $effect(() => {
    void centerOffset;
    void leadingInset;
    void span;
    void alignLeading;
    untrack(() => alignGroup?.());
  });

  function toneScheme(hex: string): 'light' | 'dark' {
    const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    return 0.299 * red! + 0.587 * green! + 0.114 * blue! > 150 ? 'light' : 'dark';
  }
</script>

{#snippet button(id: ToolbarButtonId)}
  {#if id === 'home'}
    <IconButton icon="home" label={t('toolbar.home')} onclick={() => send({ type: 'go-home' })} />
  {:else if id === 'bookmarks'}
    <IconButton
      icon="bookmarks"
      label={t('toolbar.bookmarks')}
      aria-pressed={bookmarksPanelOpen}
      onclick={() => send({ type: 'open-bookmarks-menu' })}
    />
  {:else if id === 'history'}
    <IconButton
      icon="history"
      label={t('toolbar.history')}
      title={t('toolbar.historyTitle')}
      onclick={() => send({ type: 'open-history' })}
    />
  {:else if id === 'extensions'}
    {#if extensions}
      <IconButton icon="extensions" label={t('toolbar.extensions')} onclick={openExtensionsMenu} />
    {/if}
  {:else if id === 'profile'}
    <IconButton icon="profile" label={t('toolbar.profile')} onclick={() => send({ type: 'open-profile-menu' })} />
  {:else if id === 'settings'}
    <IconButton
      icon="settings"
      label={t('toolbar.settings')}
      title={t('toolbar.settingsTitle')}
      onclick={() => send({ type: 'open-settings' })}
    />
  {:else if id === 'screenshot'}
    <IconButton
      icon="screenshot"
      label={t('toolbar.fullPageScreenshot')}
      title={t('toolbar.fullPageScreenshotTitle')}
      disabled={!ready || !activeTab}
      onclick={() => send({ type: 'dev-command', id: 'full-page-screenshot' })}
    />
  {:else}
    <IconButton
      icon="download"
      tone={downloads.active > 0 ? 'accent' : 'default'}
      label={downloads.active > 0 ? t('toolbar.downloadsActive', { count: downloads.active }) : t('toolbar.downloads')}
      title={t('toolbar.downloads')}
      onclick={() => send({ type: 'open-downloads' })}
    >
      {#if downloads.active > 0}
        <svg class="ring" class:indeterminate={downloads.progress === null} viewBox="0 0 28 28" aria-hidden="true">
          <circle
            cx="14"
            cy="14"
            r="12.5"
            pathLength="100"
            stroke-dasharray="{downloads.progress === null ? 25 : Math.max(2, downloads.progress * 100)} 100"
          />
        </svg>
      {/if}
      {#key dropKey}
        {#if dropKey > 0}
          <span class="drop-x" aria-hidden="true">
            <span class="drop-y"><Icon name="download" size={12} /></span>
          </span>
          <span class="landing" aria-hidden="true"></span>
        {/if}
      {/key}
    </IconButton>
  {/if}
{/snippet}

{#snippet panelToggle()}
  <IconButton
    size="lg"
    variant="surface"
    class="panel-toggle"
    icon="sidebar-left"
    label={panelCollapsed ? t('tabPanel.expandSidebar') : t('tabPanel.collapseSidebar')}
    title={panelCollapsed ? t('tabPanel.expandSidebarTitle') : t('tabPanel.collapseSidebarTitle')}
    aria-expanded={!panelCollapsed}
    onclick={() => send({ type: 'toggle-panel' })}
  />
{/snippet}

{#snippet navigation()}
  <IconButton
    size="lg"
    variant="surface"
    icon="nav-back"
    label={t('toolbar.back')}
    disabled={!activeTab?.canGoBack}
    onclick={() => send({ type: 'go-back' })}
  />
  <IconButton
    size="lg"
    variant="surface"
    icon="nav-forward"
    label={t('toolbar.forward')}
    disabled={!activeTab?.canGoForward}
    onclick={() => send({ type: 'go-forward' })}
  />
  {#if activeTab?.loading}
    <IconButton
      size="lg"
      variant="surface"
      icon="close"
      label={t('toolbar.stop')}
      title={t('toolbar.stopTitle')}
      onclick={() => send({ type: 'stop' })}
    />
  {:else}
    <IconButton
      size="lg"
      variant="surface"
      icon="nav-reload"
      label={t('toolbar.reload')}
      title={t('toolbar.reloadTitle')}
      onclick={() => send({ type: 'reload' })}
    />
  {/if}
{/snippet}

<header
  class="toolbar card"
  class:span
  class:split
  class:blank-page={activeTab !== null && isNewTab(activeTab.url)}
  class:surface-light={surfaceTone === 'light'}
  class:surface-dark={surfaceTone === 'dark'}
  style:--card-surface={surface}
  class:busy={downloads.active > 0 || agentStatus === 'running' || agentStatus === 'error'}
  bind:this={toolbar}
  style:padding-left="{leadingInset}px"
  style:padding-right="{trailingInset}px"
  style:--bar-card-left="{leadingInset + leadingWidth + 8}px"
  style:--bar-group-offset="{Math.max(0, 9 + Math.min(0, leadingWidth))}px"
>
  <div class="side leading" style:flex={span ? `0 0 ${Math.max(0, leadingWidth)}px` : undefined}></div>

  <div class="tab-group" bind:this={group}>
    {#if span}{@render panelToggle()}{/if}
    {@render navigation()}
    <ol class="strip" bind:this={strip} aria-label={t('toolbar.openTabs')}>
      {#if activeTab}
        {#key activeTab.id}
          {@const tab = activeTab}
          <li class="chip active">
            <div class="pill">
              {#if modeSwitch}
                {@const mode = modeOf(tab)}
                <div
                  class="modes {mode}"
                  role="radiogroup"
                  tabindex="-1"
                  aria-label={t('tabModes.title')}
                  style:--mode-index={TAB_MODES.indexOf(mode)}
                  onkeydown={moveModeFocus}
                >
                  <span class="mode-thumb" aria-hidden="true"></span>
                  {#each TAB_MODES as item (item)}
                    {@const current = item === mode}
                    <button
                      class={['mode', item, item === 'normal' && tab.security]}
                      role="radio"
                      aria-checked={current}
                      tabindex={current ? 0 : -1}
                      aria-label={t(MODE_LABEL[item])}
                      title={current && item === 'normal' && tab.security !== 'local'
                        ? t('toolbar.siteInfo')
                        : t(MODE_LABEL[item])}
                      onclick={() => {
                        if (!current) send({ type: 'set-tab-mode', mode: item });
                        else if (item === 'normal' && tab.security !== 'local') send({ type: 'open-site-info' });
                      }}
                    >
                      <Icon name={modeIcon(item, tab)} size={13} />
                    </button>
                  {/each}
                </div>
              {:else}
                {#if tab.security !== 'local'}
                  <IconButton
                    size="sm"
                    icon="lock"
                    class={['site', tab.security]}
                    label={tab.security === 'secure' ? t('toolbar.siteInfoSecure') : t('toolbar.siteInfoNotSecure')}
                    title={t('toolbar.siteInfo')}
                    onclick={() => send({ type: 'open-site-info' })}
                  />
                {/if}
                {#if developer}
                  <span class="private-badge developer" title={t('toolbar.developerWindow')}>
                    <Icon name="gauge" size={14} />
                  </span>
                {:else if tab.isPrivate}
                  <span class="private-badge" title={t('toolbar.privateTab')}>
                    <Icon name="private" size={14} />
                  </span>
                {/if}
              {/if}
              <button
                class="address"
                class:after-site={modeSwitch || tab.security !== 'local' || tab.isPrivate}
                title={t('toolbar.addressTitle')}
                aria-current="page"
                onclick={() => send({ type: 'open-address' })}
              >
                {#if isNewTab(tab.url)}
                  <span class="label hint">{t('commandBar.placeholder')}</span>
                {:else}
                  <span class="label crumb">{siteLabel(tab)}</span>
                {/if}
              </button>
              {#if tab.audible || tab.muted}
                <IconButton
                  size="sm"
                  icon={tab.muted ? 'muted' : 'sound'}
                  tone="muted"
                  label={tab.muted ? t('toolbar.unmute') : t('toolbar.mute')}
                  aria-pressed={tab.muted}
                  onclick={() => send({ type: 'toggle-mute', id: tab.id })}
                />
              {/if}
              {#if activeTab && hasActions}
                <span class="page-actions" role="group" aria-label={t('toolbar.pageActions')}>
                  {#if bookmarkable}
                    <IconButton
                      icon="star"
                      tone={activeTab.bookmarked ? 'accent' : 'muted'}
                      class="star"
                      label={activeTab.bookmarked ? t('toolbar.removeBookmark') : t('toolbar.addBookmark')}
                      title={activeTab.bookmarked ? t('toolbar.removeBookmarkTitle') : t('toolbar.addBookmarkTitle')}
                      aria-pressed={activeTab.bookmarked}
                      onclick={() => send({ type: 'toggle-bookmark' })}
                    />
                  {/if}
                  {#if activeTab.translation.available}
                    {#if activeTab.translation.status === 'idle' || activeTab.translation.status === 'failed'}
                      <IconButton
                        icon="translate"
                        tone={activeTab.translation.status === 'failed' ? 'warn' : 'muted'}
                        label={translateTitle[activeTab.translation.status]}
                        onclick={() => send({ type: 'toggle-translation' })}
                      />
                    {:else}
                      <Button
                        size="sm"
                        variant="tonal"
                        icon="translate"
                        disabled={activeTab.translation.status === 'translating'}
                        aria-pressed={activeTab.translation.status === 'translated'}
                        title={translateTitle[activeTab.translation.status]}
                        onclick={() => send({ type: 'toggle-translation' })}
                      >
                        {activeTab.translation.status === 'translating'
                          ? t('toolbar.translating')
                          : t('toolbar.translated')}
                      </Button>
                    {/if}
                  {/if}
                  {#if activeTab.blockedPopups > 0}
                    <IconButton
                      icon="popup-blocked"
                      variant="tonal"
                      tone="warn"
                      label={t('toolbar.popupsBlocked', { count: activeTab.blockedPopups })}
                      title={t('toolbar.popupBlocked')}
                      onclick={() => send({ type: 'open-blocked-popups' })}
                    />
                  {/if}
                  {#if states.length > 0}
                    {#key activeTab.agentReadAt}
                      <Button
                        size="sm"
                        variant="tonal"
                        icon="gauge"
                        class={[
                          'dev-state',
                          activeTab.agentObserved && 'agent',
                          activeTab.agentReadAt !== null && Date.now() - activeTab.agentReadAt < 1500 && 'agent-read',
                        ]}
                        aria-label={t('toolbar.developerStatus', { states: states.join(', ') })}
                        title={states.join(' · ')}
                        onclick={() => send({ type: 'open-dev-menu' })}
                      >
                        {states.length}
                      </Button>
                    {/key}
                  {/if}
                  {#if zoomChanged}
                    <Button
                      size="sm"
                      variant="tonal"
                      class="zoom"
                      title={t('toolbar.resetZoomTitle')}
                      onclick={() => send({ type: 'reset-zoom' })}
                    >
                      {t('toolbar.zoomPercent', { percent: Math.round(zoom * 100) })}
                    </Button>
                  {/if}
                </span>
              {/if}
              <IconButton
                size="sm"
                icon="close"
                tone="muted"
                class="close"
                label={t('toolbar.close')}
                title={t('toolbar.closeTitle')}
                onclick={() => send({ type: 'close-tab', id: tab.id })}
              />
            </div>
          </li>
        {/key}
      {/if}
    </ol>
    {#if !sidebarMenu}
      <div class="new-tab-slot">
        <NewTabButton />
      </div>
    {/if}
  </div>

  {#if split}
    {#each panes as pane, index (index)}
      {@const tab = pane.tab}
      <div
        class="pane-bar"
        class:active={tab !== null && tab.id === activeTab?.id}
        style:left="{pane.x}px"
        style:width="{pane.width}px"
        style:--reserve={index === panes.length - 1 ? `${trailingWidth}px` : undefined}
        style:padding-left={index === 0 && leadingInset + 4 > pane.x + 6 ? `${leadingInset + 4 - pane.x}px` : undefined}
      >
        {#if index === 0}{@render panelToggle()}{/if}
        {#if tab}
          <IconButton
            size="lg"
            variant="surface"
            icon="nav-back"
            label={t('toolbar.back')}
            disabled={!tab.canGoBack}
            onclick={() => paneAction(tab.id, { type: 'go-back' })}
          />
          <IconButton
            size="lg"
            variant="surface"
            icon="nav-forward"
            label={t('toolbar.forward')}
            disabled={!tab.canGoForward}
            onclick={() => paneAction(tab.id, { type: 'go-forward' })}
          />
          <IconButton
            size="lg"
            variant="surface"
            icon={tab.loading ? 'close' : 'nav-reload'}
            label={tab.loading ? t('toolbar.stop') : t('toolbar.reload')}
            onclick={() => paneAction(tab.id, { type: tab.loading ? 'stop' : 'reload' })}
          />
          <button
            class="pane-address"
            title={t('toolbar.addressTitle')}
            onclick={() => paneAction(tab.id, { type: 'open-address' })}
          >
            {#if isNewTab(tab.url)}
              <span class="label hint">{t('commandBar.placeholder')}</span>
            {:else}
              <span class="label">
                <span class="crumb">{siteLabel(tab)}</span>{#if tab.title && tab.title !== siteLabel(tab)}<span
                    class="crumb-title"
                  >
                    / {tab.title}
                  </span>{/if}
              </span>
            {/if}
          </button>
          <IconButton
            size="lg"
            variant="surface"
            tone="muted"
            class="pane-close"
            icon="close"
            label={t('toolbar.close')}
            title={t('toolbar.closeTitle')}
            onclick={() => send({ type: 'close-tab', id: tab.id })}
          />
        {/if}
      </div>
    {/each}
  {/if}

  <div
    class="side trailing"
    bind:this={trailing}
    bind:clientWidth={trailingWidth}
    style:margin-right="{split ? PANE_CLOSE_WIDTH : 0}px"
  >
    <Capsule>
      {#if agentAvailable && !chatPill}
        <IconButton
          icon="sparkle"
          label={t('agentPanel.toggle')}
          title={t('agentPanel.toggleTitle')}
          aria-expanded={agentPanelOpen}
          aria-controls="agent-panel"
          tone={agentPanelOpen ? 'accent' : 'default'}
          disabled={!ready}
          onclick={() => send({ type: 'toggle-agent-panel' })}
        >
          {#if agentStatus === 'running' || agentStatus === 'starting' || agentStatus === 'error'}
            <span
              class="agent-dot"
              class:error={agentStatus === 'error'}
              aria-label={t(agentStatus === 'error' ? 'agentPanel.failed' : 'agentPanel.running')}
            ></span>
          {/if}
        </IconButton>
      {/if}
      <!-- Like Dia, the card style keeps the toolbar to navigation; these actions live in the sidebar menu when it shows. -->
      {#if !sidebarMenu}
        {#each buttons as id (id)}
          {@render button(id)}
        {/each}
      {/if}
    </Capsule>
  </div>

  {#if chatPill}
    <div class="chat-slot">
      <button
        type="button"
        class="chat-pill"
        class:open={agentPanelOpen}
        title={t('agentPanel.toggleTitle')}
        aria-expanded={agentPanelOpen}
        aria-controls="agent-panel"
        disabled={!ready}
        onclick={() => send({ type: 'toggle-agent-panel' })}
      >
        <Icon name="sparkle" size={14} />
        <span>{t('newTab.chat')}</span>
        {#if agentStatus === 'running' || agentStatus === 'starting' || agentStatus === 'error'}
          <span
            class="agent-dot"
            class:error={agentStatus === 'error'}
            aria-label={t(agentStatus === 'error' ? 'agentPanel.failed' : 'agentPanel.running')}
          ></span>
        {/if}
      </button>
    </div>
  {/if}
</header>

<style>
  .agent-dot {
    position: absolute;
    right: 7px;
    bottom: 6px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--badge);
  }
  .agent-dot.error {
    background: var(--warn);
  }
  .toolbar {
    display: flex;
    grid-area: bar;
    align-items: center;
    gap: 8px;
    min-width: 0;
    -webkit-app-region: drag;
  }

  .toolbar.card {
    gap: 4px;
  }

  .toolbar.card.span {
    position: relative;
    z-index: 1;
    grid-column: 1 / span 2;
  }

  /* Extends under the page view's top corners. */
  .toolbar.card.span::before {
    position: absolute;
    right: 7px;
    left: var(--bar-card-left);
    content: '';
    pointer-events: none;
    top: 6px;
    bottom: -4px;
    border-radius: 10px 10px 0 0;
    background: var(--card-surface, var(--page));
    transition: background-color 180ms ease-out;
  }

  .toolbar.card.span.blank-page::before {
    bottom: 0;
    background: var(--page-veil);
  }

  /* The toolbar takes the page's own top color, so its text and icons follow that color's lightness. */
  .toolbar.surface-light {
    --text: #1a1b1e;
    --text-muted: rgb(26 27 30 / 0.62);
    --surface-hover: rgb(16 18 24 / 0.06);
  }

  .toolbar.surface-dark {
    --text: #f3f3f4;
    --text-muted: rgb(243 243 244 / 0.62);
    --surface-hover: rgb(255 255 255 / 0.08);
  }

  .chat-slot {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    padding: 6px 4px 0 0;
    -webkit-app-region: no-drag;
  }

  .chat-pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px 0 9px;
    border: 0;
    border-radius: 8px;
    background: rgb(from var(--text) r g b / 0.06);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
  }

  .chat-pill :global(svg) {
    color: var(--frame-primary, var(--accent));
  }

  .chat-pill:hover,
  .chat-pill.open {
    background: rgb(from var(--text) r g b / 0.1);
  }

  .chat-pill .agent-dot {
    top: 5px;
    right: 5px;
    bottom: auto;
  }

  .toolbar.split::before,
  .toolbar.split .tab-group {
    visibility: hidden;
  }

  .pane-bar {
    position: absolute;
    top: 6px;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px;
    border-radius: 10px 10px 0 0;
    background: var(--page);
  }

  /* Leaves room for the nav buttons, the close button and, in the last pane, the hover-revealed trailing controls. */
  .pane-address {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 0;
    max-width: calc(100% - 195px - var(--reserve, 0px));
    height: 30px;
    padding: 0 6px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: default;
    -webkit-app-region: no-drag;
  }

  .pane-bar :global(.pane-close) {
    margin-left: auto;
  }

  .pane-address:hover {
    background: var(--surface-hover);
  }

  .toolbar.card.span .tab-group {
    position: relative;
    flex: 1 1 auto;
    gap: 3px;
    padding: 6px 0 0 var(--bar-group-offset);
  }

  .toolbar.card.span :global(.icon-btn.lg:not(.panel-toggle)) {
    color: rgb(from var(--text) r g b / 0.5);
  }

  .toolbar.card.span :global(.icon-btn.panel-toggle) {
    color: rgb(from var(--text) r g b / 0.82);
  }

  /* Dia leaves the toolbar empty on a new tab; the page's own search box takes the address. */
  .toolbar.card.span.blank-page .chip.active {
    display: none;
  }

  /* Dia draws these with SF Symbols at 13pt regular, a thinner line than the app's 1.4. */
  .toolbar.card.span :global(.icon-btn.lg svg) {
    stroke-width: 1.15;
  }

  .toolbar.card.span :global(.icon-btn.lg) {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }

  .toolbar.card.span .trailing {
    position: relative;
    flex: 0 0 auto;
    padding: 6px 6px 0 0;
  }

  .toolbar.card.span .chip.active {
    flex: 1 1 auto;
    width: auto;
  }

  .crumb {
    color: var(--text);
    font-weight: 500;
  }

  .crumb-title {
    color: var(--text-muted);
  }

  .toolbar.card .leading {
    min-width: 0;
    justify-content: flex-start;
    gap: 6px;
    padding-left: 8px;
  }

  .toolbar.card.span .leading {
    padding-top: 6px;
    padding-left: 0;
    overflow: hidden;
  }

  .toolbar.card :global(.icon-btn.surface),
  .toolbar.card :global(.capsule),
  .toolbar.card .pill {
    background: transparent;
    box-shadow: none;
  }

  .toolbar.card :global(.capsule) {
    padding: 0;
  }

  .toolbar.card :global(.icon-btn:disabled) {
    opacity: 0.6;
  }

  .toolbar.card .chip.active :global(.site),
  .toolbar.card .chip.active :global(.close) {
    display: none;
  }

  .toolbar.card .page-actions {
    opacity: 0;
    transition: opacity var(--transition);
  }

  .toolbar.card .chip.active:is(:hover, :focus-within) .page-actions {
    opacity: 1;
  }

  .toolbar.card .trailing {
    opacity: 0;
    transition: opacity var(--transition);
  }

  .toolbar.card:is(:hover, :focus-within, .busy) .trailing {
    opacity: 1;
  }

  .toolbar.card .chip.active {
    width: clamp(240px, 40vw, 520px);
  }

  .toolbar.card .address {
    gap: 6px;
    padding-left: 6px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 400;
  }

  .toolbar.card .address::after {
    display: none;
  }

  .side {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    min-width: max-content;
  }

  .leading {
    justify-content: space-between;
  }

  .trailing {
    justify-content: flex-end;
  }

  .tab-group {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .new-tab-slot {
    display: flex;
    flex: 0 1000 92px;
    min-width: var(--chrome-control-size);
  }

  @media (max-width: 760px) {
    .new-tab-slot {
      flex-basis: var(--chrome-control-size);
    }
  }

  :global([data-material='glass']) .pill {
    box-shadow: var(--shadow), var(--rim);
  }

  .strip {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin: 0;
    padding: 2px;
    overflow-x: auto;
    list-style: none;
    scrollbar-width: none;
  }

  .strip::-webkit-scrollbar {
    display: none;
  }

  .chip {
    position: relative;
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 40px;
    max-width: 150px;
    height: var(--chrome-control-size);
    padding-right: 5px;
    border-radius: 999px;
    transition: background var(--transition);
    -webkit-app-region: no-drag;
  }

  .chip.active {
    gap: 6px;
    width: clamp(280px, 34vw, 480px);
    max-width: none;
    min-width: 160px;
    padding-right: 0;
  }

  .pill {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    padding-right: 5px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .page-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
  }

  .chip :global(.close:focus-visible) {
    opacity: 1;
    pointer-events: auto;
  }

  .address {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 7px;
    min-width: 0;
    height: 100%;
    padding: 0 6px 0 11px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
  }

  .address {
    justify-content: center;
    padding-left: 33px;
    color: var(--text);
    font-weight: 500;
  }

  .address:not(.after-site)::after {
    flex: none;
    width: 16px;
    content: '';
  }

  .private-badge {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    margin-left: 4px;
    border-radius: 50%;
    background: var(--text);
    color: var(--surface);
  }

  .private-badge.developer {
    background: var(--accent);
    color: #fff;
  }

  .modes {
    --mode-size: 24px;
    --mode-color: var(--text-muted);
    position: relative;
    display: flex;
    flex: none;
    gap: 2px;
    margin-left: 4px;
    padding: 2px;
    border-radius: 999px;
    background: var(--well);
  }

  .modes.developer {
    --mode-color: var(--accent);
  }

  .modes.private {
    --mode-color: var(--text);
  }

  .mode-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: var(--mode-size);
    height: var(--mode-size);
    border-radius: 999px;
    background: var(--surface-strong);
    box-shadow:
      var(--shadow),
      inset 0 0 0 1px color-mix(in srgb, var(--mode-color) 40%, transparent);
    transform: translateX(calc(var(--mode-index) * (var(--mode-size) + 2px)));
    transition:
      transform 220ms var(--ease-out),
      box-shadow var(--transition);
  }

  .modes.developer .mode-thumb {
    background: var(--accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .modes.private .mode-thumb {
    background: var(--text);
  }

  .mode {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: var(--mode-size);
    height: var(--mode-size);
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    cursor: default;
    transition: color var(--transition);
  }

  .mode:hover {
    color: var(--text);
  }

  .mode[aria-checked='true'] {
    color: var(--text);
  }

  .mode.normal.insecure {
    color: var(--warn);
  }

  .mode.normal.dangerous {
    color: #d93025;
  }

  .modes.developer .mode.developer {
    color: var(--on-accent, #fff);
  }

  .modes.private .mode.private {
    color: var(--surface-strong);
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-thumb {
      transition: none;
    }
  }

  .chip :global(.site) {
    margin-left: 4px;
  }

  .chip :global(.site.insecure) {
    color: var(--warn);
  }

  .chip :global(.site.dangerous) {
    color: #d93025;
  }

  .tab-group :global(.star[aria-pressed='true'] path) {
    fill: currentColor;
  }

  .tab-group :global(.zoom) {
    font-variant-numeric: tabular-nums;
  }

  .tab-group :global(.dev-state) {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .tab-group :global(.dev-state.agent) {
    position: relative;
  }

  .tab-group :global(.dev-state.agent)::after {
    content: '';
    position: absolute;
    top: 3px;
    right: 3px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .tab-group :global(.dev-state.agent-read) {
    animation: agent-read 1.2s ease-out;
  }

  @keyframes agent-read {
    from {
      box-shadow: 0 0 0 2px var(--accent);
    }
    to {
      box-shadow: 0 0 0 2px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tab-group :global(.dev-state.agent-read) {
      animation: none;
    }
  }

  .address.after-site {
    padding-left: 6px;
  }

  .ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
    pointer-events: none;
  }

  .ring circle {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-linecap: round;
    transition: stroke-dasharray 0.25s linear;
  }

  .ring.indeterminate {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring.indeterminate {
      animation: none;
    }
  }

  .drop-x,
  .drop-y,
  .landing {
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    pointer-events: none;
  }

  .drop-x {
    animation: drop-x 0.55s cubic-bezier(0.45, 0, 0.55, 1) both;
  }

  .drop-y {
    display: grid;
    place-items: center;
    background: var(--accent);
    color: #fff;
    animation: drop-y 0.55s ease-out both;
  }

  .landing {
    inset: 0;
    border: 1.6px solid var(--accent);
    opacity: 0;
    animation: landing 0.5s ease-out 0.5s both;
  }

  @keyframes drop-x {
    from {
      transform: translateX(-190px);
    }
    to {
      transform: translateX(0);
    }
  }

  @keyframes drop-y {
    0% {
      transform: translateY(6px) scale(1.25);
      opacity: 0;
    }
    30% {
      transform: translateY(-12px) scale(1.25);
      opacity: 1;
    }
    85% {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    100% {
      transform: translateY(0) scale(0.4);
      opacity: 0;
    }
  }

  @keyframes landing {
    from {
      transform: scale(0.8);
      opacity: 0.9;
    }
    to {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-x,
    .drop-y {
      animation-duration: 0.01s;
    }

    .landing {
      animation: none;
    }
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label.hint {
    color: var(--text-muted);
  }
</style>
