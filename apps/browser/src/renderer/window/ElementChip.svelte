<script lang="ts">
  import { t } from '../../shared/i18n';
  import { displayHost } from '../../shared/hosts';
  import type { AgentElementRef } from '../../shared/types';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';

  let { element, onremove }: { element: AgentElementRef; onremove?: () => void } = $props();

  const title = $derived(
    [element.reference ? t('agentChat.reference') : null, element.label, element.source ?? element.url]
      .filter(Boolean)
      .join('\n'),
  );
  const name = $derived(
    element.reference ? `${displayHost(element.url)} · ${element.label}` : (element.component ?? element.label),
  );
</script>

<span class="chip">
  <button
    type="button"
    class="chip-label"
    {title}
    disabled={element.reference}
    onclick={() => void window.yalqen.highlightAgentElement(element.id)}
  >
    <Icon name={element.reference ? 'image' : 'code'} size={12} /><span>{name}</span>
  </button>
  {#if onremove}
    <IconButton size="sm" icon="close" label={t('agentChat.removeElement')} onclick={onremove} />
  {/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-width: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
    color: var(--accent);
    font-size: var(--font-size-small);
  }
  .chip-label {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: var(--control-sm);
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-pill);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .chip-label:disabled {
    cursor: default;
  }
  .chip-label :global(svg) {
    flex: none;
  }
  .chip-label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-label:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chip :global(.icon-btn) {
    flex: none;
    margin-left: -6px;
  }
</style>
