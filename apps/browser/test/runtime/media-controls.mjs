// Run after build:main: electron test/runtime/media-controls.mjs
// Drives the sidebar player's page scripts against real media elements, including one in a shadow
// root and a muted preview, and checks that a frozen page is woken before it is asked to play.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView } from 'electron';
import media from '../../dist/main/tabs/media.js';
import freezer from '../../dist/main/tabs/tab-freezer.js';

const { MEDIA_READ_SCRIPT, MEDIA_TOGGLE_SCRIPT, MEDIA_WORLD_ID, mediaSeekScript, parsePageMedia } = media;
const { TabFreezer } = freezer;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-media-controls-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const deadline = setTimeout(() => app.exit(1), 30_000);

// Thirty seconds of silence, built in the page so no file or network is involved.
const PAGE = `<!doctype html><body><script>
  const rate = 8000;
  const samples = rate * 30;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); write(36, 'data'); view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  const host = document.body.appendChild(document.createElement('div'));
  const song = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('audio'));
  song.id = 'song';
  song.src = url;
  window.song = song;
  const preview = document.body.appendChild(document.createElement('audio'));
  preview.src = url;
  preview.muted = true;
  preview.loop = true;
  window.preview = preview;
</script>`;

app
  .whenReady()
  .then(async () => {
    const window = new BaseWindow({ show: false });
    const view = new WebContentsView();
    window.contentView.addChildView(view);
    const contents = view.webContents;
    await contents.loadURL(`data:text/html,${encodeURIComponent(PAGE)}`);
    const run = (code) => contents.executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code }], true);
    const read = async () => parsePageMedia(await run(MEDIA_READ_SCRIPT));
    const page = (code) => contents.executeJavaScript(code);
    await page(
      'Promise.all([song, preview].map((item) => new Promise((resolve) => item.readyState >= 1 ? resolve() : item.addEventListener("loadedmetadata", resolve, { once: true }))))',
    );

    // A muted preview that plays does not take the player over from the paused song.
    await page('song.currentTime = 4; preview.play()');
    let info = await read();
    assert.equal(info.duration, 30);
    assert.equal(info.position, 4);
    assert.equal(info.paused, true);

    // Play resumes the song inside the shadow root and settles once it plays.
    await run(MEDIA_TOGGLE_SCRIPT);
    assert.equal(await page('song.paused'), false);
    info = await read();
    assert.equal(info.paused, false);
    assert.ok(info.position >= 4, `position ${info.position}`);

    await run(mediaSeekScript(10));
    assert.ok((await page('song.currentTime')) >= 14);
    await run(mediaSeekScript(-3600));
    assert.ok((await page('song.currentTime')) < 1);

    // Back at the start the song stays the followed one, though the preview has played further.
    // Pause stops everything that plays, the preview too.
    await run(MEDIA_TOGGLE_SCRIPT);
    assert.deepEqual(await page('[song.paused, preview.paused]'), [true, true]);
    assert.equal((await read()).paused, true);

    // A frozen page runs no script; unfreezing first lets play go through.
    const tab = { view, frozen: false, loading: false, pinnedUrl: null, autoReload: null };
    const freezer = new TabFreezer({
      enabled: () => true,
      isActive: () => false,
      hasLiveChild: () => false,
      needsDebugger: () => false,
      changed: () => {},
    });
    freezer.maybeFreeze(tab);
    assert.equal(tab.frozen, true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await freezer.unfreeze(tab);
    assert.equal(tab.frozen, false);
    await run(MEDIA_TOGGLE_SCRIPT);
    assert.equal(await page('song.paused'), false);

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
