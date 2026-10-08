<script lang="ts">
  import { onMount } from 'svelte';
  import { t, getLocale } from '../../shared/i18n';
  import type { SiteStorageView } from '../../shared/site-storage';
  import Button from '../ui/Button.svelte';
  import TextField from '../ui/TextField.svelte';
  const api = window.yalqenSettings;
  let view = $state<SiteStorageView | null>(null),
    query = $state(''),
    busy = $state(false),
    error = $state(false);
  async function refresh(offset = 0): Promise<void> {
    busy = true;
    error = false;
    try {
      const next = await api.siteStorage(query, offset);
      if (next) view = next;
      else error = true;
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }
  async function clear(domain: string | null): Promise<void> {
    busy = true;
    error = false;
    try {
      if (await api.clearSiteStorage(domain)) await refresh();
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }
  function size(value: number): string {
    let unit = 0;
    while (value >= 1024 && unit < 3) {
      value /= 1024;
      unit++;
    }
    return `${value.toLocaleString(getLocale(), { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
  }
  onMount(() => {
    void refresh();
  });
</script>

<section aria-label={t('siteStorage.title')} aria-busy={busy}>
  <h2>{t('siteStorage.title')}</h2>
  <p class="hint">{t('siteStorage.intro')}</p>
  <p class="hint">{t('siteStorage.measureHint')}</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void refresh();
    }}
  >
    <TextField
      bind:value={query}
      type="search"
      maxlength={200}
      placeholder={t('siteStorage.search')}
      aria-label={t('siteStorage.search')}
      disabled={busy}
    />
    <Button type="submit" variant="tonal" disabled={busy}>{t('siteStorage.refresh')}</Button>
    <Button disabled={busy} onclick={() => clear(null)}>{t('siteStorage.clearAll')}</Button>
  </form>
  {#if error}<p class="error" role="alert">{t('siteStorage.failed')}</p>{/if}
  {#if view}
    {#if view.limited}<p role="status" class="hint">{t('siteStorage.limited')}</p>{/if}
    <ul>
      {#each view.sites as site (site.domain)}
        <li>
          <div>
            <strong>{site.domain}</strong>
            <span class="hint">{t('siteStorage.counts', { cookies: site.cookies, origins: site.origins })}</span>
            <span class="hint"
              >{t('siteStorage.databaseUsage', {
                size: site.databaseBytes === null ? t('siteStorage.unknown') : size(site.databaseBytes),
              })}</span
            >
          </div>
          <Button size="sm" disabled={busy} onclick={() => clear(site.domain)}>{t('siteStorage.clear')}</Button>
        </li>
      {:else}<li class="hint">{t('siteStorage.empty')}</li>{/each}
    </ul>
    <div class="pagination">
      <span class="hint">{t('siteStorage.total', { count: view.total })}</span>
      <Button size="sm" disabled={busy || view.offset === 0} onclick={() => refresh(Math.max(0, view!.offset - 20))}
        >{t('siteStorage.previous')}</Button
      >
      <Button size="sm" disabled={busy || !view.more} onclick={() => refresh(view!.offset + 20)}
        >{t('siteStorage.next')}</Button
      >
    </div>
  {/if}
</section>

<style>
  p {
    margin: 4px 0 8px;
  }
  form,
  .pagination {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
  }
  form :global(input) {
    flex: 1;
    min-width: 0;
  }
  .pagination span {
    flex: 1;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  li > div {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
