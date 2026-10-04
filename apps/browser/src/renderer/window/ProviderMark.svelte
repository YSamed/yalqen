<script lang="ts" module>
  export type ProviderActivity = 'idle' | 'working' | 'waiting' | 'done' | 'error';
  export type ProviderMarkName = 'claude' | 'claude-code' | 'codex' | 'gemini';
</script>

<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import claudeLogo from './providers/claude.png';
  import codexLogo from './providers/codex.png';

  let { mark, activity }: { mark: ProviderMarkName; activity: ProviderActivity } = $props();

  const uid = $props.id();
  const GEMINI_GLOWS = [
    { color: '#ff4641', x: 9, y: 2 },
    { color: '#ffcc00', x: 0, y: 12 },
    { color: '#00b95c', x: 12, y: 24 },
  ];
</script>

<span class="mark {mark} {activity}" aria-hidden="true">
  <svg class="ring" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16.5" pathLength="100" />
  </svg>
  {#if mark === 'claude'}
    <img class="glyph" src={claudeLogo} alt="" />
  {:else if mark === 'codex'}
    <img class="glyph" src={codexLogo} alt="" />
  {:else if mark === 'claude-code'}
    <svg class="glyph" viewBox="0 0 447 447">
      <path
        fill="#d97757"
        fill-rule="evenodd"
        d="M56 93h335v111h56v58h-56v56H56v-56H0v-58h56zM112 151h27v53h-27zM308 151h27v53h-27zM84 318h28v55H84zM139 318h29v55h-29zM279 318h29v55h-29zM335 318h28v55h-28z"
      />
    </svg>
  {:else}
    <svg class="glyph" viewBox="0 0 24 24">
      <defs>
        <clipPath id="{uid}-star">
          <path
            d="M12 1.5c.9 5.6 4.9 9.6 10.5 10.5-5.6.9-9.6 4.9-10.5 10.5-.9-5.6-4.9-9.6-10.5-10.5 5.6-.9 9.6-4.9 10.5-10.5z"
          />
        </clipPath>
        {#each GEMINI_GLOWS as glow, index (glow.color)}
          <radialGradient id="{uid}-glow-{index}" cx={glow.x} cy={glow.y} r="11" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color={glow.color} />
            <stop offset="1" stop-color={glow.color} stop-opacity="0" />
          </radialGradient>
        {/each}
      </defs>
      <g clip-path="url(#{uid}-star)">
        <rect width="24" height="24" fill="#3186ff" />
        {#each GEMINI_GLOWS as glow, index (glow.color)}
          <rect width="24" height="24" fill="url(#{uid}-glow-{index})" />
        {/each}
      </g>
    </svg>
  {/if}
  {#if activity === 'done' || activity === 'error'}
    <span class="badge"><Icon name={activity === 'done' ? 'check' : 'warning'} size={9} /></span>
  {/if}
</span>

<style>
  .mark {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
  }
  .glyph {
    display: block;
    width: 18px;
    height: 18px;
  }
  .idle .glyph {
    opacity: 0.85;
  }
  .ring {
    position: absolute;
    inset: 0;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    opacity: 0;
  }
  .working .ring {
    stroke-dasharray: 28 72;
    opacity: 1;
    animation: spin 1s linear infinite;
  }
  .working.claude .glyph {
    animation: spin 2.4s linear infinite;
  }
  .working.claude-code .glyph {
    animation: hop 0.6s steps(2, jump-none) infinite alternate;
  }
  .working.codex .glyph,
  .working.gemini .glyph {
    animation: breathe 1.4s ease-in-out infinite;
  }
  .waiting .ring {
    opacity: 1;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--chrome-base);
    color: var(--on-accent, #fff);
    animation: pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .error .badge {
    background: var(--warn);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes hop {
    to {
      transform: translateY(-2px);
    }
  }
  @keyframes breathe {
    50% {
      transform: scale(0.86);
      opacity: 0.6;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mark,
    .mark * {
      animation: none !important;
    }
  }
</style>
