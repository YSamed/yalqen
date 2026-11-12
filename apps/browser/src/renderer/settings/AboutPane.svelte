<script lang="ts">
  import type { SettingsValues, SettingsView, UpdateStatus } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import Switch from '../ui/Switch.svelte';
  import SettingRow from './SettingRow.svelte';

  let { view, update }: { view: SettingsView; update: (patch: Partial<SettingsValues>) => Promise<void> } = $props();

  const api = window.yalqenSettings;
  const values = $derived(view.values);

  function updateMessage(status: UpdateStatus): string {
    switch (status.state) {
      case 'unavailable':
        return t('settings.updateUnavailable');
      case 'idle':
        return t('settings.updateIdle');
      case 'checking':
        return t('settings.updateChecking');
      case 'up-to-date':
        return t('settings.updateUpToDate');
      case 'downloading':
        return t('settings.updateDownloading', { version: status.version, percent: status.percent });
      case 'ready':
        return t('settings.updateReady', { version: status.version });
      case 'failed':
        return t('settings.updateFailed');
    }
  }
</script>

<h2>{t('settings.updates')}</h2>
<div class="row">
  <span class="label">
    <span>Yalqen {view.version}</span>
    <span class="hint" class:ready={view.update.state === 'ready'} aria-live="polite">
      {updateMessage(view.update)}
    </span>
    {#if view.update.state === 'downloading'}
      <span class="progress" role="progressbar" aria-valuenow={view.update.percent} aria-label={t('settings.download')}>
        <span style:width="{Math.max(2, view.update.percent)}%"></span>
      </span>
    {/if}
  </span>
  {#if view.update.state === 'ready'}
    <Button variant="primary" onclick={() => api.installUpdate()}>{t('settings.restart')}</Button>
  {:else if view.update.state !== 'unavailable'}
    <Button
      variant="tonal"
      disabled={view.update.state === 'checking' || view.update.state === 'downloading'}
      onclick={() => api.checkForUpdates()}>{t('settings.checkNow')}</Button
    >
  {/if}
</div>
<SettingRow title={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
  <Switch
    label={t('settings.autoUpdate')}
    checked={values.autoUpdate}
    onchange={(checked) => update({ autoUpdate: checked })}
  />
</SettingRow>

<style>
  .label .hint.ready {
    color: var(--text);
  }

  .progress {
    width: 220px;
    height: 4px;
    margin-top: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--well);
  }

  .progress > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.25s linear;
  }
</style>
