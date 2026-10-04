import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const { productName, build } = require('../package.json');
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
    ...build.mac.extendInfo,
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

function terminalPath(fd) {
  const result = spawnSync('tty', { stdio: [fd, 'pipe', 'ignore'], encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Started as a child of the terminal, macOS credits camera and microphone requests to the terminal app
// and Yalqen never shows up under Privacy & Security. Launching through LaunchServices makes it its own app.
function launchCommand(executable) {
  if (process.platform !== 'darwin') return [executable, [project]];
  const output = terminalPath(process.stdout) ?? '/dev/null';
  const errors = terminalPath(process.stderr) ?? '/dev/null';
  const env = ['PATH', 'SHELL'].flatMap((name) => (process.env[name] ? ['--env', `${name}=${process.env[name]}`] : []));
  const app = path.resolve(executable, '../../..');
  return ['open', ['-n', '-W', '--stdout', output, '--stderr', errors, ...env, app, '--args', project]];
}

const executable = process.platform === 'darwin' ? brandedMacApp() : electronBinary;
if (process.argv.includes('--prepare-only')) {
  console.log(path.resolve(executable, '../../..'));
} else {
  const child = spawn(...launchCommand(executable), { cwd: project, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  if (process.platform === 'darwin') {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        spawnSync('pkill', ['-f', `^${executable} `]);
        child.kill(signal);
      });
    }
  }
}
