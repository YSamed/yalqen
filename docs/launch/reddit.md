# Reddit (drafts)

One post per subreddit, spread over several days (see [schedule.md](schedule.md)). Never cross-post the same text.

The rule notes below were collected on 2026-09-30, partly from third-party summaries because Reddit could not be fetched directly. **Read each subreddit's sidebar and pinned posts yourself before posting**; rules change often.

Always disclose that you are the developer. Stay in the comments for the first few hours.

---

## r/macapps

**Rules to check:** self-promotion is limited (reported: once per developer per 30 days); developers may need to use the subreddit's promotion template; open-source apps are reported to use an `[OS]` title prefix and a price flair (Free); download links must go to the official source.

**Title:**

```
[OS] Yalqen – free, open-source Chromium browser for developers (vertical tabs, command bar, built-in ad blocking)
```

**Body:**

```
Hi r/macapps, I'm the developer of Yalqen, a free and open-source (MIT) browser for macOS.

- Vertical tab panel with pinned tabs, the address bar and window controls in one place
- Keyboard-first command bar for navigation and actions
- Ad and tracker blocking, third-party cookie blocking, HTTPS-only mode and secure DNS built in
- One-key phone view with device presets, plus Chromium DevTools
- Memory saver, Chrome Web Store extensions, password autofill, page translation
- Signed and notarized, updates itself

Requirements: macOS 13+, Apple Silicon.
Download: https://github.com/YSamed/yalqen/releases/latest
Homebrew: brew install --cask YSamed/yalqen/yalqen

It's built on Electron; here's why and what that costs: https://github.com/YSamed/yalqen/blob/main/docs/why-electron.md

Feedback welcome, especially what's missing for you to use it daily.
```

---

## r/browsers

**Rules to check:** self-promotion usually allowed for new browsers if you engage; low-effort posts removed. Audience is technical and skeptical of Chromium forks; lead with what is different.

**Title:**

```
I built an open-source Chromium browser for macOS focused on developers – vertical tabs, command bar, ad blocking built in
```

**Body:**

```
I'm the developer. Yalqen is an MIT-licensed browser for macOS (Apple Silicon). Engine is Chromium via Electron, UI is Svelte.

What's different from Chrome/Arc/Zen:
- Open source, no account, no telemetry
- Ad/tracker blocking and third-party cookie blocking on by default (Ghostery's filter engine)
- Phone view and DevTools one key away, with iPhone/Pixel/Galaxy/iPad presets
- Memory saver that discards idle tabs but never pinned, playing or DevTools tabs

Honest limits: Electron means more memory than a native browser and no DRM (Netflix etc. won't play). Details and benchmarks:
https://github.com/YSamed/yalqen/blob/main/docs/why-electron.md
https://github.com/YSamed/yalqen/blob/main/docs/benchmarks.md

Repo: https://github.com/YSamed/yalqen
```

Check before posting: remove "no telemetry" unless it is verified that the app sends nothing besides update checks to GitHub.

---

## r/webdev

**Rules to check:** strict self-promotion rules; "Showoff Saturday" is the reported day for showing your own projects. Post only on Saturday, and only if the rule still exists.

**Title:**

```
[Showoff Saturday] I built a browser for web developers: phone view on one key, DevTools, command bar, vertical tabs
```

**Body:**

```
Yalqen is an open-source (MIT) Chromium browser for macOS that I built for my own web dev workflow.

Things I use every day:
- Phone view with device presets (iPhone 15, iPhone SE, Pixel 8, Galaxy S24, iPad mini) on one key
- Chromium DevTools as usual
- Command bar for everything, so hands stay on the keyboard
- Ad blocking on by default, so pages look like they do for real users with blockers (turn it off per site when testing ads)

Mac only (Apple Silicon) for now. Repo and demo: https://github.com/YSamed/yalqen

What would you want from a browser built for development?
```

---

## r/opensource

**Rules to check:** project posts allowed; must be genuinely open source (MIT qualifies); avoid pure marketing.

**Title:**

```
Yalqen: an MIT-licensed developer browser for macOS, looking for contributors
```

**Body:**

```
I've been building Yalqen, an open-source Chromium-based browser for macOS (Electron + Svelte 5 + TypeScript). It has vertical tabs, a keyboard-first command bar, built-in ad blocking, a phone view for responsive testing, and Chrome Web Store extension support.

The codebase is small and tested (node --test for the main-process logic), releases are automated with release-please, and every release is signed, notarized and has build provenance attestations.

Good first issues are labelled here: https://github.com/YSamed/yalqen/labels/good%20first%20issue
Repo: https://github.com/YSamed/yalqen
```

---

## r/ArcBrowser

**Rules to check:** this is a fan community of a competing product. Promotion of alternatives may be removed or badly received. Read the rules; if alternatives are not explicitly allowed, **skip this subreddit** or only answer existing "what are Arc alternatives?" threads.

**If allowed — title:**

```
For people looking for an open-source Arc alternative on Mac: I built Yalqen
```

**Body:**

```
I'm the developer, so take this with that in mind. Since Arc moved to maintenance mode, a lot of people here asked about alternatives. Yalqen is open source (MIT), Chromium-based, macOS only, with a vertical tab panel and a command bar similar to Arc's.

It does not have Spaces, Boosts or Easels. It does have built-in ad blocking, a phone view for developers and a memory saver.

https://github.com/YSamed/yalqen
```

Verify the Arc status claim ("maintenance mode") before posting.
