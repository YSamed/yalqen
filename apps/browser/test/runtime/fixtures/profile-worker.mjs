import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { app, session } from 'electron';
import profiles from '../../../dist/main/app/profiles.js';
import bookmarks from '../../../dist/main/library/bookmarks.js';
import history from '../../../dist/main/library/history.js';
import settings from '../../../dist/main/app/settings.js';
import passwords from '../../../dist/main/privacy/passwords.js';
import passwordHandlers from '../../../dist/main/privacy/password-handlers.js';

const root = process.argv.find((arg) => arg.startsWith('--test-root=')).slice('--test-root='.length);
const mode = process.argv.find((arg) => arg.startsWith('--test-mode=')).slice('--test-mode='.length);
const expected = process.argv.find((arg) => arg.startsWith('--test-value=')).slice('--test-value='.length);
const registry = new profiles.ProfileRegistry(root, 'Personal');
const selected = profiles.initializeProfile(registry, process.argv, app);
const record = (data) => fs.writeFileSync(path.join(root, `${mode}-${expected}.json`), JSON.stringify(data));
const deadline = setTimeout(() => app.exit(1), 25_000);
if (!selected.primary) {
  record({ primary: false, id: selected.profile.id });
  clearTimeout(deadline);
  registry.close();
  app.quit();
} else {
  app.on('second-instance', () => record({ activated: true }));
  app
    .whenReady()
    .then(async () => {
      const directory = app.getPath('userData');
      const browsing = session.fromPartition('persist:daily');
      assert.ok(browsing.getStoragePath().startsWith(directory));
      const store = new bookmarks.BookmarkStore(directory);
      const visits = new history.HistoryStore(directory);
      const preferences = new settings.SettingsStore(directory);
      const secrets = new passwords.PasswordStore(directory, passwordHandlers.safeStorageCipher);
      if (mode === 'write' || mode === 'stay') {
        await browsing.cookies.set({
          url: 'https://profile.example',
          name: 'account',
          value: expected,
          expirationDate: Date.now() / 1000 + 86400,
        });
        await browsing.cookies.flushStore();
        store.add(`https://${expected}.example/`, expected);
        store.saveNow();
        visits.visit(`https://${expected}.example/`, expected);
        visits.saveNow();
        preferences.update({ theme: expected === 'work' ? 'dark' : 'light' });
        assert.equal(passwordHandlers.safeStorageCipher.available(), true);
        secrets.save('https://profile.example', { username: expected, password: `${expected}-secret` });
        secrets.saveNow();
        record({ primary: true, directory, id: selected.profile.id });
      } else {
        const cookie = (await browsing.cookies.get({ name: 'account' }))[0];
        assert.equal(cookie.value, expected);
        assert.deepEqual(
          store.bookmarks().map(({ title }) => title),
          [expected],
        );
        assert.deepEqual(
          visits.list().map(({ title }) => title),
          [expected],
        );
        assert.equal(preferences.get().theme, expected === 'work' ? 'dark' : 'light');
        assert.deepEqual(
          secrets.logins('https://profile.example').map(({ username }) => username),
          [expected],
        );
        record({ verified: true, id: selected.profile.id });
      }
      if (mode === 'stay') {
        clearTimeout(deadline);
        setTimeout(() => app.quit(), 10_000);
      } else app.quit();
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
  app.on('quit', () => {
    clearTimeout(deadline);
    registry.close();
  });
}
