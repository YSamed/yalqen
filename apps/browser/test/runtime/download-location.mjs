// Run after build:main: electron test/runtime/download-location.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, session } from 'electron';
import downloads from '../../dist/main/library/download-manager.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-download-test-'));
app.setPath('userData', profile);
let manager;
const deadline = setTimeout(() => app.exit(1), 30_000);

app
  .whenReady()
  .then(async () => {
    const destination = path.join(profile, 'renamed.txt');
    let complete;
    const finished = new Promise((resolve, reject) => {
      complete = { resolve, reject };
    });
    const entries = new Map();
    const store = {
      add: (entry) => entries.set(entry.id, entry),
      update: (id, patch) => {
        const entry = Object.assign(entries.get(id), patch);
        if (entry.state === 'completed') complete.resolve(entry);
        else if (['interrupted', 'cancelled'].includes(entry.state)) complete.reject(new Error(entry.state));
      },
    };
    manager = new downloads.DownloadManager(
      {
        store,
        daily: session.fromPartition('download-test'),
        privateBrowsing: session.fromPartition('private-download-test'),
        developer: session.fromPartition('developer-download-test'),
        directory: () => profile,
        askBeforeDownload: () => false,
        askDownloadLocation: () => true,
        parentOf: () => undefined,
        onStateChange: () => {},
      },
      {
        showSaveDialog: async () => ({ canceled: false, filePath: destination }),
        showMessageBox: async () => {
          throw new Error('the save chooser should be the only prompt');
        },
      },
    );
    session.fromPartition('download-test').downloadURL('data:application/octet-stream,download%20location%20test');
    const entry = await finished;
    assert.equal(entry.filename, 'renamed.txt');
    assert.equal(entry.savePath, destination);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'download location test');
    console.log('PASS: real paused DownloadItem saved selected name, path and complete bytes');
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  manager?.destroy();
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
