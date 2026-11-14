import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import invitation from '../../../dist/main/app/invitation.js';
import responses from '../../../dist/main/pages/responses.js';

const { appearancePatch, invitationSources, invitationTabs } = invitation;

test('import sources split the browser from the profile and find history beside the bookmarks', () => {
  const chrome = '/Users/a/Library/Application Support/Google/Chrome/Profile 1/Bookmarks';
  const brave = '/Users/a/Library/Application Support/Brave/Default/Bookmarks';
  const firefox = '/Users/a/Firefox/Profiles/x/places.sqlite';
  const sources = invitationSources(
    [
      { label: 'Chrome — Work', file: chrome },
      { label: 'Brave — Default', file: brave },
      { label: 'Firefox — default-release', file: firefox },
    ],
    (file) => !file.includes('Brave'),
  );
  assert.deepEqual(sources, [
    {
      id: 0,
      browser: 'Chrome',
      profile: 'Work',
      bookmarks: chrome,
      history: path.join(path.dirname(chrome), 'History'),
    },
    {
      id: 1,
      browser: 'Brave',
      profile: 'Default',
      bookmarks: brave,
      history: null,
    },
    {
      id: 2,
      browser: 'Firefox',
      profile: 'default-release',
      bookmarks: firefox,
      history: firefox,
    },
  ]);
});

test('the invitation offers at most four browsers', () => {
  const many = Array.from({ length: 6 }, (_, index) => ({
    label: `Chrome — Profile ${index}`,
    file: `/p${index}/Bookmarks`,
  }));
  assert.equal(invitationSources(many, () => true).length, 4);
});

test('appearance choices map to settings', () => {
  assert.deepEqual(appearancePatch({ type: 'appearance', accent: 'mint' }), { accentColor: 'mint' });
  assert.deepEqual(appearancePatch({ type: 'appearance', theme: 'dark' }), { theme: 'dark' });
  assert.deepEqual(appearancePatch({ type: 'appearance', tabs: 'left' }), { sidebarVisible: true, panelSide: 'left' });
  assert.deepEqual(appearancePatch({ type: 'appearance', tabs: 'top' }), {
    sidebarVisible: false,
    toolbarVisible: true,
  });
  assert.equal(invitationTabs({ sidebarVisible: true }), 'left');
  assert.equal(invitationTabs({ sidebarVisible: false }), 'top');
});

test('internal pages carry the picked accent and ignore anything but a hex color', async () => {
  const page = '<!doctype html><html lang="en"><body></body></html>';
  responses.setPageAccent('#3a8ee6');
  assert.match(await responses.htmlResponse(page, "default-src 'none'").text(), /<html style="--accent: #3a8ee6" lang/);
  responses.setPageAccent('red;}body{display:none');
  assert.equal(await responses.htmlResponse(page, "default-src 'none'").text(), page);
  responses.setPageAccent(null);
  assert.equal(await responses.htmlResponse(page, "default-src 'none'").text(), page);
});
