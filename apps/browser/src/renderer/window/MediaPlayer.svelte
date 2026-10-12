<script lang="ts">
  import type { MediaInfo } from '../../shared/sidebar-widgets';
  import { t } from '../../shared/i18n';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  let { media }: { media: MediaInfo } = $props();

  const send = window.yalqen.send;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let broken = $state<Record<string, true>>({});
  const artwork = $derived(media.artwork && !broken[media.artwork] ? media.artwork : null);
  const favicon = $derived(media.faviconUrl && !broken[media.faviconUrl] ? media.faviconUrl : null);

  // A press shows its result right away; the page's own answer replaces it once it arrives.
  let pressed = $state<{ playing: boolean; since: number } | null>(null);
  const playing = $derived(pressed && pressed.since >= media.updatedAt ? pressed.playing : media.playing);
  $effect(() => {
    if (!pressed) return;
    // A page that never answers (it lost its media) falls back to what the browser last reported.
    const timer = window.setTimeout(() => (pressed = null), 2000);
    return () => window.clearTimeout(timer);
  });

  function toggle(): void {
    pressed = { playing: !playing, since: Date.now() };
    send({ type: 'toggle-media', id: media.tabId });
  }

  // The page reports its position only on changes, so the bar advances locally in between.
  let now = $state(Date.now());
  $effect(() => {
    if (!playing || media.duration === null) return;
    now = Date.now();
    const interval = window.setInterval(() => (now = Date.now()), 1000);
    return () => window.clearInterval(interval);
  });
  const position = $derived.by(() => {
    if (media.position === null || media.duration === null) return null;
    const elapsed = playing ? Math.max(0, now - media.updatedAt) / 1000 : 0;
    return Math.min(media.duration, media.position + elapsed);
  });

  // While the pointer is on the bar it previews where a press would land; dragging moves the fill.
  let hover = $state<number | null>(null);
  let dragging = $state(false);
  let target = $state<{ seconds: number; since: number } | null>(null);
  $effect(() => {
    if (!target) return;
    const timer = window.setTimeout(() => (target = null), 2000);
    return () => window.clearTimeout(timer);
  });
  const shown = $derived(target && target.since >= media.updatedAt ? target.seconds : position);
  const progress = $derived.by(() => {
    if (!media.duration) return 0;
    if (dragging && hover !== null) return hover;
    return shown === null ? 0 : shown / media.duration;
  });

  function clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }

  function seek(seconds: number): void {
    if (seconds === 0 || position === null || media.duration === null) return;
    target = { seconds: Math.min(media.duration, Math.max(0, position + seconds)), since: Date.now() };
    send({ type: 'seek-media', id: media.tabId, seconds });
  }

  function fractionAt(event: PointerEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
  }

  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || position === null || media.duration === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragging = true;
    hover = fractionAt(event);
  }

  function pointerMove(event: PointerEvent): void {
    hover = fractionAt(event);
  }

  function pointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const fraction = fractionAt(event);
    if (position !== null && media.duration !== null) seek(Math.round(fraction * media.duration - position));
  }

  function pointerLeave(): void {
    if (!dragging) hover = null;
  }

  function seekByKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') seek(-5);
    else if (event.key === 'ArrowRight') seek(5);
    else if (event.key === 'Home' && position !== null) seek(-Math.round(position));
    else if (event.key === 'End' && position !== null && media.duration !== null)
      seek(Math.floor(media.duration - position));
    else if (event.key === ' ' || event.key === 'k') toggle();
    else return;
    event.preventDefault();
  }

  function appear(node: Element) {
    return fly(node, { y: 6, duration: reducedMotion.matches ? 0 : 200, easing: cubicOut });
  }
</script>

<section class="player" aria-label={t('widgets.media')} in:appear>
  {#if artwork}
    {#key artwork}
      <span class="tint" style:background-image="url({JSON.stringify(artwork)})" aria-hidden="true"></span>
    {/key}
  {/if}
  <button
    class="info"
    aria-label={t('widgets.showTab', { title: media.title })}
    onclick={() => send({ type: 'activate-tab', id: media.tabId })}
  >
    <span class="cover">
      {#if artwork}
        <img src={artwork} alt="" draggable="false" onerror={() => (broken = { ...broken, [artwork]: true })} />
      {:else if favicon}
        <img
          class="favicon"
          src={favicon}
          alt=""
          width="16"
          height="16"
          draggable="false"
          onerror={() => (broken = { ...broken, [favicon]: true })}
        />
      {:else}
        <span class="letter" aria-hidden="true">{media.title.trim().charAt(0).toUpperCase() || '♪'}</span>
      {/if}
    </span>
    <span class="text">
      <span class="title" title={media.title}>{media.title}</span>
      <span class="artist">
        {#if playing && hover === null}<span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
        <!-- While the pointer is on the bar the artist line reads out the time it points at. -->
        {#if hover !== null && media.duration !== null}
          <span class="name time">{clock(hover * media.duration)} / {clock(media.duration)}</span>
        {:else}
          <span class="name">{media.artist}</span>
        {/if}
      </span>
    </span>
  </button>
  <button class="play" aria-label={playing ? t('widgets.pause') : t('widgets.play')} onclick={toggle}>
    {#if playing}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
        ><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" /><rect
          x="9.3"
          y="2.5"
          width="3.2"
          height="11"
          rx="1"
        /></svg
      >
    {:else}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
        ><path d="M5 2.9v10.2c0 .6.6.9 1.1.6l8-5.1a.7.7 0 0 0 0-1.2l-8-5.1C5.6 2 5 2.3 5 2.9z" /></svg
      >
    {/if}
  </button>

  {#if position !== null && media.duration !== null}
    <div
      class="track"
      class:active={hover !== null}
      role="slider"
      tabindex="0"
      aria-label={t('widgets.media')}
      aria-valuemin={0}
      aria-valuemax={Math.round(media.duration)}
      aria-valuenow={Math.round(shown ?? position)}
      aria-valuetext={t('widgets.elapsed', { elapsed: clock(shown ?? position), duration: clock(media.duration) })}
      onpointerdown={pointerDown}
      onpointermove={pointerMove}
      onpointerup={pointerUp}
      onpointercancel={() => ((dragging = false), (hover = null))}
      onpointerleave={pointerLeave}
      onkeydown={seekByKey}
    >
      <span class="rail"><span class="fill" class:instant={dragging} style:width="{progress * 100}%"></span></span>
    </div>
  {/if}
</section>

<style>
  .player {
    position: relative;
    isolation: isolate;
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin-top: auto;
    margin-bottom: 4px;
    padding: 7px 7px 10px;
    overflow: hidden;
    border-radius: 14px;
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  :global([data-material='glass']) .player {
    box-shadow: var(--shadow), var(--rim);
  }

  /* A soft wash of the cover's colours behind the row. */
  .tint {
    position: absolute;
    z-index: -1;
    inset: -30px;
    background-position: center;
    background-size: cover;
    filter: blur(30px) saturate(1.8);
    opacity: 0.22;
    pointer-events: none;
    animation: reveal 500ms var(--ease-out);
  }

  button {
    padding: 0;
    border: 0;
    font: inherit;
    color: inherit;
    background: transparent;
    cursor: pointer;
  }

  button:focus-visible,
  .track:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .info {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 9px;
    min-width: 0;
    border-radius: 9px;
    text-align: start;
  }

  .cover {
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    overflow: hidden;
    border-radius: 8px;
    background: var(--surface-strong);
    box-shadow:
      0 3px 10px rgb(0 0 0 / 22%),
      inset 0 0 0 0.5px rgb(255 255 255 / 12%);
    transition: transform 180ms var(--ease-out);
  }

  .info:hover .cover {
    transform: scale(1.05);
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover img.favicon {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  .letter {
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 600;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title,
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  .artist {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .bars {
    display: flex;
    flex: none;
    align-items: flex-end;
    gap: 1.5px;
    height: 8px;
  }

  .bars i {
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: var(--accent);
    transform-origin: bottom;
    animation: bar 900ms ease-in-out infinite alternate;
  }

  .bars i:nth-child(2) {
    animation-delay: -300ms;
    animation-duration: 700ms;
  }

  .bars i:nth-child(3) {
    animation-delay: -600ms;
    animation-duration: 1100ms;
  }

  .play {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--surface);
    background: var(--text);
    box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
    transition: transform 140ms var(--ease-out);
  }

  .play:hover {
    transform: scale(1.07);
  }

  .play:active {
    transform: scale(0.92);
  }

  /* Taller than the rail it draws, so the thin bar is easy to hit and drag. */
  .track {
    position: absolute;
    right: 12px;
    bottom: 0;
    left: 12px;
    display: flex;
    align-items: center;
    height: 12px;
    cursor: pointer;
    touch-action: none;
  }

  .rail {
    position: relative;
    flex: 1;
    height: 2px;
    overflow: hidden;
    border-radius: 1px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
    transition: height 120ms var(--ease-out);
  }

  .track.active .rail,
  .track:focus-visible .rail {
    height: 4px;
    border-radius: 2px;
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--accent);
    transition: width 1s linear;
  }

  .fill.instant {
    transition: none;
  }

  .time {
    flex: none;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  @keyframes bar {
    from {
      transform: scaleY(0.3);
    }
    to {
      transform: scaleY(1);
    }
  }

  @keyframes reveal {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bars i,
    .tint {
      animation: none;
    }

    .fill {
      transition: none;
    }
  }
</style>
