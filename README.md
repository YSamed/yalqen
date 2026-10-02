<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/readme/wordmark-dark.png">
    <img src="design/readme/wordmark-light.png" alt="Yalqen" width="300">
  </picture>

  <p>
    <strong>A keyboard-first Chromium browser built for developers on macOS.</strong><br>
    Vertical tabs, a fast command bar, built-in ad and tracker blocking,<br>and developer tools without the usual browser chrome.
  </p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/download-dmg-dark.png"><img src="design/readme/download-dmg.png" alt="Download the DMG" width="250"></picture></a>
    <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/install-homebrew-dark.png"><img src="design/readme/install-homebrew.png" alt="Install with Homebrew" width="250"></picture></a>
    <br>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/YSamed/yalqen/badges/release-dark.svg"><img src="https://raw.githubusercontent.com/YSamed/yalqen/badges/release-light.svg" alt="Latest release and total downloads" height="56"></picture></a>
  </p>

  <p>
    <sub>
      <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">Website</a> ·
      <a href="apps/browser/CHANGELOG.md">Changelog</a> ·
      <a href="CONTRIBUTING.md">Contribute</a> ·
      <a href="README.tr.md">Türkçe</a> ·
      <a href="README.zh-CN.md">简体中文</a>
    </sub>
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

## Why Yalqen?

Yalqen is for developers who want Chromium compatibility without a browser UI getting in the way.

- **Keyboard-first by default.** Open tabs, search, navigate and trigger actions from the command bar.
- **Vertical tabs that stay out of your content.** Pinned tabs, the address bar and window controls live in one compact panel.
- **Developer-oriented workflow.** Chromium DevTools are built in, with a one-key phone view for responsive testing.
- **Privacy features included.** Ad and tracker blocking, third-party cookie blocking, HTTPS-only mode and secure DNS are available out of the box.
- **Open source and easy to inspect.** Yalqen is MIT licensed and built in public.

<p align="center">
  <img src="design/readme/feature-command-bar.png" alt="Command bar" width="188">
  <img src="design/readme/feature-pinned-tabs.png" alt="Pinned tabs" width="173">
  <img src="design/readme/feature-developer-tools.png" alt="Developer tools" width="200">
  <img src="design/readme/feature-ad-blocking.png" alt="Ad and tracker blocking" width="240">
</p>

## Features

- **Vertical tabs** with pinned tabs, address bar and window controls in one panel
- **Command bar** for keyboard-first navigation and actions ([keyboard shortcuts](docs/keyboard-shortcuts.md))
- **Ad and tracker blocking** with a built-in filter engine, plus third-party cookie blocking
- **HTTPS-only mode** and **secure DNS**
- **Developer tools** and a one-key **phone view**
- **Memory saver** and seven built-in search engines

<p align="center">
  <img src="design/readme/feature-cookies.png" alt="Third-party cookie blocking" width="281">
  <img src="design/readme/feature-https-only.png" alt="HTTPS-only mode" width="215">
  <img src="design/readme/feature-secure-dns.png" alt="Secure DNS" width="174">
  <img src="design/readme/feature-memory-saver.png" alt="Memory saver" width="189">
  <img src="design/readme/feature-search-engines.png" alt="Search engines" width="209">
</p>

> If Yalqen is useful to you, consider starring the repository. It helps other developers discover the project.

## Install

> **Requires macOS 13 or later on Apple Silicon.** Intel Macs are not supported.

Choose one:

**DMG:** download it from [Releases](https://github.com/YSamed/yalqen/releases/latest). The app is signed with a Developer ID and notarized, so it opens without a Gatekeeper warning.

**Terminal:** install with [Homebrew](https://brew.sh).

```bash
brew install --cask YSamed/yalqen/yalqen
```

Active-install counting is off by default and can be enabled in **Settings → Privacy**. See [how the badge counters work](docs/usage-measurement.md).

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

<p align="center">
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/YSamed/yalqen" alt="MIT license"></a>
</p>
