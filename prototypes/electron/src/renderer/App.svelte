<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { BrowserState } from '../shared/types';
  import TabPanel from './components/TabPanel.svelte';
  import Toolbar from './components/Toolbar.svelte';

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
    window.yalqen.setLayout({ panelWidth, windowControls: !collapsed });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ collapsed, width }));
    } catch {
      // Preferences are optional.
    }
  });

  async function focusAddress(): Promise<void> {
    collapsed = false;
    await tick();
    toolbar.focusAddress();
  }

  onMount(() => {
    void window.yalqen.getState().then((next) => (browser = next));
    const offState = window.yalqen.onState((next) => (browser = next));
    const offCommand = window.yalqen.onCommand((command) => {
      if (command.type === 'toggle-panel') collapsed = !collapsed;
      if (command.type === 'focus-address') void focusAddress();
    });
    return () => {
      offState();
      offCommand();
    };
  });
</script>

<div class="shell" style:grid-template-columns="1fr {panelWidth}px">
  <!-- The page view is drawn by the main process over this area. -->
  <main class="page" aria-hidden="true"></main>
  <TabPanel
    tabs={browser.tabs}
    activeTabId={browser.activeTabId}
    totalMemoryMB={browser.totalMemoryMB}
    {collapsed}
    bind:width
    minWidth={MIN_WIDTH}
    maxWidth={MAX_WIDTH}
    onToggle={() => (collapsed = !collapsed)}
  >
    {#snippet header()}
      <Toolbar
        bind:this={toolbar}
        tab={activeTab}
        placeholder={browser.addressPlaceholder}
        {collapsed}
        onSearch={() => void focusAddress()}
      />
    {/snippet}
  </TabPanel>
</div>

<style>
  .shell {
    display: grid;
    height: 100%;
  }

  .page {
    background: var(--surface);
  }
</style>
