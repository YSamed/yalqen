# Unique download counting (yalqenweb)

Implementation spec for the `YSamed/yalqenweb` repository. The release badge in this repository already reads `uniqueDownloads` from `GET https://yalqen.com/api/downloads` and falls back to the GitHub DMG total while the field is missing or zero.

## Goal

Count distinct downloaders of the DMG through `yalqen.com/download`, instead of summing GitHub's raw `download_count`.

## Changes

### `api/download.ts`

- Before redirecting, record the request in the unique-download counter. Recording must never delay or break the redirect: use a short timeout (about 1 second), swallow errors and still return the 302.
- The redirect must be `Cache-Control: no-store`, otherwise Vercel's CDN serves the 302 without invoking the function and requests go uncounted. Cache the GitHub release lookup in memory (five minutes) to stay within API limits.
- Skip recording for bots and link previews (user agents matching `bot|crawler|spider|preview|slack|discord|facebookexternalhit|curl|wget`) and for non-GET methods.
- The identifier is `HMAC-SHA256(USAGE_HASH_SECRET, ip + "\n" + user-agent)`. Never store or log the raw IP or user agent.
- Get the IP from `x-forwarded-for` (first entry) or `x-real-ip` on Vercel.

### `lib/download-store.ts`

- Store identifiers in a Redis HyperLogLog: `PFADD yalqen:unique-downloads:v1:<scope> <hash>` and `PFCOUNT` to read. A HyperLogLog cannot be enumerated, so individual hashes are not recoverable. Counts are exact to about 0.81 percent.
- Reuse the Upstash REST configuration, `USAGE_HASH_SECRET` and the `production` / `preview` scope split from `lib/usage-store.ts`.
- Persist a `since` timestamp once (`SET ... NX`) the first time an event is recorded.
- Return `null` when storage is not configured, like `createUsageStore`.

### `api/downloads.ts`

- Keep the existing response and add `uniqueDownloads` (number) and `uniqueSince` (ISO date) when the store is available. If storage fails, omit both fields. Never return a fabricated zero.
- Keep `downloads` as the GitHub DMG total.

### Tests

- Extend `test/usage.test.ts` or add `test/downloads.test.ts` covering: bot user agents skipped, the same IP and user agent counted once, a different user agent counted separately, storage failure still returns the 302, and `GET /api/downloads` omitting the unique fields when storage is down.

### Site and README

- Point every "Download .dmg" button at `https://yalqen.com/download` (the website already does through `site.downloadUrl`). The README button currently links to `releases/latest`; switch it to `https://yalqen.com/download` so those downloads are counted too.
- Update `privacy.html` to say the download redirect keeps a keyed, irreversible hash of IP and user agent for counting, and that Vercel still receives IP addresses to deliver requests.

## Known limits

- Downloads through Homebrew or direct GitHub links bypass the redirect and are not counted.
- The count starts when this ships; history cannot be reconstructed.
- One person on different networks or browsers counts more than once. People behind one shared address with the same browser count once.
- Rotating `USAGE_HASH_SECRET` resets uniqueness. Clear the key first to avoid double counting.
