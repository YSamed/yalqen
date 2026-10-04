<script lang="ts" generics="T extends string | number">
  import Icon from './Icon.svelte';

  let {
    value = $bindable(),
    options,
    onchange,
    id,
    variant = 'default',
    title,
    'aria-label': ariaLabel,
  }: {
    value: T;
    options: readonly { value: T; label: string }[];
    onchange?: (value: T) => void;
    id?: string;
    variant?: 'default' | 'ghost';
    title?: string;
    'aria-label'?: string;
  } = $props();

  const uid = $props.id();
  const anchor = `--select-${uid}`;
  let trigger: HTMLButtonElement;
  let list: HTMLDivElement;
  let open = $state(false);

  function items(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function choose(next: T): void {
    list.hidePopover();
    trigger.focus();
    if (next === value) return;
    value = next;
    onchange?.(next);
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    list.showPopover();
  }

  function onListKeydown(event: KeyboardEvent): void {
    // Tab closes like a native select; focus returns to the trigger, then moves on.
    if (event.key === 'Tab') return list.hidePopover();
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: all.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, next))].focus();
  }

  function onToggle(event: ToggleEvent): void {
    open = event.newState === 'open';
    if (open) (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? items()[0])?.focus();
  }
</script>

<button
  bind:this={trigger}
  {id}
  type="button"
  role="combobox"
  class="select-trigger"
  class:ghost={variant === 'ghost'}
  {title}
  aria-label={ariaLabel}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls="{uid}-list"
  popovertarget="{uid}-list"
  style:anchor-name={anchor}
  onkeydown={onTriggerKeydown}
>
  <!-- every label sits in one grid cell so the trigger keeps the widest option's width -->
  <span class="select-value">
    {#each options as option (option.value)}
      <span class:current={option.value === value}>{option.label}</span>
    {/each}
  </span>
  <Icon name="down" size={12} />
</button>

<div
  bind:this={list}
  id="{uid}-list"
  role="listbox"
  tabindex="-1"
  class="select-content"
  popover="auto"
  aria-label={ariaLabel}
  style:position-anchor={anchor}
  ontoggle={onToggle}
  onkeydown={onListKeydown}
>
  {#each options as option (option.value)}
    <button
      type="button"
      role="option"
      tabindex="-1"
      class="select-item"
      aria-selected={option.value === value}
      onclick={() => choose(option.value)}
      onpointermove={(event) => event.currentTarget.focus()}
      onpointerleave={() => list.focus()}
    >
      <span class="select-indicator">
        {#if option.value === value}<Icon name="check" size={12} />{/if}
      </span>
      {option.label}
    </button>
  {/each}
</div>
