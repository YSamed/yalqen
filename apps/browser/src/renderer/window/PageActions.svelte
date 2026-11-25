<script lang="ts">
  import type { TabSnapshot } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';

  let { tab }: { tab: TabSnapshot } = $props();

  const send = window.yalqen.send;
  const webPage = $derived(tab.url.startsWith('http') || tab.url.startsWith('file:'));
</script>

{#if webPage}
  <span class="page-actions" role="group" aria-label={t('toolbar.pageActions')}>
    <IconButton
      icon="bookmarks"
      tone={tab.bookmarked ? 'accent' : 'muted'}
      class="bookmark"
      label={tab.bookmarked ? t('toolbar.removeBookmark') : t('toolbar.addBookmark')}
      title={tab.bookmarked ? t('toolbar.removeBookmarkTitle') : t('toolbar.addBookmarkTitle')}
      aria-pressed={tab.bookmarked}
      onclick={() => send({ type: 'toggle-bookmark' })}
    />
    <IconButton
      icon="split"
      tone="muted"
      class="split"
      label={t('toolbar.splitWithTab')}
      onclick={() => send({ type: 'split-new-tab' })}
    />
    <IconButton
      icon="link"
      tone="muted"
      class="copy-link"
      label={t('toolbar.copyLink')}
      onclick={() => send({ type: 'dev-command', id: 'copy-address' })}
    />
    <IconButton
      icon="sliders"
      tone="muted"
      class="site-settings"
      label={t('toolbar.siteSettings')}
      onclick={() => send({ type: 'open-site-info' })}
    />
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
