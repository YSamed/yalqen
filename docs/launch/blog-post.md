# What I learned building a browser on Electron (draft)

> Draft outline with key points. Sections marked TODO need the author's own experience and numbers. Can be published on yalqen.com (see the website plan).

## Intro

- Why build a browser at all: a developer's browser should put tabs, the keyboard and DevTools first; Arc showed the interface could be better, but it is closed source.
- Why Electron: a real Chromium, DevTools, extensions and auto-update for one developer. Link [why-electron.md](../why-electron.md).
- What this post covers: the parts that were harder than expected.

## 1. A browser is mostly window management

- Every tab is its own web contents placed next to the interface; the interface is a web page too.
- Keeping focus, keyboard shortcuts and overlays (command bar, find bar, popups) consistent across separate web contents was the first real challenge.
- TODO: one concrete bug and how it was fixed (focus stealing, z-order of overlays, or shortcut routing).

## 2. Ad blocking in the main process

- Using `@ghostery/adblocker-electron`: filter lists compiled into an engine, requests blocked before they leave the browser.
- Start-up cost: loading the engine from a cached binary instead of parsing filter lists on every launch.
- Cosmetic filtering vs network blocking, and why some sites break.
- Per-site exceptions for developers who need to see a page as users without blockers do.
- TODO: numbers from `npm run bench` with ad blocking on and off (page load and memory).

## 3. Memory saver: discarding tabs without losing work

- Electron has no built-in tab discarding like Chrome's; Yalqen unloads an idle tab and reloads it when you return. TODO: describe how state (scroll, history) is kept.
- What must never be discarded: the active tab, pinned tabs, tabs playing audio, tabs with DevTools open, tabs with typed but unsent input, tabs still loading.
- Timer-based discarding (default 30 minutes) plus reacting to macOS memory pressure by discarding the oldest idle tab first.
- TODO: memory before/after with 40 tabs, from [benchmarks.md](../benchmarks.md).

## 4. Extensions from the Chrome Web Store

- Electron supports a subset of the extension APIs; installing from the Web Store means downloading and unpacking CRX files.
- What works and what does not.
- TODO: the Web Store "Add to Chrome" button story.

## 5. Shipping: signing, notarization and updates

- Developer ID signing with a non-ASCII name in the certificate (`codesign` could not match "Yaşar"), solved by signing by certificate hash.
- electron-builder's keychain handling in CI, and importing the certificate into a dedicated keychain.
- Notarization with an App Store Connect API key.
- Auto-update with electron-updater: Squirrel.Mac only accepts updates signed by the same Developer ID, so early ad-hoc builds could never update themselves.
- Release automation with release-please, build provenance attestations.

## 6. Hardening an Electron app

- Electron fuses: no `runAsNode`, no `NODE_OPTIONS`, no `--inspect`, asar integrity.
- TODO: context isolation and preload design for pages vs the interface.

## 7. What's next: CEF + AppKit?

- Where Electron holds Yalqen back (memory, size, DRM, native feel).
- What CEF + AppKit would fix and what it would cost.
- TODO: the author's current decision.

## Closing

- Invite contributors, link good first issues, the repo and the download.
