<script lang="ts">
  import type { DownloadsSummary, ProfileKind, SidebarFooterItem, SidebarMenuKind, TabId } from '../../shared/types';
  import { placeSidebarFooterItem } from '../../shared/types';
  import type { SpaceView } from '../../shared/workspaces';
  import { t } from '../../shared/i18n';
  import Icon from '../ui/Icon.svelte';
  import { anchorRect } from './anchor';
  import { footerButton } from './footer-buttons';

  let {
    profile,
    spaces,
    activeSpaceId,
    footerItems,
    activeTabId,
    downloads,
  }: {
    profile: ProfileKind;
    spaces: SpaceView[];
    activeSpaceId: string;
    footerItems: SidebarFooterItem[];
    activeTabId: TabId | null;
    downloads: DownloadsSummary;
  } = $props();

  const send = window.yalqen.send;
  const activeSpace = $derived(spaces.find((space) => space.id === activeSpaceId));
  let moreButton: HTMLButtonElement | undefined = $state();

  function openSidebarMenu(kind: SidebarMenuKind, from: HTMLElement | undefined = moreButton): void {
    if (!from) return;
    send({
      type: 'open-sidebar-menu',
      kind,
      anchor: anchorRect(from),
      ...(footerTools ? { footer: anchorRect(footerTools) } : {}),
    });
  }

  const FOOTER_ITEM_TYPE = 'application/x-yalqen-footer-item';
  const FOOTER_SLOT_WIDTH = 35;
  let footerTools: HTMLElement | undefined = $state();
  let draggedFooterItem: SidebarFooterItem | null = null;

  function footerSlot(event: DragEvent): number {
    return footerTools ? Math.floor((event.clientX - footerTools.getBoundingClientRect().left) / FOOTER_SLOT_WIDTH) : 0;
  }

  function setFooterItems(items: SidebarFooterItem[]): void {
    send({ type: 'set-sidebar-footer-items', items });
  }
</script>

<div class="spaces">
  {#if profile === 'developer'}
    <button type="button" class="footer-button chats-button" onclick={() => openSidebarMenu('chats')}>
      <Icon name="chats" size={16} />
      <span class="footer-label">{t('sidebarMenu.chats')}</span>
    </button>
  {:else}
    <div
      class="footer-tools"
      role="toolbar"
      tabindex="-1"
      aria-label={t('sidebarMenu.footerTools')}
      bind:this={footerTools}
      ondragover={(e) => {
        if (!draggedFooterItem) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      }}
      ondrop={(e) => {
        if (!draggedFooterItem) return;
        e.preventDefault();
        setFooterItems(placeSidebarFooterItem(footerItems, draggedFooterItem, footerSlot(e)));
        draggedFooterItem = null;
      }}
    >
      {#each footerItems as item (item)}
        {#if item !== 'spaces' || spaces.length > 0}
          {@const button = footerButton(item, send, openSidebarMenu)}
          <button
            type="button"
            class="footer-button tool-button"
            aria-label={button.label}
            title={button.label}
            aria-haspopup={button.popup ? 'dialog' : undefined}
            disabled={item === 'screenshot' && !activeTabId}
            draggable="true"
            ondragstart={(e) => {
              draggedFooterItem = item;
              e.dataTransfer?.setData(FOOTER_ITEM_TYPE, item);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            ondragend={(e) => {
              // Dropped anywhere outside the footer takes the button off it.
              if (draggedFooterItem === item && e.dataTransfer?.dropEffect === 'none')
                setFooterItems(footerItems.filter((candidate) => candidate !== item));
              draggedFooterItem = null;
            }}
            onclick={(e) => button.run(e.currentTarget)}
          >
            {#if item === 'spaces' && activeSpace?.icon}<span class="space-icon">
                {activeSpace.icon}
              </span>{:else}<Icon name={button.icon} size={16} />{/if}
            {#if item === 'downloads' && downloads.active > 0}<span class="download-dot" aria-hidden="true"></span>{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
  <button
    bind:this={moreButton}
    type="button"
    class="footer-button more-button"
    aria-label={t('sidebarMenu.more')}
    title={t('sidebarMenu.more')}
    aria-haspopup="dialog"
    onclick={() => openSidebarMenu('tabs')}
  >
    <Icon name="down" size={16} />
    {#if downloads.active > 0 && profile === 'developer'}<span class="download-dot" aria-hidden="true"></span>{/if}
  </button>
</div>

<style>
  .download-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: light-dark(#b07a00, #e6c278);
  }
  .footer-button {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 35px;
    padding: 0 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
  }
  .footer-button:hover {
    background: var(--card-tile);
    color: var(--text);
  }
  .chats-button {
    flex: 1;
    min-width: 0;
  }
  .footer-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more-button {
    position: relative;
    flex: none;
    justify-content: center;
    width: 35px;
    padding: 0;
  }
  .footer-tools {
    display: flex;
    flex: 1;
    min-width: 0;
  }
  .tool-button {
    position: relative;
    justify-content: center;
    width: 35px;
    padding: 0;
  }
  .tool-button:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .space-icon {
    font-size: 15px;
    line-height: 1;
  }
  .spaces {
    display: flex;
    flex: none;
    align-items: center;
    padding-top: 8px;
  }

  .spaces > :global(:not(.panel-toggle)) {
    transition: opacity 120ms ease-out;
  }
</style>
