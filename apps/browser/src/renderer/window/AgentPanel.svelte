<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { AgentChatState, AgentSessionState, AgentTerminalOutput, TabSnapshot } from '../../shared/types';
  import { DEFAULT_AGENT_PANEL_WIDTH } from '../../shared/agent-panel';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';
  import AgentChat from './AgentChat.svelte';

  let {
    open,
    session,
    chat,
    activeTab,
    width,
    onresize,
  }: {
    open: boolean;
    session: AgentSessionState;
    chat: AgentChatState;
    activeTab: TabSnapshot | null;
    width: number;
    onresize(width: number): void;
  } = $props();

  let container: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon;
  let terminalReady = $state(false);
  let requesting = $state(false);
  let view = $state<'chat' | 'terminal'>('chat');
  const terminalVisible = $derived(open && view === 'terminal');
  let failed = $state(false);
  let destroyed = false;
  let replayVersion = 0;
  let hydrating = true;
  let sessionId: string | null = null;
  let sequence = 0;
  let buffered: AgentTerminalOutput[] = [];
  let bufferedLength = 0;
  let press: { id: number; x: number; width: number } | null = null;
  const active = $derived(session.status === 'starting' || session.status === 'running');
  const projectLocked = $derived(active || Boolean(chat.id && chat.status !== 'stopped'));
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
  const sessionOpen = $derived(
    view === 'terminal' ? active : ['starting', 'thinking', 'approval', 'ready'].includes(chat.status),
  );
  const errors = {
    'claude-not-found': t('agentPanel.claudeNotFound'),
    'invalid-directory': t('agentPanel.invalidDirectory'),
    'terminal-unavailable': t('agentPanel.terminalUnavailable'),
    'connection-failed': t('agentPanel.connectionFailed'),
    'start-failed': t('agentPanel.startFailed'),
  };

  function fit(): void {
    if (!terminalVisible || !terminal || !container.clientWidth || !container.clientHeight) return;
    fitAddon.fit();
  }

  function applyOutput(output: AgentTerminalOutput): void {
    if (output.sessionId !== sessionId || output.sequence <= sequence) return;
    sequence = output.sequence;
    terminal?.write(output.data);
  }

  async function hydrate(): Promise<void> {
    const version = ++replayVersion;
    hydrating = true;
    buffered = [];
    bufferedLength = 0;
    try {
      const snapshot = await window.yalqen.getAgentTerminal();
      if (destroyed || version !== replayVersion) return;
      if (!snapshot) throw new Error('Terminal unavailable');
      sessionId = snapshot.state.id;
      sequence = snapshot.sequence;
      terminal?.reset();
      if (snapshot.data) terminal?.write(snapshot.data);
      hydrating = false;
      for (const output of buffered) applyOutput(output);
      buffered = [];
      bufferedLength = 0;
      failed = false;
      fit();
    } catch {
      if (!destroyed && version === replayVersion) {
        hydrating = false;
        failed = true;
      }
    }
  }

  async function chooseProject(): Promise<void> {
    requesting = true;
    try {
      if (!(await window.yalqen.selectAgentDirectory())) throw new Error('Window unavailable');
      failed = false;
    } catch {
      failed = true;
    } finally {
      requesting = false;
    }
  }

  async function start(): Promise<void> {
    requesting = true;
    try {
      fit();
      if (!(await window.yalqen.startAgentSession({ cols: terminal?.cols ?? 80, rows: terminal?.rows ?? 24 }))) {
        throw new Error('Window unavailable');
      }
      failed = false;
      terminal?.focus();
    } catch {
      failed = true;
    } finally {
      requesting = false;
    }
  }

  async function stop(): Promise<void> {
    if (!session.id) return;
    try {
      await window.yalqen.stopAgentSession(session.id);
    } catch {
      failed = true;
    }
  }

  function selectView(next: 'chat' | 'terminal'): void {
    view = next;
    try {
      localStorage.setItem('yalqen-agent-view', next);
    } catch {}
  }

  function viewKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectView(view === 'chat' ? 'terminal' : 'chat');
    const list = event.currentTarget as HTMLDivElement;
    void tick().then(() => list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  }

  async function newChat(): Promise<void> {
    try {
      await window.yalqen.resetAgentChat(chat.id);
    } catch {
      failed = true;
    }
  }

  function addCurrentTab(): void {
    if (!activeTab?.agentObserved || !session.id || session.status !== 'running') return;
    const reference = JSON.stringify({ tab_id: activeTab.id, url: activeTab.url });
    window.yalqen.writeAgentTerminal(session.id, ` Yalqen ${reference} `);
    terminal?.focus();
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
    if (!terminalReady) return;
    void session.id;
    untrack(() => void hydrate());
  });

  $effect(() => {
    if (terminalReady && terminal) terminal.options.disableStdin = session.status !== 'running';
  });

  $effect(() => {
    if (!terminalVisible || !terminalReady) return;
    void tick().then(() => {
      if (destroyed || !terminalVisible) return;
      fit();
      if (!document.activeElement?.closest('.view-switch')) terminal?.focus();
    });
  });

  onMount(() => {
    try {
      if (localStorage.getItem('yalqen-agent-view') === 'terminal') view = 'terminal';
    } catch {}
    terminal = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5000,
      cursorBlink: false,
      disableStdin: true,
      macOptionIsMeta: true,
      screenReaderMode: true,
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    const setTheme = () => {
      if (!terminal) return;
      const styles = getComputedStyle(container);
      terminal.options.theme = {
        background: styles.backgroundColor,
        foreground: styles.color,
        cursor: '#f28c28',
        selectionBackground: theme.matches ? '#634428' : '#fce7d1',
      };
    };
    setTheme();
    theme.addEventListener('change', setTheme);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (
        (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
        event.key.toLowerCase() === 'c' &&
        terminal?.hasSelection()
      ) {
        event.preventDefault();
        void navigator.clipboard.writeText(terminal.getSelection()).catch(() => undefined);
        return false;
      }
      return !event.metaKey;
    });
    const input = terminal.onData((data) => {
      if (!session.id || session.status !== 'running') return;
      for (let offset = 0; offset < data.length; offset += 65536) {
        window.yalqen.writeAgentTerminal(session.id, data.slice(offset, offset + 65536));
      }
    });
    const resize = terminal.onResize((size) => {
      if (sessionId) window.yalqen.resizeAgentTerminal(sessionId, size);
    });
    const offOutput = window.yalqen.onAgentOutput((output) => {
      if (hydrating || output.sessionId !== sessionId) {
        buffered.push(output);
        bufferedLength += output.data.length;
        while (bufferedLength > 1024 * 1024 && buffered.length > 1) bufferedLength -= buffered.shift()!.data.length;
      } else applyOutput(output);
    });
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    terminalReady = true;
    return () => {
      destroyed = true;
      observer.disconnect();
      theme.removeEventListener('change', setTheme);
      offOutput();
      input.dispose();
      resize.dispose();
      terminal?.dispose();
      terminal = null;
    };
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
      <img src="./newtab-mark.png" alt="" />
      <div><strong>Yalqen <span>AI</span></strong><small>Claude Code</small></div>
    </div>
    <div class="actions">
      {#if view === 'terminal' && active}
        <IconButton icon="stop" label={t('agentPanel.stop')} size="sm" onclick={stop} />
      {:else if view === 'chat' && chat.id}
        <IconButton icon="plus" label={t('agentChat.newChat')} size="sm" onclick={newChat} />
      {/if}
      <IconButton
        icon="close"
        label={t('agentPanel.close')}
        size="sm"
        onclick={() => window.yalqen.send({ type: 'toggle-agent-panel' })}
      />
    </div>
  </header>
  <div class="context">
    <button
      class="project"
      title={[
        session.directory ?? t('agentPanel.chooseProject'),
        projectLocked ? t('agentChat.changeProjectHint') : null,
      ]
        .filter(Boolean)
        .join('\n')}
      disabled={projectLocked || requesting}
      onclick={chooseProject}
    >
      <span class="project-icon"><Icon name="folder" size={14} /></span><span class="project-text"
        ><small>{t('agentChat.project')}</small><span>{projectName}</span></span
      ><Icon name="down" size={11} />
    </button>
    <span
      class="status"
      class:active={sessionOpen}
      class:error={hasError}
      class:waiting={view === 'chat' && chat.status === 'approval'}
      role="status"
    >
      <span class="dot"></span>{status}
    </span>
  </div>
  <div class="view-switch" role="tablist" tabindex="-1" aria-label={t('agentChat.view')} onkeydown={viewKey}>
    <button
      role="tab"
      id="agent-chat-tab"
      aria-controls="agent-chat"
      aria-selected={view === 'chat'}
      tabindex={view === 'chat' ? 0 : -1}
      onclick={() => selectView('chat')}><Icon name="sparkle" size={12} />{t('agentChat.chat')}</button
    >
    <button
      role="tab"
      id="agent-terminal-tab"
      aria-controls="agent-terminal"
      aria-selected={view === 'terminal'}
      tabindex={view === 'terminal' ? 0 : -1}
      onclick={() => selectView('terminal')}><Icon name="code" size={12} />{t('agentChat.terminal')}</button
    >
  </div>
  <div
    class="panel-view chat-view"
    id="agent-chat"
    role="tabpanel"
    aria-labelledby="agent-chat-tab"
    hidden={view !== 'chat'}
  >
    <AgentChat open={open && view === 'chat'} directory={session.directory} {activeTab} onchoose={chooseProject} />
  </div>
  <div
    class="panel-view terminal-view"
    id="agent-terminal"
    role="tabpanel"
    aria-labelledby="agent-terminal-tab"
    hidden={view !== 'terminal'}
  >
    {#if activeTab?.agentObserved}
      <button class="tab-context" disabled={session.status !== 'running'} title={activeTab.url} onclick={addCurrentTab}>
        <Icon name="globe" size={12} /><span>{activeTab.title}</span><span class="tab-action"
          >{t('agentPanel.addTab')}</span
        >
      </button>
    {/if}
    <div class="terminal-area">
      <div class="terminal" bind:this={container}></div>
      {#if !session.id}
        <div class="empty">
          <div class="mark"><Icon name="code" size={22} /></div>
          <h2>{t('agentChat.terminalWelcome')}</h2>
          <p>{t('agentChat.terminalIntro')}</p>
          {#if session.directory}
            <Button variant="primary" disabled={requesting} onclick={start}>{t('agentPanel.start')}</Button>
          {:else}
            <Button variant="primary" icon="folder" disabled={requesting} onclick={chooseProject}
              >{t('agentPanel.chooseProject')}</Button
            >
          {/if}
          <p class="note">{t('agentPanel.connectionHint')}</p>
        </div>
      {/if}
    </div>
    {#if failed || session.error || session.status === 'exited'}
      <footer>
        <p role="status">
          {failed
            ? t('agentPanel.startFailed')
            : session.error
              ? errors[session.error]
              : session.exitCode
                ? t('agentPanel.exitCode', { code: session.exitCode })
                : t('agentPanel.exited')}
        </p>
        <div class="footer-actions">
          {#if session.error === 'claude-not-found'}
            <Button
              size="sm"
              onclick={() => window.yalqen.send({ type: 'new-tab', url: 'https://code.claude.com/docs/en/setup' })}
              >{t('agentPanel.installGuide')}</Button
            >
          {/if}
          {#if failed && active}
            <Button size="sm" onclick={hydrate}>{t('agentPanel.retry')}</Button>
          {:else if session.directory && !active}
            <Button size="sm" variant="tonal" disabled={requesting} onclick={start}>{t('agentPanel.newSession')}</Button
            >
          {/if}
        </div>
      </footer>
    {/if}
  </div>
</section>

<style>
  .agent-panel {
    --agent-tint: color-mix(in srgb, var(--accent) 6%, var(--page));
    --agent-ink: light-dark(#a95211, #f2b16e);
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    overflow: visible;
    border-radius: 16px;
    background: color-mix(in srgb, var(--accent) 1.5%, var(--page));
    box-shadow: var(--page-shadow);
    -webkit-app-region: no-drag;
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
  .context,
  .identity,
  .actions,
  .project,
  .tab-context,
  .status,
  .footer-actions {
    display: flex;
    align-items: center;
  }
  header {
    justify-content: space-between;
    min-height: 58px;
    padding: 0 14px 0 18px;
  }
  .identity {
    gap: 10px;
  }
  .identity img {
    width: 24px;
    height: 24px;
  }
  .identity strong {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    letter-spacing: -0.2px;
  }
  .identity strong span {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--agent-tint);
    color: var(--agent-ink);
    font-size: 8px;
    letter-spacing: 0.025em;
  }
  .identity small {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 9px;
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
  .view-switch {
    display: flex;
    flex: none;
    gap: 3px;
    margin: 11px 14px 4px;
    padding: 3px;
    border-radius: 8px;
    background: var(--surface-hover);
  }
  .view-switch button {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 27px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition:
      background 120ms ease-out,
      color 120ms ease-out,
      transform 160ms ease-out;
  }
  .view-switch button[aria-selected='true'] {
    background: var(--page);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
    color: var(--text);
  }
  .view-switch button:hover {
    color: var(--text);
  }
  .view-switch button:active {
    transform: scale(0.98);
  }
  .view-switch button:focus-visible,
  .project:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .terminal-view {
    padding-top: 10px;
  }
  .status.waiting {
    color: var(--agent-ink);
  }
  .project-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--page-divider);
    border-radius: 7px;
    background: var(--page);
  }
  .project-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .project-text small {
    color: var(--text-muted);
    font-size: 8px;
  }
  .project-text > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
  }
  @media (prefers-reduced-motion: reduce) {
    .view-switch button {
      transition: none;
    }
  }
  strong {
    font-size: 12px;
    font-weight: 600;
  }
  .actions {
    gap: 4px;
  }
  .context {
    justify-content: space-between;
    gap: 10px;
    margin: 0 14px;
    padding: 9px 10px;
    border: 1px solid var(--page-divider);
    border-radius: 10px;
    background: var(--surface-hover);
  }
  .project {
    appearance: none;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .tab-context > span:first-of-type {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .project :global(svg),
  .tab-context :global(svg) {
    flex: none;
  }
  .project:disabled {
    cursor: default;
  }
  .status {
    flex: none;
    gap: 5px;
    color: var(--text-muted);
    font-size: 9px;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .status.active .dot {
    background: var(--agent-ink);
  }
  .status.error .dot {
    background: var(--warn);
  }
  .tab-context {
    gap: 6px;
    margin: 0 10px 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: 10px;
    text-align: left;
  }
  .tab-action {
    flex: none;
    margin-left: auto;
    color: var(--accent);
  }
  .tab-context:disabled {
    opacity: 0.6;
  }
  .terminal-area {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 0 8px 10px 12px;
    overflow: hidden;
  }
  .terminal {
    height: 100%;
    background: var(--page);
    color: var(--text);
    user-select: text;
  }
  .terminal :global(.xterm) {
    height: 100%;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    overflow-y: auto;
    padding: 24px 18px;
    background: var(--page);
    text-align: center;
  }
  .empty > :global(*) {
    flex-shrink: 0;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: 16px;
    border-radius: 14px;
    background: var(--surface-hover);
    color: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .empty p {
    max-width: 240px;
    margin: 8px 0 18px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.6;
  }
  .empty p.note {
    margin: 16px 0 0;
    font-size: 10px;
  }
  footer {
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
  }
  footer p {
    margin: 0 0 8px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.5;
  }
  .footer-actions {
    justify-content: flex-end;
    gap: 6px;
  }
</style>
