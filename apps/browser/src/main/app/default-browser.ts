import path from 'node:path';
import { app, shell } from 'electron';

const clientPath = app.isPackaged ? undefined : process.execPath;
const clientArgs = app.isPackaged ? undefined : [path.resolve(process.argv[1] ?? '.')];
let windowsDefaultBrowser = false;

export function isDefaultBrowser(): boolean {
  return process.platform === 'win32'
    ? windowsDefaultBrowser
    : app.isDefaultProtocolClient('https', clientPath, clientArgs);
}

export async function refreshDefaultBrowser(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const { path: executable } = await app.getApplicationInfoForProtocol('https://yalqen.com');
    windowsDefaultBrowser =
      path.win32.normalize(executable).toLowerCase() === path.win32.normalize(process.execPath).toLowerCase();
  } catch {
    windowsDefaultBrowser = false;
  }
}

export async function makeDefaultBrowser(): Promise<void> {
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:defaultapps');
    return;
  }
  for (const scheme of ['http', 'https']) {
    if (!app.setAsDefaultProtocolClient(scheme, clientPath, clientArgs)) {
      console.warn(`[default-browser] the system did not accept ${scheme}`);
    }
  }
}
