import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// macOS writes this attribute on every screenshot it saves, whatever the file name or system language.
const SCREEN_CAPTURE_ATTRIBUTE = 'com.apple.metadata:kMDItemIsScreenCapture';
const SETTLE_MS = 800;
const MAX_AGE_MS = 60_000;

export function isScreenshotCandidate(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !name.includes(path.sep);
}

export function screenshotFolderFrom(location: string, home: string): string {
  const folder = location.trim().replace(/^~(?=$|\/)/, home);
  return path.isAbsolute(folder) ? folder : path.join(home, 'Desktop');
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000 }, (error, stdout) => resolve(error ? null : stdout));
  });
}

async function screenshotFolder(): Promise<string> {
  const location = await run('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location']);
  return screenshotFolderFrom(location ?? '', os.homedir());
}

export class ScreenshotWatcher {
  private watcher: fs.FSWatcher | null = null;
  private enabled = false;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly seen = new Set<string>();

  constructor(private readonly onScreenshot: (file: string, size: number) => void) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) void this.start();
    else this.stop();
  }

  private async start(): Promise<void> {
    const folder = await screenshotFolder();
    if (!this.enabled || this.watcher) return;
    try {
      this.watcher = fs.watch(folder, (_event, name) => {
        if (typeof name === 'string' && isScreenshotCandidate(name)) this.schedule(path.join(folder, name));
      });
      this.watcher.on('error', (error) => {
        console.warn('[screenshots] stopped watching:', error);
        this.stop();
      });
    } catch (error) {
      console.warn('[screenshots] could not watch:', error);
    }
  }

  private stop(): void {
    this.watcher?.close();
    this.watcher = null;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private schedule(file: string): void {
    clearTimeout(this.pending.get(file));
    this.pending.set(
      file,
      setTimeout(() => {
        this.pending.delete(file);
        void this.check(file);
      }, SETTLE_MS),
    );
  }

  private async check(file: string): Promise<void> {
    if (this.seen.has(file)) return;
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile() || Date.now() - stat.birthtimeMs > MAX_AGE_MS) return;
    if ((await run('/usr/bin/xattr', ['-p', SCREEN_CAPTURE_ATTRIBUTE, file])) === null) return;
    if (!this.watcher || this.seen.has(file)) return;
    this.seen.add(file);
    this.onScreenshot(file, stat.size);
  }
}
