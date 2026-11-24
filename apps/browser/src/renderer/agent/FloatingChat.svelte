<script lang="ts">
  import { onMount } from 'svelte';
  import { reuseBrowserState } from '../../shared/browser-state';
  import type { BrowserState } from '../../shared/types';
  import AgentPanel from './AgentPanel.svelte';
  import { applyRootTheme, chromeMode } from '../window/root-theme';

  let browser = $state.raw<BrowserState | null>(null);
  let width = $state(window.innerWidth);
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  let prefersDark = $state(darkScheme.matches);
  const activeTab = $derived(browser?.tabs.find((tab) => tab.id === browser?.activeTabId) ?? null);

  $effect(() => {
    if (browser) applyRootTheme(browser, chromeMode(browser, activeTab), prefersDark);
  });

  const INTERACTIVE = 'button, input, textarea, select, a, [role="button"], [role="combobox"], [contenteditable]';
  let drag: { id: number; x: number; y: number } | null = null;

  // The header moves the card; screen coordinates stay valid while the view itself moves under the pointer.
  function beginDrag(event: PointerEvent): void {
    const target = event.target as Element;
    if (event.button !== 0 || !target.closest('header') || target.closest(INTERACTIVE)) return;
    drag = { id: event.pointerId, x: event.screenX, y: event.screenY };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (drag?.id !== event.pointerId) return;
    const dx = event.screenX - drag.x;
    const dy = event.screenY - drag.y;
    if (dx === 0 && dy === 0) return;
    drag = { ...drag, x: event.screenX, y: event.screenY };
    window.yalqen.send({ type: 'move-floating-chat', dx, dy });
  }

  function endDrag(event: PointerEvent): void {
    if (drag?.id === event.pointerId) drag = null;
  }

  function receive(next: BrowserState): void {
    browser = browser ? reuseBrowserState(browser, next) : next;
  }

  onMount(() => {
    const sync = () => (prefersDark = darkScheme.matches);
    darkScheme.addEventListener('change', sync);
    void window.yalqen.getState().then(receive);
    const offState = window.yalqen.onState((serialized) => receive(JSON.parse(serialized)));
    return () => {
      offState();
      darkScheme.removeEventListener('change', sync);
    };
  });
</script>

<svelte:window onresize={() => (width = window.innerWidth)} />

{#if browser}
  <div
    class="card"
    role="presentation"
    onpointerdown={beginDrag}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <AgentPanel
      open
      floating
      session={browser.agentSession}
      chat={browser.agentChat}
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
      {width}
      onresize={() => {}}
    />
  </div>
{/if}

<style>
  :global(html body) {
    background: transparent;
  }

  .card {
    height: 100%;
  }

  .card :global(.agent-panel > header) {
    cursor: grab;
  }
</style>
