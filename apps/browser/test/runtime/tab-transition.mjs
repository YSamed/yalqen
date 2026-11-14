import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import tabs from '../../dist/main/tabs/tabs.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tab-motion-'));
app.setPath('userData', profile);
// Windows native occlusion tracking marks the window hidden as soon as another window covers it,
// which makes the renderer report document.hidden and suppresses the fade. The fade gate is right
// to ignore hidden pages, so disable the tracking and let visibility reflect the tab switch.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
let stage = 'Electron ready';
const deadline = setTimeout(() => {
  console.error(`Timed out waiting for ${stage}`);
  app.exit(1);
}, 25_000);
let window;
let manager;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app
  .whenReady()
  .then(async () => {
    stage = 'test pages to load';
    window = new BrowserWindow({ width: 800, height: 600, show: true });
    manager = new tabs.TabManager({
      window,
      onChange() {},
      onHtmlFullScreenChange() {},
      freezeBackground: () => false,
    });
    manager.setPageLayout({ x: 0, y: 0, width: 800, height: 600 }, 0);
    for (const id of ['a', 'b']) {
      const tab = manager.createRecord({ id, url: 'data:text/html,test' });
      tab.view = new WebContentsView({
        webPreferences: {
          preload: path.resolve('dist/preload/page-preload.js'),
          sandbox: true,
          contextIsolation: true,
        },
      });
      manager.tabs.push(tab);
      await tab.view.webContents.loadURL(
        `data:text/html,${encodeURIComponent(`
      <style>html { opacity: 0.7; background: #182532; } button { position: fixed; left: 40px; top: 40px; width: 120px; height: 50px; }</style>
      <button onclick="window.clicked=true">Tab ${id}</button>
    `)}`,
      );
    }
    manager.activeId = 'a';
    const [a, b] = manager.tabs;
    manager.placement.place(a, a.view);
    window.contentView.addChildView(a.view);
    const contents = b.view.webContents;
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Animation.enable');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    // A freshly attached WebContentsView reports itself hidden until Chromium propagates the
    // visibility change to its renderer, which on a cold first paint can exceed any fixed delay.
    // The fade gate legitimately refuses to run while the page is hidden, so wait for the view to
    // actually report the expected state instead of guessing a timeout before timing the switch.
    const waitHidden = async (hidden) => {
      const until = Date.now() + 5000;
      while ((await contents.executeJavaScript('document.hidden')) !== hidden) {
        if (Date.now() > until) throw new Error(`Tab view visibility never settled (expected hidden=${hidden})`);
        await delay(25);
      }
    };
    manager.activate('b');
    await waitHidden(false);
    manager.activate('a');
    await waitHidden(true);
    await delay(100);
    let paused;
    let resolveStarted;
    const started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    contents.debugger.on('message', (_event, method, params) => {
      if (method !== 'Animation.animationStarted' || params.animation.name !== 'yalqen-tab-transition') return;
      paused = contents.debugger.sendCommand('Animation.setPaused', {
        animations: [params.animation.id],
        paused: true,
      });
      resolveStarted(params.animation.id);
    });
    manager.activate('b', true);
    assert.equal(manager.activeTabId, 'b');
    stage = 'tab animation to start';
    const animationId = await Promise.race([
      started,
      delay(5000).then(async () => {
        const state = await contents.executeJavaScript(
          'JSON.stringify({ready:document.readyState,hidden:document.hidden,motion:matchMedia("(prefers-reduced-motion: reduce)").matches})',
        );
        throw new Error(`Tab animation did not start: ${state}`);
      }),
    ]);
    await paused;
    await contents.debugger.sendCommand('Animation.seekAnimations', { animations: [animationId], currentTime: 50 });
    const during = await contents.executeJavaScript(`(() => {
    const rect = document.querySelector('button').getBoundingClientRect();
    return { opacity: Number(getComputedStyle(document.documentElement).opacity), x: rect.x, y: rect.y,
      duration: document.getAnimations().find(a => a.id === 'yalqen-tab-transition').effect.getTiming().duration };
  })()`);
    assert.equal(during.duration, 140);
    assert.ok(during.opacity > 0.616 && during.opacity < 0.7);
    assert.equal(during.x, 40);
    assert.equal(during.y, 40);
    contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 70, y: 60 });
    contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 70, y: 60 });
    await delay(30);
    assert.equal(await contents.executeJavaScript('window.clicked === true'), true);
    manager.activate('a');
    manager.activate('b');
    await delay(50);
    assert.equal(
      await contents.executeJavaScript("document.getAnimations().filter(a => a.id === 'yalqen-tab-transition').length"),
      0,
    );
    assert.equal(await contents.executeJavaScript('getComputedStyle(document.documentElement).opacity'), '0.7');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    manager.activate('a');
    manager.activate('b', true);
    await delay(30);
    assert.equal(
      await contents.executeJavaScript("document.getAnimations().filter(a => a.id === 'yalqen-tab-transition').length"),
      0,
    );
    console.log(
      'PASS: real tab switch fades for 140ms, accepts clicks during motion, preserves fixed layout and site opacity, cancels on fast switches and respects reduced motion',
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(() => {
  clearTimeout(deadline);
  manager?.destroyAll();
  window?.destroy();
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
