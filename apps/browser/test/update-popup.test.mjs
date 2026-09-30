import assert from 'node:assert/strict';
import { test } from 'node:test';
import updatePopup from '../dist/main/update-popup.js';

const { releaseNotesUrl, updatePopupCommand, updatePopupUrl, updatePopupVersion } = updatePopup;

test('the popup address carries the version and only plain versions are kept', () => {
  assert.equal(updatePopupUrl('0.2.12'), 'yalqen://update/?version=0.2.12');
  assert.equal(updatePopupVersion('0.2.12'), '0.2.12');
  assert.equal(updatePopupVersion('1.0.0-beta.1'), '1.0.0-beta.1');
  assert.equal(updatePopupVersion('<script>'), '');
  assert.equal(updatePopupVersion(null), '');
});

test('popup links are recognised as commands and everything else is not', () => {
  assert.equal(updatePopupCommand('yalqen://update/install'), 'install');
  assert.equal(updatePopupCommand('yalqen://update/notes'), 'notes');
  assert.equal(updatePopupCommand('yalqen://update/later'), 'later');
  assert.equal(updatePopupCommand('yalqen://update/other'), null);
  assert.equal(updatePopupCommand('https://example.com/install'), null);
});

test('release notes point at the tagged release', () => {
  assert.equal(releaseNotesUrl('0.2.12'), 'https://github.com/YSamed/yalqen/releases/tag/v0.2.12');
});
