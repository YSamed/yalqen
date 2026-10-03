import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import playwright from '../../../dist/main/agent-bridge/playwright.js';

const { playwrightTest } = playwright;

const episode = {
  id: 'yk_ep_12345',
  start: 0,
  end: 1,
  summary: '500 Internal Server Error POST /api/users',
  events: [
    {
      id: 'e1',
      time: 0,
      kind: 'click',
      summary: 'Clicked input[name=email]',
      action: { kind: 'click', selector: 'input[name="email"]' },
    },
    {
      id: 'e2',
      time: 0,
      kind: 'input',
      summary: 'Changed input[name=email] (14 characters)',
      action: { kind: 'input', selector: 'input[name="email"]' },
    },
    {
      id: 'e3',
      time: 0,
      kind: 'key',
      summary: 'Pressed Enter',
      action: { kind: 'key', selector: "form#it's > input", key: 'Enter' },
    },
    { id: 'e4', time: 0, kind: 'request', summary: 'POST /api/users', target: 'POST /api/users' },
    { id: 'e5', time: 0, kind: 'response', summary: '500', target: 'POST /api/users', status: 500 },
    { id: 'e6', time: 0, kind: 'response', summary: 'ok', target: 'GET /api/me', status: 200 },
  ],
};

test('the generated test replays the steps and expects the failing request to succeed', () => {
  const source = playwrightTest(episode, 'http://localhost:3000/users');
  assert.match(source, /test\('POST \/api\/users succeeds'/);
  assert.match(source, /await page\.goto\('http:\/\/localhost:3000\/users'\);/);
  assert.match(source, /response0 = page\.waitForResponse\(.*'\/api\/users'.*'POST'\)/);
  assert.doesNotMatch(source, /api\/me/);
  assert.match(source, /\/\/ Yalqen does not record typed values/);
  assert.match(source, /locator\('form#it\\'s > input'\)\.press\('Enter'\)/);
  assert.match(source, /expect\(\(await response0\)\.status\(\)\)\.toBeLessThan\(400\);/);
});

test('the generated test is valid TypeScript', () => {
  const source = playwrightTest(episode, "http://localhost:3000/it's");
  const { diagnostics } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext },
  });
  assert.deepEqual(diagnostics, []);
});
