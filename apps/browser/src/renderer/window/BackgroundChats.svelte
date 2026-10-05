<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { AgentBackgroundChat } from '../../shared/types';
  import IconButton from '../ui/IconButton.svelte';

  let { chats }: { chats: AgentBackgroundChat[] } = $props();

  const working = (chat: AgentBackgroundChat) => ['starting', 'thinking', 'approval'].includes(chat.status);

  function statusOf(chat: AgentBackgroundChat): string {
    if (chat.status === 'approval') return t('backgroundChats.waiting');
    if (working(chat)) return t('backgroundChats.working');
    if (chat.status === 'error') return t('backgroundChats.failed');
    return t('backgroundChats.done');
  }
</script>

<ul class="background" aria-label={t('backgroundChats.label')}>
  {#each chats as chat (chat.id)}
    <li class="chat">
      <button
        type="button"
        title={chat.title}
        onclick={() => void window.yalqen.showBackgroundAgentChat(chat.id).catch(() => false)}
      >
        <span class="dot" class:active={working(chat)} class:waiting={chat.status === 'approval'}></span>
        <span class="title">{chat.title || t('backgroundChats.untitled')}</span>
        <span class="state">{statusOf(chat)}</span>
      </button>
      <IconButton
        size="sm"
        icon="folder"
        label={t('backgroundChats.continueIn')}
        onclick={() => void window.yalqen.continueAgentChatInProject(chat.id).catch(() => false)}
      />
      <IconButton
        size="sm"
        icon="new-tab"
        label={t('backgroundChats.openInTab')}
        onclick={() => void window.yalqen.openBackgroundAgentChatInTab(chat.id).catch(() => false)}
      />
      {#if !working(chat)}
        <IconButton
          size="sm"
          icon="close"
          label={t('backgroundChats.dismiss')}
          onclick={() => void window.yalqen.dismissBackgroundAgentChat(chat.id).catch(() => false)}
        />
      {/if}
    </li>
  {/each}
</ul>

<style>
  .background {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0 var(--ai-gutter) 8px;
    list-style: none;
  }

  .chat {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    border-radius: 8px;
    background: var(--surface);
  }

  .chat button {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 10px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: var(--ai-small);
    text-align: left;
    cursor: pointer;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    flex: none;
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .dot.active {
    background: var(--accent);
  }

  .dot.waiting {
    background: var(--warn);
  }
</style>
