import { ipcMain, type WebContents } from 'electron';
import { WorkspaceChannel } from '../../shared/workspaces.js';
import { isLibraryFrame } from './reading-list-handlers.js';
import type { WorkspaceStore } from './workspaces.js';
import type { SavedWindow } from '../tabs/persistence.js';
interface Host {
  store: WorkspaceStore;
  owned(contents: WebContents): boolean;
  writable(contents: WebContents): boolean;
  snapshot(contents: WebContents): SavedWindow | null;
  open(window: SavedWindow): void;
  changed(): void;
}
export function installWorkspaceHandlers(host: Host): void {
  const permitted = (event: import('electron').IpcMainInvokeEvent) =>
    isLibraryFrame(event, 'workspaces') && host.owned(event.sender);
  ipcMain.handle(WorkspaceChannel.list, (event) =>
    permitted(event) ? { entries: host.store.list(), writable: host.writable(event.sender) } : null,
  );
  ipcMain.handle(WorkspaceChannel.save, (event, name: unknown) => {
    if (!permitted(event) || !host.writable(event.sender)) return false;
    const snapshot = host.snapshot(event.sender);
    const saved = !!snapshot && host.store.save(name, snapshot);
    if (saved) host.changed();
    return saved;
  });
  const validId = (id: unknown): id is string => typeof id === 'string' && id.length <= 128;
  ipcMain.handle(WorkspaceChannel.open, (event, id: unknown) => {
    if (!permitted(event) || !host.writable(event.sender) || !validId(id)) return false;
    const window = host.store.open(id);
    if (!window) return false;
    host.open(window);
    return true;
  });
  ipcMain.handle(WorkspaceChannel.rename, (event, id: unknown, name: unknown) => {
    if (!permitted(event) || !host.writable(event.sender) || !validId(id)) return false;
    const saved = host.store.rename(id, name);
    if (saved) host.changed();
    return saved;
  });
  ipcMain.handle(WorkspaceChannel.remove, (event, id: unknown) => {
    if (!permitted(event) || !host.writable(event.sender) || !validId(id)) return false;
    const saved = host.store.remove(id);
    if (saved) host.changed();
    return saved;
  });
}
