import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(project, 'native/fullscreen-titlebar.mm');
const output = path.join(project, 'dist/native/fullscreen-titlebar.node');
// Node-API is ABI-stable, so the headers of the Node running this script build a module Electron can load.
const headers = path.join(path.dirname(process.execPath), '../include/node');
if (!fs.existsSync(path.join(headers, 'node_api.h'))) {
  console.warn(`Skipping the native full-screen module: no Node-API headers in ${headers}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync(
  'clang++',
  [
    ...['-std=c++17', '-fobjc-arc', '-O2', '-bundle', '-undefined', 'dynamic_lookup'],
    ...['-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0'],
    ...['-I', headers, '-framework', 'AppKit', '-o', output, source],
  ],
  { stdio: 'inherit' },
);
