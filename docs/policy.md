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
| `rules.customKeywords` | `{ text, category, label }[]` | Organisation terms (project codenames, client names), English or Arabic. **Literal text, never regex** |
| `detector.enabledLabels` | string[] | Detection model types to keep (Phase 3) |
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
    "customKeywords": [
      { "text": "Project Falcon", "category": "CORPORATE", "label": "CODENAME" },
      { "text": "مشروع الصقر", "category": "CORPORATE", "label": "CODENAME" }
    ]
  }
}
```

Effect: API keys need a confirmation instead of a block, and a developer may exempt them. Passwords stay HIGH, because they are in the same category but not overridden. Public URLs are no longer flagged. The codename is masked as `[CODENAME_1]`.

## 3. User exceptions (on the user's device)

Stored in `chrome.storage.local` under `hares.userExceptions`:

```json
{ "categories": [], "labels": ["API_KEY"], "until": "2026-11-01T00:00:00Z" }
```

| Rule | Why |
|---|---|
| An exception applies **only** if the policy marks that label or category `userOverridable: true` | Otherwise the extension becomes optional |
| An exempted item is enforced as **LOW**: sent without a dialog, with a toast "Sent under your personal exception (API_KEY)" | The user is still reminded |
| The log keeps the **policy tier** (`tier`), plus `enforcedTier` and `exceptedCategories` | The admin dashboard sees what really happened |
| It lowers only the exempted type. Other data in the same message is enforced normally | Exempting API keys must not let a card number through |
| Optional `until` expiry | Temporary exceptions |

The user-facing screen for managing exceptions (extension popup) is not built yet.

## 4. Log event fields (no prompt text)

`tier` (policy) · `enforcedTier` · `exceptedCategories` · `departmentId` · `policyVersion` · `categories` · `detectionCount` · `action` (`auto_sent` / `sent_original` / `sent_revised` / `copied_revised` / `cancelled`) · `platform` · `analysisMs` · `at` · `id`.
Source: [src/logging/events.ts](../src/logging/events.ts). Events are queued locally today; sending them to the backend is the integration step.

## 5. Safety rules for the platform

1. **No raw regex from the dashboard.** Custom keywords are literal text, so a bad pattern can't freeze users' browsers (ReDoS). If raw regex is ever needed, restrict it to the System Admin and test it on the server (length, run time) before publishing.
2. **"Test before publish"** for decision-model hypotheses or examples: run the new policy against the test fixtures and show the admin how many results change. One reworded sentence can shift accuracy a lot.
3. **Versions only go up.** The extension ignores a policy whose version is not newer than the one it has.
4. **Offline:** the extension keeps working with the last stored policy, or the built-in default on a fresh install.
5. **Tampering:** a technical user can edit local storage on their own machine. For locked-down settings, use Chrome Enterprise policy (force-install + `chrome.storage.managed`).

## 6. Not done yet (needs the platform)

- Sign-in in the extension, and fetching the policy for the user's department.
- Sending queued log events to the backend.
- Popup screen for user exceptions.
- `detector` and `decision` fields take effect in Phases 3–4, when the models are added.
