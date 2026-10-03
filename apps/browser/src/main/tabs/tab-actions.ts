import type { WebContents } from 'electron';
import type { TabRuntime } from '../agent-bridge/runtime-buffer.js';

export const FIND_TIMEOUT_MS = 3000;
const POLL_MS = 100;
const IDLE_MS = 500;
// Streams and long polls never finish, so only recent requests count as pending.
const PENDING_WINDOW_MS = 10_000;
const META = 4;

export class ActionStopped extends Error {
  constructor() {
    super('Stopped by the user in Yalqen.');
  }
}

export class ActionFailed extends Error {}

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

interface Target {
  nodeId: number;
  x: number;
  y: number;
}

function sender(contents: WebContents): Send {
  return (method, params) => contents.debugger.sendCommand(method, params);
}

export function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw new ActionStopped();
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', stopped);
      resolve();
    }
    function stopped() {
      clearTimeout(timer);
      reject(new ActionStopped());
    }
    if (signal.aborted) stopped();
    else signal.addEventListener('abort', stopped, { once: true });
  });
}

async function findTarget(send: Send, selector: string): Promise<Target | null> {
  const { root } = (await send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
  let nodeId: number;
  try {
    ({ nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number });
  } catch {
    throw new ActionFailed(`"${selector}" is not a valid CSS selector.`);
  }
  if (!nodeId) return null;
  await send('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => undefined);
  const { model } = (await send('DOM.getBoxModel', { nodeId }).catch(() => ({ model: null }))) as {
    model: { content: number[]; width: number; height: number } | null;
  };
  if (!model || model.width === 0 || model.height === 0) return null;
  const [x1, y1, , , x3, y3] = model.content;
  return { nodeId, x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
}

export async function waitForSelector(
  contents: WebContents,
  selector: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const send = sender(contents);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    throwIfStopped(signal);
    if (await findTarget(send, selector)) return true;
    if (Date.now() >= deadline) return false;
    await pause(POLL_MS, signal);
  }
}

async function visibleTarget(contents: WebContents, selector: string, signal: AbortSignal): Promise<Target> {
  const send = sender(contents);
  const deadline = Date.now() + FIND_TIMEOUT_MS;
  for (;;) {
    throwIfStopped(signal);
    const target = await findTarget(send, selector);
    if (target) return target;
    if (Date.now() >= deadline) throw new ActionFailed(`No visible element matches "${selector}".`);
    await pause(POLL_MS, signal);
  }
}

export async function click(contents: WebContents, selector: string, signal: AbortSignal): Promise<void> {
  const send = sender(contents);
  const { x, y } = await visibleTarget(contents, selector, signal);
  throwIfStopped(signal);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function fill(contents: WebContents, selector: string, value: string, signal: AbortSignal): Promise<void> {
  const send = sender(contents);
  const { nodeId } = await visibleTarget(contents, selector, signal);
  throwIfStopped(signal);
  await send('DOM.focus', { nodeId });
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: META,
    commands: ['selectAll'],
  });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: META });
  if (value) await send('Input.insertText', { text: value });
  else
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      commands: ['deleteBackward'],
    });
}

export async function pressEnter(contents: WebContents, selector: string, signal: AbortSignal): Promise<void> {
  const send = sender(contents);
  const { nodeId } = await visibleTarget(contents, selector, signal);
  throwIfStopped(signal);
  await send('DOM.focus', { nodeId });
  const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...enter });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
}

function hasPendingRequests(runtime: TabRuntime, now: number): boolean {
  return runtime.network
    .values()
    .some(
      (request) =>
        !request.finished &&
        now - request.startTime < PENDING_WINDOW_MS &&
        request.resourceType !== 'EventSource' &&
        request.resourceType !== 'WebSocket',
    );
}

export async function waitForNetworkIdle(
  runtime: TabRuntime,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  for (;;) {
    throwIfStopped(signal);
    const now = Date.now();
    if (hasPendingRequests(runtime, now)) quietSince = now;
    else if (now - quietSince >= IDLE_MS) return true;
    if (now >= deadline) return false;
    await pause(POLL_MS, signal);
  }
}
