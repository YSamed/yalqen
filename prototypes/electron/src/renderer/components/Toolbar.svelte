<script lang="ts">
  import type { TabSnapshot } from '../../shared/types';
  import Icon from './Icon.svelte';

  let {
    tab,
    totalMemoryMB,
    placeholder,
    height,
  }: {
    tab: TabSnapshot | null;
    totalMemoryMB: number | null;
    placeholder: string;
    height: number;
  } = $props();

  let input: HTMLInputElement;
  let editing = $state(false);
  let value = $state('');

  const displayUrl = $derived(!tab || tab.url === 'about:blank' ? '' : tab.url);

  $effect(() => {
    if (!editing) value = displayUrl;
  });

  export function focusAddress(): void {
    input.focus();
    input.select();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (value.trim() === '') return;
    window.yalqen.send({ type: 'navigate', input: value });
    editing = false;
    input.blur();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      value = displayUrl;
      editing = false;
      input.blur();
    }
  }
</script>

<header class="toolbar" style:height="{height}px">
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
        input.select();
      }}
      onblur={() => (editing = false)}
      onkeydown={onKeydown}
    />
    {#if tab?.loading}<span class="loading" aria-label="Yükleniyor"></span>{/if}
  </form>

  <span class="memory" title="Uygulamanın toplam bellek kullanımı (working set)">
    {totalMemoryMB === null ? '— MB' : `${totalMemoryMB} MB`}
  </span>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Leaves room for the macOS traffic lights. */
    padding: 0 12px 0 80px;
    -webkit-app-region: drag;
  }

  .controls {
    display: flex;
    gap: 2px;
  }

  .controls,
  .address,
  .memory {
    -webkit-app-region: no-drag;
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
    flex: 1;
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

  .memory {
    min-width: 56px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
</style>
