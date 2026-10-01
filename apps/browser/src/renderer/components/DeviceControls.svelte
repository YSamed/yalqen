<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { DeviceFrame } from '../../shared/types';
  import Button from './ui/Button.svelte';

  const BREAKPOINTS = [320, 375, 768, 1024, 1280, 1440];
  const SCALE_FACTORS = [1, 2, 3];
  const KEY_STEP = 10;
  const KEY_STEP_LARGE = 100;

  let { device, bezel }: { device: DeviceFrame; bezel: number } = $props();

  const send = window.yalqen.send;

  interface Drag {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
    horizontal: boolean;
    vertical: boolean;
  }

  let drag: Drag | null = null;
  let pending: { width: number; height: number } | null = null;
  let frame = 0;

  function resize(width: number, height: number): void {
    send({ type: 'resize-device', width, height });
  }

  function startDrag(event: PointerEvent, horizontal: boolean, vertical: boolean): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      x: event.clientX,
      y: event.clientY,
      width: device.width,
      height: device.height,
      scale: device.scale,
      horizontal,
      vertical,
    };
  }

  // The frame stays centred, so each edge moves half as far as the size changes.
  function moveDrag(event: PointerEvent): void {
    if (!drag) return;
    pending = {
      width: drag.horizontal ? drag.width + (2 * (event.clientX - drag.x)) / drag.scale : drag.width,
      height: drag.vertical ? drag.height + (2 * (event.clientY - drag.y)) / drag.scale : drag.height,
    };
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (pending) resize(pending.width, pending.height);
      pending = null;
    });
  }

  function endDrag(): void {
    drag = null;
  }

  function onHandleKey(event: KeyboardEvent, horizontal: boolean, vertical: boolean): void {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const dx = horizontal ? ({ ArrowLeft: -step, ArrowRight: step } as Record<string, number>)[event.key] : undefined;
    const dy = vertical ? ({ ArrowUp: -step, ArrowDown: step } as Record<string, number>)[event.key] : undefined;
    if (dx === undefined && dy === undefined) return;
    event.preventDefault();
    resize(device.width + (dx ?? 0), device.height + (dy ?? 0));
  }
</script>

<div class="controls" style:top="{device.y - bezel - 26}px">
  <span class="size">
    {device.width}×{device.height}{device.scale < 1
      ? ` · ${t('deviceControls.scale', { percent: Math.round(device.scale * 100) })}`
      : ''}
  </span>
  <div class="group" role="group" aria-label={t('deviceControls.breakpoints')}>
    {#each BREAKPOINTS as width (width)}
      <Button
        size="sm"
        variant={device.width === width ? 'tonal' : 'ghost'}
        aria-pressed={device.width === width}
        title={t('deviceControls.pixelWidth', { width })}
        onclick={() => resize(width, device.height)}
      >
        {width}
      </Button>
    {/each}
  </div>
  <div class="group" role="group" aria-label={t('deviceControls.pixelRatio')}>
    {#each SCALE_FACTORS as value (value)}
      <Button
        size="sm"
        variant={device.deviceScaleFactor === value ? 'tonal' : 'ghost'}
        aria-pressed={device.deviceScaleFactor === value}
        onclick={() => send({ type: 'set-device-scale-factor', value })}
      >
        {value}x
      </Button>
    {/each}
  </div>
</div>

<div
  class="handle horizontal"
  style:left="{device.x + device.viewWidth + bezel}px"
  style:top="{device.y}px"
  style:height="{device.viewHeight}px"
  role="slider"
  tabindex="0"
  aria-label={t('deviceControls.width')}
  aria-orientation="horizontal"
  aria-valuenow={device.width}
  onpointerdown={(event) => startDrag(event, true, false)}
  onpointermove={moveDrag}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={(event) => onHandleKey(event, true, false)}
></div>
<div
  class="handle vertical"
  style:left="{device.x}px"
  style:top="{device.y + device.viewHeight + bezel}px"
  style:width="{device.viewWidth}px"
  role="slider"
  tabindex="0"
  aria-label={t('deviceControls.height')}
  aria-orientation="vertical"
  aria-valuenow={device.height}
  onpointerdown={(event) => startDrag(event, false, true)}
  onpointermove={moveDrag}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={(event) => onHandleKey(event, false, true)}
></div>
<div
  class="handle corner"
  style:left="{device.x + device.viewWidth + bezel}px"
  style:top="{device.y + device.viewHeight + bezel}px"
  aria-hidden="true"
  onpointerdown={(event) => startDrag(event, true, true)}
  onpointermove={moveDrag}
  onpointerup={endDrag}
  onpointercancel={endDrag}
></div>

<style>
  .controls {
    position: absolute;
    right: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 20px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .group {
    display: flex;
    gap: 2px;
  }

  .handle {
    position: absolute;
    display: grid;
    place-items: center;
    touch-action: none;
  }

  .handle::after {
    border-radius: 2px;
    background: var(--text-muted);
    content: '';
    opacity: 0.45;
  }

  .handle:hover::after,
  .handle:focus-visible::after {
    opacity: 0.9;
  }

  .handle:focus-visible {
    outline: none;
  }

  .horizontal {
    width: 14px;
    cursor: ew-resize;
  }

  .horizontal::after {
    width: 4px;
    height: 32px;
  }

  .vertical {
    height: 14px;
    cursor: ns-resize;
  }

  .vertical::after {
    width: 32px;
    height: 4px;
  }

  .corner {
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
  }

  .corner::after {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
</style>
