<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { SpaceView } from '../../shared/workspaces';
  import Select from '../ui/Select.svelte';
  import SettingRow from './SettingRow.svelte';

  let { spaces, value, onchange }: { spaces: SpaceView[]; value: string; onchange: (id: string) => void } = $props();
</script>

{#if spaces.length > 1}
  <SettingRow title={t('profiles.dataScope')} hint={t('profiles.dataScopeHint')}>
    <Select
      variant="ghost"
      options={spaces.map(({ id, name }) => ({ value: id, label: name }))}
      {value}
      aria-label={t('profiles.dataScope')}
      {onchange}
    />
  </SettingRow>
{/if}
