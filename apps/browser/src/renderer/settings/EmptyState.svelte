<script lang="ts">
  import Icon, { type IconName } from '../ui/Icon.svelte';

  let { icon, title, hint }: { icon: IconName; title: string; hint?: string } = $props();
</script>

<div class="empty">
  <Icon name={icon} size={28} />
  <strong>{title}</strong>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    padding: 24px 16px;
    border-radius: 12px;
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
  }

  strong {
    margin-top: 6px;
    color: var(--text);
  }
</style>
