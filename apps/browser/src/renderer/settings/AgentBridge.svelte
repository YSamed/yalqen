<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { AgentBridgeView, AgentSetupKind, SettingsValues } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Switch from '../ui/Switch.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  const api = window.yalqenSettings;
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

  async function regenerate(): Promise<void> {
    view = await api.regenerateAgentToken();
    copied = null;
  }

  function saveOrigins(): Promise<void> {
    return update({ agentOrigins: originsText.split(/\s+/).filter(Boolean) });
  }

  onMount(() => {
    void api.agentBridge().then((next) => (view = next));
    return api.onAgentBridgeChange((next) => (view = next));
  });
</script>

<h2>{t('agentBridge.title')}</h2>
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
      {t('agentBridge.listening', { url: view.url })}
      · {t('agentBridge.observedTabs', { count: view.observedTabs })}
      {#if view.lastCallAt}
        · {t('agentBridge.lastCall', { time: new Date(view.lastCallAt).toLocaleTimeString() })}
      {/if}
    </p>

    <div class="setup">
      <div class="setup-head">
        <span>Claude Code</span>
        <Button size="sm" onclick={() => copy('claude')}>
          {copied === 'claude' ? t('agentBridge.copied') : t('agentBridge.copy')}
        </Button>
      </div>
      <pre>{view.claudeCommand}</pre>
    </div>
    <div class="setup">
      <div class="setup-head">
        <span>Codex</span>
        <Button size="sm" onclick={() => copy('codex')}>
          {copied === 'codex' ? t('agentBridge.copied') : t('agentBridge.copy')}
        </Button>
      </div>
      <pre>{view.codexConfig}</pre>
    </div>
    <p class="hint">{t('agentBridge.tokenHint')}</p>
    <div class="actions">
      <Button size="sm" onclick={() => copy('token')}>
        {copied === 'token' ? t('agentBridge.copied') : t('agentBridge.copyToken')}
      </Button>
      <Button size="sm" onclick={regenerate}>{t('agentBridge.regenerate')}</Button>
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

  .setup-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
