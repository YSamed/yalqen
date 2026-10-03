import assert from 'node:assert/strict';
import { test } from 'node:test';
import hosts from '../../dist/shared/hosts.js';

const { displayHost, hostOf, isDevelopmentHost } = hosts;

test('hostOf returns the host of a URL', () => {
  assert.equal(hostOf('https://example.com/path?q=1'), 'example.com');
  assert.equal(hostOf('http://localhost:3000/x'), 'localhost:3000');
});

test('hostOf returns null for invalid or host-less input', () => {
  assert.equal(hostOf('not a url'), null);
  assert.equal(hostOf(''), null);
  assert.equal(hostOf('about:blank'), null);
});

test('displayHost strips a leading www. only', () => {
  assert.equal(displayHost('https://www.example.com/a'), 'example.com');
  assert.equal(displayHost('https://example.com/a'), 'example.com');
  assert.equal(displayHost('https://docs.www.example.com/'), 'docs.www.example.com');
  assert.equal(displayHost('https://wwwexample.com/'), 'wwwexample.com');
});

test('displayHost falls back to the input for invalid URLs', () => {
  assert.equal(displayHost('not a url'), 'not a url');
  assert.equal(displayHost('about:blank'), 'about:blank');
});

test('isDevelopmentHost accepts local addresses', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', '[::1]']) {
    assert.equal(isDevelopmentHost(host), true, host);
  }
});

test('isDevelopmentHost accepts local suffixes', () => {
  for (const host of ['app.localhost', 'myapp.test', 'printer.local', 'APP.TEST']) {
    assert.equal(isDevelopmentHost(host), true, host);
  }
});

test('isDevelopmentHost rejects other hosts', () => {
  for (const host of ['localhost.com', '128.0.0.1', 'test.example.com', 'example.com', '127.0.0', '127.0.0.1.5', '']) {
    assert.equal(isDevelopmentHost(host), false, host);
  }
});
