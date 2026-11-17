import childProcess from 'node:child_process';
import nodeFs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);

const PLATFORM_MODULE = require.resolve('../../dist/main/platform.js');
const WHICH_MODULE = require.resolve('which');
const OPEN_MODULE = require.resolve('open');
const CYGPATH_MODULE = require.resolve('cygpath');

const realCygpath = require(CYGPATH_MODULE);

function restore(key, saved) {
  if (saved) require.cache[key] = saved;
  else delete require.cache[key];
}

export function load({ platform, bashAll = [], bashOne, open: openImpl, env = {} }) {
  const originalPlatform = process.platform;
  const savedWhich = require.cache[WHICH_MODULE];
  const savedOpen = require.cache[OPEN_MODULE];
  const savedCygpath = require.cache[CYGPATH_MODULE];
  const calls = { which: [], open: [], toWindows: [] };
  const state = { bashAll, bashOne };

  require.cache[WHICH_MODULE] = {
    id: WHICH_MODULE,
    filename: WHICH_MODULE,
    loaded: true,
    exports: {
      sync: (command, options) => {
        calls.which.push([command, options]);
        return options?.all ? state.bashAll : state.bashOne;
      },
    },
  };
  require.cache[OPEN_MODULE] = {
    id: OPEN_MODULE,
    filename: OPEN_MODULE,
    loaded: true,
    exports: {
      __esModule: true,
      default: (target, options) => {
        calls.open.push([target, options]);
        return openImpl ? openImpl(target, options) : Promise.resolve();
      },
    },
  };
  require.cache[CYGPATH_MODULE] = {
    id: CYGPATH_MODULE,
    filename: CYGPATH_MODULE,
    loaded: true,
    exports: {
      toWindows: (target) => {
        calls.toWindows.push(target);
        return realCygpath.toWindows(target);
      },
    },
  };
  const savedPlatform = require.cache[PLATFORM_MODULE];
  delete require.cache[PLATFORM_MODULE];

  const savedEnv = new Map();
  for (const [key, value] of Object.entries(env)) {
    savedEnv.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return { module: require(PLATFORM_MODULE), calls, state };
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restore(WHICH_MODULE, savedWhich);
    restore(OPEN_MODULE, savedOpen);
    restore(CYGPATH_MODULE, savedCygpath);
    restore(PLATFORM_MODULE, savedPlatform);
  }
}

function replaceProperties(target, values) {
  const originals = new Map();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, target[key]);
    target[key] = value;
  }
  return () => {
    for (const [key, value] of originals) target[key] = value;
  };
}

export function patchExec(run) {
  const stub = () => {
    throw new Error('execFile was called in its callback form');
  };
  stub[promisify.custom] = run;
  return replaceProperties(childProcess, { execFile: stub });
}

export function patchFileSystem({
  isFile = true,
  statError,
  accessError,
  present = () => false,
  firstBytes = '',
} = {}) {
  const calls = { stat: [], access: [], existsSync: [], open: [], close: [] };
  const restorePromises = replaceProperties(fsPromises, {
    stat: (target) => {
      calls.stat.push(target);
      return statError ? Promise.reject(statError) : Promise.resolve({ isFile: () => isFile });
    },
    access: (target, mode) => {
      calls.access.push([target, mode]);
      return accessError ? Promise.reject(accessError) : Promise.resolve();
    },
    open: async (target, flags) => {
      calls.open.push([target, flags]);
      return {
        read: async (buffer, offset, length) => {
          const bytes = Buffer.from(firstBytes);
          const read = Math.min(bytes.length, length);
          buffer.set(bytes.subarray(0, read), offset);
          return { bytesRead: read };
        },
        close: async () => {
          calls.close.push(target);
        },
      };
    },
  });
  const restoreExists = replaceProperties(nodeFs, {
    existsSync: (target) => {
      calls.existsSync.push(target);
      return present(target);
    },
  });

  return {
    calls,
    restore: () => {
      restorePromises();
      restoreExists();
    },
  };
}

export function fakeShell({ fails } = {}) {
  const calls = [];
  return {
    calls,
    run: (file, args, options) => {
      const stdin = {
        script: '',
        ended: false,
        write(chunk) {
          this.script += chunk;
          return true;
        },
        end() {
          this.ended = true;
        },
      };
      calls.push({ file, args, options, stdin });
      const settled = fails ? Promise.reject(fails) : Promise.resolve({ stdout: '', stderr: '' });
      return Object.assign(settled, { child: { stdin } });
    },
  };
}
