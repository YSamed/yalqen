import type { ErrorEpisode, TimelineEvent } from './timeline.js';

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function failedRequests(events: readonly TimelineEvent[]): { method: string; path: string }[] {
  const seen = new Map<string, { method: string; path: string }>();
  for (const event of events) {
    if (event.kind !== 'response' || !event.target) continue;
    if (event.status !== 0 && (event.status ?? 0) < 400) continue;
    const [method, ...rest] = event.target.split(' ');
    seen.set(event.target, { method, path: rest.join(' ') });
  }
  return [...seen.values()];
}

function stepLines(event: TimelineEvent): string[] {
  const action = event.action;
  if (!action?.selector) return [];
  const locator = `page.locator(${quote(action.selector)})`;
  switch (action.kind) {
    case 'click':
      return [`  await ${locator}.click();`];
    case 'key':
      return [`  await ${locator}.press(${quote(action.key ?? 'Enter')});`];
    case 'input':
      return [`  // Yalqen does not record typed values: ${event.summary}`, `  await ${locator}.fill(${quote('')});`];
    case 'submit':
      return [];
  }
}

// A starting point the agent or developer refines, not a finished test: typed values are blanks.
export function playwrightTest(episode: ErrorEpisode, pageUrl: string): string {
  const failures = failedRequests(episode.events);
  const name = failures.length > 0 ? `${failures[0].method} ${failures[0].path} succeeds` : 'no errors on the page';
  const waits = failures.map(
    ({ method, path }, index) =>
      `  const response${index} = page.waitForResponse((response) => response.url().includes(${quote(path)}) && response.request().method() === ${quote(method)});`,
  );
  const checks = failures.map((_, index) => `  expect((await response${index}).status()).toBeLessThan(400);`);
  return [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `// Reproduces ${episode.id}: ${episode.summary.replace(/\n/g, ' ')}`,
    `test(${quote(name)}, async ({ page }) => {`,
    `  const errors: string[] = [];`,
    `  page.on('pageerror', (error) => errors.push(error.message));`,
    `  page.on('console', (message) => {`,
    `    if (message.type() === 'error') errors.push(message.text());`,
    `  });`,
    `  await page.goto(${quote(pageUrl)});`,
    ...waits,
    ...episode.events.flatMap(stepLines),
    ...checks,
    `  expect(errors).toEqual([]);`,
    `});`,
    ``,
  ].join('\n');
}
