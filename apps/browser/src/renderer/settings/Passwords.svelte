<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { PasswordsView, SavedPasswordInfo, ManualPassword } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import TextField from '../ui/TextField.svelte';

  const COPIED_MS = 2000;
  const api = window.yalqenSettings;

  let view = $state<PasswordsView | null>(null);
  let query = $state('');
  let revealed = $state<Record<string, string>>({});
  let copiedId = $state<string | null>(null);
  let editing = $state<ManualPassword | null>(null);
  let busy = $state(false);
  let message = $state('');
  let failed = $state(false);

  function edit(entry?: SavedPasswordInfo): void {
    editing = { id: entry?.id ?? null, url: entry?.origin ?? '', username: entry?.username ?? '', password: '' };
    message = '';
  }
  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!editing || busy) return;
    busy = true;
    try {
      failed = !(await api.savePassword($state.snapshot(editing)));
      if (!failed) {
        editing = null;
        message = '';
      } else message = t('passwordTools.saveFailed');
    } finally {
      busy = false;
    }
  }
  async function generate(): Promise<void> {
    const draft = editing;
    if (!draft || busy) return;
    busy = true;
    try {
      const password = await api.generatePassword();
      if (password && editing === draft) draft.password = password;
    } finally {
      busy = false;
    }
  }
  async function transfer(mode: 'import' | 'export'): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const result = await api.transferPasswords(mode);
      if (result.status === 'cancelled') return;
      failed = result.status === 'failed';
      message = failed
        ? t('passwordTools.transferFailed')
        : t('passwordTools.transferDone', { count: result.added, skipped: result.skipped });
    } finally {
      busy = false;
    }
  }

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
      revealed = {};
      copiedId = null;
    });
  });
</script>

<h2>{t('passwordsPanel.title')}</h2>
<p class="hint intro">{t('passwordsPanel.intro')}</p>

{#if view}
  {#if !view.available}
    <p class="error" role="alert">{t('passwordsPanel.unavailable')}</p>
  {/if}

  <div class="actions">
    <Button disabled={busy || !view.available} onclick={() => edit()}>{t('passwordTools.add')}</Button>
    <Button variant="tonal" disabled={busy || !view.available} onclick={() => transfer('import')}
      >{t('passwordTools.import')}</Button
    >
    <Button
      variant="tonal"
      disabled={busy || !view.available || !view.passwords.length}
      onclick={() => transfer('export')}>{t('passwordTools.export')}</Button
    >
  </div>
  {#if message}<p class:error={failed} class="hint" role="status">{message}</p>{/if}
  {#if editing}
    <form onsubmit={save} class="editor">
      <label for="credential-url">{t('passwordTools.site')}</label>
      <TextField
        id="credential-url"
        type="url"
        maxlength={8192}
        required
        bind:value={editing.url}
        autocomplete="off"
        disabled={busy}
      />
      <p class="hint">{t('passwordTools.siteHint')}</p>
      <label for="credential-username">{t('passwordTools.username')}</label>
      <TextField
        id="credential-username"
        maxlength={512}
        bind:value={editing.username}
        autocomplete="off"
        disabled={busy}
      />
      <label for="credential-password">{t('passwordsPanel.password')}</label>
      <TextField
        id="credential-password"
        type="password"
        maxlength={4096}
        required={!editing.id}
        bind:value={editing.password}
        autocomplete="new-password"
        disabled={busy}
      />
      {#if editing.id}<p class="hint">{t('passwordTools.keepPassword')}</p>{/if}
      <div class="actions">
        <Button type="submit" disabled={busy}>{t('passwordTools.save')}</Button>
        <Button variant="tonal" disabled={busy} onclick={generate}>{t('passwordTools.generate')}</Button>
        <Button variant="ghost" disabled={busy} onclick={() => (editing = null)}>{t('profiles.cancel')}</Button>
      </div>
    </form>
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
        <Button size="sm" variant="tonal" disabled={busy} onclick={() => edit(entry)}>{t('passwordTools.edit')}</Button>
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .editor .hint {
    margin: 0;
  }
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
