// Run after build:main and build:preload: electron test/runtime/media-skip.mjs
// Checks that the page preload's hook sees the track handlers a page registers while it loads, that
// the media scripts read them from their isolated world, and that a skip reaches the page's handler.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView } from 'electron';
import media from '../../dist/main/tabs/media.js';

const { MEDIA_READ_SCRIPT, MEDIA_WORLD_ID, mediaSkipScript, parsePageMedia } = media;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-media-skip-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);

const PAGE = `<!doctype html><body><script>
  window.ran = [];
  navigator.mediaSession.setActionHandler('nexttrack', (details) => window.ran.push(details.action));
  navigator.mediaSession.setActionHandler('play', () => window.ran.push('play'));
</script>`;

app
  .whenReady()
  .then(async () => {
    const server = http.createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.setHeader('content-security-policy', "script-src 'unsafe-inline'");
      response.end(PAGE);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const window = new BaseWindow({ show: false });
    const view = new WebContentsView({
      webPreferences: {
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    window.contentView.addChildView(view);
    const contents = view.webContents;
    await contents.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const run = (code) => contents.executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code }], true);
    const read = async () => parsePageMedia(await run(MEDIA_READ_SCRIPT));

    let info = await read();
    assert.deepEqual([info.canPrevious, info.canNext], [false, true]);

    await run(mediaSkipScript('next'));
    await run(mediaSkipScript('previous'));
    assert.deepEqual(await contents.executeJavaScript('window.ran'), ['nexttrack']);

    // Handlers a page adds or clears later are followed too.
    await contents.executeJavaScript(
      "navigator.mediaSession.setActionHandler('previoustrack', () => window.ran.push('previoustrack')); navigator.mediaSession.setActionHandler('nexttrack', null)",
    );
    info = await read();
    assert.deepEqual([info.canPrevious, info.canNext], [true, false]);
    await run(mediaSkipScript('next'));
    await run(mediaSkipScript('previous'));
    assert.deepEqual(await contents.executeJavaScript('window.ran'), ['nexttrack', 'previoustrack']);

    server.close();
    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
