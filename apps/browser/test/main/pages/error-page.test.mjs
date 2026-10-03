import assert from 'node:assert/strict';
import { test } from 'node:test';
import errorPage from '../../../dist/main/pages/error-page.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { describeError, errorPageHtml, errorPageScript } = errorPage;

test('common failures get a specific explanation', () => {
  assert.equal(describeError(-106, 'https://a.com/').title, 'İnternet bağlantısı yok');
  assert.equal(describeError(-105, 'https://a.com/x').message, 'a.com sunucusunun adresi bulunamadı.');
  assert.equal(describeError(-102, 'http://localhost:3000/').message, 'localhost:3000 bağlanmayı reddetti.');
  assert.equal(describeError(-118, 'https://a.com/').message, 'a.com çok uzun süre yanıt vermedi.');
  assert.equal(describeError(-202, 'https://a.com/').title, 'Bağlantı güvenli değil');
  assert.match(describeError(-202, 'https://a.com/').message, /^a\.com için güvenli bir bağlantı kurulamadı\./);
  assert.equal(describeError(-999, 'https://a.com/').title, 'Bu sayfa açılamadı');
});

test('page text is escaped', () => {
  const html = errorPageHtml(-105, 'ERR_<b>', 'https://<script>.com/');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('ERR_<b>'));
  assert.ok(html.includes('ERR_&#60;b&#62;'));
});

test('the script only replaces Chromium error documents and retries the failed address', () => {
  const url = 'https://a.com/?q=\'"</script>';
  const script = errorPageScript(-105, 'ERR_NAME_NOT_RESOLVED', url);
  let replaced = null;
  const run = (protocol) => {
    const document = {
      documentElement: { innerHTML: '' },
      getElementById: (id) => (id === 'retry' ? { addEventListener: (_type, listener) => listener() } : null),
    };
    new Function('location', 'document', script)({ protocol, replace: (next) => (replaced = next) }, document);
    return document.documentElement.innerHTML;
  };
  assert.equal(run('https:'), '');
  assert.equal(replaced, null);
  assert.match(run('chrome-error:'), /Bu siteye ulaşılamıyor/);
  assert.equal(replaced, url);
});

test('HTTPS-only warnings explain the missing https and offer http', () => {
  const html = errorPageHtml(-107, 'ERR_SSL_PROTOCOL_ERROR', 'https://old.example/', 'yalqen://proceed-http/t', true);
  assert.match(html, /Bu site güvenli bağlantıyı desteklemiyor/);
  assert.match(html, /old\.example HTTPS ile açılamadı/);
  assert.match(html, /HTTP ile devam et \(güvenli değil\)/);
  assert.doesNotMatch(html, /id="retry"/);
});

test('certificate warnings offer to go back or proceed instead of retrying', () => {
  const html = errorPageHtml(-202, 'ERR_CERT_AUTHORITY_INVALID', 'https://a.com/', 'yalqen://proceed/t');
  assert.match(html, /id="back"/);
  assert.match(html, /id="proceed"/);
  assert.doesNotMatch(html, /id="retry"/);

  let assigned = null;
  const clicks = new Set(['proceed']);
  const document = {
    documentElement: { innerHTML: '' },
    getElementById: (id) => ({ addEventListener: (_type, listener) => clicks.has(id) && listener() }),
  };
  const script = errorPageScript(-202, 'ERR_CERT_AUTHORITY_INVALID', 'https://a.com/', 'yalqen://proceed/t');
  new Function('location', 'document', 'history', script)(
    { protocol: 'chrome-error:', assign: (next) => (assigned = next), replace: () => {} },
    document,
    { length: 2, back: () => {} },
  );
  assert.equal(assigned, 'yalqen://proceed/t');
});
