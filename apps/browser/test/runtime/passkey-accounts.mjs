import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, session } from 'electron';
import passkeys from '../../dist/main/privacy/passkeys.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-passkey-accounts-')));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

app
  .whenReady()
  .then(async () => {
    // A test run is not a packaged, signed release, so the setting changes nothing here.
    assert.equal(passkeys.signedForPasskeys(), false);
    assert.equal(passkeys.enablePasskeys(true), false);

    // The session's account request gets the user's pick, through a callback that runs exactly once.
    const browsing = session.fromPartition('passkey-accounts');
    let reply = 1;
    const choices = [];
    passkeys.watchAccountChoices(browsing, () => async (choice) => {
      choices.push(choice);
      if (reply === 'throw') throw new Error('prompt failed');
      return reply;
    });
    const request = () =>
      new Promise((resolve) => {
        const calls = [];
        browsing.emit(
          'select-webauthn-account',
          { preventDefault() {} },
          {
            relyingPartyId: 'example.com',
            frame: null,
            accounts: [
              { credentialId: 'one', name: 'ana@example.com', displayName: 'Ana' },
              { credentialId: 'two', name: 'bo@example.com' },
            ],
          },
          (credentialId) => {
            calls.push(credentialId);
            setTimeout(() => resolve(calls), 50);
          },
        );
      });
    assert.deepEqual(await request(), ['two']);
    assert.deepEqual(choices[0], { site: 'example.com', accounts: ['Ana (ana@example.com)', 'bo@example.com'] });
    reply = null;
    assert.deepEqual(await request(), [undefined]);
    reply = 'throw';
    assert.deepEqual(await request(), [undefined]);
    console.log(
      'PASS: passkey account requests ask the user once and cancel on Cancel or failure; unsigned builds stay off',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => clearTimeout(deadline));
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
