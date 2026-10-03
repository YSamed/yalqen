import fs from 'node:fs';
import { app } from 'electron';
import { externalUrls } from './launch.js';

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Links and files can arrive before any window exists, so they wait until the browser can open them.
export class ExternalUrlInbox {
  private readonly pending: string[];
  private open: ((urls: string[]) => void) | null = null;

  constructor(primary: boolean) {
    this.pending = primary ? externalUrls(process.argv.slice(1), process.cwd(), isFile) : [];
    app.on('open-url', (event, url) => {
      event.preventDefault();
      this.receive(externalUrls([url], process.cwd(), isFile));
    });
    app.on('open-file', (event, file) => {
      event.preventDefault();
      this.receive(externalUrls([file], process.cwd(), isFile));
    });
    app.on('second-instance', (_event, argv, workingDirectory) => {
      this.receive(externalUrls(argv.slice(1), workingDirectory, isFile));
    });
  }

  deliverTo(open: (urls: string[]) => void): string[] {
    this.open = open;
    return this.pending.splice(0);
  }

  private receive(urls: string[]): void {
    if (urls.length === 0) return;
    if (this.open) this.open(urls);
    else this.pending.push(...urls);
  }
}
