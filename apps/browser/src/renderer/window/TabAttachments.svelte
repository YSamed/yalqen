<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../shared/i18n';
  import { MAX_CHAT_TABS } from '../../shared/agent-panel';
  import type { TabSnapshot } from '../../shared/types';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';

  let { tabs, selected, ontoggle }: { tabs: TabSnapshot[]; selected: TabSnapshot[]; ontoggle(tab: TabSnapshot): void } =
    $props();

  const uid = $props.id();
  const anchor = `--tabs-${uid}`;
  let list: HTMLDivElement;
  let search: HTMLInputElement;
  let open = $state(false);
  let query = $state('');
  const matches = $derived(
    tabs.filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(query.trim().toLowerCase())),
  );

  function onToggle(event: ToggleEvent): void {
    open = event.newState === 'open';
    if (open) {
      query = '';
      void tick().then(() => search?.focus());
    }
  }

  function navigate(event: KeyboardEvent): void {
    const items = [...list.querySelectorAll<HTMLButtonElement>('.tab-option:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = index + (event.key === 'ArrowDown' ? 1 : -1);
      if (next < 0) search.focus();
      else items[Math.min(items.length - 1, next)]?.focus();
    }
  }
</script>

<IconButton
  icon="globe"
  label={t('agentChat.addTabs')}
  title={t('agentChat.tabsHint', { count: MAX_CHAT_TABS })}
  variant={selected.length ? 'tonal' : 'ghost'}
  disabled={!tabs.length}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls="{uid}-tabs"
  popovertarget="{uid}-tabs"
  style={`anchor-name: ${anchor}`}
/>

<div
  bind:this={list}
  id="{uid}-tabs"
  class="tab-picker"
  role="dialog"
  aria-label={t('agentChat.addTabs')}
  tabindex="-1"
  popover="auto"
  style:position-anchor={anchor}
  ontoggle={onToggle}
  onkeydown={navigate}
>
  <div class="picker-heading">
    <strong>{t('agentChat.addTabs')}</strong>
    <span>{selected.length}/{MAX_CHAT_TABS}</span>
  </div>
  <input
    bind:this={search}
    bind:value={query}
    type="search"
    placeholder={t('agentChat.searchTabs')}
    aria-label={t('agentChat.searchTabs')}
  />
  <div class="tab-options">
    {#each matches as tab (tab.id)}
      {@const attached = selected.some((item) => item.id === tab.id)}
      <button
        class="tab-option"
        type="button"
        aria-pressed={attached}
        disabled={!attached && selected.length >= MAX_CHAT_TABS}
        title={tab.agentObserved ? tab.url : t('agentChat.pageSendHint', { url: tab.url })}
        onclick={() => ontoggle(tab)}
      >
        <span class="indicator"><Icon name={attached ? 'check' : 'globe'} size={14} /></span>
        <span class="tab-copy"
          ><span class="tab-title">{tab.title || tab.url}</span><span class="tab-url">{tab.url}</span></span
        >
      </button>
    {:else}
      <p class="empty">{t('agentChat.noMatchingTabs')}</p>
    {/each}
  </div>
  <p class="hint">{t('agentChat.tabsHint', { count: MAX_CHAT_TABS })}</p>
</div>

<style>
  .tab-picker {
    inset: auto;
    bottom: anchor(top);
    left: anchor(left);
    position-try-fallbacks: flip-inline;
    width: min(320px, calc(100vw - 32px));
    max-height: min(440px, calc(100vh - 48px));
    margin: 0 0 8px;
    padding: 10px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-menu);
    color: var(--text);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
    font-size: 12px;
  }
  .picker-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 4px 10px;
  }
  .picker-heading span,
  .hint,
  .empty {
    color: var(--text-muted);
  }
  input {
    width: 100%;
    margin-bottom: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .tab-options {
    display: grid;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }
  .tab-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .tab-option:hover,
  .tab-option:focus-visible {
    background: var(--surface-hover);
  }
  .tab-option:active {
    transform: scale(0.98);
  }
  .tab-option[aria-pressed='true'] .indicator {
    color: var(--accent);
  }
  .tab-option:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .indicator {
    flex: none;
    color: var(--text-muted);
  }
  .tab-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .tab-title,
  .tab-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-url {
    color: var(--text-muted);
    font-size: 11px;
  }
  .hint {
    margin: 8px 4px 2px;
    font-size: 11px;
    line-height: 1.5;
  }
  .empty {
    margin: 12px 8px;
  }
</style>
