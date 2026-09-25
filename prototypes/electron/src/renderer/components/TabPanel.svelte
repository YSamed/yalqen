<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TabId, TabSnapshot } from '../../shared/types';
  import Icon from './Icon.svelte';

  let {
    tabs,
    activeTabId,
    totalMemoryMB,
    collapsed,
    width = $bindable(),
    minWidth,
    maxWidth,
    onToggle,
    header,
  }: {
    tabs: TabSnapshot[];
    activeTabId: TabId | null;
    totalMemoryMB: number | null;
    collapsed: boolean;
    width: number;
    minWidth: number;
    maxWidth: number;
    onToggle: () => void;
    header: Snippet;
  } = $props();

  let dragId: TabId | null = $state(null);
  let dropIndex: number | null = $state(null);
  let brokenIcons: Record<string, true> = $state({});

  const send = window.yalqen.send;

  function label(tab: TabSnapshot): string {
    const states = [
      tab.id === activeTabId ? 'aktif' : null,
      tab.live ? null : 'bellekten çıkarılmış',
      tab.frozen ? 'dondurulmuş' : null,
      tab.keepAlive ? 'canlı tutuluyor' : null,
    ].filter(Boolean);
    return states.length > 0 ? `${tab.title} (${states.join(', ')})` : tab.title;
  }

  function onDragOver(event: DragEvent, index: number): void {
    if (!dragId) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    dropIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    if (dragId && dropIndex !== null) {
      const from = tabs.findIndex((tab) => tab.id === dragId);
      const toIndex = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (toIndex !== from) send({ type: 'move-tab', id: dragId, toIndex });
    }
    dragId = null;
    dropIndex = null;
  }

  function startResize(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const move = (e: PointerEvent) => {
      width = Math.round(Math.min(maxWidth, Math.max(minWidth, startWidth + startX - e.clientX)));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
  }
</script>

<aside class="panel" class:collapsed aria-label="Sekmeler">
  {#if !collapsed}
    <div
      class="resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel genişliği"
      onpointerdown={startResize}
    ></div>
  {/if}

  {@render header()}

  <ol class="tabs" ondrop={onDrop} ondragover={(e) => dragId && e.preventDefault()}>
    {#each tabs as tab, index (tab.id)}
      <li
        class="tab"
        class:active={tab.id === activeTabId}
        class:discarded={!tab.live}
        class:drop-before={dropIndex === index}
        class:drop-after={dropIndex === index + 1 && index === tabs.length - 1}
        draggable="true"
        ondragstart={() => (dragId = tab.id)}
        ondragend={() => ((dragId = null), (dropIndex = null))}
        ondragover={(e) => onDragOver(e, index)}
      >
        <button
          class="select"
          title={collapsed ? label(tab) : tab.url}
          aria-label={label(tab)}
          aria-current={tab.id === activeTabId ? 'page' : undefined}
          onclick={() => send({ type: 'activate-tab', id: tab.id })}
          onauxclick={(e) => e.button === 1 && send({ type: 'close-tab', id: tab.id })}
        >
          <span class="favicon">
            {#if tab.faviconUrl && !brokenIcons[tab.faviconUrl]}
              <img
                src={tab.faviconUrl}
                alt=""
                width="16"
                height="16"
                onerror={() => (brokenIcons[tab.faviconUrl!] = true)}
              />
            {:else}
              <Icon name="globe" />
            {/if}
            {#if tab.keepAlive}<span class="badge pin"><Icon name="pin" size={10} /></span>{/if}
            {#if !tab.live}<span class="badge sleep"><Icon name="moon" size={10} /></span>{/if}
          </span>
          {#if !collapsed}
            <span class="title">{tab.title}</span>
          {/if}
        </button>

        {#if !collapsed}
          <span class="actions">
            <button
              class="action"
              class:on={tab.keepAlive}
              title={tab.keepAlive ? 'Canlı tutmayı kaldır' : 'Canlı tut'}
              aria-pressed={tab.keepAlive}
              onclick={() => send({ type: 'toggle-keep-alive', id: tab.id })}
            >
              <Icon name="pin" size={14} />
            </button>
            {#if tab.live && tab.id !== activeTabId}
              <button
                class="action"
                title="Bellekten çıkar"
                onclick={() => send({ type: 'discard-tab', id: tab.id })}
              >
                <Icon name="moon" size={14} />
              </button>
            {/if}
            <button
              class="action"
              title="Kapat"
              onclick={() => send({ type: 'close-tab', id: tab.id })}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        {/if}
      </li>
    {/each}
    <li class="tab new-tab">
      <button class="select" title="Yeni sekme (⌘T)" onclick={() => send({ type: 'new-tab' })}>
        <span class="favicon"><Icon name="plus" /></span>
        {#if !collapsed}<span class="title">Yeni sekme</span>{/if}
      </button>
    </li>
  </ol>

  <footer class="footer">
    <span class="memory" title="Uygulamanın toplam bellek kullanımı (working set)">
      {#if totalMemoryMB === null}—{:else}{totalMemoryMB}{/if}{#if !collapsed}&nbsp;MB{/if}
    </span>
    <button
      class="footer-button"
      title="Ayarlar (⌘,)"
      aria-label="Ayarlar"
      onclick={() => send({ type: 'open-settings' })}
    >
      <Icon name="settings" />
    </button>
    <button
      class="footer-button toggle"
      title={collapsed ? 'Paneli genişlet (⌘S)' : 'Paneli daralt (⌘S)'}
      aria-expanded={!collapsed}
      onclick={onToggle}
    >
      <Icon name="sidebar" />
    </button>
  </footer>
</aside>

<style>
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0 8px 8px;
  }

  .panel.collapsed {
    padding: 0 6px 8px;
  }

  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 6px;
    cursor: col-resize;
  }

  .tabs {
    flex: 1;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    height: 32px;
    margin-bottom: 2px;
    border-radius: var(--radius);
    transition: background var(--transition);
  }

  .tab:hover {
    background: var(--surface-hover);
  }

  .tab.active {
    background: var(--surface-active);
    box-shadow: var(--shadow);
  }

  :global([data-material='glass']) .tab.active {
    box-shadow: var(--shadow), var(--rim);
  }

  .tab.drop-before::before,
  .tab.drop-after::after {
    content: '';
    position: absolute;
    right: 4px;
    left: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .tab.drop-before::before {
    top: -2px;
  }

  .tab.drop-after::after {
    bottom: -2px;
  }

  .select {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
  }

  .collapsed .select {
    justify-content: center;
    padding: 0;
  }

  .favicon {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }

  .favicon img {
    width: 16px;
    height: 16px;
    border-radius: 3px;
  }

  .discarded .favicon img,
  .discarded .favicon > :global(svg) {
    opacity: 0.45;
    filter: grayscale(1);
  }

  .discarded .title {
    color: var(--text-muted);
  }

  .badge {
    position: absolute;
    display: grid;
    place-items: center;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--badge);
    color: var(--text);
  }

  .badge.sleep {
    right: -5px;
    bottom: -5px;
  }

  .badge.pin {
    top: -5px;
    right: -5px;
    color: var(--accent);
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: none;
    gap: 0;
    padding-right: 4px;
  }

  .tab:hover .actions,
  .tab:focus-within .actions,
  .tab.active .actions {
    display: flex;
  }

  .action {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
  }

  .action:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .action.on {
    color: var(--accent);
  }

  .footer {
    display: flex;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  .collapsed .footer {
    flex-direction: column;
    align-items: center;
  }

  .footer-button {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
  }

  .new-tab .select {
    color: var(--text-muted);
  }

  .new-tab:hover .select {
    color: var(--text);
  }

  .memory {
    flex: 1;
    align-self: center;
    padding: 0 8px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
  }

  .collapsed .memory {
    padding: 4px 0;
    text-align: center;
  }

  .collapsed .footer-button {
    justify-content: center;
    width: 32px;
    padding: 0;
  }

  .footer-button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
</style>
