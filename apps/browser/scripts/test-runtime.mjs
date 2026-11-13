import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const executable = require('electron');
const results = [];
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
  // A broken build fails every file; stop early so it does not burn macOS CI minutes on retries.
  if (results.filter((result) => result.failed).length >= 3) {
    results.push({ test, seconds: 0, retried: false, failed: false, skipped: true });
    continue;
  }
  const run = () =>
    spawnSync(executable, [fileURLToPath(new URL(`../test/runtime/${test}`, import.meta.url))], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      timeout: 45_000,
      killSignal: 'SIGKILL',
    });
  const started = Date.now();
  let result = run();
  // shortcut: one retry hides rare CI-only timing flakes (tab-modes, reader); fix the test if it keeps retrying.
  const retried = Boolean(result.error || result.status !== 0);
  if (retried) {
    console.warn(`RETRY: ${test} failed once; running it again`);
    result = run();
  }
  const failed = Boolean(result.error || result.status !== 0);
  if (result.error) console.error(result.error);
  results.push({ test, seconds: (Date.now() - started) / 1000, retried, failed });
}

for (const { test, seconds, retried, failed, skipped } of results.toSorted((a, b) => b.seconds - a.seconds)) {
  const status = skipped ? 'SKIP ' : failed ? 'FAIL ' : retried ? 'RETRY' : 'ok   ';
  console.log(`${status} ${seconds.toFixed(1).padStart(5)}s  ${test}`);
}
const failures = results.filter((result) => result.failed).map((result) => result.test);
if (failures.length) {
  if (results.some((result) => result.skipped))
    console.error('Stopped after 3 failed files; the SKIP files did not run.');
  console.error(`${failures.length} runtime test file(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
