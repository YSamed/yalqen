import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import repoPrompt from '../../../dist/main/app/repo-prompt.js';

const { RepoPrompt, MIN_VISITS, SHOW_INTERVAL_MS, LATER_DELAY_MS, CLOSE_DELAY_MS, MAX_SHOWS } = repoPrompt;

const DAY = 24 * 60 * 60 * 1000;

function visit(prompt, times, now) {
  let shown = false;
  for (let i = 0; i < times; i++) shown = prompt.take(now);
  return shown;
}

test('stays hidden for the first visits', () => {
  const prompt = new RepoPrompt(null);
  assert.equal(visit(prompt, MIN_VISITS, 1000), false);
  assert.equal(prompt.take(1000), true);
});

test('waits out the interval between showings', () => {
  const prompt = new RepoPrompt(null);
  visit(prompt, MIN_VISITS + 1, 1000);
  assert.equal(prompt.take(1000 + SHOW_INTERVAL_MS - 1), false);
  assert.equal(prompt.take(1000 + SHOW_INTERVAL_MS), true);
});

test('later and close push the next showing further out', () => {
  const later = new RepoPrompt(null);
  visit(later, MIN_VISITS + 1, 0);
  later.respond('later', 0);
  assert.equal(later.take(LATER_DELAY_MS - 1), false);
  assert.equal(later.take(LATER_DELAY_MS), true);

  const close = new RepoPrompt(null);
  visit(close, MIN_VISITS + 1, 0);
  close.respond('close', 0);
  assert.equal(close.take(CLOSE_DELAY_MS - 1), false);
  assert.equal(close.take(CLOSE_DELAY_MS), true);
});

test('starring ends the prompt for good', () => {
  const prompt = new RepoPrompt(null);
  visit(prompt, MIN_VISITS + 1, 0);
  prompt.respond('star', 0);
  assert.equal(prompt.take(1000 * DAY), false);
});

test('stops after the maximum number of showings', () => {
  const prompt = new RepoPrompt(null);
  let shown = 0;
  for (let day = 0; day < 1000; day += 15) if (prompt.take(day * DAY)) shown++;
  assert.equal(shown, MAX_SHOWS);
});

test('state survives a restart and ignores a corrupt file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-repo-prompt-'));
  const prompts = [];
  const open = () => prompts[prompts.push(new RepoPrompt(directory)) - 1];
  try {
    const first = open();
    visit(first, MIN_VISITS + 1, 0);
    first.saveNow();
    assert.equal(open().take(1), false);
    fs.writeFileSync(first.file, '{oops');
    assert.equal(open().take(0), false);
  } finally {
    for (const prompt of prompts) prompt.saveNow();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
