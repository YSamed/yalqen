import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { app, BrowserWindow, session } from 'electron';
import reader from '../../dist/main/pages/reader.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-reader-'));
app.setPath('userData', root);
const windows = [];
const deadline = setTimeout(() => app.exit(1), 30_000);
const paragraph =
  'The browser should preserve the article while removing distractions. This is a detailed account of a scientific journey, with observations, careful measurements, and useful conclusions. Readers can follow the argument and compare the evidence without navigation controls interrupting their progress. ';
const article = `<title>Scientific journey</title><meta name=author content="Ada Lovelace"><nav><a href=/nav>Navigation clutter</a></nav><form><input id=draft></form><article><h1>Scientific journey</h1>${Array.from({ length: 12 }, () => `<p>${paragraph}</p>`).join('')}<p><a href=/reference>Useful reference</a> <a href="javascript:window.pwned=1" onclick="window.pwned=1">Unsafe link</a></p><form><input value="Form secret" name=secret></form><iframe src=/frame></iframe></article><aside class=advertisement>Advertisement clutter</aside>`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/strict')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'none'; script-src 'none'; img-src 'none'; require-trusted-types-for 'script'; trusted-types none",
    );
  res.end(
    req.url === '/short'
      ? '<title>Dashboard</title><input id=draft><p>Short dashboard</p>'
      : req.url === '/frame'
        ? '<input value="Frame secret">'
        : article,
  );
});
function windowFor(browsing) {
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: { session: browsing, sandbox: true, contextIsolation: true },
  });
  windows.push(window);
  return window;
}
async function shadow(contents, operation) {
  const tree = await contents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
  const all = (node) => [node, ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap(all)];
  const host = all(tree.root).find((node) => node.attributes?.includes('data-yalqen-reader'));
  assert.ok(host);
  const resolved = await contents.debugger.sendCommand('DOM.resolveNode', { nodeId: host.shadowRoots[0].nodeId });
  const result = await contents.debugger.sendCommand('Runtime.callFunctionOn', {
    objectId: resolved.object.objectId,
    functionDeclaration: `function(){${operation}}`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(contents, label) {
  const rect = await shadow(
    contents,
    `const button=[...this.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});const r=button.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`,
  );
  contents.focus();
  contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
  contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
  await new Promise((resolve) => setTimeout(resolve, 30));
}
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://localhost:${server.address().port}`;
    const window = windowFor(session.fromPartition('reader'));
    const contents = window.webContents;
    await window.loadURL(url + '/article');
    contents.focus();
    await contents.executeJavaScript(
      "window.originalDraft=document.getElementById('draft');originalDraft.value='Unsaved native text';originalDraft.focus();window.onbeforeunload=e=>{e.preventDefault();e.returnValue=''};true",
    );
    const historyLength = contents.navigationHistory.length();
    assert.equal(await reader.toggleReader(contents), true);
    assert.equal(contents.getURL(), url + '/article');
    assert.equal(contents.navigationHistory.length(), historyLength);
    assert.equal(await contents.executeJavaScript('typeof window.__yalqenReader'), 'undefined');
    contents.debugger.attach('1.3');
    const result = await shadow(
      contents,
      `const main=this.querySelector('main');return{title:main.querySelector('h1').textContent,text:main.textContent,bad:main.querySelectorAll('script,form,input,textarea,iframe,object,embed,[onclick],a[href^="javascript:"]').length,href:main.querySelector('a[href]').href,font:getComputedStyle(main).fontSize,width:this.querySelector('dialog').getBoundingClientRect().width}`,
    );
    assert.equal(result.title, 'Scientific journey');
    assert.ok(result.text.includes(paragraph));
    assert.equal(result.bad, 0);
    assert.equal(result.text.includes('Form secret'), false);
    assert.equal(result.text.includes('Frame secret'), false);
    assert.equal(result.text.includes('Navigation clutter'), false);
    assert.equal(result.text.includes('Advertisement clutter'), false);
    assert.equal(result.href, url + '/reference');
    assert.equal(result.font, '20px');
    assert.ok(result.width >= 990);
    await click(contents, 'Larger text');
    assert.equal(await shadow(contents, "return getComputedStyle(this.querySelector('main')).fontSize"), '22px');
    await click(contents, 'Return to page');
    assert.equal(await contents.executeJavaScript("!!document.querySelector('[data-yalqen-reader]')"), false);
    assert.equal(
      await contents.executeJavaScript(
        'originalDraft===document.getElementById("draft") && originalDraft.value==="Unsaved native text" && document.activeElement===originalDraft',
      ),
      true,
    );
    assert.equal(await contents.executeJavaScript('typeof window.onbeforeunload'), 'function');
    assert.equal(await reader.toggleReader(contents), true);
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(await contents.executeJavaScript("!!document.querySelector('[data-yalqen-reader]')"), false);
    assert.equal(await reader.toggleReader(contents), true);
    assert.equal(await reader.toggleReader(contents), true);
    assert.equal(await contents.executeJavaScript("!!document.querySelector('[data-yalqen-reader]')"), false);
    await contents.executeJavaScript('window.onbeforeunload=null');
    await window.loadURL(url + '/strict');
    assert.equal(await reader.toggleReader(contents), true);
    assert.ok((await shadow(contents, "return this.querySelector('dialog').getBoundingClientRect().width")) >= 990);
    assert.equal(await reader.toggleReader(contents), true);
    await window.loadURL(url + '/short');
    assert.equal(await reader.toggleReader(contents), false);
    await window.loadURL(url + '/article');
    const execute = contents.executeJavaScriptInIsolatedWorld.bind(contents);
    let calls = 0;
    contents.executeJavaScriptInIsolatedWorld = async (...args) => {
      const result = await execute(...args);
      if (++calls === 1) await window.loadURL(url + '/article');
      return result;
    };
    assert.equal(await reader.toggleReader(contents), null);
    contents.executeJavaScriptInIsolatedWorld = execute;
    assert.equal(await contents.executeJavaScript("!!document.querySelector('[data-yalqen-reader]')"), false);
    contents.debugger.detach();
    const privateWindow = windowFor(session.fromPartition('private-reader'));
    await privateWindow.loadURL(url + '/article');
    assert.equal(await reader.toggleReader(privateWindow.webContents), true);
    assert.equal(await reader.toggleReader(privateWindow.webContents), true);
    await privateWindow.loadURL('data:text/html,Internal');
    assert.equal(await reader.toggleReader(privateWindow.webContents), false);
    console.log(
      'PASS: genuine Chromium reader extracts/sanitizes article, preserves forms/history/focus, supports native font/exit/Escape controls and strict CSP, rejects same-URL navigation and works in private tabs without persistence',
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
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
