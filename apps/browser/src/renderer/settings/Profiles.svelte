<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProfilesResult, ProfilesView, SettingsApi } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import TextField from '../ui/TextField.svelte';

  const api = window.yalqenSettings;
  let view = $state<ProfilesView | null>(null);
  let name = $state('');
  let editing = $state<{ id: string; name: string } | null>(null);
  let busy = $state(false);
  let error = $state<ProfilesResult['error']>(null);
  async function load(): Promise<void> {
    try {
      view = await api.profiles();
    } catch {
      error = 'failed';
    }
  }
  async function perform(
    action: Parameters<SettingsApi['profileAction']>[0],
    id?: string,
    value?: string,
  ): Promise<void> {
    busy = true;
    error = null;
    try {
      const result = await api.profileAction(action, id, value);
      view = result.view;
      error = result.error;
      if (!result.error) {
        if (action === 'create') name = '';
        if (action === 'rename') editing = null;
      }
    } catch {
      error = 'failed';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    void load();
    return api.onChange(() => {
      void load();
    });
  });
</script>

<section aria-labelledby="persistent-profiles-title">
  <h2 id="persistent-profiles-title">{t('profiles.title')}</h2>
  <p class="hint">{t('profiles.hint')}</p>
  {#if error}<p class="error" role="alert">{t(`profiles.${error}`)}</p>{/if}
  {#if view}
    <ul>
      {#each view.profiles as profile (profile.id)}
        <li>
          <div class="identity">
            <strong>{profile.name}</strong>
            <span class="hint"
              >{[
                profile.active ? t('profiles.current') : profile.running ? t('profiles.running') : '',
                profile.default ? t('profiles.default') : '',
              ]
                .filter(Boolean)
                .join(' · ')}</span
            >
          </div>
          <div class="actions">
            <Button
              variant="tonal"
              size="sm"
              disabled={busy || profile.active}
              onclick={() => perform('open', profile.id)}
              >{profile.running ? t('profiles.switch') : t('profiles.open')}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onclick={() => (editing = { id: profile.id, name: profile.name })}>{t('profiles.rename')}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || profile.default}
              onclick={() => perform('default', profile.id)}>{t('profiles.makeDefault')}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || profile.active || profile.running || profile.id === 'default'}
              title={profile.id === 'default' ? t('profiles.originalHint') : t('profiles.closeHint')}
              onclick={() => perform('remove', profile.id)}>{t('profiles.remove')}</Button
            >
          </div>
          {#if editing?.id === profile.id}
            <form
              onsubmit={(event) => {
                event.preventDefault();
                if (editing) void perform('rename', editing.id, editing.name);
              }}
            >
              <TextField
                aria-label={t('profiles.name')}
                bind:value={editing.name}
                maxlength={80}
                autocomplete="off"
                required
              />
              <Button variant="tonal" type="submit" disabled={busy || !editing.name.trim()}>{t('profiles.save')}</Button
              >
              <Button variant="ghost" disabled={busy} onclick={() => (editing = null)}>{t('profiles.cancel')}</Button>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void perform('create', undefined, name);
      }}
    >
      <TextField
        aria-label={t('profiles.name')}
        placeholder={t('profiles.placeholder')}
        bind:value={name}
        maxlength={80}
        autocomplete="off"
        required
      />
      <Button variant="tonal" type="submit" disabled={busy || !name.trim() || view.profiles.length >= 50}
        >{t('profiles.create')}</Button
      >
    </form>
  {/if}
</section>

<style>
  section {
    margin-bottom: 24px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 12px 0;
  }
  li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .identity {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    overflow-wrap: anywhere;
  }
  .actions,
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  form :global(.field) {
    flex: 1;
    min-width: 160px;
  }
  .hint {
    color: var(--text-muted);
    font-size: 12px;
  }
  .error {
    color: var(--warn);
  }
</style>
