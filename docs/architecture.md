# Architecture

Yalqen is an Electron app in `apps/browser`. This page maps the source tree so a change can start in the right module.

## Processes

| Process          | Code                                                | Role                                                                                         |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Main             | `src/main`                                          | Windows, tabs, sessions, stores, internal `yalqen://` pages, IPC and network policy          |
| Window interface | `src/renderer/window`                               | Svelte tab panel and toolbar, one per window, drawn behind the page views                    |
| Overlays         | `src/renderer/command-bar`, `src/renderer/find-bar` | Address bar and find bar, each a shared `WebContentsView` moved between windows              |
| Settings page    | `src/renderer/settings`                             | Svelte page served at `yalqen://settings`                                                    |
| Web pages        | `src/preload/page-preload.ts`                       | Sandboxed preload for every tab: gestures, password autofill, settings and web store bridges |

The main process pushes a complete `BrowserState` to each window interface as a JSON string, which crosses the context bridge without the deep copy an object would need. `src/shared/browser-state.ts` keeps unchanged tabs and arrays stable on arrival, and `App.svelte` splits the state into one signal per field, so a title or download update only re-renders what changed.

## Main process

`src/main/main.ts` creates the stores and sessions, then wires them together. Everything else lives in a domain folder:

| Folder         | Contents                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `app/`         | Application wiring: sessions, settings store and IPC, menu, paths, default browser, updater, usage counter |
| `window/`      | `YalqenWindow`, its menus, page capture, import dialogs, find bar, navigation hint, wallpaper and glass    |
| `tabs/`        | `TabManager` and its parts: tab records, freezing, auto reload, translation, page placement, persistence   |
| `address-bar/` | Command bar view, input resolution, search engines, suggestions and preconnect                             |
| `pages/`       | `yalqen://` router, one module per internal page, error pages and internal navigation commands             |
| `library/`     | History, bookmarks, downloads, browser import and data clearing                                            |
| `privacy/`     | Ad blocking, HTTPS-only, certificate exceptions, third-party cookies, permissions and passwords            |
| `extensions/`  | Unpacked and Chrome Web Store extensions, their popup, IPC and ZIP extraction                              |
| `devtools/`    | Developer commands, device emulation, page overrides through the DevTools protocol and request rules       |
| `storage/`     | Debounced, atomic JSON files used by every store                                                           |
| `bench/`       | Instrumentation enabled only by the benchmark harness                                                      |

Modules depend on interfaces they are handed rather than on `main.ts`, for example `SettingsIpcHost` or `AppMenuHost`. Files that need the compiled preloads or renderer pages resolve them through `app/paths.ts`.

## Renderer

| Folder         | Contents                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| `ui/`          | Primitives shared by every page: buttons, fields, selects, switches and icons |
| `window/`      | The window interface: `App`, `TabPanel`, `Toolbar` and device controls        |
| `settings/`    | The settings shell, one component per pane and `SettingRow`                   |
| `command-bar/` | Address bar overlay                                                           |
| `find-bar/`    | Find-in-page overlay                                                          |
| `public/`      | Templates and scripts for the internal pages served by the main process       |

`index.html`, `settings.html`, `command.html` and `find.html` are the Vite entry points.

## Tests and benchmarks

Tests in `apps/browser/test` mirror the source tree (`test/main/library/history.test.mjs` covers `src/main/library/history.ts`) and import the compiled modules from `dist/`, so `npm test` builds the main process and preloads first. Benchmarks in `apps/browser/scripts` read their page list from `apps/browser/bench/pages.txt`, write results to the ignored `bench/results/`, and accept `--module-dir` or `--renderer-dir` to compare a preserved baseline build; `scripts/main-module.mjs` also resolves builds from before the domain folders existed.

## Packaging resources

| Folder                    | Contents                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/browser/build/`     | electron-builder inputs that are not shipped as files: `icon.icns`, entitlements, `tr.lproj`    |
| `apps/browser/resources/` | Files the main process reads at runtime; `icon-512.png` is copied to `Contents/Resources/brand` |
| `assets/`                 | README images and website screenshots, not part of the app                                      |
