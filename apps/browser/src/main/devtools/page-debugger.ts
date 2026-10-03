import type { WebContents } from 'electron';
import { fullPageClip } from './page-export.js';
import type { ProtocolCommand } from './page-overrides.js';

const PROTOCOL_VERSION = '1.3';

export function attachDebugger(contents: WebContents): void {
  if (!contents.debugger.isAttached()) contents.debugger.attach(PROTOCOL_VERSION);
}

export function detachDebugger(contents: WebContents): void {
  if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
}

export async function sendCommands(contents: WebContents, commands: readonly ProtocolCommand[]): Promise<void> {
  attachDebugger(contents);
  for (const { method, params, optional } of commands) {
    try {
      await contents.debugger.sendCommand(method, params);
    } catch (error) {
      if (!optional) throw error;
    }
  }
}

export async function captureFullPage(contents: WebContents): Promise<Buffer> {
  attachDebugger(contents);
  const dbg = contents.debugger;
  const metrics = (await dbg.sendCommand('Page.getLayoutMetrics')) as {
    cssContentSize: { width: number; height: number };
  };
  const pixelRatio = Number(await contents.executeJavaScript('window.devicePixelRatio')) || 1;
  const { data } = (await dbg.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: fullPageClip(metrics.cssContentSize, pixelRatio),
  })) as { data: string };
  return Buffer.from(data, 'base64');
}
