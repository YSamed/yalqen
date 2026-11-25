<script lang="ts">
  import { getLocale, t } from '../../shared/i18n';
  import { dayLabel, timeAgo } from '../../shared/relative-time';
  import type { CommandBarAction } from '../../shared/types';
  import type { AgentChatSession } from '../../shared/agent';
  import Icon from '../ui/Icon.svelte';

  let {
    chats,
    query,
    onaction,
  }: { chats: AgentChatSession[]; query: string; onaction: (action: CommandBarAction) => void } = $props();

  const locale = getLocale();
  const needle = $derived(query.trim().toLocaleLowerCase());
  const groups = $derived.by(() => {
    const result: { day: string; items: AgentChatSession[] }[] = [];
    for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (needle && !chat.title.toLocaleLowerCase().includes(needle)) continue;
      const day = dayLabel(chat.updatedAt, locale);
      if (result.at(-1)?.day === day) result.at(-1)!.items.push(chat);
      else result.push({ day, items: [chat] });
    }
    return result;
  });
</script>

{#each groups as { day, items } (day)}
  <h3 class="heading">{day}</h3>
  {#each items as chat (chat.id)}
    <button type="button" class="item chat" onclick={() => onaction({ type: 'open-chat', id: chat.id })}>
      <span class="thumb"><Icon name="sparkle" size={16} /></span>
      <span class="text">
        <span class="label">{chat.title}</span>
        <small>{timeAgo(chat.updatedAt, locale)}</small>
      </span>
    </button>
  {/each}
{:else}
  <p class="empty">{needle ? t('sidebarMenu.noResults') : t('sidebarMenu.noChats')}</p>
{/each}

<style>
  .item.chat {
    gap: 14px;
    height: 62px;
    padding: 0 10px;
    border-radius: 10px;
  }

  .thumb {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    background: var(--menu-hover);
    box-shadow: inset 0 0 0 0.5px var(--menu-line);
    color: var(--text-muted);
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .text .label {
    font-weight: 600;
  }

  small {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
  }
</style>
