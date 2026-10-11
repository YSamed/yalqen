<script lang="ts">
  import type { MediaInfo } from '../../shared/sidebar-widgets';
  import { t } from '../../shared/i18n';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  let { media }: { media: MediaInfo } = $props();

  const SKIP_SECONDS = 10;
  const send = window.yalqen.send;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let broken = $state<Record<string, true>>({});
  const artwork = $derived(media.artwork && !broken[media.artwork] ? media.artwork : null);
  const favicon = $derived(media.faviconUrl && !broken[media.faviconUrl] ? media.faviconUrl : null);

  // The page reports its position only on changes, so the bar advances locally in between.
  let now = $state(Date.now());
  $effect(() => {
    if (!media.playing || media.duration === null) return;
    now = Date.now();
    const interval = window.setInterval(() => (now = Date.now()), 1000);
    return () => window.clearInterval(interval);
  });
  const position = $derived.by(() => {
    if (media.position === null || media.duration === null) return null;
    const elapsed = media.playing ? Math.max(0, now - media.updatedAt) / 1000 : 0;
    return Math.min(media.duration, media.position + elapsed);
  });
  const progress = $derived(position === null || !media.duration ? 0 : position / media.duration);

  function clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }

  function seek(seconds: number): void {
    if (seconds !== 0) send({ type: 'seek-media', id: media.tabId, seconds });
  }

  function seekTo(event: MouseEvent): void {
    if (position === null || media.duration === null) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seek(Math.round(fraction * media.duration - position));
  }

  function seekByKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') seek(-5);
    else if (event.key === 'ArrowRight') seek(5);
    else return;
    event.preventDefault();
  }

  function appear(node: Element) {
    return fly(node, { y: 8, duration: reducedMotion.matches ? 0 : 220, easing: cubicOut });
  }
</script>

{#snippet skipIcon(forward: boolean)}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <g transform={forward ? 'translate(20 0) scale(-1 1)' : undefined}>
      <path
        d="M10 4.5a6 6 0 1 1-6 6"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        transform="rotate(-50 10 10.5)"
      />
      <path d="M11.4 2.6 9 4.6l2.4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </g>
    <text x="10" y="13.1" text-anchor="middle" fill="currentColor" font-size="6.4" font-weight="700">10</text>
  </svg>
{/snippet}

<section class="player" class:art={artwork !== null} aria-label={t('widgets.media')} in:appear>
  {#if artwork}
    {#key artwork}
      <div class="backdrop" style:background-image="url({JSON.stringify(artwork)})" aria-hidden="true"></div>
    {/key}
  {/if}
  <div class="shade" aria-hidden="true"></div>

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
          width="20"
          height="20"
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
        <span class="bars" class:still={!media.playing} aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="name">{media.artist}</span>
      </span>
    </span>
  </button>

  {#if position !== null && media.duration !== null}
    <div
      class="track"
      role="slider"
      tabindex="0"
      aria-label={t('widgets.media')}
      aria-valuemin={0}
      aria-valuemax={Math.round(media.duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={t('widgets.elapsed', { elapsed: clock(position), duration: clock(media.duration) })}
      onclick={seekTo}
      onkeydown={seekByKey}
    >
      <span class="rail"><span class="fill" style:width="{progress * 100}%"></span></span>
    </div>
    <div class="times" aria-hidden="true">
      <span>{clock(position)}</span>
      <span>-{clock(media.duration - position)}</span>
    </div>
  {/if}

  <div class="controls">
    <button class="skip" aria-label={t('widgets.back')} onclick={() => seek(-SKIP_SECONDS)}>
      {@render skipIcon(false)}
    </button>
    <button
      class="play"
      aria-label={media.playing ? t('widgets.pause') : t('widgets.play')}
      onclick={() => send({ type: 'toggle-media', id: media.tabId })}
    >
      {#if media.playing}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
          ><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" /><rect
            x="9.3"
            y="2.5"
            width="3.2"
            height="11"
            rx="1"
          /></svg
        >
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
          ><path d="M5 2.9v10.2c0 .6.6.9 1.1.6l8-5.1a.7.7 0 0 0 0-1.2l-8-5.1C5.6 2 5 2.3 5 2.9z" /></svg
        >
      {/if}
    </button>
    <button class="skip" aria-label={t('widgets.forward')} onclick={() => seek(SKIP_SECONDS)}>
      {@render skipIcon(true)}
    </button>
  </div>
</section>

<style>
  .player {
    position: relative;
    isolation: isolate;
    display: flex;
    flex: none;
    flex-direction: column;
    margin-top: auto;
    margin-bottom: 4px;
    padding: 10px 10px 8px;
    overflow: hidden;
    border-radius: 16px;
    color: #fff;
    background:
      radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--accent) 62%, #000) 0%, transparent 70%),
      linear-gradient(160deg, #2a211b, #121212);
    box-shadow:
      0 10px 28px rgb(0 0 0 / 22%),
      inset 0 0 0 1px rgb(255 255 255 / 8%);
  }

  .backdrop {
    position: absolute;
    z-index: -2;
    inset: -24px;
    background-position: center;
    background-size: cover;
    filter: blur(26px) saturate(1.7);
    animation: reveal 400ms var(--ease-out);
  }

  .shade {
    position: absolute;
    z-index: -1;
    inset: 0;
    background: linear-gradient(180deg, rgb(0 0 0 / 12%) 0%, rgb(0 0 0 / 48%) 100%);
    pointer-events: none;
  }

  .player:not(.art) .shade {
    background: linear-gradient(180deg, transparent 40%, rgb(0 0 0 / 25%) 100%);
  }

  button {
    font: inherit;
    color: inherit;
    border: 0;
    background: transparent;
  }

  button:focus-visible,
  .track:focus-visible {
    outline: 2px solid rgb(255 255 255 / 80%);
    outline-offset: 2px;
  }

  .info {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    margin: -2px;
    padding: 2px;
    border-radius: 12px;
    text-align: start;
    cursor: pointer;
  }

  .cover {
    display: grid;
    flex: none;
    place-items: center;
    width: 42px;
    height: 42px;
    overflow: hidden;
    border-radius: 10px;
    background: rgb(255 255 255 / 14%);
    box-shadow:
      0 6px 16px rgb(0 0 0 / 35%),
      inset 0 0 0 0.5px rgb(255 255 255 / 18%);
    transition: transform 180ms var(--ease-out);
  }

  .info:hover .cover {
    transform: scale(1.04);
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover img.favicon {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }

  .letter {
    font-size: 18px;
    font-weight: 600;
    opacity: 0.85;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    display: -webkit-box;
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-shadow: 0 1px 2px rgb(0 0 0 / 25%);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .artist {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: rgb(255 255 255 / 68%);
    font-size: 11px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bars {
    display: flex;
    flex: none;
    align-items: flex-end;
    gap: 1.5px;
    height: 9px;
  }

  .bars i {
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: rgb(255 255 255 / 85%);
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

  .bars.still i {
    animation: none;
    opacity: 0.5;
    transform: scaleY(0.3);
  }

  .track {
    display: flex;
    align-items: center;
    height: 14px;
    margin-top: 8px;
    cursor: pointer;
  }

  .rail {
    position: relative;
    flex: 1;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: rgb(255 255 255 / 22%);
    transition: height 120ms var(--ease-out);
  }

  .track:hover .rail {
    height: 6px;
    border-radius: 3px;
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: #fff;
    transition: width 1s linear;
  }

  .times {
    display: flex;
    justify-content: space-between;
    margin-top: -1px;
    color: rgb(255 255 255 / 62%);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 6px;
  }

  .skip {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    color: rgb(255 255 255 / 86%);
    cursor: pointer;
    transition:
      background var(--transition),
      transform 120ms var(--ease-out);
  }

  .skip:hover {
    background: rgb(255 255 255 / 14%);
    color: #fff;
  }

  .play {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 50%;
    color: #141414;
    background: #fff;
    box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
    cursor: pointer;
    transition: transform 160ms var(--ease-out);
  }

  .play:hover {
    transform: scale(1.06);
  }

  .play:active,
  .skip:active {
    transform: scale(0.92);
  }

  @keyframes bar {
    from {
      transform: scaleY(0.25);
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
    .backdrop {
      animation: none;
    }

    .fill {
      transition: none;
    }
  }
</style>
