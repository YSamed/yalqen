<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProcessGroupKind, ProcessUsage } from '../../shared/types';

  const REFRESH_MS = 2000;
  const GROUP_LABELS: Record<ProcessGroupKind, string> = {
    pages: 'Web sayfaları',
    interface: 'Tarayıcı arayüzü',
    extensions: 'Uzantılar',
    browser: 'Ana süreç',
    gpu: 'Grafik (GPU)',
    utility: 'Ağ ve yardımcı süreçler',
    other: 'Diğer',
  };
  const numbers = new Intl.NumberFormat('tr-TR');
  const api = window.yalqenSettings;

  let usage = $state.raw<ProcessUsage | null>(null);

  const megabytes = (value: number) => `${numbers.format(value)} MB`;

  function pageLabel(titles: string[]): string {
    return titles.length > 1 ? `${titles[0]} ve ${titles.length - 1} sekme daha` : titles[0];
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

<h2>Bellek kullanımı</h2>
{#if usage}
  <div class="row">
    <span>Toplam</span>
    <strong class="value">{megabytes(usage.totalMB)}</strong>
  </div>
  {#each usage.groups as group (group.kind)}
    <div class="row">
      <span class="label">
        <span>{GROUP_LABELS[group.kind]}</span>
        <span class="hint">{group.count} süreç</span>
      </span>
      <span class="value">{megabytes(group.memoryMB)}</span>
    </div>
  {/each}
  {#if usage.pages.length > 0}
    <h2>En çok bellek kullanan sekmeler</h2>
    {#each usage.pages as page (page.pid)}
      <div class="row">
        <span class="title" title={page.titles.join('\n')}>{pageLabel(page.titles)}</span>
        <span class="value">{megabytes(page.memoryMB)}</span>
      </div>
    {/each}
  {/if}
  <p class="hint note">
    Değerler işletim sisteminin bildirdiği çalışma kümesidir ve paylaşılan belleği de içerir; Etkinlik İzleyicisi'ndeki
    değerlerden farklı olabilir.
  </p>
{:else}
  <p class="hint note">Ölçülüyor…</p>
{/if}

<style>
  h2 {
    margin: 20px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

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
