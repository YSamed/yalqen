# Show HN (draft)

Do not post until every item in [schedule.md](schedule.md#before-every-post) is checked.

## Title

```
Show HN: Yalqen – open-source developer browser for macOS
```

## URL

`https://github.com/YSamed/yalqen`

Link the repository, not the website: HN readers want the code, and the README has the download button and demo.

## First comment

Post right after submitting. Keep it plain; HN reacts badly to marketing tone.

```
Hi HN, I'm Yaşar. I built Yalqen because I wanted a browser that fits how I work as a developer: tabs in a vertical panel, everything reachable from the keyboard, DevTools and a phone view one key away, and no ads or trackers by default. Arc came close, but it is closed source, so I started my own.

What it does today:

- Vertical tab panel with pinned tabs, the address bar and window controls in one place
- Command bar (⌘L) for navigation and every action
- Built-in ad and tracker blocking, third-party cookie blocking, HTTPS-only mode, secure DNS
- One-key phone view with device presets, plus the regular Chromium DevTools
- Memory saver that discards tabs you haven't looked at for a while
- Chrome Web Store extensions, password saving/autofill, page translation
- Signed and notarized, updates itself in the background and restores your tabs

About Electron, since someone will ask: yes, it's Electron. That was the fastest way to a real Chromium with DevTools and extensions as a solo developer. It costs memory (the interface is one more renderer) and download size, and it lags Chrome by some weeks. I wrote up the trade-offs here: https://github.com/YSamed/yalqen/blob/main/docs/why-electron.md

Memory on the same pages was roughly 55% of Chrome's with ad blocking on (10 to 40 tabs). That is one preliminary run on my machine; method and raw numbers are here, so please check them: https://github.com/YSamed/yalqen/blob/main/docs/benchmarks.md

The interface is in English and Turkish (follows your system language). It's MIT licensed, macOS 13+ on Apple Silicon only for now. I'd love feedback on what would make you switch, or what stops you.
```

## Before posting

- [ ] Run the three-run benchmark and update the "roughly 55%" line to the final figure (or delete the sentence). Do not quote idle CPU.
- [ ] Fill the `TODO(author)` CEF section in docs/why-electron.md, or leave it as is; the comment no longer promises a CEF plan.
- [ ] Every item in [schedule.md](schedule.md#before-every-post) is checked.

## Notes

- Post on a weekday morning US Eastern time (roughly 8–10 am ET, 15–17 in Türkiye).
- Stay in the thread for the first 3–4 hours; answer every question, especially critical ones, without getting defensive.
- Do not ask anyone to upvote; HN detects voting rings and penalizes the post.
- Expect an Electron and an Arc debate; answer with the trade-offs in why-electron.md, not with defence.
