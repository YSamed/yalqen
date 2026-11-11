<script lang="ts" generics="T extends string = AccentColorId">
  import { ACCENT_COLORS, type AccentColorId } from '../../shared/accent';
  import { t } from '../../shared/i18n';

  let {
    label,
    value,
    onchange,
    size = 26,
    colors,
  }: {
    label: string;
    value: T;
    onchange: (value: T) => void;
    size?: number;
    colors?: readonly { id: T; hex: string; label: string; ring?: boolean }[];
  } = $props();

  const swatches = $derived(
    colors ??
      (ACCENT_COLORS.map(({ id, hex }) => ({ id, hex, label: t(`accent.${id}`) })) as unknown as NonNullable<
        typeof colors
      >),
  );

  let group = $state<HTMLElement>();

  // Arrow keys move the choice like native radio buttons.
  function move(event: KeyboardEvent, index: number): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + swatches.length) % swatches.length;
    onchange(swatches[next].id);
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div class="swatches" role="radiogroup" aria-label={label} bind:this={group} style:--size="{size}px">
  {#each swatches as color, index (color.id)}
    <button
      type="button"
      class="swatch"
      class:ring={color.ring}
      role="radio"
      aria-checked={value === color.id}
      aria-label={color.label}
      title={color.label}
      tabindex={value === color.id ? 0 : -1}
      style:--swatch={color.hex}
      onclick={() => onchange(color.id)}
      onkeydown={(event) => move(event, index)}
    ></button>
  {/each}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .swatch {
    width: var(--size);
    height: var(--size);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--swatch);
    cursor: pointer;
    transition: box-shadow var(--transition, 120ms ease-out);
  }

  .swatch.ring {
    box-shadow: inset 0 0 0 1.5px var(--text-muted);
  }

  .swatch.ring[aria-checked='true'] {
    box-shadow:
      inset 0 0 0 1.5px var(--text-muted),
      0 0 0 2.5px var(--swatch-gap, var(--surface)),
      0 0 0 4.5px var(--text-muted);
  }

  .swatch[aria-checked='true'] {
    box-shadow:
      0 0 0 2.5px var(--swatch-gap, var(--surface)),
      0 0 0 4.5px var(--swatch);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--swatch);
    outline-offset: 5px;
  }
</style>
