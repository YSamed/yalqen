<script lang="ts">
  import { onMount } from 'svelte';
  import type { FindResult } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';

  let input: HTMLInputElement | undefined = $state();
  let value = $state('');
  let result = $state<FindResult | null>(null);
  let tint = $state<string | null>(null);

  const status = $derived(
    value === '' || result === null
      ? ''
      : result.matches === 0
        ? t('findBar.noResults')
        : `${result.active}/${result.matches}`,
  );

  function search(): void {
    result = null;
    window.yalqenFind.send({ type: 'find', text: value, forward: true, next: false });
  }

  function step(forward: boolean): void {
    if (value === '') return;
    window.yalqenFind.send({ type: 'find', text: value, forward, next: true });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.yalqenFind.send({ type: 'close' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      step(!event.shiftKey);
    }
  }

  onMount(() => {
    const offOpen = window.yalqenFind.onOpen((next) => {
      tint = next;
      input?.focus();
      input?.select();
      if (value !== '') search();
    });
    const offResult = window.yalqenFind.onResult((next) => {
      result = next;
    });
    return () => {
      offOpen();
      offResult();
    };
  });
</script>

<svelte:head><title>{t('findBar.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="find" class:tinted={tint !== null} style:--menu-tint={tint} role="search">
  <Icon name="search" size={16} />
  <input
    bind:this={input}
    bind:value
    oninput={search}
    type="text"
    spellcheck="false"
    autocomplete="off"
    placeholder={t('findBar.placeholder')}
    aria-label={t('findBar.placeholder')}
  />
  <span class="status" class:empty={result?.matches === 0} aria-live="polite">{status}</span>
  <span class="divider" aria-hidden="true"></span>
  <IconButton
    icon="up"
    size="sm"
    label={t('findBar.previous')}
    title={t('findBar.previousTitle')}
    disabled={!result?.matches}
    onclick={() => step(false)}
  />
  <IconButton
    icon="down"
    size="sm"
    label={t('findBar.next')}
    title={t('findBar.nextTitle')}
    disabled={!result?.matches}
    onclick={() => step(true)}
  />
  <IconButton
    icon="close"
    size="sm"
    label={t('findBar.close')}
    title={t('findBar.closeTitle')}
    onclick={() => window.yalqenFind.send({ type: 'close' })}
  />
</div>

<style>
  :global(body) {
    background: transparent;
  }

  /* Same surface and edge as the sidebar menus, as one compact row. */
  .find {
    --menu-surface: light-dark(#f7f7f8, #26282b);
    --menu-line: light-dark(rgb(16 18 24 / 0.08), rgb(255 255 255 / 0.08));
    display: flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    margin: 4px 8px;
    padding: 0 6px 0 14px;
    border-radius: 12px;
    background: var(--menu-surface);
    box-shadow:
      0 0 0 0.5px light-dark(rgb(16 18 24 / 0.16), rgb(255 255 255 / 0.16)),
      inset 0 1px 0 light-dark(rgb(255 255 255 / 0.7), rgb(255 255 255 / 0.06)),
      0 6px 16px rgb(0 0 0 / 0.22);
    color: var(--text-muted);
    font-family: var(--font);
  }

  .find.tinted {
    --menu-surface: light-dark(
      color-mix(in srgb, var(--menu-tint) 6%, #f7f7f8),
      color-mix(in srgb, var(--menu-tint) 16%, #222427)
    );
  }

  input {
    flex: 1;
    min-width: 0;
    margin-left: 4px;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    user-select: text;
  }

  input::placeholder {
    color: var(--text-muted);
    font-weight: 400;
  }

  .status {
    padding: 0 4px;
    color: var(--text-muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .status.empty {
    color: var(--warn);
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--menu-line);
  }
</style>
