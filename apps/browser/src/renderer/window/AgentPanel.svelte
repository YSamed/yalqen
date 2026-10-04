<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    AgentChatState,
    AgentElementRef,
    AgentProviderId,
    AgentSessionState,
    ProjectRunState,
    TabSnapshot,
  } from '../../shared/types';
  import { DEFAULT_AGENT_PANEL_WIDTH } from '../../shared/agent-panel';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import AgentChat from './AgentChat.svelte';
  import AgentHistory from './AgentHistory.svelte';

  let {
    open,
    session,
    chat,
    providers,
    activeTab,
    run,
    elements,
    terminal,
    width,
    onresize,
  }: {
    open: boolean;
    session: AgentSessionState;
    chat: AgentChatState;
    providers: AgentProviderId[];
    activeTab: TabSnapshot | null;
    run: ProjectRunState;
    elements: AgentElementRef[];
    terminal: boolean;
    width: number;
    onresize(width: number): void;
  } = $props();

  let requesting = $state(false);
  let historyOpen = $state(false);
  const chatBusy = $derived(['starting', 'thinking', 'approval'].includes(chat.status));
  const PROVIDER_LABELS: Record<AgentProviderId, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
  const providerOptions = $derived(providers.map((value) => ({ value, label: PROVIDER_LABELS[value] })));
  const providerLocked = $derived(chatBusy || chat.status === 'ready');
  let preferredView = $state<'chat' | 'terminal'>('chat');
  let TerminalView = $state.raw<typeof import('./AgentTerminal.svelte').default | null>(null);
  const view = $derived(terminal ? preferredView : 'chat');
  let press: { id: number; x: number; width: number } | null = null;
  const active = $derived(session.status === 'starting' || session.status === 'running');
  const runActive = $derived(run.status === 'starting' || run.status === 'running');
  const runFailed = $derived(run.status === 'error');
  const projectLocked = $derived(active || runActive || Boolean(chat.id && chat.status !== 'stopped'));
  const projectName = $derived(session.directory?.split('/').filter(Boolean).pop() ?? t('agentPanel.chooseProject'));
  const statusLabels = {
    idle: t('agentPanel.ready'),
    starting: t('agentPanel.starting'),
    running: t('agentPanel.running'),
    exited: t('agentPanel.exited'),
    error: t('agentPanel.failed'),
  };
  const chatLabels = {
    idle: t('agentPanel.ready'),
    starting: t('agentPanel.starting'),
    thinking: t('agentChat.thinking'),
    approval: t('agentChat.waiting'),
    ready: t('agentChat.chatReady'),
    stopped: t('agentPanel.exited'),
    error: t('agentPanel.failed'),
  };
  const status = $derived(view === 'terminal' ? statusLabels[session.status] : chatLabels[chat.status]);
  const hasError = $derived(view === 'terminal' ? session.status === 'error' : chat.status === 'error');
  const showStatus = $derived(
    view === 'terminal' ? session.status !== 'idle' : chat.status !== 'idle' && chat.status !== 'ready',
  );
  const sessionOpen = $derived(
    view === 'terminal' ? active : ['starting', 'thinking', 'approval', 'ready'].includes(chat.status),
  );
  async function chooseProject(): Promise<boolean> {
    requesting = true;
    try {
      return Boolean(await window.yalqen.selectAgentDirectory());
    } catch {
      return false;
    } finally {
      requesting = false;
    }
  }

  async function startRun(): Promise<void> {
    requesting = true;
    try {
      await window.yalqen.startProjectRun();
    } catch {
    } finally {
      requesting = false;
    }
  }

  function stopRun(): void {
    void window.yalqen.stopProjectRun().catch(() => undefined);
  }

  function openRun(): void {
    if (run.url) window.yalqen.send({ type: 'new-tab', url: run.url });
  }

  function stop(): void {
    if (session.id) void window.yalqen.stopAgentSession(session.id).catch(() => undefined);
  }

  function selectView(next: 'chat' | 'terminal'): void {
    preferredView = next;
    try {
      localStorage.setItem('yalqen-agent-view', next);
    } catch {}
  }

  function newChat(): void {
    void window.yalqen.resetAgentChat(chat.id).catch(() => undefined);
  }

  function beginResize(event: PointerEvent & { currentTarget: HTMLButtonElement }): void {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    press = { id: event.pointerId, x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent): void {
    if (press?.id === event.pointerId) onresize(press.width + press.x - event.clientX);
  }

  function resizeByKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onresize(width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 40 : 10));
  }

  $effect(() => {
    if (terminal && !TerminalView)
      void import('./AgentTerminal.svelte').then((module) => (TerminalView = module.default)).catch(() => undefined);
  });

  onMount(() => {
    try {
      if (localStorage.getItem('yalqen-agent-view') === 'terminal') preferredView = 'terminal';
    } catch {}
  });
</script>

<section class="agent-panel" aria-label={t('agentPanel.toggle')}>
  <button
    class="resize-handle"
    aria-label={t('agentPanel.resize')}
    title={t('agentPanel.resize')}
    onpointerdown={beginResize}
    onpointermove={moveResize}
    onpointerup={() => (press = null)}
    onpointercancel={() => (press = null)}
    onlostpointercapture={() => (press = null)}
    onkeydown={resizeByKeyboard}
    ondblclick={() => onresize(DEFAULT_AGENT_PANEL_WIDTH)}
  ></button>
  <header>
    <div class="identity">
      <strong>Yalqen AI</strong>
      <span
        class="status"
        class:error={hasError}
        class:waiting={view === 'chat' && chat.status === 'approval'}
        role="status"
        >{#if showStatus}<span class="dot" class:active={sessionOpen}></span>{status}{/if}</span
      >
    </div>
    <div class="actions">
      {#if view === 'terminal' && active}
        <IconButton icon="stop" label={t('agentPanel.stop')} onclick={stop} />
      {:else if view === 'chat' && chat.id}
        <IconButton icon="plus" label={t('agentChat.newChat')} onclick={newChat} />
      {/if}
      {#if view === 'chat' && providers.length > 1}
        {#if providerLocked}
          <span class="provider" title={t('agentChat.provider')}>{PROVIDER_LABELS[chat.provider]}</span>
        {:else}
          <Select
            variant="ghost"
            aria-label={t('agentChat.provider')}
            title={t('agentChat.provider')}
            value={chat.provider}
            options={providerOptions}
            onchange={(provider) => void window.yalqen.selectAgentProvider(provider).catch(() => false)}
          />
        {/if}
      {/if}
      {#if view === 'chat' && session.directory && chat.provider === 'claude'}
        <IconButton
          icon="history"
          label={t('agentChat.history')}
          aria-pressed={historyOpen}
          disabled={chatBusy}
          onclick={() => (historyOpen = !historyOpen)}
        />
      {/if}
      <IconButton
        icon="close"
        label={t('agentPanel.close')}
        onclick={() => window.yalqen.send({ type: 'toggle-agent-panel' })}
      />
    </div>
  </header>
  {#if session.directory || terminal}
    <div class="bar">
      {#if session.directory}<Button
          class="project"
          variant="tonal"
          icon="folder"
          title={[
            session.directory ?? t('agentPanel.chooseProject'),
            projectLocked ? t('agentChat.changeProjectHint') : null,
          ]
            .filter(Boolean)
            .join('\n')}
          disabled={projectLocked || requesting}
          onclick={chooseProject}>{projectName}</Button
        >{/if}
      {#if session.directory && run.command}
        <div class="run">
          {#if run.status === 'running' && run.url}
            <Button
              class="run-url"
              variant="tonal"
              icon="globe"
              title={t('agentRun.open', { url: run.url })}
              onclick={openRun}>{new URL(run.url).host}</Button
            >
          {:else if runActive}
            <span class="run-status">{t(run.status === 'starting' ? 'agentRun.starting' : 'agentRun.running')}</span>
          {/if}
          {#if runActive}
            <IconButton icon="stop" label={t('agentRun.stop')} onclick={stopRun} />
          {:else}
            <IconButton
              icon="play"
              tone={runFailed ? 'warn' : 'accent'}
              label={runFailed
                ? t('agentRun.failed', { command: run.command })
                : t('agentRun.start', { command: run.command })}
              disabled={requesting}
              onclick={startRun}
            />
          {/if}
        </div>
      {/if}
      {#if terminal}<SegmentedControl
          label={t('agentChat.view')}
          options={[
            { value: 'chat', label: t('agentChat.chat') },
            { value: 'terminal', label: t('agentChat.terminal') },
          ]}
          value={view}
          onchange={selectView}
        />{/if}
    </div>
  {/if}
  {#if historyOpen && view === 'chat'}
    <div class="panel-view"><AgentHistory onclose={() => (historyOpen = false)} /></div>
  {/if}
  <div class="panel-view chat-view" id="agent-chat" hidden={view !== 'chat' || historyOpen}>
    <AgentChat
      open={open && view === 'chat' && !historyOpen}
      directory={session.directory}
      {activeTab}
      {elements}
      onchoose={() => void chooseProject()}
    />
  </div>
  {#if terminal}
    <div class="panel-view" id="agent-terminal" hidden={view !== 'terminal'}>
      {#if TerminalView}
        <TerminalView open={open && view === 'terminal'} {session} {activeTab} onchoose={chooseProject} />
      {/if}
    </div>
  {/if}
</section>

<style>
  .agent-panel {
    --ai-gutter: 16px;
    --ai-text: 13px;
    --ai-small: 12px;
    --ai-meta: 11px;
    --ai-mono: 11.5px;
    --ai-mono-font: 'SF Mono', Menlo, monospace;
    --ai-radius: 12px;
    container: agent-panel / inline-size;
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    overflow: visible;
    border-radius: 16px;
    background: var(--page);
    box-shadow: var(--page-shadow);
    -webkit-app-region: no-drag;
  }
  :global([data-material='glass']) .agent-panel {
    background: transparent;
    box-shadow: none;
  }
  .resize-handle {
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    left: -8px;
    width: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }
  .resize-handle::after {
    position: absolute;
    top: 12px;
    bottom: 12px;
    left: 3px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
    content: '';
    opacity: 0;
    transition: opacity var(--transition);
  }
  .resize-handle:hover::after,
  .resize-handle:focus-visible::after {
    opacity: 1;
  }
  header,
  .bar,
  .identity,
  .actions,
  .status {
    display: flex;
    align-items: center;
  }
  header {
    flex: none;
    justify-content: space-between;
    gap: 8px;
    height: 48px;
    padding: 0 10px 0 var(--ai-gutter);
  }
  .identity {
    flex: 1;
    gap: 10px;
    min-width: 0;
  }
  .identity strong {
    flex: none;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.2px;
    white-space: nowrap;
  }
  .actions {
    flex: none;
    gap: 2px;
  }
  .status {
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .status.waiting {
    color: var(--accent);
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .dot.active {
    background: var(--accent);
  }
  .status.error .dot {
    background: var(--warn);
  }
  .bar {
    flex: none;
    gap: 6px;
    min-width: 0;
    padding: 0 10px 10px var(--ai-gutter);
  }
  .bar :global(.segmented) {
    margin-left: auto;
  }
  .bar :global(.project) {
    flex: none;
    max-width: 45%;
  }
  .bar :global(.project:disabled) {
    color: var(--text);
    opacity: 1;
  }
  .run {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
  }
  .run :global(.run-url) {
    flex: 0 1 auto;
    min-width: 0;
    padding-right: 4px;
    background: none;
  }
  .run :global(.icon-btn:not([class*='tone-'])) {
    color: var(--text-muted);
  }
  .run :global(.icon-btn:not([class*='tone-']):hover:not(:disabled)) {
    color: var(--text);
  }
  .run-status {
    padding: 0 4px 0 12px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    white-space: nowrap;
  }
  .provider {
    padding: 0 8px;
    color: var(--text-muted);
    font-size: var(--ai-small);
  }
  .agent-panel :global(.select-trigger.ghost) {
    height: var(--control-md);
    padding: 0 6px 0 8px;
    border-radius: var(--radius-control);
    font-size: var(--ai-small);
  }
  .agent-panel :global(.select-trigger.ghost:hover),
  .agent-panel :global(.select-trigger.ghost[aria-expanded='true']) {
    background-color: var(--surface-hover);
  }
  .agent-panel :global(.select-content) {
    font-size: var(--ai-small);
  }
  @container agent-panel (width < 360px) {
    .run :global(.run-url > span) {
      display: none;
    }
    .run :global(.run-url) {
      width: var(--control-md);
      padding: 0;
    }
  }
  .panel-view {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  .panel-view[hidden] {
    display: none;
  }
</style>
