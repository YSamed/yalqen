import type { WebContents } from 'electron';
import type { RequestRule } from '../../shared/types.js';
import { emulatedUserAgent } from '../devtools/devices.js';
import { detachDebugger, sendCommands } from '../devtools/page-debugger.js';
import { hasOverrides, overrideCommands } from '../devtools/page-overrides.js';
import {
  pausedRequestCommand,
  type HeaderValue,
  type InterceptPattern,
  type PausedRequest,
} from '../devtools/request-rules.js';
import type { Tab } from './tab.js';

export function needsDebugger(tab: Tab): boolean {
  return tab.certificateLoading === true || tab.emulation !== null || tab.agent !== null || hasOverrides(tab.overrides);
}

export function releaseDebugger(tab: Tab, contents: WebContents): void {
  if (!needsDebugger(tab)) detachDebugger(contents);
}

// The agent's temporary rules come first, so they win over the user's saved ones.
export function rulesFor(tab: Tab, userRules: readonly RequestRule[]): readonly RequestRule[] {
  const agentRules = tab.agent?.rules ?? [];
  return tab.overrides.requestRules ? [...agentRules, ...userRules] : agentRules;
}

// Backend tracing only needs the requests the app's own code makes.
const TRACED_REQUESTS: InterceptPattern[] = [
  { urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' },
  { urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' },
];

export async function pushOverrides(
  tab: Tab,
  contents: WebContents,
  userRules: readonly RequestRule[],
  tracing = false,
): Promise<void> {
  const traced = tracing && tab.agent !== null ? TRACED_REQUESTS : [];
  await sendCommands(
    contents,
    overrideCommands(
      tab.overrides,
      emulatedUserAgent(tab.emulation),
      rulesFor(tab, userRules),
      tab.agent !== null,
      traced,
    ).filter((command) => !(tab.certificateLoading && command.method === 'Network.disable')),
  );
  releaseDebugger(tab, contents);
}

// A paused request stalls the page until it is answered, so every pause gets a reply.
export function answerPausedRequest(
  contents: WebContents,
  rules: readonly RequestRule[],
  paused: PausedRequest,
  extraHeaders: readonly HeaderValue[] = [],
): void {
  const { method, params } = pausedRequestCommand(rules, paused, extraHeaders);
  contents.debugger.sendCommand(method, params).catch(() => {
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    contents.debugger.sendCommand('Fetch.continueRequest', { requestId: paused.requestId }).catch(() => undefined);
  });
}
