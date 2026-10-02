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
  <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="design/screenshots/website-dark.png"><img src="design/screenshots/website-light.png" alt="Yalqen website: Light as paper. Clear as glass." width="900"></picture></a>
</p>

## Features

Yalqen is for developers who want Chromium compatibility without a browser UI getting in the way.

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/command-dark.svg"><img src="design/readme/cards/command-light.svg" alt="Command bar" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/tabs-dark.svg"><img src="design/readme/cards/tabs-light.svg" alt="Vertical tabs" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/devtools-dark.svg"><img src="design/readme/cards/devtools-light.svg" alt="Developer tools" width="268"></picture>
  <br>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/blocking-dark.svg"><img src="design/readme/cards/blocking-light.svg" alt="Ad and tracker blocking" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/https-dark.svg"><img src="design/readme/cards/https-light.svg" alt="HTTPS-only and secure DNS" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/memory-dark.svg"><img src="design/readme/cards/memory-light.svg" alt="Memory saver" width="268"></picture>
</p>

See every [keyboard shortcut](docs/keyboard-shortcuts.md). Yalqen also ships seven built-in search engines.

## Install

> [!NOTE]
> Requires macOS 13 or later on Apple Silicon.

```bash
brew install --cask YSamed/yalqen/yalqen
```

Or download the DMG from [Releases](https://github.com/YSamed/yalqen/releases/latest). It is signed and notarized, and keeps itself up to date.

<details>
<summary>Update, uninstall and usage counting</summary>

To update through Homebrew instead:

```bash
brew upgrade --cask yalqen
```

To uninstall and remove its data:

```bash
brew uninstall --zap --cask yalqen
```

Active-install counting is off by default and can be enabled in **Settings → Privacy**. See [how the badge counters work](docs/usage-measurement.md).

</details>

## Development

```bash
cd apps/browser
npm ci
npm start
```

Requires Node.js 22.12 or later. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and pull requests.

---

<p align="center"><sub><a href="LICENSE">MIT License</a> · Bundled filter lists keep <a href="apps/browser/THIRD_PARTY_NOTICES.md">their own licenses</a> · The Yalqen name and logo are not covered by the MIT License</sub></p>

<p align="center"><sub>If Yalqen is useful to you, star the repository. It helps other developers discover the project.</sub></p>

<p align="center">
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>
