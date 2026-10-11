import { ipcMain, Menu, type BaseWindow, type WebContents, type IpcMainInvokeEvent } from 'electron';
import { t } from '../../shared/i18n.js';
import { PageChannel } from '../../shared/types.js';
import { findOneTimeCodes, isWebmail, MAIL_TEXT_SCRIPT, type OneTimeCode } from '../../shared/one-time-code.js';
import { passwordOrigin } from './passwords.js';

const MAIL_WORLD_ID = 1040;
const READ_TIMEOUT = 2_000;

interface Host {
  allowed(contents: WebContents): boolean;
  mailTabs(contents: WebContents): WebContents[];
  parentOf(contents: WebContents): BaseWindow | undefined;
  isMail?(url: string): boolean;
  read?(contents: WebContents): Promise<string>;
  choose?(parent: BaseWindow, origin: string, codes: OneTimeCode[]): Promise<string | null>;
}

async function readMail(contents: WebContents): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const text = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(MAIL_WORLD_ID, [{ code: MAIL_TEXT_SCRIPT }]),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(''), READ_TIMEOUT);
      }),
    ]);
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function chooseCode(parent: BaseWindow, origin: string, codes: OneTimeCode[]): Promise<string | null> {
  return new Promise((resolve) => {
    let code: string | null = null;
    const menu = Menu.buildFromTemplate([
      { label: t('autofill.fillOnSite', { host: new URL(origin).host }), enabled: false },
      { type: 'separator' },
      ...(codes.length
        ? [
            { label: t('oneTimeCode.fromMail'), enabled: false },
            ...codes.map((item) => ({
              label: `${item.code} — ${item.context}`,
              sublabel: item.source,
              click: () => {
                code = item.code;
              },
            })),
          ]
        : [{ label: t('oneTimeCode.none'), enabled: false }]),
    ]);
    menu.popup({ window: parent, callback: () => setTimeout(() => resolve(code)) });
  });
}

// Mail tabs are read only when the person opens the menu, and the text never leaves the main process.
export function installOneTimeCodeHandlers({
  allowed,
  mailTabs,
  parentOf,
  isMail = isWebmail,
  read = readMail,
  choose = chooseCode,
}: Host): void {
  const permitted = (event: IpcMainInvokeEvent): string | null => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !allowed(event.sender)) return null;
    try {
      const url = new URL(frame.url);
      if (url.username || url.password || isMail(url.href)) return null;
      return passwordOrigin(url.href);
    } catch {
      return null;
    }
  };
  const sources = (contents: WebContents) =>
    mailTabs(contents).filter(
      (mail) => mail !== contents && !mail.isDestroyed() && mail.session === contents.session && isMail(mail.getURL()),
    );
  const choosing = new WeakSet<WebContents>();
  ipcMain.handle(PageChannel.oneTimeCodeAvailable, (event) => ({
    available: Boolean(permitted(event)) && sources(event.sender).length > 0,
    label: t('oneTimeCode.fill'),
  }));
  ipcMain.handle(PageChannel.chooseOneTimeCode, async (event) => {
    const origin = permitted(event),
      contents = event.sender,
      frame = event.senderFrame,
      parent = parentOf(contents);
    if (!origin || !parent || choosing.has(contents)) return null;
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
      const codes: OneTimeCode[] = [];
      for (const mail of sources(contents)) {
        const text = await read(mail);
        if (mail.isDestroyed() || !isMail(mail.getURL())) continue;
        for (const item of findOneTimeCodes(text, new URL(mail.getURL()).host, 5 - codes.length))
          if (!codes.some((known) => known.code === item.code)) codes.push(item);
        if (codes.length >= 5) break;
      }
      if (!current()) return null;
      const code = await choose(parent, origin, codes);
      if (!code || !codes.some((item) => item.code === code) || !current()) return null;
      return code;
    } catch {
      return null;
    } finally {
      contents.off('did-start-navigation', navigation);
      choosing.delete(contents);
    }
  });
}
