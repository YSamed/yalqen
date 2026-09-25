<script lang="ts">
  import { onMount } from 'svelte';
  import type { BrowserState } from '../shared/types';
  import TabPanel from './components/TabPanel.svelte';
  import Toolbar from './components/Toolbar.svelte';

  const TOOLBAR_HEIGHT = 44;
  const COLLAPSED_WIDTH = 48;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 400;
  const DEFAULT_WIDTH = 240;
  const PREFS_KEY = 'yalqen:panel';

  let browser: BrowserState = $state({
    tabs: [],
    activeTabId: null,
    totalMemoryMB: null,
    addressPlaceholder: 'Ara veya adres yaz',
  });
  let collapsed = $state(false);
  let width = $state(DEFAULT_WIDTH);
  let toolbar: Toolbar;

  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved) {
      collapsed = Boolean(saved.collapsed);
      width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(saved.width) || DEFAULT_WIDTH));
    }
  } catch {
    // Preferences are optional.
  }

  const activeTab = $derived(browser.tabs.find((tab) => tab.id === browser.activeTabId) ?? null);
  const panelWidth = $derived(collapsed ? COLLAPSED_WIDTH : width);

  $effect(() => {
    window.yalqen.setLayout({ toolbarHeight: TOOLBAR_HEIGHT, panelWidth });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ collapsed, width }));
    } catch {
      // Preferences are optional.
    }
  });

  onMount(() => {
    void window.yalqen.getState().then((next) => (browser = next));
    const offState = window.yalqen.onState((next) => (browser = next));
    const offCommand = window.yalqen.onCommand((command) => {
      if (command.type === 'toggle-panel') collapsed = !collapsed;
      if (command.type === 'focus-address') toolbar.focusAddress();
    });
    return () => {
      offState();
      offCommand();
    };
  });
</script>

<div class="shell" style:grid-template-columns="1fr {panelWidth}px">
  <div class="top">
    <Toolbar
      bind:this={toolbar}
      tab={activeTab}
      totalMemoryMB={browser.totalMemoryMB}
      placeholder={browser.addressPlaceholder}
      height={TOOLBAR_HEIGHT}
    />
  </div>
  <!-- The page view is drawn by the main process over this area. -->
  <main class="page" aria-hidden="true"></main>
  <TabPanel
    tabs={browser.tabs}
    activeTabId={browser.activeTabId}
    {collapsed}
    bind:width
    minWidth={MIN_WIDTH}
    maxWidth={MAX_WIDTH}
    onToggle={() => (collapsed = !collapsed)}
  />
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
  }

  .top {
    grid-column: 1 / -1;
  }

  .page {
    background: var(--surface);
  }
</style>
