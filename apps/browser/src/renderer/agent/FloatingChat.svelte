<script lang="ts">
  import { onMount } from 'svelte';
  import { reuseBrowserState } from '../../shared/browser-state';
  import type { BrowserState } from '../../shared/types';
  import AgentPanel from './AgentPanel.svelte';
  import { applyRootTheme, chromeMode, frameThemeOf } from '../window/root-theme';

  let browser = $state.raw<BrowserState | null>(null);
  let width = $state(window.innerWidth);
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  let prefersDark = $state(darkScheme.matches);
  const activeTab = $derived(browser?.tabs.find((tab) => tab.id === browser?.activeTabId) ?? null);
  // One signal per field, as in App.svelte, so a push re-renders only the panel parts whose input changed.
  // The panel mounts only after the first state arrives, and `browser` never returns to null.
  const session = $derived(browser!.agentSession);
  const chat = $derived(browser!.agentChat);
  const providers = $derived(browser!.agentProviders);
  const run = $derived(browser!.projectRun);
  const elements = $derived(browser!.agentElements);
  const terminal = $derived(browser!.agentTerminal);
  const projectId = $derived(browser!.agentProjectId);
  const conversationId = $derived(browser!.agentConversationId);
  const backgroundChats = $derived(browser!.agentBackgroundChats);
  const tabs = $derived(browser!.tabs);
  const developer = $derived(browser!.developer);

  const material = $derived(browser?.material);
  const accent = $derived(browser?.accent);
  const frameTheme = $derived(browser && frameThemeOf(browser));
  const mode = $derived(browser ? chromeMode(browser, activeTab) : 'normal');

  $effect(() => {
    if (material && accent && frameTheme) applyRootTheme({ material, accent, frameTheme }, mode, prefersDark);
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
      {session}
      {chat}
      {providers}
      {run}
      {elements}
      {terminal}
      {projectId}
      {conversationId}
      {backgroundChats}
      {tabs}
      {developer}
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
