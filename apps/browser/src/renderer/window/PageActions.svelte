<script lang="ts">
  import type { TabSnapshot, TranslationStatus } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { devStates } from './format';

  let { tab, zoom, defaultZoom }: { tab: TabSnapshot; zoom: number; defaultZoom: number } = $props();

  const send = window.yalqen.send;
  const translateTitle: Record<TranslationStatus, string> = {
    idle: t('toolbar.translatePage'),
    translating: t('toolbar.translatingPage'),
    translated: t('toolbar.showOriginalPage'),
    failed: t('toolbar.translationFailed'),
  };
  const bookmarkable = $derived(tab.url.startsWith('http') || tab.url.startsWith('file:'));
  const states = $derived(devStates(tab));
  const zoomChanged = $derived(Math.round(zoom * 100) !== Math.round(defaultZoom * 100));
  const hasActions = $derived(
    bookmarkable || zoomChanged || states.length > 0 || tab.translation.available || tab.blockedPopups > 0,
  );
</script>

{#if hasActions}
  <span class="page-actions" role="group" aria-label={t('toolbar.pageActions')}>
    {#if bookmarkable}
      <IconButton
        icon="star"
        tone={tab.bookmarked ? 'accent' : 'muted'}
        class="star"
        label={tab.bookmarked ? t('toolbar.removeBookmark') : t('toolbar.addBookmark')}
        title={tab.bookmarked ? t('toolbar.removeBookmarkTitle') : t('toolbar.addBookmarkTitle')}
        aria-pressed={tab.bookmarked}
        onclick={() => send({ type: 'toggle-bookmark' })}
      />
    {/if}
    {#if tab.translation.available}
      {#if tab.translation.status === 'idle' || tab.translation.status === 'failed'}
        <IconButton
          icon="translate"
          tone={tab.translation.status === 'failed' ? 'warn' : 'muted'}
          label={translateTitle[tab.translation.status]}
          onclick={() => send({ type: 'toggle-translation' })}
        />
      {:else}
        <Button
          size="sm"
          variant="tonal"
          icon="translate"
          disabled={tab.translation.status === 'translating'}
          aria-pressed={tab.translation.status === 'translated'}
          title={translateTitle[tab.translation.status]}
          onclick={() => send({ type: 'toggle-translation' })}
        >
          {tab.translation.status === 'translating' ? t('toolbar.translating') : t('toolbar.translated')}
        </Button>
      {/if}
    {/if}
    {#if tab.blockedPopups > 0}
      <IconButton
        icon="popup-blocked"
        variant="tonal"
        tone="warn"
        label={t('toolbar.popupsBlocked', { count: tab.blockedPopups })}
        title={t('toolbar.popupBlocked')}
        onclick={() => send({ type: 'open-blocked-popups' })}
      />
    {/if}
    {#if states.length > 0}
      {#key tab.agentReadAt}
        <Button
          size="sm"
          variant="tonal"
          icon="gauge"
          class={[
            'dev-state',
            tab.agentObserved && 'agent',
            tab.agentReadAt !== null && Date.now() - tab.agentReadAt < 1500 && 'agent-read',
          ]}
          aria-label={t('toolbar.developerStatus', { states: states.join(', ') })}
          title={states.join(' · ')}
          onclick={() => send({ type: 'open-dev-menu' })}
        >
          {states.length}
        </Button>
      {/key}
    {/if}
    {#if zoomChanged}
      <Button
        size="sm"
        variant="tonal"
        class="zoom"
        title={t('toolbar.resetZoomTitle')}
        onclick={() => send({ type: 'reset-zoom' })}
      >
        {t('toolbar.zoomPercent', { percent: Math.round(zoom * 100) })}
      </Button>
    {/if}
  </span>
{/if}

<style>
  .page-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
  }
</style>
