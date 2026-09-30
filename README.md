<div align="center">
  <img src="design/brand/png/icon-256.png" alt="Yalqen" width="112">

  <h1>Yalqen</h1>

  <p>Open-source, Chromium-based developer browser for macOS. Vertical tabs, keyboard-first command bar, built-in ad blocking.</p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><img src="https://img.shields.io/github/v/release/YSamed/yalqen" alt="Latest release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/YSamed/yalqen" alt="MIT license"></a>
    <a href="https://github.com/YSamed/yalqen/releases"><img src="https://img.shields.io/github/downloads/YSamed/yalqen/total" alt="Downloads"></a>
    <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
    <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  </p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><img src="design/readme/download-button.png" alt="Download for macOS" width="260"></a>
  </p>

  <p>
    <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">Website</a> ·
    <a href="apps/browser/CHANGELOG.md">Changelog</a> ·
    <a href="CONTRIBUTING.md">Contribute</a> ·
    <a href="https://github.com/YSamed/yalqen/issues">Report a bug</a> ·
    <a href="README.tr.md">Türkçe</a>
  </p>
</div>

<p align="center">
  <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="design/screenshots/website-dark.png">
      <source media="(prefers-color-scheme: light)" srcset="design/screenshots/website-light.png">
      <img src="design/screenshots/website-light.png" alt="Yalqen website: Light as paper. Clear as glass." width="900">
    </picture>
  </a>
</p>

<p align="center">
  <img src="design/readme/feature-ad-blocking.png" alt="Ad & tracker blocking" width="240">
  <img src="design/readme/feature-cookies.png" alt="Third-party cookie blocking" width="281">
  <img src="design/readme/feature-https-only.png" alt="HTTPS-only mode" width="215">
  <img src="design/readme/feature-secure-dns.png" alt="Secure DNS" width="174">
  <img src="design/readme/feature-command-bar.png" alt="Command bar" width="188">
  <img src="design/readme/feature-pinned-tabs.png" alt="Pinned tabs" width="173">
  <img src="design/readme/feature-memory-saver.png" alt="Memory saver" width="189">
  <img src="design/readme/feature-search-engines.png" alt="Search engines" width="209">
  <img src="design/readme/feature-developer-tools.png" alt="Developer tools" width="200">
</p>

## Features

- **Vertical tabs** with pinned tabs, address bar and window controls in one panel
- **Command bar** for keyboard-first navigation and actions ([keyboard shortcuts](docs/keyboard-shortcuts.md))
- **Ad and tracker blocking** with a built-in filter engine, plus third-party cookie blocking
- **HTTPS-only mode** and **secure DNS**
- **Developer tools** and a one-key **phone view**
- **Memory saver** and seven built-in search engines

## Install

> **Requires macOS 13 or later on Apple Silicon.** Intel Macs are not supported.

With [Homebrew](https://brew.sh):

```bash
brew install --cask YSamed/yalqen/yalqen
```

Or download the DMG from [Releases](https://github.com/YSamed/yalqen/releases/latest). The app is signed with a Developer ID and notarized, so it opens without a Gatekeeper warning.

Yalqen updates itself in the background. To update through Homebrew instead:

```bash
brew upgrade --cask yalqen
```

To uninstall and remove its data:

```bash
brew uninstall --zap --cask yalqen
```

## Development

The app lives in `apps/browser`. You need Node.js 22.12 or later.

```bash
cd apps/browser
npm ci
npm start
```

Other commands, all run from `apps/browser`:

| Command               | What it does                            |
| --------------------- | --------------------------------------- |
| `npm run check`       | Lint, format check, typecheck and tests |
| `npm test`            | Tests only                              |
| `npm run package:mac` | Build the macOS app bundle              |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

- Yalqen is released under the [MIT License](LICENSE).
- Bundled filter lists keep their own licenses, see [THIRD_PARTY_NOTICES.md](apps/browser/THIRD_PARTY_NOTICES.md).
- The Yalqen name and logo are not covered by the MIT License.
