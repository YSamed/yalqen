<script lang="ts">
  import { onMount } from 'svelte';
  import type { PasswordsView, SavedPasswordInfo } from '../../shared/types';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import SearchField from './ui/SearchField.svelte';

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

<h2>Şifreler</h2>
<p class="hint intro">
  Bir sitede oturum açtığınızda Yalqen şifreyi kaydetmeyi önerir. Şifreler macOS Anahtar Zinciri'nde tutulan bir
  anahtarla şifrelenir; gizli sekmelerde ve geliştirici pencerelerinde kaydetme önerilmez.
</p>

{#if view}
  {#if !view.available}
    <p class="error" role="alert">Bu Mac'te şifreleme kullanılamıyor; şifreler kaydedilemez.</p>
  {/if}

  {#if view.passwords.length > 0}
    <div class="search">
      <SearchField bind:value={query} placeholder="Site veya kullanıcı adı ara" aria-label="Şifrelerde ara" />
    </div>
  {/if}

  {#each visible as entry (entry.id)}
    <div class="entry">
      <div class="details">
        <span class="name">{host(entry.origin)}</span>
        <span class="hint">{entry.username || 'Kullanıcı adı yok'}</span>
      </div>
      <code class="secret" aria-label="Şifre">{revealed[entry.id] ?? '••••••••'}</code>
      <div class="controls">
        <Button size="sm" onclick={() => toggleReveal(entry.id)}>{entry.id in revealed ? 'Gizle' : 'Göster'}</Button>
        <Button size="sm" onclick={() => copy(entry.id)}>{copiedId === entry.id ? 'Kopyalandı' : 'Kopyala'}</Button>
        <IconButton
          icon="close"
          tone="muted"
          label="{host(entry.origin)} şifresini sil"
          onclick={() => api.removePassword(entry.id)}
        />
      </div>
    </div>
  {:else}
    <p class="hint empty">{view.passwords.length > 0 ? 'Eşleşen şifre yok.' : 'Kayıtlı şifre yok.'}</p>
  {/each}

  {#if view.neverSave.length > 0}
    <h2>Hiç kaydedilmeyenler</h2>
    {#each view.neverSave as origin (origin)}
      <div class="entry">
        <span class="details name">{host(origin)}</span>
        <IconButton
          icon="close"
          tone="muted"
          label="{host(origin)} listeden çıkar"
          onclick={() => api.allowSaving(origin)}
        />
      </div>
    {/each}
  {/if}
{/if}

<style>
  h2 {
    margin: 12px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .error {
    color: var(--warn);
    font-size: var(--font-size-small);
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
