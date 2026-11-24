<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../../shared/i18n';
  import { isDevelopmentHost } from '../../shared/hosts';
  import type { TabSnapshot } from '../../shared/types';
  import type { VisualComparisonReview } from '../../shared/visual-comparison';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import ResponsiveScan from './ResponsiveScan.svelte';

  let {
    activeTab,
    developer,
    disabled = false,
    flowDisabled = false,
    onrequest,
    onclose,
  }: {
    activeTab: TabSnapshot | null;
    developer: boolean;
    disabled?: boolean;
    flowDisabled?: boolean;
    onrequest(request: VisualComparisonReview): Promise<boolean>;
    onclose(): void;
  } = $props();

  let mode = $state<'flow' | 'responsive'>('flow');
  let scenario = $state('');
  let expected = $state('');
  let pending = $state(false);
  let sent = $state(false);
  let error = $state('');
  let destroyed = false;
  const fieldId = $props.id();
  const local = $derived.by(() => {
    if (!activeTab?.agentObserved || (activeTab.isPrivate && !developer) || activeTab.loading) return false;
    try {
      const url = new URL(activeTab.url);
      return ['http:', 'https:'].includes(url.protocol) && isDevelopmentHost(url.hostname);
    } catch {
      return false;
    }
  });

  async function verify(): Promise<void> {
    if (!activeTab || !local || disabled || flowDisabled || pending || !scenario.trim() || !expected.trim()) return;
    pending = true;
    sent = false;
    error = '';
    const tab = activeTab;
    try {
      const accepted = await onrequest({
        tabId: tab.id,
        images: [],
        text: t('browserChecks.flowPrompt', {
          tab: tab.id,
          url: JSON.stringify(tab.url),
          scenario: scenario.trim(),
          expected: expected.trim(),
        }),
      });
      if (!destroyed) {
        sent = accepted;
        if (!accepted) error = t('browserChecks.sendError');
      }
    } catch {
      if (!destroyed) error = t('browserChecks.sendError');
    } finally {
      if (!destroyed) pending = false;
    }
  }
  onDestroy(() => (destroyed = true));
</script>

<section class="browser-checks" aria-label={t('browserChecks.title')}>
  <header>
    <strong>{t('browserChecks.title')}</strong>
    <IconButton icon="close" label={t('browserChecks.close')} onclick={onclose} />
  </header>
  <SegmentedControl
    label={t('browserChecks.mode')}
    options={[
      { value: 'flow' as const, label: t('browserChecks.flow') },
      { value: 'responsive' as const, label: t('browserChecks.responsive') },
    ]}
    value={mode}
    onchange={(value) => (mode = value)}
  />
  {#if mode === 'flow'}
    <form
      class="flow-form"
      onsubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <p class="hint">{t('browserChecks.flowHint')}</p>
      <label for="{fieldId}-scenario">{t('browserChecks.scenario')}</label>
      <textarea
        id="{fieldId}-scenario"
        bind:value={scenario}
        placeholder={t('browserChecks.scenarioPlaceholder')}
        rows="2"
        maxlength="4000"
        required
        disabled={pending}
        oninput={() => (sent = false)}></textarea>
      <label for="{fieldId}-expected">{t('browserChecks.expected')}</label>
      <textarea
        id="{fieldId}-expected"
        bind:value={expected}
        placeholder={t('browserChecks.expectedPlaceholder')}
        rows="2"
        maxlength="2000"
        required
        disabled={pending}
        oninput={() => (sent = false)}></textarea>
      {#if !local}<p class="hint" role="status">{t('visualComparison.localHint')}</p>{/if}
      {#if flowDisabled}<p class="hint" role="status">{t('browserChecks.reviewModeHint')}</p>{/if}
      <Button
        type="submit"
        variant="tonal"
        icon="play"
        disabled={!local || disabled || flowDisabled || pending || !scenario.trim() || !expected.trim()}
        >{pending ? t('visualComparison.reviewing') : t('browserChecks.runFlow')}</Button
      >
      {#if sent}<p class="hint" role="status">{t('browserChecks.flowSent')}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </form>
  {:else}
    <ResponsiveScan {activeTab} {developer} {disabled} onreview={onrequest} />
  {/if}
</section>

<style>
  .browser-checks {
    flex: none;
    max-height: 55%;
    margin: 0 var(--ai-gutter) 8px;
    padding: 10px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    scrollbar-width: thin;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  strong,
  label {
    font-size: var(--ai-small);
  }
  .flow-form {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
  .hint,
  .error {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    line-height: 1.5;
  }
  .error {
    color: var(--warn);
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 54px;
    padding: 8px;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-strong);
    color: var(--text);
    font: inherit;
    font-size: var(--ai-small);
  }
  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
