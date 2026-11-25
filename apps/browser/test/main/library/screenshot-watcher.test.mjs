import assert from 'node:assert/strict';
import { test } from 'node:test';
import screenshotWatcher from '../../../dist/main/library/screenshot-watcher.js';

const { isScreenshotCandidate, screenshotFolderFrom } = screenshotWatcher;

test('screenshot candidates skip the hidden temp files macOS writes first', () => {
  assert.equal(isScreenshotCandidate('Ekran Resmi 2026-11-25 10.12.03.png'), true);
  assert.equal(isScreenshotCandidate('.Ekran Resmi 2026-11-25 10.12.03.png-Qx1'), false);
  assert.equal(isScreenshotCandidate(''), false);
  assert.equal(isScreenshotCandidate('nested/file.png'), false);
});

test('the screenshot folder follows the system setting and falls back to the desktop', () => {
  assert.equal(screenshotFolderFrom('~/Pictures/Shots\n', '/Users/me'), '/Users/me/Pictures/Shots');
  assert.equal(screenshotFolderFrom('/Volumes/Shots', '/Users/me'), '/Volumes/Shots');
  assert.equal(screenshotFolderFrom('', '/Users/me'), '/Users/me/Desktop');
  assert.equal(screenshotFolderFrom('relative', '/Users/me'), '/Users/me/Desktop');
});
