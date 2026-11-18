import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import passkeys from '../../../dist/main/privacy/passkeys.js';

const { signedForPasskeys, enablePasskeys, accountLabel, chooseAccount, PASSKEY_KEYCHAIN_GROUP } = passkeys;

test('only a packaged Mac release with its provisioning profile turns Touch ID passkeys on', () => {
  const profile = (file) => file.endsWith(path.join('Contents', 'embedded.provisionprofile'));
  const resources = '/Applications/Yalqen.app/Contents/Resources';
  assert.equal(signedForPasskeys('darwin', true, resources, profile), true);
  assert.equal(
    signedForPasskeys('darwin', true, resources, () => false),
    false,
  );
  assert.equal(signedForPasskeys('darwin', false, resources, profile), false);
  assert.equal(signedForPasskeys('linux', true, resources, profile), false);
  assert.equal(PASSKEY_KEYCHAIN_GROUP, '7TNMJ5UM72.com.yalqen.browser.webauthn');
});

test('the setting off, or a build that is not signed for it, leaves passkeys alone', () => {
  assert.equal(enablePasskeys(false, true), false);
  assert.equal(enablePasskeys(true, false), false);
});

test('accounts read as their display name and user name', () => {
  assert.equal(
    accountLabel({ credentialId: 'a', name: 'ana@example.com', displayName: 'Ana' }, 0),
    'Ana (ana@example.com)',
  );
  assert.equal(
    accountLabel({ credentialId: 'b', name: 'bo@example.com', displayName: 'bo@example.com' }, 1),
    'bo@example.com',
  );
  assert.equal(accountLabel({ credentialId: 'c', displayName: 'Cy' }, 2), 'Cy');
  assert.match(accountLabel({ credentialId: 'd' }, 3), /4/);
});

test('picking an account returns its credential; Cancel or no account returns nothing', async () => {
  const accounts = [
    { credentialId: 'one', name: 'ana@example.com' },
    { credentialId: 'two', name: 'bo@example.com' },
  ];
  const seen = [];
  assert.equal(
    await chooseAccount('example.com', accounts, async (choice) => {
      seen.push(choice);
      return 1;
    }),
    'two',
  );
  assert.deepEqual(seen, [{ site: 'example.com', accounts: ['ana@example.com', 'bo@example.com'] }]);
  assert.equal(await chooseAccount('example.com', accounts, async () => null), undefined);
  assert.equal(await chooseAccount('example.com', [], async () => 0), undefined);
  const many = Array.from({ length: 12 }, (_, index) => ({ credentialId: `id${index}`, name: `user${index}` }));
  let shown = 0;
  await chooseAccount('example.com', many, async (choice) => {
    shown = choice.accounts.length;
    return null;
  });
  assert.equal(shown, 8);
});
