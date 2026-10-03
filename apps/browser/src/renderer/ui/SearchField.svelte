<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';

  let {
    value = $bindable(''),
    ref = $bindable(),
    size = 'md',
    inset = false,
    icon = true,
    trailing,
    ...rest
  }: Omit<HTMLInputAttributes, 'size' | 'value'> & {
    value?: string;
    ref?: HTMLInputElement;
    size?: 'md' | 'lg';
    inset?: boolean;
    icon?: boolean;
    trailing?: Snippet;
  } = $props();
</script>

<div class={['search-field', size, inset && 'inset']}>
  {#if icon}
    <span class="search-icon"><Icon name="search" size={size === 'lg' ? 18 : 16} /></span>
  {/if}
  <input bind:this={ref} bind:value type="text" spellcheck="false" autocomplete="off" {...rest} />
  {#if trailing}<span class="search-actions">{@render trailing()}</span>{/if}
</div>
