<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import { isDevelopmentHost } from '../../shared/hosts';
  import type { TabSnapshot } from '../../shared/types';
  import type {
    ResponsiveScanFinding,
    ResponsiveScanPreview,
    ResponsiveScanReview,
  } from '../../shared/responsive-scan';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';

  let {
    activeTab,
    developer,
    disabled = false,
    onreview,
  }: {
    activeTab: TabSnapshot | null;
    developer: boolean;
    disabled?: boolean;
    onreview(review: ResponsiveScanReview): Promise<boolean>;
  } = $props();

  let scan: ResponsiveScanPreview | null = $state.raw(null);
  let loading = $state(true);
  let scanning = $state(false);
  let pending = $state<'cancel' | 'clear' | 'review' | null>(null);
  let selected = $state<'mobile' | 'tablet' | 'desktop'>('mobile');
  let error = $state('');
  let reviewed = $state(false);
  let destroyed = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const frame = $derived.by(
    () => scan?.frames.find((item) => item.viewport.id === selected) ?? scan?.frames[0] ?? null,
  );
  const running = $derived.by(() => scanning || scan?.status === 'running');
  const local = $derived.by(() => {
    if (!activeTab?.agentObserved || (activeTab.isPrivate && !developer) || activeTab.loading) return false;
    try {
      const url = new URL(activeTab.url);
      return ['http:', 'https:'].includes(url.protocol) && isDevelopmentHost(url.hostname);
    } catch {
      return false;
    }
  });
  const matches = $derived.by(() =>
    Boolean(scan && activeTab && activeTab.id === scan.tabId && activeTab.url === scan.url),
  );
  const ready = $derived(!loading && !running && !pending);
  const issues = $derived(
    frame ? Math.max(frame.measurements.findings.length, frame.measurements.horizontalOverflow > 2 ? 1 : 0) : 0,
  );

  function errorText(value: unknown): string {
    const code = String(value).match(/responsive-scan:([\w-]+)/)?.[1] ?? String(value);
    if (code === 'scope' || code === 'unavailable') return t('visualComparison.localHint');
    if (code === 'navigation' || code === 'stale') return t('responsiveScan.navigationError');
    if (code === 'viewport') return t('responsiveScan.viewportError');
    if (code === 'restore') return t('responsiveScan.restoreError');
    if (code === 'cancelled') return t('responsiveScan.cancelled');
    if (code === 'timeout') return t('responsiveScan.timeoutError');
    if (code === 'busy') return t('responsiveScan.busyError');
    return t('responsiveScan.captureError');
  }

  function findingLabel(finding: ResponsiveScanFinding): string {
    if (finding.kind === 'horizontal-overflow') return t('responsiveScan.horizontalOverflow');
    if (finding.kind === 'clipped-text') return t('responsiveScan.clippedText');
    return t('responsiveScan.offscreenControl');
  }

  function stopPolling(): void {
    clearInterval(poll);
    poll = undefined;
  }

  function startPolling(): void {
    if (poll) return;
    poll = setInterval(() => {
      if (polling || destroyed) return;
      polling = true;
      void window.yalqen
        .getResponsiveScan()
        .then((value) => {
          if (!destroyed && value) {
            scan = value;
            if (value.status !== 'running') stopPolling();
          }
        })
        .catch(() => undefined)
        .finally(() => (polling = false));
    }, 500);
  }

  async function run(): Promise<void> {
    if (!activeTab || !ready || !local || disabled) return;
    scanning = true;
    error = '';
    reviewed = false;
    scan = null;
    selected = 'mobile';
    startPolling();
    try {
      const result = await window.yalqen.runResponsiveScan(activeTab.id);
      if (!destroyed) {
        scan = result;
        if (result.error) error = errorText(result.error);
      }
    } catch (value) {
      if (!destroyed) error = errorText(value);
    } finally {
      stopPolling();
      if (!destroyed) scanning = false;
    }
  }

  async function cancel(): Promise<void> {
    if (!running || pending) return;
    pending = 'cancel';
    try {
      await window.yalqen.cancelResponsiveScan();
      const result = await window.yalqen.getResponsiveScan();
      if (!destroyed) {
        scan = result;
        error = result?.error ? errorText(result.error) : '';
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
    try {
      await window.yalqen.clearResponsiveScan();
      if (!destroyed) {
        scan = null;
        error = '';
        reviewed = false;
      }
    } catch (value) {
      if (!destroyed) error = errorText(value);
    } finally {
      if (!destroyed) pending = null;
    }
  }

  async function review(): Promise<void> {
    if (!ready || disabled || !matches || !local || scan?.status !== 'ready') return;
    pending = 'review';
    error = '';
    try {
      const request = await window.yalqen.getResponsiveScanReview();
      if (destroyed) return;
      if (!request) throw new Error('Unavailable');
      const accepted = await onreview({
        ...request,
        text: t('responsiveScan.reviewPrompt', { context: request.text }),
      });
      if (!destroyed) {
        reviewed = accepted;
        if (!accepted) error = t('browserChecks.sendError');
      }
    } catch (value) {
      if (!destroyed) error = errorText(value);
    } finally {
      if (!destroyed) pending = null;
    }
  }

  onMount(() => {
    void window.yalqen
      .getResponsiveScan()
      .then((value) => {
        if (!destroyed) {
          scan = value;
          if (value?.error) error = errorText(value.error);
          if (value?.status === 'running') startPolling();
        }
      })
      .catch((value) => {
        if (!destroyed) error = errorText(value);
      })
      .finally(() => {
        if (!destroyed) loading = false;
      });
    return () => {
      destroyed = true;
      stopPolling();
      if (running) void window.yalqen.cancelResponsiveScan().catch(() => undefined);
    };
  });
</script>

<div class="responsive-scan" aria-busy={loading || running || Boolean(pending)}>
  <p class="hint">{t('responsiveScan.hint')}</p>
  <div class="actions">
    <Button variant="tonal" icon="play" disabled={!ready || !local || disabled} onclick={() => void run()}>
      {running ? `${t('responsiveScan.running')} ${scan?.frames.length ?? 0}/3` : t('responsiveScan.run')}
    </Button>
    {#if running}
      <Button icon="stop" disabled={Boolean(pending)} onclick={() => void cancel()}>{t('responsiveScan.cancel')}</Button
      >
    {:else if scan}
      <IconButton icon="trash" label={t('responsiveScan.clear')} disabled={!ready} onclick={() => void clear()} />
    {/if}
  </div>
  {#if !local}<p class="hint" role="status">{t('visualComparison.localHint')}</p>{/if}
  {#if scan && !matches && !running}
    <p class="hint">{t('responsiveScan.returnHint')}</p>
    <Button size="sm" icon="globe" onclick={() => window.yalqen.send({ type: 'activate-tab', id: scan!.tabId })}>
      {t('visualComparison.returnTab')}
    </Button>
  {/if}
  {#if scan?.frames.length}
    <SegmentedControl
      label={t('browserChecks.responsive')}
      options={scan.frames.map((item) => ({ value: item.viewport.id, label: t(`responsiveScan.${item.viewport.id}`) }))}
      value={frame?.viewport.id ?? selected}
      onchange={(value) => (selected = value)}
    />
  {/if}
  {#if frame}
    <figure>
      <figcaption>{frame.viewport.width} × {frame.viewport.height}</figcaption>
      <img
        src={frame.dataUrl}
        alt={t('responsiveScan.frameAlt', { width: frame.viewport.width, height: frame.viewport.height })}
      />
    </figure>
    {#if frame.measurements.horizontalOverflow > 2}
      <p class="hint">
        {t('responsiveScan.overflow', {
          width: frame.measurements.documentWidth,
          overflow: frame.measurements.horizontalOverflow,
        })}
      </p>
    {/if}
    {#if issues}
      <details open>
        <summary>{t('responsiveScan.findings', { count: issues })}</summary>
        <ul>
          {#each frame.measurements.findings as finding, index (index)}
            <li>
              <span>{findingLabel(finding)}</span><code>{finding.selector}</code>{#if finding.label}<span class="hint"
                  >{finding.label}</span
                >{/if}
            </li>
          {/each}
        </ul>
      </details>
    {:else}
      <p class="hint">{t('responsiveScan.noFindings')}</p>
    {/if}
    {#if frame.measurements.truncated}<p class="hint">{t('responsiveScan.truncated')}</p>{/if}
    <p class="hint">{t('responsiveScan.limitHint')}</p>
  {/if}
  {#if scan?.status === 'ready'}
    <Button
      variant="tonal"
      icon="sparkle"
      disabled={!ready || disabled || !matches || !local}
      onclick={() => void review()}
    >
      {pending === 'review' ? t('visualComparison.reviewing') : t('responsiveScan.review')}
    </Button>
  {/if}
  {#if reviewed}<p class="hint" role="status">{t('responsiveScan.reviewSent')}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .responsive-scan {
    display: grid;
    gap: 10px;
    margin-top: 10px;
    min-width: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .hint,
  .error {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--warn);
  }
  figure {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  img {
    display: block;
    width: 100%;
    max-height: 190px;
    object-fit: contain;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-sizing: border-box;
  }
  summary {
    cursor: pointer;
    font-size: var(--ai-small);
  }
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ul {
    display: grid;
    gap: 8px;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 3px;
    font-size: var(--ai-meta);
  }
  code {
    color: var(--text-muted);
    overflow-wrap: anywhere;
    font-size: var(--ai-meta);
  }
</style>
