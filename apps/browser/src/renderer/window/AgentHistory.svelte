<script lang="ts">
  import { onMount } from 'svelte';
  import { t, getLocale } from '../../shared/i18n';
  import type { AgentChatSession } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';

  let { onclose }: { onclose(): void } = $props();
  let sessions: AgentChatSession[] = $state.raw([]);
  let loading = $state(true);
  let failed = $state(false);
  let deleteFailed = $state(false);
  let opening = $state(false);
  let confirming: string | null = $state(null);
  const relative = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];

  function ago(time: number): string {
    const elapsed = time - Date.now();
    for (const [unit, size] of UNITS)
      if (Math.abs(elapsed) >= size || unit === 'minute') return relative.format(Math.round(elapsed / size), unit);
    return '';
  }

  async function open(session: AgentChatSession, fork: boolean): Promise<void> {
    opening = true;
    failed = false;
    try {
      if (!(await window.yalqen.openAgentChat(session.id, fork))) throw new Error('Unavailable');
      onclose();
    } catch {
      failed = true;
    } finally {
      opening = false;
    }
  }

  async function remove(session: AgentChatSession): Promise<void> {
    opening = true;
    deleteFailed = false;
    try {
      if (!(await window.yalqen.deleteAgentChat(session.id))) throw new Error('Unavailable');
      sessions = sessions.filter((item) => item.id !== session.id);
    } catch {
      deleteFailed = true;
    } finally {
      confirming = null;
      opening = false;
    }
  }

  onMount(() => {
    window.yalqen
      .listAgentChats()
      .then((list) => (sessions = list))
      .catch(() => (failed = true))
      .finally(() => (loading = false));
  });
</script>

<div class="history">
  <div class="heading">
    <h2>{t('agentChat.history')}</h2>
    <IconButton icon="close" label={t('agentChat.closeHistory')} onclick={onclose} />
  </div>
  {#if failed}<p class="note warn" role="status">{t('agentChat.historyFailed')}</p>{/if}
  {#if deleteFailed}<p class="note warn" role="status">{t('agentChat.deleteFailed')}</p>{/if}
  {#if loading}
    <p class="note">{t('agentChat.historyLoading')}</p>
  {:else if sessions.length === 0}
    <p class="note">{t('agentChat.historyEmpty')}</p>
  {:else}
    <ul>
      {#each sessions as session (session.id)}
        <li>
          <button class="open" disabled={opening} onclick={() => open(session, false)} title={t('agentChat.resume')}>
            <span class="title">{session.title}</span>
            <span class="meta">
              {ago(session.updatedAt)}{#if session.branch}<span class="branch"
                  ><Icon name="code" size={11} />{session.branch}</span
                >{/if}
            </span>
          </button>
          {#if confirming === session.id}
            <Button variant="danger" disabled={opening} onclick={() => remove(session)}
              >{t('agentChat.deleteConfirm')}</Button
            >
          {:else}
            <Button disabled={opening} title={t('agentChat.forkTitle')} onclick={() => open(session, true)}
              >{t('agentChat.fork')}</Button
            >
          {/if}
          <IconButton
            icon={confirming === session.id ? 'close' : 'trash'}
            tone="muted"
            label={confirming === session.id ? t('agentChat.cancel') : t('agentChat.deleteTitle')}
            disabled={opening}
            onclick={() => (confirming = confirming === session.id ? null : session.id)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding: 0 12px 12px;
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--control-md);
    margin-bottom: 8px;
    padding-left: 4px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 4px;
    border-radius: var(--ai-radius);
  }
  li:hover {
    background: var(--surface-hover);
  }
  .open {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
    padding: 8px 4px 8px 10px;
    border: 0;
    border-radius: var(--ai-radius);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .open:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .title {
    overflow: hidden;
    font-size: var(--ai-text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    gap: 8px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  .branch {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin: 8px 4px;
    color: var(--text-muted);
    font-size: var(--ai-small);
  }
  .warn {
    color: var(--warn);
  }
</style>
