import which from 'which';
import open from 'open';
import { t } from '../shared/i18n.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';
export const IS_POSIX = IS_MAC || IS_LINUX;
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
        app: { name: ['zed', 'code', 'subl', 'notepad++', 'notepad'] },
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
