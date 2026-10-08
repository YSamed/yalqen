import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const executable = require('electron');
for (const test of [
  'before-unload.mjs',
  'download-location.mjs',
  'site-protections.mjs',
  'site-storage.mjs',
  'reader.mjs',
  'reading-list.mjs',
  'workspaces.mjs',
  'extension-updates.mjs',
  'extension-access.mjs',
  'extension-access-settings.mjs',
  'login-selection.mjs',
  'autofill.mjs',
  'autofill-settings.mjs',
  'bookmark-transfer.mjs',
  'bulk-tabs.mjs',
  'tab-selection.mjs',
  'pinning.mjs',
  'threat-protection.mjs',
  'persistent-profiles.mjs',
  'profile-settings.mjs',
  'closed-tabs.mjs',
  'page-files.mjs',
  'password-tools.mjs',
  'certificate-details.mjs',
  'bookmark-editing.mjs',
]) {
  const result = spawnSync(executable, [fileURLToPath(new URL(`../test/runtime/${test}`, import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    timeout: 45_000,
    killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error);
    process.exitCode = result.status || 1;
    break;
  }
}
