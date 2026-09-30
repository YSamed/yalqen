<script lang="ts">
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import Icon from './Icon.svelte';

  const EXIT_MS = 180;

  let {
    version,
    oninstall,
    onnotes,
    ondismiss,
  }: {
    version: string;
    oninstall: () => void;
    onnotes: () => void;
    ondismiss: () => void;
  } = $props();

  let leaving = $state(false);

  function dismiss(): void {
    if (leaving) return;
    leaving = true;
    setTimeout(ondismiss, EXIT_MS);
  }
</script>

<div class="banner" class:leaving role="status">
  <span class="badge stagger" aria-hidden="true"><Icon name="update" size={14} /></span>
  <span class="message stagger">
    <strong>Yalqen {version} hazır</strong>
    <span class="detail">Yeniden başlatınca yüklenir, açık sekmeler geri gelir.</span>
  </span>
  <span class="stagger"><Button variant="ghost" size="sm" onclick={onnotes}>Yenilikler</Button></span>
  <span class="stagger"><Button variant="primary" size="sm" onclick={oninstall}>Yeniden başlat</Button></span>
  <span class="stagger">
    <IconButton icon="close" size="sm" tone="muted" label="Sonra" title="Sonra hatırlat" onclick={dismiss} />
  </span>
</div>

<style>
  .banner {
    position: relative;
    display: flex;
    align-items: center;
    align-self: start;
    gap: 8px;
    width: 100%;
    height: 40px;
    padding: 0 8px;
    overflow: hidden;
    border-radius: 12px;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 45%), var(--surface);
    box-shadow: var(--shadow), var(--well-rim);
    color: var(--text);
    font-size: var(--font-size);
    animation: enter 280ms var(--ease-out);
    transition:
      opacity 180ms var(--ease-out),
      transform 180ms var(--ease-out);
  }

  .banner.leaving {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
    pointer-events: none;
  }

  .banner::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      105deg,
      transparent 35%,
      color-mix(in srgb, var(--accent) 16%, transparent) 50%,
      transparent 65%
    );
    transform: translateX(-100%);
    pointer-events: none;
    animation: sheen 900ms var(--ease-in-out) 450ms both;
  }

  .stagger {
    display: flex;
    flex: none;
    align-items: center;
    animation: rise 240ms var(--ease-out) backwards;
  }

  .stagger:nth-child(1) {
    animation-name: pop;
    animation-delay: 60ms;
  }
  .stagger:nth-child(2) {
    animation-delay: 110ms;
  }
  .stagger:nth-child(3) {
    animation-delay: 160ms;
  }
  .stagger:nth-child(4) {
    animation-delay: 200ms;
  }
  .stagger:nth-child(5) {
    animation-delay: 240ms;
  }

  .badge {
    position: relative;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }

  .badge::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: 0 0 0 1.5px var(--accent);
    opacity: 0;
    pointer-events: none;
    animation: ripple 1.4s var(--ease-out) 500ms 3;
  }

  .badge :global(svg) {
    animation: nudge 1.4s var(--ease-in-out) 500ms 3;
  }

  .message {
    flex: 1;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  strong {
    flex: none;
    font-weight: 600;
  }

  .detail {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
  }

  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.6) rotate(-90deg);
    }
  }

  @keyframes sheen {
    to {
      transform: translateX(100%);
    }
  }

  @keyframes ripple {
    0% {
      opacity: 0.6;
      transform: scale(1);
    }
    70%,
    100% {
      opacity: 0;
      transform: scale(1.7);
    }
  }

  @keyframes nudge {
    0%,
    60%,
    100% {
      transform: translateY(0);
    }
    20% {
      transform: translateY(-2.5px);
    }
    40% {
      transform: translateY(0.5px);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .banner,
    .stagger {
      animation: fade 200ms ease;
      animation-delay: 0ms;
    }

    .banner.leaving {
      transform: none;
    }

    .banner::after,
    .badge::before,
    .badge :global(svg) {
      animation: none;
    }

    .banner::after {
      display: none;
    }
  }
</style>
