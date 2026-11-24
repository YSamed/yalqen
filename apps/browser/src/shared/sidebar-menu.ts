import {
  isSidebarFooterItem,
  MAX_SIDEBAR_FOOTER_ITEMS,
  type CommandBarAction,
  type SidebarMenu,
  type SidebarMenuCommand,
} from './types.js';

export type SidebarMenuAction = Extract<
  CommandBarAction,
  {
    type:
      | 'sidebar-command'
      | 'switch-space'
      | 'open-space-menu'
      | 'open-chat'
      | 'switch-tab'
      | 'open-link'
      | 'download-action'
      | 'place-footer-item';
  }
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
  if (type === 'place-footer-item') {
    const { item, index } = action as Record<string, unknown>;
    return menu.footer &&
      isSidebarFooterItem(item) &&
      Number.isInteger(index) &&
      (index as number) >= 0 &&
      (index as number) < MAX_SIDEBAR_FOOTER_ITEMS
      ? { type, item, index: index as number }
      : null;
  }
  if (type === 'open-link') {
    const { url } = action as Record<string, unknown>;
    return [...menu.history, ...menu.bookmarks].some((link) => link.url === url) ? { type, url: url as string } : null;
  }
  if (typeof id !== 'string') return null;
  if (type === 'switch-space' || type === 'open-space-menu')
    return menu.spaces.some((space) => space.id === id) ? { type, id } : null;
  if (type === 'open-chat') return menu.chats.some((chat) => chat.id === id) ? { type, id } : null;
  if (type === 'switch-tab') return menu.tabs.some((tab) => tab.id === id) ? { type, id } : null;
  if (type === 'download-action') return menu.downloads.some((entry) => entry.id === id) ? { type, id } : null;
  return null;
}
