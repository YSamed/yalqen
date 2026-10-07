import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const executable = require('electron');
for (const test of ['before-unload.mjs', 'download-location.mjs', 'site-protections.mjs', 'extension-updates.mjs']) {
  const result = spawnSync(executable, [fileURLToPath(new URL(`../test/runtime/${test}`, import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    timeout: 45_000,
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error);
    process.exitCode = result.status || 1;
    break;
  }
}
