<script lang="ts" module>
  import type { IconName } from '../ui/Icon.svelte';

  export interface ComposerSuggestion {
    key: string;
    label: string;
    detail: string;
    icon: IconName;
  }
</script>

<script lang="ts">
  import Icon from '../ui/Icon.svelte';

  let {
    id,
    label,
    items,
    active,
    onpick,
  }: { id: string; label: string; items: ComposerSuggestion[]; active: number; onpick(index: number): void } = $props();
</script>

<ul {id} class="suggestions" role="listbox" aria-label={label}>
  {#each items as item, index (item.key)}
    <li
      id="{id}-{index}"
      role="option"
      aria-selected={index === active}
      class:active={index === active}
      onpointerdown={(event) => {
        event.preventDefault();
        onpick(index);
      }}
    >
      <Icon name={item.icon} size={14} />
      <span class="label">{item.label}</span>
      {#if item.detail}<span class="detail">{item.detail}</span>{/if}
    </li>
  {/each}
</ul>

<style>
  .suggestions {
    display: grid;
    gap: 1px;
    max-height: 220px;
    margin: 0 0 8px;
    padding: 4px;
    overflow-y: auto;
    border-radius: var(--ai-radius);
    background: var(--surface-menu);
    box-shadow: 0 0 0 1px var(--border);
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    color: var(--text);
    font-size: var(--ai-small);
    cursor: pointer;
  }
  li > :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  li.active {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  li.active > :global(svg),
  li.active .detail {
    color: inherit;
  }
  .label {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    font-family: var(--ai-mono-font);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
