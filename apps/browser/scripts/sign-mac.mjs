import { dirname } from 'node:path';
import { sign as signApp } from '@electron/osx-sign';
import { vmpSign } from './vmp-sign.mjs';

// electron-builder flips the fuses before this hook, and VMP must sign the final binaries before codesign.
export default function sign(options) {
  vmpSign(dirname(options.app));
  return signApp(options);
}
