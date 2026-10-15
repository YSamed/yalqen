<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../shared/i18n';

  type Stage = 'sealed' | 'opening' | 'reading';

  const api = window.yalqenWelcome;
  let stage = $state<Stage>('sealed');
  let seal = $state<HTMLButtonElement>();
  let close = $state<HTMLButtonElement>();

  function breakSeal(): void {
    if (stage !== 'sealed') return;
    stage = 'opening';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(
      async () => {
        stage = 'reading';
        await tick();
        close?.focus();
      },
      reduced ? 0 : 1650,
    );
  }

  function finish(): void {
    api.send({ type: 'finish' });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
  }

  onMount(async () => {
    await tick();
    seal?.focus();
  });
</script>

<svelte:head><title>{t('letter.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} />

{#snippet grain()}
  <svg class="grain" aria-hidden="true"><rect width="100%" height="100%" filter="url(#paper-grain)" /></svg>
{/snippet}

<svg class="defs" aria-hidden="true">
  <filter id="paper-grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
    <feColorMatrix type="saturate" values="0" />
    <feComponentTransfer><feFuncA type="table" tableValues="0 0.16" /></feComponentTransfer>
  </filter>
</svg>

<div class="scrim" class:opening={stage !== 'sealed'} class:reading={stage === 'reading'}>
  <div class="stage">
    <div class="scene">
      <div class="envelope">
        <div class="back">
          <div class="liner"></div>
          {@render grain()}
        </div>

        <div class="letter" role="document" aria-label={t('letter.pageTitle')}>
          <p class="text">{t('letter.text')}</p>
          {@render grain()}
        </div>

        <div class="pocket">
          <div class="fold sides">
            <div class="side left"></div>
            <div class="side right"></div>
          </div>
          <div class="fold bottom"><div class="bottom-flap"></div></div>
          {@render grain()}
        </div>

        <div class="flap-shade"><div></div></div>
        <div class="flap">
          <div class="face outside">{@render grain()}</div>
          <div class="face inside"><div class="liner"></div></div>
        </div>

        <button type="button" class="seal" bind:this={seal} aria-label={t('letter.open')} onclick={breakSeal}>
          <span class="half left"><img src="newtab-mark.png" alt="" width="26" height="26" /></span>
          <span class="half right"><img src="newtab-mark.png" alt="" width="26" height="26" /></span>
        </button>
      </div>
      <div class="shadow"></div>
    </div>

    <div class="footer">
      <p class="hint">{t('letter.hint')}</p>
      <button type="button" class="close" bind:this={close} tabindex={stage === 'reading' ? 0 : -1} onclick={finish}>
        {t('letter.close')}
      </button>
    </div>
  </div>
</div>

<style>
  :global(body) {
    background: transparent;
  }

  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }

  .grain {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    mix-blend-mode: multiply;
  }

  .scrim {
    --navy: #26314d;
    --navy-deep: #1b2339;
    --navy-light: #313d5d;
    --gold: #c9a961;
    --wax: #9b1d22;
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    overflow: hidden;
    background: radial-gradient(ellipse at center, rgb(20 20 26 / 0.35), rgb(8 8 12 / 0.62));
    font-family: var(--font);
    animation: fade-in 420ms ease both;
  }

  .scene {
    position: relative;
    width: min(440px, 84vw);
    animation: arrive 760ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .envelope {
    position: relative;
    aspect-ratio: 1.6;
    perspective: 1400px;
  }

  .back,
  .pocket,
  .fold,
  .flap-shade {
    position: absolute;
    inset: 0;
  }

  .back {
    overflow: hidden;
    border-radius: 6px;
    background: var(--navy-deep);
  }

  .liner {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 25% 25%, rgb(201 169 97 / 0.55) 1.2px, transparent 1.6px) 0 0 / 14px 14px,
      radial-gradient(circle at 75% 75%, rgb(201 169 97 / 0.35) 1px, transparent 1.4px) 0 0 / 14px 14px,
      linear-gradient(#2d2a33, #1f1c24);
  }

  .back .liner {
    bottom: 40%;
    clip-path: polygon(4% 0, 96% 0, 50% 92%);
  }

  .letter {
    position: absolute;
    inset: 5% 5.5% 7%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 9%;
    overflow: hidden;
    border-radius: 3px;
    background: linear-gradient(170deg, #fdfaf3, #f3ecdc);
    color: #2a2622;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.25),
      inset 0 0 0 1px rgb(120 100 60 / 0.12);
    transition: transform 650ms cubic-bezier(0.3, 0.7, 0.2, 1) 950ms;
  }

  .text {
    margin: 0;
    font-family: ui-serif, 'New York', Georgia, serif;
    font-size: 22px;
    font-style: italic;
    line-height: 1.35;
    text-align: center;
  }

  .pocket {
    z-index: 2;
    overflow: hidden;
    border-radius: 6px;
  }

  .sides {
    filter: drop-shadow(0 0 1.5px rgb(0 0 0 / 0.35));
  }

  .side {
    position: absolute;
    inset: 0;
  }

  .side.left {
    background: linear-gradient(100deg, var(--navy-light), var(--navy) 70%);
    clip-path: polygon(0 0, 53% 55%, 0 100%);
  }

  .side.right {
    background: linear-gradient(260deg, var(--navy), var(--navy-deep) 80%);
    clip-path: polygon(100% 0, 47% 55%, 100% 100%);
  }

  .bottom {
    filter: drop-shadow(0 -1.5px 2px rgb(0 0 0 / 0.35));
  }

  .bottom-flap {
    position: absolute;
    inset: 0;
    background: linear-gradient(0deg, var(--navy) 30%, var(--navy-light));
    clip-path: polygon(0 100%, 3% 98%, 50% 44%, 97% 98%, 100% 100%);
  }

  .flap-shade {
    z-index: 3;
    filter: blur(4px);
    transition: opacity 250ms ease 200ms;
  }

  .flap-shade div {
    position: absolute;
    inset: 4px 0 auto;
    height: 60%;
    background: rgb(0 0 0 / 0.45);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }

  .flap {
    position: absolute;
    inset: 0 0 auto;
    z-index: 4;
    height: 60%;
    transform-origin: top;
    transform-style: preserve-3d;
    transition:
      transform 620ms cubic-bezier(0.45, 0, 0.25, 1) 260ms,
      z-index 0s 560ms;
  }

  .face {
    position: absolute;
    inset: 0;
    overflow: hidden;
    clip-path: polygon(0 0, 100% 0, 52% 98%, 50% 100%, 48% 98%);
    backface-visibility: hidden;
  }

  .outside {
    border-radius: 6px 6px 0 0;
    background: linear-gradient(180deg, var(--navy-light), var(--navy) 55%, var(--navy-deep));
  }

  .inside {
    clip-path: polygon(0 100%, 100% 100%, 52% 2%, 50% 0, 48% 2%);
    transform: rotateX(180deg);
  }

  .seal {
    position: absolute;
    top: 60%;
    left: 50%;
    z-index: 5;
    width: 74px;
    height: 74px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    filter: drop-shadow(0 3px 4px rgb(0 0 0 / 0.45));
    transform: translate(-50%, -50%) rotate(-8deg);
    cursor: pointer;
    transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .seal:hover {
    transform: translate(-50%, -50%) rotate(-8deg) scale(1.05);
  }

  .seal:focus-visible {
    outline: 2px solid rgb(255 255 255 / 0.7);
    outline-offset: 4px;
  }

  .half {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 47% 53% 50% 46% / 52% 46% 54% 48%;
    background: radial-gradient(circle at 36% 30%, #c94545, var(--wax) 42%, #5e0f13 82%);
    box-shadow:
      inset 0 2px 2px rgb(255 255 255 / 0.22),
      inset 0 -3px 5px rgb(0 0 0 / 0.35);
    transition:
      transform 420ms cubic-bezier(0.3, 0.6, 0.3, 1),
      opacity 320ms ease 160ms;
  }

  .half::before {
    position: absolute;
    inset: 11px;
    border-radius: 50%;
    box-shadow:
      inset 0 2px 3px rgb(0 0 0 / 0.5),
      0 1px 0 rgb(255 255 255 / 0.2);
    content: '';
  }

  .half img {
    filter: brightness(0) drop-shadow(0 1px 0 rgb(255 255 255 / 0.9));
    opacity: 0.32;
  }

  .half.left {
    clip-path: polygon(0 0, 53% 0, 46% 28%, 56% 52%, 46% 76%, 52% 100%, 0 100%);
  }

  .half.right {
    clip-path: polygon(53% 0, 100% 0, 100% 100%, 52% 100%, 46% 76%, 56% 52%, 46% 28%);
  }

  .shadow {
    position: absolute;
    right: 6%;
    bottom: -8%;
    left: 6%;
    z-index: -1;
    height: 16%;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.55);
    filter: blur(14px);
  }

  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 34px;
    transition: translate 900ms cubic-bezier(0.3, 0.7, 0.2, 1);
  }

  .footer {
    display: grid;
    place-items: center;
  }

  .hint,
  .close {
    grid-area: 1 / 1;
  }

  .hint {
    margin: 0;
    pointer-events: none;
    color: rgb(255 255 255 / 0.85);
    font-size: 14px;
    text-align: center;
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
    transition: opacity 250ms ease;
  }

  .close {
    height: 40px;
    padding: 0 26px;
    border: 0;
    border-radius: 20px;
    background: rgb(255 255 255 / 0.14);
    color: #fff;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    opacity: 0;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
    cursor: pointer;
    transition: opacity 400ms ease;
  }

  .close:hover {
    background: rgb(255 255 255 / 0.22);
  }

  .close:focus-visible {
    outline: 2px solid rgb(255 255 255 / 0.7);
    outline-offset: 3px;
  }

  .opening .seal {
    outline: none;
    pointer-events: none;
  }

  .opening .half.left {
    opacity: 0;
    transform: translate(-14px, 10px) rotate(-18deg);
  }

  .opening .half.right {
    opacity: 0;
    transform: translate(14px, 12px) rotate(16deg);
  }

  .opening .flap-shade,
  .opening .hint {
    opacity: 0;
  }

  .opening .flap {
    z-index: 0;
    transform: rotateX(180deg);
  }

  .opening .letter {
    transform: translateY(-58%);
  }

  .reading .stage {
    translate: 0 calc(min(440px, 84vw) * 0.2);
  }

  .reading .letter {
    z-index: 6;
    transform: translateY(-36%) scale(1.08);
    box-shadow:
      0 18px 40px rgb(0 0 0 / 0.35),
      0 2px 6px rgb(0 0 0 / 0.2);
    animation: pull-out 1300ms cubic-bezier(0.45, 0, 0.25, 1) both;
    transition: box-shadow 600ms ease 700ms;
  }

  .reading .close {
    opacity: 1;
    pointer-events: auto;
    transition-delay: 1100ms;
  }

  /* The letter clears the envelope completely before it is laid in front of it. */
  @keyframes pull-out {
    0% {
      z-index: 1;
      transform: translateY(-58%);
    }

    45% {
      z-index: 1;
      transform: translateY(-114%);
    }

    46% {
      z-index: 6;
      transform: translateY(-114%);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(24px) rotate(-2deg) scale(0.96);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .scene,
    .reading .letter {
      animation: none;
    }

    .scrim * {
      transition: none !important;
    }
  }
</style>
