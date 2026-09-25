<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './components/Icon.svelte';

  let input: HTMLInputElement | undefined = $state();
  let value = $state('');
  let placeholder = $state('Ara veya adres yaz');

  // The box stays rendered while the view is detached, so it shows on the first
  // frame after the main process attaches the view again.
  function finish(action: { type: 'submit'; input: string } | { type: 'dismiss' }): void {
    value = '';
    window.yalqenCommand.send(action);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (value.trim() === '') return;
    finish({ type: 'submit', input: value });
  }

  function onInput(): void {
    window.yalqenCommand.send({ type: 'input', input: value });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish({ type: 'dismiss' });
    }
  }

  onMount(() =>
    window.yalqenCommand.onOpen((open) => {
      placeholder = open.placeholder;
      value = open.value ?? '';
      input?.focus();
      input?.select();
    }),
  );
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(event) => {
    if (event.target === event.currentTarget) finish({ type: 'dismiss' });
  }}
>
  <form class="bar" role="search" onsubmit={submit}>
    <span class="icon"><Icon name="search" size={18} /></span>
    <input
      bind:this={input}
      bind:value
      oninput={onInput}
      type="text"
      spellcheck="false"
      autocomplete="off"
      {placeholder}
      aria-label="Ara veya adres yaz"
    />
  </form>
</div>

<style>
  :global(body) {
    background: transparent;
  }

  .backdrop {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 16px;
    background: rgb(0 0 0 / 0.18);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(640px, 100%);
    height: 52px;
    padding: 0 16px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow:
      0 0 0 0.5px rgb(0 0 0 / 0.12),
      0 12px 40px rgb(0 0 0 / 0.22);
  }

  .icon {
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 17px;
    user-select: text;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  input:focus {
    outline: none;
  }

  @media (prefers-color-scheme: dark) {
    .backdrop {
      background: rgb(0 0 0 / 0.35);
    }

    .bar {
      box-shadow:
        0 0 0 0.5px rgb(255 255 255 / 0.14),
        0 12px 40px rgb(0 0 0 / 0.5);
    }
  }
</style>
