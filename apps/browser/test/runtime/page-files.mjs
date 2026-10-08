import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView } from 'electron';
import files from '../../dist/main/window/page-files.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-page-files-'));
app.setPath('userData', root);
const deadline = setTimeout(() => app.exit(1), 30_000);
let window;
const views = [];
const server = http.createServer((request, response) => {
  if (request.url === '/style.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' });
    response.end('body { color: rgb(12, 34, 56); background-image: url("/image.svg") }');
  } else if (request.url === '/image.svg') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
    );
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      '<!doctype html><title>Offline fixture</title><link rel="stylesheet" href="/style.css"><style>p { background-image: url("/image.svg") }</style><h1>Saved article</h1><p>Read offline</p><img src="/image.svg">',
    );
  }
});
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    window = new BaseWindow({ show: false });
    const page = () => {
      const view = new WebContentsView();
      views.push(view);
      window.contentView.addChildView(view);
      return view.webContents;
    };
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const contents = page();
    await contents.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const mhtml = path.join(root, 'chosen archive.mhtml');
    const html = path.join(root, 'chosen page #1.html');
    let failures = 0;
    const dialogs = (filePath, canceled = false) => ({
      showSaveDialog: async () => ({ filePath, canceled }),
      showMessageBox: async () => {
        failures++;
        return { response: 0 };
      },
    });
    await files.saveOfflinePage(window, contents, dialogs(mhtml));
    await files.saveOfflinePage(window, contents, dialogs(html));
    assert.equal(failures, 0);
    assert.match(fs.readFileSync(mhtml, 'utf8'), /multipart\/related/);
    const htmlSource = fs.readFileSync(html, 'utf8');
    assert.match(htmlSource, /yalqen-resources-/);
    await new Promise((resolve) => server.close(resolve));
    for (const file of [mhtml, html]) {
      const offline = page();
      await offline.loadFile(file);
      offline.debugger.attach('1.3');
      const { root: document } = await offline.debugger.sendCommand('DOM.getDocument');
      const query = async (selector) =>
        (await offline.debugger.sendCommand('DOM.querySelector', { nodeId: document.nodeId, selector })).nodeId;
      const heading = await query('h1');
      assert.ok(heading);
      assert.match(
        (await offline.debugger.sendCommand('DOM.getOuterHTML', { nodeId: heading })).outerHTML,
        /Saved article/,
      );
      await offline.debugger.sendCommand('CSS.enable');
      const style = (await offline.debugger.sendCommand('CSS.getComputedStyleForNode', { nodeId: await query('body') }))
        .computedStyle;
      assert.equal(style.find(({ name }) => name === 'color').value, 'rgb(12, 34, 56)');
      const image = await offline.debugger.sendCommand('DOM.getBoxModel', { nodeId: await query('img') });
      assert.equal(image.model.width, 20);
      const paragraph = (
        await offline.debugger.sendCommand('CSS.getComputedStyleForNode', { nodeId: await query('p') })
      ).computedStyle;
      const background = paragraph.find(({ name }) => name === 'background-image').value;
      assert.ok(!background.includes('page_files/'), `Inline style uses relocated resources: ${background}`);
      offline.debugger.detach();
    }
    const cancelled = path.join(root, 'cancelled.mhtml');
    await files.saveOfflinePage(window, contents, dialogs(cancelled, true));
    assert.equal(fs.existsSync(cancelled), false);
    const opened = [];
    await files.openLocalFiles(window, (url) => opened.push(url), {
      showOpenDialog: async () => ({ canceled: false, filePaths: [mhtml, html] }),
      showMessageBox: async () => {
        throw new Error('Unexpected open failure');
      },
    });
    assert.equal(opened.length, 2);
    assert.match(opened[1], /%23/);
    const existing = path.join(root, 'preserved.mhtml');
    fs.writeFileSync(existing, 'keep existing');
    await assert.rejects(
      files.writeOfflinePage(
        {
          savePage: async () => {
            throw new Error('simulated save failure');
          },
        },
        existing,
      ),
    );
    assert.equal(fs.readFileSync(existing, 'utf8'), 'keep existing');
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.yalqen-save-')),
      false,
    );
    const stale = path.join(root, 'stale.mhtml');
    fs.writeFileSync(stale, 'keep stale');
    await assert.rejects(files.writeOfflinePage(contents, stale, () => false));
    assert.equal(fs.readFileSync(stale, 'utf8'), 'keep stale');
    const changed = path.join(root, 'changed.mhtml');
    fs.writeFileSync(changed, 'keep changed');
    await files.saveOfflinePage(window, contents, {
      ...dialogs(changed),
      showSaveDialog: async () => {
        await contents.loadURL('data:text/html,new-page');
        return { canceled: false, filePath: changed };
      },
    });
    assert.equal(fs.readFileSync(changed, 'utf8'), 'keep changed');
    console.log(
      'PASS: real MHTML/complete HTML reopen without the server with CSS/images; native file URL encoding, cancellation and failed/stale saves preserve existing files',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  server.close();
  for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
  if (window && !window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(error);
  }
});
