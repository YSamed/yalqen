<script lang="ts" module>
  export type SidebarFlyout = 'history' | 'bookmarks';
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { displayHost } from '../../shared/hosts';
  import { t } from '../../shared/i18n';
  import type { CommandBarAction, SidebarMenu } from '../../shared/types';
  import Icon from '../ui/Icon.svelte';
  import ChatsMenu from './ChatsMenu.svelte';
  import TabsMenu from './TabsMenu.svelte';

  const PANEL_WIDTH = 334;
  const MAX_HEIGHT = 522;
  const EDGE = 8;
  const GAP = 6;
  const FLYOUT_WIDTH = 334;
  const FLYOUT_PADDING = 6;
  const FLYOUT_OVERLAP = 2;

  let { menu, onaction }: { menu: SidebarMenu; onaction: (action: CommandBarAction) => void } = $props();
  let query = $state('');
  let input: HTMLInputElement | undefined = $state();
  let body: HTMLElement | undefined = $state();
  let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
  let flyout = $state<{ kind: SidebarFlyout; top: number } | null>(null);
  let flyoutHeight = $state(0);
  let brokenIcons: Record<string, true> = $state({});

  // The tabs menu leaves room for its flyout up front, so the panel never jumps while a row is hovered.
  const reserved = $derived(menu.kind === 'tabs' ? PANEL_WIDTH + FLYOUT_WIDTH - FLYOUT_OVERLAP : PANEL_WIDTH);
  const left = $derived(Math.max(EDGE, Math.min(menu.anchor.x, viewport.width - reserved - EDGE)));
  const bottom = $derived(viewport.height - menu.anchor.y + GAP);
  const maxHeight = $derived(Math.min(MAX_HEIGHT, menu.anchor.y - GAP - EDGE));

  const flyoutLinks = $derived(flyout ? menu[flyout.kind] : []);
  const flyoutLeft = $derived(
    left + reserved + EDGE <= viewport.width
      ? left + PANEL_WIDTH - FLYOUT_OVERLAP
      : Math.max(EDGE, left - FLYOUT_WIDTH + FLYOUT_OVERLAP),
  );
  const flyoutTop = $derived(
    flyout ? Math.max(EDGE, Math.min(flyout.top - FLYOUT_PADDING, viewport.height - flyoutHeight - EDGE)) : 0,
  );

  function openFlyout(kind: SidebarFlyout | null, row?: HTMLElement): void {
    flyout = kind && row ? { kind, top: row.getBoundingClientRect().top } : null;
  }

  $effect(() => {
    void menu;
    flyout = null;
    query = '';
    void tick().then(() => input?.focus());
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    body?.querySelector<HTMLButtonElement>('.item')?.click();
  }
</script>

<svelte:window onresize={() => (viewport = { width: window.innerWidth, height: window.innerHeight })} />

<div class="backdrop">
  <div
    class="panel"
    class:tinted={menu.tint !== null}
    role="dialog"
    aria-label={menu.kind === 'chats' ? t('sidebarMenu.chats') : t('sidebarMenu.more')}
    style:left="{left}px"
    style:bottom="{bottom}px"
    style:max-height="{maxHeight}px"
    style:--menu-tint={menu.tint}
  >
    <label class="search">
      <Icon name="search" size={16} />
      <input
        bind:this={input}
        bind:value={query}
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder={t('sidebarMenu.search')}
        onkeydown={onKeydown}
      />
    </label>
    <div class="body" bind:this={body}>
      {#if menu.kind === 'chats'}
        <ChatsMenu chats={menu.chats} {query} {onaction} />
      {:else}
        <TabsMenu {menu} {query} flyout={flyout?.kind ?? null} {onaction} onflyout={openFlyout} />
      {/if}
    </div>
  </div>
  {#if flyout && !query.trim()}
    <div
      bind:clientHeight={flyoutHeight}
      class="panel flyout"
      class:tinted={menu.tint !== null}
      role="menu"
      aria-label={flyout.kind === 'history' ? t('toolbar.history') : t('toolbar.bookmarks')}
      style:left="{flyoutLeft}px"
      style:top="{flyoutTop}px"
      style:max-height="{viewport.height - EDGE * 2}px"
      style:--menu-tint={menu.tint}
    >
      <div class="body">
        {#each flyoutLinks as link (link.url)}
          <button
            type="button"
            class="item"
            role="menuitem"
            onclick={() => onaction({ type: 'open-link', url: link.url })}
          >
            <span class="icon">
              {#if link.faviconUrl && !brokenIcons[link.faviconUrl]}
                <img src={link.faviconUrl} alt="" onerror={() => (brokenIcons[link.faviconUrl!] = true)} />
              {:else}
                <Icon name="globe" />
              {/if}
            </span>
            <span class="label">{link.title || displayHost(link.url)}</span>
          </button>
        {/each}
        {#if flyoutLinks.length > 0}<div class="divider"></div>{/if}
        <button
          type="button"
          class="item"
          role="menuitem"
          onclick={() => onaction({ type: 'sidebar-command', command: flyout!.kind })}
        >
          <span class="icon"><Icon name={flyout.kind === 'history' ? 'history' : 'bookmarks'} /></span>
          <span class="label"
            >{flyout.kind === 'history' ? t('sidebarMenu.showAllHistory') : t('sidebarMenu.showAllBookmarks')}</span
          >
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
  }

  .panel {
    --menu-surface: light-dark(#f7f7f8, #26282b);
    --menu-hover: light-dark(rgb(16 18 24 / 0.06), rgb(255 255 255 / 0.08));
    --menu-line: light-dark(rgb(16 18 24 / 0.08), rgb(255 255 255 / 0.08));
    position: absolute;
    display: flex;
    flex-direction: column;
    width: 334px;
    overflow: hidden;
    border-radius: 16px;
    background: var(--menu-surface);
    box-shadow:
      0 0 0 0.5px light-dark(rgb(16 18 24 / 0.16), rgb(255 255 255 / 0.16)),
      inset 0 1px 0 light-dark(rgb(255 255 255 / 0.7), rgb(255 255 255 / 0.06)),
      0 18px 48px rgb(0 0 0 / 0.32);
    color: var(--text);
    animation: menu-in 140ms var(--ease-out);
  }

  .panel.tinted {
    --menu-surface: light-dark(
      color-mix(in srgb, var(--menu-tint) 6%, #f7f7f8),
      color-mix(in srgb, var(--menu-tint) 16%, #222427)
    );
  }

  .search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 50px;
    padding: 0 18px;
    color: var(--text-muted);
  }

  .search input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 17px;
    user-select: text;
  }

  .search input::placeholder {
    color: var(--text-muted);
  }

  .body {
    min-height: 0;
    padding: 0 6px 6px;
    overflow-y: auto;
  }

  .flyout {
    width: 334px;
  }

  .flyout .body {
    padding-top: 6px;
  }

  .body :global(.heading) {
    margin: 8px 10px 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }

  .body :global(.item) {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 37px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    text-align: left;
    cursor: default;
  }

  .body :global(.item:is(:hover, :focus-visible, .open)) {
    outline: none;
    background: var(--menu-hover);
  }

  .body :global(.label) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .body :global(.trail) {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 400;
  }

  .body :global(.icon) {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }

  .body :global(.icon img) {
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }

  .body :global(.divider) {
    height: 1px;
    margin: 6px 10px;
    background: var(--menu-line);
  }

  .body :global(.empty) {
    margin: 8px 10px 12px;
    color: var(--text-muted);
    font-size: 13px;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.985);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
