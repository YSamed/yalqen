import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const directory = path.dirname(require.resolve('node-pty/package.json'));
const prebuilds = path.join(directory, 'prebuilds');
const helpers = [path.join(directory, 'build', 'Release', 'spawn-helper')];
if (fs.existsSync(prebuilds)) {
  for (const name of fs.readdirSync(prebuilds)) helpers.push(path.join(prebuilds, name, 'spawn-helper'));
}
// node-pty 1.1.0 publishes its Unix helper without executable permissions.
for (const helper of helpers) {
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
