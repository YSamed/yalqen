import { basename, dirname } from 'node:path';
import { vmpSign } from './vmp-sign.mjs';

// shortcut: replaces signtool and only VMP-signs the app; when an Authenticode certificate is added, sign with it first, then VMP.
export default async function sign({ path }) {
  if (basename(path) === 'Yalqen.exe') vmpSign(dirname(path));
}
