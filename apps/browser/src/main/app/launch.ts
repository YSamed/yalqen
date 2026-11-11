import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPeekable } from '../tabs/popups.js';

export function externalUrls(args: readonly string[], cwd: string, isFile: (file: string) => boolean): string[] {
  const urls: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (/^(https?|file):/i.test(arg)) {
      try {
        urls.push(new URL(arg).toString());
      } catch {}
      continue;
    }
    const file = path.resolve(cwd, arg);
    if (isFile(file)) urls.push(pathToFileURL(file).toString());
  }
  return urls;
}

export function miniWindowUrl(urls: readonly string[], enabled: boolean): string | null {
  return enabled && urls.length === 1 && isPeekable(urls[0]) ? urls[0] : null;
}
