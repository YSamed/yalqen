import fs from 'node:fs';
import path from 'node:path';
import { BaseWindow, Menu, WebContentsView, app, ipcMain, session, shell } from 'electron';
import {
  IpcChannel,
  type BrowserState,
  type ChromeLayout,
  type UiAction,
  type UiCommand,
} from '../shared/types.js';
import { buildMenu } from './menu.js';
import { MetricsLog, readProcessMemory } from './metrics.js';
import { SessionStore } from './persistence.js';
import { SEARCH_ENGINES, isValidSearchTemplate, resolveSearchEngine } from './search.js';
import { SettingsStore } from './settings.js';
import { TabManager } from './tabs.js';
import { resolveInput } from './url.js';

const DAILY_PARTITION = 'persist:daily';
const MEMORY_POLL_MS = 5000;
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

// Keep prototype data apart from any other Electron app.
app.setPath('userData', path.join(app.getPath('appData'), 'yalqen-electron-prototype'));

const repoRoot = path.resolve(app.getAppPath(), '../..');
const metricsLog = new MetricsLog(process.env.YALQEN_METRICS_DIR ?? path.join(repoRoot, 'bench/results'));
const pageSetFile = path.join(repoRoot, 'bench/pages.txt');
const appIcon = path.join(repoRoot, 'design/brand/png/icon-512.png');

function createBrowser(): void {
  const window = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'yalqen',
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
  });

  const ui = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ui.webContents.on('will-navigate', (event) => event.preventDefault());
  ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.contentView.addChildView(ui);

  const daily = session.fromPartition(DAILY_PARTITION);
  daily.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  daily.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

  const store = new SessionStore(app.getPath('userData'));
  const settings = new SettingsStore(app.getPath('userData'));
  const searchEngine = () =>
    resolveSearchEngine(settings.get().searchEngine, settings.get().customSearchTemplate);
  let layout: ChromeLayout = { toolbarHeight: 44, panelWidth: 240 };
  let totalMemoryMB: number | null = null;

  const browserState = (): BrowserState => ({
    ...tabs.state(),
    totalMemoryMB,
    addressPlaceholder: searchEngine().placeholder,
  });
  const pushState = () => {
    if (!ui.webContents.isDestroyed()) {
      ui.webContents.send(IpcChannel.state, browserState());
    }
  };
  const sendCommand = (command: UiCommand) => {
    ui.webContents.focus();
    ui.webContents.send(IpcChannel.command, command);
  };

  const tabs: TabManager = new TabManager({
    window,
    session: daily,
    onChange: () => {
      pushState();
      store.scheduleSave(() => tabs.toSession());
    },
    onRestore: (timing) => {
      metricsLog.write({ event: 'restore', ...timing });
    },
  });

  const applyLayout = () => {
    const { width, height } = window.getContentBounds();
    ui.setBounds({ x: 0, y: 0, width, height });
    tabs.setPageBounds({
      x: 0,
      y: layout.toolbarHeight,
      width: Math.max(0, width - layout.panelWidth),
      height: Math.max(0, height - layout.toolbarHeight),
    });
  };
  window.on('resize', applyLayout);
  applyLayout();

  const recordSnapshot = (label: string) => {
    const memory = readProcessMemory();
    const file = metricsLog.write({
      event: 'snapshot',
      label,
      tabs: { total: tabs.count, live: tabs.liveCount },
      totalWorkingSetKB: memory.totalKB,
      processes: memory.processes,
    });
    console.log(`[metrics] ${label}: ${Math.round(memory.totalKB / 1024)} MB -> ${file}`);
  };

  const newTabWithAddress = () => {
    tabs.open();
    sendCommand({ type: 'focus-address' });
  };

  const installMenu = () => Menu.setApplicationMenu(
    buildMenu({
      newTab: newTabWithAddress,
      closeTab: () => tabs.activeTabId && tabs.close(tabs.activeTabId),
      reopenClosedTab: () => tabs.reopenClosed(),
      focusAddress: () => sendCommand({ type: 'focus-address' }),
      reload: () => tabs.reload(),
      goBack: () => tabs.goBack(),
      goForward: () => tabs.goForward(),
      togglePanel: () => sendCommand({ type: 'toggle-panel' }),
      toggleDevTools: () => tabs.toggleDevTools(),
      selectTab: (index) => tabs.selectByIndex(index),
      openPageSet: () => {
        for (const url of readPageSet()) tabs.open(url, { activate: false });
      },
      discardBackground: () => tabs.discardBackground(),
      recordSnapshot: () => recordSnapshot(`live-${tabs.liveCount}/total-${tabs.count}`),
      searchEngines: [
        ...SEARCH_ENGINES.map((engine) => ({
          id: engine.id,
          label: engine.label,
          checked: searchEngine().id === engine.id,
          enabled: true,
        })),
        {
          id: 'custom' as const,
          label: isValidSearchTemplate(settings.get().customSearchTemplate)
            ? 'Özel'
            : 'Özel (ayar dosyasında tanımlı değil)',
          checked: searchEngine().id === 'custom',
          enabled: isValidSearchTemplate(settings.get().customSearchTemplate),
        },
      ],
      selectSearchEngine: (id) => {
        settings.update({ searchEngine: id });
        installMenu();
        pushState();
      },
      openSettingsFile: () => {
        settings.update({});
        void shell.openPath(settings.file);
      },
    }),
  );
  installMenu();

  ipcMain.handle(IpcChannel.getState, (event) =>
    event.sender === ui.webContents ? browserState() : null,
  );
  ipcMain.on(IpcChannel.setLayout, (event, next: ChromeLayout) => {
    if (event.sender !== ui.webContents) return;
    layout = next;
    applyLayout();
  });
  ipcMain.on(IpcChannel.action, (event, action: UiAction) => {
    if (event.sender !== ui.webContents) return;
    handleAction(action);
  });

  function handleAction(action: UiAction): void {
    switch (action.type) {
      case 'new-tab':
        if (action.url) tabs.open(action.url);
        else newTabWithAddress();
        break;
      case 'activate-tab':
        tabs.activate(action.id);
        break;
      case 'close-tab':
        tabs.close(action.id);
        break;
      case 'discard-tab':
        tabs.discard(action.id);
        break;
      case 'toggle-keep-alive':
        tabs.toggleKeepAlive(action.id);
        break;
      case 'move-tab':
        tabs.move(action.id, action.toIndex);
        break;
      case 'navigate':
        tabs.navigate(resolveInput(action.input, searchEngine()));
        break;
      case 'go-back':
        tabs.goBack();
        break;
      case 'go-forward':
        tabs.goForward();
        break;
      case 'reload':
        tabs.reload();
        break;
    }
  }

  const memoryTimer = setInterval(() => {
    totalMemoryMB = Math.round(readProcessMemory().totalKB / 1024);
    pushState();
  }, MEMORY_POLL_MS);

  window.on('close', () => {
    clearInterval(memoryTimer);
    store.saveNow(tabs.toSession());
    tabs.destroyAll();
    if (!ui.webContents.isDestroyed()) ui.webContents.close();
  });

  const saved = store.load();
  if (saved && saved.tabs.length > 0) {
    tabs.restore(saved);
  } else {
    tabs.open();
  }

  void ui.webContents.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function readPageSet(): string[] {
  try {
    return fs
      .readFileSync(pageSetFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  } catch {
    console.warn(`[bench] page set not found: ${pageSetFile}`);
    return [];
  }
}

app.whenReady().then(() => {
  // macOS ignores the window icon; unpackaged runs need the Dock icon set explicitly.
  app.dock?.setIcon(appIcon);
  createBrowser();
});
app.on('window-all-closed', () => app.quit());
