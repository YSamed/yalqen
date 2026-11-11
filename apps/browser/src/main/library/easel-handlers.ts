import { ipcMain, webContents, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { EASELS_URL, EaselChannel, type EaselClip } from '../../shared/easels.js';
import { isLibraryFrame } from './reading-list-handlers.js';
import type { EaselStore } from './easels.js';

interface Host {
  store: EaselStore;
  owned(contents: WebContents): boolean;
  writable(contents: WebContents): boolean;
  defaultName: () => string;
}

const validId = (id: unknown): id is string => typeof id === 'string' && id.length <= 128;

export function installEasels(host: Host): { clip(clip: Omit<EaselClip, 'id' | 'kind' | 'x' | 'y'>): string | null } {
  const changed = () => {
    for (const contents of webContents.getAllWebContents())
      if (!contents.isDestroyed() && contents.getURL().startsWith(EASELS_URL)) contents.send(EaselChannel.changed);
  };
  const committed = <T>(result: T): T => {
    if (result) changed();
    return result;
  };
  const read = (event: IpcMainInvokeEvent) => isLibraryFrame(event, 'easels') && host.owned(event.sender);
  const write = (event: IpcMainInvokeEvent) => read(event) && host.writable(event.sender);
  ipcMain.handle(EaselChannel.list, (event) =>
    read(event) ? { easels: host.store.list(), writable: host.writable(event.sender) } : null,
  );
  ipcMain.handle(EaselChannel.open, (event, id: unknown) => (read(event) && validId(id) ? host.store.get(id) : null));
  ipcMain.handle(
    EaselChannel.create,
    (event, name: unknown) => (write(event) && committed(host.store.create(name))?.id) || null,
  );
  ipcMain.handle(
    EaselChannel.rename,
    (event, id: unknown, name: unknown) => write(event) && validId(id) && committed(host.store.rename(id, name)),
  );
  ipcMain.handle(
    EaselChannel.remove,
    (event, id: unknown) => write(event) && validId(id) && committed(host.store.remove(id)),
  );
  ipcMain.handle(
    EaselChannel.add,
    (event, id: unknown, item: unknown) => (write(event) && validId(id) && host.store.add(id, item)) || null,
  );
  ipcMain.handle(
    EaselChannel.patch,
    (event, id: unknown, itemId: unknown, patch: unknown) =>
      write(event) && validId(id) && validId(itemId) && host.store.patch(id, itemId, patch),
  );
  ipcMain.handle(
    EaselChannel.removeItem,
    (event, id: unknown, itemId: unknown) =>
      write(event) && validId(id) && validId(itemId) && host.store.removeItem(id, itemId),
  );
  return {
    clip: (clip) => {
      const added = host.store.clip(clip, host.defaultName());
      if (added) changed();
      return added?.easel.name ?? null;
    },
  };
}
