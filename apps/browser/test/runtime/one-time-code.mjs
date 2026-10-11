import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { app, BrowserWindow, session } from 'electron';
import handlers from '../../dist/main/privacy/one-time-code-handlers.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-one-time-code-runtime-'));
app.setPath('userData', root);
const windows = [];
let window, mail;
let offered = [],
  picks = 0;
const deadline = setTimeout(() => app.exit(1), 30000);
const pages = {
  '/mail': `<main><div>Shop newsletter</div><div>Spring sale 2026, 1500 TL off</div><div>Example</div><div>Your verification code</div><div>Use 482913 to sign in. It expires at 20:45.</div></main>`,
  '/form': `<style>input{display:block;width:220px;height:26px;margin:8px}</style>
<form><input id=code autocomplete=one-time-code><input id=promo name=promo-code></form>
<div id=boxes><input id=b0 name=otp-0 maxlength=1><input id=b1 name=otp-1 maxlength=1><input id=b2 name=otp-2 maxlength=1><input id=b3 name=otp-3 maxlength=1><input id=b4 name=otp-4 maxlength=1><input id=b5 name=otp-5 maxlength=1></div>`,
};
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(pages[req.url] ?? '');
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw Error(`Timed out: ${predicate}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const visible =
  "!!document.querySelector('[data-yalqen-autofill]') && getComputedStyle(document.querySelector('[data-yalqen-autofill]')).display!=='none'";
async function focus(id) {
  window.webContents.focus();
  await window.webContents.executeJavaScript(
    `document.activeElement?.blur();document.getElementById(${JSON.stringify(id)}).focus()`,
  );
  await eventually(visible);
}
async function click() {
  const before = picks;
  for (let attempt = 0; attempt < 5 && picks === before; attempt++) {
    const rect = await window.webContents.executeJavaScript(
      `(() => {const r=document.querySelector('[data-yalqen-autofill]').getBoundingClientRect();return{x:Math.round(r.x+14),y:Math.round(r.y+14)}})()`,
    );
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'mouseMove', ...rect });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
    const sent = Date.now();
    while (picks === before && Date.now() - sent < 1000) await new Promise((r) => setTimeout(r, 20));
  }
  if (picks === before) throw Error('Code button click did not open the chooser');
}
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://localhost:${server.address().port}`;
    const browsing = session.fromPartition('persist:one-time-code');
    const create = (partition = browsing) => {
      const created = new BrowserWindow({
        show: false,
        width: 900,
        height: 700,
        webPreferences: {
          session: partition,
          preload: path.resolve('dist/preload/page-preload.js'),
          sandbox: true,
          contextIsolation: true,
        },
      });
      windows.push(created);
      return created;
    };
    let mailOpen = false;
    handlers.installOneTimeCodeHandlers({
      allowed: (contents) => contents.session === browsing,
      mailTabs: () => (mailOpen ? windows.map((w) => w.webContents) : []),
      parentOf: (contents) => windows.find((w) => w.webContents === contents),
      isMail: (url) => new URL(url).pathname === '/mail',
      choose: async (_parent, origin, codes) => {
        picks++;
        assert.equal(origin, base);
        offered = codes;
        return codes[0]?.code ?? null;
      },
    });
    window = create();
    mail = create();
    await mail.loadURL(`${base}/mail`);
    await window.loadURL(`${base}/form`);
    window.webContents.focus();
    await window.webContents.executeJavaScript("document.getElementById('code').focus()");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(await window.webContents.executeJavaScript(visible), false, 'no button without an open mail tab');
    mailOpen = true;
    await focus('code');
    await click();
    await eventually("document.getElementById('code').value==='482913'");
    assert.deepEqual(
      offered.map((item) => [item.code, item.context]),
      [['482913', 'Your verification code']],
    );
    await window.webContents.executeJavaScript("document.getElementById('promo').focus()");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(await window.webContents.executeJavaScript(visible), false, 'promo codes are not code fields');
    await focus('b0');
    await click();
    await eventually("[...document.querySelectorAll('#boxes input')].map(i=>i.value).join('')==='482913'");
    const other = create(session.fromPartition('other-one-time-code'));
    await other.loadURL(`${base}/form`);
    other.webContents.focus();
    await other.webContents.executeJavaScript("document.getElementById('code').focus()");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      await other.webContents.executeJavaScript("!!document.querySelector('[data-yalqen-autofill]')"),
      false,
      'pages outside the allowed session never see mail codes',
    );
    console.log(
      'PASS: code fields offer codes from open mail tabs only on click, fill single and split fields, skip promo fields and other sessions',
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
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
