<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { AgentSessionState, AgentTerminalOutput, TabSnapshot } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';

  let {
    open,
    session,
    activeTab,
    onchoose,
  }: {
    open: boolean;
    session: AgentSessionState;
    activeTab: TabSnapshot | null;
    onchoose(): Promise<boolean>;
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
  const terminalVisible = $derived(open);
  const active = $derived(session.status === 'starting' || session.status === 'running');
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

  async function choose(): Promise<void> {
    requesting = true;
    try {
      failed = !(await onchoose());
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

  function addCurrentTab(): void {
    if (!activeTab?.agentObserved || !session.id || session.status !== 'running') return;
    const reference = JSON.stringify({ tab_id: activeTab.id, url: activeTab.url });
    window.yalqen.writeAgentTerminal(session.id, ` Yalqen ${reference} `);
    terminal?.focus();
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
      if (!document.activeElement?.closest('.segmented')) terminal?.focus();
    });
  });

  onMount(() => {
    terminal = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 12,
      allowTransparency: true,
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

<div class="terminal-view">
  {#if activeTab?.agentObserved}
    <button class="tab-context" disabled={session.status !== 'running'} title={activeTab.url} onclick={addCurrentTab}>
      <Icon name="globe" size={14} /><span>{activeTab.title}</span><span class="tab-action"
        >{t('agentPanel.addTab')}</span
      >
    </button>
  {/if}
  <div class="terminal-area">
    <div class="terminal" bind:this={container}></div>
    {#if !session.id}
      <div class="empty">
        <h2>{t('agentChat.terminalWelcome')}</h2>
        <p>{t('agentChat.terminalIntro')}</p>
        {#if session.directory}
          <Button variant="primary" disabled={requesting} onclick={start}>{t('agentPanel.start')}</Button>
        {:else}
          <Button variant="primary" icon="folder" disabled={requesting} onclick={choose}
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
          <Button onclick={() => window.yalqen.send({ type: 'new-tab', url: 'https://code.claude.com/docs/en/setup' })}
            >{t('agentPanel.installGuide')}</Button
          >
        {/if}
        {#if failed && active}
          <Button onclick={hydrate}>{t('agentPanel.retry')}</Button>
        {:else if session.directory && !active}
          <Button variant="tonal" disabled={requesting} onclick={start}>{t('agentPanel.newSession')}</Button>
        {/if}
      </div>
    </footer>
  {/if}
</div>

<style>
  .terminal-view {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding-top: 4px;
  }
  .tab-context,
  .footer-actions {
    display: flex;
    align-items: center;
  }
  .tab-context {
    gap: 8px;
    min-height: var(--control-md);
    margin: 0 12px 8px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: var(--ai-small);
    text-align: left;
  }
  .tab-context > span:first-of-type {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tab-context :global(svg) {
    flex: none;
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
    margin: 0 10px 12px var(--ai-gutter);
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
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .empty p {
    max-width: 280px;
    margin: 8px 0 20px;
    color: var(--text-muted);
    font-size: var(--ai-text);
    line-height: 1.55;
  }
  .empty p.note {
    margin: 16px 0 0;
    font-size: var(--ai-meta);
  }
  footer {
    padding: 10px 12px 12px var(--ai-gutter);
    border-top: 1px solid var(--border);
  }
  footer p {
    margin: 0 0 8px;
    color: var(--text-muted);
    font-size: var(--ai-small);
    line-height: 1.5;
  }
  :global([data-material='glass']) .terminal,
  :global([data-material='glass']) .empty {
    background: transparent;
  }
</style>
