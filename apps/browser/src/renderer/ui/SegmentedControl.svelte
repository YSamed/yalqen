<script lang="ts" generics="T extends string | number | boolean">
  import Button from './Button.svelte';

  let {
    label,
    options,
    value,
    onchange,
  }: {
    label: string;
    options: readonly { value: T; label: string }[];
    value: T;
    onchange: (value: T) => void;
  } = $props();
</script>

<div class="segmented" role="group" aria-label={label}>
  {#each options as option (option.label)}
    <Button aria-pressed={value === option.value} onclick={() => onchange(option.value)}>{option.label}</Button>
  {/each}
</div>
