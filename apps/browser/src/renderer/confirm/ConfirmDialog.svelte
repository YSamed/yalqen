<script lang="ts">
  import { accentCss } from '../../shared/accent';
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
      document.documentElement.style.setProperty('--accent', accentCss(next.accent));
      open = next;
      await tick();
      // Keyboard users still get the ring once they press a key; a fresh dialog should not open with one.
      card?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus({ focusVisible: false });
    }),
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="scrim">
    <div
      class={['card', open.danger && 'danger', open.tint && 'tinted']}
      style:--menu-tint={open.tint}
      bind:this={card}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <header>
        {#if open.image}
          <img class="badge image" src={open.image} alt="" />
        {:else}
          <span class="badge"><Icon name={open.icon} size={16} /></span>
        {/if}
        <div class="heading">
          <h1 id="confirm-title">{open.title}</h1>
          {#if open.message && open.items.length === 0}<p id="confirm-message">{open.message}</p>{/if}
        </div>
      </header>
      {#if open.items.length > 0}
        <div class="divider"></div>
        {#if open.message}<p id="confirm-message" class="section">{open.message}</p>{/if}
        <ul>
          {#each open.items as item, index (index)}
            <li><Icon name="check" size={14} /><span>{item}</span></li>
          {/each}
        </ul>
      {/if}
      <div class="divider"></div>
      <div class="actions">
        <Button variant="tonal" data-cancel onclick={() => answer(false)}>
          {open.cancelLabel}
        </Button>
        <Button variant={open.danger ? 'danger' : 'primary'} onclick={() => answer(true)}>
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
    display: grid;
    place-items: center;
    height: 100vh;
    padding: 24px;
    box-sizing: border-box;
    background: light-dark(rgb(30 30 36 / 0.16), rgb(5 5 7 / 0.4));
    color: var(--text);
    font-family: var(--font);
    animation: fade 140ms var(--ease-out) both;
  }

  /* Same surface, edge and rows as the sidebar menus. */
  .card {
    --menu-surface: light-dark(#f7f7f8, #26282b);
    --menu-line: light-dark(rgb(16 18 24 / 0.08), rgb(255 255 255 / 0.08));
    --tone: var(--accent);
    display: flex;
    flex-direction: column;
    width: min(334px, 100%);
    max-height: 100%;
    overflow: auto;
    box-sizing: border-box;
    padding: 6px;
    border-radius: 16px;
    background: var(--menu-surface);
    box-shadow:
      0 0 0 0.5px light-dark(rgb(16 18 24 / 0.16), rgb(255 255 255 / 0.16)),
      inset 0 1px 0 light-dark(rgb(255 255 255 / 0.7), rgb(255 255 255 / 0.06)),
      0 18px 48px rgb(0 0 0 / 0.32);
    animation: menu-in 140ms var(--ease-out) both;
  }

  .card.tinted {
    --menu-surface: light-dark(
      color-mix(in srgb, var(--menu-tint) 6%, #f7f7f8),
      color-mix(in srgb, var(--menu-tint) 16%, #222427)
    );
  }

  .card.danger {
    --tone: var(--danger, #c94d4d);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 10px 8px;
  }

  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tone) 16%, transparent);
    color: var(--tone);
  }

  .badge.image {
    object-fit: contain;
    background: none;
  }

  .heading {
    min-width: 0;
    padding-top: 4px;
  }

  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  p {
    margin: 3px 0 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.4;
  }

  p.section {
    margin: 6px 10px 2px;
    font-size: 11px;
    font-weight: 600;
  }

  .divider {
    flex: none;
    height: 1px;
    margin: 6px 10px;
    background: var(--menu-line);
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 37px;
    box-sizing: border-box;
    padding: 9px 10px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  li :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--text-muted);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 4px;
  }

  .actions :global(.btn) {
    justify-content: center;
    height: 37px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  .actions :global(.btn.tonal) {
    color: var(--text);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.985);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .card {
      animation: none;
    }
  }
</style>
