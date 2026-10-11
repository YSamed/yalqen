<script lang="ts">
  import type { ClearDataRange, SettingsValues, ThreatListsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import AdvancedGroup from './AdvancedGroup.svelte';
  import SettingRow from './SettingRow.svelte';

  let {
    values,
    update,
    threatLists,
  }: {
    values: SettingsValues;
    update: (patch: Partial<SettingsValues>) => Promise<void>;
    threatLists?: ThreatListsView;
  } = $props();

  const api = window.yalqenSettings;
  const dnsOptions = [
    { value: 'automatic', label: t('settings.dnsAutomatic') },
    { value: 'cloudflare', label: 'Cloudflare' },
    { value: 'google', label: 'Google' },
    { value: 'quad9', label: 'Quad9' },
    { value: 'off', label: t('settings.off') },
  ] as const;
  const rangeOptions: { value: ClearDataRange; label: string }[] = [
    { value: 'hour', label: t('settings.rangeHour') },
    { value: 'day', label: t('settings.rangeDay') },
    { value: 'week', label: t('settings.rangeWeek') },
    { value: 'month', label: t('settings.rangeMonth') },
    { value: 'all', label: t('settings.rangeAll') },
  ];
  const clearOptions = [
    { key: 'history', label: t('settings.clearHistory') },
    { key: 'downloads', label: t('settings.clearDownloads') },
    { key: 'siteData', label: t('settings.clearSiteData') },
    { key: 'cache', label: t('settings.clearCache') },
  ] as const;

  let clearRange = $state<ClearDataRange>('hour');
  let clearKinds = $state({ history: true, downloads: false, siteData: false, cache: false });
  let clearing = $state(false);
  let cleared = $state(false);
  let clearDialog = $state<HTMLDialogElement>();
  const clearSelected = $derived(Object.values(clearKinds).some(Boolean));

  function openClear(): void {
    cleared = false;
    clearDialog?.showModal();
  }

  async function clearData(): Promise<void> {
    clearing = true;
    cleared = false;
    try {
      await api.clearData({ range: clearRange, ...clearKinds });
      cleared = true;
    } finally {
      clearing = false;
    }
  }
</script>

<h2>{t('settings.protection')}</h2>
<SettingRow title={t('threats.protection')} hint={t('threats.protectionHint')}>
  <Switch
    label={t('threats.protection')}
    checked={values.threatProtection}
    onchange={(checked) => update({ threatProtection: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.adBlocker')} hint={t('settings.adBlockerHint')}>
  <Switch
    label={t('settings.adBlocker')}
    checked={values.adBlocking}
    onchange={(checked) => update({ adBlocking: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.httpsOnly')} hint={t('settings.httpsOnlyHint')}>
  <Switch
    label={t('settings.httpsOnly')}
    checked={values.httpsOnly}
    onchange={(checked) => update({ httpsOnly: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.blockThirdPartyCookies')} hint={t('settings.blockThirdPartyCookiesHint')}>
  <Switch
    label={t('settings.blockThirdPartyCookies')}
    checked={values.blockThirdPartyCookies}
    onchange={(checked) => update({ blockThirdPartyCookies: checked })}
  />
</SettingRow>

<h2>{t('settings.browsingData')}</h2>
<SettingRow title={t('settings.clearBrowsingData')} hint={t('settings.clearBrowsingDataRowHint')}>
  <Button variant="tonal" onclick={openClear}>{t('settings.clearDataEllipsis')}</Button>
</SettingRow>

<dialog
  class="clear-dialog"
  aria-labelledby="clear-title"
  bind:this={clearDialog}
  onclose={() => (cleared = false)}
  onclick={(event) => {
    if (event.target === clearDialog) clearDialog?.close();
  }}
>
  <h3 id="clear-title">{t('settings.clearBrowsingData')}</h3>
  <p class="hint">{t('settings.clearBrowsingDataHint')}</p>
  <div class="clear">
    <Select
      aria-label={t('settings.timeRange')}
      options={rangeOptions}
      bind:value={clearRange}
      onchange={() => (cleared = false)}
    />
    {#each clearOptions as option (option.key)}
      <label class="check">
        <input type="checkbox" bind:checked={clearKinds[option.key]} onchange={() => (cleared = false)} />
        {option.label}
      </label>
    {/each}
  </div>
  <div class="clear-actions">
    {#if cleared}<span class="hint" role="status">{t('settings.cleared')}</span>{/if}
    <Button variant="ghost" onclick={() => clearDialog?.close()}>{t('settings.close')}</Button>
    <Button variant="danger" disabled={!clearSelected || clearing} onclick={clearData}>
      {clearing ? t('settings.clearing') : t('settings.clearData')}
    </Button>
  </div>
</dialog>

<AdvancedGroup>
  <SettingRow title={t('settings.secureDns')} hint={t('settings.secureDnsHint')} labelFor="secure-dns">
    <Select
      id="secure-dns"
      options={dnsOptions}
      value={values.secureDns}
      onchange={(value) => update({ secureDns: value })}
    />
  </SettingRow>
  {#if threatLists}
    <SettingRow
      title={t('threats.lists')}
      hint={t('threats.counts', { domains: threatLists.domains, hashes: threatLists.hashes })}
    >
      <Button
        variant="tonal"
        disabled={!values.threatProtection || threatLists.updating}
        onclick={() => api.updateThreatLists()}
        >{threatLists.updating ? t('threats.updating') : t('threats.update')}</Button
      >
    </SettingRow>
    <p class="hint sources" aria-live="polite">
      {t('threats.domainUpdated', {
        date: threatLists.domainUpdatedAt
          ? new Date(threatLists.domainUpdatedAt).toLocaleString()
          : t('threats.notLoaded'),
      })}<br />
      {t('threats.hashUpdated', {
        date: threatLists.hashUpdatedAt ? new Date(threatLists.hashUpdatedAt).toLocaleString() : t('threats.notLoaded'),
      })}
      {#if threatLists.failed}<br /><span class="error">{t('threats.updateFailed')}</span>{/if}
      <br />{t('threats.coverage')}
      <a href="https://cert.pl/lista-ostrzezen/" target="_blank" rel="noreferrer">CERT Polska</a> ·
      <a href="https://github.com/Neo23x0/signature-base" target="_blank" rel="noreferrer"
        >Signature-Base · Florian Roth / Nextron Systems</a
      >
      ·
      <a href="https://raw.githubusercontent.com/Neo23x0/signature-base/master/LICENSE" target="_blank" rel="noreferrer"
        >DRL 1.1</a
      >
    </p>
  {/if}
</AdvancedGroup>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .check input {
    margin: 0;
  }

  .clear {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .clear-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }

  .clear-actions .hint {
    margin-right: auto;
  }

  .clear-dialog {
    width: min(380px, calc(100vw - 32px));
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-menu, var(--surface));
    color: var(--text);
    box-shadow: 0 24px 60px -20px rgb(0 0 0 / 0.45);
  }

  .clear-dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }

  .clear-dialog h3 {
    margin: 0 0 4px;
    font-size: 16px;
  }

  .clear-dialog > .hint {
    margin: 0 0 14px;
  }

  .sources {
    margin: 8px 0 12px;
  }
</style>
