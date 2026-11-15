import which from 'which';
import { Options as OpenOptions, default as open } from 'open';
import { t } from '../shared/i18n.js';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';
export const IS_POSIX = IS_MAC || IS_LINUX;
export const winBash = () => {
  const all = which.sync('bash', { all: true });
  // bash.exe in System32 is a stub to WSL
  const found = all.find((bash) => !/System32/i.test(bash));
  if (!found) {
    throw new Error(t('platform.bashNotFound'));
  }
  return found;
};

export const defaultShell = () => {
  // TODO: Allow user to pick preferred shell in Settings
  if (IS_WIN) {
    return winBash();
  }
  if (IS_MAC) {
    return '/bin/zsh';
  }
  if (IS_POSIX) {
    const bash = which.sync('bash');
    return bash ?? '/bin/sh';
  }
  throw new Error(t('platform.unsupported'));
};

export const DEFAULT_SHELL = defaultShell();

export const openAsText = async (file: string) => {
  // TODO: Allow user to pick preferred editor in Settings
  let opts: OpenOptions;
  if (IS_WIN) {
    opts = {
      app: { name: ['zed', 'code', 'subl', 'notepad++', 'notepad'] },
    };
  } else {
    opts = {
      app: { name: 'open', arguments: ['-t'] },
    };
  }
  return open(file, opts);
};
