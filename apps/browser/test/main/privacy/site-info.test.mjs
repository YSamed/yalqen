import assert from 'node:assert/strict';
import { test } from 'node:test';
import siteInfo from '../../../dist/main/privacy/site-info.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { securityState, siteInfoTemplate } = siteInfo;

test('web pages are secure over https and insecure over http', () => {
  assert.equal(securityState('https://example.com/'), 'secure');
  assert.equal(securityState('https://example.com/', true), 'dangerous');
  assert.equal(securityState('http://example.com/', true), 'insecure');
  assert.equal(securityState('http://example.com/'), 'insecure');
  assert.equal(securityState('http://localhost:3000/'), 'insecure');
});

test('pages not fetched from a site have no connection state', () => {
  for (const url of ['yalqen://newtab/', 'about:blank', 'file:///tmp/a.html', 'data:text/plain,x', 'not a url']) {
    assert.equal(securityState(url), 'local', url);
  }
});

test('the menu names the site and its connection', () => {
  const labels = (info) => siteInfoTemplate({ permissions: [], ...info }, {}).map((item) => item.label);
  assert.deepEqual(labels({ url: 'https://www.example.com/a', security: 'secure' }), [
    'www.example.com',
    'Bağlantı güvenli',
  ]);
  assert.deepEqual(labels({ url: 'http://example.com:8080/', security: 'insecure' }), [
    'example.com:8080',
    'Bu siteye bağlantı güvenli değil',
  ]);
});

test('a trusted invalid certificate can be distrusted again', () => {
  let revoked = false;
  const items = siteInfoTemplate(
    { url: 'https://a.test/', security: 'dangerous', permissions: [] },
    { revokeCertificateException: () => (revoked = true) },
  );
  assert.equal(items[1].label, 'Geçersiz sertifika yok sayılarak bağlanıldı');
  items.find((item) => item.label === 'Sertifika uyarılarını yeniden aç').click();
  assert.equal(revoked, true);
});

test('saved permissions can be changed from the menu', () => {
  const changes = [];
  const items = siteInfoTemplate(
    {
      url: 'https://a.test/',
      security: 'secure',
      permissions: [
        { kind: 'camera', decision: 'allow' },
        { kind: 'notifications', decision: 'deny' },
      ],
    },
    { setPermission: (kind, decision) => changes.push([kind, decision]) },
  );
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    ['a.test', 'Bağlantı güvenli', '-', 'Kamera: İzin verildi', 'Bildirimler: Engellendi'],
  );
  const camera = items[3].submenu;
  assert.deepEqual(
    camera.map((item) => [item.label, item.checked]),
    [
      ['Sor', false],
      ['İzin ver', true],
      ['Engelle', false],
    ],
  );
  camera[0].click();
  items[4].submenu[1].click();
  assert.deepEqual(changes, [
    ['camera', null],
    ['notifications', 'allow'],
  ]);
});

test('site protection checkboxes show effective state and disable globally inactive protections', () => {
  const changes = [];
  const items = siteInfoTemplate(
    {
      url: 'https://example.com/',
      security: 'secure',
      permissions: [],
      protections: {
        adBlocking: false,
        blockThirdPartyCookies: false,
        adBlockingEnabled: true,
        cookieBlockingEnabled: false,
      },
    },
    { setProtection: (kind, blocked) => changes.push([kind, blocked]) },
  );
  const choices = items.filter((item) => item.type === 'checkbox');
  assert.equal(choices.length, 2);
  assert.equal(choices[0].checked, false);
  assert.equal(choices[0].enabled, true);
  assert.equal(choices[1].enabled, false);
  choices[0].click({ checked: true });
  assert.deepEqual(changes, [['adBlocking', true]]);
});
