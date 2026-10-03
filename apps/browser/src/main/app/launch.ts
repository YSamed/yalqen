import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
