<script lang="ts">
  import type {
    DownloadsSummary,
    PendingUpdate,
    TabId,
    TabSnapshot,
    ToolbarButtonId,
    TranslationStatus,
  } from '../../shared/types';
  import { untrack } from 'svelte';
  import { t } from '../../shared/i18n';
  import { consoleErrorCount, devStates, isNewTab, siteLabel } from '../format';
  import Capsule from './Capsule.svelte';
  import Icon from './Icon.svelte';
  import NewTabButton from './NewTabButton.svelte';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';

  let {
    tabs,
    developer,
    activeTabId,
    zoom,
    defaultZoom,
    downloads,
    ready,
    extensions,
    buttons,
    pendingUpdate,
    leadingInset,
    trailingInset,
    centerOffset,
    trailingOverhang = 0,
  }: {
    tabs: TabSnapshot[];
    developer: boolean;
    activeTabId: TabId | null;
    zoom: number;
    defaultZoom: number;
    downloads: DownloadsSummary;
    ready: boolean;
    extensions: boolean;
    buttons: ToolbarButtonId[];
    pendingUpdate: PendingUpdate | null;
    leadingInset: number;
    trailingInset: number;
    centerOffset: number;
    trailingOverhang?: number;
  } = $props();

  let brokenIcons: Record<string, true> = $state({});
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
  const activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) ?? null);
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

  function openUpdatePopup(event: MouseEvent & { currentTarget: HTMLElement }): void {
    const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
    send({ type: 'open-update-popup', anchor: { x, y, width, height } });
  }

  $effect(() => {
    if (!ready) return;
    const started = downloads.started;
    if (seenStarts !== null && started > seenStarts) dropKey++;
    seenStarts = started;
  });

  $effect(() => {
    void activeTabId;
    strip?.querySelector('.chip.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // Read on each alignment instead of tracked by the observer effect, so a sliding panel
  // re-aligns the group without rebuilding the observer on every frame.
  let alignGroup: (() => void) | null = null;
  $effect(() => {
    void activeTabId;
    void tabs;
    if (!toolbar || !group || !strip || !trailing) return;
    const header = toolbar;
    const tabGroup = group;
    const tabStrip = strip;
    const controls = trailing.firstElementChild;
    const active = tabStrip.querySelector('.chip.active');
    if (!active || !controls) return;

    const align = () => {
      const headerBounds = header.getBoundingClientRect();
      const groupBounds = tabGroup.getBoundingClientRect();
      const activeBounds = active.getBoundingClientRect();
      const activeCenter = activeBounds.left + activeBounds.width / 2 - groupBounds.left;
      const targetLeft = headerBounds.left + headerBounds.width / 2 + centerOffset - activeCenter;
      const leftLimit = headerBounds.left + leadingInset + 8;
      const rightLimit = controls.getBoundingClientRect().left - 8 - groupBounds.width;
      // Keep the active address centered without moving the group into neighboring controls.
      const left = Math.max(leftLimit, Math.min(targetLeft, rightLimit));
      // Whole device pixels keep the address text from shimmering while the panel moves.
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
    untrack(() => alignGroup?.());
  });
</script>

{#snippet favicon(tab: TabSnapshot)}
  <span class="favicon">
    {#if isNewTab(tab.url)}
      <Icon name="search" size={14} />
    {:else if tab.faviconUrl && !brokenIcons[tab.faviconUrl]}
      <img src={tab.faviconUrl} alt="" width="16" height="16" onerror={() => (brokenIcons[tab.faviconUrl!] = true)} />
    {:else}
      <Icon name="globe" size={14} />
    {/if}
  </span>
{/snippet}

{#snippet button(id: ToolbarButtonId)}
  {#if id === 'bookmarks'}
    <IconButton icon="bookmarks" label={t('toolbar.bookmarks')} onclick={() => send({ type: 'open-bookmarks-menu' })} />
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

<header
  class="toolbar"
  bind:this={toolbar}
  style:padding-left="{leadingInset}px"
  style:padding-right="{trailingInset}px"
>
  <div class="side leading" aria-hidden="true"></div>

  <div class="tab-group" bind:this={group}>
    <Capsule as="nav" ariaLabel={t('toolbar.navigation')}>
      <IconButton
        icon="back"
        label={t('toolbar.back')}
        disabled={!activeTab?.canGoBack}
        onclick={() => send({ type: 'go-back' })}
      />
      <IconButton
        icon="forward"
        label={t('toolbar.forward')}
        disabled={!activeTab?.canGoForward}
        onclick={() => send({ type: 'go-forward' })}
      />
    </Capsule>
    <Capsule ariaLabel={t('toolbar.pageLoading')}>
      {#if activeTab?.loading}
        <IconButton
          icon="close"
          label={t('toolbar.stop')}
          title={t('toolbar.stopTitle')}
          onclick={() => send({ type: 'stop' })}
        />
      {:else}
        <IconButton
          icon="reload"
          label={t('toolbar.reload')}
          title={t('toolbar.reloadTitle')}
          onclick={() => send({ type: 'reload' })}
        />
      {/if}
    </Capsule>
    <ol class="strip" bind:this={strip} aria-label={t('toolbar.openTabs')}>
      {#each tabs as tab (tab.id)}
        {@const active = tab.id === activeTabId}
        <li class="chip" class:active>
          {#if active}
            <div class="pill">
              {#if tab.security !== 'local'}
                <Button
                  size="sm"
                  icon={tab.security === 'secure' ? 'lock' : tab.security === 'dangerous' ? 'warning' : 'info'}
                  class={['site', tab.security]}
                  title={t('toolbar.siteInfo')}
                  aria-label={tab.security === 'secure' ? t('toolbar.siteInfoSecure') : t('toolbar.siteInfoNotSecure')}
                  onclick={() => send({ type: 'open-site-info' })}
                >
                  {#if tab.security === 'insecure' || tab.security === 'dangerous'}{t('toolbar.notSecure')}{/if}
                </Button>
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
              <button
                class="address"
                class:after-site={tab.security !== 'local' || tab.isPrivate}
                title={t('toolbar.addressTitle')}
                aria-current="page"
                onclick={() => send({ type: 'open-address' })}
              >
                {@render favicon(tab)}
                <span class="label">{siteLabel(tab)}</span>
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
                    <Button
                      size="sm"
                      variant="tonal"
                      icon={activeTab.consoleErrors > 0 ? 'warning' : 'gauge'}
                      class={['dev-state', activeTab.consoleErrors > 0 && 'has-errors']}
                      aria-label={t('toolbar.developerStatus', { states: states.join(', ') })}
                      title={states.join(' · ')}
                      onclick={() => send({ type: 'open-dev-menu' })}
                    >
                      {activeTab.consoleErrors > 0 ? consoleErrorCount(activeTab) : states.length}
                    </Button>
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
                onclick={() => send({ type: 'close-tab', id: tab.id })}
              />
              {#if tab.loading}<span class="loading" aria-label={t('toolbar.loading')}></span>{/if}
            </div>
          {:else}
            <button
              class="select"
              class:private={tab.isPrivate}
              title={tab.isPrivate ? t('toolbar.privateTabTitle', { title: tab.title }) : tab.title}
              onclick={() => send({ type: 'activate-tab', id: tab.id })}
              onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
            >
              {@render favicon(tab)}
              <span class="label">{siteLabel(tab)}</span>
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
            <IconButton
              size="sm"
              icon="close"
              tone="muted"
              class="close"
              label={t('toolbar.close')}
              onclick={() => send({ type: 'close-tab', id: tab.id })}
            />
            {#if tab.loading}<span class="loading" aria-label={t('toolbar.loading')}></span>{/if}
          {/if}
        </li>
      {/each}
    </ol>
    <div class="new-tab-slot">
      <NewTabButton />
    </div>
  </div>

  <div class="side trailing" bind:this={trailing} style:margin-right="{-trailingOverhang}px">
    <Capsule>
      {#if pendingUpdate?.state === 'ready'}
        <IconButton
          icon="update"
          tone="accent"
          label={t('toolbar.updateReady', { version: pendingUpdate.version })}
          onclick={openUpdatePopup}
        >
          <span class="update-dot" aria-hidden="true"></span>
        </IconButton>
      {:else if pendingUpdate}
        <IconButton
          icon="update"
          tone="muted"
          label={t('toolbar.updateDownloading', { version: pendingUpdate.version, percent: pendingUpdate.percent })}
          onclick={() => send({ type: 'open-settings' })}
        >
          <svg class="ring" class:indeterminate={pendingUpdate.percent === 0} viewBox="0 0 28 28" aria-hidden="true">
            <circle
              cx="14"
              cy="14"
              r="12.5"
              pathLength="100"
              stroke-dasharray="{pendingUpdate.percent === 0 ? 25 : Math.max(2, pendingUpdate.percent)} 100"
            />
          </svg>
        </IconButton>
      {/if}
      {#each buttons as id (id)}
        {@render button(id)}
      {/each}
    </Capsule>
  </div>
</header>

<style>
  .toolbar {
    display: flex;
    grid-area: bar;
    align-items: center;
    gap: 8px;
    min-width: 0;
    -webkit-app-region: drag;
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
    flex: none;
    width: 92px;
  }

  @media (max-width: 760px) {
    .new-tab-slot {
      width: var(--chrome-control-size);
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
    flex: none;
    align-items: center;
    max-width: 150px;
    height: var(--chrome-control-size);
    padding-right: 5px;
    border-radius: 999px;
    transition: background var(--transition);
    -webkit-app-region: no-drag;
  }

  .chip:not(.active):hover {
    background: var(--surface-hover);
  }

  .chip.active {
    gap: 6px;
    width: clamp(280px, 34vw, 480px);
    max-width: none;
    min-width: 160px;
    padding-right: 0;
    flex-shrink: 1;
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

  .chip:not(.active) :global(.close) {
    position: absolute;
    right: 5px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition);
  }

  .chip:not(.active):hover :global(.close),
  .chip :global(.close:focus-visible) {
    opacity: 1;
    pointer-events: auto;
  }

  .chip:not(.active):hover .label,
  .chip:not(.active):focus-within .label {
    mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent calc(100% - 8px));
  }

  .select,
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

  .select.private {
    font-style: italic;
  }

  .chip :global(.site) {
    margin-left: 4px;
  }

  .chip :global(.site.insecure) {
    color: var(--warn);
  }

  .chip :global(.site.dangerous) {
    color: #d93025;
    font-weight: 600;
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

  .tab-group :global(.dev-state.has-errors) {
    color: var(--warn);
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

  .update-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--surface-strong);
    pointer-events: none;
    animation: pulse 2s ease-in-out 3;
  }

  @keyframes pulse {
    50% {
      box-shadow:
        0 0 0 1.5px var(--surface-strong),
        0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
    }
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
    .ring.indeterminate,
    .update-dot {
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

  .favicon {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }

  .chip:not(.active) .favicon {
    opacity: 0.7;
  }

  .favicon img {
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .loading {
    position: absolute;
    right: 16px;
    bottom: 1px;
    left: 16px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite alternate;
  }

  .chip.active .loading {
    overflow: hidden;
    background: transparent;
    animation: none;
  }

  .chip.active .loading::after {
    position: absolute;
    top: 0;
    left: 0;
    width: 28%;
    height: 100%;
    border-radius: inherit;
    background: #f28c28;
    content: '';
    animation: search-sweep 1.4s ease-in-out infinite;
  }

  @keyframes search-sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(360%);
    }
  }

  @keyframes pulse {
    from {
      opacity: 0.2;
    }
    to {
      opacity: 0.7;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chip.active .loading::after {
      width: 100%;
      animation: none;
    }
  }
</style>
