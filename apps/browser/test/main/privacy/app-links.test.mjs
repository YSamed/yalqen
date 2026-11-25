import assert from 'node:assert/strict';
import { test } from 'node:test';
import appLinks from '../../../dist/main/privacy/app-links.js';
import permissions from '../../../dist/main/privacy/permissions.js';

const { AppLinks, appLinkScheme, appDisplayName } = appLinks;
const { PermissionStore } = permissions;

test('links to apps are told apart from pages and scripts', () => {
  for (const [url, scheme] of [
    ['slack://magic-login/abc', 'slack'],
    ['zoommtg://zoom.us/join?confno=1', 'zoommtg'],
    ['vscode://vscode.github-authentication/did-authenticate?code=1', 'vscode'],
    ['mailto:someone@example.com', 'mailto'],
  ])
    assert.equal(appLinkScheme(url), scheme);
  for (const url of [
    'https://example.com/',
    'http://localhost:8080/callback',
    'file:///tmp/a.html',
    'javascript:alert(1)',
    'data:text/html,hi',
    'yalqen://settings/',
    'chrome-extension://abc/page.html',
    'not a url',
    undefined,
  ])
    assert.equal(appLinkScheme(url), null);
  assert.equal(appDisplayName('Slack.app'), 'Slack');
  assert.equal(appDisplayName('Visual Studio Code'), 'Visual Studio Code');
});

function setup(appName = 'Slack') {
  const stores = { normal: new PermissionStore(null), private: new PermissionStore(null) };
  const prompts = [];
  let reply = { open: true, always: false };
  const links = new AppLinks({
    storeFor: (_browsing, isPrivate) => (isPrivate ? stores.private : stores.normal),
    appFor: () => appName,
    confirm: async (prompt) => {
      prompts.push(prompt);
      return reply;
    },
  });
  return { links, stores, prompts, answer: (next) => (reply = next) };
}

const SITE = 'https://app.slack.com/signin';

test('the user is asked before a site opens an app, and Cancel keeps asking', async () => {
  const { links, prompts, answer } = setup();
  answer({ open: false, always: false });
  assert.equal(await links.ask(null, 'slack://magic-login/abc', SITE, false), false);
  assert.deepEqual(prompts, [{ app: 'Slack', host: 'app.slack.com' }]);
  answer({ open: true, always: false });
  assert.equal(await links.ask(null, 'slack://magic-login/abc', SITE, false), true);
  assert.equal(prompts.length, 2);
});

test('Always allow is remembered per site, and only in the private store for private tabs', async () => {
  const { links, stores, prompts, answer } = setup();
  answer({ open: true, always: true });
  assert.equal(await links.ask(null, 'slack://magic-login/abc', SITE, true), true);
  assert.equal(stores.private.get('https://app.slack.com', 'apps'), 'allow');
  assert.equal(stores.normal.get('https://app.slack.com', 'apps'), undefined);
  assert.equal(await links.ask(null, 'slack://other', SITE, true), true);
  assert.equal(prompts.length, 1);
  stores.normal.set('https://app.slack.com', ['apps'], 'deny');
  assert.equal(await links.ask(null, 'slack://magic-login/abc', SITE, false), false);
  assert.equal(prompts.length, 1);
});

test('unnamed apps follow platform policy and non-app links are refused without a prompt', async () => {
  const none = setup('');
  none.answer({ open: false, always: false });
  assert.equal(await none.links.ask(null, 'unknown-app://x', SITE, false), false);
  assert.equal(none.prompts.length, process.platform === 'linux' ? 1 : 0);
  const { links, prompts } = setup();
  assert.equal(await links.ask(null, 'javascript:alert(1)', SITE, false), false);
  assert.equal(await links.ask(null, 'https://example.com/', SITE, false), false);
  assert.equal(prompts.length, 0);
});

test('a page that is not a web site can open an app once but not be remembered', async () => {
  const { links, stores, prompts, answer } = setup();
  answer({ open: true, always: true });
  assert.equal(await links.ask(null, 'slack://x', 'file:///Users/me/page.html', false), true);
  assert.deepEqual(prompts, [{ app: 'Slack', host: null }]);
  assert.deepEqual(stores.normal.origins(), []);
});

test('the same link asked for again while its prompt is up gets one prompt', async () => {
  const { links, prompts } = setup();
  const contents = { id: 7 };
  const [first, second] = await Promise.all([
    links.ask(contents, 'slack://magic-login/abc', SITE, false),
    links.ask(contents, 'slack://magic-login/abc', SITE, false),
  ]);
  assert.deepEqual([first, second], [true, true]);
  assert.equal(prompts.length, 1);
});
