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
  const DEVICE_BEZEL = 10;

  let browser: BrowserState = $state({
    tabs: [],
    activeTabId: null,
    totalMemoryMB: null,
    addressPlaceholder: 'Ara veya adres yaz',
    device: null,
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
  <main class="page" aria-hidden="true">
    {#if browser.device}
      {@const device = browser.device}
      <div class="device-label" style:left="{device.x - DEVICE_BEZEL}px" style:top="{device.y - DEVICE_BEZEL - 20}px" style:width="{device.viewWidth + 2 * DEVICE_BEZEL}px">
        {device.label} · {device.width}×{device.height}{device.scale < 1 ? ` · %${Math.round(device.scale * 100)}` : ''}
      </div>
      <div
        class="device"
        style:left="{device.x - DEVICE_BEZEL}px"
        style:top="{device.y - DEVICE_BEZEL}px"
        style:width="{device.viewWidth + 2 * DEVICE_BEZEL}px"
        style:height="{device.viewHeight + 2 * DEVICE_BEZEL}px"
        style:border-radius="{Math.round(device.cornerRadius * device.scale) + DEVICE_BEZEL}px"
      ></div>
    {/if}
  </main>
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
    position: relative;
    overflow: hidden;
    background: var(--surface);
  }

  .device {
    position: absolute;
    background: #1d1d1b;
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.2);
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
