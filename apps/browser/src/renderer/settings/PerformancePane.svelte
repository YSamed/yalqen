<script lang="ts">
  import { AUTO_ARCHIVE_HOURS, DISCARD_AFTER_MINUTES, type SettingsValues } from '../../shared/types';
  import { t, type MessageKey } from '../../shared/i18n';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import ProcessUsage from './ProcessUsage.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  const DISCARD_LABELS: Record<(typeof DISCARD_AFTER_MINUTES)[number], MessageKey> = {
    0: 'settings.off',
    15: 'settings.minutes15',
    30: 'settings.minutes30',
    60: 'settings.hours1',
    120: 'settings.hours2',
  };
  const discardOptions = DISCARD_AFTER_MINUTES.map((minutes) => ({
    value: minutes,
    label: t(DISCARD_LABELS[minutes]),
  }));
  const ARCHIVE_LABELS: Record<(typeof AUTO_ARCHIVE_HOURS)[number], MessageKey> = {
    0: 'settings.off',
    12: 'settings.hours12',
    24: 'settings.hours24',
    168: 'settings.days7',
    720: 'settings.days30',
  };
  const archiveOptions = AUTO_ARCHIVE_HOURS.map((hours) => ({
    value: hours,
    label: t(ARCHIVE_LABELS[hours]),
  }));
</script>

<h2>{t('settings.memory')}</h2>
<SettingRow title={t('settings.discardUnusedTabs')} hint={t('settings.discardUnusedTabsHint')}>
  <SegmentedControl
    label={t('settings.discardUnusedTabs')}
    options={discardOptions}
    value={values.discardAfterMinutes}
    onchange={(value) => update({ discardAfterMinutes: value })}
  />
</SettingRow>
<SettingRow title={t('settings.autoArchiveTabs')} hint={t('settings.autoArchiveTabsHint')}>
  <SegmentedControl
    label={t('settings.autoArchiveTabs')}
    options={archiveOptions}
    value={values.autoArchiveHours}
    onchange={(value) => update({ autoArchiveHours: value })}
  />
</SettingRow>
<ProcessUsage />
