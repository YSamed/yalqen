<script lang="ts">
  import type { ClearDataRange, SettingsValues } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

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
  const clearSelected = $derived(Object.values(clearKinds).some(Boolean));

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
<SettingRow title={t('settings.askBeforeDownload')} hint={t('settings.askBeforeDownloadHint')}>
  <Switch
    label={t('settings.askBeforeDownload')}
    checked={values.askBeforeDownload}
    onchange={(checked) => update({ askBeforeDownload: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.secureDns')} hint={t('settings.secureDnsHint')} labelFor="secure-dns">
  <Select
    id="secure-dns"
    options={dnsOptions}
    value={values.secureDns}
    onchange={(value) => update({ secureDns: value })}
  />
</SettingRow>
<SettingRow title={t('settings.usageCounting')} hint={t('settings.usageCountingHint')}>
  <Switch
    label={t('settings.usageCounting')}
    checked={values.usageCounting}
    onchange={(checked) => update({ usageCounting: checked })}
  />
</SettingRow>
<h2>{t('settings.browsingData')}</h2>
<SettingRow title={t('settings.clearBrowsingData')} hint={t('settings.clearBrowsingDataHint')} stacked>
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
    <div class="clear-actions">
      <Button variant="danger" disabled={!clearSelected || clearing} onclick={clearData}>
        {clearing ? t('settings.clearing') : t('settings.clearData')}
      </Button>
      {#if cleared}<span class="hint" role="status">{t('settings.cleared')}</span>{/if}
    </div>
  </div>
</SettingRow>

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
    gap: 10px;
    margin-top: 4px;
  }
</style>
