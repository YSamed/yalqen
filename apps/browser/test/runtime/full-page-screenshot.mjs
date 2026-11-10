import assert from 'node:assert/strict';
import { app, BrowserWindow, nativeImage } from 'electron';
import pageDebugger from '../../dist/main/devtools/page-debugger.js';

const deadline = setTimeout(() => app.exit(1), 15_000);
void run();

async function run() {
  try {
    await app.whenReady();
    const window = new BrowserWindow({ width: 600, height: 400, show: false });
    const { webContents } = window;
    const sectionCount = 16;
    await webContents.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          `<style>
          body { margin: 0 }
          section { height: 400px; content-visibility: auto; contain-intrinsic-size: auto 400px }
          div { height: 100%; background: red }
        </style>` + '<section><div></div></section>'.repeat(sectionCount),
        ),
    );
    await webContents.executeJavaScript('window.scrollTo(0, 100)');
    const image = nativeImage.createFromBuffer(await pageDebugger.captureFullPage(webContents));
    assert.ok(!image.isEmpty());
    const { width, height } = image.getSize();
    const pixels = image.toBitmap();
    for (let section = 0; section < sectionCount; section++) {
      const y = Math.floor(((section + 0.5) * height) / sectionCount);
      const offset = (y * width + Math.floor(width / 2)) * 4;
      assert.deepEqual([...pixels.subarray(offset, offset + 4)], [0, 0, 255, 255], `section ${section + 1}`);
    }
    assert.equal(await webContents.executeJavaScript('window.scrollY'), 100);
    assert.equal(await webContents.executeJavaScript('document.querySelectorAll("section[style]").length'), 0);
    console.log('PASS: full-page screenshots paint deferred sections and restore the page');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    app.exit(process.exitCode ?? 0);
  }
}
