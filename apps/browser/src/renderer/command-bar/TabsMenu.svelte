<script lang="ts">
  import { untrack } from 'svelte';
  import { displayHost } from '../../shared/hosts';
  import { t } from '../../shared/i18n';
  import type { CommandBarAction, SidebarFooterItem, SidebarMenu, SidebarMenuCommand } from '../../shared/types';
  import Icon, { type IconName } from '../ui/Icon.svelte';
  import type { SidebarFlyout } from './SidebarMenu.svelte';

  const VISIBLE_TABS = 5;

  let {
    menu,
    query,
    flyout,
    onaction,
    onflyout,
    ondragitem,
  }: {
    menu: SidebarMenu;
    query: string;
    flyout: SidebarFlyout | null;
    onaction: (action: CommandBarAction) => void;
    onflyout: (kind: SidebarFlyout | null, row?: HTMLElement) => void;
    ondragitem: (item: SidebarFooterItem | null) => void;
  } = $props();
  let showAll = $state(false);
  let view: 'main' | 'spaces' = $state(untrack(() => menu.kind) === 'spaces' ? 'spaces' : 'main');
  let brokenIcons: Record<string, true> = $state({});

  const needle = $derived(query.trim().toLocaleLowerCase());
  const matches = $derived(
    needle ? menu.tabs.filter((tab) => `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(needle)) : menu.tabs,
  );
  const shown = $derived(needle || showAll ? matches : matches.slice(0, VISIBLE_TABS));
  const activeSpace = $derived(menu.spaces.find((space) => space.active));
  const has = (command: SidebarMenuCommand) => menu.commands.includes(command);
  const run = (command: SidebarMenuCommand) => onaction({ type: 'sidebar-command', command });

  // Rows that can also live in the sidebar footer can be dragged onto it.
  function footerDrag(item: SidebarFooterItem | undefined) {
    if (!item || !menu.footer) return {};
    return {
      draggable: true,
      ondragstart: (event: DragEvent) => {
        const transfer = event.dataTransfer;
        if (transfer) {
          transfer.setData('application/x-yalqen-footer-item', item);
          transfer.effectAllowed = 'copy';
          const icon = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.icon');
          if (icon) transfer.setDragImage(icon, icon.offsetWidth / 2, icon.offsetHeight / 2);
        }
        onflyout(null);
        ondragitem(item);
      },
      ondragend: () => ondragitem(null),
    };
  }
</script>

{#snippet flyoutRow(kind: SidebarFlyout, icon: IconName, label: string)}
  <button
    type="button"
    class="item"
    {...footerDrag(kind)}
    class:open={flyout === kind}
    aria-haspopup="menu"
    aria-expanded={flyout === kind}
    onclick={(event) => onflyout(kind, event.currentTarget)}
    onmouseenter={(event) => onflyout(kind, event.currentTarget)}
  >
    <span class="icon"><Icon name={icon} /></span>
    <span class="label">{label}</span>
    <span class="trail"><Icon name="forward" size={14} /></span>
  </button>
{/snippet}

{#snippet row(
  icon: IconName,
  label: string,
  onclick: () => void,
  trail = '',
  more = false,
  footerItem: SidebarFooterItem | undefined = undefined,
)}
  <button type="button" class="item" {...footerDrag(footerItem)} {onclick} onmouseenter={() => onflyout(null)}>
    <span class="icon"><Icon name={icon} /></span>
    <span class="label">{label}</span>
    {#if trail || more}
      <span class="trail">
        {trail}{#if more}<Icon name="forward" size={14} />{/if}
      </span>
    {/if}
  </button>
{/snippet}

{#if view === 'spaces'}
  {@render row('back', t('spaces.switcher'), () => (view = 'main'))}
  <div class="divider"></div>
  {#each menu.spaces as space (space.id)}
    <button
      type="button"
      class="item"
      onclick={() => onaction({ type: 'switch-space', id: space.id })}
      oncontextmenu={(event) => {
        event.preventDefault();
        onaction({ type: 'open-space-menu', id: space.id });
      }}
    >
      <span class="icon">
        {#if space.icon}{space.icon}{:else}<span class="dot"></span>{/if}
      </span>
      <span class="label">{space.name}</span>
      {#if space.active}<span class="trail"><Icon name="check" size={14} /></span>{/if}
    </button>
  {/each}
  {#if has('create-space') || has('import-space') || has('add-live-folder')}<div class="divider"></div>{/if}
  {#if has('edit-space')}{@render row('settings', t('sidebarMenu.editSpace'), () => run('edit-space'))}{/if}
  {#if has('create-space')}{@render row('plus', t('spaces.add'), () => run('create-space'))}{/if}
  {#if has('import-space')}{@render row('folder', t('spaces.import'), () => run('import-space'))}{/if}
  {#if has('add-live-folder')}{@render row('bookmarks', t('liveFolders.add'), () => run('add-live-folder'))}{/if}
{:else}
  {#if needle || matches.length > 0}<h3 class="heading">{t('sidebarMenu.openTabs')}</h3>{/if}
  {#each shown as tab (tab.id)}
    <button
      type="button"
      class="item"
      onclick={() => onaction({ type: 'switch-tab', id: tab.id })}
      onmouseenter={() => onflyout(null)}
    >
      <span class="icon">
        {#if tab.faviconUrl && !brokenIcons[tab.faviconUrl]}
          <img src={tab.faviconUrl} alt="" onerror={() => (brokenIcons[tab.faviconUrl!] = true)} />
        {:else}
          <Icon name="globe" />
        {/if}
      </span>
      <span class="label">{tab.title || displayHost(tab.url)}</span>
    </button>
  {/each}
  {#if needle && matches.length === 0}<p class="empty">{t('sidebarMenu.noResults')}</p>{/if}
  {#if !needle}
    {#if !showAll && matches.length > VISIBLE_TABS}
      {@render row('more', t('sidebarMenu.showAll'), () => (showAll = true), '', true)}
    {/if}
    <div class="divider"></div>
    {#if has('history')}{@render flyoutRow('history', 'history', t('toolbar.history'))}{/if}
    {#if has('bookmarks')}{@render flyoutRow('bookmarks', 'bookmarks', t('toolbar.bookmarks'))}{/if}
    {#if menu.spaces.length > 0}
      {@render row('sidebar', t('spaces.switcher'), () => (view = 'spaces'), activeSpace?.name ?? '', true, 'spaces')}
    {/if}
    <div class="divider"></div>
    {@render row(
      'download',
      t('toolbar.downloads'),
      () => run('downloads'),
      menu.downloadsActive > 0 ? String(menu.downloadsActive) : '',
      false,
      'downloads',
    )}
    {#if has('extensions')}{@render row(
        'extensions',
        t('toolbar.extensions'),
        () => run('extensions'),
        '',
        false,
        'extensions',
      )}{/if}
    {#if has('screenshot')}{@render row(
        'screenshot',
        t('toolbar.fullPageScreenshot'),
        () => run('screenshot'),
        '',
        false,
        'screenshot',
      )}{/if}
    {#if has('settings')}{@render row(
        'settings',
        t('toolbar.settings'),
        () => run('settings'),
        '',
        false,
        'settings',
      )}{/if}
    {@render row('profile', t('toolbar.profile'), () => run('profile'), '', false, 'profile')}
  {/if}
{/if}

<style>
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
</style>
