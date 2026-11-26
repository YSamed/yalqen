<script lang="ts">
  import type { SettingsValues } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import {
    SHORTCUTS,
    normalizeAccelerator,
    shortcutAccelerator,
    shortcutConflicts,
    type ShortcutId,
    type ShortcutOverrides,
  } from '../../shared/shortcuts';
  import { IS_MAC } from '../platform';
  import TextField from '../ui/TextField.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  const effective = (overrides: ShortcutOverrides) =>
    Object.fromEntries(SHORTCUTS.map(({ id }) => [id, shortcutAccelerator(id, overrides)])) as Record<
      ShortcutId,
      string
    >;
  let drafts = $derived(effective(values.shortcuts));
  const conflicts = $derived(shortcutConflicts(values.shortcuts, IS_MAC));
  const invalid = (id: ShortcutId) => drafts[id].trim() !== '' && !normalizeAccelerator(drafts[id]);

  async function commit(id: ShortcutId): Promise<void> {
    if (invalid(id)) return;
    const draft = drafts[id].trim();
    const rest = Object.fromEntries(Object.entries(values.shortcuts).filter(([key]) => key !== id));
    await update({ shortcuts: draft ? { ...rest, [id]: draft } : rest });
    drafts = { ...drafts, [id]: shortcutAccelerator(id, values.shortcuts) };
  }
</script>

<h2>{t('settings.shortcuts')}</h2>
{#each SHORTCUTS as shortcut (shortcut.id)}
  <SettingRow title={t(shortcut.label)} labelFor="shortcut-{shortcut.id}">
    <div class="shortcut">
      <TextField
        id="shortcut-{shortcut.id}"
        spellcheck="false"
        autocomplete="off"
        placeholder={shortcut.accelerator}
        invalid={invalid(shortcut.id) || conflicts.has(shortcut.id)}
        value={drafts[shortcut.id]}
        oninput={(event) => (drafts = { ...drafts, [shortcut.id]: event.currentTarget.value })}
        onchange={() => void commit(shortcut.id)}
      />
      {#if invalid(shortcut.id)}
        <span class="error" role="alert">{t('settings.shortcutInvalid')}</span>
      {:else if conflicts.has(shortcut.id)}
        <span class="error" role="alert">{t('settings.shortcutConflict')}</span>
      {/if}
    </div>
  </SettingRow>
{/each}

<style>
  .shortcut {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
</style>
