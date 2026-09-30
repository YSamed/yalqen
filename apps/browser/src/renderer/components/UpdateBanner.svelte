<script lang="ts">
  import Button from './ui/Button.svelte';
  import Icon from './Icon.svelte';

  let {
    version,
    oninstall,
    ondismiss,
  }: {
    version: string;
    oninstall: () => void;
    ondismiss: () => void;
  } = $props();
</script>

<div class="banner" role="status">
  <Icon name="update" size={16} />
  <span class="message">Yalqen {version} hazır. Yeniden başlatınca yüklenir, açık sekmeler geri gelir.</span>
  <Button variant="primary" size="sm" onclick={oninstall}>Yeniden başlat</Button>
  <Button variant="ghost" size="sm" onclick={ondismiss}>Sonra</Button>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    align-self: start;
    gap: 8px;
    height: 32px;
    padding: 0 8px 0 12px;
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow), var(--well-rim);
    color: var(--text);
    font-size: var(--font-size);
  }

  .banner :global(svg) {
    flex: none;
    color: var(--accent);
  }

  .message {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
