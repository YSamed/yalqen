<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { BrowserState } from '../../shared/types';
  import { reuseBrowserState } from '../../shared/browser-state';
  import { isNewTab } from './format';
  import DeviceControls from './DeviceControls.svelte';
  import TabPanel from './TabPanel.svelte';
  import Toolbar from './Toolbar.svelte';
  import type AgentPanel from './AgentPanel.svelte';
  import {
    EMPTY_AGENT_SESSION,
    EMPTY_AGENT_CHAT,
    EMPTY_PROJECT_RUN,
    DEFAULT_AGENT_PANEL_WIDTH,
    MIN_AGENT_PANEL_WIDTH,
    MIN_AGENT_PAGE_WIDTH,
    fitAgentPanelWidth,
  } from '../../shared/agent-panel';
  import Button from '../ui/Button.svelte';

  const COLLAPSED_WIDTH = 44;
  const CONTROL_SIZE = 34;
  const PANEL_WIDTH = 180;
  const CHROME_HEIGHT = 44;
  const PAGE_INSET = 8;
  const PANEL_ROW_INSET = PAGE_INSET + 3;
  const PAGE_RADIUS = 16;
  const WINDOW_CONTROLS_END = 88;
  const DEVICE_BEZEL = 10;
  const PANEL_ANIMATION_MS = 240;
  const CONTENT_SWAP_PROGRESS = 0.5;

  let browser: BrowserState = $state.raw({
    tabs: [],
    listOrder: [],
    developer: false,
    activeTabId: null,
    selectedTabIds: [],
    pageFullScreen: false,
    windowFullScreen: false,
    addressPlaceholder: t('app.addressPlaceholder'),
    panelCollapsed: false,
    panelSide: 'left',
    pinnedDisplay: 'always',
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
    profile: 'personal',
    agentPanelOpen: false,
    agentSession: { ...EMPTY_AGENT_SESSION },
    agentChat: { ...EMPTY_AGENT_CHAT },
    agentProviders: ['claude'],
    projectRun: { ...EMPTY_PROJECT_RUN },
    agentElements: [],
    agentTerminal: false,
    agentProjects: [],
    agentProjectId: '',
    agentConversationId: '',
    agentBackgroundChats: [],
  });
  let stateReceived = $state(false);
  let windowWidth = $state(window.innerWidth);
  let requestedAgentWidth = $state(DEFAULT_AGENT_PANEL_WIDTH);
  let agentCollapsed = $state(false);
  let shownAgentWidth = $state(0);
  let pageAgentWidth = $state(0);
  let agentContentCollapsed = $state(false);
  let agentFading = $state(false);
  let agentMode = '';
  let agentAnimation = 0;
  let AgentPanelComponent: typeof AgentPanel | null = $state(null);
  let agentPanelLoading = $state(false);
  let agentPanelLoadFailed = $state(false);

  const windowControls = navigator.userAgent.includes('Macintosh');
  // Each field gets its own signal so effects and child components run only when their value
  // changes, not on every state push (a title or download update replaces the whole state).
  // Passing `browser.x` to a child would subscribe it to the entire state instead.
  const tabs = $derived(browser.tabs);
  const listOrder = $derived(browser.listOrder);
  const activeTabId = $derived(browser.activeTabId);
  const activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) ?? null);
  const developer = $derived(browser.developer);
  const profile = $derived(browser.profile);
  const pinnedDisplay = $derived(browser.pinnedDisplay);
  const sidebarVisible = $derived(browser.sidebarVisible);
  const toolbarVisible = $derived(browser.toolbarVisible);
  const toolbarButtons = $derived(browser.toolbarButtons);
  const zoom = $derived(browser.zoom);
  const defaultZoom = $derived(browser.defaultZoom);
  const downloads = $derived(browser.downloads);
  const extensions = $derived(browser.extensions);
  const device = $derived(browser.device);
  const showToolbarTabs = $derived(browser.toolbarTabs);
  const toolbarTabs = $derived(showToolbarTabs ? tabs : activeTab ? [activeTab] : []);
  const agentPanelOpen = $derived(browser.agentPanelOpen);
  const agentSession = $derived(browser.agentSession);
  const agentChat = $derived(browser.agentChat);
  const agentStatus = $derived(
    agentChat.status === 'error'
      ? 'error'
      : ['starting', 'thinking', 'approval', 'ready'].includes(agentChat.status)
        ? 'running'
        : agentSession.status,
  );
  const collapsed = $derived(
    browser.panelCollapsed ||
      (agentPanelOpen &&
        !agentCollapsed &&
        windowWidth < PANEL_WIDTH + MIN_AGENT_PANEL_WIDTH + MIN_AGENT_PAGE_WIDTH + PAGE_INSET * 2),
  );
  const material = $derived(browser.material);
  const pageFullScreen = $derived(browser.pageFullScreen);
  const agentVisible = $derived(agentPanelOpen && !pageFullScreen);
  const windowFullScreen = $derived(browser.windowFullScreen);
  const panelWidth = $derived(sidebarVisible ? (collapsed ? COLLAPSED_WIDTH : PANEL_WIDTH) : PAGE_INSET);
  const agentWidth = $derived(fitAgentPanelWidth(requestedAgentWidth, windowWidth, panelWidth));
  const side = $derived(browser.panelSide);
  // The page already keeps an inset on its right edge, so a collapsed rail beside it takes that
  // much less to match the tab rail's spacing.
  const collapsedAgentWidth = $derived(side === 'left' ? COLLAPSED_WIDTH - PAGE_INSET : COLLAPSED_WIDTH);
  const agentReservedWidth = $derived(
    agentVisible ? (agentCollapsed ? collapsedAgentWidth : agentWidth + PAGE_INSET) : 0,
  );
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let shownWidth = $state(PANEL_WIDTH);
  let panelSlide = $state(0);
  let panelMode = '';
  let animateModeChanges = false;
  let panelAnimation = 0;
  let contentCollapsed = $state(untrack(() => browser.panelCollapsed));
  let contentFading = $state(false);
  const panelSettled = $derived(shownWidth === panelWidth);
  const rightPanel = $derived(side === 'right' && sidebarVisible);

  $effect(() => {
    if (!agentPanelOpen || AgentPanelComponent || agentPanelLoading || agentPanelLoadFailed) return;
    agentPanelLoading = true;
    void import('./AgentPanel.svelte')
      .then((module) => {
        AgentPanelComponent = module.default;
      })
      .catch(() => {
        agentPanelLoadFailed = true;
      })
      .finally(() => {
        agentPanelLoading = false;
      });
  });

  function resizeAgentPanel(width: number): void {
    requestedAgentWidth = fitAgentPanelWidth(width, windowWidth, panelWidth);
    try {
      localStorage.setItem('yalqen:agent-panel-width', String(requestedAgentWidth));
    } catch {}
  }

  $effect(() => {
    const target = agentReservedWidth;
    const mode = `${agentCollapsed}|${agentVisible}`;
    const previousMode = agentMode;
    agentMode = mode;
    const toggled = agentVisible && previousMode !== mode && previousMode.endsWith('|true');
    cancelAnimationFrame(agentAnimation);
    const from = untrack(() => shownAgentWidth);
    if (!toggled || !animateModeChanges || reducedMotion.matches || from === target) {
      shownAgentWidth = target;
      pageAgentWidth = target;
      agentContentCollapsed = agentCollapsed;
      agentFading = false;
      return;
    }
    // The native page takes the narrower of both sizes for the whole animation instead of
    // reflowing every frame; the panel then grows over, or shrinks away from, its edge.
    pageAgentWidth = Math.max(from, target);
    agentFading = true;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / PANEL_ANIMATION_MS);
      shownAgentWidth = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      if (agentFading && progress >= CONTENT_SWAP_PROGRESS) {
        agentContentCollapsed = agentCollapsed;
        agentFading = false;
      }
      if (progress < 1) agentAnimation = requestAnimationFrame(step);
      else pageAgentWidth = target;
    };
    agentAnimation = requestAnimationFrame(step);
  });

  function collapseAgentPanel(next: boolean): void {
    agentCollapsed = next;
    try {
      localStorage.setItem('yalqen:agent-panel-collapsed', String(next));
    } catch {}
  }

  $effect(() => {
    const target = panelWidth;
    const mode = `${collapsed}|${sidebarVisible}`;
    const modeChanged = mode !== panelMode;
    panelMode = mode;
    cancelAnimationFrame(panelAnimation);
    const from = untrack(() => shownWidth);
    if (!modeChanged || !animateModeChanges || reducedMotion.matches || from === target) {
      shownWidth = target;
      panelSlide = 0;
      contentCollapsed = collapsed;
      contentFading = false;
      return;
    }
    // Resizing the native page view every frame makes it reflow and lag behind the chrome, so it
    // takes its final size up front and only slides with the panel. Emulated devices just resize.
    const slides = untrack(() => device === null);
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / PANEL_ANIMATION_MS);
      shownWidth = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      panelSlide = slides ? shownWidth - target : 0;
      if (contentFading && progress >= CONTENT_SWAP_PROGRESS) {
        contentCollapsed = collapsed;
        contentFading = false;
      }
      if (progress < 1) panelAnimation = requestAnimationFrame(step);
    };
    panelSlide = slides ? from - target : 0;
    contentFading = true;
    panelAnimation = requestAnimationFrame(step);
  });
  const topInset = $derived(toolbarVisible ? CHROME_HEIGHT : PAGE_INSET);
  const blank = $derived(activeTab !== null && isNewTab(activeTab.url));
  $effect(() => {
    document.documentElement.dataset.material = material;
    document.documentElement.toggleAttribute('data-fullscreen', windowFullScreen);
  });

  $effect(() => {
    if (!stateReceived) return;
    window.yalqen.setLayout({
      panelWidth,
      panelSlide,
      panelSide: side,
      chromeHeight: topInset,
      pageInset: PAGE_INSET,
      pageRadius: PAGE_RADIUS,
      agentPanelWidth: pageAgentWidth,
      newTabCenterOffset:
        material === 'glass' && !pageFullScreen
          ? ((side === 'right' ? 1 : -1) * Math.max(0, panelWidth - COLLAPSED_WIDTH) + pageAgentWidth) / 2
          : 0,
    });
  });

  onMount(() => {
    try {
      const savedWidth = Number(localStorage.getItem('yalqen:agent-panel-width'));
      if (Number.isFinite(savedWidth) && savedWidth >= MIN_AGENT_PANEL_WIDTH) requestedAgentWidth = savedWidth;
      agentCollapsed = localStorage.getItem('yalqen:agent-panel-collapsed') === 'true';
    } catch {}
    void window.yalqen.getState().then((next) => {
      browser = reuseBrowserState(browser, next);
      stateReceived = true;
      requestAnimationFrame(() => (animateModeChanges = true));
    });
    const offState = window.yalqen.onState((serializedState) => {
      browser = reuseBrowserState(browser, JSON.parse(serializedState));
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

<svelte:window onresize={() => (windowWidth = window.innerWidth)} />

<div
  class="shell"
  class:right={side === 'right'}
  class:fullscreen={pageFullScreen}
  class:with-agent={agentVisible}
  style:grid-template-columns={pageFullScreen
    ? 'minmax(0, 1fr)'
    : side === 'left'
      ? `${shownWidth}px minmax(0, 1fr)${agentVisible ? ` ${shownAgentWidth}px` : ''}`
      : `minmax(0, 1fr) ${shownWidth}px${agentVisible ? ` ${shownAgentWidth}px` : ''}`}
  style:grid-template-rows={pageFullScreen ? 'minmax(0, 1fr)' : `${topInset}px minmax(0, 1fr)`}
>
  {#if !pageFullScreen}
    {#if sidebarVisible}
      <TabPanel
        {tabs}
        {listOrder}
        {developer}
        {activeTabId}
        selectedTabIds={browser.selectedTabIds}
        collapsed={contentCollapsed}
        fading={contentFading}
        {side}
        {topInset}
        rowInset={PANEL_ROW_INSET}
        edgeInset={(COLLAPSED_WIDTH - CONTROL_SIZE) / 2}
        fullWidth={PANEL_WIDTH}
        {profile}
        profileName={browser.profileName}
        {pinnedDisplay}
      />
    {/if}
    {#if toolbarVisible}
      <Toolbar
        {developer}
        tabs={toolbarTabs}
        {activeTabId}
        {zoom}
        {defaultZoom}
        {downloads}
        ready={stateReceived}
        {extensions}
        agentAvailable={profile !== 'private'}
        {agentPanelOpen}
        {agentStatus}
        buttons={toolbarButtons}
        leadingInset={windowControls
          ? side === 'left'
            ? Math.max(0, WINDOW_CONTROLS_END - shownWidth)
            : WINDOW_CONTROLS_END
          : 0}
        trailingInset={PAGE_INSET}
        centerOffset={(side === 'left' ? -shownWidth : shownWidth + shownAgentWidth) / 2}
        trailingOverhang={(rightPanel
          ? shownWidth + PAGE_INSET - (collapsed && panelSettled ? PAGE_INSET : PANEL_ROW_INSET)
          : 0) + (side === 'right' ? shownAgentWidth : 0)}
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
      {#if device}
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
    {#if device?.resizable}
      <DeviceControls {device} bezel={DEVICE_BEZEL} />
    {/if}
  </section>
  {#if agentVisible && side === 'right'}<div class="agent-titlebar" aria-hidden="true"></div>{/if}
  <div
    class="agent-slot"
    class:animating={shownAgentWidth !== agentReservedWidth}
    class:collapsed={agentContentCollapsed}
    id="agent-panel"
    hidden={!agentVisible}
  >
    {#if AgentPanelComponent}
      <AgentPanelComponent
        open={agentVisible}
        session={agentSession}
        chat={agentChat}
        providers={browser.agentProviders}
        run={browser.projectRun}
        elements={browser.agentElements}
        terminal={browser.agentTerminal}
        projectId={browser.agentProjectId}
        conversationId={browser.agentConversationId}
        backgroundChats={browser.agentBackgroundChats}
        tabs={browser.tabs}
        developer={browser.developer}
        {activeTab}
        width={agentWidth}
        collapsed={agentContentCollapsed}
        fading={agentFading}
        onresize={resizeAgentPanel}
        oncollapse={collapseAgentPanel}
      />
    {:else}
      <div class="agent-loading" role="status">
        <p>{t(agentPanelLoadFailed ? 'agentPanel.loadFailed' : 'agentPanel.loading')}</p>
        {#if agentPanelLoadFailed}
          <Button size="sm" onclick={() => (agentPanelLoadFailed = false)}>{t('agentPanel.retry')}</Button>
        {/if}
      </div>
    {/if}
  </div>
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

  .shell.with-agent {
    grid-template-areas:
      'panel bar bar'
      'panel page agent';
  }

  .shell.right.with-agent {
    grid-template-areas:
      'bar panel agentbar'
      'page panel agent';
  }

  .agent-titlebar {
    grid-area: agentbar;
    -webkit-app-region: drag;
    pointer-events: none;
  }

  .agent-slot {
    grid-area: agent;
    min-width: 0;
    min-height: 0;
    margin: 0 8px 8px 0;
  }

  .agent-slot.collapsed {
    margin-right: 0;
  }

  .agent-slot.animating {
    overflow: clip;
  }

  .agent-slot[hidden] {
    display: none;
  }

  .agent-loading {
    display: grid;
    place-content: center;
    height: 100%;
    padding: 20px;
    border-radius: 16px;
    background: var(--page);
    box-shadow: var(--page-shadow);
    color: var(--text-muted);
    text-align: center;
  }

  :global([data-material='glass']) .agent-loading {
    background: transparent;
    box-shadow: none;
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
