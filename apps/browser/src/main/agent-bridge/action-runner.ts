import type { WebContents } from 'electron';
import type { AgentActionPolicy, RequestRule } from '../../shared/types.js';
import { maskHeaders, truncateBytes } from './redact.js';
import { callPageToolExpression, LIST_PAGE_TOOLS, pageToolResult, sanitizePageTools } from './webmcp.js';
import type { TabManager } from '../tabs/tabs.js';
import type { Tab } from '../tabs/tab.js';
import {
  ActionFailed,
  click,
  fill,
  pause,
  pressEnter,
  waitForNetworkIdle,
  waitForSelector,
} from '../tabs/tab-actions.js';
import type { TabRuntime } from './runtime-buffer.js';
import type { ErrorEpisode, TimelineEvent } from './timeline.js';
import { compareRuns, replayPlan, type ReplayStep, type Verification } from './verification.js';
import { acquirePageWork } from '../tabs/page-work.js';
import {
  abortable,
  assertionExpression,
  executeFlow,
  PAGE_STRUCTURE_EXPRESSION,
  readFlowDom,
  validateFlowPlan,
  type FlowObservation,
  type FlowPlan,
} from './flow-verification.js';

const SETTLE_MS = 3000;
const REPLAY_SETTLE_MS = 5000;
// Exceptions thrown from a response handler land a moment after the network goes quiet.
const AFTERMATH_MS = 400;
const STEP_GAP_MS = 300;
const MAX_WAIT_MS = 30_000;
const MAX_AGENT_RULES = 20;
const RESEND_BODY_LIMIT = 64 * 1024;
const PAGE_WORK_BUSY = 'A browser check is already using this tab. Try again when it finishes.';
// The session supplies these itself, or they describe the old connection.
const RESEND_DROPPED_HEADERS = new Set(['host', 'content-length', 'cookie', 'connection', 'accept-encoding']);

class ActionDenied extends Error {}

export interface ActionWindow {
  tabs: TabManager;
  confirm(message: string, detail: string): Promise<boolean>;
  showControl(onStop: () => void): void;
  hideControl(): void;
  showVerification(verification: Verification): void;
}

interface ActionRunnerOptions {
  policy(): AgentActionPolicy;
  windows(): ActionWindow[];
  inScope(url: string): boolean;
}

interface ActionContext {
  tab: Tab;
  contents: WebContents;
  runtime: TabRuntime;
  signal: AbortSignal;
}

interface ActionResult {
  done: string;
  followed_by: ReturnType<typeof eventView>[];
}

function eventView(event: TimelineEvent) {
  return {
    id: event.id,
    kind: event.kind,
    summary: event.summary,
    ...(event.causeId && { cause: event.causeId, cause_confidence: event.causeConfidence }),
  };
}

function eventsSince(runtime: TabRuntime, time: number): TimelineEvent[] {
  return runtime.timeline.events.values().filter((event) => event.time >= time);
}

export class ActionRunner {
  private queue: Promise<unknown> = Promise.resolve();
  // After the user presses Stop, the next action in that tab asks again even when actions are allowed.
  private readonly stopped = new Set<string>();

  constructor(private readonly options: ActionRunnerOptions) {}

  click(tabId: string, selector: string): Promise<ActionResult> {
    return this.act(tabId, `Click ${selector}`, async (context) => {
      const start = Date.now();
      await click(context.contents, selector, context.signal);
      return this.settle(context, start, `Clicked ${selector}`);
    });
  }

  fill(tabId: string, selector: string, value: string): Promise<ActionResult> {
    const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    return this.act(tabId, `Type "${shown}" into ${selector}`, async (context) => {
      const start = Date.now();
      await fill(context.contents, selector, value, context.signal);
      return this.settle(context, start, `Filled ${selector} (${value.length} characters)`);
    });
  }

  navigate(tabId: string, url: string): Promise<ActionResult> {
    if (!this.options.inScope(url)) {
      return Promise.reject(new ActionFailed(`${url} is not a local development address the agent may open.`));
    }
    return this.act(tabId, `Open ${url}`, async (context) => {
      const start = Date.now();
      await context.contents.loadURL(url).catch((error: unknown) => {
        throw new ActionFailed(`Could not open ${url}: ${(error as Error).message}`);
      });
      return this.settle(context, start, `Opened ${url}`);
    });
  }

  async waitFor(
    tabId: string,
    { selector, networkIdle, timeoutMs }: { selector?: string; networkIdle: boolean; timeoutMs: number },
  ): Promise<{ matched: boolean; waited_ms: number }> {
    const { contents, runtime } = this.locate(tabId);
    const release = acquirePageWork(contents);
    if (!release) throw new ActionFailed(PAGE_WORK_BUSY);
    const signal = new AbortController().signal;
    const start = Date.now();
    const timeout = Math.min(timeoutMs, MAX_WAIT_MS);
    try {
      let matched = selector ? await waitForSelector(contents, selector, timeout, signal) : true;
      if (matched && networkIdle) matched = await waitForNetworkIdle(runtime, timeout - (Date.now() - start), signal);
      return { matched, waited_ms: Date.now() - start };
    } finally {
      release();
    }
  }

  async pageStructure(tabId: string, canUseTab?: () => boolean): Promise<unknown> {
    const context = this.locate(tabId);
    const release = acquirePageWork(context.contents);
    if (!release) throw new ActionFailed(PAGE_WORK_BUSY);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ActionFailed('Reading the page structure timed out.')), 3000);
    try {
      return await readFlowDom(context.contents, PAGE_STRUCTURE_EXPRESSION, controller.signal, () => {
        this.ensureFlowScope(context, canUseTab);
      });
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  runFlow(tabId: string, input: FlowPlan, canUseTab?: () => boolean) {
    const plan = validateFlowPlan(input);
    for (const step of plan.steps)
      if (step.action === 'navigate' && !this.options.inScope(step.url))
        return Promise.reject(new ActionFailed(`${step.url} is not a local development address the agent may open.`));
    const detail = [
      ...plan.steps.map(
        (step, index) =>
          `${index + 1}. ${step.action} ${step.action === 'navigate' ? step.url : step.selector}${step.action === 'fill' ? ` (${step.value.length} characters)` : ''}`,
      ),
      'Expected UI outcomes:',
      ...plan.assertions.map(
        (assertion) => `${assertion.kind} ${'selector' in assertion ? assertion.selector : assertion.expected}`,
      ),
    ].join('\n');
    return this.act(
      tabId,
      `Verify flow: ${plan.name}`,
      async (context, window) => {
        const started = Date.now();
        const controller = new AbortController();
        const stop = () => controller.abort(new ActionFailed('Stopped by the user in Yalqen.'));
        context.signal.addEventListener('abort', stop, { once: true });
        if (context.signal.aborted) stop();
        const navigation = (event: { url: string; isMainFrame: boolean; preventDefault?: () => void }) => {
          if (event.isMainFrame && !this.options.inScope(event.url)) {
            event.preventDefault?.();
            controller.abort(new ActionFailed('The flow attempted to leave local development scope.'));
          }
        };
        context.contents.on('will-navigate', navigation);
        context.contents.on('will-redirect', navigation);
        context.contents.on('did-start-navigation', navigation);
        const ensure = () => this.ensureFlowScope(context, canUseTab);
        try {
          const result = await executeFlow(
            plan,
            {
              ensure,
              url: () => context.contents.getURL(),
              perform: async (step, signal) => {
                const sendCommand = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
                  ensure();
                  signal.throwIfAborted();
                  if (method === 'DOM.querySelector') {
                    const matched = (await abortable(
                      context.contents.debugger.sendCommand('DOM.querySelectorAll', params),
                      signal,
                    )) as { nodeIds: number[] };
                    ensure();
                    signal.throwIfAborted();
                    if (matched.nodeIds.length > 1)
                      throw new ActionFailed('The action selector matches multiple elements. Use a unique selector.');
                  }
                  const output = await abortable(context.contents.debugger.sendCommand(method, params), signal);
                  ensure();
                  signal.throwIfAborted();
                  return output;
                };
                const guarded = { debugger: { sendCommand } } as unknown as WebContents;
                if (step.action === 'navigate') {
                  ensure();
                  if (!this.options.inScope(step.url))
                    throw new ActionFailed('The navigation is outside local development scope.');
                  await abortable(context.contents.loadURL(step.url), signal);
                  ensure();
                } else if (step.action === 'click') await click(guarded, step.selector, signal);
                else if (step.action === 'fill') await fill(guarded, step.selector, step.value, signal);
                else await pressEnter(guarded, step.selector, signal);
              },
              observe: async (assertion, signal) =>
                (await readFlowDom(
                  context.contents,
                  assertionExpression(assertion),
                  signal,
                  ensure,
                )) as FlowObservation,
              runtimeErrors: () =>
                eventsSince(context.runtime, started)
                  .filter(
                    (event) =>
                      event.kind === 'exception' ||
                      event.kind === 'console' ||
                      (event.kind === 'response' && (event.status === 0 || (event.status ?? 0) >= 400)),
                  )
                  .map((event) => event.summary),
            },
            controller.signal,
          );
          window.showVerification({
            result: result.result,
            requests: [],
            errors: result.errors,
            lines: [result.name, ...result.assertions.slice(0, 3).map((assertion) => assertion.summary)],
          });
          return result;
        } finally {
          context.signal.removeEventListener('abort', stop);
          context.contents.removeListener('will-navigate', navigation);
          context.contents.removeListener('will-redirect', navigation);
          context.contents.removeListener('did-start-navigation', navigation);
        }
      },
      detail,
    );
  }

  private ensureFlowScope(context: ActionContext, canUseTab?: () => boolean): void {
    if (context.contents.isDestroyed() || !this.options.inScope(context.contents.getURL()) || canUseTab?.() === false)
      throw new ActionFailed('The tab left the development scope allowed for this agent.');
    const current = this.locate(context.tab.id);
    if (current.contents !== context.contents || current.runtime !== context.runtime)
      throw new ActionFailed('The observed page changed during the flow.');
  }

  replay(tabId: string, episode: ErrorEpisode) {
    const before = [...episode.events];
    const plan = replayPlan(episode);
    if (plan.steps.length === 0) {
      return Promise.reject(
        new ActionFailed(`Episode ${episode.id} has no recorded clicks or Enter presses to replay.`),
      );
    }
    const detail = plan.steps.map((step, index) => `${index + 1}. ${step.summary}`).join('\n');
    return this.act(
      tabId,
      `Replay ${episode.id}`,
      async (context, window) => {
        await waitForNetworkIdle(context.runtime, SETTLE_MS, context.signal);
        const start = Date.now();
        for (const step of plan.steps) await this.replayStep(context, step);
        await waitForNetworkIdle(context.runtime, REPLAY_SETTLE_MS, context.signal);
        await pause(AFTERMATH_MS, context.signal);
        const after = eventsSince(context.runtime, start);
        const verification = compareRuns(before, after);
        window.showVerification(verification);
        const latest = context.runtime.timeline.latestEpisode;
        return {
          result: verification.result,
          replayed: plan.steps.map((step) => step.summary),
          skipped: plan.skipped,
          requests: verification.requests,
          errors: verification.errors,
          new_episode: latest && latest.start >= start ? latest.id : null,
          events: after.map(eventView),
        };
      },
      detail,
    );
  }

  addRule(tabId: string, rule: RequestRule, description: string) {
    return this.act(tabId, description, async (context, window) => {
      const rules = [rule, ...context.runtime.rules.filter((item) => item.id !== rule.id)].slice(0, MAX_AGENT_RULES);
      await window.tabs.setAgentRules(tabId, rules);
      return { rule_id: rule.id, active_rules: rules.length };
    });
  }

  async clearRules(tabId: string, ruleId?: string) {
    const { window, runtime } = this.locate(tabId);
    const rules = ruleId ? runtime.rules.filter((rule) => rule.id !== ruleId) : [];
    const removed = runtime.rules.length - rules.length;
    await window.tabs.setAgentRules(tabId, rules);
    return { removed, active_rules: rules.length };
  }

  resend(
    tabId: string,
    requestId: string,
    changes: { method?: string; body?: string; headers?: Record<string, string> },
  ) {
    const { runtime } = this.locate(tabId);
    const original = runtime.network.get(requestId);
    if (!original) return Promise.reject(new ActionFailed(`Request ${requestId} is not in the tab's recent requests.`));
    if (!this.options.inScope(original.url)) {
      return Promise.reject(new ActionFailed(`${original.url} is not a local development address.`));
    }
    const method = (changes.method ?? original.method).toUpperCase();
    return this.act(tabId, `Send ${method} ${original.url} again`, async ({ contents }) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries({ ...original.requestHeaders, ...changes.headers })) {
        if (!RESEND_DROPPED_HEADERS.has(name.toLowerCase()) && !name.startsWith(':')) headers[name] = value;
      }
      const body = method === 'GET' || method === 'HEAD' ? undefined : (changes.body ?? original.postData);
      const started = Date.now();
      const response = await contents.session.fetch(original.url, { method, headers, body, credentials: 'include' });
      const text = await response.text();
      return {
        status: response.status,
        status_text: response.statusText,
        duration_ms: Date.now() - started,
        response_headers: maskHeaders(Object.fromEntries(response.headers.entries())),
        response_body: truncateBytes(text, RESEND_BODY_LIMIT),
        note: 'Sent from Yalqen with the tab’s cookies, outside the page, so it is not in the page timeline.',
      };
    });
  }

  async listPageTools(tabId: string) {
    const { contents } = this.locate(tabId);
    const { result } = (await contents.debugger.sendCommand('Runtime.evaluate', {
      expression: LIST_PAGE_TOOLS,
      returnByValue: true,
    })) as { result: { value?: unknown } };
    const tools = sanitizePageTools(result.value);
    if (tools === null) {
      return {
        tools: [],
        note: 'navigator.modelContext is missing, or is the browser’s own, which Yalqen cannot list.',
      };
    }
    return tools.length > 0
      ? { tools }
      : {
          tools,
          note: 'If the page registers its tools while loading, reload it once: the agent connection was turned on after it loaded.',
        };
  }

  callPageTool(tabId: string, name: string, input: unknown) {
    return this.act(tabId, `Run the page's "${name}" tool`, async ({ contents }) => {
      const response = (await contents.debugger.sendCommand('Runtime.evaluate', {
        expression: callPageToolExpression(name, input),
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      })) as {
        result: { value?: unknown };
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      };
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new ActionFailed(
          `The page tool failed: ${details.exception?.description ?? details.text ?? 'unknown error'}`,
        );
      }
      return pageToolResult(response.result.value);
    });
  }

  private async replayStep(context: ActionContext, step: ReplayStep): Promise<void> {
    if (step.kind === 'key') await pressEnter(context.contents, step.selector, context.signal);
    else await click(context.contents, step.selector, context.signal);
    await pause(STEP_GAP_MS, context.signal);
  }

  private async settle(context: ActionContext, start: number, done: string): Promise<ActionResult> {
    await waitForNetworkIdle(context.runtime, SETTLE_MS, context.signal);
    await pause(AFTERMATH_MS, context.signal);
    return { done, followed_by: eventsSince(context.runtime, start).map(eventView) };
  }

  private locate(tabId: string): ActionContext & { window: ActionWindow } {
    for (const window of this.options.windows()) {
      const found = window.tabs.observedTab(tabId);
      if (found?.tab.agent) {
        return {
          window,
          tab: found.tab,
          contents: found.contents,
          runtime: found.tab.agent,
          signal: new AbortController().signal,
        };
      }
    }
    throw new ActionFailed(`Tab ${tabId} is not open or is not a local development tab.`);
  }

  private act<T>(
    tabId: string,
    description: string,
    task: (context: ActionContext, window: ActionWindow) => Promise<T>,
    detail = '',
  ): Promise<T> {
    const run = this.queue.then(() => this.runNow(tabId, description, task, detail));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runNow<T>(
    tabId: string,
    description: string,
    task: (context: ActionContext, window: ActionWindow) => Promise<T>,
    detail: string,
  ): Promise<T> {
    const policy = this.options.policy();
    if (policy === 'off') {
      throw new ActionDenied(
        'Agent actions are off in Yalqen. The user can allow them in Settings → Developer → Agent actions.',
      );
    }
    const { window, tab, contents, runtime } = this.locate(tabId);
    if (policy === 'ask' || this.stopped.has(tabId)) {
      if (!(await window.confirm(description, detail)))
        throw new ActionDenied(`The user did not allow: ${description}.`);
      this.stopped.delete(tabId);
    }
    const current = this.locate(tabId);
    if (current.contents !== contents || current.runtime !== runtime || !this.options.inScope(contents.getURL()))
      throw new ActionFailed('The observed page changed while waiting for permission.');
    const release = acquirePageWork(contents);
    if (!release) throw new ActionFailed(PAGE_WORK_BUSY);
    const controller = new AbortController();
    try {
      runtime.timeline.closeEpisode();
      window.tabs.activate(tabId);
      window.showControl(() => {
        controller.abort();
        this.stopped.add(tabId);
      });
      return await task({ tab, contents, runtime, signal: controller.signal }, window);
    } finally {
      try {
        window.hideControl();
      } finally {
        release();
      }
    }
  }
}
