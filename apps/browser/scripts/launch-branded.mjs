import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const { productName } = require('../package.json');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function brandedMacApp() {
  const source = path.dirname(path.resolve(electronBinary, '../..'));
  const destination = path.join(project, 'dist', `${productName}.app`);
  const sourceBinary = path.join(source, 'Contents', 'MacOS', 'Electron');
  const stamp = path.join(destination, 'Contents', 'Resources', '.yalqen-source.json');
  const binaryStat = fs.statSync(sourceBinary);
  const identity = { source, size: binaryStat.size, modified: binaryStat.mtimeMs };

  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(stamp, 'utf8'));
  } catch {}
  if (JSON.stringify(current) !== JSON.stringify(identity)) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    execFileSync('ditto', [source, destination]);
    fs.writeFileSync(stamp, JSON.stringify(identity));
  }

  const plist = path.join(destination, 'Contents', 'Info.plist');
  for (const [key, value] of Object.entries({
    CFBundleName: productName,
    CFBundleDisplayName: productName,
    CFBundleIdentifier: 'com.yalqen.browser.prototype',
    CFBundleIconFile: 'yalqen-fitted.icns',
  })) {
    execFileSync('plutil', ['-replace', key, '-string', value, plist]);
  }

  fs.copyFileSync(
    path.join(project, 'build', 'icon.icns'),
    path.join(destination, 'Contents', 'Resources', 'yalqen-fitted.icns'),
  );

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', destination]);
  const now = new Date();
  fs.utimesSync(destination, now, now);
  return path.join(destination, 'Contents', 'MacOS', 'Electron');
}

const executable = process.platform === 'darwin' ? brandedMacApp() : electronBinary;
if (process.argv.includes('--prepare-only')) {
  console.log(path.resolve(executable, '../../..'));
} else {
  const child = spawn(executable, [project], { cwd: project, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
