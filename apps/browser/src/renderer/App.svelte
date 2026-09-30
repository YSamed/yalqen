<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { BrowserState } from '../shared/types';
  import { isNewTab } from './format';
  import DeviceControls from './components/DeviceControls.svelte';
  import TabPanel from './components/TabPanel.svelte';
  import Toolbar from './components/Toolbar.svelte';

  const COLLAPSED_WIDTH = 44;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 360;
  const DEFAULT_WIDTH = 220;
  const CHROME_HEIGHT = 44;
  const PAGE_INSET = 8;
  const PANEL_ROW_INSET = PAGE_INSET + 3;
  const PAGE_RADIUS = 16;
  const WINDOW_CONTROLS_END = 88;
  const PREFS_KEY = 'yalqen:panel:2';
  const DEVICE_BEZEL = 10;
  const PANEL_ANIMATION_MS = 240;

  let browser: BrowserState = $state.raw({
    tabs: [],
    developer: false,
    activeTabId: null,
    pageFullScreen: false,
    windowFullScreen: false,
    addressPlaceholder: 'Ara veya adres yaz',
    panelCollapsed: false,
    panelSide: 'left',
    sidebarVisible: true,
    toolbarVisible: true,
    toolbarTabs: true,
    toolbarButtons: [],
    material: 'opaque',
    device: null,
    zoom: 1,
    defaultZoom: 1,
    downloads: { active: 0, progress: null, started: 0 },
    extensions: false,
    updateReady: null,
  });
  let width = $state(DEFAULT_WIDTH);
  let stateReceived = $state(false);

  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved) {
      width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(saved.width) || DEFAULT_WIDTH));
    }
  } catch {}

  const windowControls = navigator.userAgent.includes('Macintosh');
  const activeTab = $derived(browser.tabs.find((tab) => tab.id === browser.activeTabId) ?? null);
  const collapsed = $derived(browser.panelCollapsed);
  // Each field gets its own signal so the effects below run only when their value changes,
  // not on every state push (a title or favicon update replaces the whole state).
  const material = $derived(browser.material);
  const pageFullScreen = $derived(browser.pageFullScreen);
  const windowFullScreen = $derived(browser.windowFullScreen);
  const panelWidth = $derived(browser.sidebarVisible ? (collapsed ? COLLAPSED_WIDTH : width) : PAGE_INSET);
  const side = $derived(browser.panelSide);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let shownWidth = $state(DEFAULT_WIDTH);
  let pagePanelWidth = $state(DEFAULT_WIDTH);
  let panelMode = '';
  let animateModeChanges = false;
  let panelAnimation = 0;
  const panelSettled = $derived(shownWidth === panelWidth);
  const rightPanel = $derived(side === 'right' && browser.sidebarVisible);

  $effect(() => {
    const target = panelWidth;
    const mode = `${collapsed}|${browser.sidebarVisible}`;
    const modeChanged = mode !== panelMode;
    panelMode = mode;
    cancelAnimationFrame(panelAnimation);
    const from = untrack(() => shownWidth);
    if (!modeChanged || !animateModeChanges || reducedMotion.matches || from === target) {
      shownWidth = target;
      pagePanelWidth = target;
      return;
    }
    // Resizing the native page view every frame makes it reflow and lag behind the chrome,
    // so it moves once: before an expand, after a collapse.
    pagePanelWidth = Math.max(from, target);
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / PANEL_ANIMATION_MS);
      shownWidth = Math.round(from + (target - from) * (1 - (1 - progress) ** 4));
      if (progress < 1) panelAnimation = requestAnimationFrame(step);
      else pagePanelWidth = target;
    };
    panelAnimation = requestAnimationFrame(step);
  });
  const topInset = $derived(browser.toolbarVisible ? CHROME_HEIGHT : PAGE_INSET);
  const blank = $derived(activeTab !== null && isNewTab(activeTab.url));
  $effect(() => {
    document.documentElement.dataset.material = material;
    document.documentElement.toggleAttribute('data-fullscreen', windowFullScreen);
  });

  $effect(() => {
    if (!stateReceived) return;
    window.yalqen.setLayout({
      panelWidth: pagePanelWidth,
      panelSide: side,
      chromeHeight: topInset,
      pageInset: PAGE_INSET,
      pageRadius: PAGE_RADIUS,
      newTabCenterOffset:
        material === 'glass' && !pageFullScreen
          ? ((side === 'right' ? 1 : -1) * Math.max(0, pagePanelWidth - COLLAPSED_WIDTH)) / 2
          : 0,
    });
  });

  $effect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ width }));
    } catch {}
  });

  onMount(() => {
    void window.yalqen.getState().then((next) => {
      browser = next;
      stateReceived = true;
      requestAnimationFrame(() => (animateModeChanges = true));
    });
    const offState = window.yalqen.onState((next) => {
      browser = next;
      stateReceived = true;
    });
    const offWallpaper = window.yalqen.onWallpaper((wallpaper) => {
      const root = document.documentElement;
      root.toggleAttribute('data-wallpaper', wallpaper !== null);
      root.toggleAttribute('data-wallpaper-split', wallpaper?.split ?? false);
      if (wallpaper) root.style.setProperty('--wallpaper', `url("${wallpaper.dataUrl}")`);
      else root.style.removeProperty('--wallpaper');
    });
    return () => {
      offState();
      offWallpaper();
    };
  });
</script>

<div
  class="shell"
  class:right={side === 'right'}
  class:fullscreen={pageFullScreen}
  style:grid-template-columns={pageFullScreen
    ? 'minmax(0, 1fr)'
    : side === 'left'
      ? `${shownWidth}px minmax(0, 1fr)`
      : `minmax(0, 1fr) ${shownWidth}px`}
  style:grid-template-rows={pageFullScreen ? 'minmax(0, 1fr)' : `${topInset}px minmax(0, 1fr)`}
>
  {#if !pageFullScreen}
    {#if browser.sidebarVisible}
      <TabPanel
        tabs={browser.tabs}
        developer={browser.developer}
        activeTabId={browser.activeTabId}
        collapsed={collapsed && panelSettled}
        {side}
        bind:width
        minWidth={MIN_WIDTH}
        maxWidth={MAX_WIDTH}
        {topInset}
        rowInset={PANEL_ROW_INSET}
      />
    {/if}
    {#if browser.toolbarVisible}
      <Toolbar
        developer={browser.developer}
        tabs={browser.toolbarTabs ? browser.tabs : browser.tabs.filter((tab) => tab.id === browser.activeTabId)}
        activeTabId={browser.activeTabId}
        zoom={browser.zoom}
        defaultZoom={browser.defaultZoom}
        downloads={browser.downloads}
        ready={stateReceived}
        extensions={browser.extensions}
        buttons={browser.toolbarButtons}
        updateReady={browser.updateReady}
        leadingInset={windowControls
          ? side === 'left'
            ? Math.max(0, WINDOW_CONTROLS_END - shownWidth)
            : WINDOW_CONTROLS_END
          : 0}
        trailingInset={PAGE_INSET}
        trailingWidth={MIN_WIDTH - 2 * PANEL_ROW_INSET}
        trailingOverhang={rightPanel
          ? shownWidth + PAGE_INSET - (collapsed && panelSettled ? PAGE_INSET : PANEL_ROW_INSET)
          : 0}
      />
    {:else}
      <div class="titlebar-drag" aria-hidden="true"></div>
    {/if}
  {/if}
  <section
    class="page"
    class:blank
    style:margin={pageFullScreen
      ? '0'
      : side === 'left'
        ? `0 ${PAGE_INSET}px ${PAGE_INSET}px 0`
        : `0 0 ${PAGE_INSET}px ${PAGE_INSET}px`}
    style:border-radius={pageFullScreen ? '0' : `${PAGE_RADIUS}px`}
  >
    <div class="viewport" aria-hidden="true">
      {#if browser.device}
        {@const device = browser.device}
        {#if !device.resizable}
          <div
            class="device-label"
            style:left="{device.x - DEVICE_BEZEL}px"
            style:top="{device.y - DEVICE_BEZEL - 20}px"
            style:width="{device.viewWidth + 2 * DEVICE_BEZEL}px"
          >
            {device.label} · {device.width}×{device.height}{device.scale < 1
              ? ` · %${Math.round(device.scale * 100)}`
              : ''}
          </div>
        {/if}
        <div
          class="device"
          style:left="{device.x - DEVICE_BEZEL}px"
          style:top="{device.y - DEVICE_BEZEL}px"
          style:width="{device.viewWidth + 2 * DEVICE_BEZEL}px"
          style:height="{device.viewHeight + 2 * DEVICE_BEZEL}px"
          style:border-radius="{Math.round(device.cornerRadius * device.scale) + DEVICE_BEZEL}px"
        ></div>
      {/if}
    </div>
    {#if browser.device?.resizable}
      <DeviceControls device={browser.device} bezel={DEVICE_BEZEL} />
    {/if}
  </section>
</div>

<style>
  .shell {
    display: grid;
    grid-template-areas:
      'panel bar'
      'panel page';
    height: 100%;
    background: var(--chrome-base);
  }

  .shell.right {
    grid-template-areas:
      'bar panel'
      'page panel';
  }

  .shell.fullscreen,
  .shell.fullscreen.right {
    grid-template-areas: 'page';
  }

  .shell.fullscreen .page {
    box-shadow: none;
  }

  .titlebar-drag {
    grid-area: bar;
    -webkit-app-region: drag;
  }

  .page {
    position: relative;
    display: flex;
    grid-area: page;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--page);
    box-shadow: var(--page-shadow);
  }

  .page.blank {
    background: transparent;
    box-shadow: none;
  }

  .page.blank .viewport {
    background: transparent;
  }

  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--page-empty);
  }

  .device {
    position: absolute;
    background: #1d1d1b;
    box-shadow:
      0 8px 32px rgb(0 0 0 / 0.18),
      0 0 0 1px rgb(0 0 0 / 0.2);
  }

  .device-label {
    position: absolute;
    height: 16px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    line-height: 16px;
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
