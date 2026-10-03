import assert from 'node:assert/strict';
import { test } from 'node:test';
import verification from '../../../dist/main/agent-bridge/verification.js';

const { compareRuns, replayPlan } = verification;
const event = (fields) => ({ id: 'e', time: 0, summary: '', ...fields });

test('replayPlan replays clicks and Enter, and explains what it skips', () => {
  const plan = replayPlan({
    id: 'yk_ep_1',
    events: [
      event({ kind: 'click', summary: 'Clicked input#email', action: { kind: 'click', selector: '#email' } }),
      event({ kind: 'input', summary: 'Changed input#email', action: { kind: 'input', selector: '#email' } }),
      event({ kind: 'key', summary: 'Pressed Enter', action: { kind: 'key', selector: '#email', key: 'Enter' } }),
      event({ kind: 'submit', summary: 'Submitted form', action: { kind: 'submit', selector: 'form' } }),
      event({ kind: 'click', summary: 'Clicked div', action: { kind: 'click' } }),
      event({ kind: 'request', summary: 'POST /api/users' }),
    ],
  });
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.selector]),
    [
      ['click', '#email'],
      ['key', '#email'],
    ],
  );
  assert.equal(plan.skipped.length, 2);
  assert.match(plan.skipped[0], /typed values are not recorded/);
});

const response = (target, status) => event({ kind: 'response', target, status });

test('a replay passes when the failing request now succeeds and nothing throws', () => {
  const before = [response('POST /api/users', 500), event({ kind: 'exception', summary: 'TypeError' })];
  const result = compareRuns(before, [response('POST /api/users', 201)]);
  assert.equal(result.result, 'passed');
  assert.deepEqual(result.requests, [{ request: 'POST /api/users', before: 500, after: 201 }]);
  assert.deepEqual(result.lines, ['Verification passed', 'POST /api/users: 500 → 201', 'No console errors']);
});

test('a replay fails on a failed response or any console error', () => {
  assert.equal(compareRuns([], [response('POST /api/users', 0)]).result, 'failed');
  const thrown = compareRuns([], [response('GET /api/me', 200), event({ kind: 'exception', summary: 'boom' })]);
  assert.equal(thrown.result, 'failed');
  assert.deepEqual(thrown.errors, ['boom']);
  assert.equal(thrown.lines.at(-1), '1 console error');
});

test('requests that never failed stay out of the summary lines', () => {
  const result = compareRuns([response('GET /', 200)], [response('POST /api/users', 201)]);
  assert.deepEqual(result.lines, ['Verification passed', 'No console errors']);
});
