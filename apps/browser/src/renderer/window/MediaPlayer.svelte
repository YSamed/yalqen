<script lang="ts">
  import type { MediaInfo, MediaSkip } from '../../shared/sidebar-widgets';
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  let { media }: { media: MediaInfo } = $props();

  const send = window.yalqen.send;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const DRAG_THRESHOLD = 4;

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

  // A press on the pill opens the tab; dragging along it scrubs, and the fill follows the pointer.
  let pill: HTMLElement | undefined = $state();
  let scrub = $state<{ startX: number; fraction: number; moved: boolean } | null>(null);
  let target = $state<{ seconds: number; since: number } | null>(null);
  $effect(() => {
    if (!target) return;
    const timer = window.setTimeout(() => (target = null), 2000);
    return () => window.clearTimeout(timer);
  });
  const shown = $derived(target && target.since >= media.updatedAt ? target.seconds : position);
  const scrubbed = $derived(scrub?.moved && media.duration !== null ? scrub.fraction * media.duration : null);
  const progress = $derived.by(() => {
    if (!media.duration) return 0;
    return (scrubbed ?? shown ?? 0) / media.duration;
  });

  function clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }

  function showTab(): void {
    send({ type: 'activate-tab', id: media.tabId });
  }

  function skip(direction: MediaSkip): void {
    send({ type: 'skip-media', id: media.tabId, direction });
  }

  function seek(seconds: number): void {
    if (seconds === 0 || position === null || media.duration === null) return;
    target = { seconds: Math.min(media.duration, Math.max(0, position + seconds)), since: Date.now() };
    send({ type: 'seek-media', id: media.tabId, seconds });
  }

  function fractionAt(event: PointerEvent): number {
    const rect = pill?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
  }

  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    scrub = { startX: event.clientX, fraction: fractionAt(event), moved: false };
  }

  function pointerMove(event: PointerEvent): void {
    if (!scrub) return;
    const moved = scrub.moved || Math.abs(event.clientX - scrub.startX) >= DRAG_THRESHOLD;
    scrub = { ...scrub, fraction: fractionAt(event), moved };
  }

  function pointerUp(event: PointerEvent): void {
    if (!scrub) return;
    const { moved } = scrub;
    scrub = null;
    if (!moved) showTab();
    else if (position !== null && media.duration !== null)
      seek(Math.round(fractionAt(event) * media.duration - position));
  }

  function seekByKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') seek(-5);
    else if (event.key === 'ArrowRight') seek(5);
    else if (event.key === 'Home' && position !== null) seek(-Math.round(position));
    else if (event.key === 'End' && position !== null && media.duration !== null)
      seek(Math.floor(media.duration - position));
    else if (event.key === ' ' || event.key === 'k') toggle();
    else if (event.key === 'Enter') showTab();
    else return;
    event.preventDefault();
  }

  function appear(node: Element) {
    return fly(node, { y: 6, duration: reducedMotion.matches ? 0 : 200, easing: cubicOut });
  }
</script>

<section class="player" aria-label={t('widgets.media')} in:appear>
  <IconButton
    size="lg"
    variant="surface"
    class="play"
    icon={playing ? 'pause' : 'play'}
    label={playing ? t('widgets.pause') : t('widgets.play')}
    onclick={toggle}
  />
  <div
    class="pill"
    class:scrubbing={scrubbed !== null}
    class:skippable={media.canPrevious || media.canNext}
    bind:this={pill}
  >
    {#if position !== null && media.duration !== null}
      <span class="fill" class:instant={scrubbed !== null} style:width="{progress * 100}%"></span>
      <div
        class="track"
        role="slider"
        tabindex="0"
        title={t('widgets.showTab', { title: media.title })}
        aria-label={media.title}
        aria-valuemin={0}
        aria-valuemax={Math.round(media.duration)}
        aria-valuenow={Math.round(shown ?? position)}
        aria-valuetext={t('widgets.elapsed', { elapsed: clock(shown ?? position), duration: clock(media.duration) })}
        onpointerdown={pointerDown}
        onpointermove={pointerMove}
        onpointerup={pointerUp}
        onpointercancel={() => (scrub = null)}
        onkeydown={seekByKey}
      >
        <span class="title">{media.title}</span>
        <span class="time">
          {scrubbed !== null ? `${clock(scrubbed)} / ${clock(media.duration)}` : clock(shown ?? position)}
        </span>
      </div>
    {:else}
      <!-- A live stream has no length to scrub. -->
      <button class="track" aria-label={t('widgets.showTab', { title: media.title })} onclick={showTab}>
        <span class="title">{media.title}</span>
      </button>
    {/if}
    {#if media.canPrevious || media.canNext}
      <span class="actions">
        {#if media.canPrevious}
          <IconButton
            size="sm"
            tone="muted"
            icon="skip-back"
            label={t('widgets.previous')}
            onclick={() => skip('previous')}
          />
        {/if}
        {#if media.canNext}
          <IconButton
            size="sm"
            tone="muted"
            icon="skip-forward"
            label={t('widgets.next')}
            onclick={() => skip('next')}
          />
        {/if}
      </span>
    {/if}
  </div>
</section>

<style>
  .player {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: var(--chrome-control-size);
    margin-top: auto;
    color: var(--text);
  }

  .pill {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  :global([data-material='glass']) .pill {
    box-shadow: var(--shadow), var(--rim);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in srgb, var(--text) 9%, transparent);
    pointer-events: none;
    transition: width 1s linear;
  }

  .fill.instant {
    transition: none;
  }

  .track {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 100%;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    color: inherit;
    font: inherit;
    font-size: var(--font-size);
    text-align: start;
    background: transparent;
    cursor: pointer;
    touch-action: none;
  }

  .track:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    flex: none;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    position: relative;
    display: flex;
    padding-right: 4px;
  }

  .pill:not(:hover, :focus-within) .actions,
  .pill.scrubbing .actions {
    display: none;
  }

  /* The track buttons take the time's place while the pointer is on the pill. */
  .pill.skippable:is(:hover, :focus-within):not(.scrubbing) .time {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
