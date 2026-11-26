<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { ExtensionInfo, SettingsValues } from '../../shared/types';
  import EmptyState from './EmptyState.svelte';
  import SettingRow from './SettingRow.svelte';
  import Icon from '../ui/Icon.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Switch from '../ui/Switch.svelte';
  import ExtensionAccessEditor from './ExtensionAccessEditor.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();
  const api = window.yalqenSettings;
  let checking = $state(false);
  let updateStatus = $state<string | null>(null);
  async function checkUpdates(): Promise<void> {
    checking = true;
    updateStatus = null;
    try {
      updateStatus = (await api.checkExtensionUpdates()) ?? t('extensionsPanel.updateComplete');
    } finally {
      checking = false;
    }
  }
  let extensions = $state<ExtensionInfo[]>([]);
  let expanded = $state<string | null>(null);
  let installing = $state(false);
  let installError = $state<string | null>(null);

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

  onMount(() => {
    void api.extensions().then((next) => {
      extensions = next;
    });
    return api.onExtensionsChange((next) => {
      extensions = next;
    });
  });
</script>

<h2>{t('extensionsPanel.title')}</h2>
{#each extensions as extension (extension.path)}
  <div class="extension" class:disabled={!extension.enabled}>
    <div class="head">
      <span class="icon">
        {#if extension.icon}
          <img src={extension.icon} alt="" width="32" height="32" />
        {:else}
          <Icon name="extensions" size={20} />
        {/if}
      </span>
      <div class="details">
        <span class="name" title={extension.name}>{extension.name}</span>
        <span class="hint">{extension.version}</span>
      </div>
      <div class="controls">
        <Switch
          label={t('extensionsPanel.enabledLabel', { name: extension.name })}
          checked={extension.enabled}
          disabled={extension.updating}
          onchange={(checked) => api.setExtensionEnabled(extension.path, checked)}
        />
        <IconButton
          icon="more"
          tone="muted"
          label={t('extensionsPanel.moreLabel', { name: extension.name })}
          aria-expanded={expanded === extension.path}
          onclick={() => (expanded = expanded === extension.path ? null : extension.path)}
        />
        <IconButton
          icon="trash"
          disabled={extension.updating}
          tone="muted"
          label={t('extensionsPanel.removeLabel', { name: extension.name })}
          onclick={() => api.removeExtension(extension.path)}
        />
      </div>
    </div>
    {#if extension.error}<p class="error" role="alert">
        {t('extensionsPanel.loadFailed', { error: extension.error })}
      </p>{/if}
    {#if extension.updateError}<p class="error" role="status">
        {t('extensionsPanel.updateFailed', { error: extension.updateError })}
      </p>{/if}
    {#if expanded === extension.path}
      <div class="more">
        <ExtensionAccessEditor {extension} />
        {#if extension.hasOptions}
          <Button size="sm" variant="tonal" onclick={() => api.openExtensionOptions(extension.path)}>
            {t('extensionsPanel.options')}
          </Button>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <EmptyState icon="extensions" title={t('extensionsPanel.empty')} hint={t('extensionsPanel.emptyHint')} />
{/each}

<div class="actions">
  <Button variant="primary" icon="extensions" onclick={() => api.openExtensionStore()}>
    {t('extensionsPanel.openStore')}
  </Button>
  <Button variant="ghost" size="sm" disabled={installing} onclick={install}>
    {t('extensionsPanel.loadFromFolder')}
  </Button>
  {#if installError}<span class="error" role="alert">
      {t('extensionsPanel.loadFailed', { error: installError })}
    </span>{/if}
</div>

<SettingRow title={t('extensionsPanel.automaticUpdates')} hint={t('extensionsPanel.automaticUpdatesHint')}>
  <Switch
    label={t('extensionsPanel.automaticUpdates')}
    checked={values.autoUpdateExtensions}
    onchange={(checked) => update({ autoUpdateExtensions: checked })}
  />
</SettingRow>
{#if extensions.some((extension) => extension.fromStore && (!values.autoUpdateExtensions || extension.updateError))}
  <div class="actions">
    <Button
      variant="tonal"
      disabled={checking || extensions.some((extension) => extension.updating)}
      onclick={checkUpdates}
    >
      {checking ? t('extensionsPanel.checkingUpdates') : t('extensionsPanel.checkUpdates')}
    </Button>
    {#if updateStatus}<span class="hint" role="status">{updateStatus}</span>{/if}
  </div>
{/if}

<style>
  .extension {
    margin-top: 8px;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--surface);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 12px;
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
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension .error {
    margin: 8px 0 0 44px;
  }

  .more {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin: 10px 0 0 44px;
  }

  .controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0 4px;
  }
</style>
