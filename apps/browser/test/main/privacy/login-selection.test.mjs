import assert from 'node:assert/strict';
import { test } from 'node:test';
import selection from '../../../dist/shared/login-selection.js';
import loginMenu from '../../../dist/main/privacy/login-menu.js';
import passwords from '../../../dist/main/privacy/passwords.js';

test('multiple accounts require a choice; a typed username matches exactly', () => {
  const choices = [
    { id: 'a', username: 'ada' },
    { id: 'g', username: 'grace' },
  ];
  assert.equal(selection.selectLogin(choices, ''), undefined);
  assert.equal(selection.selectLogin(choices, 'unknown'), undefined);
  assert.equal(selection.selectLogin(choices, ' ada ').id, 'a');
  assert.equal(selection.selectLogin([choices[0]], '').id, 'a');
  assert.equal(selection.selectLogin([], ''), undefined);
});

test('account menus select an id and contain no passwords', () => {
  let picked;
  const menu = loginMenu.loginMenuTemplate(
    [
      { id: 'a', username: 'ada' },
      { id: 'b', username: '' },
    ],
    (id) => {
      picked = id;
    },
  );
  assert.equal(menu[0].label, 'ada');
  assert.ok(menu[1].label.length > 0);
  menu[1].click();
  assert.equal(picked, 'b');
});

test('account metadata excludes secrets and filling verifies the exact origin', () => {
  const cipher = { available: () => true, encrypt: (value) => value, decrypt: (value) => value };
  const store = new passwords.PasswordStore(null, cipher);
  store.save('https://a.test', { username: 'ada', password: 'secret-a' }, 1);
  store.save('https://a.test', { username: 'grace', password: 'secret-g' }, 2);
  store.save('https://b.test', { username: 'other', password: 'secret-b' }, 3);
  const choices = store.choices('https://a.test');
  assert.deepEqual(
    choices.map((choice) => choice.username),
    ['grace', 'ada'],
  );
  assert.deepEqual(Object.keys(choices[0]), ['id', 'username']);
  assert.equal(JSON.stringify(choices).includes('secret'), false);
  assert.equal(store.login('https://b.test', choices[0].id), null);
  assert.equal(store.login('http://a.test', choices[0].id), null);
  assert.equal(store.login('https://a.test:444', choices[0].id), null);
  assert.equal(store.login('https://a.test', 'missing'), null);
  assert.deepEqual(store.login('https://a.test', choices[0].id), { username: 'grace', password: 'secret-g' });
  cipher.available = () => false;
  assert.deepEqual(store.choices('https://a.test'), []);
  assert.equal(store.login('https://a.test', choices[0].id), null);
});
