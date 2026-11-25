<script lang="ts">
  let { loading }: { loading: boolean } = $props();

  let progress = $state(0);
  let finishing = $state(false);
  let started = false;

  // The page reports only loading or not, so the bar creeps toward 90% and completes when loading ends.
  $effect(() => {
    if (loading) {
      started = true;
      finishing = false;
      progress = 0.12;
      const timer = setInterval(() => (progress += (0.9 - progress) * 0.16), 450);
      return () => clearInterval(timer);
    }
    if (!started) return;
    started = false;
    progress = 1;
    finishing = true;
    const timer = setTimeout(() => {
      finishing = false;
      progress = 0;
    }, 900);
    return () => clearTimeout(timer);
  });
</script>

<span
  class="load-progress"
  class:active={loading || finishing}
  class:finishing
  style:--progress={progress}
  aria-hidden="true"
>
  <span class="fill"></span>
</span>

<style>
  .load-progress {
    --tint: var(--frame-primary, var(--accent));
    --fade: 48px;
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 8px;
    container-type: inline-size;
    opacity: 0;
    pointer-events: none;
  }

  .load-progress.active {
    opacity: 1;
    transition: opacity 120ms ease-out;
  }

  .load-progress.finishing {
    opacity: 0;
    transition: opacity 380ms ease-out 420ms;
  }

  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -100cqw;
    width: calc(100cqw + var(--fade));
    background: linear-gradient(to top, rgb(from var(--tint) r g b / 0.2), rgb(from var(--tint) r g b / 0.06) 75%);
    mask-image: linear-gradient(to right, #000 calc(100% - var(--fade)), transparent);
    transform: translateX(calc(var(--progress) * 100cqw));
  }

  .active .fill {
    transition: transform 450ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .finishing .fill {
    transition-duration: 380ms;
  }

  .fill::after {
    position: absolute;
    right: var(--fade);
    bottom: 0;
    left: 0;
    height: 1.5px;
    background: linear-gradient(
      to right,
      rgb(from var(--tint) r g b / 0.5),
      var(--tint) calc(100% - 40px),
      color-mix(in srgb, var(--tint) 40%, #fff)
    );
    box-shadow: 0 0 6px rgb(from var(--tint) r g b / 0.7);
    content: '';
  }

  @media (prefers-reduced-motion: reduce) {
    .load-progress.active .fill,
    .load-progress.active,
    .load-progress.finishing {
      transition: none;
    }
  }
</style>
