<script lang="ts">
  import type { DownloadsSummary, TabId, TabSnapshot } from '../../shared/types';
  import { moveSidebarWidget, type ClosedTabPreview, type SidebarWidgetId } from '../../shared/sidebar-widgets';
  import { getLocale, t } from '../../shared/i18n';
  import { cubicOut } from 'svelte/easing';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import Icon from '../ui/Icon.svelte';

  let {
    widgets,
    tabs,
    closedTabs,
    downloads,
  }: {
    widgets: SidebarWidgetId[];
    tabs: TabSnapshot[];
    closedTabs: ClosedTabPreview[];
    downloads: DownloadsSummary;
  } = $props();

  const FOCUS_MS = 25 * 60 * 1000;
  const RING = 2 * Math.PI * 9;

  const send = window.yalqen.send;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const names: Record<SidebarWidgetId, string> = {
    media: t('widgets.media'),
    clock: t('widgets.clock'),
    focus: t('widgets.focus'),
    'closed-tabs': t('widgets.closedTabs'),
    downloads: t('widgets.downloads'),
  };

  // The tab that played last keeps its card while paused, until it closes.
  let mediaId: TabId | null = $state(null);
  $effect(() => {
    const playing = tabs.find((tab) => tab.audible && !tab.muted) ?? tabs.find((tab) => tab.audible);
    if (playing) mediaId = playing.id;
    else if (mediaId !== null && !tabs.some((tab) => tab.id === mediaId)) mediaId = null;
  });
  const mediaTab = $derived(mediaId === null ? null : (tabs.find((tab) => tab.id === mediaId) ?? null));

  const shown = $derived(
    widgets.filter(
      (id) =>
        (id !== 'media' || mediaTab !== null) &&
        (id !== 'closed-tabs' || closedTabs.length > 0) &&
        (id !== 'downloads' || downloads.active > 0),
    ),
  );

  let now = $state(new Date());
  $effect(() => {
    if (!widgets.includes('clock')) return;
    let interval = 0;
    const tick = () => (now = new Date());
    tick();
    const timeout = window.setTimeout(
      () => {
        tick();
        interval = window.setInterval(tick, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  });
  const time = $derived(new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(now));
  const date = $derived(
    new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(now),
  );

  let focusEndsAt: number | null = $state(null);
  let focusLeft = $state(FOCUS_MS);
  let focusDone = $state(false);
  $effect(() => {
    if (focusEndsAt === null) return;
    const endsAt = focusEndsAt;
    const tick = () => {
      focusLeft = Math.max(0, endsAt - Date.now());
      if (focusLeft > 0) return;
      focusEndsAt = null;
      focusDone = true;
      try {
        new Notification(t('widgets.focusDone'), { body: t('widgets.focusDoneBody') });
      } catch {}
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  });
  const focusClock = $derived(
    `${Math.floor(Math.ceil(focusLeft / 1000) / 60)}:${String(Math.ceil(focusLeft / 1000) % 60).padStart(2, '0')}`,
  );

  function toggleFocus(): void {
    if (focusEndsAt !== null) {
      focusLeft = Math.max(0, focusEndsAt - Date.now());
      focusEndsAt = null;
      return;
    }
    if (focusDone || focusLeft === 0) {
      focusDone = false;
      focusLeft = FOCUS_MS;
    }
    focusEndsAt = Date.now() + focusLeft;
  }

  function resetFocus(): void {
    focusEndsAt = null;
    focusDone = false;
    focusLeft = FOCUS_MS;
  }

  function host(url: string): string {
    try {
      return new URL(url).host || url;
    } catch {
      return url;
    }
  }

  let dragId: SidebarWidgetId | null = $state(null);
  let dropIndex: number | null = $state(null);
  let brokenIcons: Record<string, true> = $state({});

  function onDragStart(event: DragEvent, id: SidebarWidgetId): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    dragId = id;
  }

  function onDragOver(event: DragEvent, id: SidebarWidgetId): void {
    if (dragId === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const index = widgets.indexOf(id);
    dropIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    if (dragId !== null && dropIndex !== null) {
      const next = moveSidebarWidget(widgets, dragId, dropIndex);
      if (next !== widgets) send({ type: 'set-sidebar-widgets', ids: next });
    }
    endDrag();
  }

  function endDrag(): void {
    dragId = null;
    dropIndex = null;
  }

  function reorder(node: Element, { from, to }: { from: DOMRect; to: DOMRect }) {
    return flip(node, { from, to }, { duration: reducedMotion.matches ? 0 : 220, easing: cubicOut });
  }

  function appear(node: Element) {
    return fade(node, { duration: reducedMotion.matches ? 0 : 160 });
  }
</script>

{#snippet favicon(url: string | null, label: string, size: number)}
  {#if url && !brokenIcons[url]}
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      draggable="false"
      onerror={() => (brokenIcons = { ...brokenIcons, [url]: true })}
    />
  {:else}
    <span class="letter" style:font-size="{Math.round(size * 0.7)}px" aria-hidden="true"
      >{label.trim().charAt(0).toUpperCase() || '·'}</span
    >
  {/if}
{/snippet}

{#snippet playPause(playing: boolean)}
  {#if playing}
    <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
      ><rect x="2" y="1.5" width="3" height="9" rx="0.8" /><rect x="7" y="1.5" width="3" height="9" rx="0.8" /></svg
    >
  {:else}
    <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
      ><path d="M3 1.8v8.4L10.5 6z" /></svg
    >
  {/if}
{/snippet}

{#if shown.length > 0}
  <section class="widgets" class:dragging={dragId !== null} aria-label={t('widgets.title')}>
    {#each shown as id (id)}
      {@const index = widgets.indexOf(id)}
      <article
        class="widget widget-{id}"
        class:lifted={dragId === id}
        class:drop-before={dropIndex === index && dragId !== null && dragId !== id}
        class:drop-after={dropIndex === index + 1 && index === widgets.length - 1 && dragId !== null && dragId !== id}
        aria-label={names[id]}
        title={t('widgets.reorder')}
        draggable="true"
        ondragstart={(event) => onDragStart(event, id)}
        ondragover={(event) => onDragOver(event, id)}
        ondrop={onDrop}
        ondragend={endDrag}
        animate:reorder
        in:appear
      >
        {#if id === 'media' && mediaTab}
          <button
            class="main"
            aria-label={t('widgets.showTab', { title: mediaTab.title })}
            onclick={() => send({ type: 'activate-tab', id: mediaTab.id })}
          >
            <span class="lead artwork">{@render favicon(mediaTab.faviconUrl, mediaTab.title, 14)}</span>
            <span class="text">
              <span class="title">{mediaTab.title}</span>
              <small>{host(mediaTab.url)}</small>
            </span>
          </button>
          {#if mediaTab.audible}
            <span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>
          {/if}
          <button
            class="round primary"
            aria-label={mediaTab.audible ? t('widgets.pause') : t('widgets.play')}
            onclick={() => send({ type: 'toggle-media', id: mediaTab.id })}
          >
            {@render playPause(mediaTab.audible)}
          </button>
        {:else if id === 'clock'}
          <span class="time clock-time">{time}</span>
          <small class="date">{date}</small>
        {:else if id === 'focus'}
          <svg class="lead ring" class:done={focusDone} width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle class="track" cx="11" cy="11" r="9" />
            <circle
              class="value"
              cx="11"
              cy="11"
              r="9"
              stroke-dasharray={RING}
              stroke-dashoffset={RING * (focusLeft / FOCUS_MS)}
            />
          </svg>
          <span class="text">
            <span
              class="time"
              role="timer"
              aria-label={t('widgets.focusRemaining', { minutes: Math.ceil(focusLeft / 60_000) })}>{focusClock}</span
            >
            <small>{focusDone ? t('widgets.focusDone') : t('widgets.focusLabel')}</small>
          </span>
          {#if focusLeft < FOCUS_MS || focusDone}
            <button class="round" aria-label={t('widgets.focusReset')} onclick={resetFocus}>
              <Icon name="reload" size={11} />
            </button>
          {/if}
          <button
            class="round primary"
            aria-label={focusEndsAt !== null
              ? t('widgets.focusPause')
              : focusLeft < FOCUS_MS && !focusDone
                ? t('widgets.focusResume')
                : t('widgets.focusStart')}
            onclick={toggleFocus}
          >
            {@render playPause(focusEndsAt !== null)}
          </button>
        {:else if id === 'closed-tabs'}
          <span class="lead muted"><Icon name="history" size={14} /></span>
          <span class="closed">
            {#each closedTabs as tab (tab.id)}
              <button
                class="round"
                aria-label={t('widgets.reopen', { title: tab.title || host(tab.url) })}
                title={tab.title || host(tab.url)}
                onclick={() => send({ type: 'reopen-closed-tab', id: tab.id })}
              >
                {@render favicon(tab.faviconUrl, tab.title || host(tab.url), 12)}
              </button>
            {/each}
          </span>
        {:else if id === 'downloads'}
          <button class="main" onclick={() => send({ type: 'open-downloads' })}>
            <span class="lead muted"><Icon name="download" size={14} /></span>
            <span class="text">
              <span class="title"
                >{downloads.active > 1 ? t('widgets.downloading', { count: downloads.active }) : names.downloads}</span
              >
            </span>
            {#if downloads.progress !== null}
              <small>{Math.round(downloads.progress * 100)}%</small>
            {/if}
            <span class="visually-hidden">{t('widgets.openDownloads')}</span>
          </button>
          <span class="bar" class:indeterminate={downloads.progress === null} aria-hidden="true">
            <span style:width="{downloads.progress === null ? 30 : Math.max(2, downloads.progress * 100)}%"></span>
          </span>
        {/if}
      </article>
    {/each}
  </section>
{/if}

<style>
  .widgets {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 1px;
    margin-top: auto;
    margin-bottom: 2px;
    padding: 3px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  :global([data-material='glass']) .widgets {
    box-shadow: var(--shadow), var(--rim);
  }

  .widget {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 36px;
    padding: 0 4px 0 6px;
    border-radius: 11px;
    color: var(--text);
    font-size: 12px;
    cursor: grab;
    transition:
      background var(--transition),
      opacity 160ms ease-out;
  }

  .widgets:not(.dragging) .widget:hover {
    background: var(--surface-hover);
  }

  .widget:active {
    cursor: grabbing;
  }

  .widget.lifted {
    opacity: 0.4;
  }

  .widget.drop-before::before,
  .widget.drop-after::after {
    position: absolute;
    right: 8px;
    left: 8px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    content: '';
  }

  .widget.drop-before::before {
    top: -1.5px;
  }

  .widget.drop-after::after {
    bottom: -1.5px;
  }

  button {
    font: inherit;
    color: inherit;
  }

  small {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 36px;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: start;
  }

  .lead {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
  }

  .muted {
    color: var(--text-muted);
  }

  .artwork {
    border-radius: 6px;
    background: var(--surface-strong);
    box-shadow: var(--shadow);
  }

  .artwork img,
  .closed img {
    border-radius: 3px;
  }

  .letter {
    color: var(--text-muted);
    font-weight: 600;
    line-height: 1;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }

  .title {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .round {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    transition:
      background var(--transition),
      color var(--transition);
  }

  .round:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .round.primary {
    background: var(--accent);
    color: rgb(26 15 4);
  }

  .bars {
    display: flex;
    flex: none;
    align-items: flex-end;
    gap: 1.5px;
    height: 10px;
  }

  .bars i {
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: var(--accent);
    transform-origin: bottom;
    animation: bar 900ms ease-in-out infinite;
  }

  .bars i:nth-child(2) {
    animation-delay: -300ms;
  }

  .bars i:nth-child(3) {
    animation-delay: -600ms;
  }

  @keyframes bar {
    0%,
    100% {
      transform: scaleY(0.35);
    }
    50% {
      transform: scaleY(1);
    }
  }

  .time {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }

  .clock-time {
    padding-left: 2px;
    font-size: 13px;
  }

  .date {
    flex: 1;
    padding-right: 4px;
    text-align: end;
  }

  .ring {
    transform: rotate(-90deg);
  }

  .ring circle {
    fill: none;
    stroke-width: 2.5;
  }

  .ring .track {
    stroke: var(--surface-hover);
  }

  .ring .value {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
  }

  .ring.done .value {
    stroke: var(--text-muted);
  }

  .closed {
    display: flex;
    flex: 1;
    gap: 1px;
    min-width: 0;
  }

  .widget-downloads {
    overflow: hidden;
  }

  .bar {
    position: absolute;
    right: 10px;
    bottom: 4px;
    left: 36px;
    height: 2px;
    overflow: hidden;
    border-radius: 1px;
    background: var(--surface-hover);
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 300ms var(--ease-out);
  }

  .bar.indeterminate span {
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .bars i,
    .bar.indeterminate span {
      animation: none;
    }
    .ring .value {
      transition: none;
    }
  }
</style>
