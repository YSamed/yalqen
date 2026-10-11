<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte';

  let {
    label,
    options,
    value,
    onchange,
    preview,
  }: {
    label: string;
    options: readonly { value: T; label: string }[];
    value: T;
    onchange: (value: T) => void;
    preview: Snippet<[T]>;
  } = $props();

  let group = $state<HTMLElement>();

  // Arrow keys move the choice like native radio buttons, so the cards stay usable without a mouse.
  function move(event: KeyboardEvent, index: number): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onchange(options[next].value);
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div class="choices" role="radiogroup" aria-label={label} bind:this={group}>
  {#each options as option, index (option.value)}
    <button
      type="button"
      class="choice"
      role="radio"
      aria-checked={value === option.value}
      tabindex={value === option.value ? 0 : -1}
      onclick={() => onchange(option.value)}
      onkeydown={(event) => move(event, index)}
    >
      <span class="preview" aria-hidden="true">{@render preview(option.value)}</span>
      <span class="caption">{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
    gap: 12px;
    padding: 6px 0 14px;
    border-bottom: 1px solid var(--border);
  }

  .choice {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .preview {
    display: block;
    aspect-ratio: 8 / 5;
    padding: 6px;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    background: var(--surface-hover);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .preview :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .choice:hover .preview {
    border-color: var(--text-muted);
  }

  .choice[aria-checked='true'] .preview {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .choice:focus-visible {
    outline: none;
  }

  .choice:focus-visible .preview {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 2px;
  }

  .caption {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  .choice[aria-checked='true'] .caption::before {
    content: '';
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .preview {
      transition: none;
    }
  }
</style>
