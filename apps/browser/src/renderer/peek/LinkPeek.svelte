<script lang="ts">
  import { onMount } from 'svelte';
  import { PEEK_HEADER, peekLayout } from '../../shared/link-peek';
  import type { PeekState } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';

  const api = window.yalqenPeek;

  let current = $state<PeekState>({ title: '', url: '' });
  let width = $state(window.innerWidth);
  let height = $state(window.innerHeight);

  const card = $derived(peekLayout(width, height).card);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    api.send('close');
  }

  onMount(() =>
    api.onUpdate((next) => {
      current = next;
    }),
  );
</script>

<svelte:head><title>{t('linkPeek.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} bind:innerWidth={width} bind:innerHeight={height} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={() => api.send('close')}></div>
<div
  class="card"
  role="dialog"
  aria-label={t('linkPeek.pageTitle')}
  style:left="{card.x}px"
  style:top="{card.y}px"
  style:width="{card.width}px"
  style:height="{card.height}px"
>
  <header style:height="{PEEK_HEADER}px">
    <div class="address">
      <span class="title">{current.title}</span>
      <span class="url">{current.url}</span>
    </div>
    <IconButton icon="external" label={t('linkPeek.promote')} onclick={() => api.send('promote')} />
    <IconButton
      icon="close"
      label={t('linkPeek.close')}
      title={t('linkPeek.closeTitle')}
      onclick={() => api.send('close')}
    />
  </header>
</div>

<style>
  :global(body) {
    background: transparent;
  }

  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(30 30 36 / 0.32);
  }

  .card {
    --card: #fbfaf8;
    --hair: rgb(16 18 24 / 0.1);
    position: fixed;
    box-sizing: border-box;
    border-radius: 12px;
    background: var(--card);
    color: var(--text);
    font-family: var(--font);
    box-shadow:
      0 0 0 0.5px var(--hair),
      0 30px 80px rgb(0 0 0 / 0.35),
      0 2px 6px rgb(0 0 0 / 0.15);
  }

  @media (prefers-color-scheme: dark) {
    .scrim {
      background: rgb(5 5 7 / 0.55);
    }

    .card {
      --card: #1c1c1f;
      --hair: rgb(255 255 255 / 0.1);
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
    padding: 0 8px 0 14px;
  }

  .address {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }

  .title,
  .url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .title {
    font-size: var(--font-size);
    font-weight: 600;
  }

  .url {
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
