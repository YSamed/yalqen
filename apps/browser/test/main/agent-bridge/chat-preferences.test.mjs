import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import preferencesModule from '../../../dist/main/agent-bridge/chat-preferences.js';

const { ChatPreferenceStore, FALLBACK_MODELS } = preferencesModule;

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-chat-preferences-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('offers fallback models before Claude has listed any', () => {
  const store = new ChatPreferenceStore(null);
  assert.deepEqual(store.get(), { modelChoice: null, effort: null, models: FALLBACK_MODELS });
});

test('keeps the chosen model, effort and model list across restarts', (t) => {
  const dir = directory(t);
  const store = new ChatPreferenceStore(dir);
  store.set({
    modelChoice: 'opus',
    effort: 'xhigh',
    models: [{ value: 'opus', label: 'Opus 5.5', efforts: ['low', 'xhigh', 'bogus'] }],
  });
  store.saveNow();
  assert.deepEqual(new ChatPreferenceStore(dir).get(), {
    modelChoice: 'opus',
    effort: 'xhigh',
    models: [{ value: 'opus', label: 'Opus 5.5', efforts: ['low', 'xhigh'] }],
  });
});

test('drops invalid saved values', (t) => {
  const dir = directory(t);
  fs.writeFileSync(
    path.join(dir, 'agent-chat.json'),
    JSON.stringify({ version: 1, modelChoice: 42, effort: 'turbo', models: [{ value: '', label: 'x' }] }),
  );
  assert.deepEqual(new ChatPreferenceStore(dir).get(), { modelChoice: null, effort: null, models: FALLBACK_MODELS });
});
