<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon, { type IconName } from './Icon.svelte';

  type Size = 'sm' | 'md' | 'lg';

  const ICON_SIZE: Record<Size, number> = { sm: 12, md: 16, lg: 16 };

  let {
    label,
    icon,
    size = 'md',
    variant = 'ghost',
    tone = 'default',
    title,
    children,
    class: className,
    ...rest
  }: Omit<HTMLButtonAttributes, 'children'> & {
    label: string;
    icon?: IconName;
    size?: Size;
    variant?: 'ghost' | 'surface' | 'tonal' | 'accent';
    tone?: 'default' | 'muted' | 'accent' | 'warn';
    children?: Snippet;
  } = $props();
</script>

<button
  type="button"
  class={['icon-btn', size, variant, tone !== 'default' && `tone-${tone}`, className]}
  aria-label={label}
  title={title ?? label}
  {...rest}
>
  {#if icon}<Icon name={icon} size={ICON_SIZE[size]} />{/if}
  {@render children?.()}
</button>
