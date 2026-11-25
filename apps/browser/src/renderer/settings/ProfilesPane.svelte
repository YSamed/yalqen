<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import SpaceProfiles from './SpaceProfiles.svelte';

  let {
    view,
    update,
    profile,
    open,
    showData,
  }: {
    view: SettingsView;
    update: (patch: Partial<SettingsValues>) => Promise<void>;
    profile: string | null;
    open: ComponentProps<typeof SpaceProfiles>['open'];
    showData: ComponentProps<typeof SpaceProfiles>['showData'];
  } = $props();
</script>

<SpaceProfiles settings={view} {update} {profile} {open} {showData} />
