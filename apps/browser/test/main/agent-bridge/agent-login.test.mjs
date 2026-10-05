import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import login from '../../../dist/main/agent-bridge/agent-login.js';

const { BROWSER_SCRIPT, loginUrlIn } = login;

test('the first https URL in CLI output is the sign-in page', () => {
  const output =
    'Starting local login server on http://localhost:1455.\nNavigate to this URL:\n\nhttps://auth.openai.com/oauth/authorize?a=1&redirect_uri=http%3A%2F%2Flocalhost%3A1455\n';
  assert.equal(
    loginUrlIn(output),
    'https://auth.openai.com/oauth/authorize?a=1&redirect_uri=http%3A%2F%2Flocalhost%3A1455',
  );
  assert.equal(loginUrlIn('Paste code here if prompted >'), null);
});

test('the browser stand-in records the URL it is asked to open', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yalqen-login-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const browser = path.join(directory, 'browser');
  const urlFile = path.join(directory, 'url');
  await fs.writeFile(browser, BROWSER_SCRIPT, { mode: 0o700 });
  const url = 'https://claude.com/cai/oauth/authorize?code=true&redirect_uri=http%3A%2F%2Flocalhost%3A59695%2Fcallback';
  await promisify(execFile)(browser, [url], { env: { ...process.env, YALQEN_LOGIN_URL_FILE: urlFile } });
  assert.equal(loginUrlIn(await fs.readFile(urlFile, 'utf8')), url);
});
