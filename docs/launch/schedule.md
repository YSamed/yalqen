# Launch schedule (draft)

Nothing here is posted automatically. The author posts each item by hand.

## Blockers before any public launch

1. **English interface.** The app's menus, settings and dialogs are in Turkish only (roughly 275 Turkish strings in `apps/browser/src`, for example the File menu's "Yeni sekme", "Sekmeyi kapat"). English-speaking audiences (HN, Reddit, Product Hunt) will open a Turkish UI and leave. Ship an English UI, or at least English as the default with Turkish selectable, before week 1.
2. **README demo** (Phase 2): `design/readme/demo.gif` in the README.
3. **Benchmarks** (Phase 3): real numbers in [docs/benchmarks.md](../benchmarks.md), or remove every benchmark link from the drafts.
4. **CEF section** in [docs/why-electron.md](../why-electron.md) filled in by the author.

Code signing and notarization are done: v0.2.11 passes `codesign --verify --deep --strict`, `spctl` ("Notarized Developer ID") and `stapler validate`, and a quarantined copy passes `syspolicy_check distribution`.

## Order

| When            | What                                                                                 | Draft                              |
| --------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| Week 1, Tue     | r/macapps                                                                            | [reddit.md](reddit.md#rmacapps)    |
| Week 1, Thu     | r/opensource                                                                         | [reddit.md](reddit.md#ropensource) |
| Week 1, Sat     | r/webdev (Showoff Saturday)                                                          | [reddit.md](reddit.md#rwebdev)     |
| Week 2, Tue     | Show HN                                                                              | [show-hn.md](show-hn.md)           |
| Week 2, Tue     | X / Bluesky thread, LinkedIn post (same day, after HN)                               | [social.md](social.md)             |
| Week 2, Thu     | r/browsers                                                                           | [reddit.md](reddit.md#rbrowsers)   |
| Week 3          | Blog post on yalqen.com                                                              | [blog-post.md](blog-post.md)       |
| Week 4, Tue–Thu | Product Hunt                                                                         | [product-hunt.md](product-hunt.md) |
| Later           | electron/apps PR (from 2026-10-15), awesome-electron and homebrew/cask when eligible | [directories.md](directories.md)   |

Small subreddits first: their feedback fixes the rough edges before HN, where first impressions count most. r/ArcBrowser only if its rules allow alternatives.

## Before every post

- [ ] Latest release is signed and notarized (check the release workflow log for "notarization successful", or run `spctl -a -vv` on a downloaded copy)
- [ ] Latest release DMG, ZIP and `latest-mac.yml` are attached to the GitHub release
- [ ] Homebrew tap cask points to the latest version
- [ ] README demo GIF is present and loads quickly on GitHub
- [ ] yalqen.com is up to date (download link, FAQ without the "Open Anyway / xattr" workaround)
- [ ] Open issues and discussions have replies
- [ ] Every link in the post works; benchmark links point to real numbers
- [ ] You have 3–4 free hours to answer comments
