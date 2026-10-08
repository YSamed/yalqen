import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { READING_LIST_URL, ReadingListChannel } from '../../shared/reading-list.js';
import type { ReadingListStore } from './reading-list.js';

export function isReadingListFrame(event: IpcMainInvokeEvent): boolean {
  if (event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame!.url);
    return url.protocol === 'yalqen:' && url.host === 'reading-list' && url.pathname === '/';
  } catch {
    return false;
  }
}
interface Host {
  store: ReadingListStore;
  owned(contents: WebContents): boolean;
  writable(contents: WebContents): boolean;
  changed(): void;
}
export function installReadingListHandlers(host: Host): void {
  const permitted = (event: IpcMainInvokeEvent) => isReadingListFrame(event) && host.owned(event.sender);
  ipcMain.handle(ReadingListChannel.list, (event, query: unknown, status: unknown) => {
    if (
      !permitted(event) ||
      typeof query !== 'string' ||
      query.length > 200 ||
      !['all', 'read', 'unread'].includes(status as string)
    )
      return null;
    return { entries: host.store.list(query, status as string), writable: host.writable(event.sender) };
  });
  ipcMain.handle(ReadingListChannel.read, (event, id: unknown, read: unknown) => {
    if (
      !permitted(event) ||
      !host.writable(event.sender) ||
      typeof id !== 'string' ||
      id.length > 128 ||
      typeof read !== 'boolean'
    )
      return false;
    const saved = host.store.setRead(id, read);
    if (saved) host.changed();
    return saved;
  });
  ipcMain.handle(ReadingListChannel.remove, (event, id: unknown) => {
    if (!permitted(event) || !host.writable(event.sender) || typeof id !== 'string' || id.length > 128) return false;
    const saved = host.store.remove(id);
    if (saved) host.changed();
    return saved;
  });
}
export function broadcastReadingList(contents: readonly WebContents[]): void {
  for (const page of contents)
    if (!page.isDestroyed() && page.getURL().startsWith(READING_LIST_URL)) page.send(ReadingListChannel.changed);
}
