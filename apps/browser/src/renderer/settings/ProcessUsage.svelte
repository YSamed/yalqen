<script lang="ts">
  import { onMount } from 'svelte';
  import { getLocale, t } from '../../shared/i18n';
  import type { ProcessGroupKind, ProcessUsage } from '../../shared/types';

  const REFRESH_MS = 2000;
  const GROUP_LABELS: Record<ProcessGroupKind, string> = {
    pages: t('processUsage.groupPages'),
    interface: t('processUsage.groupInterface'),
    extensions: t('processUsage.groupExtensions'),
    browser: t('processUsage.groupBrowser'),
    gpu: t('processUsage.groupGpu'),
    utility: t('processUsage.groupUtility'),
    other: t('processUsage.groupOther'),
  };
  const numbers = new Intl.NumberFormat(getLocale());
  const api = window.yalqenSettings;

  let usage = $state.raw<ProcessUsage | null>(null);

  const megabytes = (value: number) => `${numbers.format(value)} MB`;

  function pageLabel(titles: string[]): string {
    return titles.length > 1
      ? t('processUsage.pageAndMore', { title: titles[0], count: titles.length - 1 })
      : titles[0];
  }

  onMount(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void api.processUsage().then((next) => (usage = next));
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

<h2>{t('processUsage.memoryUsage')}</h2>
{#if usage}
  <div class="row">
    <span>{t('processUsage.total')}</span>
    <strong class="value">{megabytes(usage.totalMB)}</strong>
  </div>
  {#each usage.groups as group (group.kind)}
    <div class="row">
      <span class="label">
        <span>{GROUP_LABELS[group.kind]}</span>
        <span class="hint">{t('processUsage.processCount', { count: group.count })}</span>
      </span>
      <span class="value">{megabytes(group.memoryMB)}</span>
    </div>
  {/each}
  {#if usage.pages.length > 0}
    <h2>{t('processUsage.topTabs')}</h2>
    {#each usage.pages as page (page.pid)}
      <div class="row">
        <span class="title" title={page.titles.join('\n')}>{pageLabel(page.titles)}</span>
        <span class="value">{megabytes(page.memoryMB)}</span>
      </div>
    {/each}
  {/if}
  <p class="hint note">
    {t('processUsage.note')}
  </p>
{:else}
  <p class="hint note">{t('processUsage.measuring')}</p>
{/if}

<style>
  .note {
    margin: 10px 0 0;
  }

  .title {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
</style>
