# Download and active-install measurements

These counters describe two different things:

| Counter | Definition |
| --- | --- |
| DMG downloads | Sum of GitHub `download_count` for `.dmg` assets in every published stable release, with pagination. Excludes ZIPs, YAML, blockmaps, drafts and prereleases. Repeated downloads still count. |
| Active installs (30d, opt-in) | Distinct participating profile IDs with an accepted heartbeat in the last rolling 30 days. Includes only builds supporting the counter, with the setting enabled and an internet connection. |

Neither counter measures unique people. A person can use multiple Macs or profiles; deleting the profile creates another ID. Installation activity means an open non-private browser window when the daily heartbeat runs, not time spent browsing. The active count can be lower than total usage, and historical usage cannot be reconstructed from downloads or update checks. These are observed events, not authenticated accounts: the endpoint cannot prove that a caller is a real person or prevent a determined client from inventing IDs.

## Browser behavior

`usageCounting` defaults to `false` for new and existing profiles. Settings → Privacy explains the data sent and allows opt-in or opt-out. A disabled counter makes no request and creates no identity. Development and benchmark builds do not report. Private-only sessions and sessions without browser windows do not report.

When enabled, the first check runs 30 seconds after startup or opt-in, then hourly while the app runs. A successful heartbeat marks that UTC day as sent in `usage.json`, so restarting or updating the app keeps the same ID and does not send again that day. Failed requests retry on a later hourly check. Disabling the setting aborts an in-flight request and stops the timer; a request already accepted by the server cannot be recalled.

The request to `https://yalqen.com/api/usage` contains only `{ "installationId": "<random UUID>" }`. It uses no cookies, does not follow redirects and times out after ten seconds. It includes no browsing URLs, history, searches, account information, machine identifiers or application version. The random ID is a pseudonymous profile identifier, not proof of a person's identity.

## Site service

The implementation is in the `YSamed/yalqenweb` repository:

- `POST /api/usage` accepts the bounded, minimal payload and acknowledges persisted reports with HTTP 204. Browser-origin requests are rejected; the browser's main process sends the heartbeat.
- The storage layer HMAC-hashes the ID before writing it to Upstash Redis. Only the hash and server-side last-seen time are persisted. Repeated reports update a sorted-set member instead of increasing its cardinality. Server timestamps determine the 30-day window.
- Old observations are pruned on every successful read and write. The entire set expires after 35 days without new reports. Preview deployments use a separate key from production.
- `GET /api/usage` exposes only the aggregate count and Shields endpoint metadata. Unconfigured or unavailable storage displays `unavailable`, never a fabricated zero. Successful results are cached for five minutes.
- `GET /api/downloads` exposes the DMG-only total and Shields endpoint metadata, cached for fifteen minutes. It paginates GitHub releases instead of silently limiting the count to the first page.

The collector does not log request bodies, IDs, cookies or IPs. Vercel necessarily receives IP addresses to deliver requests and may retain infrastructure request logs independently of this storage. Do not describe the system as absolutely anonymous or as having no telemetry. Website visit/click analytics remain a separate metric.

## Activation

1. In the existing `yalqenweb` Vercel project, connect an Upstash Redis database through Marketplace. Configure server-only `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. Set server-only `USAGE_HASH_SECRET` to a stable random value of at least 32 characters (for example, generate 32 random bytes as hexadecimal). Do not commit these values or ship them in the browser. Rotating the HMAC secret creates different hashes for existing IDs; clear the old measurement set before accepting reports with the new secret to avoid double counting.
3. Optionally set server-only `GITHUB_TOKEN` for GitHub API capacity. Missing credentials or API failures must not become zero counts.
4. Run `npm run test:usage`, `npm run lint` and `npm run build` in `yalqenweb`, then deploy and check both endpoint responses. Use a separate preview storage key for test reports; avoid putting synthetic events into production.
5. Release the updated browser and README after the service is live. Counts start with participating users of that release; older browsers send no reports. Before rollout, zero observed profiles is not evidence of zero users.

The README badges depend on these live endpoints. Local code preparation alone does not activate collection or establish a user count.
