import { app, ipcMain, webContents, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { BOOSTS_URL, BoostChannel } from '../../shared/boosts.js';
import { isLibraryFrame } from './reading-list-handlers.js';
import { boostOrigin, boostStyles, type BoostStore } from './boosts.js';

interface Host {
  store: BoostStore;
  owned(contents: WebContents): boolean;
  writable(contents: WebContents): boolean;
  styled(contents: WebContents): boolean;
}

export function installBoosts(host: Host): { hide(origin: string, selector: string): boolean } {
  const keys = new WeakMap<WebContents, string>();
  const apply = async (contents: WebContents, replace: boolean): Promise<void> => {
    const old = keys.get(contents);
    keys.delete(contents);
    if (replace && old) await contents.removeInsertedCSS(old).catch(() => {});
    if (contents.isDestroyed() || !host.styled(contents)) return;
    const origin = boostOrigin(contents.getURL()),
      boost = origin ? host.store.get(origin) : null,
      css = boost?.enabled ? boostStyles(boost) : '';
    if (css) keys.set(contents, await contents.insertCSS(css).catch(() => ''));
  };
  app.on('web-contents-created', (_event, contents) => {
    contents.on('dom-ready', () => void apply(contents, false));
  });
  const refresh = (origin: string) => {
    for (const contents of webContents.getAllWebContents())
      if (boostOrigin(contents.getURL()) === origin) void apply(contents, true);
  };
  const changed = () => {
    for (const contents of webContents.getAllWebContents())
      if (!contents.isDestroyed() && contents.getURL().startsWith(BOOSTS_URL)) contents.send(BoostChannel.changed);
  };
  const committed = (origin: unknown, saved: boolean) => {
    if (saved) {
      refresh(boostOrigin(origin)!);
      changed();
    }
    return saved;
  };
  const permitted = (event: IpcMainInvokeEvent) => isLibraryFrame(event, 'boosts') && host.owned(event.sender);
  ipcMain.handle(BoostChannel.list, (event) =>
    permitted(event) ? { sites: host.store.list(), writable: host.writable(event.sender) } : null,
  );
  ipcMain.handle(
    BoostChannel.save,
    (event, origin: unknown, boost: unknown) =>
      permitted(event) && host.writable(event.sender) && committed(origin, host.store.save(origin, boost)),
  );
  ipcMain.handle(
    BoostChannel.remove,
    (event, origin: unknown) =>
      permitted(event) && host.writable(event.sender) && committed(origin, host.store.remove(origin)),
  );
  return { hide: (origin: string, selector: string) => committed(origin, host.store.hide(origin, selector)) };
}
