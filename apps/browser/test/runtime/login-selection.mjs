import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import passwords from '../../dist/main/privacy/passwords.js';
import handlers from '../../dist/main/privacy/password-handlers.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-login-runtime-'));
app.setPath('userData', profile);
const windows = [];
const allowed = new Set();
const deadline = setTimeout(() => app.exit(1), 35_000);
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-src 'self'; style-src 'none'; script-src 'unsafe-inline'",
  );
  if (request.url === '/iframe') response.end('<iframe src="/login"></iframe>');
  else if (request.url === '/signup')
    response.end(
      '<form><input autocomplete="username"><input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"></form>',
    );
  else
    response.end(`<form><input id="username" autocomplete="username" ${request.url === '/readonly' ? 'value="ada" readonly' : ''}><input id="password" type="password" autocomplete="current-password"></form>
    <script>window.inputEvents=[];document.addEventListener('input', e=>inputEvents.push(e.target.id));</script>`);
});

async function eventually(contents, predicate) {
  const start = Date.now();
  while (!(await contents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function clickPicker(contents) {
  const rect = await contents.executeJavaScript(`(() => {
    const r = document.querySelector('[data-yalqen-login-picker]').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  contents.focus();
  contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
  contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
}

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const store = new passwords.PasswordStore(null, {
      available: () => true,
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
    store.save(origin, { username: 'ada', password: 'secret-a' }, 1);
    store.save(origin, { username: 'grace', password: 'secret-g' }, 2);
    let selected = store.choices(origin).find((choice) => choice.username === 'ada').id;
    let gate;
    let prompts = 0;
    handlers.installPasswordHandlers({
      store,
      savesPasswords: (contents) => allowed.has(contents),
      isSettingsFrame: () => false,
      parentOf: (contents) => windows.find((window) => window.webContents === contents),
      onChange: () => {},
      chooseAccount: async () => {
        prompts++;
        if (gate) await gate.promise;
        return selected;
      },
    });
    const open = async (url, privatePage = false) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.resolve('dist/preload/page-preload.js'),
          sandbox: true,
          contextIsolation: true,
        },
      });
      windows.push(window);
      if (!privatePage) allowed.add(window.webContents);
      await window.loadURL(url);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return window.webContents;
    };
    const page = await open(`${origin}/login`);
    await eventually(page, "!!document.querySelector('[data-yalqen-login-picker]')");
    assert.deepEqual(await page.executeJavaScript('[username.value,password.value]'), ['', '']);
    assert.equal(await page.executeJavaScript("document.documentElement.outerHTML.includes('secret-a')"), false);
    assert.equal(await page.executeJavaScript("document.querySelector('[data-yalqen-login-picker]').shadowRoot"), null);
    // Scripted clicks cannot open the native account menu.
    await page.executeJavaScript("document.querySelector('[data-yalqen-login-picker]').click()");
    assert.equal(prompts, 0);
    await clickPicker(page);
    await eventually(page, "password.value === 'secret-a'");
    assert.equal(await page.executeJavaScript('username.value'), 'ada');
    assert.deepEqual(await page.executeJavaScript('inputEvents'), ['username', 'password']);
    selected = store.choices(origin).find((choice) => choice.username === 'grace').id;
    await clickPicker(page);
    await eventually(page, "password.value === 'secret-g'");
    assert.equal(await page.executeJavaScript('username.value'), 'grace');

    let release;
    gate = {
      promise: new Promise((resolve) => {
        release = resolve;
      }),
    };
    await clickPicker(page);
    while (prompts < 3) await new Promise((resolve) => setTimeout(resolve, 30));
    await page.executeJavaScript("password.value = 'typed-during-choice'");
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await page.executeJavaScript('password.value'), 'typed-during-choice');

    gate = {
      promise: new Promise((resolve) => {
        release = resolve;
      }),
    };
    await clickPicker(page);
    while (prompts < 4) await new Promise((resolve) => setTimeout(resolve, 30));
    await page.loadURL(`http://localhost:${server.address().port}/login`);
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await page.executeJavaScript('password.value'), '');
    gate = null;
    const privatePage = await open(`${origin}/login`, true);
    assert.equal(await privatePage.executeJavaScript("!!document.querySelector('[data-yalqen-login-picker]')"), false);
    const signup = await open(`${origin}/signup`);
    assert.equal(await signup.executeJavaScript("!!document.querySelector('[data-yalqen-login-picker]')"), false);
    const framed = await open(`${origin}/iframe`);
    assert.equal(
      await framed.executeJavaScript(
        "!!document.querySelector('iframe').contentDocument.querySelector('[data-yalqen-login-picker]')",
      ),
      false,
    );
    store.remove(store.choices(origin).find((choice) => choice.username === 'ada').id);
    const single = await open(`${origin}/login`);
    await eventually(single, "password.value === 'secret-g'");
    const readonly = await open(`${origin}/readonly`);
    assert.equal(await readonly.executeJavaScript('password.value'), '');
    console.log(
      'PASS: real password choice, account switching, input events, navigation and private/frame/form safeguards',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  for (const window of windows) window.destroy();
  server.close();
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
