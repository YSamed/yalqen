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
  const RING = 2 * Math.PI * 20;

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
    new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(now),
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

  function hide(id: SidebarWidgetId): void {
    send({ type: 'set-sidebar-widgets', ids: widgets.filter((item) => item !== id) });
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
    <span class="letter" style:font-size="{Math.round(size * 0.6)}px" aria-hidden="true"
      >{label.trim().charAt(0).toUpperCase() || '·'}</span
    >
  {/if}
{/snippet}

{#snippet playPause(playing: boolean)}
  {#if playing}
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
      ><rect x="2" y="1.5" width="3" height="9" rx="0.8" /><rect x="7" y="1.5" width="3" height="9" rx="0.8" /></svg
    >
  {:else}
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
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
        <button class="hide" aria-label={t('widgets.hide', { name: names[id] })} onclick={() => hide(id)}>
          <Icon name="close" size={10} />
        </button>

        {#if id === 'media' && mediaTab}
          <button
            class="media-info"
            aria-label={t('widgets.showTab', { title: mediaTab.title })}
            onclick={() => send({ type: 'activate-tab', id: mediaTab.id })}
          >
            <span class="artwork">{@render favicon(mediaTab.faviconUrl, mediaTab.title, 22)}</span>
            <span class="text">
              <strong>{mediaTab.title}</strong>
              <small>{host(mediaTab.url)}</small>
            </span>
          </button>
          <span class="controls">
            <span class="bars" class:playing={mediaTab.audible} aria-hidden="true"><i></i><i></i><i></i></span>
            <button
              class="round"
              aria-label={mediaTab.muted ? t('tabPanel.unmute') : t('tabPanel.mute')}
              onclick={() => send({ type: 'toggle-mute', id: mediaTab.id })}
            >
              <Icon name={mediaTab.muted ? 'muted' : 'sound'} size={13} />
            </button>
            <button
              class="round primary"
              aria-label={mediaTab.audible ? t('widgets.pause') : t('widgets.play')}
              onclick={() => send({ type: 'toggle-media', id: mediaTab.id })}
            >
              {@render playPause(mediaTab.audible)}
            </button>
          </span>
        {:else if id === 'clock'}
          <span class="clock">
            <span class="time">{time}</span>
            <small>{date}</small>
          </span>
        {:else if id === 'focus'}
          <span class="focus" class:done={focusDone}>
            <span class="dial">
              <svg class="ring" width="60" height="60" viewBox="0 0 46 46" aria-hidden="true">
                <circle class="track" cx="23" cy="23" r="20" />
                <circle
                  class="value"
                  cx="23"
                  cy="23"
                  r="20"
                  stroke-dasharray={RING}
                  stroke-dashoffset={RING * (focusLeft / FOCUS_MS)}
                />
              </svg>
              <span
                class="time"
                role="timer"
                aria-label={t('widgets.focusRemaining', { minutes: Math.ceil(focusLeft / 60_000) })}>{focusClock}</span
              >
            </span>
            <span class="focus-side">
              <small>{focusDone ? t('widgets.focusDone') : t('widgets.focusLabel')}</small>
              <span class="focus-actions">
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
                {#if focusLeft < FOCUS_MS || focusDone}
                  <button class="round" aria-label={t('widgets.focusReset')} onclick={resetFocus}>
                    <Icon name="reload" size={12} />
                  </button>
                {/if}
              </span>
            </span>
          </span>
        {:else if id === 'closed-tabs'}
          <span class="heading">{t('widgets.closedTabs')}</span>
          <ul class="closed">
            {#each closedTabs as tab (tab.id)}
              <li>
                <button
                  aria-label={t('widgets.reopen', { title: tab.title || host(tab.url) })}
                  onclick={() => send({ type: 'reopen-closed-tab', id: tab.id })}
                >
                  <span class="icon">{@render favicon(tab.faviconUrl, tab.title || host(tab.url), 14)}</span>
                  <span class="label">{tab.title || host(tab.url)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if id === 'downloads'}
          <button class="downloads" onclick={() => send({ type: 'open-downloads' })}>
            <span class="row">
              <Icon name="download" size={14} />
              <span class="label">{t('widgets.downloading', { count: downloads.active })}</span>
              {#if downloads.progress !== null}
                <small>{Math.round(downloads.progress * 100)}%</small>
              {/if}
            </span>
            <span class="bar" class:indeterminate={downloads.progress === null}>
              <span style:width="{downloads.progress === null ? 30 : Math.max(2, downloads.progress * 100)}%"></span>
            </span>
            <span class="visually-hidden">{t('widgets.openDownloads')}</span>
          </button>
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
    gap: 8px;
    margin-top: auto;
    padding-top: 10px;
  }

  .widget {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    cursor: grab;
    transition:
      opacity 160ms ease-out,
      transform 220ms var(--ease-out),
      box-shadow var(--transition);
  }

  :global([data-material='glass']) .widget {
    box-shadow: var(--shadow), var(--rim);
  }

  .widget:active {
    cursor: grabbing;
  }

  .widget.lifted {
    opacity: 0.45;
    transform: scale(0.97);
  }

  .widget.drop-before::before,
  .widget.drop-after::after {
    position: absolute;
    right: 12px;
    left: 12px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 70%, transparent);
    content: '';
  }

  .widget.drop-before::before {
    top: -6px;
  }

  .widget.drop-after::after {
    bottom: -6px;
  }

  .hide {
    position: absolute;
    z-index: 1;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--surface-strong);
    box-shadow: var(--shadow);
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--transition);
  }

  .widgets:not(.dragging) .widget:hover .hide,
  .hide:focus-visible {
    opacity: 1;
  }

  button {
    font: inherit;
    color: inherit;
  }

  small {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .text strong,
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text strong {
    font-size: 12px;
    font-weight: 600;
  }

  .round {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--surface-hover);
    color: var(--text);
    transition:
      background var(--transition),
      transform var(--transition);
  }

  .round:active {
    transform: scale(0.94);
  }

  .round.primary {
    background: var(--accent);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.3);
    color: rgb(26 15 4);
  }

  .widget-media {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }

  .media-info {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: start;
  }

  .artwork {
    display: grid;
    flex: none;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--surface-strong);
    box-shadow:
      0 6px 16px rgb(0 0 0 / 0.18),
      inset 0 0 0 0.5px rgb(255 255 255 / 0.15);
  }

  .artwork img,
  .icon img {
    border-radius: 4px;
  }

  .letter {
    color: var(--text-muted);
    font-weight: 600;
    line-height: 1;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .focus-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .bars {
    display: flex;
    flex: 1;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
    padding-left: 2px;
  }

  .bars i {
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: var(--accent);
    transform: scaleY(0.3);
    transform-origin: bottom;
  }

  .bars.playing i {
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

  .clock {
    display: flex;
    flex-direction: column;
  }

  .clock .time {
    font-size: 28px;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  .focus {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .dial {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
  }

  .dial .time {
    position: absolute;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  .focus-side {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .ring {
    transform: rotate(-90deg);
  }

  .ring circle {
    fill: none;
    stroke-width: 3.5;
  }

  .ring .track {
    stroke: var(--surface-hover);
  }

  .ring .value {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
  }

  .focus.done .ring .value {
    stroke: var(--text);
  }

  .heading {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .closed {
    display: flex;
    flex-direction: column;
    margin: -2px -6px -6px;
    padding: 0;
    list-style: none;
  }

  .closed button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-size: 12px;
    text-align: start;
    transition: background var(--transition);
  }

  .closed button:hover {
    background: var(--surface-hover);
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
  }

  .downloads {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: start;
  }

  .downloads .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .downloads .label {
    flex: 1;
  }

  .bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-hover);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
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
    .bars.playing i,
    .bar.indeterminate span {
      animation: none;
    }
    .ring .value {
      transition: none;
    }
  }
</style>
