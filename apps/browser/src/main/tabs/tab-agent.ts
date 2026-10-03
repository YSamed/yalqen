import type { WebContents } from 'electron';
import { TabRuntime } from '../agent-bridge/runtime-buffer.js';
import type { PageInfo, ResponseBody } from '../agent-bridge/tools.js';
import { attachDebugger, captureFullPage, sendCommands } from '../devtools/page-debugger.js';
import { NO_OVERRIDES, OBSERVED_NETWORK_ENABLE } from '../devtools/page-overrides.js';
import type { PageOverrides } from '../../shared/types.js';
import type { Tab } from './tab.js';
import { releaseDebugger } from './tab-overrides.js';

export async function observeTab(tab: Tab, contents: WebContents): Promise<void> {
  const runtime = new TabRuntime();
  tab.agent = runtime;
  try {
    attachDebugger(contents);
    // Sent together: awaiting each one would let the page's first requests go out before Network is on.
    await Promise.all(
      [OBSERVED_NETWORK_ENABLE, { method: 'Runtime.enable' }, { method: 'Log.enable' }].map(({ method, params }) =>
        contents.debugger.sendCommand(method, params),
      ),
    );
  } catch (error) {
    if (tab.agent === runtime) tab.agent = null;
    if (!contents.isDestroyed()) releaseDebugger(tab, contents);
    console.warn(`[agent-bridge] could not observe ${tab.url}: ${(error as Error).message}`);
  }
}

export async function unobserveTab(tab: Tab, contents: WebContents): Promise<void> {
  tab.agent = null;
  if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
  const networkOverridden = tab.overrides.cacheDisabled || tab.overrides.network !== null;
  await sendCommands(contents, [
    { method: 'Runtime.disable', optional: true },
    { method: 'Log.disable', optional: true },
    ...(networkOverridden ? [] : [{ method: 'Network.disable', optional: true }]),
  ]).catch(() => undefined);
  if (!contents.isDestroyed()) releaseDebugger(tab, contents);
}

export function activeOverrideNames(overrides: PageOverrides): string[] {
  return (Object.keys(NO_OVERRIDES) as (keyof PageOverrides)[]).filter((key) => overrides[key] !== NO_OVERRIDES[key]);
}

export async function pageInfo(tab: Tab, contents: WebContents): Promise<PageInfo> {
  const metrics = (await contents.debugger.sendCommand('Page.getLayoutMetrics')) as {
    cssLayoutViewport: { clientWidth: number; clientHeight: number };
    layoutViewport: { clientWidth: number };
  };
  const css = metrics.cssLayoutViewport;
  return {
    url: tab.url,
    title: tab.title,
    viewport: {
      width: css.clientWidth,
      height: css.clientHeight,
      deviceScaleFactor: css.clientWidth > 0 ? metrics.layoutViewport.clientWidth / css.clientWidth : 1,
    },
    device: tab.emulation ? `${tab.emulation.deviceId}${tab.emulation.landscape ? ' (landscape)' : ''}` : null,
    colorScheme: tab.overrides.colorScheme,
    overrides: activeOverrideNames(tab.overrides),
  };
}

export async function screenshot(contents: WebContents, fullPage: boolean): Promise<Buffer> {
  if (fullPage) return captureFullPage(contents);
  const image = await contents.capturePage();
  if (image.isEmpty())
    throw new Error('The tab is not visible. Switch to it in Yalqen, or ask for a full-page screenshot.');
  return image.toPNG();
}

export async function responseBody(contents: WebContents, requestId: string): Promise<ResponseBody | null> {
  try {
    return (await contents.debugger.sendCommand('Network.getResponseBody', { requestId })) as ResponseBody;
  } catch {
    return null;
  }
}
