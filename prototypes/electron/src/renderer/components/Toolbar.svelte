<script lang="ts">
  import { NEW_TAB_URL, type TabSnapshot } from '../../shared/types';
  import Icon from './Icon.svelte';

  let {
    tab,
    placeholder,
    collapsed,
    onSearch,
  }: {
    tab: TabSnapshot | null;
    placeholder: string;
    collapsed: boolean;
    /** Opens the address field from the collapsed panel. */
    onSearch: () => void;
  } = $props();

  let input: HTMLInputElement | undefined = $state();
  let editing = $state(false);
  let value = $state('');

  const displayUrl = $derived(
    !tab || tab.url === 'about:blank' || tab.url === NEW_TAB_URL ? '' : tab.url,
  );

  $effect(() => {
    if (!editing) value = displayUrl;
  });

  export function focusAddress(): void {
    input?.focus();
    input?.select();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (value.trim() === '') return;
    window.yalqen.send({ type: 'navigate', input: value });
    editing = false;
    input?.blur();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      value = displayUrl;
      editing = false;
      input?.blur();
    }
  }
</script>

<header class="toolbar" class:collapsed>
  {#if collapsed}
    <button class="icon" title="Ara veya adres yaz (⌘L)" onclick={onSearch}>
      <Icon name="search" />
    </button>
  {:else}
    <nav class="controls">
      <button
        class="icon"
        title="Geri"
        disabled={!tab?.canGoBack}
        onclick={() => window.yalqen.send({ type: 'go-back' })}
      >
        <Icon name="back" />
      </button>
      <button
        class="icon"
        title="İleri"
        disabled={!tab?.canGoForward}
        onclick={() => window.yalqen.send({ type: 'go-forward' })}
      >
        <Icon name="forward" />
      </button>
      <button class="icon" title="Yenile" onclick={() => window.yalqen.send({ type: 'reload' })}>
        <Icon name="reload" />
      </button>
    </nav>

    <form class="address" onsubmit={submit}>
      <input
        bind:this={input}
        bind:value
        type="text"
        spellcheck="false"
        autocomplete="off"
        {placeholder}
        aria-label="Adres"
        onfocus={() => {
          editing = true;
          input?.select();
        }}
        onblur={() => (editing = false)}
        onkeydown={onKeydown}
      />
      {#if tab?.loading}<span class="loading" aria-label="Yükleniyor"></span>{/if}
    </form>
  {/if}
</header>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 8px;
  }

  .toolbar.collapsed {
    align-items: center;
    padding-top: 8px;
    -webkit-app-region: drag;
  }

  .controls {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
    height: 44px;
    /* Leaves room for the macOS traffic lights on the left. */
    padding-left: 72px;
    -webkit-app-region: drag;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    transition: background var(--transition);
    -webkit-app-region: no-drag;
  }

  .collapsed .icon {
    width: 36px;
    height: 32px;
    border-radius: var(--radius);
  }

  .icon:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }

  .icon:disabled {
    opacity: 0.35;
  }

  .address {
    position: relative;
    min-width: 0;
  }

  input {
    width: 100%;
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    font: inherit;
    user-select: text;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  input:focus {
    outline: 2px solid var(--focus);
    outline-offset: -1px;
  }

  .loading {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0.6;
  }
</style>
