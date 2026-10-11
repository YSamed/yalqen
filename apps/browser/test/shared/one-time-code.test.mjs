import assert from 'node:assert/strict';
import { test } from 'node:test';
import codes from '../../dist/shared/one-time-code.js';

test('only signed-in webmail pages over https count as mail sources', () => {
  for (const url of [
    'https://mail.google.com/mail/u/0/#inbox',
    'https://outlook.live.com/mail/0/',
    'https://outlook.office.com/mail/inbox',
    'https://mail.yandex.com.tr/',
    'https://mail.proton.me/u/0/inbox',
    'https://www.icloud.com/mail/',
  ])
    assert.equal(codes.isWebmail(url), true, url);
  for (const url of [
    'http://mail.google.com/',
    'https://mail.google.com.example.test/',
    'https://outlook.live.com/calendar/',
    'https://www.icloud.com/photos/',
    'https://example.com/mail',
    'not a url',
  ])
    assert.equal(codes.isWebmail(url), false, url);
});

test('codes next to verification wording are found newest first without years, prices or times', () => {
  const inbox = [
    'GitHub',
    '[GitHub] Please verify your device',
    'Verification code: 482 913 — If you did not try to sign in…',
    '20:41',
    'Bankam',
    'Tek kullanımlık şifreniz',
    '734120 kodunu kimseyle paylaşmayın.',
    'Newsletter',
    'Your 2026 report is ready, save 1500 TL today',
    'Security alert at 12:45 for order 1234567890',
    'Slack confirmation code 482913',
  ].join('\n');
  assert.deepEqual(
    codes.findOneTimeCodes(inbox, 'mail.google.com').map((item) => item.code),
    ['482913', '734120'],
  );
  assert.equal(codes.findOneTimeCodes(inbox, 'mail.google.com', 1).length, 1);
  assert.equal(codes.findOneTimeCodes(inbox, 'mail.google.com')[1].context, 'Tek kullanımlık şifreniz');
  assert.deepEqual(codes.findOneTimeCodes('Lunch at 12:30\nInvoice 2025 total 4500 TL', 'mail.google.com'), []);
});

test('code fields are recognised by autocomplete or by their name', () => {
  const field = (values) => ({ autocomplete: '', name: '', id: '', type: 'text', ...values });
  assert.equal(codes.isOneTimeCodeField(field({ autocomplete: 'one-time-code' })), true);
  assert.equal(codes.isOneTimeCodeField(field({ name: 'otp_code', type: 'tel' })), true);
  assert.equal(codes.isOneTimeCodeField(field({ id: 'verificationCode' })), true);
  assert.equal(codes.isOneTimeCodeField(field({ name: 'promo-code' })), false);
  assert.equal(codes.isOneTimeCodeField(field({ name: 'otp', type: 'password' })), false);
  assert.equal(codes.isOneTimeCodeField(field({ name: 'hotpink' })), false);
});
