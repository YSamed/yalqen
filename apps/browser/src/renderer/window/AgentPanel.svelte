<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type {
    AgentBackgroundChat,
    AgentChatState,
    AgentElementRef,
    AgentProviderId,
    AgentSessionState,
    ProjectRunState,
    TabSnapshot,
  } from '../../shared/types';
  import { AGENT_LABELS, DEFAULT_AGENT_PANEL_WIDTH, SIGN_IN_PROVIDERS } from '../../shared/agent-panel';
  import type { AgentChatComposer } from '../../shared/agent-panel';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import AgentChat from './AgentChat.svelte';
  import BackgroundChats from './BackgroundChats.svelte';
  import AgentHistory from './AgentHistory.svelte';
  import ProviderMark, { type ProviderActivity } from './ProviderMark.svelte';

  let {
    open,
    session,
    chat,
    providers,
    activeTab,
    tabs,
    developer,
    run,
    elements,
    terminal,
    projectId,
    conversationId,
    backgroundChats,
    width,
    collapsed,
    fading,
    onresize,
    oncollapse,
  }: {
    open: boolean;
    session: AgentSessionState;
    chat: AgentChatState;
    providers: AgentProviderId[];
    activeTab: TabSnapshot | null;
    tabs: TabSnapshot[];
    developer: boolean;
    run: ProjectRunState;
    elements: AgentElementRef[];
    terminal: boolean;
    projectId: string;
    conversationId: string;
    backgroundChats: AgentBackgroundChat[];
    width: number;
    collapsed: boolean;
    fading: boolean;
    onresize(width: number): void;
    oncollapse(collapsed: boolean): void;
  } = $props();

  let requesting = $state(false);
  let historyOpen = $state(false);
  const composers = new SvelteMap<string, AgentChatComposer>();

  function composerFor(id: string): AgentChatComposer {
    return untrack(() => {
      let composer = composers.get(id);
      if (!composer) {
        const created = $state<AgentChatComposer>({ text: '', attachments: [], images: [] });
        composer = created;
        composers.set(id, composer);
      }
      return composer;
    });
  }

  // Closed tabs are not reported here, so only the shown conversation and unsent drafts are kept.
  $effect(() => {
    const current = conversationId;
    untrack(() => {
      for (const [id, composer] of composers)
        if (id !== current && !composer.text.trim() && !composer.attachments.length && !composer.images.length)
          composers.delete(id);
    });
  });
  const chatBusy = $derived(['starting', 'thinking', 'approval'].includes(chat.status));
  const PROVIDER_LABELS = AGENT_LABELS;
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
  let finishedUnseen = $state(false);
  let wasWorking = false;
  const working = $derived(
    view === 'terminal' ? session.status === 'starting' : chatBusy && chat.status !== 'approval',
  );
  const activity: ProviderActivity = $derived(
    hasError
      ? 'error'
      : view === 'chat' && chat.status === 'approval'
        ? 'waiting'
        : working
          ? 'working'
          : finishedUnseen
            ? 'done'
            : 'idle',
  );

  $effect(() => {
    const busy = working || (view === 'chat' && chat.status === 'approval');
    if (wasWorking && !busy && collapsed) finishedUnseen = true;
    if (busy || !collapsed) finishedUnseen = false;
    wasWorking = busy;
  });

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
    void window.yalqen.newAgentChat().catch(() => undefined);
  }

  function startNewChat(): void {
    if (chat.id) newChat();
    oncollapse(false);
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

  $effect(() => {
    void conversationId;
    historyOpen = false;
  });

  onMount(() => {
    try {
      if (localStorage.getItem('yalqen-agent-view') === 'terminal') preferredView = 'terminal';
    } catch {}
  });
</script>

<section
  class="agent-panel"
  class:collapsed
  class:fading
  style:width={collapsed ? null : `${width}px`}
  aria-label={t('agentPanel.toggle')}
>
  {#if collapsed}
    <div class="rail">
      <IconButton
        size="lg"
        variant="surface"
        label="{t('agentPanel.expand')} · {view === 'terminal'
          ? 'Claude Code'
          : PROVIDER_LABELS[chat.provider]}{showStatus ? ` · ${status}` : ''}"
        title={showStatus ? status : t('agentPanel.expand')}
        onclick={() => oncollapse(false)}
      >
        <ProviderMark mark={view === 'terminal' ? 'claude-code' : chat.provider} {activity} />
      </IconButton>
      <span class="visually-hidden" role="status">{showStatus ? status : ''}</span>
      {#if view === 'chat'}
        <IconButton size="lg" variant="surface" icon="plus" label={t('agentChat.newChat')} onclick={startNewChat} />
      {/if}
      <IconButton
        class="rail-toggle"
        size="lg"
        variant="surface"
        tone="muted"
        icon="panel-expand-right"
        label={t('agentPanel.expand')}
        aria-expanded="false"
        onclick={() => oncollapse(false)}
      />
    </div>
  {/if}
  <button
    hidden={collapsed}
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
  <header hidden={collapsed}>
    <div class="identity">
      <span class="header-mark"
        ><ProviderMark mark={view === 'terminal' ? 'claude-code' : chat.provider} {activity} /></span
      >
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
      {:else if view === 'chat'}
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
      {#if view === 'chat' && SIGN_IN_PROVIDERS.includes(chat.provider) && chat.error !== 'authentication-required'}
        <IconButton
          icon="profile"
          label={t('agentChat.signOutOf', { agent: PROVIDER_LABELS[chat.provider] })}
          disabled={chatBusy}
          onclick={() => void window.yalqen.signOutAgent().catch(() => false)}
        />
      {/if}
      <IconButton
        icon="panel-close-right"
        label={t('agentPanel.collapse')}
        aria-expanded="true"
        onclick={() => oncollapse(true)}
      />
      <IconButton
        icon="close"
        label={t('agentPanel.close')}
        onclick={() => window.yalqen.send({ type: 'toggle-agent-panel' })}
      />
    </div>
  </header>
  {#if !collapsed && view === 'chat' && backgroundChats.length}<BackgroundChats chats={backgroundChats} />{/if}
  {#if !collapsed && (session.directory || terminal)}
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
  {#if historyOpen && view === 'chat' && !collapsed}
    <div class="panel-view"><AgentHistory onclose={() => (historyOpen = false)} /></div>
  {/if}
  {#key conversationId}
    <div class="panel-view chat-view" id="agent-chat" hidden={collapsed || view !== 'chat' || historyOpen}>
      <AgentChat
        composer={composerFor(conversationId)}
        open={open && !collapsed && view === 'chat' && !historyOpen}
        directory={session.directory}
        {activeTab}
        {tabs}
        {developer}
        {elements}
        onchoose={() => void chooseProject()}
      />
    </div>
  {/key}
  {#key projectId}
    {#if terminal}
      <div class="panel-view" id="agent-terminal" hidden={collapsed || view !== 'terminal'}>
        {#if TerminalView}
          <TerminalView
            open={open && !collapsed && view === 'terminal'}
            {session}
            {activeTab}
            onchoose={chooseProject}
          />
        {/if}
      </div>
    {/if}
  {/key}
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
  .agent-panel > * {
    transition: opacity 120ms ease-out;
  }
  .fading > * {
    opacity: 0;
  }
  .agent-panel.collapsed {
    background: transparent;
    box-shadow: none;
  }
  .rail {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    padding: 4px 5px 0 0;
  }
  .rail :global(.rail-toggle) {
    margin-top: auto;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .resize-handle[hidden],
  header[hidden] {
    display: none;
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
    gap: 8px;
    min-width: 0;
  }
  .header-mark {
    display: grid;
    flex: none;
    width: 26px;
    height: 26px;
    margin-left: -4px;
  }
  .header-mark :global(.glyph) {
    width: 16px;
    height: 16px;
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
