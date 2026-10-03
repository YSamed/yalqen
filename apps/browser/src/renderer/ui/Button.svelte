<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon, { type IconName } from './Icon.svelte';

  type Size = 'sm' | 'md' | 'lg';

  const ICON_SIZE: Record<Size, number> = { sm: 12, md: 14, lg: 16 };

  let {
    icon,
    size = 'md',
    variant = 'ghost',
    children,
    class: className,
    ...rest
  }: Omit<HTMLButtonAttributes, 'children'> & {
    icon?: IconName;
    size?: Size;
    variant?: 'ghost' | 'tonal' | 'surface' | 'primary' | 'danger';
    children: Snippet;
  } = $props();
</script>

<button type="button" class={['btn', size, variant, className]} {...rest}>
  {#if icon}<Icon name={icon} size={ICON_SIZE[size]} />{/if}
  <span>{@render children()}</span>
</button>
