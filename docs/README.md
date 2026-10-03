# Technical details

<p>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>

[README](../README.md) · English · [Türkçe](README.tr.md) · [简体中文](README.zh-CN.md)

## Requirements

macOS 13 Ventura or later on Apple Silicon. Intel Macs are not supported.

## Install

With [Homebrew](https://brew.sh):

```bash
brew install --cask YSamed/yalqen/yalqen
```

Or download the DMG from [Releases](https://github.com/YSamed/yalqen/releases/latest). The app is signed with a Developer ID and notarized, so it opens without a Gatekeeper warning.

## Updates

Yalqen checks for updates in the background and installs them on restart. To update through Homebrew instead:

```bash
brew upgrade --cask yalqen
```

## Uninstall

To uninstall and remove its data with Homebrew:

```bash
brew uninstall --zap --cask yalqen
```

Without Homebrew, quit Yalqen and move it to the Trash. Its profile data lives in `~/Library/Application Support/yalqen-electron-prototype`.

## Usage counting

Active-install counting is off by default and can be enabled in **Settings → Privacy**. When enabled, Yalqen sends only a random installation ID, at most once per UTC day while a non-private window is open. The README's download count includes repeat downloads, and neither counter measures individual people. See [how the counters work](usage-measurement.md).

## Development

The app lives in `apps/browser` and needs Node.js 22.12 or later.

```bash
cd apps/browser
npm ci
npm start
```

| Command               | What it does                            |
| --------------------- | --------------------------------------- |
| `npm run check`       | Lint, format check, typecheck and tests |
| `npm test`            | Tests only                              |
| `npm run bench`       | Startup, page load and idle benchmarks  |
| `npm run package:mac` | Build the macOS app bundle              |

Read [CONTRIBUTING.md](../.github/CONTRIBUTING.md) for Git hooks, commit messages and pull requests.

## Further reading

- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Why Electron?](decisions/why-electron.md)
- [Architecture](architecture.md)
- [Benchmarks](benchmarks.md)
- [Performance reports](performance/)
- [Download and active-install measurements](usage-measurement.md)
- [Security policy](../.github/SECURITY.md)

## License

- Yalqen is released under the [MIT License](../LICENSE).
- Bundled filter lists keep their own licenses, see [THIRD_PARTY_NOTICES.md](../apps/browser/THIRD_PARTY_NOTICES.md).
- The Yalqen name and logo are not covered by the MIT License.
