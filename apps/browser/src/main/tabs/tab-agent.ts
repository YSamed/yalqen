import type { WebContents } from 'electron';
import { ACTION_SCRIPT, ACTION_WORLD } from '../agent-bridge/action-script.js';
import { WEBMCP_SCRIPT } from '../agent-bridge/webmcp.js';
import { ACTION_BINDING, TabRuntime } from '../agent-bridge/runtime-buffer.js';
import type { PageInfo, ResponseBody } from '../agent-bridge/tools.js';
import { attachDebugger, captureFullPage, sendCommands } from '../devtools/page-debugger.js';
import { NO_OVERRIDES, OBSERVED_NETWORK_ENABLE } from '../devtools/page-overrides.js';
import type { PageOverrides } from '../../shared/types.js';
import type { Tab } from './tab.js';
import { releaseDebugger } from './tab-overrides.js';

export async function observeTab(tab: Tab, contents: WebContents): Promise<void> {
  const runtime = new TabRuntime(() => tab.url);
  tab.agent = runtime;
  try {
    attachDebugger(contents);
    // Sent together: awaiting each one would let the page's first requests go out before Network is on.
    await Promise.all(
      [OBSERVED_NETWORK_ENABLE, { method: 'Runtime.enable' }, { method: 'Log.enable' }, { method: 'Page.enable' }].map(
        ({ method, params }) => contents.debugger.sendCommand(method, params),
      ),
    );
    await contents.debugger.sendCommand('Runtime.addBinding', {
      name: ACTION_BINDING,
      executionContextName: ACTION_WORLD,
    });
    // Scripts added this way only reach later documents while the Page domain is on.
    const { identifier } = (await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: ACTION_SCRIPT,
      worldName: ACTION_WORLD,
      runImmediately: true,
    })) as { identifier: string };
    runtime.actionScriptId = identifier;
    const webMcp = (await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: WEBMCP_SCRIPT,
      runImmediately: true,
    })) as { identifier: string };
    runtime.webMcpScriptId = webMcp.identifier;
  } catch (error) {
    if (tab.agent === runtime) tab.agent = null;
    if (!contents.isDestroyed()) releaseDebugger(tab, contents);
    console.warn(`[agent-bridge] could not observe ${tab.url}: ${(error as Error).message}`);
  }
}

export async function unobserveTab(tab: Tab, contents: WebContents): Promise<void> {
  const scriptIds = [tab.agent?.actionScriptId, tab.agent?.webMcpScriptId].filter((id) => typeof id === 'string');
  tab.agent = null;
  if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
  const networkOverridden = tab.overrides.cacheDisabled || tab.overrides.network !== null;
  await sendCommands(contents, [
    ...scriptIds.map((identifier) => ({
      method: 'Page.removeScriptToEvaluateOnNewDocument',
      params: { identifier },
      optional: true,
    })),
    { method: 'Runtime.removeBinding', params: { name: ACTION_BINDING }, optional: true },
    { method: 'Page.disable', optional: true },
    { method: 'Runtime.disable', optional: true },
    { method: 'Log.disable', optional: true },
    ...(networkOverridden || tab.certificateLoading ? [] : [{ method: 'Network.disable', optional: true }]),
  ]).catch(() => undefined);
  if (!contents.isDestroyed()) releaseDebugger(tab, contents);
}

function activeOverrideNames(overrides: PageOverrides): string[] {
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
