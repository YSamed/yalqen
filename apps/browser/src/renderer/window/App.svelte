<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { t } from '../../shared/i18n';
  import type { BrowserState } from '../../shared/types';
  import { slotRect } from '../../shared/split-layout';
  import type { TabGroup } from '../../shared/tab-groups';
  import type { LiveFolderView } from '../../shared/live-folders';
  import { reuseBrowserState } from '../../shared/browser-state';
  import { accentHex, DEFAULT_ACCENT } from '../../shared/accent';
  import { syncRootTheme } from '../chrome/root-theme.svelte';
  import { onBrowserState } from '../chrome/browser-state';
  import { isNewTab } from './format';
  import DeviceControls from './DeviceControls.svelte';
  import BookmarksPanel from './BookmarksPanel.svelte';
  import DevToolsDivider from './DevToolsDivider.svelte';
  import TabPanel from './TabPanel.svelte';
  import Toolbar from './Toolbar.svelte';
  import MenuButton from './MenuButton.svelte';
  import type AgentPanel from '../agent/AgentPanel.svelte';
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
  import { IS_MAC } from '../platform';

  const CONTROL_SIZE = 34;
  const MAC_TLIGHTS_WIDTH = 88;
  const BOOKMARKS_PANEL_WIDTH = 300;
  const PAGE_INSET = 8;
  const PANEL_WIDTH = 190;
  const PAGE_RADIUS = 4;
  const CARD_PAGE_INSET = 7;
  const CHROME_HEIGHT = 47;
  const DEVICE_BEZEL = 10;
  // Measured from Dia: the full-width sidebar slides out and back in, with no squeeze or fade.
  const TUCK_ANIMATION_MS = 160;
  const NO_GROUPS: TabGroup[] = [];
  const NO_LIVE_FOLDERS: LiveFolderView[] = [];
  const NO_SPLIT_GROUPS: NonNullable<BrowserState['splitGroups']> = [];

  let browser: BrowserState = $state.raw({
    tabs: [],
    listOrder: [],
    developer: false,
    activeTabId: null,
    selectedTabIds: [],
    splitTabIds: [],
    pageFullScreen: false,
    windowFullScreen: false,
    panelCollapsed: true,
    favorites: [],
    spaces: [],
    activeSpaceId: '',
    sidebarVisible: true,
    media: null,
    toolbarButtons: [],
    sidebarFooterItems: [],
    material: 'opaque',
    accent: accentHex(DEFAULT_ACCENT),
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
  let AgentPanelComponent: typeof AgentPanel | null = $state(null);
  let agentPanelLoading = $state(false);
  let agentPanelLoadFailed = $state(false);

  const tabs = $derived(browser.tabs);
  const listOrder = $derived(browser.listOrder);
  const activeTabId = $derived(browser.activeTabId);
  const selectedTabIds = $derived(browser.selectedTabIds);
  let pageElement: HTMLElement | undefined = $state();
  let splitDrop: 'left' | 'right' | null = $state(null);
  const tabGroups = $derived(browser.tabGroups ?? NO_GROUPS);
  const activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) ?? null);
  const developer = $derived(browser.developer);
  const profile = $derived(browser.profile);
  const media = $derived(browser.media);
  const favorites = $derived(browser.favorites);
  const spaces = $derived(browser.spaces);
  const activeSpaceId = $derived(browser.activeSpaceId);
  const sidebarVisible = $derived(browser.sidebarVisible);
  const toolbarButtons = $derived(browser.toolbarButtons);
  const downloads = $derived(browser.downloads);
  const extensions = $derived(browser.extensions);
  const device = $derived(browser.device);
  const agentPanelOpen = $derived(browser.agentPanelOpen);
  const agentSession = $derived(browser.agentSession);
  const agentChat = $derived(browser.agentChat);
  const agentProviders = $derived(browser.agentProviders);
  const projectRun = $derived(browser.projectRun);
  const agentElements = $derived(browser.agentElements);
  const agentTerminal = $derived(browser.agentTerminal);
  const agentProjectId = $derived(browser.agentProjectId);
  const agentConversationId = $derived(browser.agentConversationId);
  const agentBackgroundChats = $derived(browser.agentBackgroundChats);
  const agentProjects = $derived(browser.agentProjects);
  const agents = $derived({
    waiting: agentProjects.filter((project) => project.waiting).length,
    working: agentProjects.filter((project) => project.busy && !project.waiting).length,
  });
  const splitTabIds = $derived(browser.splitTabIds);
  const splitGroups = $derived(browser.splitGroups ?? NO_SPLIT_GROUPS);
  const splitWeights = $derived(browser.splitWeights);
  const liveFolders = $derived(browser.liveFolders ?? NO_LIVE_FOLDERS);
  const footerItems = $derived(browser.sidebarFooterItems);
  const devToolsDivider = $derived(browser.devToolsDivider);
  const agentStatus = $derived(
    agentChat.status === 'error'
      ? 'error'
      : ['starting', 'thinking', 'approval', 'ready'].includes(agentChat.status)
        ? 'running'
        : agentSession.status,
  );
  const pageFullScreen = $derived(browser.pageFullScreen);
  const floatingAgent = $derived(browser.agentFloating ?? false);
  const agentVisible = $derived(agentPanelOpen && !pageFullScreen && !floatingAgent);
  const collapsed = $derived(
    browser.panelCollapsed ||
      (agentVisible && windowWidth < PANEL_WIDTH + MIN_AGENT_PANEL_WIDTH + MIN_AGENT_PAGE_WIDTH + CARD_PAGE_INSET * 2),
  );
  const bookmarksPanel = $derived(browser.bookmarksPanel ?? null);
  const bookmarksVisible = $derived(bookmarksPanel !== null && !pageFullScreen && !agentVisible);
  const sideVisible = $derived(agentVisible || bookmarksVisible);
  const windowFullScreen = $derived(browser.windowFullScreen);
  const windowMenu = $derived(browser.windowMenu ?? false);
  // Card style tucks a collapsed sidebar away entirely; the traffic lights then sit inside the page card's toolbar.
  const panelWidth = $derived(sidebarVisible && !collapsed ? PANEL_WIDTH : CARD_PAGE_INSET);
  const agentWidth = $derived(fitAgentPanelWidth(requestedAgentWidth, windowWidth, panelWidth));
  const agentReservedWidth = $derived(
    agentVisible ? agentWidth + CARD_PAGE_INSET : bookmarksVisible ? BOOKMARKS_PANEL_WIDTH + CARD_PAGE_INSET : 0,
  );
  let shownWidth = $state(PANEL_WIDTH);
  let panelSlide = $state(0);
  let panelMode = '';
  let animateModeChanges = false;
  let panelAnimation = 0;
  let contentCollapsed = $state(untrack(() => browser.panelCollapsed));

  let wcoVisible = $state(false);
  let wcoTbRect = $state({ x: 0, y: 0, width: 0, height: 0 });

  $effect(() => {
    const wco = navigator.windowControlsOverlay;
    if (!wco) return;

    const updateRect = () => {
      wcoVisible = wco.visible;
      const { x, y, width, height } = wco.getTitlebarAreaRect();
      wcoTbRect = { x, y, width, height };
    };

    updateRect();

    wco.addEventListener('geometrychange', updateRect);
    window.addEventListener('resize', updateRect);
    return () => {
      wco.removeEventListener('geometrychange', updateRect);
      window.removeEventListener('resize', updateRect);
    };
  });

  let wcoTbUsable = $derived(wcoVisible && wcoTbRect.width > 0);
  let wcoTbleftInset = $derived(wcoTbUsable ? wcoTbRect.x : IS_MAC ? MAC_TLIGHTS_WIDTH : 0);
  let wcoTbrightInset = $derived(wcoTbUsable ? Math.max(0, windowWidth - wcoTbRect.x - wcoTbRect.width) : 0);

  $effect(() => {
    if (!agentVisible || AgentPanelComponent || agentPanelLoading || agentPanelLoadFailed) return;
    agentPanelLoading = true;
    void import('../agent/AgentPanel.svelte')
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

  $effect.pre(() => {
    const target = panelWidth;
    const mode = `${collapsed}|${sidebarVisible}`;
    const modeChanged = mode !== panelMode;
    panelMode = mode;
    cancelAnimationFrame(panelAnimation);
    const from = untrack(() => shownWidth);
    if (!modeChanged || !animateModeChanges || untrack(() => prefersReducedMotion.current) || from === target) {
      shownWidth = target;
      panelSlide = 0;
      contentCollapsed = collapsed;
      return;
    }
    const slides = untrack(() => device === null);
    const duration = TUCK_ANIMATION_MS;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      shownWidth = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      panelSlide = slides ? shownWidth - target : 0;
      if (progress < 1) panelAnimation = requestAnimationFrame(step);
      else {
        contentCollapsed = collapsed;
      }
    };
    panelSlide = slides ? from - target : 0;
    if (!collapsed) contentCollapsed = false;
    panelAnimation = requestAnimationFrame(step);
  });
  const spanToolbar = $derived(sidebarVisible);
  const pageLeft = $derived(panelWidth + panelSlide);
  const splitPanes = $derived.by(() => {
    if (!spanToolbar || pageFullScreen || !activeTabId) return [];
    const groupIndex = splitGroups.findIndex((group) => group.includes(activeTabId));
    const ids: (string | null)[] = [...(splitGroups[groupIndex] ?? [activeTabId])];
    const weights = splitDrop ? undefined : (splitWeights?.[groupIndex] ?? undefined);
    if (splitDrop === 'left') ids.unshift(null);
    else if (splitDrop === 'right') ids.push(null);
    if (ids.length < 2) return [];
    const bounds = {
      x: pageLeft,
      y: 0,
      width: Math.max(0, windowWidth - panelWidth - CARD_PAGE_INSET - agentReservedWidth),
      height: 0,
    };
    return ids.map((id, index) => {
      const { x, width } = slotRect(bounds, { index, count: ids.length, weights });
      return { tab: tabs.find((tab) => tab.id === id) ?? null, x, width };
    });
  });
  const menuInset = $derived(windowMenu && !pageFullScreen && !sidebarVisible ? CARD_PAGE_INSET + CONTROL_SIZE + 8 : 0);
  const blank = $derived(activeTab !== null && isNewTab(activeTab.url));
  syncRootTheme(
    () => browser,
    () => activeTab,
  );

  $effect.pre(() => {
    if (!stateReceived) return;
    window.yalqen.setLayout({
      panelWidth,
      panelSlide,
      chromeHeight: CHROME_HEIGHT,
      pageInset: CARD_PAGE_INSET,
      pageRadius: PAGE_RADIUS,
      agentPanelWidth: agentReservedWidth,
    });
  });

  onMount(() => {
    const offState = onBrowserState((next) => {
      browser = reuseBrowserState(browser, next);
      if (stateReceived) return;
      stateReceived = true;
      requestAnimationFrame(() => (animateModeChanges = true));
    });
    try {
      const savedWidth = Number(localStorage.getItem('yalqen:agent-panel-width'));
      if (Number.isFinite(savedWidth) && savedWidth >= MIN_AGENT_PANEL_WIDTH) requestedAgentWidth = savedWidth;
    } catch {}
    return offState;
  });
</script>

<svelte:window onresize={() => (windowWidth = window.innerWidth)} />

<div
  class="shell"
  class:fullscreen={pageFullScreen}
  class:with-agent={sideVisible}
  style:grid-template-columns={pageFullScreen
    ? 'minmax(0, 1fr)'
    : `${shownWidth}px minmax(0, 1fr)${sideVisible ? ` ${agentReservedWidth}px` : ''}`}
  style:grid-template-rows={pageFullScreen ? 'minmax(0, 1fr)' : `${CHROME_HEIGHT}px minmax(0, 1fr)`}
>
  {#if !pageFullScreen}
    {#if sidebarVisible && !(collapsed && contentCollapsed)}
      <TabPanel
        {tabs}
        {listOrder}
        {developer}
        {activeTabId}
        {selectedTabIds}
        {splitTabIds}
        {splitGroups}
        pageRect={() => pageElement?.getBoundingClientRect()}
        onSplitDrop={(next) => (splitDrop = next)}
        groups={tabGroups}
        slide={shownWidth - PANEL_WIDTH}
        topInset={CHROME_HEIGHT}
        fullWidth={PANEL_WIDTH}
        {agents}
        updateReady={browser.updateReady ?? false}
        {downloads}
        {profile}
        {footerItems}
        tabCleanup={browser.tabCleanup ?? false}
        {favorites}
        {liveFolders}
        {spaces}
        {activeSpaceId}
        {media}
      />
    {/if}
    <Toolbar
      sidebarMenu={sidebarVisible && !collapsed}
      panelCollapsed={collapsed}
      panes={splitPanes}
      {developer}
      modeSwitch={browser.modeSwitch ?? false}
      bookmarksPanelOpen={bookmarksVisible}
      {activeTab}
      {downloads}
      ready={stateReceived}
      {extensions}
      agentAvailable={profile === 'developer'}
      {agentPanelOpen}
      {agentStatus}
      buttons={toolbarButtons}
      span={spanToolbar}
      leadingWidth={shownWidth - Math.max(wcoTbleftInset, menuInset) - PAGE_INSET}
      leadingInset={spanToolbar
        ? Math.max(wcoTbleftInset, menuInset)
        : Math.max(Math.max(0, wcoTbleftInset - shownWidth), menuInset)}
      alignLeading={!sidebarVisible && !IS_MAC}
      trailingInset={CARD_PAGE_INSET + wcoTbrightInset}
      centerOffset={spanToolbar ? 0 : -shownWidth / 2}
    />
  {/if}
  {#if IS_MAC && windowFullScreen && !pageFullScreen}
    <!-- Full screen hides the native window buttons; Dia keeps them, so draw them where macOS puts them. -->
    <div class="traffic-lights">
      <button
        type="button"
        class="light close"
        aria-label={t('menu.closeWindow')}
        title={t('menu.closeWindow')}
        onclick={() => window.yalqen.send({ type: 'window-control', control: 'close' })}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m4.5 4.5 5 5m0-5-5 5" /></svg>
      </button>
      <span class="light minimize" aria-hidden="true"></span>
      <button
        type="button"
        class="light full-screen"
        aria-label={t('window.exitFullScreen')}
        title={t('window.exitFullScreen')}
        onclick={() => window.yalqen.send({ type: 'window-control', control: 'exit-full-screen' })}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7.6 3.8h2.6v2.6zM6.4 10.2H3.8V7.6z" /></svg>
      </button>
    </div>
  {/if}
  {#if windowMenu && !pageFullScreen}
    <div class="menu-button" style:height="{CHROME_HEIGHT}px"><MenuButton /></div>
  {/if}
  {#if devToolsDivider}<DevToolsDivider rect={devToolsDivider} />{/if}
  {#each splitPanes as pane, index (index)}
    {#if pane.tab?.id === activeTabId}
      <div class="pane-ring" style:left="{pane.x}px" style:width="{pane.width}px" aria-hidden="true"></div>
    {/if}
  {/each}
  {#if !splitDrop}
    {#each splitPanes.slice(0, -1) as pane, index (index)}
      <div
        class="split-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('window.resizeSplit')}
        style:left="{pane.x + pane.width}px"
        onpointerdown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onpointermove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            window.yalqen.send({ type: 'resize-split', index, x: event.clientX });
        }}
        onpointerup={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      ></div>
    {/each}
  {/if}
  <section
    bind:this={pageElement}
    class="page"
    class:blank
    class:split={splitPanes.length > 1}
    style:margin={pageFullScreen ? '0' : `0 ${CARD_PAGE_INSET}px ${CARD_PAGE_INSET}px 0`}
    style:border-radius={pageFullScreen || splitPanes.length > 1
      ? '0'
      : blank
        ? `0 0 ${PAGE_RADIUS}px ${PAGE_RADIUS}px`
        : `${PAGE_RADIUS}px`}
  >
    {#each splitPanes as pane, index (index)}
      <div
        class="pane-bg"
        style:left="{pane.x - pageLeft}px"
        style:width="{pane.width}px"
        style:border-radius="0 0 {PAGE_RADIUS}px {PAGE_RADIUS}px"
      ></div>
    {/each}
    <div class="viewport" aria-hidden="true">
      {#if splitDrop}<div class="split-drop" class:left={splitDrop === 'left'}></div>{/if}
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
  {#if bookmarksVisible && bookmarksPanel}
    <div class="agent-slot" id="bookmarks-panel">
      <BookmarksPanel view={bookmarksPanel} {tabs} {activeTabId} />
    </div>
  {/if}
  <div class="agent-slot" id="agent-panel" hidden={!agentVisible}>
    <!-- A floating panel lives in its own view; mounting it here too would run a second chat and terminal. -->
    {#if floatingAgent}{:else if AgentPanelComponent}
      <AgentPanelComponent
        open={agentVisible}
        session={agentSession}
        chat={agentChat}
        providers={agentProviders}
        run={projectRun}
        elements={agentElements}
        terminal={agentTerminal}
        projectId={agentProjectId}
        conversationId={agentConversationId}
        backgroundChats={agentBackgroundChats}
        {tabs}
        {developer}
        {activeTab}
        width={agentWidth}
        onresize={resizeAgentPanel}
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
    position: relative;
    display: grid;
    grid-template-areas:
      'panel bar'
      'panel page';
    height: 100%;
    background: var(--chrome-base);
    transition: background-color var(--transition);
  }

  :global(:root:not([data-mode='private'])) .shell {
    isolation: isolate;
    background-image: linear-gradient(to bottom, var(--card-sidebar-top), var(--card-sidebar-bottom));
  }

  :global(:root[data-frame]:not([data-mode='private'])) .shell {
    background-image: var(--frame-gradient);
  }

  :global(:root:not([data-mode='private'])) .shell::before {
    position: absolute;
    z-index: -1;
    inset: 0;
    pointer-events: none;
  }

  :global(:root[data-frame-texture='grain']:not([data-mode='private'])) .shell::before {
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    content: '';
    mix-blend-mode: overlay;
    opacity: calc(var(--frame-texture-strength) * 0.6);
  }

  :global(:root[data-frame-texture='dots']:not([data-mode='private'])) .shell::before {
    background: radial-gradient(circle, rgb(from var(--text) r g b / 0.5) 0.8px, transparent 1.4px) 0 0 / 8px 8px;
    content: '';
    opacity: var(--frame-texture-strength);
  }

  :global(:root[data-material='glass']:not([data-mode='private'])) .shell {
    background-color: transparent;
  }

  .menu-button {
    position: absolute;
    top: 0;
    left: 8px;
    display: flex;
    align-items: center;
    z-index: 2;
  }

  /* Like Dia, the side panel is a full-height card beside the page, with its header on the toolbar row. */
  .shell.with-agent {
    grid-template-areas:
      'panel bar agent'
      'panel page agent';
  }

  .traffic-lights {
    position: absolute;
    z-index: 3;
    /* Same circles as the native buttons at WINDOW_CONTROLS_INSET in window.ts. */
    top: 20px;
    left: 18px;
    display: flex;
    gap: 9px;
    -webkit-app-region: no-drag;
  }

  .light {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2);
  }

  .light svg {
    width: 14px;
    height: 14px;
    fill: rgb(0 0 0 / 0.55);
    stroke: rgb(0 0 0 / 0.55);
    stroke-width: 1.2;
    stroke-linecap: round;
    opacity: 0;
  }

  .traffic-lights:hover .light svg {
    opacity: 1;
  }

  .light.close {
    background: #ff5f57;
  }

  .light.close svg {
    fill: none;
  }

  .light.minimize {
    background: #febc2e;
  }

  .light.full-screen {
    background: #28c840;
  }

  .light.full-screen svg {
    stroke: none;
  }

  .agent-slot {
    grid-area: agent;
    min-width: 0;
    min-height: 0;
    margin: 0 8px 8px 0;
  }

  .shell.with-agent:not(.fullscreen) .agent-slot {
    margin-top: 6px;
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

  .shell.fullscreen {
    grid-template-areas: 'page';
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
  }

  .page.split {
    background: transparent;
  }

  /* Outside the toolbar on purpose: a ring inside its drag region would turn page clicks into window drags. */
  .pane-ring {
    position: fixed;
    top: 6px;
    bottom: 7px;
    z-index: 2;
    border-radius: 10px;
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 70%, transparent);
    pointer-events: none;
  }

  .split-divider {
    position: fixed;
    top: 6px;
    bottom: 7px;
    z-index: 5;
    width: 6px;
    cursor: col-resize;
    -webkit-app-region: no-drag;
  }

  .split-divider::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2px;
    height: 32px;
    border-radius: 1px;
    background: var(--text-muted);
    content: '';
    opacity: 0;
    transform: translate(-50%, -50%);
    transition: opacity var(--transition);
  }

  .split-divider:hover::after {
    opacity: 0.6;
  }

  .pane-bg {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--page);
  }

  .page.blank {
    background: var(--page-veil);
  }

  :global(:root[data-mode='developer']) .page {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 85%, transparent),
      0 0 18px -2px color-mix(in srgb, var(--accent) 60%, transparent),
      0 0 42px -6px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .page.split .viewport,
  .page.blank .viewport {
    background: transparent;
  }

  .split-drop {
    position: absolute;
    inset: 0 0 0 50%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .split-drop.left {
    inset: 0 50% 0 0;
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
