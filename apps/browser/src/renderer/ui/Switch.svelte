<script lang="ts">
  let {
    label,
    checked,
    onchange,
  }: {
    label: string;
    checked: boolean;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  class="switch"
  aria-checked={checked}
  aria-label={label}
  onclick={() => onchange(!checked)}
>
  <span></span>
</button>
