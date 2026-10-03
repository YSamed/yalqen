import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discussionPost, parseRelease, shortPost } from '../../scripts/release-announcement.mjs';

const CHANGELOG = `# Changelog

## [0.2.11](https://github.com/YSamed/yalqen/compare/v0.2.10...v0.2.11) (2026-09-30)


### Features

* autofill saved passwords and offer to save right after login ([#50](https://github.com/YSamed/yalqen/issues/50)) ([c88dc8c](https://github.com/YSamed/yalqen/commit/c88dc8c))

### Bug Fixes

* keep tabs after restart ([abc1234](https://github.com/YSamed/yalqen/commit/abc1234))

## [0.2.10](https://github.com/YSamed/yalqen/compare/v0.2.9...v0.2.10) (2026-09-29)

### Miscellaneous

* release 0.2.10 ([3b07694](https://github.com/YSamed/yalqen/commit/3b07694))
`;

test('parseRelease reads the newest release and strips links', () => {
  const release = parseRelease(CHANGELOG);
  assert.equal(release.version, '0.2.11');
  assert.equal(release.date, '2026-09-30');
  assert.deepEqual(release.sections.Features, ['Autofill saved passwords and offer to save right after login']);
  assert.deepEqual(release.sections['Bug Fixes'], ['Keep tabs after restart']);
});

test('parseRelease finds a given version and returns null for an unknown one', () => {
  assert.equal(parseRelease(CHANGELOG, '0.2.10').version, '0.2.10');
  assert.equal(parseRelease(CHANGELOG, '9.9.9'), null);
});

test('shortPost lists highlights and links the release', () => {
  const post = shortPost(parseRelease(CHANGELOG));
  assert.match(post, /^Yalqen 0\.2\.11 is out\./);
  assert.match(post, /• Autofill saved passwords/);
  assert.match(post, /• Keep tabs after restart/);
  assert.match(post, /releases\/tag\/v0\.2\.11$/);
});

test('shortPost stays within 300 characters and counts what it leaves out', () => {
  const release = {
    version: '1.0.0',
    date: null,
    sections: { Features: Array.from({ length: 20 }, (_, index) => `Feature number ${index} with a fairly long name`) },
  };
  const post = shortPost(release);
  assert.ok(post.length <= 300, `${post.length} characters`);
  assert.match(post, /…and \d+ more/);
});

test('discussionPost falls back to a maintenance note without highlights', () => {
  const post = discussionPost(parseRelease(CHANGELOG, '0.2.10'));
  assert.match(post, /^## Yalqen 0\.2\.10 \(2026-09-29\)/);
  assert.match(post, /Maintenance release\./);
  assert.doesNotMatch(post, /Miscellaneous/);
});
