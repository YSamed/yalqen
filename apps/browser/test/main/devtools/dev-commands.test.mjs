import assert from 'node:assert/strict';
import { test } from 'node:test';
import devCommands from '../../../dist/main/devtools/dev-commands.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { devCommands: commands, autoReloadSeconds, isDevCommandId, isDevCommandInput, matchDevCommands } = devCommands;

test('only input starting with > is a command', () => {
  assert.equal(isDevCommandInput('>cache'), true);
  assert.equal(isDevCommandInput('  > cache'), true);
  assert.equal(isDevCommandInput('cache'), false);
  assert.equal(isDevCommandInput('a > b'), false);
});

test('a bare prefix lists every command', () => {
  assert.deepEqual(
    matchDevCommands('>').map((item) => item.commandId),
    commands().map((command) => command.id),
  );
});

test('commands match Turkish titles and English keywords', () => {
  assert.deepEqual(
    matchDevCommands('>önbelle').map((item) => item.commandId),
    ['hard-reload', 'toggle-cache', 'clear-cache'],
  );
  assert.deepEqual(
    matchDevCommands('>markdown').map((item) => item.commandId),
    ['copy-markdown'],
  );
  assert.deepEqual(
    matchDevCommands('>yenile 30').map((item) => item.commandId),
    ['auto-reload-30'],
  );
  assert.deepEqual(
    matchDevCommands('>cookies').map((item) => item.commandId),
    ['clear-site-data'],
  );
  assert.deepEqual(
    matchDevCommands('> CİHAZ döndür').map((item) => item.commandId),
    ['rotate-device'],
  );
  assert.deepEqual(matchDevCommands('>nothing-like-this'), []);
});

test('suggestions carry a unique key and the shortcut hint', () => {
  const [reload] = matchDevCommands('>hard');
  assert.deepEqual(reload, {
    kind: 'command',
    title: 'Önbelleği yok sayarak yenile',
    url: '>hard-reload',
    commandId: 'hard-reload',
    hint: '⇧⌘R',
  });
  assert.equal(new Set(matchDevCommands('>').map((item) => item.url)).size, commands().length);
});

test('command ids are validated', () => {
  assert.equal(isDevCommandId('devtools'), true);
  assert.equal(isDevCommandId('rm -rf'), false);
  assert.equal(isDevCommandId(undefined), false);
});

test('auto reload commands carry their interval', () => {
  assert.equal(autoReloadSeconds('auto-reload-10'), 10);
  assert.equal(autoReloadSeconds('auto-reload-off'), null);
  assert.equal(autoReloadSeconds('devtools'), null);
  assert.equal(matchDevCommands('>otomatik yenile 1 dk')[0].title, 'Otomatik yenile: 1 dk');
});

test('override commands map to a patch of the current state', () => {
  const { overridePatch } = devCommands;
  const current = {
    cacheDisabled: true,
    network: null,
    colorScheme: null,
    reducedMotion: false,
    printMedia: true,
    userAgent: null,
  };
  assert.deepEqual(overridePatch('network-fast-4g', current), { network: 'fast-4g' });
  assert.deepEqual(overridePatch('network-online', current), { network: null });
  assert.deepEqual(overridePatch('user-agent-safari', current), { userAgent: 'safari' });
  assert.deepEqual(overridePatch('toggle-cache', current), { cacheDisabled: false });
  assert.deepEqual(overridePatch('toggle-print-media', current), { printMedia: false });
  assert.deepEqual(overridePatch('color-scheme-dark', current), { colorScheme: 'dark' });
  assert.equal(overridePatch('reset-overrides', current).cacheDisabled, false);
  assert.equal(overridePatch('devtools', current), null);
});
