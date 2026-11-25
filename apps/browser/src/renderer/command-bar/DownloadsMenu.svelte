<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { CommandBarAction, SidebarMenu } from '../../shared/types';
  import Icon from '../ui/Icon.svelte';

  let { menu, query, onaction }: { menu: SidebarMenu; query: string; onaction: (action: CommandBarAction) => void } =
    $props();

  const needle = $derived(query.trim().toLocaleLowerCase());
  const shown = $derived(
    needle ? menu.downloads.filter((entry) => entry.filename.toLocaleLowerCase().includes(needle)) : menu.downloads,
  );
</script>

{#each shown as entry (entry.id)}
  <button
    type="button"
    class="item download"
    draggable="true"
    onclick={() => onaction({ type: 'download-action', id: entry.id })}
    ondragstart={(event) => {
      event.preventDefault();
      onaction({ type: 'drag-download', id: entry.id });
    }}
  >
    <span class="icon"><Icon name="download" /></span>
    <span class="text">
      <span class="label">{entry.filename}</span>
      <small>{entry.status}</small>
    </span>
  </button>
{:else}
  <p class="empty">{needle ? t('sidebarMenu.noResults') : t('downloads.menuNone')}</p>
{/each}
{#if !needle}
  <div class="divider"></div>
  <button type="button" class="item" onclick={() => onaction({ type: 'sidebar-command', command: 'downloads-all' })}>
    <span class="icon"><Icon name="download" /></span>
    <span class="label">{t('downloads.menuAll')}</span>
  </button>
  <button type="button" class="item" onclick={() => onaction({ type: 'sidebar-command', command: 'downloads-folder' })}>
    <span class="icon"><Icon name="folder" /></span>
    <span class="label">{t('downloads.menuOpenFolder')}</span>
  </button>
{/if}

<style>
  .item.download {
    height: 48px;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .text .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
  }
</style>
