<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../ui/Icon.svelte';

  let { label, summary, area, children }: { label: string; summary: string; area: string; children: Snippet } =
    $props();

  const uid = $props.id();
  let open = $state(false);

  function onToggle(event: ToggleEvent & { currentTarget: HTMLDivElement }): void {
    open = event.newState === 'open';
    if (open) event.currentTarget.querySelector<HTMLElement>('button')?.focus();
  }
</script>

<button
  type="button"
  class="select-trigger ghost settings-trigger"
  title={label}
  aria-label="{label}: {summary}"
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls="{uid}-settings"
  popovertarget="{uid}-settings"
>
  <Icon name="settings" size={12} />
  <span class="summary">{summary}</span>
</button>

<div
  id="{uid}-settings"
  role="dialog"
  aria-label={label}
  class="select-content up settings"
  popover="auto"
  style:position-anchor={area}
  ontoggle={onToggle}
>
  {@render children()}
</div>

<style>
  .settings-trigger {
    flex: 0 1 auto;
    min-width: 0;
  }
  .summary {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .settings {
    right: anchor(right);
  }
  .settings:popover-open {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px 12px;
    padding: 10px 12px;
    overflow: visible;
  }
  .settings :global(.select-trigger) {
    justify-content: space-between;
    width: 100%;
    min-width: 0;
  }
  .settings :global(.select-value) {
    min-width: 0;
    overflow: hidden;
  }
  .settings :global(.select-value > span) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
