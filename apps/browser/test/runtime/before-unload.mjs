// Run after build:main: electron test/runtime/before-unload.mjs
// Uses a disposable profile and native Chromium unload events, with scripted
// answers in place of the application's message box. No user data is loaded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView } from 'electron';
import unload from '../../dist/main/tabs/before-unload.js';
const { checkBeforeUnload } = unload;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-unload-test-'));
app.setPath('userData', profile);
// Chromium allows a close when no beforeunload reply arrives within 500 ms. A hidden window's renderers run at
// background priority and can miss that deadline on a busy runner, so they keep normal priority here.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let window;
let server;
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
    // A subresource that never answers keeps the main frame loading, like a slow site.
    server = http.createServer((request, response) => {
      if (request.url === '/hang' || request.url === '/stall') return;
      response.setHeader('content-type', 'text/html');
      response.end(
        request.url === '/draft' ? `${HANGING}<script>window.onbeforeunload = () => "unsaved"</script>` : HANGING,
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const HANGING = `<p>Loading</p><img src="http://127.0.0.1:${server.address().port}/hang">`;
    const loading = async (pathname) => {
      const view = new WebContentsView();
      views.push(view);
      window.contentView.addChildView(view);
      const ready = new Promise((resolve) => view.webContents.once('dom-ready', resolve));
      view.webContents.loadURL(`http://127.0.0.1:${server.address().port}${pathname}`).catch(() => {});
      await ready;
      assert.equal(view.webContents.isLoadingMainFrame(), true);
      return view.webContents;
    };
    const timed = async (contents) => {
      const started = Date.now();
      const allowed = await checkBeforeUnload(contents);
      assert.ok(Date.now() - started < 3000, 'a loading page must not stall the consent check');
      return allowed;
    };
    const slow = await loading('/');
    assert.equal(await timed(slow), true);
    assert.equal(slow.isDestroyed(), false, 'loading pages must survive a window consent check');
    const slowDraft = await loading('/draft');
    let allowSlow = false;
    let slowPrompts = 0;
    slowDraft.on('will-prevent-unload', (event) => {
      slowPrompts++;
      if (allowSlow) event.preventDefault();
    });
    assert.equal(await timed(slowDraft), false);
    assert.equal(slowDraft.isDestroyed(), false);
    allowSlow = true;
    assert.equal(await timed(slowDraft), true);
    assert.equal(slowDraft.isDestroyed(), false);
    assert.equal(slowPrompts, 2);

    const stalled = async (contents) => {
      const started = new Promise((resolve) => contents.once('did-start-navigation', resolve));
      contents.loadURL(`http://127.0.0.1:${server.address().port}/stall`).catch(() => {});
      await started;
      assert.equal(await timed(contents), true);
      assert.equal(contents.isDestroyed(), false, 'a page waiting for its response must survive the check');
    };
    await stalled(await page('<p>Before navigation</p>'));
    const fresh = new WebContentsView();
    views.push(fresh);
    window.contentView.addChildView(fresh);
    await stalled(fresh.webContents);
    console.log('PASS: native beforeunload stays/leave, clean and loading pages and form contents preserved');
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on('before-quit', () => {
  clearTimeout(deadline);
  for (const view of views) {
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  if (window && !window.isDestroyed()) window.destroy();
  server?.closeAllConnections();
  server?.close();
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }));
