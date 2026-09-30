<script lang="ts">
  import type { DownloadsSummary, TabId, TabSnapshot, TranslationStatus } from '../../shared/types';
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
    updateReady,
    leadingInset,
    trailingInset,
    trailingOverhang = 0,
    trailingWidth,
  }: {
    tabs: TabSnapshot[];
    developer: boolean;
    activeTabId: TabId | null;
    zoom: number;
    defaultZoom: number;
    downloads: DownloadsSummary;
    ready: boolean;
    extensions: boolean;
    updateReady: string | null;
    leadingInset: number;
    trailingInset: number;
    trailingOverhang?: number;
    trailingWidth: number;
  } = $props();

  let brokenIcons: Record<string, true> = $state({});
  let strip: HTMLElement | undefined = $state();
  const send = window.yalqen.send;
  const translateTitle: Record<TranslationStatus, string> = {
    idle: 'Sayfayı çevir',
    translating: 'Sayfa çevriliyor…',
    translated: 'Özgün sayfayı göster',
    failed: 'Çeviri başarısız, tekrar dene',
  };
  let dropKey = $state(0);
  let seenStarts: number | null = null;
  const activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) ?? null);

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

  $effect(() => {
    void activeTabId;
    strip?.querySelector('.chip.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

<header class="toolbar" style:padding-left="{leadingInset}px" style:padding-right="{trailingInset}px">
  <div class="side leading" aria-hidden="true"></div>

  <div class="tab-group" style:transform="translateX({(trailingInset - leadingInset) / 2}px)">
    <Capsule as="nav" ariaLabel="Gezinme">
      <IconButton icon="back" label="Geri" disabled={!activeTab?.canGoBack} onclick={() => send({ type: 'go-back' })} />
      <IconButton
        icon="forward"
        label="İleri"
        disabled={!activeTab?.canGoForward}
        onclick={() => send({ type: 'go-forward' })}
      />
      {#if activeTab?.loading}
        <IconButton icon="close" label="Durdur" title="Durdur (Esc)" onclick={() => send({ type: 'stop' })} />
      {:else}
        <IconButton icon="reload" label="Yenile" title="Yenile (⌘R)" onclick={() => send({ type: 'reload' })} />
      {/if}
    </Capsule>
    <ol class="strip" bind:this={strip} aria-label="Açık sekmeler">
      {#each tabs as tab (tab.id)}
        {@const active = tab.id === activeTabId}
        <li class="chip" class:active>
          {#if active && tab.security !== 'local'}
            <Button
              size="sm"
              icon={tab.security === 'secure' ? 'lock' : tab.security === 'dangerous' ? 'warning' : 'info'}
              class={['site', tab.security]}
              title="Site bilgisi"
              aria-label={tab.security === 'secure' ? 'Bağlantı güvenli, site bilgisi' : 'Güvenli değil, site bilgisi'}
              onclick={() => send({ type: 'open-site-info' })}
            >
              {#if tab.security === 'insecure' || tab.security === 'dangerous'}Güvenli değil{/if}
            </Button>
          {/if}
          {#if active}
            {#if developer}
              <span
                class="private-badge developer"
                title="Geliştirici penceresi: temiz oturum, reklam ve üçüncü taraf çerez engeli kapalı, pencereler kapanınca silinir"
              >
                <Icon name="gauge" size={14} />
              </span>
            {:else if tab.isPrivate}
              <span class="private-badge" title="Gizli sekme: geçmiş kaydedilmez, çerezler sekmeler kapanınca silinir">
                <Icon name="private" size={14} />
              </span>
            {/if}
            <button
              class="address"
              class:after-site={tab.security !== 'local' || tab.isPrivate}
              title="Ara veya adres yaz (⌘L)"
              aria-current="page"
              onclick={() => send({ type: 'open-address' })}
            >
              {@render favicon(tab)}
              <span class="label">{siteLabel(tab)}</span>
            </button>
            {#if tab.url.startsWith('http') || tab.url.startsWith('file:')}
              <IconButton
                size="sm"
                icon="star"
                tone={tab.bookmarked ? 'accent' : 'muted'}
                class="star"
                label={tab.bookmarked ? 'Yer iminden kaldır' : 'Yer imlerine ekle'}
                title={tab.bookmarked ? 'Yer iminden kaldır (⌘D)' : 'Yer imlerine ekle (⌘D)'}
                aria-pressed={tab.bookmarked}
                onclick={() => send({ type: 'toggle-bookmark' })}
              />
            {/if}
            {#if tab.translation.available}
              {#if tab.translation.status === 'idle' || tab.translation.status === 'failed'}
                <IconButton
                  size="sm"
                  icon="translate"
                  tone={tab.translation.status === 'failed' ? 'warn' : 'muted'}
                  label={translateTitle[tab.translation.status]}
                  onclick={() => send({ type: 'toggle-translation' })}
                />
              {:else}
                <Button
                  size="sm"
                  variant="tonal"
                  icon="translate"
                  disabled={tab.translation.status === 'translating'}
                  aria-pressed={tab.translation.status === 'translated'}
                  title={translateTitle[tab.translation.status]}
                  onclick={() => send({ type: 'toggle-translation' })}
                >
                  {tab.translation.status === 'translating' ? 'Çevriliyor…' : 'Çevrildi'}
                </Button>
              {/if}
            {/if}
            {#if tab.blockedPopups > 0}
              <IconButton
                size="sm"
                icon="popup-blocked"
                variant="tonal"
                tone="warn"
                label="{tab.blockedPopups} açılır pencere engellendi"
                title="Açılır pencere engellendi"
                onclick={() => send({ type: 'open-blocked-popups' })}
              />
            {/if}
            {#if devStates(tab).length > 0}
              {@const states = devStates(tab)}
              <Button
                size="sm"
                variant="tonal"
                icon={tab.consoleErrors > 0 ? 'warning' : 'gauge'}
                class={['dev-state', tab.consoleErrors > 0 && 'has-errors']}
                aria-label="Geliştirici durumu: {states.join(', ')}"
                title={states.join(' · ')}
                onclick={() => send({ type: 'open-dev-menu' })}
              >
                {tab.consoleErrors > 0 ? consoleErrorCount(tab) : states.length}
              </Button>
            {/if}
            {#if Math.round(zoom * 100) !== Math.round(defaultZoom * 100)}
              <Button
                size="sm"
                variant="tonal"
                class="zoom"
                title="Varsayılan yakınlaştırmaya dön (⌘0)"
                onclick={() => send({ type: 'reset-zoom' })}
              >
                %{Math.round(zoom * 100)}
              </Button>
            {/if}
          {:else}
            <button
              class="select"
              class:private={tab.isPrivate}
              title={tab.isPrivate ? `${tab.title} (gizli)` : tab.title}
              onclick={() => send({ type: 'activate-tab', id: tab.id })}
              onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
            >
              {@render favicon(tab)}
              <span class="label">{siteLabel(tab)}</span>
            </button>
          {/if}
          {#if tab.audible || tab.muted}
            <IconButton
              size="sm"
              icon={tab.muted ? 'muted' : 'sound'}
              tone="muted"
              label={tab.muted ? 'Sesi aç' : 'Sessize al'}
              aria-pressed={tab.muted}
              onclick={() => send({ type: 'toggle-mute', id: tab.id })}
            />
          {/if}
          <IconButton
            size="sm"
            icon="close"
            tone="muted"
            class="close"
            label="Kapat"
            onclick={() => send({ type: 'close-tab', id: tab.id })}
          />
          {#if tab.loading}<span class="loading" aria-label="Yükleniyor"></span>{/if}
        </li>
      {/each}
    </ol>
    <div class="new-tab-slot">
      <NewTabButton />
    </div>
  </div>

  <div class="side trailing" style:margin-right="{-trailingOverhang}px">
    <Capsule minWidth={trailingWidth} spread>
      {#if updateReady}
        <IconButton
          icon="update"
          tone="accent"
          label="Yalqen {updateReady} hazır, güncellemek için yeniden başlat"
          onclick={() => send({ type: 'install-update' })}
        />
      {/if}
      <IconButton icon="bookmarks" label="Yer imleri" onclick={() => send({ type: 'open-bookmarks-menu' })} />
      <IconButton icon="history" label="Geçmiş" title="Geçmiş (⌘Y)" onclick={() => send({ type: 'open-history' })} />
      {#if extensions}
        <IconButton icon="extensions" label="Uzantılar" onclick={openExtensionsMenu} />
      {/if}
      <IconButton icon="profile" label="Profil" onclick={() => send({ type: 'open-profile-menu' })} />
      <IconButton
        icon="settings"
        label="Ayarlar"
        title="Ayarlar (⌘,)"
        onclick={() => send({ type: 'open-settings' })}
      />
      <IconButton
        icon="download"
        tone={downloads.active > 0 ? 'accent' : 'default'}
        label={downloads.active > 0 ? `İndirilenler, ${downloads.active} indirme sürüyor` : 'İndirilenler'}
        title="İndirilenler"
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

  :global([data-material='glass']) .chip.active {
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

  .chip:hover {
    background: var(--surface-hover);
  }

  .chip.active {
    width: clamp(220px, 32vw, 420px);
    max-width: none;
    min-width: 120px;
    flex-shrink: 1;
    background: var(--surface);
    box-shadow: var(--shadow);
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

  .chip :global(.star[aria-pressed='true'] path) {
    fill: currentColor;
  }

  .chip :global(.zoom) {
    font-variant-numeric: tabular-nums;
  }

  .chip :global(.dev-state) {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .chip :global(.dev-state.has-errors) {
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
