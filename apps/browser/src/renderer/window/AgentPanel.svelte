<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { AgentSessionState, AgentTerminalOutput, TabSnapshot } from '../../shared/types';
  import { DEFAULT_AGENT_PANEL_WIDTH } from '../../shared/agent-panel';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';

  let {
    open,
    session,
    activeTab,
    width,
    onresize,
  }: {
    open: boolean;
    session: AgentSessionState;
    activeTab: TabSnapshot | null;
    width: number;
    onresize(width: number): void;
  } = $props();

  let container: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon;
  let terminalReady = $state(false);
  let requesting = $state(false);
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
  const projectName = $derived(session.directory?.split('/').filter(Boolean).pop() ?? t('agentPanel.chooseProject'));
  const statusLabels = {
    idle: t('agentPanel.ready'),
    starting: t('agentPanel.starting'),
    running: t('agentPanel.running'),
    exited: t('agentPanel.exited'),
    error: t('agentPanel.failed'),
  };
  const errors = {
    'claude-not-found': t('agentPanel.claudeNotFound'),
    'invalid-directory': t('agentPanel.invalidDirectory'),
    'terminal-unavailable': t('agentPanel.terminalUnavailable'),
    'connection-failed': t('agentPanel.connectionFailed'),
    'start-failed': t('agentPanel.startFailed'),
  };

  function fit(): void {
    if (!open || !terminal || !container.clientWidth || !container.clientHeight) return;
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
    if (!open || !terminalReady) return;
    void tick().then(() => {
      if (destroyed || !open) return;
      fit();
      terminal?.focus();
    });
  });

  onMount(() => {
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
        cursor: theme.matches ? '#a79bff' : '#7055d6',
        selectionBackground: theme.matches ? '#514766' : '#e4dff5',
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
    <div class="identity"><Icon name="sparkle" /><strong>Claude Code</strong></div>
    <div class="actions">
      {#if active}
        <IconButton icon="stop" label={t('agentPanel.stop')} size="sm" onclick={stop} />
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
      title={session.directory ?? t('agentPanel.chooseProject')}
      disabled={active || requesting}
      onclick={chooseProject}
    >
      <Icon name="folder" size={14} /><span>{projectName}</span>
    </button>
    <span class="status" class:active class:error={session.status === 'error'} role="status">
      <span class="dot"></span>{statusLabels[session.status]}
    </span>
  </div>
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
        <div class="mark"><Icon name="sparkle" size={22} /></div>
        <h2>{t('agentPanel.welcome')}</h2>
        <p>{t('agentPanel.intro')}</p>
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
          <Button size="sm" variant="tonal" disabled={requesting} onclick={start}>{t('agentPanel.newSession')}</Button>
        {/if}
      </div>
    </footer>
  {/if}
</section>

<style>
  .agent-panel {
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
    min-height: 42px;
    padding: 0 10px 0 14px;
  }
  .identity {
    gap: 8px;
  }
  .identity :global(svg) {
    color: var(--accent);
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
    gap: 8px;
    padding: 0 14px 10px;
  }
  .project {
    gap: 6px;
    min-width: 0;
    padding: 3px 0;
    border: 0;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
  }
  .project span,
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
    font-size: 10px;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .status.active .dot {
    background: var(--accent);
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
    justify-content: center;
    padding: 24px 18px;
    background: var(--page);
    text-align: center;
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
