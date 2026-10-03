import type { TabManager } from '../tabs/tabs.js';
import { pageInfo, responseBody, screenshot } from '../tabs/tab-agent.js';
import type { BridgeActions, BridgeHost, BridgeTab } from './tools.js';

// The first tab set belongs to the focused window, so its active tab is the default target.
export function createElectronHost(tabSets: () => TabManager[], actions: BridgeActions): BridgeHost {
  const locate = (id: string) => {
    for (const tabs of tabSets()) {
      const found = tabs.observedTab(id);
      if (found) return { tabs, ...found };
    }
    throw new Error(`Tab ${id} is not open or is not a local development tab.`);
  };
  return {
    actions,
    tabs: () =>
      tabSets().flatMap((tabs, index) =>
        tabs.observedTabs().map((tab): BridgeTab => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          active: index === 0 && tab.id === tabs.activeTabId,
        })),
      ),
    runtime: (id) => {
      for (const tabs of tabSets()) {
        const found = tabs.observedTab(id);
        if (found) return found.tab.agent ?? undefined;
      }
      return undefined;
    },
    pageInfo: (id) => {
      const { tab, contents } = locate(id);
      return pageInfo(tab, contents);
    },
    screenshot: (id, fullPage) => screenshot(locate(id).contents, fullPage),
    reload: async (id, ignoreCache) => locate(id).tabs.reloadTab(id, ignoreCache),
    responseBody: (id, requestId) => responseBody(locate(id).contents, requestId),
    onRead: (id) => {
      for (const tabs of tabSets()) tabs.markAgentRead(id);
    },
  };
}
