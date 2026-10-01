<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { ExtensionInfo } from '../../shared/types';
  import Icon from './Icon.svelte';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import TextField from './ui/TextField.svelte';

  const api = window.yalqenSettings;

  let extensions = $state<ExtensionInfo[]>([]);
  let installing = $state(false);
  let installError = $state<string | null>(null);
  let storeInput = $state('');

  async function run(task: () => Promise<string | null>): Promise<string | null> {
    installing = true;
    installError = null;
    try {
      installError = await task();
    } finally {
      installing = false;
    }
    return installError;
  }

  const install = () => run(() => api.installExtension());

  async function installFromStore(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!(await run(() => api.installExtensionFromStore(storeInput)))) storeInput = '';
  }

  onMount(() => {
    void api.extensions().then((next) => (extensions = next));
    return api.onExtensionsChange((next) => (extensions = next));
  });
</script>

<h2>{t('extensionsPanel.title')}</h2>
<p class="hint intro">{t('extensionsPanel.intro')}</p>

{#each extensions as extension (extension.path)}
  <div class="extension" class:disabled={!extension.enabled}>
    <span class="icon">
      {#if extension.icon}
        <img src={extension.icon} alt="" width="32" height="32" />
      {:else}
        <Icon name="extensions" size={20} />
      {/if}
    </span>
    <div class="details">
      <span class="name">{extension.name} <span class="hint">{extension.version}</span></span>
      {#if extension.description}<span class="hint">{extension.description}</span>{/if}
      <span class="hint path" title={extension.path}>{extension.path}</span>
      {#if extension.error}<span class="error" role="alert"
          >{t('extensionsPanel.loadFailed', { error: extension.error })}</span
        >{/if}
    </div>
    <div class="controls">
      {#if extension.hasOptions}
        <Button size="sm" onclick={() => api.openExtensionOptions(extension.path)}
          >{t('extensionsPanel.options')}</Button
        >
      {/if}
      <input
        type="checkbox"
        checked={extension.enabled}
        aria-label={t('extensionsPanel.enabledLabel', { name: extension.name })}
        title={extension.enabled ? t('extensionsPanel.disable') : t('extensionsPanel.enable')}
        onchange={(event) => api.setExtensionEnabled(extension.path, event.currentTarget.checked)}
      />
      <IconButton
        icon="close"
        tone="muted"
        label={t('extensionsPanel.removeLabel', { name: extension.name })}
        onclick={() => api.removeExtension(extension.path)}
      />
    </div>
  </div>
{:else}
  <p class="hint empty">{t('extensionsPanel.empty')}</p>
{/each}

<form class="store" onsubmit={installFromStore}>
  <TextField
    bind:value={storeInput}
    placeholder={t('extensionsPanel.storePlaceholder')}
    aria-label={t('extensionsPanel.storePlaceholder')}
    spellcheck="false"
    autocomplete="off"
    disabled={installing}
  />
  <Button type="submit" icon="plus" disabled={installing || storeInput.trim() === ''}>
    {installing ? t('extensionsPanel.adding') : t('extensionsPanel.addFromStore')}
  </Button>
</form>

<div class="actions">
  <Button icon="extensions" onclick={() => api.openExtensionStore()}>{t('extensionsPanel.openStore')}</Button>
  <Button icon="plus" disabled={installing} onclick={install}>{t('extensionsPanel.loadFromFolder')}</Button>
  {#if installError}<span class="error" role="alert">{t('extensionsPanel.loadFailed', { error: installError })}</span
    >{/if}
</div>

<style>
  h2 {
    margin: 12px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .error {
    color: var(--warn);
    font-size: var(--font-size-small);
  }

  .intro {
    margin: 0 0 8px;
  }

  .empty {
    margin: 8px 0;
  }

  .extension {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .extension.disabled .icon,
  .extension.disabled .details {
    opacity: 0.6;
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--text-muted);
  }

  .icon img {
    width: 32px;
    height: 32px;
  }

  .details {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-weight: 500;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  .controls input {
    margin: 0;
  }

  .store {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0 0;
  }

  .store :global(input) {
    flex: 1;
    min-width: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0 4px;
  }
</style>
