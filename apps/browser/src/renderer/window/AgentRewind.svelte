<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { AgentRewindPreview } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';

  let {
    sessionId,
    messageId,
    reverted,
    disabled,
  }: { sessionId: string; messageId: string; reverted: boolean; disabled: boolean } = $props();
  let preview = $state.raw<AgentRewindPreview | null>(null);
  let busy = $state(false);
  let failed = $state(false);
  const nothing = $derived(preview !== null && (!preview.canRewind || preview.files.length === 0));

  async function rewind(dryRun: boolean): Promise<void> {
    busy = true;
    failed = false;
    try {
      const result = await window.yalqen.rewindAgentChat(sessionId, messageId, dryRun);
      if (!result || (!dryRun && !result.canRewind)) throw new Error('Rewind failed');
      preview = dryRun ? result : null;
    } catch {
      failed = true;
      preview = null;
    } finally {
      busy = false;
    }
  }
</script>

<div class="rewind">
  {#if reverted}
    <span class="note"><Icon name="check" size={12} />{t('agentChat.reverted')}</span>
  {:else if preview && !nothing}
    <div class="confirm" role="alertdialog" aria-label={t('agentChat.revert')}>
      <p>
        {t('agentChat.revertConfirm', {
          count: preview.files.length,
          insertions: preview.insertions,
          deletions: preview.deletions,
        })}
      </p>
      <div class="actions">
        <Button size="sm" onclick={() => (preview = null)}>{t('agentChat.cancel')}</Button>
        <Button size="sm" variant="primary" disabled={busy || disabled} onclick={() => rewind(false)}
          >{t('agentChat.revert')}</Button
        >
      </div>
    </div>
  {:else}
    <Button
      size="sm"
      variant="ghost"
      icon="reload"
      title={t('agentChat.revertTitle')}
      disabled={busy || disabled}
      onclick={() => rewind(true)}>{t('agentChat.revert')}</Button
    >
    {#if nothing}<span class="note">{preview?.error ?? t('agentChat.revertNothing')}</span>{/if}
    {#if failed}<span class="note warn">{t('agentChat.revertFailed')}</span>{/if}
  {/if}
</div>

<style>
  .rewind {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 4px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  .note {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .warn {
    color: var(--warn);
  }
  .confirm {
    width: 100%;
    padding: 10px 12px;
    border-radius: var(--ai-radius);
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .confirm p {
    margin: 0 0 10px;
    color: var(--text);
    font-size: var(--ai-small);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
