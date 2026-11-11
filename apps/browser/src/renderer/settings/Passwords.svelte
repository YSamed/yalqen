<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { t } from '../../shared/i18n';
  import { isWeakPassword } from '../../shared/password-health';
  import type { PasswordsView, SavedPasswordInfo, ManualPassword, PasswordIssue } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import TextField from '../ui/TextField.svelte';

  const COPIED_MS = 2000;
  const REVEAL_MS = 30_000;
  const ISSUES: readonly PasswordIssue[] = ['weak', 'reused', 'old'];
  const api = window.yalqenSettings;

  let view = $state<PasswordsView | null>(null);
  let query = $state('');
  let revealed = $state<Record<string, string>>({});
  let copiedId = $state<string | null>(null);
  let filter = $state<PasswordIssue | 'all'>('all');
  let sort = $state<'site' | 'changed'>('site');
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
  const visible = $derived(
    view?.passwords.filter(
      (entry) => (filter === 'all' || entry.issues.includes(filter)) && matches(entry, query.trim().toLowerCase()),
    ) ?? [],
  );
  const issueCount = (issue: PasswordIssue) =>
    view?.passwords.filter((entry) => entry.issues.includes(issue)).length ?? 0;
  const filterOptions = $derived([
    { value: 'all' as const, label: t('passwordsPanel.all') },
    ...ISSUES.map((issue) => ({ value: issue, label: `${t(`passwordsPanel.${issue}`)} ${issueCount(issue)}` })),
  ]);
  const sortOptions = $derived([
    { value: 'site' as const, label: t('passwordsPanel.sortSite') },
    { value: 'changed' as const, label: t('passwordsPanel.sortChanged') },
  ]);
  const groups = $derived.by(() => {
    const byHost: Record<string, SavedPasswordInfo[]> = {};
    for (const entry of visible) (byHost[host(entry.origin)] ??= []).push(entry);
    const list = Object.entries(byHost).map(([name, entries]) => ({
      name,
      entries: sort === 'changed' ? [...entries].sort((a, b) => b.updatedAt - a.updatedAt) : entries,
    }));
    return list.sort((a, b) =>
      sort === 'changed' ? b.entries[0].updatedAt - a.entries[0].updatedAt : a.name.localeCompare(b.name),
    );
  });
  const hideTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

  function hide(id: string): void {
    clearTimeout(hideTimers.get(id));
    hideTimers.delete(id);
    delete revealed[id];
  }
  async function toggleReveal(id: string): Promise<void> {
    if (id in revealed) {
      hide(id);
      return;
    }
    const password = await api.revealPassword(id);
    if (password === null) return;
    revealed[id] = password;
    hideTimers.set(
      id,
      setTimeout(() => hide(id), REVEAL_MS),
    );
  }

  async function copy(id: string, field: 'password' | 'username'): Promise<void> {
    if (!(await (field === 'password' ? api.copyPassword(id) : api.copyUsername(id)))) return;
    copiedId = `${field}:${id}`;
    setTimeout(() => {
      if (copiedId === `${field}:${id}`) copiedId = null;
    }, COPIED_MS);
  }

  function remove(entry: SavedPasswordInfo): void {
    if (confirm(t('passwordsPanel.confirmDelete', { host: host(entry.origin) }))) void api.removePassword(entry.id);
  }

  onMount(() => {
    void api.passwords().then((next) => (view = next));
    const stop = api.onPasswordsChange((next) => {
      view = next;
      revealed = {};
      copiedId = null;
      hideTimers.forEach(clearTimeout);
      hideTimers.clear();
    });
    return () => {
      stop();
      hideTimers.forEach(clearTimeout);
    };
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
      {#if editing.password && isWeakPassword(editing.password)}
        <p class="error" role="status">{t('passwordTools.weakHint')}</p>
      {/if}
      <div class="actions">
        <Button type="submit" disabled={busy}>{t('passwordTools.save')}</Button>
        <Button variant="tonal" disabled={busy} onclick={generate}>{t('passwordTools.generate')}</Button>
        <Button variant="ghost" disabled={busy} onclick={() => (editing = null)}>{t('profiles.cancel')}</Button>
      </div>
    </form>
  {/if}

  {#if view.passwords.length > 0}
    <div class="toolbar">
      <div class="grow">
        <SearchField
          bind:value={query}
          placeholder={t('passwordsPanel.searchPlaceholder')}
          aria-label={t('passwordsPanel.searchLabel')}
        />
      </div>
      <Select bind:value={sort} options={sortOptions} aria-label={t('passwordsPanel.sortLabel')} />
    </div>
    <SegmentedControl
      label={t('passwordsPanel.filterLabel')}
      options={filterOptions}
      value={filter}
      onchange={(next) => (filter = next)}
    />
    <p class="hint">{t('passwordsPanel.clipboardNote')}</p>
  {/if}

  {#each groups as group (group.name)}
    <section class="group">
      <h3 class="site">
        <span class="monogram" aria-hidden="true"
          >{group.name
            .replace(/^www\./, '')
            .charAt(0)
            .toUpperCase()}</span
        >
        {group.name}
      </h3>
      {#each group.entries as entry (entry.id)}
        <div class="entry">
          <div class="details">
            <span class="name">{entry.username || t('passwordsPanel.noUsername')}</span>
            <span class="hint"
              >{t('passwordsPanel.changed', { date: new Date(entry.updatedAt).toLocaleDateString() })}</span
            >
          </div>
          {#each entry.issues as issue (issue)}
            <span class="pill" class:warn={issue !== 'old'}>{t(`passwordsPanel.${issue}`)}</span>
          {/each}
          <code class="secret" aria-label={t('passwordsPanel.password')}>{revealed[entry.id] ?? '••••••••'}</code>
          <div class="controls">
            <Button size="sm" variant="tonal" disabled={busy} onclick={() => edit(entry)}
              >{t('passwordTools.edit')}</Button
            >
            <Button size="sm" variant="tonal" onclick={() => toggleReveal(entry.id)}
              >{entry.id in revealed ? t('passwordsPanel.hide') : t('passwordsPanel.show')}</Button
            >
            <Button size="sm" variant="tonal" onclick={() => copy(entry.id, 'password')}
              >{copiedId === `password:${entry.id}` ? t('passwordsPanel.copied') : t('passwordsPanel.copy')}</Button
            >
            {#if entry.username}
              <Button size="sm" variant="tonal" onclick={() => copy(entry.id, 'username')}
                >{copiedId === `username:${entry.id}`
                  ? t('passwordsPanel.copied')
                  : t('passwordsPanel.copyUsername')}</Button
              >
            {/if}
            <IconButton
              icon="close"
              tone="muted"
              label={t('passwordsPanel.deleteLabel', { host: group.name })}
              onclick={() => remove(entry)}
            />
          </div>
        </div>
      {/each}
    </section>
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

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0 8px;
  }

  .grow {
    flex: 1;
  }

  .group {
    margin-top: 16px;
  }

  .site {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--font-size);
    font-weight: 600;
  }

  .monogram {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-control);
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .pill {
    flex: none;
    padding: 2px 9px;
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
  }

  .pill.warn {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
  }

  .entry {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
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
