import assert from 'node:assert/strict';
import { test } from 'node:test';
import pinned from '../../../dist/main/tabs/pinned-home.js';

const { leavesPinnedSite } = pinned;
const GMAIL = 'https://mail.google.com/mail/u/0/#inbox';

test('pages on the pinned site, its subdomains included, stay in the pinned tab', () => {
  assert.equal(leavesPinnedSite(GMAIL, 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQjgq'), false);
  assert.equal(leavesPinnedSite(GMAIL, 'https://drive.google.com/drive/'), false);
  assert.equal(leavesPinnedSite('https://www.linkedin.com/feed/', 'https://linkedin.com/in/someone'), false);
});

test('pages on another site leave the pinned tab', () => {
  assert.equal(leavesPinnedSite(GMAIL, 'https://www.nytimes.com/2026/11/11/world.html'), true);
  assert.equal(leavesPinnedSite(GMAIL, 'http://example.com/'), true);
  // Hosted tenants are separate sites, like separate apps.
  assert.equal(leavesPinnedSite('https://alice.github.io/app/', 'https://bob.github.io/'), true);
});

test('sign-in pages a pinned app sends the user through stay in the pinned tab', () => {
  const notion = 'https://www.notion.so/workspace';
  assert.equal(leavesPinnedSite(notion, 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'), false);
  assert.equal(leavesPinnedSite(notion, 'https://login.microsoftonline.com/common/oauth2/authorize'), false);
  assert.equal(leavesPinnedSite(notion, 'https://appleid.apple.com/auth/authorize'), false);
  assert.equal(leavesPinnedSite(notion, 'https://github.com/login/oauth/authorize?client_id=x'), false);
  assert.equal(leavesPinnedSite(notion, 'https://acme.okta.com/oauth2/v1/authorize'), false);
  // The rest of those sites is not a sign-in page.
  assert.equal(leavesPinnedSite(notion, 'https://github.com/YSamed/yalqen'), true);
  assert.equal(leavesPinnedSite(notion, 'https://www.google.com/search?q=yalqen'), true);
});

test('other schemes and unreadable addresses are left as they were', () => {
  assert.equal(leavesPinnedSite(GMAIL, 'mailto:someone@example.com'), false);
  assert.equal(leavesPinnedSite(GMAIL, 'yalqen://settings'), false);
  assert.equal(leavesPinnedSite(GMAIL, 'not a url'), false);
  assert.equal(leavesPinnedSite('not a url', 'https://example.com/'), false);
});
