<script lang="ts">
  import { t } from '../../shared/i18n';

  // The gap between the page and DevTools, which main reports in window coordinates. Dragging it sets the
  // DevTools width; main keeps both views inside the page area.
  let { rect }: { rect: { x: number; y: number; width: number; height: number; value: number } } = $props();

  const send = window.yalqen.send;
  let dragging = $state(false);

  function down(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging = true;
  }

  function move(event: PointerEvent): void {
    if (dragging) send({ type: 'resize-devtools', x: event.clientX });
  }

  // Arrow keys move the divider: left gives DevTools more room, right gives the page more. Shift moves further.
  function key(event: KeyboardEvent): void {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    send({ type: 'resize-devtools', x: rect.x + rect.width / 2 + direction * (event.shiftKey ? 64 : 16) });
  }

  function up(event: PointerEvent): void {
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }
</script>

<!-- A focusable separator is the window splitter pattern: it reports DevTools' share and moves with the arrows. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="divider"
  class:dragging
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-valuenow={rect.value}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label={t('window.resizeDevTools')}
  style:left="{rect.x}px"
  style:top="{rect.y}px"
  style:width="{rect.width}px"
  style:height="{rect.height}px"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
></div>

<style>
  .divider {
    position: fixed;
    z-index: 5;
    cursor: col-resize;
  }

  .divider::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2px;
    height: 32px;
    border-radius: 1px;
    background: var(--text-muted);
    content: '';
    opacity: 0;
    transform: translate(-50%, -50%);
    transition: opacity var(--transition);
  }

  .divider:hover::after,
  .divider:focus-visible::after,
  .divider.dragging::after {
    opacity: 0.6;
  }
</style>
