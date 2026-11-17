import which from 'which';
import open from 'open';
import { t } from '../shared/i18n.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants, open as fs_open, stat } from 'node:fs/promises';
import path from 'node:path';
import { toWindows } from 'cygpath';
import { existsSync } from 'node:fs';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';
export const IS_POSIX = IS_MAC || IS_LINUX;
export const WIN_PATHEXT = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';');
export const WIN_EDITORS = ['zed', 'code', 'subl', 'notepad++', 'notepad'];

export const winBash = () => {
  const all = which.sync('bash', { all: true, nothrow: true });
  // bash.exe in System32 is a stub to WSL
  const found = all?.find((bash) => !/System32/i.test(bash));
  if (!found) {
    console.debug(t('platform.bashNotFound'));
  }
  return found;
};

let cacheDefaultShell: string;

const getDefaultShell = () => {
  // TODO: Allow user to pick preferred shell in Settings
  if (IS_WIN) {
    return winBash() ?? String.raw`C:\Program Files\Git\bin\bash.exe`;
  }
  if (IS_MAC) {
    return '/bin/zsh';
  }
  if (IS_POSIX) {
    const bash = which.sync('bash', { nothrow: true });
    return bash ?? '/bin/sh';
  }
  throw new Error(t('platform.unsupported'));
};

export const defaultShell = () => {
  if (!cacheDefaultShell) {
    cacheDefaultShell = getDefaultShell();
  }
  return cacheDefaultShell;
};

export const openAsText = async (file: string) => {
  // TODO: Allow user to pick preferred editor in Settings
  switch (true) {
    case IS_WIN:
      return open(file, {
        app: { name: WIN_EDITORS },
      });
    case IS_MAC:
      return open(file, {
        app: { name: '/usr/bin/open', arguments: ['-t'] },
      });
    case IS_LINUX:
      return (async () => {
        const script = `DESKTOP_FILE=$(xdg-mime query default text/plain)
      for dir in "\${XDG_DATA_HOME:-$HOME/.local/share}" /usr/local/share /usr/share; do
        if [ -f "$dir/applications/$DESKTOP_FILE" ]; then
          gio launch "$dir/applications/$DESKTOP_FILE" "${file}"
          break
        fi
      done`;
        const sh = promisify(execFile)(defaultShell(), ['-s']);
        sh.child.stdin?.write(script);
        sh.child.stdin?.end();
        await sh;
      })();
  }
};

export const ensureExecutable = async (filePath: string): Promise<void> => {
  if (IS_WIN) {
    const basePath = toWindows(filePath);
    filePath = [...WIN_PATHEXT.map((e) => `${basePath}${e}`)].find((p) => existsSync(p)) || basePath;
  }

  const stats = await stat(filePath);

  if (!stats.isFile()) throw new Error(t('platform.fileNotFound'));

  if (IS_WIN) {
    const ext = path.extname(filePath).toLowerCase();
    if (!WIN_PATHEXT.includes(ext)) {
      throw new Error(t('platform.fileNotExecutable'));
    }
  }

  if (IS_POSIX) {
    await access(filePath, constants.X_OK);
  }
};

export const isExecutableScript = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;

    if (IS_WIN) {
      const ext = path.extname(filePath).toLowerCase();
      return WIN_PATHEXT.includes(ext);
    }

    if (IS_POSIX) {
      await access(filePath, constants.X_OK);

      const handle = await fs_open(filePath, 'r');
      try {
        const buf = Buffer.alloc(2);
        const { bytesRead } = await handle.read(buf, 0, 2, 0);
        return bytesRead === 2 && buf[0] === 0x23 && buf[1] === 0x21;
      } finally {
        await handle.close();
      }
    }
  } catch {}
  return false;
};
