import type { AgentChatCommand } from '../../shared/agent';
import { MAX_CHAT_TABS } from '../../shared/agent-panel';
import type { ComposerTrigger } from '../../shared/composer-trigger';
import type { TabSnapshot } from '../../shared/types';
import type { ComposerSuggestion } from './ComposerSuggestions.svelte';

const MAX_SUGGESTIONS = 8;

export type ComposerPick = ComposerSuggestion & { insert: string | null };

export function composerSuggestions(
  trigger: ComposerTrigger,
  commands: AgentChatCommand[],
  attachments: TabSnapshot[],
  tabs: TabSnapshot[],
  files: string[],
): ComposerPick[] {
  const query = trigger.query.toLowerCase();
  if (trigger.kind === 'command')
    return commands
      .filter((command) => command.name.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS)
      .map((command) => ({
        key: `command:${command.name}`,
        label: `/${command.name}`,
        detail: command.argumentHint ? `${command.argumentHint} · ${command.description}` : command.description,
        icon: 'code',
        insert: `/${command.name}`,
      }));
  const tabPicks: ComposerPick[] =
    attachments.length < MAX_CHAT_TABS
      ? tabs
          .filter((item) => !attachments.some((attached) => attached.id === item.id))
          .filter((item) => item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
          .map((item) => ({
            key: `tab:${item.id}`,
            label: item.title || item.url,
            detail: item.url,
            icon: 'globe',
            insert: null,
          }))
      : [];
  const filePicks: ComposerPick[] = files.map((file) => ({
    key: `file:${file}`,
    label: file,
    detail: '',
    icon: 'folder',
    insert: `@${file}`,
  }));
  return [...tabPicks, ...filePicks].slice(0, MAX_SUGGESTIONS);
}
