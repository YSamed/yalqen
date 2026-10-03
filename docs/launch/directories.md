# Directories and lists

Status as of 2026-10-03.

## Listed or submitted

| Where                                   | Status                                    |
| --------------------------------------- | ----------------------------------------- |
| jaywcjlove/awesome-mac                  | Merged ("Add Yalqen to Browsers")         |
| serhii-londar/open-source-mac-os-apps   | PR #1450 open                             |
| Rajaniraiyn/awesome-electron-browsers   | PR #5 open                                |
| nerdyslacker/desktop-web-browsers       | PR #61 open                               |
| IonicaBizau/made-in-turkey              | PR #43 open                               |
| MacUpdate                               | Submitted, reply by email expected        |
| OpenAlternative                         | Submitted, free queue                     |
| Homebrew tap (`YSamed/homebrew-yalqen`) | Live, 0.2.11, `brew audit --online` clean |
| Launch Llama (free)                     | Submitted 2026-10-03, manual review       |
| ListBulb (free)                         | Submitted 2026-10-03, pending review; footer link on yalqen.com verified the backlink |
| Aura++ (free)                           | Scheduled for 2027-05-16 (random free slot); footer link on yalqen.com verified the backlink |

## Waiting on a date

### electron/apps

Their contributing guide asks for 20 days after project creation. Open on or after **2026-10-15** from the already pushed `add-yalqen` branch on the `YSamed/apps` fork (rebase onto upstream first, re-read `contributing.md`).

### sindresorhus/awesome-electron

Requirements (from `contributing.md`): at least **100 stars**, repository at least **30 days old** (2026-10-25), English readme with a screenshot, binary available, description must not mention Electron, not start with "A"/"An", end with a period, added to the bottom of its section.

Current: 26 stars. Not eligible yet.

Draft line for the **Apps › Open Source** section:

```md
- [Yalqen](https://github.com/YSamed/yalqen) - Chromium-based browser for developers with vertical tabs, a command bar and built-in ad blocking.
```

## Official homebrew/cask

Checked against Homebrew's own audit code (`Library/Homebrew/utils/shared_audits.rb`) on 2026-09-30:

| Requirement                           | Needed                                                    | Yalqen now                   |
| ------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| Notability, self-submitted            | 90 forks **or** 90 watchers **or** 225 stars              | 1 fork, 0 watchers, 26 stars |
| Notability, submitted by someone else | 30 forks **or** 30 watchers **or** 75 stars               | same                         |
| Repository age                        | 30 days (2026-10-25)                                      | 5 days                       |
| Homepage domain age                   | 30 days (yalqen.com registered 2026-09-28, so 2026-10-28) | 2 days                       |
| Signed and notarized                  | Required                                                  | Yes (verified on v0.2.11)    |

Not eligible yet. The tap cask is already in the shape homebrew/cask expects (no quarantine removal, `auto_updates true`, `livecheck`, `zap`), so the submission will be a copy of `Casks/yalqen.rb` once the thresholds are met.

## Skipped

See the project notes: awesome-macOS (iCHAIT) bans Electron apps; awesome-privacy needs a stable release older than 4 months and 100 stars; opensourcealternative.to only lists self-hosted software.

Free directories picked on 2026-10-03 (copy in [directory-submissions.md](directory-submissions.md)): PeerPush skipped for now (needs an account), Noonlaunch not submitted (nofollow link on the free tier), BetterLaunch skipped (paid bulk submission).
