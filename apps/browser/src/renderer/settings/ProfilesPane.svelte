<script lang="ts">
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import Profiles from './Profiles.svelte';
  import SpaceRules from './SpaceRules.svelte';

  let { view, update }: { view: SettingsView; update: (patch: Partial<SettingsValues>) => Promise<void> } = $props();
</script>

<Profiles />
<SpaceRules {view} {update} />
