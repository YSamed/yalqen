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
      sanitizeSettings({
        agentBridge: true,
        agentOrigins: ['https://my-app.ngrok.app'],
        adBlockExceptions: ['https://example.com'],
        thirdPartyCookieExceptions: ['https://accounts.example.com'],
      }),
    ),
    defaultBrowser: false,
    engines: SEARCH_ENGINES.map(({ id, label }) => ({ id, label })),
    customTemplateValid: true,
    spaces: [{ id: '', name: 'Default', icon: null }],
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
    connectionsRevision: 0,
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
const storage = [
  { domain: 'example.com', origins: 2, cookies: 12, databaseBytes: 2516582 },
  { domain: 'github.com', origins: 3, cookies: 41, databaseBytes: 18874368 },
  { domain: 'localhost', origins: 1, cookies: 2, databaseBytes: 348160 },
  { domain: 'wikipedia.org', origins: 2, cookies: 4, databaseBytes: 1048576 },
];
const icons = { 'github.com': 'https://github.githubassets.com/favicons/favicon.svg', 'wikipedia.org': 'https://www.wikipedia.org/static/favicon/wikipedia.ico' };
contextBridge.exposeInMainWorld('yalqenSettings', {
  get: async () => view, update: async () => view, onChange: none, clearData: async () => {}, makeDefault: async () => view,
  processUsage: async () => ({ totalMB: 512, groups: [], pages: [] }), checkForUpdates: async () => {}, installUpdate: async () => {},
  requestRules: async () => [], saveRequestRules: async (rules) => rules, extensions: async () => [{ path: "/Extensions/example", id: "example", name: "Example extension", version: "1.0", description: "", enabled: true, error: null, icon: null, hasOptions: false, fromStore: true, updating: false, updateError: null }], checkExtensionUpdates: async () => null, installExtension: async () => null,
  installExtensionFromStore: async () => null, openExtensionStore: async () => {}, removeExtension: async () => {},
  setExtensionEnabled: async () => {}, openExtensionOptions: async () => {}, onExtensionsChange: none,
  profiles: async () => ({ currentId: 'default', profiles: [{ id: 'default', name: 'Default', active: true, default: true, running: true }] }),
  agentConnections: async () => ({ claude: 'missing', codex: 'missing' }),
  autofill: async () => ({ available: true, records: [] }), onAutofillChange: none,
  passwords: async () => ({ available: true, passwords: [], neverSave: [] }), revealPassword: async () => null,
  copyPassword: async () => false, removePassword: async () => {}, allowSaving: async () => {}, onPasswordsChange: none,
  agentBridge: async () => agent, copyAgentSetup: async () => true, regenerateAgentToken: async () => agent,
  addAgentToClaude: async () => ({ ok: true }),
  onAgentBridgeChange: none,
  sitePermissions: async () => permissions, setSitePermission: async () => permissions,
  forgetSitePermissions: async () => permissions, openSystemSettings: async () => {},
  siteStorage: async (query) => ({ sites: storage.filter((site) => site.domain.includes(query)), total: storage.length, offset: 0, more: false, limited: false }),
  clearSiteStorage: async () => false,
  siteIcons: async (domains) => Object.fromEntries(domains.filter((domain) => icons[domain]).map((domain) => [domain, icons[domain]])),
});`,
    window: (material, extra = '') => `
const { contextBridge } = require('electron');
const tab = (index) => ({
  id: 'tab-' + index, title: 'Page ' + index, url: 'https://site' + index + '.example/', faviconUrl: null,
  live: index === 0, frozen: false, loading: index === 2, pinned: index === 1, security: 'secure', isPrivate: false,
  bookmarked: false, blockedPopups: 0,
  overrides: { cacheDisabled: false, network: null, colorScheme: null, reducedMotion: false, printMedia: false, userAgent: null, requestRules: false },
  translation: { status: 'idle', available: false }, autoReloadSeconds: null, audible: false, muted: false,
  canGoBack: index === 0, canGoForward: false, agentObserved: index === 0, agentReadAt: null, agentEpisode: null, agentRules: 0,
});
const state = {
  tabs: [0, 1, 2, 3, 4].map(tab), listOrder: ['tab-0', 'tab-1', 'tab-2', 'tab-3', 'tab-4'], developer: false,
  activeTabId: 'tab-0', selectedTabIds: [], pageFullScreen: false, windowFullScreen: false,
  panelCollapsed: false, favorites: [], sidebarVisible: true, splitTabIds: [],
  activeSpaceId: '', spaces: [{ id: '', name: 'Default', icon: null }], sidebarFooterItems: ['downloads'],
  media: { tabId: 'tab-3', title: 'Page 3', duration: 200, position: 80, playing: false, canPrevious: true, canNext: true, updatedAt: 0 },
  toolbarButtons: ['bookmarks', 'history', 'settings', 'downloads'], material: ${JSON.stringify(material)}, device: null,
  accent: '#f28c28',
  zoom: 1, defaultZoom: 1, downloads: { active: 1, progress: 0.4, started: 1 }, extensions: false, profile: 'personal',
  agentPanelOpen: false, agentSession: { id: null, directory: null, status: 'idle', exitCode: null, error: null },
  agentChat: { id: null, directory: null, status: 'idle', model: null, error: null }, agentProviders: ['claude'],
  projectRun: { directory: null, command: null, status: 'idle', url: null, exitCode: null },
  agentElements: [],
  agentTerminal: false,
  agentProjects: [], agentProjectId: '', agentConversationId: '', agentBackgroundChats: [],
};
const api = {};
${extra}
contextBridge.exposeInMainWorld('yalqen', {
  getState: async () => state, onState: () => () => {}, onAddLiveFolder: () => () => {}, setLayout: () => {}, send: () => {},
  ...api,
});`,
  };
  // Sidebar parts the plain window leaves empty: favorites, nested and collapsed groups, spaces and footer tools.
  const fullSidebar = `
Object.assign(state, {
  favorites: [{ url: 'https://site3.example/', title: 'Site 3', faviconUrl: null }, { url: 'https://docs.example/', title: 'Docs', faviconUrl: null }],
  tabGroups: [{ name: 'Work', collapsed: false, count: 2, parent: null }, { name: 'Notes', collapsed: false, count: 1, parent: 'Work' }, { name: 'Later', collapsed: true, count: 1, parent: null }],
  spaces: [{ id: '', name: 'Default', icon: null }, { id: 'side', name: 'Side', icon: '🌿' }],
  sidebarFooterItems: ['history', 'bookmarks', 'spaces', 'downloads', 'settings'],
  selectedTabIds: ['tab-3', 'tab-4'], tabCleanup: true, updateReady: true,
  agentProjects: [{ id: 'p', directory: '/work/site', busy: true, waiting: true }],
});
state.tabs[2].group = 'Work'; state.tabs[3].group = 'Notes'; state.tabs[4].group = 'Later';
state.tabs[3].unread = true; state.tabs[4].audible = true;
`;
  // A chat with every part the transcript renders: markdown, tool cards, a queued prompt and a permission request.
  const agentChat = `
Object.assign(state, {
  profile: 'developer', agentPanelOpen: true, agentTerminal: true, agentProjectId: 'p', agentConversationId: 'c',
  agentSession: { id: 's', directory: '/work/site', status: 'running', exitCode: null, error: null },
  agentChat: { id: 'chat', directory: '/work/site', status: 'approval', model: 'claude-opus-5-5', error: null },
  projectRun: { directory: '/work/site', command: 'npm run dev', status: 'running', url: 'http://localhost:5173', exitCode: null },
  agentElements: [{ id: 'yk_1', tabId: 'tab-0', url: 'https://site0.example/', label: 'header.site-header', component: 'SiteHeader', source: 'src/Header.tsx:12' }],
  agentBackgroundChats: [{ id: 'bg', title: 'Fix the footer', status: 'thinking' }],
});
const chatState = {
  id: 'chat', provider: 'claude', workMode: 'normal', replyLength: 'short', directory: '/work/site', status: 'approval',
  model: 'claude-opus-5-5', modelChoice: null, effort: null, permissionMode: 'acceptEdits',
  models: [{ value: 'default', label: 'Default', efforts: ['low', 'high'] }, { value: 'claude-sonnet-5-5', label: 'Sonnet', efforts: [] }],
  commands: [{ name: 'review', description: 'Review the diff', argumentHint: '' }],
  usage: { cost: 0.42, contextTokens: 52000, contextLimit: 200000 }, error: null,
};
const message = (id, role, parts, extra = {}) => ({ id, role, parts, context: null, elements: [], episode: null, images: [], reverted: false, workMode: 'normal', ...extra });
const tool = (id, name, input, output, status = 'done') => ({ type: 'tool', id, name, input: JSON.stringify(input), output, status, verification: null, task: null, steps: [] });
const snapshot = {
  state: chatState, revision: 3,
  messages: [
    message('m1', 'user', [{ type: 'text', text: 'Why does the header overlap the page?' }], { context: { id: 'tab-0', title: 'Page 0', url: 'https://site0.example/', local: false } }),
    message('m2', 'assistant', [
      { type: 'text', text: '## Cause\\n\\nThe header uses **position: fixed** and the page has no top padding.\\n\\n- Fix the \\\`padding-top\\\`\\n- Keep the height in one token\\n\\n| File | Change |\\n|---|---|\\n| Header.tsx | sticky |\\n\\n\\\`\\\`\\\`css\\n.page { padding-top: 64px; }\\n\\\`\\\`\\\`' },
      tool('t1', 'Read', { file_path: '/work/site/src/Header.tsx' }, '12 lines'),
      tool('t2', 'Edit', { file_path: '/work/site/src/Header.tsx', old_string: 'position: fixed;', new_string: 'position: sticky;' }, 'ok'),
      tool('t3', 'Bash', { command: 'npm test' }, 'Tests failed', 'error'),
    ]),
  ],
  queue: [message('q1', 'user', [{ type: 'text', text: 'Then update the footer too' }])],
  permissions: [{
    id: 'perm', tool: 'Bash', title: 'Run npm run build', input: JSON.stringify({ command: 'npm run build' }), plan: '1. Build\\n2. Check the output', canAlwaysAllow: true,
    questions: [{ question: 'Which pages?', multiSelect: true, options: [{ label: 'Home', description: 'Landing page' }, { label: 'Docs', description: 'Guides' }] }],
  }],
};
const none = () => () => {};
const nothing = async () => null;
for (const name of ['writeAgentTerminal', 'sendAgentChat', 'cancelResponsiveScan', 'stopProjectRun', 'stopAgentSession', 'startProjectRun',
  'startAgentSession', 'signOutAgent', 'signInAgent', 'showBackgroundAgentChat', 'selectAgentProvider', 'selectAgentDirectory', 'runResponsiveScan',
  'rewindAgentChat', 'respondAgentChat', 'resizeAgentTerminal', 'removeAgentElement', 'openBackgroundAgentChatInTab', 'openAgentFile', 'openAgentChat',
  'interruptAgentChat', 'highlightAgentElement', 'getResponsiveScanReview', 'getResponsiveScan', 'getAgentTerminal', 'fixAgentEpisode',
  'dismissBackgroundAgentChat', 'deleteAgentChat', 'continueAgentChatInProject', 'configureAgentChat', 'clearResponsiveScan', 'cancelQueuedAgentChat',
  'newAgentChat', 'agentChatHistory', 'previewAgentRewind'])
  api[name] = nothing;
Object.assign(api, {
  updateAgentDraft: () => {}, onAgentOutput: none, onAgentChat: none, searchAgentFiles: async () => [],
  getAgentDraft: async () => ({ text: 'Check the footer', attachments: [], images: [] }),
  getAgentChat: async () => snapshot,
});
`;
  for (const [name, source] of Object.entries({
    settings: preloads.settings,
    'window-opaque': preloads.window('opaque'),
    'window-glass': preloads.window('glass'),
    'window-full': preloads.window('opaque', fullSidebar),
    'window-agent': preloads.window('opaque', agentChat),
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
    readyUpdate: () => null,
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
    const errorHtml =
      errorPageHtml.length > 3
        ? errorPageHtml(fs.readFileSync(path.join(rendererDir, 'tokens.css'), 'utf8'), ...errorArgs)
        : errorPageHtml(...errorArgs);
    fs.writeFileSync(errorPage, errorHtml);
    const surfaces = [
      { name: 'window-glass', file: path.join(rendererDir, 'index.html'), preload: 'window-glass.cjs' },
      { name: 'window-opaque', file: path.join(rendererDir, 'index.html'), preload: 'window-opaque.cjs' },
      { name: 'window-full', file: path.join(rendererDir, 'index.html'), preload: 'window-full.cjs' },
      { name: 'window-agent', file: path.join(rendererDir, 'index.html'), preload: 'window-agent.cjs' },
      { name: 'newtab', url: 'yalqen://newtab/' },
      { name: 'history', url: 'yalqen://history/' },
      { name: 'bookmarks', url: 'yalqen://bookmarks/' },
      { name: 'downloads', url: 'yalqen://downloads/' },
      { name: 'error', file: errorPage },
      ...['general', 'tabs', 'privacy', 'profiles', 'passwords', 'extensions', 'shortcuts', 'advanced'].map((pane) => ({
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
