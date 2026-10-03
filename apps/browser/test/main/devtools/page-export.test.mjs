import assert from 'node:assert/strict';
import { test } from 'node:test';
import pageExport from '../../../dist/main/devtools/page-export.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { canViewSource, formatAddress, fullPageClip, pageFileName } = pageExport;
const pdfFileName = (title, url) => pageFileName(title, url, 'pdf');

test('PDF names come from the title, cleaned for file systems', () => {
  assert.equal(pdfFileName('Haberler: Gündem / Son dakika?', 'https://a.com/'), 'Haberler Gündem Son dakika.pdf');
  assert.equal(pdfFileName('  ..gizli.. ', 'https://a.com/'), 'gizli.pdf');
  assert.equal(pdfFileName('x'.repeat(200), 'https://a.com/'), `${'x'.repeat(120)}.pdf`);
});

test('pages without a title use their host', () => {
  assert.equal(pdfFileName('', 'https://www.example.com/a'), 'example.com.pdf');
  assert.equal(pdfFileName('https://example.com/a', 'https://example.com/a'), 'example.com.pdf');
  assert.equal(pdfFileName('', 'about:blank'), 'sayfa.pdf');
});

test('only web pages and files have a source to show', () => {
  assert.equal(canViewSource('https://a.com/'), true);
  assert.equal(canViewSource('file:///tmp/a.html'), true);
  assert.equal(canViewSource('view-source:https://a.com/'), false);
  assert.equal(canViewSource('yalqen://newtab/'), false);
});

test('screenshots share the page file name', () => {
  assert.equal(pageFileName('Yalqen', 'https://a.com/', 'png'), 'Yalqen.png');
});

test('addresses are copied as plain, Markdown or curl text', () => {
  const url = 'https://a.com/wiki/Foo_(bar)?q=1';
  assert.equal(formatAddress('url', url, 'Foo'), url);
  assert.equal(formatAddress('markdown', url, 'Foo [beta]'), '[Foo \\[beta\\]](https://a.com/wiki/Foo_%28bar%29?q=1)');
  assert.equal(formatAddress('markdown', 'https://a.com/', '  '), '[https://a.com/](https://a.com/)');
  assert.equal(formatAddress('curl', "https://a.com/it's", ''), "curl -L 'https://a.com/it'\\''s'");
});

test('full page captures preserve normal pages at their original scale', () => {
  assert.deepEqual(fullPageClip({ width: 1280.4, height: 5000.2 }, 2), {
    x: 0,
    y: 0,
    width: 1281,
    height: 5001,
    scale: 1,
  });
  assert.equal(fullPageClip({ width: 0, height: 0 }, 1).width, 1);
});

test('long and wide pages scale uniformly instead of losing their bottom or right edge', () => {
  for (const pixelRatio of [0.5, 1, 2, 3]) {
    for (const content of [
      { width: 1280, height: 50000 },
      { width: 50000, height: 1280 },
    ]) {
      const clip = fullPageClip(content, pixelRatio);
      assert.equal(clip.width, content.width);
      assert.equal(clip.height, content.height);
      assert.ok(clip.width * clip.scale * Math.max(1, pixelRatio) <= 16384);
      assert.ok(clip.height * clip.scale * Math.max(1, pixelRatio) <= 16384);
      assert.ok(clip.scale > 0 && clip.scale < 1);
    }
  }
});
