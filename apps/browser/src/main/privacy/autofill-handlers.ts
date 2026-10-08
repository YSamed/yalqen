import { ipcMain, Menu, type BaseWindow, type WebContents, type IpcMainInvokeEvent } from 'electron';
import { t } from '../../shared/i18n.js';
import { AutofillChannel, PageChannel } from '../../shared/types.js';
import type { AutofillInfo } from '../../shared/autofill.js';
import { handleSettingsCall, isSettingsFrame } from '../app/settings-page.js';
import { confirmOwner } from './password-handlers.js';
import { passwordOrigin } from './passwords.js';
import type { AutofillStore } from './autofill.js';
interface Host {
  store: AutofillStore;
  allowed(contents: WebContents): boolean;
  parentOf(contents: WebContents): BaseWindow | undefined;
  changed(): void;
  authenticate?(reason: string): Promise<boolean>;
  choose?(parent: BaseWindow, origin: string, choices: AutofillInfo[]): Promise<string | null>;
}
function chooseRecord(parent: BaseWindow, origin: string, choices: AutofillInfo[]): Promise<string | null> {
  return new Promise((resolve) => {
    let id: string | null = null;
    const menu = Menu.buildFromTemplate([
      { label: t('autofill.fillOnSite', { host: new URL(origin).host }), enabled: false },
      { type: 'separator' },
      ...choices.map((choice) => ({
        label: `${choice.label} — ${choice.detail}`,
        click: () => {
          id = choice.id;
        },
      })),
    ]);
    menu.popup({ window: parent, callback: () => setTimeout(() => resolve(id)) });
  });
}
export function installAutofillHandlers({
  store,
  allowed,
  parentOf,
  changed,
  authenticate = confirmOwner,
  choose = chooseRecord,
}: Host): void {
  const permitted = (event: IpcMainInvokeEvent): string | null => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !allowed(event.sender)) return null;
    try {
      const url = new URL(frame.url);
      if (url.username || url.password) return null;
      return passwordOrigin(url.href);
    } catch {
      return null;
    }
  };
  const choosing = new WeakSet<WebContents>();
  ipcMain.handle(PageChannel.autofillAvailable, (event) => {
    const choices = permitted(event) ? store.choices() : [];
    return {
      address: choices.some((record) => record.kind === 'address'),
      card: choices.some((record) => record.kind === 'card'),
      addressLabel: t('autofill.fillAddress'),
      cardLabel: t('autofill.fillCard'),
    };
  });
  ipcMain.handle(PageChannel.chooseAutofill, async (event, kind: unknown) => {
    const origin = permitted(event),
      contents = event.sender,
      frame = event.senderFrame,
      parent = parentOf(contents);
    if (!origin || !parent || (kind !== 'address' && kind !== 'card') || choosing.has(contents)) return null;
    const choices = store.choices(kind);
    if (!choices.length) return null;
    const url = contents.getURL();
    let navigated = false;
    const navigation = (event: Electron.Event & { isMainFrame: boolean }) => {
      if (event.isMainFrame) navigated = true;
    };
    const current = () =>
      !contents.isDestroyed() &&
      !parent.isDestroyed() &&
      !navigated &&
      contents.getURL() === url &&
      frame === contents.mainFrame &&
      permitted(event) === origin;
    contents.on('did-start-navigation', navigation);
    choosing.add(contents);
    try {
      const id = await choose(parent, origin, choices);
      if (!id || !choices.some((choice) => choice.id === id) || !current()) return null;
      if (kind === 'card' && (!(await authenticate(t('autofill.cardReason'))) || !current())) return null;
      const record = store.read(id);
      if (!record || record.kind !== kind) return null;
      if (
        record.kind === 'card' &&
        (+record.year < new Date().getFullYear() ||
          (+record.year === new Date().getFullYear() && +record.month < new Date().getMonth() + 1))
      )
        return null;
      return record;
    } catch {
      return null;
    } finally {
      contents.off('did-start-navigation', navigation);
      choosing.delete(contents);
    }
  });
  handleSettingsCall(AutofillChannel.list, () => store.view());
  handleSettingsCall(AutofillChannel.save, async (event, value) => {
    if (!value || typeof value !== 'object') return false;
    const data = (value as { data?: { kind?: unknown } }).data;
    if (data?.kind === 'card' && (!(await authenticate(t('autofill.cardReason'))) || !isSettingsFrame(event)))
      return false;
    const saved = store.save(value);
    if (saved) changed();
    return saved;
  });
  handleSettingsCall(AutofillChannel.read, async (event, id) => {
    if (typeof id !== 'string') return null;
    const info = store.choices().find((record) => record.id === id);
    if (!info || (info.kind === 'card' && (!(await authenticate(t('autofill.cardReason'))) || !isSettingsFrame(event))))
      return null;
    return store.read(id);
  });
  handleSettingsCall(AutofillChannel.remove, (_event, id) => {
    if (typeof id !== 'string') return false;
    const removed = store.remove(id);
    if (removed) changed();
    return removed;
  });
}
