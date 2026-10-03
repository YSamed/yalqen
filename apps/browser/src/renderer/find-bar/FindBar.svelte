<script lang="ts">
  import { onMount } from 'svelte';
  import type { FindResult } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';
  import SearchField from '../ui/SearchField.svelte';

  let input: HTMLInputElement | undefined = $state();
  let value = $state('');
  let result = $state<FindResult | null>(null);

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
    const offOpen = window.yalqenFind.onOpen(() => {
      input?.focus();
      input?.select();
      if (value !== '') search();
    });
    const offResult = window.yalqenFind.onResult((next) => (result = next));
    return () => {
      offOpen();
      offResult();
    };
  });
</script>

<svelte:head><title>{t('findBar.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="find" role="search">
  <SearchField
    bind:value
    bind:ref={input}
    oninput={search}
    placeholder={t('findBar.placeholder')}
    aria-label={t('findBar.placeholder')}
  >
    {#snippet trailing()}
      <span class="status" class:empty={result?.matches === 0} aria-live="polite">{status}</span>
      <IconButton
        icon="up"
        label={t('findBar.previous')}
        title={t('findBar.previousTitle')}
        disabled={!result?.matches}
        onclick={() => step(false)}
      />
      <IconButton
        icon="down"
        label={t('findBar.next')}
        title={t('findBar.nextTitle')}
        disabled={!result?.matches}
        onclick={() => step(true)}
      />
      <IconButton
        icon="close"
        label={t('findBar.close')}
        title={t('findBar.closeTitle')}
        onclick={() => window.yalqenFind.send({ type: 'close' })}
      />
    {/snippet}
  </SearchField>
</div>

<style>
  :global(body) {
    background: transparent;
  }

  .find {
    margin: 4px 8px;
    --search-field-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.12), 0 6px 16px rgb(0 0 0 / 0.14);
  }

  .status {
    padding: 0 6px;
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .status.empty {
    color: var(--warn);
  }

  @media (prefers-color-scheme: dark) {
    .find {
      --search-field-shadow: 0 0 0 0.5px rgb(255 255 255 / 0.14), 0 6px 16px rgb(0 0 0 / 0.4);
    }
  }
</style>
