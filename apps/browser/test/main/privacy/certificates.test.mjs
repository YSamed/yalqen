import assert from 'node:assert/strict';
import { test } from 'node:test';
import certificates from '../../../dist/main/privacy/certificates.js';

const { CertificateExceptions } = certificates;
const URL_A = 'https://a.test:8443/page';

test('a warning page can trust only the certificate it was shown for', () => {
  const exceptions = new CertificateExceptions();
  const token = exceptions.reject(URL_A, 'fp1');
  assert.equal(exceptions.tokenFor(URL_A), token);
  assert.equal(exceptions.allows(URL_A, 'fp1'), false);

  assert.equal(exceptions.proceed('wrong', URL_A), false);
  assert.equal(exceptions.proceed(token, 'https://other.test/'), false);
  assert.equal(exceptions.proceed(token, URL_A), true);
  assert.equal(exceptions.proceed(token, URL_A), false);

  assert.equal(exceptions.allows('https://a.test:8443/other', 'fp1'), true);
  assert.equal(exceptions.allows(URL_A, 'fp2'), false);
  assert.equal(exceptions.allows('https://a.test/', 'fp1'), false);
  assert.equal(exceptions.hasException(URL_A), true);
});

test('a new warning for the same page replaces the old token', () => {
  const exceptions = new CertificateExceptions();
  const first = exceptions.reject(URL_A, 'fp1');
  const second = exceptions.reject(URL_A, 'fp2');
  assert.notEqual(first, second);
  assert.equal(exceptions.proceed(first, URL_A), false);
  assert.equal(exceptions.proceed(second, URL_A), true);
  assert.equal(exceptions.allows(URL_A, 'fp2'), true);
});

test('exceptions can be revoked and apply to https only', () => {
  const exceptions = new CertificateExceptions();
  exceptions.proceed(exceptions.reject(URL_A, 'fp1'), URL_A);
  exceptions.revoke(URL_A);
  assert.equal(exceptions.allows(URL_A, 'fp1'), false);
  assert.equal(exceptions.hasException(URL_A), false);
  assert.equal(exceptions.reject('http://a.test/', 'fp1'), null);
});
