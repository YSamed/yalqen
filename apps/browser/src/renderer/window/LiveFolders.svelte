<script lang="ts">
  import type { LiveFolderKind, LiveFolderView } from '../../shared/live-folders';
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';
  import Select from '../ui/Select.svelte';
  import TextField from '../ui/TextField.svelte';

  let { folders }: { folders: LiveFolderView[] } = $props();

  const send = window.yalqen.send;

  let adding = $state(false);
  let kind = $state<LiveFolderKind>('feed');
  let input = $state('');

  const kinds = $derived([
    { value: 'feed' as const, label: t('liveFolders.kindFeed') },
    { value: 'releases' as const, label: t('liveFolders.kindReleases') },
    { value: 'commits' as const, label: t('liveFolders.kindCommits') },
    { value: 'tags' as const, label: t('liveFolders.kindTags') },
  ]);

  function submit(): void {
    if (!input.trim()) return;
    send({ type: 'add-live-folder', kind, input });
    input = '';
    adding = false;
  }

  function focusField(node: HTMLElement): void {
    node.querySelector('input')?.focus();
  }
</script>

<section class="live" aria-label={t('liveFolders.title')}>
  {#each folders as folder (folder.id)}
    <div class="heading">
      <button
        class="toggle"
        aria-expanded={!folder.collapsed}
        aria-label={folder.unread > 0
          ? `${folder.title} (${t('liveFolders.unread', { count: folder.unread })})`
          : folder.title}
        title={folder.failed ? t('liveFolders.unavailable') : folder.title}
        onclick={() => send({ type: 'toggle-live-folder', id: folder.id })}
        oncontextmenu={(e) => {
          e.preventDefault();
          send({ type: 'open-live-folder-menu', id: folder.id });
        }}
      >
        <span class="name">{folder.title}</span>
        {#if folder.failed}<span class="failed" aria-hidden="true">!</span>{/if}
        {#if folder.unread > 0}<small aria-hidden="true">{folder.unread}</small>{/if}
      </button>
      <IconButton
        size="sm"
        tone="muted"
        icon="reload"
        label={t('liveFolders.refresh')}
        onclick={() => send({ type: 'refresh-live-folder', id: folder.id })}
      />
    </div>
    {#if !folder.collapsed}
      <ul class="items">
        {#each folder.items as entry (entry.id)}
          <li>
            <button
              class="item"
              class:unread={entry.unread}
              title={entry.title}
              onclick={() => send({ type: 'open-live-item', id: folder.id, itemId: entry.id })}
            >
              <span class="dot" aria-hidden="true"></span><span class="name">{entry.title}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/each}

  {#if adding}
    <div class="add" use:focusField>
      <Select bind:value={kind} options={kinds} placement="up" aria-label={t('liveFolders.add')} />
      <TextField
        bind:value={input}
        maxlength={2048}
        placeholder={kind === 'feed' ? t('liveFolders.inputFeed') : t('liveFolders.inputRepo')}
        aria-label={t('liveFolders.add')}
        onkeydown={(e) => {
          if (e.key === 'Enter') submit();
          else if (e.key === 'Escape') adding = false;
          e.stopPropagation();
        }}
      />
    </div>
  {:else}
    <button class="new" onclick={() => (adding = true)}>
      <span>{t('liveFolders.title')}</span>
      <span aria-hidden="true">+</span>
      <span class="sr">{t('liveFolders.add')}</span>
    </button>
  {/if}
</section>

<style>
  .live {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 2px;
    max-height: 40%;
    margin-top: 6px;
    overflow-y: auto;
    font-size: var(--font-size-small);
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
  }
  .toggle,
  .new,
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    padding: 5px 6px;
    text-align: start;
  }
  .toggle {
    flex: 1;
    background: var(--surface);
  }
  .new {
    justify-content: space-between;
  }
  .toggle:hover,
  .new:hover,
  .item:hover {
    background: var(--surface-hover);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small,
  .failed {
    font-size: 10px;
  }
  .items {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    width: 100%;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .item.unread {
    color: var(--text);
  }
  .item.unread .dot {
    background: var(--accent);
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
