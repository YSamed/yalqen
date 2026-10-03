import path from 'node:path';
import { app } from 'electron';

const clientPath = app.isPackaged ? undefined : process.execPath;
const clientArgs = app.isPackaged ? undefined : [path.resolve(process.argv[1] ?? '.')];

export function isDefaultBrowser(): boolean {
  return app.isDefaultProtocolClient('https', clientPath, clientArgs);
}

export function makeDefaultBrowser(): void {
  for (const scheme of ['http', 'https']) {
    if (!app.setAsDefaultProtocolClient(scheme, clientPath, clientArgs)) {
      console.warn(`[default-browser] the system did not accept ${scheme}`);
    }
  }
}
