// Run after build:main: electron test/runtime/before-unload.mjs
// Uses a disposable profile and native Chromium unload events, with scripted
// answers in place of the application's message box. No user data is loaded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView } from 'electron';
import unload from '../../dist/main/tabs/before-unload.js';
const { checkBeforeUnload } = unload;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-unload-test-'));
app.setPath('userData', profile);
let window;
const views = [];
const deadline = setTimeout(() => app.exit(1), 30_000);

app
  .whenReady()
  .then(async () => {
    window = new BaseWindow({ show: false });
    const page = async (html) => {
      const view = new WebContentsView();
      views.push(view);
      window.contentView.addChildView(view);
      await view.webContents.loadURL(`data:text/html,${encodeURIComponent(html)}`);
      return view.webContents;
    };
    const clean = await page('<p>Clean page</p>');
    assert.equal(await checkBeforeUnload(clean), true);
    assert.equal(clean.isDestroyed(), false, 'clean pages must survive a window consent check');

    const draft = await page(
      '<input id="draft" value="keep this draft"><script>window.onbeforeunload = () => "unsaved"</script>',
    );
    let allow = false;
    let prompts = 0;
    draft.on('will-prevent-unload', (event) => {
      prompts++;
      if (allow) event.preventDefault();
    });
    assert.equal(await checkBeforeUnload(draft), false);
    assert.equal(draft.isDestroyed(), false);
    assert.equal(await draft.executeJavaScript('document.querySelector("input").value'), 'keep this draft');
    assert.equal(clean.isDestroyed(), false);
    allow = true;
    assert.equal(await checkBeforeUnload(draft), true);
    assert.equal(draft.isDestroyed(), false, 'approval must precede cleanup, not perform it');
    assert.equal(prompts, 2);

    const listener = await page('<script>window.addEventListener("beforeunload", e => e.preventDefault())</script>');
    assert.equal(await checkBeforeUnload(listener), false);
    assert.equal(listener.isDestroyed(), false);
    console.log('PASS: native beforeunload stays/leave, clean pages and form contents preserved');
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });

app.on('before-quit', () => {
  clearTimeout(deadline);
  for (const view of views) {
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  if (window && !window.isDestroyed()) window.destroy();
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
