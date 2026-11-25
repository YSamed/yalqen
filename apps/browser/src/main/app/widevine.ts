import { components } from 'electron';

const WIDEVINE_WAIT_MS = 3000;

// Pages only see the Widevine CDM once it is registered, but the first run downloads it, so startup waits at most a few seconds.
export function widevineReady(waitMs = WIDEVINE_WAIT_MS): Promise<void> {
  const ready = components.whenReady().then(
    () => undefined,
    (error: unknown) => console.error('Widevine CDM is unavailable', error, components.status()),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref());
  return Promise.race([ready, timeout]);
}
