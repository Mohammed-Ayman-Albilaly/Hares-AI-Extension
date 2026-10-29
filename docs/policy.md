# Hares AI — Department policies and user exceptions

**For:** the platform (backend + admin dashboard) team.
**Status:** supported in the extension today. Until the platform is connected, the extension runs on the built-in default policy.

## 1. How it works

```
Platform: System Admin edits a department policy
   ↓ (later: sync after sign-in)
Extension: savePolicy(json) → validated → chrome.storage.local "hares.policy"
   ↓ (live, no reload)
Every analysed message uses the policy of the user's department
   ↓
Log event: tier under the policy + tier actually enforced + department + policy version
```

| Code | Role |
|---|---|
| [src/policy/types.ts](../src/policy/types.ts) | The policy format (the contract with the platform) |
| [src/policy/validate.ts](../src/policy/validate.ts) | Validation of anything received. Bad fields are dropped; a bad policy is rejected and the previous one kept |
| [src/policy/store.ts](../src/policy/store.ts) | `savePolicy()`, `loadPolicy()`, live updates for open tabs |
| [src/policy/defaults.ts](../src/policy/defaults.ts) | Built-in default (the PDF tier table) and the lookup order |

**Lookup order for a detected item:** label override (e.g. `API_KEY`) → category override (e.g. `AUTH_SECRET`) → built-in table.
Labels are more precise than categories: `API_KEY` and `PASSWORD` both belong to `AUTH_SECRET`.

## 2. Policy format

| Field | Type | Meaning |
|---|---|---|
| `version` | number ≥ 0 | Increases with every publish. The extension only accepts a newer version |
| `departmentId` | string | The department it applies to |
| `categories` | `{ [CategoryId]: { tier?, userOverridable? } }` | Override a whole category. `tier: "SAFE"` = ignore that category (not shown, not masked) |
| `labels` | `{ [LABEL]: { tier?, userOverridable? } }` | Override one type (API_KEY, PASSWORD, EMAIL, NATIONAL_ID…) |
| `rules.disabledPatterns` | string[] | Built-in pattern ids to switch off (ids in [patterns.ts](../src/detectors/patterns.ts), e.g. `url`) |
| `rules.org` | `{ id, name, kind, definition, risk, action }[]` | Organisation rules from the policy bundle. `kind` is `KEYWORD` (one word or phrase per line, whole words) or `PATTERN` (regex, compiled with the flag `i` only). `TOPIC` rules are not enforced. `action` ALLOW/WARN/BLOCK decides what the user sees; the match is reported with the rule's `id` |
| `decision.enabled` / `hypotheses` / `examples` / `uncertaintyThreshold` | — | The decision model's "prompt" (Phase 4): one sentence per tier (zero-shot) or example prompts per tier (embedding model) |

Category ids, tiers and labels: [src/detectors/categories.ts](../src/detectors/categories.ts), [src/detectors/patterns.ts](../src/detectors/patterns.ts).

### Example: Engineering department

```json
{
  "version": 7,
  "departmentId": "engineering",
  "labels": {
    "API_KEY": { "tier": "MEDIUM", "userOverridable": true },
    "IP_ADDRESS": { "tier": "LOW" }
  },
  "categories": {
    "FILE_PATH": { "tier": "LOW" }
  },
  "rules": {
    "disabledPatterns": ["url"],
    "org": [
      { "id": "7c2f…", "name": "Codenames", "kind": "KEYWORD", "definition": "Project Falcon\nمشروع الصقر", "risk": "MEDIUM", "action": "WARN" }
    ]
  }
}
```

Effect: API keys need a confirmation instead of a block, and a developer may exempt them. Passwords stay HIGH, because they are in the same category but not overridden. Public URLs are no longer flagged. The codename is masked as `[RULE_1]`.

## 3. User exceptions (on the user's device)

Stored in `chrome.storage.local` under `hares.userExceptions`:

```json
{ "categories": [], "labels": ["API_KEY"], "until": "2026-11-01T00:00:00Z" }
```

| Rule | Why |
|---|---|
| An exception applies **only** if the policy marks that label or category `userOverridable: true` | Otherwise the extension becomes optional |
| An exempted item is enforced as **LOW**: sent without a dialog, with a toast "Sent under your personal exception (API_KEY)" | The user is still reminded |
| The log keeps the **policy outcome** (`action`, `risk_level`); an exception never lowers it | The admin dashboard sees what really happened |
| It lowers only the exempted type. Other data in the same message is enforced normally | Exempting API keys must not let a card number through |
| Optional `until` expiry | Temporary exceptions |

The user-facing screen for managing exceptions (extension popup) is not built yet.

## 4. Log events (no prompt text)

One event per analysed send, uploaded with `POST /logs` while the user is signed in. Source: [src/logging/event.ts](../src/logging/event.ts).

| Field | Value |
|---|---|
| `log_id` | UUID created with the event; every retry sends the same one |
| `event_time` | UTC with `Z`, device time corrected by the server's `Date` header |
| `platform` | `CHATGPT` / `CLAUDE` / `GEMINI` |
| `risk_level` | highest risk among the detections (`NONE` if nothing matched); the bundle's `risk_level` of the category, or the built-in tier if it is missing |
| `action` | the policy outcome: `BLOCKED` (BLOCK) / `WARNED` (WARN) / `ALLOWED` (ALLOW or nothing matched). A user exception never lowers it |
| `categories` | distinct contract codes (the 24); organisation rules add none |
| `classification_source` | `LOCAL_AI` (rules + local model), `LOCAL` (model switched off), `LOCAL_ONLY_FALLBACK` (model should have run but could not) |
| `user_decision` | `NONE` (no dialog), `SUBMITTED_ANYWAY` (Confirm), `REVISION_USED` (Send revised, also when it had to be copied), `EDITED` (Edit button), `CANCELLED` (Escape / click outside) |
| `rule_id` | the matched rule with the strictest action, then the highest risk, then first in the bundle; `null` if none |
| `schema_version` | `1` |

`user_id` and `department_id` are never sent (they come from the token). Events are queued in `storage.local` (at most 500, oldest dropped), uploaded one at a time from the background, and dropped without being sent if the user is not signed in. Backoff, 429, 403 `DEPARTMENT_INACTIVE` and 400 handling are described in [src/backend/uploader.ts](../src/backend/uploader.ts).

## 5. Safety rules for the platform

1. **Regex rules are checked by the backend.** The backend rejects a PATTERN it cannot prove safe (ReDoS) and limits it to 512 characters. The extension also skips a definition that is longer or does not compile. KEYWORD rules are literal text, never regex.
2. **"Test before publish"** for decision-model hypotheses or examples: run the new policy against the test fixtures and show the admin how many results change. One reworded sentence can shift accuracy a lot.
3. **Versions only go up.** Until the policy bundle is connected, the extension ignores a policy whose version is not newer than the one it has.
4. **Offline:** the extension keeps working with the last stored policy, or the built-in default on a fresh install.
5. **Tampering:** a technical user can edit local storage on their own machine. For locked-down settings, use Chrome Enterprise policy (force-install + `chrome.storage.managed`).

## 6. Not done yet (needs the platform)

- Sign-in in the extension, and fetching the policy for the user's department.
- Sending queued log events to the backend.
- Popup screen for user exceptions.
- `decision` fields take effect in Phase 4, when the decision model is added. Which detection-model types are on is fixed in the extension (six common types stay off); a category's policy decides what happens with the rest.
