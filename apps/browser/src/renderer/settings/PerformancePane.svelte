<script lang="ts">
  import { DISCARD_AFTER_MINUTES, type SettingsValues } from '../../shared/types';
  import { t, type MessageKey } from '../../shared/i18n';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Switch from '../ui/Switch.svelte';
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
</script>

<h2>{t('settings.memory')}</h2>
<SettingRow title={t('settings.freezeBackgroundTabs')} hint={t('settings.freezeBackgroundTabsHint')}>
  <Switch
    label={t('settings.freezeBackgroundTabs')}
    checked={values.freezeBackgroundTabs}
    onchange={(checked) => update({ freezeBackgroundTabs: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.discardUnusedTabs')} hint={t('settings.discardUnusedTabsHint')}>
  <SegmentedControl
    label={t('settings.discardUnusedTabs')}
    options={discardOptions}
    value={values.discardAfterMinutes}
    onchange={(value) => update({ discardAfterMinutes: value })}
  />
</SettingRow>
<ProcessUsage />
