# Technical details

<p>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>

[README](../README.md) · English · [Türkçe](README.tr.md) · [简体中文](README.zh-CN.md)

## Requirements

- **macOS:** macOS 13 Ventura or later on Apple Silicon. Intel Macs are not supported.
- **Linux:** experimental AppImage built from source with Node.js 24. Initial testing covers Ubuntu with GNOME Wayland; Chromium sandboxing requires working unprivileged user namespaces.
- **Windows:** preview NSIS installer.

## Install

### macOS

With [Homebrew](https://brew.sh):

```bash
brew install --cask YSamed/yalqen/yalqen
```

Or download the DMG from [Releases](https://github.com/YSamed/yalqen/releases/latest). The app is signed with a Developer ID and notarized, so it opens without a Gatekeeper warning.

### Windows preview

Download the Windows `.exe` installer when it appears under [Releases](https://github.com/YSamed/yalqen/releases). The installer is unsigned, so Windows SmartScreen may show a warning.

### Linux preview

Build on Linux with Node.js 24 and Git:

```bash
git clone https://github.com/YSamed/yalqen.git
cd yalqen/apps/browser
npm ci
npm run package:linux
```

The AppImage is written to `apps/browser/build/release/`. Make it executable before opening it. Ready-made Linux downloads are not yet published by the release workflow. Chromium sandboxing requires working unprivileged user namespaces; Yalqen refuses to run with `--no-sandbox`.

## Chrome Web Store compatibility

These workflows passed in an isolated macOS Apple silicon profile on November 26, 2026, using the Yalqen 0.5.0 app bundle code with castLabs Electron 45.2.1+wvcus (Chromium 156.0.8078.75). The test used the original Chrome Web Store packages and Yalqen’s store installer.

| Extension                                                                                               | Version        | Verified workflow                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Bitwarden Password Manager](https://chromewebstore.google.com/detail/nngceckbapebfimnlniiiahkandclblb) | 2026.11.0      | Opened the extension popup, selected **Fill** for a saved login and verified that both empty form fields received the expected username and password. The encrypted test vault ran on a local HTTPS fixture with dummy credentials.        |
| [uBlock Origin Lite](https://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh)         | 2026.1124.1811 | With Yalqen’s built-in blocker off, a script served at `ad.doubleclick.net` reached the local test server before installation. With the extension enabled, the browser blocked the same request and the server received no second request. |
| [Dark Reader](https://chromewebstore.google.com/detail/eimadpbcbfnmbkopoojfekhnkhdbieeh)                | 4.9.135        | The extension inserted its stylesheet into a light test page and changed the computed background color from `rgb(255, 255, 255)` to `rgb(24, 26, 27)`.                                                                                     |

The test used the default browser session. This run covered macOS. Windows and Linux were untested.

## DRM playback

Yalqen uses castLabs Electron 45.2.1+wvcus, which downloads the Widevine CDM (software, L3) on first launch. Releases after 0.5.0 are VMP-signed for production through a castLabs EVS account; 0.5.0 and earlier carry only the castLabs development signature, which production streaming services reject.

On November 26, 2026, a production VMP-signed copy of the 0.5.0 macOS Apple silicon app bundle passed these checks in an isolated profile:

| Check                         | Result                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `castlabs_evs.vmp verify-pkg` | `Signature is valid: streaming, 1330 days left`                                                                                                                                                                                                  |
| Widevine CDM                  | Version 4.10.3112.0 downloaded on first launch. `navigator.requestMediaKeySystemAccess('com.widevine.alpha', …)` resolved.                                                                                                                       |
| Encrypted playback            | Shaka Player 4 played the Widevine-encrypted [Angel One](https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd) DASH stream with a license from Shaka's test proxy: 12 s of playback, 303 decoded frames, no media error. |
| Spotify                       | A Spotify Free account played a track in the [Spotify web player](https://open.spotify.com/). The `widevine-license/v1/application-certificate` and `widevine-license/v1/audio/license` requests both returned HTTP 200.                         |

Netflix and Disney+ were not tested. Services that reserve HD or 4K for hardware DRM cap the resolution. Windows and Linux were untested.

## Updates

Linux automatic updates are not yet verified. Update your checkout and rebuild the AppImage to update the preview.

On macOS, Yalqen checks for updates in the background and installs them on restart. To update through Homebrew instead:

```bash
brew upgrade --cask yalqen
```

## Uninstall (macOS)

To uninstall and remove its data with Homebrew:

```bash
brew uninstall --zap --cask yalqen
```

Without Homebrew, quit Yalqen and move it to the Trash. Its profile data lives in `~/Library/Application Support/yalqen-electron-prototype`.

## Usage counting

Active-install counting is off by default and can be enabled in **Settings → Privacy**. When enabled, Yalqen sends only a random installation ID, at most once per UTC day while a non-private window is open. The README's download count includes repeat downloads, and none of these counters measures individual people. See [how the counters work](usage-measurement.md).

## Development

The app lives in `apps/browser`. Use Node.js 24 on macOS or Linux to match the contribution setup and CI.

```bash
cd apps/browser
npm ci
npm start
```

| Command                 | What it does                            |
| ----------------------- | --------------------------------------- |
| `npm run check`         | Lint, format check, typecheck and tests |
| `npm test`              | Tests only                              |
| `npm run bench`         | Startup, page load and idle benchmarks  |
| `npm run package:mac`   | Build the macOS app bundle              |
| `npm run package:linux` | Build the experimental Linux AppImage   |

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
