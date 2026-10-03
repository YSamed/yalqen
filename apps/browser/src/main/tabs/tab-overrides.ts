import type { WebContents } from 'electron';
import type { RequestRule } from '../../shared/types.js';
import { emulatedUserAgent } from '../devtools/devices.js';
import { detachDebugger, sendCommands } from '../devtools/page-debugger.js';
import { hasOverrides, overrideCommands } from '../devtools/page-overrides.js';
import { pausedRequestCommand, type PausedRequest } from '../devtools/request-rules.js';
import type { Tab } from './tab.js';

export function needsDebugger(tab: Tab): boolean {
  return tab.emulation !== null || hasOverrides(tab.overrides);
}

export function releaseDebugger(tab: Tab, contents: WebContents): void {
  if (!needsDebugger(tab)) detachDebugger(contents);
}

export async function pushOverrides(tab: Tab, contents: WebContents, rules: readonly RequestRule[]): Promise<void> {
  await sendCommands(contents, overrideCommands(tab.overrides, emulatedUserAgent(tab.emulation), rules));
  releaseDebugger(tab, contents);
}

// A paused request stalls the page until it is answered, so every pause gets a reply.
export function answerPausedRequest(contents: WebContents, rules: readonly RequestRule[], paused: PausedRequest): void {
  const { method, params } = pausedRequestCommand(rules, paused);
  contents.debugger.sendCommand(method, params).catch(() => {
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    contents.debugger.sendCommand('Fetch.continueRequest', { requestId: paused.requestId }).catch(() => undefined);
  });
}
