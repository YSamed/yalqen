import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { app, BrowserWindow, session } from 'electron';
import stores from '../../dist/main/privacy/autofill.js';
import handlers from '../../dist/main/privacy/autofill-handlers.js';
import passwords from '../../dist/main/privacy/password-handlers.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-autofill-runtime-'));
app.setPath('userData', root);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP unsafe.test 127.0.0.1');
const windows = [];
let window;
let selectedKind = '',
  authenticated = false,
  auths = 0,
  picks = 0;
let duringChoice = async () => {};
const deadline = setTimeout(() => app.exit(1), 30000);
const html = `<style>input,textarea,select{display:block;width:220px;height:26px;margin:8px}input[type=hidden],.hidden{display:none}</style>
<form id=shipping><input id=first autocomplete="section-checkout shipping given-name"><input id=last value="Keep typed family name" autocomplete="section-checkout shipping family-name"><textarea id=street autocomplete="section-checkout shipping street-address"></textarea><select id=country autocomplete="section-checkout shipping country"><option value="">Choose country</option><option value=TR>Türkiye</option></select><input id=billing autocomplete="section-checkout billing given-name"><input id=hidden class=hidden autocomplete="section-checkout shipping given-name"></form>
<form id=other><input id=other-first autocomplete="section-checkout shipping given-name"></form>
<form id=card><input id=cc-name autocomplete=cc-name><input id=cc-number autocomplete=cc-number><input id=cc-exp type=month autocomplete=cc-exp><input id=cc-csc autocomplete=cc-csc><input id=cc-hidden class=hidden autocomplete=cc-number><input id=cc-readonly readonly autocomplete=cc-number></form>`;
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw Error(`Timed out: ${predicate}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function focus(id) {
  window.webContents.focus();
  await window.webContents.executeJavaScript(
    `document.activeElement?.blur();document.getElementById(${JSON.stringify(id)}).focus()`,
  );
  await eventually(
    "!!document.querySelector('[data-yalqen-autofill]') && getComputedStyle(document.querySelector('[data-yalqen-autofill]')).display!=='none'",
  );
}
// The button stays disabled until the previous pick's IPC reply reaches the page,
// so a single synthetic click can be dropped on slow CI runners.
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
  if (picks === before) throw Error('Autofill button click did not open the chooser');
}
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://localhost:${server.address().port}/`;
    const store = new stores.AutofillStore(root, passwords.safeStorageCipher);
    assert.equal(
      store.save({
        id: null,
        data: {
          kind: 'address',
          label: 'Home',
          givenName: 'Ada',
          additionalName: '',
          familyName: 'Lovelace',
          organization: '',
          streetAddress: '12 Test Street\nFlat 3',
          city: 'Istanbul',
          region: '',
          postalCode: '34000',
          country: 'TR',
          email: 'ada@example.test',
          tel: '+90 123456789',
        },
      }),
      true,
    );
    assert.equal(
      store.save({
        id: null,
        data: {
          kind: 'card',
          label: 'Test card',
          name: 'Ada Lovelace',
          number: '4242424242424242',
          month: '04',
          year: '2035',
        },
      }),
      true,
    );
    const browsing = session.fromPartition('persist:autofill');
    handlers.installAutofillHandlers({
      store,
      allowed: (contents) => contents.session === browsing,
      parentOf: (contents) => windows.find((w) => w.webContents === contents),
      changed() {},
      authenticate: async () => {
        auths++;
        return authenticated;
      },
      choose: async (_parent, origin, choices) => {
        picks++;
        assert.equal(origin, new URL(url).origin);
        assert.equal(
          choices.some((c) => JSON.stringify(c).includes('4242424242424242')),
          false,
        );
        selectedKind = choices[0].kind;
        await duringChoice();
        return choices[0].id;
      },
    });
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 900,
      webPreferences: {
        session: browsing,
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    windows.push(window);
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(message);
    });
    await window.loadURL(url);
    await focus('first');
    window.webContents.debugger.attach('1.3');
    const tree = await window.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const nodes = (node) => [node, ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap(nodes)];
    const host = nodes(tree.root).find((node) => node.attributes?.includes('data-yalqen-autofill'));
    const button = nodes(host).find((node) => node.nodeName === 'BUTTON');
    const resolved = await window.webContents.debugger.sendCommand('DOM.resolveNode', { nodeId: button.nodeId });
    await window.webContents.debugger.sendCommand('Runtime.callFunctionOn', {
      objectId: resolved.object.objectId,
      functionDeclaration: 'function(){this.click()}',
    });
    window.webContents.debugger.detach();
    assert.equal(picks, 0);
    await click();
    await eventually("document.getElementById('first').value==='Ada'");
    assert.equal(selectedKind, 'address');
    assert.equal(auths, 0);
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        "['last','street','country','billing','other-first','hidden'].map(id=>document.getElementById(id).value)",
      ),
      ['Keep typed family name', '12 Test Street\nFlat 3', 'TR', '', '', ''],
    );
    await focus('cc-number');
    await click();
    await eventually(
      "(document.querySelector('[data-yalqen-autofill]').shadowRoot===null) && document.getElementById('cc-number').value===''",
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(auths, 1);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('cc-number').value"), '');
    authenticated = true;
    await click();
    await eventually("document.getElementById('cc-number').value==='4242424242424242'");
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        "['cc-name','cc-exp','cc-csc','cc-hidden','cc-readonly'].map(id=>document.getElementById(id).value)",
      ),
      ['Ada Lovelace', '2035-04', '', '', ''],
    );
    await window.loadURL(url);
    await focus('first');
    duringChoice = async () => {
      await window.webContents.executeJavaScript("document.getElementById('first').value='Typing during selection'");
    };
    await click();
    await eventually("document.getElementById('first').value==='Typing during selection'");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('street').value"), '');
    duringChoice = async () => {
      await window.loadURL(url);
    };
    await focus('cc-number');
    await click();
    await eventually("!document.querySelector('[data-yalqen-autofill]')");
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('cc-number').value"), '');
    duringChoice = async () => {};
    await window.loadURL(url);
    await window.webContents.executeJavaScript(`document.getElementById('first').addEventListener('input', () => {
      document.getElementById('street').autocomplete = 'section-other shipping street-address';
    }, { once: true })`);
    await focus('first');
    await click();
    await eventually("document.getElementById('first').value==='Ada'");
    assert.deepEqual(
      await window.webContents.executeJavaScript("['street','country'].map(id=>document.getElementById(id).value)"),
      ['', ''],
    );
    const privateWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPartition('private-autofill'),
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    windows.push(privateWindow);
    await privateWindow.loadURL(url);
    privateWindow.webContents.focus();
    await privateWindow.webContents.executeJavaScript("document.getElementById('first').focus()");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      await privateWindow.webContents.executeJavaScript("!!document.querySelector('[data-yalqen-autofill]')"),
      false,
    );
    await window.loadURL(`http://unsafe.test:${server.address().port}/`);
    window.webContents.focus();
    await window.webContents.executeJavaScript("document.getElementById('first').focus()");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      await window.webContents.executeJavaScript("!!document.querySelector('[data-yalqen-autofill]')"),
      false,
    );
    const disk = fs.readFileSync(store.file, 'utf8');
    assert.equal(disk.includes('4242424242424242'), false);
    assert.equal(disk.includes('12 Test Street'), false);
    console.log(
      'PASS: encrypted address/card selection fills only blank visible same-section fields, preserves typed data, excludes CVV/hidden/readonly fields, requires card authentication and trusted click, rejects navigation/private/insecure pages',
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
