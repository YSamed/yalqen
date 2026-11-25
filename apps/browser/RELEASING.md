# Releasing

Yalqen release packages are distributed on GitHub Releases as a DMG/ZIP on macOS and an NSIS installer on Windows.

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Every push to `main` updates an open "chore(main): release x.y.z" pull request. It bumps the version in `package.json` and adds the Conventional Commits since the last release to `CHANGELOG.md`. Every release bumps the patch version (`0.2.0` → `0.2.1` → `0.2.2`), whatever the commit types are. To release a minor or major version instead, add a `Release-As: x.y.z` footer to a commit on `main` (for example `Release-As: 0.3.0`).
2. Merging that pull request tags `vx.y.z` and creates the GitHub release with the changelog.
3. `.github/workflows/release.yml` runs the macOS and Windows release workflows. The macOS job signs and notarizes the app, uploads the DMG, ZIP, blockmaps and `latest-mac.yml`, and adds the notes from `build/release-notes.md`. The Windows job uploads the unsigned NSIS installer, blockmap and `latest-win.yml` when the tag includes Windows packaging. Each job attaches its own build provenance file.

The release pull request is opened by GitHub Actions, so CI does not run on it; merge it with the admin bypass. To rebuild release assets for an existing tag, run Release, Release (macOS), or Release (Windows) from the Actions tab with that tag.

## Announcing a release

```bash
node scripts/release-announcement.mjs          # newest release in CHANGELOG.md
node scripts/release-announcement.mjs 0.2.11   # a given version
```

It prints a short post for X and Bluesky (at most 300 characters) and a longer post for GitHub Discussions, built from the Features, Bug Fixes and Performance entries of that release. Review the text before posting; entries come straight from commit messages.

## Updates

Packaged builds check the GitHub releases with [electron-updater](https://www.electron.build/auto-update) 30 seconds after launch and every 6 hours, unless **Settings › General › Updates** turns automatic checks off. A new version downloads in the background (only the changed blocks, using the blockmap) and installs when Yalqen quits, or right away from the update button in the toolbar, which restores every tab after the restart.

The check reads `latest-mac.yml` from the newest release. While the release workflow is still building, that file is missing and the check fails quietly until the next one.

Squirrel.Mac only installs an update signed by the same Developer ID as the running app, so ad-hoc signed builds cannot update themselves.

## Signing and notarization

The app is signed with a Developer ID and notarized, so it opens on any Mac without a Gatekeeper warning. Nothing is submitted to the App Store.

`scripts/sign-mac.mjs` signs by certificate hash instead of name, because `codesign` cannot match a certificate name with non-ASCII letters.

Signing certificate:

| Secret                       | Value                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| `MAC_CERTIFICATE_P12_BASE64` | "Developer ID Application" certificate exported as `.p12`, base64-encoded |
| `MAC_CERTIFICATE_PASSWORD`   | Password of that `.p12`                                                   |

Notarization, with either an Apple ID:

| Secret                        | Value                                              |
| ----------------------------- | -------------------------------------------------- |
| `APPLE_ID`                    | Apple ID email of the developer account            |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password created at appleid.apple.com |
| `APPLE_TEAM_ID`               | Team ID shown in the developer account             |

or with an API key (created under App Store Connect > Users and Access > Integrations; only used for notarization):

| Secret             | Value                         |
| ------------------ | ----------------------------- |
| `APPLE_API_KEY_P8` | Contents of `AuthKey_XXXX.p8` |
| `APPLE_API_KEY_ID` | Key ID                        |
| `APPLE_API_ISSUER` | Issuer ID                     |

Developer ID signing uses hardened runtime with `build/entitlements.mac.plist` (JIT, camera, microphone, location, and disabled library validation so the Google-signed Widevine CDM can load).

Widevine needs a production VMP signature. `scripts/sign-mac.mjs` and `scripts/sign-win.mjs` run `castlabs_evs.vmp sign-pkg` when `EVS_ACCOUNT_NAME` is set; without it the hook only logs a warning, and the packaged app has no valid VMP signature because flipping the fuses invalidates castLabs' development one. CI signs in with the `EVS_ACCOUNT_NAME` and `EVS_PASSWD` secrets. Create the account once with `python3 -m castlabs_evs.account signup`.

## Without the signing secrets

A fork without these secrets still builds: the app is ad-hoc signed, so on another Mac the first launch is blocked until the user clicks **Open Anyway** under System Settings › Privacy & Security. Such builds cannot update themselves, and camera and microphone permissions may be asked again after each manual update, because an ad-hoc signature changes with every build.

## Local package

```bash
npm run package:mac
```

This signs with a Developer ID certificate from the login keychain when one exists, otherwise it produces an ad-hoc signed build for local use.

## Hardening

The packaged binary has these Electron fuses flipped: `runAsNode`, `NODE_OPTIONS` and `--inspect` are disabled, and the app only loads from an integrity-checked `app.asar`. Code that needs a separate Node process must use a utility process.
