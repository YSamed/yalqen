<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ConfirmOpen } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';

  const api = window.yalqenConfirm;

  let open = $state<ConfirmOpen | null>(null);
  let card = $state<HTMLElement>();

  function answer(confirmed: boolean): void {
    if (!open) return;
    open = null;
    api.answer(confirmed);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    answer(false);
  }

  onMount(() =>
    api.onOpen(async (next) => {
      document.documentElement.style.setProperty('--accent', next.accent);
      open = next;
      await tick();
      card?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    }),
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="scrim">
    <div
      class={['card', open.danger && 'danger']}
      bind:this={card}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <div class="badge"><Icon name={open.icon} size={22} /></div>
      <h1 id="confirm-title">{open.title}</h1>
      {#if open.message}<p id="confirm-message">{open.message}</p>{/if}
      {#if open.items.length > 0}
        <ul>
          {#each open.items as item, index (index)}
            <li><Icon name="check" size={12} /><span>{item}</span></li>
          {/each}
        </ul>
      {/if}
      <div class="actions">
        <Button size="lg" variant="surface" data-cancel onclick={() => answer(false)}>
          {open.cancelLabel}
        </Button>
        <Button size="lg" variant={open.danger ? 'danger' : 'primary'} onclick={() => answer(true)}>
          {open.confirmLabel}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    background: transparent;
  }

  .scrim {
    --card: #fbfaf8;
    --hair: rgb(16 18 24 / 0.1);
    --row: rgb(16 18 24 / 0.035);
    display: grid;
    place-items: center;
    height: 100vh;
    padding: 24px;
    box-sizing: border-box;
    background: rgb(30 30 36 / 0.22);
    color: var(--text);
    font-family: var(--font);
    animation: fade 160ms var(--ease-out) both;
  }

  @media (prefers-color-scheme: dark) {
    .scrim {
      --card: #1c1c1f;
      --hair: rgb(255 255 255 / 0.1);
      --row: rgb(255 255 255 / 0.04);
      background: rgb(5 5 7 / 0.5);
    }
  }

  .card {
    --tone: var(--accent);
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(380px, 100%);
    max-height: 100%;
    overflow: auto;
    box-sizing: border-box;
    padding: 26px 22px 20px;
    border-radius: 20px;
    background: var(--card);
    text-align: center;
    box-shadow:
      0 0 0 0.5px var(--hair),
      0 30px 80px rgb(0 0 0 / 0.35),
      0 2px 6px rgb(0 0 0 / 0.15);
    animation: arrive 260ms var(--ease-out) both;
  }

  .card.danger {
    --tone: var(--danger, #c94d4d);
  }

  .badge {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-bottom: 14px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--tone) 16%, transparent);
    color: var(--tone);
  }

  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: var(--font-size);
    line-height: 1.4;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-self: stretch;
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
    text-align: left;
  }

  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 12px;
    background: var(--row);
    font-size: var(--font-size);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  li:first-child {
    border-radius: 10px 10px 4px 4px;
  }

  li:last-child {
    border-radius: 4px 4px 10px 10px;
  }

  li:only-child {
    border-radius: 10px;
  }

  li :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--tone);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    align-self: stretch;
    margin-top: 20px;
  }

  .actions :global(.btn) {
    justify-content: center;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .card {
      animation: none;
    }
  }
</style>
