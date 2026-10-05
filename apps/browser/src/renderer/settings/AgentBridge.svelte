<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type {
    AgentActionPolicy,
    AgentBridgeView,
    AgentClientId,
    AgentConnectionState,
    AgentConnections,
    AgentSetupKind,
    AgentSetupResult,
    SettingsValues,
  } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  const api = window.yalqenSettings;
  const actionOptions: { value: AgentActionPolicy; label: string }[] = [
    { value: 'off', label: t('agentBridge.actionsOff') },
    { value: 'ask', label: t('agentBridge.actionsAsk') },
    { value: 'allow', label: t('agentBridge.actionsAllow') },
  ];
  const agentOptions: { value: 'claude' | 'codex'; label: string }[] = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
  ];
  let agent = $state<'claude' | 'codex'>('claude');
  let view = $state<AgentBridgeView | null>(null);
  let copied = $state<AgentSetupKind | null>(null);
  let originsText = $state('');
  let savedOrigins = $state('');
  const originsDirty = $derived(originsText.trim() !== savedOrigins);

  $effect(() => {
    const joined = values.agentOrigins.join('\n');
    if (joined !== savedOrigins) {
      savedOrigins = joined;
      originsText = joined;
    }
  });

  async function copy(kind: AgentSetupKind): Promise<void> {
    if (await api.copyAgentSetup(kind)) copied = kind;
  }

  const clients: { id: AgentClientId; label: string; reconnectHint: string }[] = [
    { id: 'claude', label: 'Claude Code', reconnectHint: t('agentBridge.claudeReconnect') },
    { id: 'codex', label: 'Codex', reconnectHint: t('agentBridge.codexReconnect') },
  ];
  let connections = $state<AgentConnections | null>(null);
  let changing = $state<AgentClientId | null>(null);
  let results = $state<Partial<Record<AgentClientId, AgentSetupResult>>>({});
  let loadedRevision = -1;

  $effect(() => {
    if (!view?.url || view.connectionsRevision === loadedRevision) return;
    loadedRevision = view.connectionsRevision;
    void api.agentConnections().then(
      (next) => (connections = next),
      () => (connections = null),
    );
  });

  async function change(id: AgentClientId, connect: boolean): Promise<void> {
    changing = id;
    results = { ...results, [id]: undefined };
    try {
      const result = connect ? await api.connectAgent(id) : await api.disconnectAgent(id);
      results = { ...results, [id]: result };
    } finally {
      changing = null;
    }
  }

  function stateText(state: AgentConnectionState | undefined): string {
    if (state === 'connected') return t('agentBridge.stateConnected');
    if (state === 'stale') return t('agentBridge.stateStale');
    if (state === 'missing') return t('agentBridge.stateMissing');
    if (state === 'unavailable') return t('agentBridge.stateUnavailable');
    return t('agentBridge.stateChecking');
  }

  const time = (at: number) => new Date(at).toLocaleTimeString();

  async function regenerate(): Promise<void> {
    view = await api.regenerateAgentToken();
    copied = null;
  }

  function saveOrigins(): Promise<void> {
    return update({ agentOrigins: originsText.split(/\s+/).filter(Boolean) });
  }

  onMount(() => {
    void api.agentBridge().then((next) => {
      view = next;
    });
    return api.onAgentBridgeChange((next) => {
      view = next;
    });
  });
</script>

<h2>{t('agentBridge.title')}</h2>
<SettingRow title={t('agentBridge.terminal')} hint={t('agentBridge.terminalHint')}>
  <Switch
    label={t('agentBridge.terminal')}
    checked={values.agentTerminal}
    onchange={(checked) => update({ agentTerminal: checked })}
  />
</SettingRow>
<SettingRow title={t('agentBridge.toggle')} hint={t('agentBridge.toggleHint')}>
  <Switch
    label={t('agentBridge.toggle')}
    checked={values.agentBridge}
    onchange={(checked) => update({ agentBridge: checked })}
  />
</SettingRow>

{#if values.agentBridge && view}
  {#if view.error}
    <p class="hint error" role="alert">{t('agentBridge.failed', { error: view.error })}</p>
  {:else if view.url}
    <p class="hint status" aria-live="polite">
      {#if view.client || view.lastCallAt}
        {t('agentBridge.connected', { client: view.client ?? t('agentBridge.someAgent') })}
        {#if view.lastCallAt}
          · {t('agentBridge.lastCall', { time: time(view.lastCallAt) })}
        {/if}
      {:else}
        {t('agentBridge.ready')}
      {/if}
      · {t('agentBridge.observedTabs', { count: view.observedTabs })}
    </p>
    {#if view.staleTokenAt}
      <p class="hint error" role="alert">{t('agentBridge.staleToken', { time: time(view.staleTokenAt) })}</p>
    {/if}

    <div class="connections">
      {#each clients as client (client.id)}
        {@const state = connections?.[client.id]}
        {@const result = results[client.id]}
        <div class="connection">
          <div class="connection-text">
            <strong>{client.label}</strong>
            <span class={['hint', state === 'stale' && 'warn']}>{stateText(state)}</span>
            {#if result && !result.ok}
              <span class="hint warn" role="alert">{t('agentBridge.changeFailed', { error: result.detail })}</span>
            {:else if result?.ok && state === 'connected'}
              <span class="hint" role="status">{client.reconnectHint}</span>
            {/if}
          </div>
          {#if state === 'connected'}
            <Button size="sm" disabled={changing !== null} onclick={() => change(client.id, false)}>
              {changing === client.id ? t('agentBridge.working') : t('agentBridge.disconnect')}
            </Button>
          {:else if state === 'missing' || state === 'stale'}
            <Button size="sm" variant="primary" disabled={changing !== null} onclick={() => change(client.id, true)}>
              {changing === client.id
                ? t('agentBridge.working')
                : state === 'stale'
                  ? t('agentBridge.update')
                  : t('agentBridge.connect')}
            </Button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <SettingRow title={t('agentBridge.actions')} hint={t('agentBridge.actionsHint')} labelFor="agent-actions">
    <Select
      id="agent-actions"
      options={actionOptions}
      value={values.agentActions}
      onchange={(value) => update({ agentActions: value })}
    />
  </SettingRow>

  <details class="advanced">
    <summary>{t('agentBridge.advanced')}</summary>

    {#if view.url}
      <div class="setup">
        <div class="setup-head">
          <SegmentedControl
            label={t('agentBridge.manualSetup')}
            options={agentOptions}
            value={agent}
            onchange={(next) => (agent = next)}
          />
          <Button size="sm" onclick={() => copy(agent)}>
            {copied === agent ? t('agentBridge.copied') : t('agentBridge.copy')}
          </Button>
        </div>
        <p class="hint">{t('agentBridge.setupHint')}</p>
        <pre>{agent === 'claude' ? view.claudeCommand : view.codexConfig}</pre>
      </div>
      <p class="hint status">
        {t('agentBridge.listening', { url: view.url })}
      </p>
      <p class="hint">{t('agentBridge.tokenHint')}</p>
      <div class="actions">
        <Button size="sm" onclick={() => copy('token')}>
          {copied === 'token' ? t('agentBridge.copied') : t('agentBridge.copyToken')}
        </Button>
        <Button size="sm" onclick={regenerate}>{t('agentBridge.regenerate')}</Button>
      </div>
    {/if}

    <SettingRow title={t('agentBridge.tracing')} hint={t('agentBridge.tracingHint')}>
      <Switch
        label={t('agentBridge.tracing')}
        checked={values.agentTracing}
        onchange={(checked) => update({ agentTracing: checked })}
      />
    </SettingRow>
    {#if values.agentTracing && view.otelConfig}
      <div class="setup">
        <div class="setup-head">
          <span>{t('agentBridge.tracingSetup')}</span>
          <Button size="sm" onclick={() => copy('otel')}>
            {copied === 'otel' ? t('agentBridge.copied') : t('agentBridge.copy')}
          </Button>
        </div>
        <pre>{view.otelConfig}</pre>
      </div>
    {/if}

    <SettingRow title={t('agentBridge.origins')} hint={t('agentBridge.originsHint')} labelFor="agent-origins" stacked>
      <textarea
        id="agent-origins"
        class="field code"
        bind:value={originsText}
        rows="3"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://my-app.ngrok.app"></textarea>
    </SettingRow>
    <div class="actions">
      <Button size="sm" disabled={!originsDirty} onclick={saveOrigins}>{t('agentBridge.saveOrigins')}</Button>
    </div>
  </details>
{/if}

<style>
  .status {
    margin: 4px 0 12px;
  }

  .error {
    margin: 4px 0 12px;
    color: var(--warn);
  }

  .setup {
    margin: 0 0 12px;
  }

  .setup .hint {
    margin: 4px 0;
  }

  .connections {
    display: grid;
    gap: 8px;
    margin: 0 0 16px;
  }

  .connection {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .connection-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .connection-text .hint {
    margin: 0;
  }

  .warn {
    color: var(--warn);
  }

  .advanced {
    margin: 4px 0 20px;
  }

  .advanced summary {
    margin-bottom: 8px;
    cursor: pointer;
    color: var(--text-muted);
    font-weight: 500;
  }

  .setup-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
    font-weight: 500;
  }

  pre {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    font-size: var(--font-size-small);
    white-space: pre;
    user-select: text;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin: 8px 0 20px;
  }

  .code {
    width: 100%;
    height: auto;
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    resize: vertical;
  }
</style>
