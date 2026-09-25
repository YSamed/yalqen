// Unpackaged runs use node_modules' Electron.app, so macOS shows "Electron" in
// the menu bar, Dock and app switcher. This renames that bundle for local runs;
// reinstalling Electron undoes it. Packaging will make this unnecessary.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

if (process.platform !== 'darwin') process.exit(0);

const require = createRequire(import.meta.url);
const { productName } = require('../package.json');
// The electron package exports the path to Electron.app/Contents/MacOS/Electron.
const contents = path.resolve(require('electron'), '../..');
const plist = path.join(contents, 'Info.plist');

const read = (key) => {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const keys = ['CFBundleName', 'CFBundleDisplayName'].filter((key) => read(key) !== productName);
if (keys.length > 0) {
  for (const key of keys) execFileSync('plutil', ['-replace', key, '-string', productName, plist]);
  // LaunchServices caches bundle names; a new modification date makes it read them again.
  const now = new Date();
  fs.utimesSync(path.dirname(contents), now, now);
  console.log(`[brand] Electron.app now shows as "${productName}"`);
}
