<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { PasswordsView, SavedPasswordInfo } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SearchField from '../ui/SearchField.svelte';

  const COPIED_MS = 2000;
  const api = window.yalqenSettings;

  let view = $state<PasswordsView | null>(null);
  let query = $state('');
  let revealed = $state<Record<string, string>>({});
  let copiedId = $state<string | null>(null);

  const host = (origin: string) => new URL(origin).host;
  const matches = (entry: SavedPasswordInfo, needle: string) =>
    host(entry.origin).includes(needle) || entry.username.toLowerCase().includes(needle);
  const visible = $derived(view?.passwords.filter((entry) => matches(entry, query.trim().toLowerCase())) ?? []);

  async function toggleReveal(id: string): Promise<void> {
    if (id in revealed) {
      delete revealed[id];
      return;
    }
    const password = await api.revealPassword(id);
    if (password !== null) revealed[id] = password;
  }

  async function copy(id: string): Promise<void> {
    if (!(await api.copyPassword(id))) return;
    copiedId = id;
    setTimeout(() => {
      if (copiedId === id) copiedId = null;
    }, COPIED_MS);
  }

  onMount(() => {
    void api.passwords().then((next) => (view = next));
    return api.onPasswordsChange((next) => {
      view = next;
      revealed = Object.fromEntries(
        Object.entries(revealed).filter(([id]) => next.passwords.some((entry) => entry.id === id)),
      );
    });
  });
</script>

<h2>{t('passwordsPanel.title')}</h2>
<p class="hint intro">{t('passwordsPanel.intro')}</p>

{#if view}
  {#if !view.available}
    <p class="error" role="alert">{t('passwordsPanel.unavailable')}</p>
  {/if}

  {#if view.passwords.length > 0}
    <div class="search">
      <SearchField
        bind:value={query}
        placeholder={t('passwordsPanel.searchPlaceholder')}
        aria-label={t('passwordsPanel.searchLabel')}
      />
    </div>
  {/if}

  {#each visible as entry (entry.id)}
    <div class="entry">
      <div class="details">
        <span class="name">{host(entry.origin)}</span>
        <span class="hint">{entry.username || t('passwordsPanel.noUsername')}</span>
      </div>
      <code class="secret" aria-label={t('passwordsPanel.password')}>{revealed[entry.id] ?? '••••••••'}</code>
      <div class="controls">
        <Button size="sm" variant="tonal" onclick={() => toggleReveal(entry.id)}
          >{entry.id in revealed ? t('passwordsPanel.hide') : t('passwordsPanel.show')}</Button
        >
        <Button size="sm" variant="tonal" onclick={() => copy(entry.id)}
          >{copiedId === entry.id ? t('passwordsPanel.copied') : t('passwordsPanel.copy')}</Button
        >
        <IconButton
          icon="close"
          tone="muted"
          label={t('passwordsPanel.deleteLabel', { host: host(entry.origin) })}
          onclick={() => api.removePassword(entry.id)}
        />
      </div>
    </div>
  {:else}
    <p class="hint empty">{view.passwords.length > 0 ? t('passwordsPanel.noMatches') : t('passwordsPanel.empty')}</p>
  {/each}

  {#if view.neverSave.length > 0}
    <h2>{t('passwordsPanel.neverSaved')}</h2>
    {#each view.neverSave as origin (origin)}
      <div class="entry">
        <span class="details name">{host(origin)}</span>
        <IconButton
          icon="close"
          tone="muted"
          label={t('passwordsPanel.removeFromList', { host: host(origin) })}
          onclick={() => api.allowSaving(origin)}
        />
      </div>
    {/each}
  {/if}
{/if}

<style>
  .intro {
    margin: 0 0 8px;
  }

  .empty {
    margin: 8px 0;
  }

  .search {
    padding: 4px 0 8px;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .details {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    font-weight: 500;
  }

  .secret {
    flex: none;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
  }

  .controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }
</style>
