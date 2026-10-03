<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    value = $bindable(''),
    size = 'md',
    invalid = false,
    class: className,
    ...rest
  }: Omit<HTMLInputAttributes, 'size' | 'value'> & {
    value?: string;
    size?: 'md' | 'lg';
    invalid?: boolean;
  } = $props();
</script>

<input bind:value class={['field', size, invalid && 'invalid', className]} aria-invalid={invalid} {...rest} />
