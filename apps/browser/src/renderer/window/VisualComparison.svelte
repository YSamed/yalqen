<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import { isDevelopmentHost } from '../../shared/hosts';
  import type { TabSnapshot } from '../../shared/types';
  import type {
    VisualComparisonApi,
    VisualComparisonFrame,
    VisualComparisonPreview,
    VisualComparisonReview,
    VisualComparisonStage,
  } from '../../shared/visual-comparison';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';

  let {
    activeTab,
    developer = false,
    disabled = false,
    onreview,
    onclose,
  }: {
    activeTab: TabSnapshot | null;
    developer?: boolean;
    disabled?: boolean;
    onreview(review: VisualComparisonReview): Promise<boolean>;
    onclose?: () => void;
  } = $props();

  const api: VisualComparisonApi = window.yalqen;
  let comparison: VisualComparisonPreview | null = $state.raw(null);
  let loading = $state(true);
  let pending = $state<VisualComparisonStage | 'review' | 'clear' | null>(null);
  let error = $state('');
  let reviewed = $state(false);
  let mode = $state<'side-by-side' | 'slider'>('side-by-side');
  let split = $state(50);
  let destroyed = false;
  const sliderId = $props.id();
  const ready = $derived(!loading && !pending);
  const captureAllowed = $derived(
    Boolean(
      activeTab &&
      activeTab.agentObserved &&
      (!activeTab.isPrivate || developer) &&
      !activeTab.loading &&
      localPage(activeTab.url),
    ),
  );
  const baselineMatches = $derived.by(() =>
    Boolean(
      comparison && activeTab && activeTab.id === comparison.before.tabId && activeTab.url === comparison.before.url,
    ),
  );

  function localPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && isDevelopmentHost(parsed.hostname);
    } catch {
      return false;
    }
  }

  function errorText(value: unknown): string {
    const code = String(value).match(/visual-comparison:([\w-]+)/)?.[1];
    if (code === 'navigation') return t('visualComparison.navigationError');
    if (code === 'viewport') return t('visualComparison.viewportError');
    if (code === 'scope' || code === 'unavailable') return t('visualComparison.localHint');
    if (code === 'too-large') return t('visualComparison.sizeError');
    if (code === 'stale') return t('visualComparison.staleError');
    return t('visualComparison.captureError');
  }

  function timeOf(frame: VisualComparisonFrame): string {
    return new Date(frame.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function capture(stage: VisualComparisonStage): Promise<void> {
    if (!activeTab || !ready || !captureAllowed) return;
    pending = stage;
    error = '';
    reviewed = false;
    try {
      const next = await api.captureVisualComparison(stage, activeTab.id);
      if (!destroyed) {
        comparison = next;
        split = 50;
      }
    } catch (value) {
      if (!destroyed) error = errorText(value);
    } finally {
      if (!destroyed) pending = null;
    }
  }

  async function clear(): Promise<void> {
    if (!ready) return;
    pending = 'clear';
    error = '';
    try {
      await api.clearVisualComparison();
      if (!destroyed) {
        comparison = null;
        reviewed = false;
      }
    } catch {
      if (!destroyed) error = t('visualComparison.captureError');
    } finally {
      if (!destroyed) pending = null;
    }
  }

  async function review(): Promise<void> {
    if (!ready || disabled || !comparison?.after || !baselineMatches || !captureAllowed) return;
    pending = 'review';
    error = '';
    try {
      const request = await api.getVisualComparisonReview();
      if (destroyed) return;
      if (!request) {
        error = t('visualComparison.reviewError');
        return;
      }
      const before = comparison.before;
      const after = comparison.after;
      const accepted = await onreview({
        ...request,
        text: t('visualComparison.reviewPrompt', {
          title: before.title,
          url: before.url,
          width: before.viewport.width,
          height: before.viewport.height,
          scale: before.viewport.deviceScaleFactor,
          before: new Date(before.capturedAt).toISOString(),
          after: new Date(after.capturedAt).toISOString(),
        }),
      });
      if (!destroyed) {
        reviewed = accepted;
        if (!accepted) error = t('visualComparison.reviewError');
      }
    } catch (value) {
      if (!destroyed) error = errorText(value);
    } finally {
      if (!destroyed) pending = null;
    }
  }

  onMount(() => {
    void api
      .getVisualComparison()
      .then((value) => {
        if (!destroyed) comparison = value;
      })
      .catch(() => {
        if (!destroyed) error = t('visualComparison.captureError');
      })
      .finally(() => {
        if (!destroyed) loading = false;
      });
    return () => {
      destroyed = true;
    };
  });
</script>

<section class="visual-comparison" aria-label={t('visualComparison.title')} aria-busy={loading || Boolean(pending)}>
  <header>
    <strong>{t('visualComparison.title')}</strong>
    <div class="header-actions">
      {#if comparison}
        <IconButton icon="trash" label={t('visualComparison.clear')} disabled={!ready} onclick={() => void clear()} />
      {/if}
      {#if onclose}<IconButton icon="close" label={t('visualComparison.close')} onclick={onclose} />{/if}
    </div>
  </header>
  <p class="hint">
    {comparison ? t('visualComparison.afterHint') : t('visualComparison.beforeHint')}
  </p>
  <div class="capture-actions">
    <Button
      class="capture-before"
      variant="tonal"
      icon="image"
      disabled={!ready || !captureAllowed}
      onclick={() => void capture('before')}
      >{pending === 'before'
        ? t('visualComparison.capturing')
        : comparison
          ? t('visualComparison.replaceBefore')
          : t('visualComparison.saveBefore')}</Button
    >
    <Button
      class="capture-after"
      variant="tonal"
      icon="image"
      disabled={!ready || !captureAllowed || !baselineMatches}
      onclick={() => void capture('after')}
      >{pending === 'after' ? t('visualComparison.capturing') : t('visualComparison.captureAfter')}</Button
    >
  </div>
  {#if !captureAllowed}
    <p class="hint status" role="status">{t('visualComparison.localHint')}</p>
  {:else if comparison && !baselineMatches}
    <div class="return-tab">
      <p class="hint">{t('visualComparison.returnHint')}</p>
      <Button
        size="sm"
        icon="globe"
        onclick={() => window.yalqen.send({ type: 'activate-tab', id: comparison!.before.tabId })}
        >{t('visualComparison.returnTab')}</Button
      >
    </div>
  {/if}
  {#if comparison}
    <div class="comparison-context">
      <span class="page-title" title={comparison.before.url}>{comparison.before.title || comparison.before.url}</span>
      <span>{comparison.before.viewport.width} × {comparison.before.viewport.height}</span>
    </div>
    {#if comparison.after}
      <div class="preview-controls">
        <SegmentedControl
          label={t('visualComparison.previewMode')}
          options={[
            { value: 'side-by-side' as const, label: t('visualComparison.sideBySide') },
            { value: 'slider' as const, label: t('visualComparison.slider') },
          ]}
          value={mode}
          onchange={(value) => (mode = value)}
        />
      </div>
    {/if}
    {#if comparison.after && mode === 'slider'}
      <div class="frame-labels">
        <span>{t('visualComparison.after')} · {timeOf(comparison.after)}</span>
        <span>{t('visualComparison.before')} · {timeOf(comparison.before)}</span>
      </div>
      <div class="slider-preview">
        <img src={comparison.before.dataUrl} alt={t('visualComparison.beforeAlt')} draggable="false" />
        <img
          class="after-overlay"
          src={comparison.after.dataUrl}
          alt={t('visualComparison.afterAlt')}
          draggable="false"
          style:clip-path={`inset(0 ${100 - split}% 0 0)`}
        />
        <span class="divider" style:left={`${split}%`} aria-hidden="true"></span>
      </div>
      <label class="slider-label" for={sliderId}>{t('visualComparison.sliderPosition')}</label>
      <input id={sliderId} class="comparison-slider" type="range" min="0" max="100" bind:value={split} />
    {:else}
      <div class="frames" class:paired={Boolean(comparison.after)}>
        <figure>
          <figcaption>{t('visualComparison.before')} <span>{timeOf(comparison.before)}</span></figcaption>
          <img src={comparison.before.dataUrl} alt={t('visualComparison.beforeAlt')} draggable="false" />
        </figure>
        {#if comparison.after}
          <figure>
            <figcaption>{t('visualComparison.after')} <span>{timeOf(comparison.after)}</span></figcaption>
            <img src={comparison.after.dataUrl} alt={t('visualComparison.afterAlt')} draggable="false" />
          </figure>
        {/if}
      </div>
    {/if}
    {#if comparison.after}
      <Button
        class="review-comparison"
        variant="primary"
        disabled={!ready || disabled || !baselineMatches || !captureAllowed}
        onclick={() => void review()}
        >{pending === 'review' ? t('visualComparison.reviewing') : t('visualComparison.askReview')}</Button
      >
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if reviewed}<p class="hint status" role="status">{t('visualComparison.reviewSent')}</p>{/if}
</section>

<style>
  .visual-comparison {
    flex: none;
    max-height: min(440px, 45vh);
    overflow: auto;
    margin: 0 var(--ai-gutter) 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--ai-radius);
    background: var(--surface);
    font-size: var(--ai-small);
  }
  header,
  .header-actions,
  .capture-actions,
  .comparison-context,
  .frame-labels,
  figcaption {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  header {
    justify-content: space-between;
    min-height: 24px;
  }
  header strong {
    font-size: var(--ai-text);
    font-weight: 600;
  }
  .hint,
  .error {
    margin: 6px 0 10px;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .error {
    color: var(--warn);
  }
  .capture-actions {
    flex-wrap: wrap;
  }
  .status {
    margin-bottom: 0;
  }
  .return-tab {
    margin-top: 8px;
  }
  .return-tab .hint {
    margin-bottom: 2px;
  }
  .comparison-context {
    justify-content: space-between;
    min-width: 0;
    margin: 12px 0 8px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  .comparison-context > span:last-child {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .page-title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .preview-controls {
    display: flex;
    margin-bottom: 8px;
  }
  .frames {
    display: grid;
    gap: 8px;
  }
  .frames.paired {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  figure {
    min-width: 0;
    margin: 0;
  }
  figcaption,
  .frame-labels {
    justify-content: space-between;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 6px;
  }
  .slider-preview {
    position: relative;
    overflow: hidden;
    border-radius: 6px;
  }
  .after-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .divider {
    position: absolute;
    inset-block: 0;
    width: 2px;
    transform: translateX(-1px);
    background: var(--accent);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 15%);
    pointer-events: none;
  }
  .slider-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .comparison-slider {
    display: block;
    width: 100%;
    margin: 10px 0 0;
    accent-color: var(--accent);
  }
  .visual-comparison :global(.review-comparison) {
    width: 100%;
    margin-top: 12px;
  }
</style>
