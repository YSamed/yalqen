import type { ErrorEpisode, TimelineEvent } from './timeline.js';

export interface ReplayStep {
  kind: 'click' | 'key';
  selector: string;
  key?: string;
  summary: string;
}

export interface ReplayPlan {
  steps: ReplayStep[];
  skipped: string[];
}

export interface RequestOutcome {
  request: string;
  before: number | null;
  after: number | null;
}

export interface Verification {
  result: 'passed' | 'failed';
  requests: RequestOutcome[];
  errors: string[];
  lines: string[];
}

export function replayPlan(episode: ErrorEpisode): ReplayPlan {
  const steps: ReplayStep[] = [];
  const skipped: string[] = [];
  for (const event of episode.events) {
    const action = event.action;
    if (!action) continue;
    if (action.kind === 'input') {
      skipped.push(`${event.summary}: typed values are not recorded, so the field keeps what it has now`);
    } else if (action.kind === 'submit') {
      // The click or Enter that submitted the form is replayed, and submits it again.
      continue;
    } else if (!action.selector) {
      skipped.push(`${event.summary}: no selector was recorded`);
    } else {
      steps.push({ kind: action.kind, selector: action.selector, key: action.key, summary: event.summary });
    }
  }
  return { steps, skipped };
}

function failed(event: TimelineEvent): boolean {
  return event.kind === 'response' && (event.status === 0 || (event.status ?? 0) >= 400);
}

function isError(event: TimelineEvent): boolean {
  return event.kind === 'exception' || event.kind === 'console';
}

function statuses(events: readonly TimelineEvent[]): Map<string, number> {
  const byRequest = new Map<string, number>();
  for (const event of events) {
    if (event.kind === 'response' && event.target && event.status !== undefined)
      byRequest.set(event.target, event.status);
  }
  return byRequest;
}

function statusText(status: number | null): string {
  if (status === null) return 'not sent';
  return status === 0 ? 'failed' : String(status);
}

export function compareRuns(before: readonly TimelineEvent[], after: readonly TimelineEvent[]): Verification {
  const beforeStatus = statuses(before);
  const afterStatus = statuses(after);
  const targets = [...new Set([...beforeStatus.keys(), ...afterStatus.keys()])];
  const requests = targets.map((request) => ({
    request,
    before: beforeStatus.get(request) ?? null,
    after: afterStatus.get(request) ?? null,
  }));
  const errors = after.filter(isError).map((event) => event.summary);
  const passed = !after.some(failed) && errors.length === 0;
  const isFailure = (status: number | null) => status !== null && (status === 0 || status >= 400);
  const changed = requests.filter(({ before: was, after: now }) => isFailure(was) || isFailure(now));
  const lines = [
    passed ? 'Verification passed' : 'Verification failed',
    ...changed
      .slice(0, 3)
      .map(({ request, before: was, after: now }) =>
        was === null ? `${request} → ${statusText(now)}` : `${request}: ${statusText(was)} → ${statusText(now)}`,
      ),
    errors.length === 0 ? 'No console errors' : `${errors.length} console error${errors.length === 1 ? '' : 's'}`,
  ];
  return { result: passed ? 'passed' : 'failed', requests, errors, lines };
}
