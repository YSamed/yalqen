import fs from 'node:fs';
import path from 'node:path';
import { BaseWindow, Menu, WebContentsView, app, ipcMain, nativeTheme, session } from 'electron';
import {
  IpcChannel,
  SettingsChannel,
  type BrowserState,
  type ChromeLayout,
  type UiAction,
  type SettingsView,
  type UiCommand,
  type WindowMaterial,
} from '../shared/types.js';
import { DEFAULT_DEVICE_ID, DEVICES } from './devices.js';
import { registerInternalScheme, serveInternalPages } from './internal-pages.js';
import { applyGlass, glassAvailable } from './glass.js';
import { buildMenu } from './menu.js';
import { MetricsLog, readProcessMemory } from './metrics.js';
import { SessionStore } from './persistence.js';
import { SEARCH_ENGINES, isValidSearchTemplate, resolveSearchEngine } from './search.js';
import { SettingsStore } from './settings.js';
import { SettingsWindow } from './settings-window.js';
import { TabManager } from './tabs.js';
import { resolveInput } from './url.js';

const DAILY_PARTITION = 'persist:daily';
const MEMORY_POLL_MS = 5000;
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
// Offset of the traffic lights from the left edge and top of the tab panel.
const WINDOW_CONTROLS_INSET = { x: 14, y: 15 };

// Keep prototype data apart from any other Electron app.
app.setPath('userData', path.join(app.getPath('appData'), 'yalqen-electron-prototype'));

const repoRoot = path.resolve(app.getAppPath(), '../..');
const metricsLog = new MetricsLog(process.env.YALQEN_METRICS_DIR ?? path.join(repoRoot, 'bench/results'));
const pageSetFile = path.join(repoRoot, 'bench/pages.txt');
const appIcon = path.join(repoRoot, 'design/brand/png/icon-512.png');

registerInternalScheme();

function createBrowser(): void {
  const window = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'yalqen',
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
    // The glass view sits behind the UI, so the window itself must be see-through.
    transparent: glassAvailable,
  });

  const ui = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (glassAvailable) ui.setBackgroundColor('#00000000');
  ui.webContents.on('will-navigate', (event) => event.preventDefault());
  ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.contentView.addChildView(ui);

  const daily = session.fromPartition(DAILY_PARTITION);
  daily.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  daily.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
  serveInternalPages(daily, path.join(__dirname, '../renderer/newtab.html'));

  const store = new SessionStore(app.getPath('userData'));
  const settings = new SettingsStore(app.getPath('userData'));
  const searchEngine = () =>
    resolveSearchEngine(settings.get().searchEngine, settings.get().customSearchTemplate);
  const settingsWindow = new SettingsWindow({
    preload: path.join(__dirname, '../preload/settings-preload.js'),
    page: path.join(__dirname, '../renderer/settings.html'),
    icon: appIcon,
  });
  nativeTheme.themeSource = settings.get().theme;
  let layout: ChromeLayout = { panelWidth: 240, windowControls: true, pageInset: 0, pageRadius: 0 };
  let totalMemoryMB: number | null = null;
  // Device used by the phone view shortcut; the last one picked from the menu.
  // Radio items keep their own checked state, so the menu is not rebuilt.
  let deviceId = DEFAULT_DEVICE_ID;
  // Optimistic until the glass view is added, so the UI does not start opaque.
  let glassApplied = glassAvailable;

  const material = (): WindowMaterial =>
    glassApplied && !nativeTheme.prefersReducedTransparency ? 'glass' : 'opaque';

  const browserState = (): BrowserState => ({
    ...tabs.state(),
    totalMemoryMB,
    addressPlaceholder: searchEngine().placeholder,
    panelCollapsed: settings.get().panelCollapsed,
    material: material(),
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
    freezeBackground: () => settings.get().freezeBackgroundTabs,
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
      x: layout.pageInset,
      y: layout.pageInset,
      width: Math.max(0, width - layout.panelWidth - layout.pageInset),
      height: Math.max(0, height - 2 * layout.pageInset),
    });
    tabs.setPageRadius(layout.pageRadius);
    if (process.platform === 'darwin') {
      // The traffic lights live in the top row of the tab panel.
      window.setWindowButtonVisibility(layout.windowControls);
      window.setWindowButtonPosition({
        x: width - layout.panelWidth + WINDOW_CONTROLS_INSET.x,
        y: WINDOW_CONTROLS_INSET.y,
      });
    }
  };
  window.on('resize', applyLayout);
  applyLayout();

  const recordSnapshot = (label: string) => {
    const memory = readProcessMemory();
    const file = metricsLog.write({
      event: 'snapshot',
      label,
      tabs: { total: tabs.count, live: tabs.liveCount, frozen: tabs.frozenCount },
      totalWorkingSetKB: memory.totalKB,
      processes: memory.processes,
    });
    console.log(`[metrics] ${label}: ${Math.round(memory.totalKB / 1024)} MB -> ${file}`);
  };

  const settingsView = (): SettingsView => {
    const { version: _version, ...values } = settings.get();
    return {
      values,
      engines: SEARCH_ENGINES.map(({ id, label }) => ({ id, label })),
      customTemplateValid: isValidSearchTemplate(values.customSearchTemplate),
    };
  };
  const updateSettings = (patch: unknown) => {
    const wasFreezing = settings.get().freezeBackgroundTabs;
    settings.update(patch);
    nativeTheme.themeSource = settings.get().theme;
    if (settings.get().freezeBackgroundTabs !== wasFreezing) tabs.applyFreezeSetting();
    pushState();
    settingsWindow.send(settingsView());
  };
  const togglePanel = () => updateSettings({ panelCollapsed: !settings.get().panelCollapsed });

  const newTabWithAddress = () => {
    tabs.open();
    sendCommand({ type: 'focus-address' });
  };

  Menu.setApplicationMenu(
    buildMenu({
      newTab: newTabWithAddress,
      closeTab: () => {
        // The shortcut is app-wide; in the settings window it closes that window.
        if (settingsWindow.isFocused()) settingsWindow.close();
        else if (tabs.activeTabId) tabs.close(tabs.activeTabId);
      },
      reopenClosedTab: () => tabs.reopenClosed(),
      focusAddress: () => sendCommand({ type: 'focus-address' }),
      reload: () => tabs.reload(),
      goBack: () => tabs.goBack(),
      goForward: () => tabs.goForward(),
      togglePanel,
      toggleDevTools: () => tabs.toggleDevTools(),
      toggleDeviceView: () => tabs.toggleEmulation(deviceId),
      rotateDevice: () => tabs.rotateDevice(),
      devices: DEVICES.map((device) => ({
        id: device.id,
        label: device.label,
        checked: device.id === deviceId,
      })),
      selectDevice: (id) => {
        deviceId = id;
        tabs.selectDevice(id);
      },
      selectTab: (index) => tabs.selectByIndex(index),
      openPageSet: () => {
        for (const url of readPageSet()) tabs.open(url, { activate: false });
      },
      discardBackground: () => tabs.discardBackground(),
      simulateMemoryPressure: () => {
        void tabs.simulateMemoryPressure().then((sent) => {
          if (sent) console.log('[memory] critical pressure notification sent');
        });
      },
      recordSnapshot: () =>
        recordSnapshot(`live-${tabs.liveCount}/frozen-${tabs.frozenCount}/total-${tabs.count}`),
      openSettings: () => settingsWindow.open(),
    }),
  );

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
  ipcMain.handle(SettingsChannel.get, (event) =>
    event.sender === settingsWindow.contents ? settingsView() : null,
  );
  ipcMain.handle(SettingsChannel.update, (event, patch: unknown) => {
    if (event.sender !== settingsWindow.contents) return null;
    updateSettings(patch);
    return settingsView();
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
      case 'toggle-panel':
        togglePanel();
        break;
      case 'open-settings':
        settingsWindow.open();
        break;
    }
  }

  // "Reduce transparency" can change while the app runs; the UI then paints opaque.
  nativeTheme.on('updated', pushState);
  ui.webContents.once('did-finish-load', () => {
    glassApplied = applyGlass(window);
    pushState();
  });

  const memoryTimer = setInterval(() => {
    totalMemoryMB = Math.round(readProcessMemory().totalKB / 1024);
    pushState();
  }, MEMORY_POLL_MS);

  window.on('close', () => {
    clearInterval(memoryTimer);
    settingsWindow.close();
    nativeTheme.off('updated', pushState);
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

app.setAboutPanelOptions({
  applicationName: 'yalqen',
  applicationVersion: app.getVersion(),
  version: `Faz 0 prototipi · Electron ${process.versions.electron}`,
  iconPath: appIcon,
});

app.whenReady().then(() => {
  // macOS ignores the window icon; unpackaged runs need the Dock icon set explicitly.
  app.dock?.setIcon(appIcon);
  createBrowser();
});
app.on('window-all-closed', () => app.quit());
