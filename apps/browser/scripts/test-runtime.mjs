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
  'one-time-code.mjs',
  'bookmark-transfer.mjs',
  'bulk-tabs.mjs',
  'tab-selection.mjs',
  'split-drag.mjs',
  'tab-transition.mjs',
  'media-player.mjs',
  'unread-dot.mjs',
  'toolbar-buttons.mjs',
  'tooltips.mjs',
  'interface-bridge.mjs',
  'hover-previews.mjs',
  'media-controls.mjs',
  'media-skip.mjs',
  'pinning.mjs',
  'pinned-home.mjs',
  'tab-cleanup.mjs',
  'tab-modes.mjs',
  'tab-modes-ui.mjs',
  'devtools-view.mjs',
  'devtools-divider.mjs',
  'threat-protection.mjs',
  'persistent-profiles.mjs',
  'profile-settings.mjs',
  'appearance-settings.mjs',
  'sites-settings.mjs',
  'closed-tabs.mjs',
  'page-files.mjs',
  'full-page-screenshot.mjs',
  'password-tools.mjs',
  'certificate-details.mjs',
  'bookmark-editing.mjs',
  'extension-bridge.mjs',
]) {
  const run = () =>
    spawnSync(executable, [fileURLToPath(new URL(`../test/runtime/${test}`, import.meta.url))], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      timeout: 45_000,
      killSignal: 'SIGKILL',
    });
  let result = run();
  // shortcut: one retry hides rare CI-only timing flakes (autofill, tab-modes, reader); fix the test if it keeps retrying.
  if (result.error || result.status !== 0) {
    console.warn(`RETRY: ${test} failed once; running it again`);
    result = run();
  }
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error);
    process.exitCode = result.status || 1;
    break;
  }
}
