import { type CommandBarAction, type SidebarMenu, type SidebarMenuCommand } from './types.js';

export type SidebarMenuAction = Extract<
  CommandBarAction,
  { type: 'sidebar-command' | 'switch-space' | 'open-chat' | 'switch-tab' | 'open-link' }
>;

// The overlay is a separate renderer, so only the commands and ids the open menu offered are accepted.
export function sidebarMenuAction(action: unknown, menu: SidebarMenu | undefined): SidebarMenuAction | null {
  if (!menu || typeof action !== 'object' || action === null) return null;
  const { type, id, command } = action as Record<string, unknown>;
  if (type === 'sidebar-command') {
    return menu.commands.includes(command as SidebarMenuCommand)
      ? { type, command: command as SidebarMenuCommand }
      : null;
  }
  if (type === 'open-link') {
    const { url } = action as Record<string, unknown>;
    return [...menu.history, ...menu.bookmarks].some((link) => link.url === url) ? { type, url: url as string } : null;
  }
  if (typeof id !== 'string') return null;
  if (type === 'switch-space') return menu.spaces.some((space) => space.id === id) ? { type, id } : null;
  if (type === 'open-chat') return menu.chats.some((chat) => chat.id === id) ? { type, id } : null;
  if (type === 'switch-tab') return menu.tabs.some((tab) => tab.id === id) ? { type, id } : null;
  return null;
}
