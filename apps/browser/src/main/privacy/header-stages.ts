import type {
  BeforeSendResponse,
  HeadersReceivedResponse,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
} from 'electron';

export type SendStage = (
  details: OnBeforeSendHeadersListenerDetails,
  headers: Record<string, string>,
) => Record<string, string> | null;

export type ReceiveStage = (
  details: OnHeadersReceivedListenerDetails,
  headers: Record<string, string[]>,
) => HeadersReceivedResponse | null | Promise<HeadersReceivedResponse | null>;

interface Stages {
  send: Map<number, SendStage>;
  receive: Map<number, ReceiveStage>;
}

const sessions = new WeakMap<Session, Stages>();

const sorted = <T>(stages: Map<number, T>) => [...stages].sort(([a], [b]) => a - b).map(([, stage]) => stage);

// Electron keeps one listener per webRequest event, so cookie rules, sign-in headers, the ad blocker
// and extension rules each add a stage here instead of replacing each other's listener.
export function runSendStages(
  stages: readonly SendStage[],
  details: OnBeforeSendHeadersListenerDetails,
): BeforeSendResponse {
  let headers = details.requestHeaders;
  let changed = false;
  for (const stage of stages) {
    const next = stage(details, headers);
    if (next) {
      headers = next;
      changed = true;
    }
  }
  return changed ? { requestHeaders: headers } : {};
}

export async function runReceiveStages(
  stages: readonly ReceiveStage[],
  details: OnHeadersReceivedListenerDetails,
): Promise<HeadersReceivedResponse> {
  let headers = details.responseHeaders ?? {};
  let changed = false;
  for (const stage of stages) {
    const result = await stage({ ...details, responseHeaders: headers }, headers);
    if (result?.cancel) return { cancel: true };
    if (result?.responseHeaders) {
      headers = Object.fromEntries(
        Object.entries(result.responseHeaders).map(([name, value]) => [name, Array.isArray(value) ? value : [value]]),
      );
      changed = true;
    }
  }
  return changed ? { responseHeaders: headers } : {};
}

function stagesOf(session: Session): Stages {
  let stages = sessions.get(session);
  if (!stages) {
    stages = { send: new Map(), receive: new Map() };
    sessions.set(session, stages);
  }
  return stages;
}

export function attachHeaderStages(session: Session): void {
  const { send, receive } = stagesOf(session);
  session.webRequest.onBeforeSendHeaders((details, callback) => callback(runSendStages(sorted(send), details)));
  session.webRequest.onHeadersReceived((details, callback) => {
    runReceiveStages(sorted(receive), details).then(callback, (error: unknown) => {
      console.warn('[headers] a response stage failed:', error);
      callback({});
    });
  });
}

export function setSendStage(session: Session, order: number, stage: SendStage | null): void {
  const { send } = stagesOf(session);
  if (stage) send.set(order, stage);
  else send.delete(order);
  attachHeaderStages(session);
}

export function setReceiveStage(session: Session, order: number, stage: ReceiveStage | null): void {
  const { receive } = stagesOf(session);
  if (stage) receive.set(order, stage);
  else receive.delete(order);
  attachHeaderStages(session);
}

export const HEADER_STAGE = { signIn: 10, cookies: 20, adBlock: 30, extensions: 40 } as const;
