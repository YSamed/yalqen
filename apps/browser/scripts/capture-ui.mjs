import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const usage = `Usage:
  node scripts/capture-ui.mjs --out <dir>         capture every surface in light and dark
  node scripts/capture-ui.mjs --compare <a> <b>   list computed style differences between two captures

Options:
  --renderer-dir  built renderer to capture   (default: dist/renderer)
  --module-dir    built main modules          (default: dist/main)

Each capture writes <surface>-<scheme>.png and the computed colors, borders and shadows of every element
to <surface>-<scheme>.json, so a styling refactor can be checked for unintended changes.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    compare: { type: 'boolean', default: false },
    'renderer-dir': { type: 'string', default: fileURLToPath(new URL('../dist/renderer/', import.meta.url)) },
    'module-dir': { type: 'string', default: fileURLToPath(new URL('../dist/main/', import.meta.url)) },
    help: { type: 'boolean', default: false },
  },
});

const STYLE_PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'opacity',
  'filter',
  'backdrop-filter',
  'caret-color',
  'accent-color',
  'text-decoration-color',
  'color-scheme',
];

if (values.help || (!values.compare && !values.out)) {
  console.log(usage);
} else if (values.compare) {
  compare(positionals[0], positionals[1]);
} else if (!process.versions.electron) {
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  void capture();
}

function compare(before, after) {
  if (!before || !after) throw new Error('--compare needs two capture directories');
  let differences = 0;
  for (const file of fs.readdirSync(before).filter((name) => name.endsWith('.json'))) {
    const next = path.join(after, file);
    if (!fs.existsSync(next)) {
      console.log(`${file}: missing in ${after}`);
      differences++;
      continue;
    }
    const a = JSON.parse(fs.readFileSync(path.join(before, file), 'utf8'));
    const b = JSON.parse(fs.readFileSync(next, 'utf8'));
    if (a.length !== b.length) {
      console.log(`${file}: ${a.length} elements before, ${b.length} after`);
      differences++;
      continue;
    }
    for (let index = 0; index < a.length; index++) {
      for (const property of STYLE_PROPERTIES) {
        if (a[index].style[property] === b[index].style[property]) continue;
        differences++;
        console.log(`${file} ${a[index].path} ${property}: ${a[index].style[property]} -> ${b[index].style[property]}`);
      }
    }
  }
  console.log(differences === 0 ? 'No computed style differences.' : `${differences} differences.`);
  process.exitCode = differences === 0 ? 0 : 1;
}

async function capture() {
  const { app, BrowserWindow, nativeTheme, session } = require('electron');
  const rendererDir = path.resolve(values['renderer-dir']);
  const moduleDir = path.resolve(values['module-dir']);
  // Loaded synchronously: the internal scheme must be registered before the app is ready.
  const load = (file) => require(path.join(moduleDir, file));
  const internalPages = load('pages/internal-pages.js');
  internalPages.registerInternalScheme();
  const { errorPageHtml } = load('pages/error-page.js');
  const { ChangeFeed } = load('library/change-feed.js');
  const { SEARCH_ENGINES } = load('address-bar/search.js');
  const { sanitizeSettings } = load('app/settings.js');

  const out = path.resolve(values.out);
  fs.mkdirSync(out, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-capture-'));
  app.setPath('userData', profile);

  const now = Date.UTC(2026, 9, 3, 12);
  const settingsView = {
    downloadDirectory: path.join(profile, 'Downloads'),
    values: (({ version: _version, ...rest }) => rest)(
      sanitizeSettings({ agentBridge: true, agentOrigins: ['https://my-app.ngrok.app'] }),
    ),
    defaultBrowser: false,
    engines: SEARCH_ENGINES.map(({ id, label }) => ({ id, label })),
    customTemplateValid: true,
    version: '0.0.0',
    update: { state: 'idle' },
  };
  const agentView = {
    enabled: true,
    port: 47823,
    error: null,
    lastCallAt: now,
    calls: 3,
    client: 'Claude Code',
    staleTokenAt: null,
    url: 'http://127.0.0.1:47823/mcp',
    claudeCommand:
      'claude mcp add --scope user --transport http yalqen http://127.0.0.1:47823/mcp --header "Authorization: Bearer <token>"',
    codexConfig: [
      '# ~/.codex/config.toml',
      '[mcp_servers.yalqen]',
      'url = "http://127.0.0.1:47823/mcp"',
      'bearer_token_env_var = "YALQEN_MCP_TOKEN"',
      '',
      '# shell profile',
      'export YALQEN_MCP_TOKEN="<token>"',
    ].join('\n'),
    otelConfig: [
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:47823/v1/traces',
      'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json',
      'OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Bearer%20<token>',
    ].join('\n'),
    observedTabs: 2,
  };
  const preloads = {
    settings: `
const { contextBridge } = require('electron');
const view = ${JSON.stringify(settingsView)};
const agent = ${JSON.stringify(agentView)};
const none = () => () => {};
const permissions = {
  sites: [{ origin: 'https://meet.example.com', permissions: [{ kind: 'camera', decision: 'allow' }, { kind: 'microphone', decision: 'allow' }] }],
  system: { camera: 'granted', microphone: 'denied', screen: 'not-determined' },
};
contextBridge.exposeInMainWorld('yalqenSettings', {
  get: async () => view, update: async () => view, onChange: none, clearData: async () => {}, makeDefault: async () => view,
  processUsage: async () => ({ totalMB: 512, groups: [], pages: [] }), checkForUpdates: async () => {}, installUpdate: async () => {},
  requestRules: async () => [], saveRequestRules: async (rules) => rules, extensions: async () => [], installExtension: async () => null,
  installExtensionFromStore: async () => null, openExtensionStore: async () => {}, removeExtension: async () => {},
  setExtensionEnabled: async () => {}, openExtensionOptions: async () => {}, onExtensionsChange: none,
  passwords: async () => ({ available: true, passwords: [], neverSave: [] }), revealPassword: async () => null,
  copyPassword: async () => false, removePassword: async () => {}, allowSaving: async () => {}, onPasswordsChange: none,
  agentBridge: async () => agent, copyAgentSetup: async () => true, regenerateAgentToken: async () => agent,
  addAgentToClaude: async () => ({ ok: true }),
  onAgentBridgeChange: none,
  sitePermissions: async () => permissions, setSitePermission: async () => permissions,
  forgetSitePermissions: async () => permissions, openSystemSettings: async () => {},
});`,
    window: (material) => `
const { contextBridge } = require('electron');
const tab = (index) => ({
  id: 'tab-' + index, title: 'Page ' + index, url: 'https://site' + index + '.example/', faviconUrl: null,
  live: index === 0, frozen: false, loading: index === 2, pinned: index === 1, security: 'secure', isPrivate: false,
  bookmarked: false, blockedPopups: 0, consoleErrors: 0,
  overrides: { cacheDisabled: false, network: null, colorScheme: null, reducedMotion: false, printMedia: false, userAgent: null, requestRules: false },
  translation: { status: 'idle', available: false }, autoReloadSeconds: null, audible: false, muted: false,
  canGoBack: index === 0, canGoForward: false, agentObserved: index === 0, agentReadAt: null, agentEpisode: null, agentRules: 0,
});
const state = {
  tabs: [0, 1, 2, 3, 4].map(tab), listOrder: ['tab-0', 'tab-1', 'tab-2', 'tab-3', 'tab-4'], developer: false,
  activeTabId: 'tab-0', pageFullScreen: false, windowFullScreen: false, addressPlaceholder: 'Search or type an address',
  panelCollapsed: false, panelSide: 'left', pinnedDisplay: 'list', sidebarVisible: true, toolbarVisible: true, toolbarTabs: true,
  toolbarButtons: ['bookmarks', 'history', 'settings', 'downloads'], material: ${JSON.stringify(material)}, device: null,
  zoom: 1, defaultZoom: 1, downloads: { active: 1, progress: 0.4, started: 1 }, extensions: false, profile: 'personal',
  agentPanelOpen: false, agentSession: { id: null, directory: null, status: 'idle', exitCode: null, error: null },
  agentChat: { id: null, directory: null, status: 'idle', model: null, error: null },
  projectRun: { directory: null, command: null, status: 'idle', url: null, exitCode: null },
  agentElements: [],
  agentTerminal: false,
};
contextBridge.exposeInMainWorld('yalqen', {
  getState: async () => state, onState: () => () => {}, onWallpaper: () => () => {}, setLayout: () => {}, send: () => {},
});`,
  };
  for (const [name, source] of Object.entries({
    settings: preloads.settings,
    'window-opaque': preloads.window('opaque'),
    'window-glass': preloads.window('glass'),
  })) {
    fs.writeFileSync(path.join(profile, `${name}.cjs`), source);
  }

  const visits = [
    { id: 'v1', url: 'https://github.com/YSamed/yalqen', title: 'YSamed/yalqen', visitedAt: now - 60_000 },
    { id: 'v2', url: 'https://developer.mozilla.org/', title: 'MDN Web Docs', visitedAt: now - 3_600_000 },
    { id: 'v3', url: 'https://example.com/', title: 'Example Domain', visitedAt: now - 90_000_000 },
  ];
  const sources = {
    pinned: () => [{ url: 'https://github.com/', title: 'GitHub', faviconUrl: null }],
    visits: () => visits,
    downloads: {
      list: () => [
        {
          id: 'd1',
          url: 'https://example.com/a.zip',
          filename: 'a.zip',
          savePath: '/tmp/a.zip',
          state: 'completed',
          receivedBytes: 2_048_000,
          totalBytes: 2_048_000,
          startedAt: now - 120_000,
        },
        {
          id: 'd2',
          url: 'https://example.com/b.dmg',
          filename: 'b.dmg',
          savePath: '/tmp/b.dmg',
          state: 'progressing',
          receivedBytes: 4_000_000,
          totalBytes: 10_000_000,
          startedAt: now - 10_000,
        },
        {
          id: 'd3',
          url: 'https://example.com/c.pdf',
          filename: 'c.pdf',
          savePath: '/tmp/c.pdf',
          state: 'interrupted',
          receivedBytes: 10,
          totalBytes: 100,
          startedAt: now - 300_000,
        },
      ],
      changes: new ChangeFeed(),
    },
    bookmarks: () => ({
      folders: [{ id: 'f1', title: 'Work', createdAt: 1 }],
      bookmarks: [
        { id: 'b1', url: 'https://github.com/', title: 'GitHub', folderId: null, createdAt: 1 },
        { id: 'b2', url: 'https://example.com/', title: 'Example', folderId: 'f1', createdAt: 2 },
      ],
    }),
    showWelcome: () => false,
    showRepoPrompt: () => false,
    suggestions: () => [],
  };

  const timer = setTimeout(() => {
    console.error('Capture timed out');
    app.exit(1);
  }, 120_000);
  try {
    await app.whenReady();
    const pages = internalPages.loadInternalPages({
      newTab: path.join(rendererDir, 'newtab.html'),
      newTabScript: path.join(rendererDir, 'newtab-suggestions.js'),
      history: path.join(rendererDir, 'history.html'),
      downloads: path.join(rendererDir, 'downloads.html'),
      bookmarks: path.join(rendererDir, 'bookmarks.html'),
      settings: path.join(rendererDir, 'settings.html'),
    });
    internalPages.serveInternalPages(session.defaultSession, pages, sources);

    const errorPage = path.join(profile, 'error.html');
    const errorArgs = [-105, 'ERR_NAME_NOT_RESOLVED', 'https://example.invalid/'];
    // Builds before the shared tokens.css take no theme argument.
    const errorHtml =
      errorPageHtml.length > 3
        ? errorPageHtml(fs.readFileSync(path.join(rendererDir, 'tokens.css'), 'utf8'), ...errorArgs)
        : errorPageHtml(...errorArgs);
    fs.writeFileSync(errorPage, errorHtml);
    const surfaces = [
      { name: 'window-glass', file: path.join(rendererDir, 'index.html'), preload: 'window-glass.cjs' },
      { name: 'window-opaque', file: path.join(rendererDir, 'index.html'), preload: 'window-opaque.cjs' },
      { name: 'newtab', url: 'yalqen://newtab/' },
      { name: 'history', url: 'yalqen://history/' },
      { name: 'bookmarks', url: 'yalqen://bookmarks/' },
      { name: 'downloads', url: 'yalqen://downloads/' },
      { name: 'error', file: errorPage },
      ...['general', 'appearance', 'privacy', 'passwords', 'performance', 'extensions', 'developer'].map((pane) => ({
        name: `settings-${pane}`,
        url: pane === 'general' ? 'yalqen://settings/' : `yalqen://settings/${pane}`,
        preload: 'settings.cjs',
      })),
    ];

    for (const scheme of ['light', 'dark']) {
      nativeTheme.themeSource = scheme;
      for (const surface of surfaces) {
        const window = new BrowserWindow({
          width: 1100,
          height: 760,
          show: false,
          paintWhenInitiallyHidden: true,
          webPreferences: {
            preload: surface.preload ? path.join(profile, surface.preload) : undefined,
            sandbox: true,
            contextIsolation: true,
          },
        });
        try {
          if (surface.url) await window.loadURL(surface.url);
          else await window.loadFile(surface.file);
          await window.webContents.executeJavaScript(`document.fonts.ready
            .then(() => new Promise((resolve) => setTimeout(resolve, 700)))
            .then(() => document.getAnimations().forEach((animation) => {
              animation.pause();
              animation.currentTime = 0;
            }))`);
          const styles = await window.webContents.executeJavaScript(`(() => {
            const properties = ${JSON.stringify(STYLE_PROPERTIES)};
            const describe = (element) => {
              const parts = [];
              for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
                const index = node.parentElement ? [...node.parentElement.children].indexOf(node) : 0;
                parts.unshift(node.localName + (node.classList.length ? '.' + [...node.classList].join('.') : '') + ':' + index);
              }
              return parts.join(' > ');
            };
            return [...document.querySelectorAll('*')].map((element) => {
              const computed = getComputedStyle(element);
              return { path: describe(element), style: Object.fromEntries(properties.map((name) => [name, computed.getPropertyValue(name)])) };
            });
          })()`);
          fs.writeFileSync(path.join(out, `${surface.name}-${scheme}.json`), `${JSON.stringify(styles, null, 1)}\n`);
          fs.writeFileSync(
            path.join(out, `${surface.name}-${scheme}.png`),
            (await window.webContents.capturePage()).toPNG(),
          );
          console.log(`${surface.name}-${scheme}: ${styles.length} elements`);
        } finally {
          // Destroying the window while its renderer still runs makes the next load of the same file fail.
          await new Promise((resolve) => {
            window.once('closed', resolve);
            window.close();
          });
        }
      }
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
