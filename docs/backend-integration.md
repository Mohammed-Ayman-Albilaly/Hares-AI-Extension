# Backend integration

How the extension talks to the Hares AI platform API. The API contract (schemas, errors, limits) is owned by the platform team; this page describes what the extension does with it.

## Setup

| | |
|---|---|
| API base URL | Set when building: `WXT_API_BASE_URL=https://host/api npm run build`. Default: `http://localhost:3000/api` (development API) |
| Extension ID | `hbcjnfojlcbfaiiiepmlhcjbmjbcpold`. Fixed by the public key in [extension-key.ts](../extension-key.ts); the same on every build. A Web Store upload would get its own ID |
| Permissions | `storage`, `offscreen`, `alarms`; host access to the three AI sites, the model download hosts and the API origin of the build |
| Calls | Only from the background service worker, never from a page |

PowerShell: `$env:WXT_API_BASE_URL = "http://localhost:3000/api"; npm run build`

## What it does

| Step | Behaviour | Code |
|---|---|---|
| Sign in | Popup → background → `POST /extension/login`. The password is sent once and never stored. Errors shown: `INVALID_CREDENTIALS`, `ACCOUNT_NO_ACCESS`, `ACCOUNT_INACTIVE`, `RATE_LIMITED` (with a countdown) | [session.ts](../src/backend/session.ts) |
| Tokens | Access token in `storage.session` (memory); refresh token in `storage.local` | [session.ts](../src/backend/session.ts) |
| Refresh | Single-flight, because the refresh token rotates and reuse revokes the session. The new token is saved first. `401` on refresh → signed out, sign-in screen again | [session.ts](../src/backend/session.ts) |
| Deactivated account | `401 ACCOUNT_INACTIVE` on any call → signed out with a message | [session.ts](../src/backend/session.ts) |
| Sign out | Sends the waiting events (up to 5 s), `POST /extension/logout`, then clears tokens, policy and queue | [runtime.ts](../src/backend/runtime.ts) |
| Policy | `GET /policy/bundle` with `If-None-Match` on browser start, after sign-in and every 5 minutes. `304` keeps the stored one. Any failure keeps the last good policy; with none ever received, the built-in default applies | [policy-sync.ts](../src/backend/policy-sync.ts) |
| Events | One `POST /logs` per analysed send, only while signed in | [uploader.ts](../src/backend/uploader.ts) |
| Alarms | `hares-policy-refresh` (5 min) and `hares-upload` (1 min). Created only when missing, never re-created on a wake-up (that would restart the period). If the last policy check is older than 5 minutes when the service worker wakes, it checks at once | [schedule.ts](../src/backend/schedule.ts) |

## Seeing what the extension does

Open the service worker console (`chrome://extensions` → Hares AI → *service worker*). Each policy check prints one line, for example `[hares] policy check: HTTP 304 UNCHANGED (ETag "v7-d1")`, and each alarm prints `[hares] alarm fired: hares-policy-refresh`. The latest check is also stored under `hares.policyCheck` (`at`, `result`, `status`, `etag`) in `chrome.storage.local`. In the page console, each send attempt prints `[hares] send attempt via Enter|send button|form submit: …` (no text).

If the extension is reloaded while a chat page stays open, the old script on that page stops quietly, shows one notice asking for a refresh, and logs no error.

## Reading the policy bundle

[bundle.ts](../src/policy/bundle.ts). The `policy` array must hold exactly one valid entry for each of the 24 categories, otherwise the whole bundle is ignored.

| Bundle | Extension |
|---|---|
| `enabled: false` | The category is not detected, masked, enforced or logged |
| `action: BLOCK / WARN / ALLOW` | Block dialog / confirm dialog / sent with a notice |
| `risk_level` (optional) | The risk reported in events. Missing → the built-in tier |
| rule `KEYWORD` | One word or phrase per line; whole words; case-insensitive for Latin letters; alef forms → `ا`, `ة` → `ه`, `ى` → `ي`; diacritics ignored; phrase = consecutive words with any whitespace or punctuation between |
| rule `PATTERN` | `new RegExp(definition, 'i')`; skipped if it does not compile or is over 512 characters |
| rule `TOPIC` | Not enforced |

Which detection-model types are on is fixed in the extension: six types that are too common (cities, organisations, plain dates, age, postcodes, URLs) stay off.

## Reporting events

[event.ts](../src/logging/event.ts), field rules in [policy.md](policy.md#4-log-events-no-prompt-text).

| Server answer | Extension |
|---|---|
| `201`, `200` | Removed from the queue |
| `5xx`, offline | Kept; retried later with the same `log_id` (2 s, doubling, up to 5 min) |
| `429` | Kept; waits `Retry-After` |
| `400` (`VALIDATION_ERROR`, `EVENT_TIME_OUT_OF_RANGE`) and other `4xx` | The event is dropped |
| `403 DEPARTMENT_INACTIVE` | Uploads pause, the queue and the session stay, and uploads resume after the next successful policy check |
| `401 TOKEN_EXPIRED` | Refresh once, then retry |

The queue holds at most 500 events (oldest dropped). Events older than 89 days are dropped before sending. `event_time` uses the device clock corrected by the `Date` header of the API's answers.

## Joint test with the local backend

1. Run the backend (`docs/DEV-README.md` in the platform repository) and build the extension with the default URL. Load `.output/chrome-mv3` and open the popup.
2. Sign in with `engineering.user1@example.test` (development account, see the platform's README). The popup shows `Policy: Version N`.
3. On an AI site send:
   - a clean message (`What is the capital of France?`) → NONE / ALLOWED
   - `Please reply to sara@example.com` → confirm dialog → press Confirm → MEDIUM / WARNED / SUBMITTED_ANYWAY
   - `my password is Hunter2!` → block dialog → Send revised → HIGH / BLOCKED / REVISION_USED
4. Check each event on the user and admin dashboards.
5. Go offline (DevTools → Network → Offline), send two messages, and see `2 events to upload` in the popup. Go back online: they upload within a minute, and the dashboards count each once.
6. Deactivate the account in the admin dashboard. Within 5 minutes (or on the next message) the popup returns to the sign-in screen with "Your account is deactivated".
