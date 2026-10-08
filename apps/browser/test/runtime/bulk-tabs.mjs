import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bulk-tabs-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
let window;
let manager;
app
  .whenReady()
  .then(async () => {
    window = new BaseWindow({ show: false });
    let privateEnded = 0;
    manager = new tabs.TabManager({
      window,
      freezeBackground: () => false,
      onHtmlFullScreenChange() {},
      onChange() {},
      onPrivateEnded: () => privateEnded++,
      closed: [],
    });
    const add = async (id, html, isPrivate = false) => {
      const view = new WebContentsView();
      window.contentView.addChildView(view);
      await view.webContents.loadURL(`data:text/html,${encodeURIComponent(html)}`);
      const tab = manager.createRecord({ id, url: view.webContents.getURL(), title: id }, isPrivate);
      tab.view = view;
      manager.tabs.push(tab);
      return tab;
    };
    const source = await add('source', '<p>Keep source</p>');
    const clean = await add('clean', '<input id="text" value="clean page survives cancellation">');
    const draft = await add(
      'draft',
      '<input id="text" value="keep draft"><script>window.onbeforeunload = () => "draft"</script>',
      true,
    );
    const pinned = await add('pinned', '<p>Keep pinned</p>');
    pinned.pinnedUrl = pinned.url;
    manager.activeId = clean.id;
    let leave = false;
    draft.view.webContents.on('will-prevent-unload', (event) => {
      if (leave) event.preventDefault();
    });
    manager.selectTab(draft.id, 'toggle');
    assert.deepEqual(manager.selectedTabIds, ['clean', 'draft']);
    assert.equal(await manager.closeSelected(), false);
    assert.equal(manager.count, 4);
    assert.equal(manager.options.closed.length, 0);
    assert.equal(privateEnded, 0);
    assert.equal(await clean.view.webContents.executeJavaScript('text.value'), 'clean page survives cancellation');
    assert.equal(await draft.view.webContents.executeJavaScript('text.value'), 'keep draft');
    const cleanContents = clean.view.webContents;
    const draftContents = draft.view.webContents;
    leave = true;
    assert.equal(await manager.closeSelected(), true);
    assert.deepEqual(
      manager.tabs.map(({ id }) => id),
      ['source', 'pinned'],
    );
    assert.equal(manager.activeTabId, source.id);
    await Promise.all(
      [cleanContents, draftContents].map((contents) =>
        contents.isDestroyed() ? Promise.resolve() : new Promise((resolve) => contents.once('destroyed', resolve)),
      ),
    );
    assert.equal(cleanContents.isDestroyed(), true);
    assert.equal(draftContents.isDestroyed(), true);
    assert.equal(pinned.view.webContents.isDestroyed(), false);
    assert.equal(privateEnded, 1);
    assert.deepEqual(
      manager.options.closed.map(({ id }) => id),
      ['clean'],
    );
    console.log(
      'PASS: real selected-tab close cancels atomically, preserves forms and pinned tabs, then closes with private history isolation',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  manager?.destroyAll();
  window?.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error('Bulk tabs test profile cleanup failed:', error);
  }
});
