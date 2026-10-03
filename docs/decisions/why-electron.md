# Why Electron?

Yalqen is built on [Electron](https://www.electronjs.org/). This page explains why, what it costs, and where the project may go next.

## Where Yalqen is today

- **Engine:** Electron 44, which ships Chromium 152. Every tab is a Chromium renderer, so sites render as they do in Chrome.
- **Interface:** Svelte 5 and TypeScript, rendered in its own web contents next to the page views.
- **Ad and tracker blocking:** [`@ghostery/adblocker-electron`](https://github.com/ghostery/adblocker) runs in the main process and filters requests before they leave the browser.
- **Memory saver:** tabs you have not looked at for 30 minutes (configurable: 15, 30, 60, 120 or off) are discarded and reload when you return. Pinned tabs, tabs playing audio, tabs with DevTools open and tabs with unsaved form input are never discarded. Under macOS memory pressure, the oldest idle tab goes first.
- **Hardening:** the packaged app is signed with a Developer ID, notarized by Apple, and ships with Electron fuses that disable `runAsNode`, `NODE_OPTIONS` and `--inspect`, and only load code from an integrity-checked `app.asar`.

## Why Electron was the right start

- **One person, one week to a usable browser.** Electron gives a full Chromium, a process model, DevTools, extensions and auto-update out of the box. The work goes into the browser's behaviour instead of the engine plumbing.
- **Web compatibility.** Because it is Chromium, sites that work in Chrome work in Yalqen. A browser for developers cannot afford rendering differences.
- **DevTools for free.** The same DevTools, device emulation and protocol that developers already know.
- **Fast iteration on the interface.** The tab panel, command bar and settings are Svelte components with hot reload. Trying an idea takes minutes.

## What it costs

These are real trade-offs, not footnotes:

- **Memory overhead.** The interface is itself a web page, so Yalqen carries one more renderer than a native browser. Our own benchmark shows the interface group at roughly 120 MB on an idle window (see [benchmarks](../benchmarks.md)).
- **Download size.** The DMG is about 120 MB, because every Electron app bundles its own Chromium.
- **Chromium lag.** Electron releases trail stable Chrome. Security fixes arrive with each Electron patch release, which Yalqen picks up through Dependabot and ships through its own auto-updater, but there is always some delay compared to Chrome itself.
- **No DRM out of the box.** Stock Electron does not include Widevine, so DRM-protected streaming sites (Netflix, Disney+ and similar) do not play.
- **Partial extension support.** Electron implements a subset of the Chrome extension APIs. Content blockers and simple extensions work; extensions that depend on APIs Electron lacks do not.
- **Not a native Mac app.** Menus, windows and text fields are close to native, but they are not AppKit. Some macOS behaviours (Services, some accessibility details, Handoff) are missing or approximated.

## The CEF + AppKit direction

The longer-term option under consideration is to keep Chromium as the engine through the [Chromium Embedded Framework (CEF)](https://bitbucket.org/chromiumembedded/cef) and rebuild the interface natively in AppKit.

What it would bring:

- A native interface with no extra web renderer for the chrome, which removes the largest fixed memory cost.
- Real AppKit behaviour: menus, text input, accessibility, Services.
- Control over the Chromium version and build flags, including Widevine through CEF's supported path.

What it would cost:

- The interface would be rewritten from Svelte to Swift/Objective-C, which slows down iteration.
- CEF exposes less than Electron in some places (extensions in particular), so features like the Chrome Web Store integration would need their own work.
- Building and updating Chromium through CEF is heavier than bumping an npm dependency.

<!-- TODO(author): add the concrete plan here — whether CEF + AppKit is decided or still being evaluated, rough timing, and what would trigger the switch. -->

Until then, Electron stays. The goal is to make Yalqen worth using now and to measure honestly where Electron holds it back.
