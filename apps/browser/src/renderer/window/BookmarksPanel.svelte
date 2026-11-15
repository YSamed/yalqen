<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '../../shared/i18n';
  import type { TabId, TabSnapshot } from '../../shared/types';
  import {
    bookmarkTree,
    tabForBookmark,
    type BookmarkNode,
    type BookmarksPanelView,
    type PanelBookmark,
  } from '../../shared/bookmarks-panel';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import TextField from '../ui/TextField.svelte';

  // Bookmarks in their folders on the right edge. A bookmark whose page is open looks like a tab, and clicking it
  // switches to that tab, so the panel can stand in for the tab list.
  let { view, tabs, activeTabId }: { view: BookmarksPanelView; tabs: TabSnapshot[]; activeTabId: TabId | null } =
    $props();

  const send = window.yalqen.send;
  const OPEN_FOLDERS_KEY = 'yalqen:bookmarks-panel-open';
  const tree = $derived(bookmarkTree(view));
  const empty = $derived(view.bookmarks.length === 0 && view.folders.length === 0);

  const openFolders = new SvelteSet<string>(readOpenFolders());
  let editing: { kind: 'bookmark' | 'folder'; id: string; title: string; url: string } | null = $state(null);
  let invalidUrl = $state(false);
  let brokenIcons: Record<string, true> = $state({});

  function readOpenFolders(): string[] {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  function toggleFolder(id: string): void {
    if (openFolders.has(id)) openFolders.delete(id);
    else openFolders.add(id);
    try {
      localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...openFolders]));
    } catch {}
  }

  function countIn(node: BookmarkNode): number {
    return node.bookmarks.length + node.folders.reduce((sum, child) => sum + countIn(child), 0);
  }

  async function edit(event: MouseEvent, next: NonNullable<typeof editing>): Promise<void> {
    event.preventDefault();
    editing = next;
    invalidUrl = false;
    await tick();
    document.querySelector<HTMLInputElement>('.bookmark-editor input')?.select();
  }

  function cancelOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') editing = null;
  }

  function validUrl(url: string): boolean {
    try {
      return ['https:', 'http:', 'file:'].includes(new URL(url.trim()).protocol);
    } catch {
      return false;
    }
  }

  function save(event: SubmitEvent): void {
    event.preventDefault();
    if (!editing) return;
    if (editing.kind === 'folder') {
      if (editing.title.trim()) send({ type: 'rename-bookmark-folder', id: editing.id, title: editing.title });
    } else {
      if (!validUrl(editing.url)) {
        invalidUrl = true;
        return;
      }
      send({ type: 'edit-bookmark', id: editing.id, title: editing.title, url: editing.url });
    }
    editing = null;
  }

  function iconOf(bookmark: PanelBookmark, tab: TabSnapshot | null): string | null {
    const url = tab?.faviconUrl ?? bookmark.icon;
    return url && !brokenIcons[url] ? url : null;
  }
</script>

<aside class="bookmarks-panel" aria-label={t('bookmarksPanel.title')}>
  <header>
    <strong>{t('bookmarksPanel.title')}</strong>
    <IconButton
      icon="close"
      label={t('bookmarksPanel.close')}
      onclick={() => send({ type: 'toggle-bookmarks-panel' })}
    />
  </header>

  <div class="list" role="tree" aria-label={t('bookmarksPanel.title')}>
    {#if empty}
      <p class="empty">{t('bookmarksPanel.empty')}</p>
    {:else}
      {@render nodes(tree.folders, tree.bookmarks, 0)}
    {/if}
  </div>

  <footer>
    <Button size="sm" icon="settings" class="manage" onclick={() => send({ type: 'open-bookmarks-page' })}>
      {t('bookmarksPanel.manage')}
    </Button>
  </footer>
</aside>

{#snippet nodes(folders: BookmarkNode[], bookmarks: PanelBookmark[], depth: number)}
  {#each folders as node (node.folder.id)}
    {@const open = openFolders.has(node.folder.id)}
    <button
      class="row folder"
      role="treeitem"
      aria-selected="false"
      aria-expanded={open}
      style:padding-left="{8 + depth * 14}px"
      onclick={() => toggleFolder(node.folder.id)}
      oncontextmenu={(event) => edit(event, { kind: 'folder', id: node.folder.id, title: node.folder.title, url: '' })}
    >
      <span class="chevron" class:open aria-hidden="true"><Icon name="forward" size={10} /></span>
      <Icon name="folder" size={14} />
      <span class="title">{node.folder.title}</span>
      <small>{countIn(node)}</small>
    </button>
    {#if editing?.id === node.folder.id}{@render editor()}{/if}
    {#if open}
      <div role="group">{@render nodes(node.folders, node.bookmarks, depth + 1)}</div>
    {/if}
  {/each}
  {#each bookmarks as bookmark (bookmark.id)}
    {@const tab = tabForBookmark(bookmark.url, tabs, activeTabId)}
    {@const icon = iconOf(bookmark, tab)}
    <button
      class="row bookmark"
      class:open={tab !== null}
      class:active={tab !== null && tab.id === activeTabId}
      role="treeitem"
      aria-selected={tab !== null && tab.id === activeTabId}
      aria-current={tab !== null && tab.id === activeTabId ? 'page' : undefined}
      title={bookmark.url}
      style:padding-left="{8 + depth * 14 + 14}px"
      onclick={() => send({ type: 'open-bookmark', url: bookmark.url })}
      oncontextmenu={(event) =>
        edit(event, { kind: 'bookmark', id: bookmark.id, title: bookmark.title, url: bookmark.url })}
    >
      {#if icon}
        <img src={icon} alt="" width="16" height="16" onerror={() => (brokenIcons[icon] = true)} />
      {:else}
        <Icon name="globe" size={14} />
      {/if}
      <span class="title">{bookmark.title}</span>
    </button>
    {#if editing?.id === bookmark.id}{@render editor()}{/if}
  {/each}
{/snippet}

{#snippet editor()}
  {#if editing}
    <form
      class="bookmark-editor"
      aria-label={editing.kind === 'folder' ? t('bookmarksPanel.renameFolder') : t('bookmarksPanel.edit')}
      onsubmit={save}
    >
      <label>
        <span>{t('bookmarksPanel.name')}</span>
        <TextField bind:value={editing.title} maxlength={300} onkeydown={cancelOnEscape} />
      </label>
      {#if editing.kind === 'bookmark'}
        <label>
          <span>{t('bookmarksPanel.address')}</span>
          <TextField
            bind:value={editing.url}
            invalid={invalidUrl}
            spellcheck="false"
            onkeydown={cancelOnEscape}
            oninput={() => (invalidUrl = false)}
          />
        </label>
        {#if invalidUrl}<p class="error" role="alert">{t('bookmarksPanel.invalidAddress')}</p>{/if}
      {/if}
      <div class="buttons">
        <Button size="sm" onclick={() => (editing = null)}>{t('bookmarksPanel.cancel')}</Button>
        <Button size="sm" variant="primary" type="submit">{t('bookmarksPanel.save')}</Button>
      </div>
    </form>
  {/if}
{/snippet}

<style>
  .bookmarks-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    border-radius: 16px;
    background: var(--page);
    box-shadow: var(--page-shadow);
    -webkit-app-region: no-drag;
  }

  :global([data-material='glass']) .bookmarks-panel {
    background: transparent;
    box-shadow: none;
  }

  header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 10px 0 16px;
  }

  .list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 0 8px 8px;
    overflow-y: auto;
  }

  .empty {
    margin: 24px 12px;
    color: var(--text-muted);
    text-align: center;
  }

  .row {
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: var(--chrome-control-size);
    padding-right: 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    text-align: left;
    cursor: default;
    transition:
      background var(--transition),
      color var(--transition);
  }

  .row:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .row:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }

  .folder {
    color: var(--text);
  }

  .chevron {
    display: grid;
    flex: none;
    place-items: center;
    width: 10px;
    color: var(--text-muted);
    transition: transform var(--transition);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    flex: none;
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .bookmark img {
    flex: none;
    border-radius: 3px;
  }

  /* A bookmark whose page is open reads as a tab; the one being viewed is lifted like the active tab. */
  .bookmark.open {
    color: var(--text);
  }

  .bookmark.open::after {
    flex: none;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    content: '';
  }

  .bookmark.active {
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  :global([data-material='glass']) .bookmark.active {
    box-shadow: var(--shadow), var(--rim);
  }

  .bookmark-editor {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    margin: 2px 0 6px;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface-strong);
    box-shadow: var(--shadow);
  }

  .bookmark-editor label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .error {
    margin: 0;
    color: var(--warn);
    font-size: var(--font-size-small);
  }

  .buttons {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  footer {
    flex: none;
    padding: 8px;
    border-top: 1px solid var(--page-divider);
  }

  footer :global(.manage) {
    width: 100%;
    justify-content: flex-start;
  }
</style>
