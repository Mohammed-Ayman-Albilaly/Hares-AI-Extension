I'll start by inspecting the repository to ground the plan in what actually exists.

I now have enough evidence. The repo is genuinely empty (only the two docs on `main`, remote pointing to `Mohammed-Ayman-Albilaly/Hares-AI-Extension`), and I've verified the key external facts the plan depends on. I'll write the plan directly rather than delegate — there is no existing code to shard.

---

# Hares AI MVP — Implementation Plan

## Source of truth used

- `docs/requirements-mvp.md` (BA): product/behavioral source of truth (FR/NR, AC, scope).
- `docs/system-design.md` (Architecture): technical direction (runtime, model, policy, privacy, failure handling).
- External verification (Hugging Face, fetched 2026-09-30): the named model **is real** and browser-runnable.

## Repository assessment

| Item                     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing code            | **None.** No `package.json`, `tsconfig`, build config, source, worker, or model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Docs                     | `docs/requirements-mvp.md` (BA spec), `docs/system-design.md` (finalized architecture).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| README                   | Empty/artifact (mojibake), no content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Git                      | branch `main`, remote `github.com/Mohammed-Ayman-Albilaly/Hares-AI-Extension`. Clean restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Model                    | `Horizon-Labs/multilingual-zeroshot-small` — **confirmed real**: 141M params (140,642,306 F32), Apache-2.0, `zero-shot-classification` pipeline, ONNX for CPU+browser, `transformers.js` compatible, mmBERT-small, 26 languages incl. `ar`+`en`, 8k context (tuned ≤1024), NLI-style (entailment/not_entailment), versions `v1.0/v1.1/v1.3`. Published Arabic mean accuracy **0.554 (weakest language)** vs English 0.681 — confirms the gate is load-bearing. A first-party browser demo Space exists (`Horizon-Labs/multilingual-zeroshot`), so browser-compat risk is low. |
| Fallback (if eval fails) | `convaiinnovations/laya-multilingual` (322M, Apache-2.0, 100+ langs) / `onnx-community/laya-multilingual-ONNX`. Fine-tuning is explicitly **not** an MVP task.                                                                                                                                                                                                                                                                                                                                                                                                                |

**Conclusion:** everything is built from scratch. The dominant risks are (a) **is the ready-made model actually useful on Arabic+English sensitive-risk**, which is why the evaluation gate is mandatory and precedes most build work, and (b) **DOM-level send interception + re-fire**, which is fragile by nature.

---

## 2. Target project structure

Chosen build tool: **WXT** (Vite-based, first-class MV3 + TypeScript, manifest generation, clean content-script/background/offscreen handling). _Assumption:_ WXT is selected for ergonomics; if WXT's offscreen-document + dedicated-worker packaging proves problematic in the Phase-1 spike, fall back to **Vite + CRXJS** (same decision at that point). This is the single tooling decision the Developer must confirm in Phase 1.

```
hares-ai-extension/
├─ package.json
├─ tsconfig.json
├─ wxt.config.ts              # manifest, CSP (wasm-unsafe-eval), entries
├─ .env.example               # MODEL_REVISION, MODEL_SHA256 manifest vars, HF token (optional)
├─ README.md
├─ docs/
│  ├─ requirements-mvp.md     # already present
│  ├─ system-design.md        # already present
│  └─ evaluation-gate.md      # NEW: eval results + ship/no-ship decision
├─ entrypoints/
│  ├─ background.ts           # service worker: orchestrator + policy + fail-open + offscreen lifecycle
│  ├─ offscreen.html          # offscreen document (chrome.offscreen host, reason: WORKERS)
│  ├─ offscreen.ts            # spawns the dedicated Web Worker, bridges messages
│  └─ content/
│     ├─ chatgpt.ts
│     ├─ claude.ts
│     └─ gemini.ts
├─ worker/
│  ├─ inference.worker.ts     # onnxruntime-web / transformers.js classify()
│  └─ model-loader.ts         # load from verified local cache; disable remote loading
├─ src/
│  ├─ messaging/              # types.ts, protocol.ts, client.ts, server.ts (chrome.runtime IPC)
│  ├─ policy/                 # types.ts, decision.ts (model output → tier → action)
│  ├─ model/                  # config.ts (pinned revision, labels/hypotheses/checksum),
│  │                          # cache.ts (download-once + SHA-256 + IndexedDB/Cache), contract.ts
│  ├─ adapters/               # types.ts (PlatformAdapter iface), registry.ts, chatgpt.ts, claude.ts, gemini.ts
│  ├─ settings/               # storage.ts (chrome.storage.local), defaults.ts
│  ├─ ui/                     # overlay/ (warn/confirm/block), a11y.ts (focus trap, ARIA, shadow host)
│  ├─ error/                  # fail-open.ts
│  └─ test/
│     ├─ TEST_MODE.ts         # forces CPU/WASM EP for determinism
│     └─ permissions.ts
├─ eval/
│  ├─ dataset/                # en.json, ar.json, mixed.json (+ labels/ground truth + rubric)
│  ├─ metrics.ts              # recall, FP rate, latency p50/95
│  └─ run-eval.mjs            # drives batch through the runtime, writes evaluation-gate.md
├─ scripts/
│  └─ download-model.mjs      # fetch pinned revision files, verify SHA-256, seed cache
└─ tests/
   ├─ unit/                   # vitest
   ├─ fixtures/               # html fixtures per platform (DOM snapshots)
   └─ e2e/                    # playwright (Chromium extension context)
```

Model artifact and runtime WASM are **not** in `web_accessible_resources`; model is not bundled in the package (download-once + Cache/IndexedDB).

---

## 3. Implementation phases

> **Ordering decision (deliberate deviation from the suggested list):** the listed items put the _model evaluation spike_ before the _browser inference runtime spike_. That is dependency-inverted — you cannot measure the model until it runs in-browser. I place **on-device inference runtime (P2) before the evaluation gate (P3)**, and **decision/policy (P9 below) before adapters** because adapters consume a decision. Everything else follows the suggested sequence.

### Phase 1 — MV3 Scaffold & Toolchain

**Objective:** a loadable, TypeScript, MV3 extension that registers a background SW, can create an offscreen document, and declares 3 content scripts scoped to the platform origins — with no inference yet.

**Tasks**

- Init `package.json`, `tsconfig`, `wxt.config.ts`, gitignore.
- Manifest: `manifest_version: 3`, name/version, `permissions: ["storage","offscreen"]` (+ `scripting` only if dynamic injection used), host_permissions scoped to the 3 platform origins.
- `content_security_policy.extension_pages` = `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` (confirm in a WebGPU/onnxruntime smoke test that WASM loads; if the default MV3 CSP already allows it, just verify and keep a comment).
- Background SW with a `chrome.runtime.onMessage` stub; offscreen create/close helper with `reason: "WORKERS"`; confirm `chrome.offscreen` exists on Chrome+Edge.
- Empty content scripts wired to `matches` for the 3 platform origins.
- Scope decision: **supported origins** = `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*` (assumed; confirm in adapter Phases 6–8).
- `npm run dev`/`build` emits a loadable unpacked extension.

**Affected files:** root configs, `wxt.config.ts`, `entrypoints/*` (stubs), `src/test/TEST_MODE.ts`.

**Dependencies:** none (first).

**Acceptance criteria**

- Build succeeds; unpacked extension loads in Chrome and Edge.
- `chrome.runtime.getManifest().manifest_version === 3`; permissions/host_permissions correct, no `<all_urls>`/`webRequest`/`debugger`.
- Background SW registers; offscreen document can be created and closed; content scripts inject on the 3 origins (verify via a console log / trivial message round-trip).
- No CSP violations on load.

**Testing strategy:** manual build+load; trivial `runtime.sendMessage` round-trip from content script → background → back; console clean.

**Definition of done:** extension loads with zero errors and a proven content↔background↔offscreen message path.

---

### Phase 2 — On-Device Inference Runtime Spike

**Objective:** prove `Horizon-Labs/multilingual-zeroshot-small` runs locally in the Offscreen Document's Dedicated Web Worker via Transformers.js / ONNX Runtime Web and returns a four-label score distribution with measured latency. This is a feasibility spike only.

**Boundary / assumption:** Phase 1 is complete. Phase 2 builds only the local inference runtime on top of the existing Offscreen → Dedicated Worker plumbing.

Phase 2 must not introduce:

* SAFE / LOW / MEDIUM / HIGH risk-tier decision logic
* warnings, confirmation, or blocking behavior
* platform interception or adapters
* settings
* SHA-256 verification
* production cache hardening
* Phase 3 evaluation dataset or evaluation gate
* backend/API inference
* response scanning or redaction

---

#### 1. Tasks

1. **Add inference dependencies and build configuration**

   * Add `@huggingface/transformers` v3.
   * Add `onnxruntime-web` directly only if required for explicit execution-provider or WASM configuration.
   * Configure the worker/runtime so required ONNX Runtime WASM assets are available **locally inside the extension build**.
   * Do not depend on an unpinned runtime CDN fetch for WASM/ONNX Runtime assets.
   * Preserve the existing MV3 CSP including `wasm-unsafe-eval`.

2. **Implement `worker/inference.worker.ts`**

   * Load the pinned model:
     `Horizon-Labs/multilingual-zeroshot-small`
   * Pin the **exact `v1.3` revision/ref**. Never use `latest`, `main`, or another mutable alias.
   * Use WebGPU as the primary execution provider.
   * Use WASM SIMD as the fallback.
   * `TEST_MODE` may force CPU/WASM for deterministic testing.
   * Implement the classifier runtime without risk-tier decision logic.
   * Handle model-load, inference, worker, and runtime errors without leaving requests permanently pending.

3. **Implement the classifier contract**
   Implement:

   `classify(prompt) → { labels, scores, top, top_score, input_tokens, latency_ms, uncertain }`

   The contract must:

   * return four labels and four corresponding scores;
   * use the exact four baseline hypothesis strings defined in `docs/system-design.md` §5;
   * preserve the architecture's `multi_class=false` semantics;
   * ensure `top` is the argmax label;
   * ensure `top_score` corresponds to the selected top label;
   * contain no SAFE/LOW/MEDIUM/HIGH policy mapping.

   If the NLI `text-classification` approach with `text_pair` is used, all four hypotheses must be evaluated in a **single batched forward pass**, not four serial inference passes.

4. **Add minimal spike model configuration**
   Store only the runtime configuration required for the spike:

   * model ID;
   * exact pinned `v1.3` revision/ref;
   * four baseline hypotheses from `docs/system-design.md` §5.

   Production checksum verification and hardened model loading remain Phase 12 work.

5. **Wire the existing Offscreen Document to the inference worker**

   * Reuse the Phase 1 Offscreen → Dedicated Worker architecture.
   * Forward `classify` requests to the worker.
   * Return the worker result through the existing Offscreen messaging path.
   * Handle worker-not-ready/model-warming states safely.

6. **Error handling**

   * Model-load failure must return a typed error.
   * Inference failure must return a typed error.
   * Worker `error` / `messageerror` / timeout conditions must settle the request.
   * No async inference request may remain permanently pending.

7. **English + Arabic smoke test**
   Run at least:

   * one English sample;
   * one Arabic sample.

   Record:

   * labels;
   * scores;
   * top;
   * top_score;
   * input_tokens;
   * latency_ms;
   * execution provider;
   * success/failure.

   Record cold-start and warm inference latency separately.

8. **Local-only / no-egress confirmation**
   During the smoke test, manually inspect browser DevTools Network activity.

   Confirm:

   * prompt text is not present in any outbound request URL or request body;
   * model artifact downloads, if required during first setup, contain only model/runtime artifacts and no prompt content;
   * no Hares backend or inference server receives prompt data.

   This is a manual Phase 2 confirmation. Automated network-trace verification remains Phase 15 work.

9. **Record Phase 2 spike result**
   Record:

   * exact model revision/ref;
   * ONNX artifact used;
   * execution provider;
   * cold/warm latency;
   * resolved classifier API;
   * any runtime limitations or errors;
   * final `classify()` contract.

   This record is for Phase 3 consumption and is **not** the Phase 3 evaluation gate.

---

#### 2. Files / Components Affected

| File / Component             | Expected Change                                                 |
| ---------------------------- | --------------------------------------------------------------- |
| `package.json`               | Add Transformers.js and `onnxruntime-web` only if required      |
| `package-lock.json`          | Updated dependency lockfile                                     |
| `wxt.config.ts`              | Worker/runtime and local WASM asset configuration               |
| `worker/inference.worker.ts` | Local inference runtime and `classify()`                        |
| `entrypoints/offscreen.ts`   | Bridge existing Offscreen messaging to inference worker         |
| `src/model/contract.ts`      | `ClassifyResult` / `ClassifyResponse` types                     |
| `src/model/config.ts`        | Model ID, exact `v1.3` revision/ref, four hypotheses            |
| `entrypoints/offscreen.html` | Modify only if strictly required by runtime/build configuration |

`worker/model-loader.ts` remains deferred to Phase 12 and must not be used for production cache/checksum hardening in this phase.

Do not modify:

* `src/policy/*`
* `src/adapters/*`
* `src/ui/*`
* `src/settings/*`
* `src/messaging/*`
* `entrypoints/content/*`
* `eval/*`
* `scripts/*`
* unrelated Phase 1 components

---

#### 3. Dependencies

* `@huggingface/transformers` v3
* `onnxruntime-web` only if required for explicit EP/WASM configuration
* Existing Phase 1 WXT + Vite + TypeScript toolchain
* Existing Offscreen Document + Dedicated Worker plumbing
* Existing MV3 CSP with `wasm-unsafe-eval`

---

#### 4. Validation Criteria

* [ ] `classify(prompt)` returns four labels and four scores.
* [ ] `top` equals the highest-scoring label.
* [ ] `top_score` corresponds to `top`.
* [ ] The exact four hypotheses from `docs/system-design.md` §5 are used.
* [ ] `multi_class=false` semantics are preserved.
* [ ] If NLI `text_pair` is used, all four hypotheses run in one batched forward pass.
* [ ] The exact pinned `v1.3` model revision/ref is used.
* [ ] WebGPU is attempted first.
* [ ] WASM SIMD is used as fallback when WebGPU is unavailable.
* [ ] Required WASM/ONNX Runtime assets are available locally and do not rely on an unpinned CDN runtime fetch.
* [ ] English smoke test succeeds.
* [ ] Arabic smoke test succeeds.
* [ ] Cold and warm latency are recorded.
* [ ] Model/inference/worker failures return typed errors and cannot leave requests permanently pending.
* [ ] Prompt text does not appear in outbound network requests.
* [ ] No Hares backend/inference API receives prompt data.
* [ ] No risk-tier decision logic is introduced.
* [ ] No Phase 3 evaluation dataset or evaluation gate is introduced.
* [ ] Typecheck, lint, tests, and build pass.

---

#### 5. Architecture Constraints Approved for Phase 2

The Systems Architect approved the Phase 2 plan with the following constraints:

1. **Model loading**

   * The spike may fetch model artifacts from Hugging Face during initial setup.
   * Only model/runtime artifacts may be fetched.
   * Prompt text must never be sent to Hugging Face or any inference server.
   * Use the exact pinned `v1.3` revision/ref.
   * Production SHA-256 verification, hardened caching, and `allowRemoteModels=false` remain Phase 12 work.
   * Do not bundle the full model into the extension package.

2. **Execution provider**

   * WebGPU → WASM SIMD fallback ordering must be preserved.
   * If WebGPU is unavailable inside the Offscreen → Dedicated Worker runtime, record the limitation and use WASM rather than redesigning the architecture.

3. **Classifier API**

   * The exact four hypotheses from `docs/system-design.md` §5 must be honored.
   * Preserve the `{ labels, scores, top, top_score, input_tokens, latency_ms, uncertain }` contract.
   * Preserve `multi_class=false` semantics.
   * If using NLI with `text_pair`, batch all four hypotheses in a single forward pass.

4. **Model artifacts**

   * Pin the exact `v1.3` revision/ref.
   * Select an ONNX artifact compatible with the target browser runtime and approved execution-provider strategy.
   * Verify the actual artifact path during implementation.

5. **Runtime assets**

   * Required WASM/ONNX Runtime assets must be delivered locally with the extension/runtime.
   * Do not rely on an unpinned CDN runtime fetch inside the extension.
   * Preserve the existing MV3 CSP.

---

#### 6. Phase 2 → Phase 3 Boundary

Phase 2 ends when the local inference runtime is proven to:

> load the approved pinned model, execute inference inside the Dedicated Web Worker, return the required four-label score distribution, record latency, and demonstrate that prompt data does not leave the local inference path.

Phase 3 is separate and begins only after Phase 2 is closed. Phase 3 will handle the labeled English/Arabic/mixed/RTL evaluation dataset, evaluation harness, metrics, and ship/no-ship evaluation gate.

**Phase 3 is not part of Phase 2.**


### Phase 3 — Model Evaluation Gate (English + Arabic)

**Objective:** decide **with evidence** whether the chosen model is acceptable, using the system-design §11 gates — because Arabic is the weakest published language and the model card gives **no** sensitive-risk accuracy.

**Tasks**

- Define a 4-tier labeling **rubric** (SAFE/LOW/MEDIUM/HIGH) and sensitive-data categories (national/ID, payment/financial, credentials/secrets, contact/address, medical, proprietary/internal, mixed-language).
- Curate a small representative labeled set: ~200–300 English, ~200–300 Arabic, ~100 mixed English/Arabic, plus explicit RTL and benign-only cases. Keep it small per the requirement (feasibility gate, not a benchmark run).
- `eval/run-eval.mjs` batches the set through the in-browser runtime (CPU/WASM `TEST_MODE` for determinism), computes metrics in `eval/metrics.ts`:
  - HIGH **recall** (target ≥ **0.85**)
  - SAFE **false-positive rate** (target ≤ **0.20**)
  - **p50 latency** (target ≤ **400 ms**), **hard timeout** ≤ 2 s
- Write results to `docs/evaluation-gate.md`, including per-language breakdown (en / ar / mixed / RTL) and the exact config (revision `v1.3`, template, labels).
- **Decision gate:** pass → proceed with this model; fail → record as a **blocker + fallback** (larger zero-shot or Laya multilingual), do **not** silently introduce fine-tuning. Fine-tuning remains a separate non-MVP phase.

**Affected files:** `eval/*`, `docs/evaluation-gate.md`, `src/model/config.ts` (tuned labels/template).

**Dependencies:** Phase 2 (runtime must classify).

**Acceptance criteria**

- Metrics computed and recorded; gates evaluated; decision (ship / fallback) documented.
- The same prompt yields the same tier across runs (determinism via CPU/WASM test mode).
- No fine-tuning pipeline created; no second engine introduced.

**Testing strategy:** the eval harness IS the test; add a reproducibility check (run twice, assert identical tiers). Label quality: ≥2 annotators on a 10% subset.

**Definition of done:** `docs/evaluation-gate.md` states a reproducible pass/fail and a concrete next model decision.

---

### Phase 4 — Messaging & Orchestration Architecture

**Objective:** typed `chrome.runtime` IPC from content script → background → offscreen worker and back, with the background as a thin orchestrator.

**Tasks**

- `src/messaging/types.ts`: `ClassifyRequest { prompt, platform, requestId }`, `ClassifyResult { labels, scores, top, top_score, input_tokens, latency_ms, uncertain, error? }`, `Decision { tier, action, confidence, reason?, error? }`.
- Request/response protocol with `requestId`; router in background; worker→background bridge; timeout handling at IPC level.
- Background creates the offscreen document on first classify and keeps a **single shared** worker/model instance across tabs (no per-tab model duplication).
- Lazy init: if offscreen/model not ready, return a "model warming" signal (caller shows "Analyzing…").

**Affected files:** `src/messaging/*`, `entrypoints/background.ts`, `entrypoints/offscreen.ts`.

**Dependencies:** Phase 1 (messaging channel) + Phase 2 (worker classify endpoint). Policy (P5) fills in the decision mapping.

**Acceptance criteria**

- Content script → background → worker → content script round-trip returns a typed result.
- Request IDs prevent cross-tab/prompt mixups; single worker reused.
- Timeout surfaces as `error` (handled by fail-open in P10).
- Background does **no** heavy inference (only routing/policy/settings).

**Testing strategy:** unit-test protocol serialization; integration test with a mocked worker; concurrency test (two rapid prompts).

**Definition of done:** a typed, routed classify pipeline with a single shared inference host.

---

### Phase 5 — Decision & Policy Flow

**Objective:** deterministic mapping from model output → tier → behavior, plus the uncertainty/truncation/empty rules (system-design §4). This is the only place (besides fail-open) that turns model scores into a UI/enforcement action.

**Tasks**

- `src/policy/types.ts`: `RiskTier = 'safe'|'low'|'medium'|'high'`; `PolicyAction = 'auto_send'|'warn_send'|'confirm'|'block'`.
- `src/policy/decision.ts`:
  - top label (argmax) → tier.
  - `top_score < 0.40` → escalate to `medium` (conservative but not blocking).
  - empty/whitespace → `safe`.
  - over context budget → truncate bounded prefix, mark truncation, escalate to `medium`.
- Robust to out-of-contract model output (unknown label / NaN scores → treat as uncertain → escaate to `medium`).

**Affected files:** `src/policy/*`.

**Dependencies:** Phase 4 result types.

**Acceptance criteria**

- Deterministic tier↔behavior mapping (one tier ↔ one action).
- Escalation rules fire on uncertainty, emptiness, truncation, malformed output.
- Pure function (no I/O) → unit-testable.

**Testing strategy:** exhaustive unit tests via a truth table of (model output → tier → action); edge cases (empty, whitespace, very long, NaN, missing label).

**Definition of done:** decision function fully unit-tested and stable.

---

### Phase 6 — Platform Adapter Abstraction

**Objective:** define `PlatformAdapter` so platforms are swappable and DOM-drift-tolerant.

**Tasks**

- `src/adapters/types.ts`: `PlatformAdapter { id, originMatches(url), getComposer(), getSendButton(), extractPrompt(), supportsEnterSend(), fireSend(), renderDecision(decision) }`.
- `src/adapters/registry.ts`: register + dispatch by origin; deterministic `canHandle`.
- `renderDecision` is an interface the UI module (P8) implements — adapters depend on the contract, not the implementation.
- DOM selectors live in each adapter, with **multiple fallback selectors** and a documented selector version pin.
- `extractPrompt()` handles contenteditable (`textContent`/`innerText`) and textarea (`.value`).
- `fireSend()`: re-dispatch a synthetic click on the send button, OR focus composer + dispatch Enter (per-platform); note the native-setter trick for React-controlled composers.

**Affected files:** `src/adapters/types.ts`, `registry.ts`, `entrypoints/content/*`.

**Dependencies:** Phase 5 (decision types), Phase 8 UI contract.

**Acceptance criteria**

- `canHandle` is origin-deterministic; an adapter swaps in/out without touching policy.
- `extractPrompt` + `fireSend` implemented against fixture DOM with fallbacks.
- Injection only on the 3 platform origins (least privilege).

**Testing strategy:** per-platform HTML **fixtures** (snapshots of composer/button) drive unit tests for extraction/interception/re-fire — no login required.

**Definition of done:** adapter registry + interface covered by fixture tests for all 3 platforms' DOM shapes.

---

### Phase 7 — ChatGPT Adapter

**Objective:** working send interception + prompt extraction + re-fire on ChatGPT.

**Tasks:** implement adapter selectors (ProseMirror contenteditable composer; send button; Enter/Cmd+Enter keydown capture); preventDefault; extract; classify; render decision; re-fire. Handle the "value setter + input event" for React detection.

**Affected files:** `src/adapters/chatgpt.ts`, `tests/fixtures/chatgpt.html`.

**Dependencies:** Phase 6 (interface), Phase 8 (UI).

**Acceptance criteria**

- Send click and Enter/Cmd+Enter are intercepted (capture phase); default send prevented.
- Prompt correctly extracted; SAFE/LOW re-fired, confirmed-MEDIUM re-fired after confirm, HIGH not fired.
- Works on the chatgpt.com and chat.openai.com origins.

**Testing strategy:** fixture tests + a live smoke test on a real session (manual); automated if a logged-in session is available.

---

### Phase 8 — Claude Adapter

**Objective:** same behaviors on Claude (contenteditable composer; send button).

**Tasks:** adapter selectors for Claude DOM; `fireSend` for Claude's send mechanism; same policy enforcement.

**Affected files:** `src/adapters/claude.ts`, `tests/fixtures/claude.html`.

**Dependencies:** Phase 6/7 patterns.

**Acceptance criteria:** interception, extraction, tier enforcement all pass on claude.ai origin; fixture + smoke tests green.

---

### Phase 9 — Gemini Adapter

**Objective:** same behaviors on Gemini (contenteditable; send button; possibly a "send" mic-keyboard distinction).

**Tasks:** adapter selectors; prompt extraction; fireSend; enforcement.

**Affected files:** `src/adapters/gemini.ts`, `tests/fixtures/gemini.html`.

**Dependencies:** Phase 6/7 patterns.

**Acceptance criteria:** interception, extraction, tier enforcement on gemini.google.com origin; fixture + smoke tests green.

---

### Phase 10 — Warn / Confirm / Block UI

**Objective:** accessible overlay surfaces for the three non-SAFE behaviors, rendered so the host page cannot spoof or manipulate them.

**Tasks**

- `src/ui/overlay/`: `warn_send` (transient, non-blocking, auto-dismiss on send), `confirm` (dialog: confirm/cancel/dismiss-aborts), `block` (dialog with rationale; no send).
- Render inside an injected host element with a **closed Shadow DOM** to isolate from page CSS/JS.
- Accessibility (WCAG 2.2 AA): `<dialog>`/role=dialog, focus trap, `aria-describedby`, Escape to cancel, visible focus, contrast, keyboard operability, screen-reader labels.
- Show the assigned risk level (trust), copy must not imply a DLP _guarantee_ ("reduces risk").
- Show "Analysis skipped — model unavailable" (fail-open notice) — wired in P10/P12.

**Affected files:** `src/ui/*`, `entrypoints/content/*` (invoke render).

**Dependencies:** Phase 5 action types; Phase 6 adapter `renderDecision`.

**Acceptance criteria**

- All four behaviors render correctly and enforce the right action.
- Keyboard-only operation; focus moves into the overlay and returns; Escape cancels (aborts send for `confirm`).
- Page CSS/JS cannot break the overlay (shadow isolation).
- `block` shows rationale and does not send.

**Testing strategy:** component/fixture tests for each surface; a manual accessibility pass (axe/screen reader) sampled.

---

### Phase 11 — Settings

**Objective:** minimal settings: global on/off + per-platform toggles.

**Tasks**

- `src/settings/storage.ts` (chrome.storage.local), `defaults.ts`.
- A settings entry point (popup or options page) with global + per-platform toggles.
- When a platform is disabled, background returns a `release` decision (no analysis, send proceeds) — matches BA AC-10.

**Affected files:** `src/settings/*`, manifest (options/popup), background routing.

**Dependencies:** Phase 4 routing.

**Acceptance criteria**

- Disabling a platform stops analysis for that platform only; others remain active.
- Settings persist across restarts.

**Testing strategy:** unit tests for storage/defaults; manual toggle verification.

---

### Phase 12 — Model Caching & Checksum Verification (hardened)

**Objective:** download-once + local cache with pinned revision + SHA-256, remote loading disabled in production, model never in web-accessible resources.

**Tasks**

- `src/model/config.ts`: pin revision (`v1.3`) + SHA-256 manifest; `src/model/cache.ts`: download via HF `resolve` URLs, compute `crypto.subtle.digest('SHA-256')`, store in Cache API/IndexedDB (not `chrome.storage.sync`).
- On mismatch: reject + re-download; on any load failure → fail-open path.
- `env.allowRemoteModels = false`, `env.useBrowserCache = true`, `env.localModelPath` → local verified cache.
- `scripts/download-model.mjs` pre-seeds the cache; verify tooling works with the worker loader.

**Affected files:** `src/model/*`, `scripts/download-model.mjs`.

**Dependencies:** Phase 2 loader.

**Acceptance criteria**

- Model loads from local verified storage; remote loading disabled.
- Checksum mismatch → rejected and re-downloaded; no partial/poisoned artifact used.
- Model/assets not in `web_accessible_resources`; host page cannot access them.

**Testing strategy:** unit tests for hash verify + mismatch; network trace confirms a model fetch references the pinned revision URL only (never prompt text).

---

### Phase 13 — Fail-Open & Error Handling

**Objective:** model unavailable/crash/timeout → "Analysis skipped — model unavailable" and allow send. No user fail-open/fail-closed toggle in MVP.

**Tasks**

- `src/error/fail-open.ts`: on `error`/timeout (hard cap ~2 s) from classify, or offscreen/model not ready → do **one** retry on transient error, then fail-open.
- Empty/whitespace → `safe`; over-context → truncate+escalate (already in P5).
- Background orchestration emits a `warn_send`-style notice with "Analysis skipped" when failing open.

**Affected files:** `src/error/*`, background, content scripts.

**Dependencies:** P4/P5/P12.

**Acceptance criteria**

- Model crash/timeout → send proceeds with a visible notice; prompt never blocked by inference failure.
- No configurable fail-open/fail-closed setting exists in the UI.
- Fail-open path is unit-tested (model null, timeout, malformed output).

---

### Phase 14 — Integration Testing

**Objective:** end-to-end behavior on all three platforms, four-tier matrix, fail-open, and determinism.

**Tasks**

- Playwright Chromium **extension context** (`--load-extension`) smoke: load extension, inject fixture, assert tier behaviors.
- A 4-tier × 3-platform behavior matrix test (AC-1..AC-4, AC-8, AC-9) driven by fixture-controlled model outputs (inject a mocked decision).
- Cross-tab/concurrency test.

**Affected files:** `tests/e2e/*`, `tests/fixtures/*`.

**Dependencies:** all phases.

**Acceptance criteria:** matrix passes (or each platform's known blocker documented with a targeted fix).

---

### Phase 15 — Privacy & Network Verification

**Objective:** prove no prompt egress and that only model files (and only at install) are fetched.

**Tasks**

- CDP/Playwright request capture: assert that during a real send + classification, **no** outbound request body/URL contains the prompt text.
- Confirm the only network traffic is the initial model download (pinned revision) — no runtime remote model loading.
- Confirm model/assets are not in `web_accessible_resources`; audit permissions (no `<all_urls>`, `webRequest`, `debugger`).

**Affected files:** tests, `docs/system-design.md` §12 confirmations.

**Dependencies:** Phase 14 harness.

**Acceptance criteria**

- Zero prompt-carrying outbound requests during classification (AC-5).
- Runtime does not make network calls once the model is cached.
- Least-privilege permission set confirmed.

**Testing strategy:** automated network-trace test; manual audit checklist.

---

### Phase 16 — Final QA + Release

**Objective:** validate the MVP hypothesis and ship.

**Tasks**

- Run full unit + fixture + integration + privacy suites; document results.
- Re-run the English/Arabic eval gate on the final model config (regression) and finalize `docs/evaluation-gate.md`.
- Manual accessibility + usability pass; confirm copy doesn't overstate protection.
- Package a zipped, loadable extension; verify in Chrome and Edge; add `MANIFEST`/version metadata.

**Affected files:** release artifacts, docs.

**Dependencies:** all phases.

**Definition of done:** a tested, loadable extension in Chrome+Edge that enforces the four-tier behavior on ChatGPT/Claude/Gemini, with a documented, evidence-backed model decision and verified local-only privacy.

---

## 4. Ordered tasks (dependency-sequenced) with acceptance criteria

| #   | Task                                                              | Depends on | Acceptance criterion                                                                         |
| --- | ----------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| 1   | Bootstrap WXT+TS+manifest (scoped perms, CSP)                     | —          | Builds + loads in Chrome/Edge; perms correct; no CSP errors                                  |
| 2   | Offscreen doc → dedicated worker plumbing                         | 1          | Offscreen created (reason WORKERS); worker runs; survives SW suspension                      |
| 3   | Inference runtime spike (classify → 4 labels+scores+latency)      | 2          | Local classify returns contract object; latency measured; WebGPU or documented WASM fallback |
| 4   | Resolve exact transformer API for per-label hypotheses            | 3          | Documented; NLI-text_pair or zero-shot pipeline; honors per-label hypotheticals              |
| 5   | Curate en/ar/mixed/RTL eval set + rubric                          | —          | Labeled set with 4-tier ground truth                                                         |
| 6   | Eval harness + metrics (recall/FP/latency) + `evaluation-gate.md` | 3,4,5      | Gates computed; ship/no-ship decision recorded                                               |
| 7   | Typed messaging protocol + routing + single shared host           | 3          | Content→BG→worker→content round-trip; request IDs; single model instance                     |
| 8   | Decision/policy mapping + escalation rules                        | 7          | Deterministic tier→action; unit-tested truth table                                           |
| 9   | PlatformAdapter interface + registry                              | 8          | Origin-deterministic; swappable; fixture-tested                                              |
| 10  | ChatGPT adapter                                                   | 9          | Interception/extraction/re-fire on ChatGPT                                                   |
| 11  | Claude adapter                                                    | 10         | Same behaviors on Claude                                                                     |
| 12  | Gemini adapter                                                    | 10         | Same behaviors on Gemini                                                                     |
| 13  | UI: warn/confirm/block (a11y + shadow isolation)                  | 8,9        | All 4 behaviors enforce; keyboard-op; Escape cancels confirm                                 |
| 14  | Settings (global + per-platform)                                  | 7          | Platform disable → release; persists                                                         |
| 15  | Model caching + SHA-256 + disable remote                          | 3          | Loads from verified cache; mismatch→reject+re-download; no remote load                       |
| 16  | Fail-open + error handling                                        | 7,8,15     | Crash/timeout→"Analysis skipped" + allow send; no toggle                                     |
| 17  | Integration matrix (4 tiers × 3 platforms)                        | 10–14      | Matrix passes or docs known blockers                                                         |
| 18  | Privacy/network verification                                      | 17         | Zero prompt egress; least-privilege confirmed                                                |
| 19  | Final QA + package + release                                      | 17,18      | Tested, loadable extension on Chrome+Edge; final eval gate doc                               |

## 5. Dependencies (blocking)

- **1 → 2 → 3** (scaffold → worker → inference). **3 → 6** (eval needs a working classify). **6 gates** whether all downstream uses the primary model or the fallback.
- **3 → 7 → 8** (messaging → policy). **8 → 9** (adapters consume actions). **9 → 10/11/12** (adapters).
- **13** depends on **8+9** (needs action types + adapter hook). **14** depends on **7**. **15** depends on **3**.
- **16** depends on **7,8,15** (fail-open needs messaging + policy + loaded model).
- **17** depends on **10–14**; **18** on **17**; **19** on everything.

## 6. Test strategy

- **Unit (Vitest):** policy/decision truth table; fail-open; settings defaults; protocol serialization; checksum verification; model config.
- **Adapter fixture tests (per platform):** HTML snapshots → extraction/interception/re-fire without login (covers DOM drift).
- **Eval harness:** the English/Arabic gate (CPU/WASM test mode for determinism).
- **E2E (Playwright Chromium extension context):** 4-tier × 3-platform matrix using injected/mocked decisions; smoke on a real session (optional, login-gated).
- **Privacy/network:** CDP request capture asserting zero prompt egress.
- **Determinism:** run eval twice, assert identical tiers; `TEST_MODE` forces CPU/WASM.

## 7. Risks & blockers

1. **Arabic model performance (top risk):** published Arabic mean 0.554 (weakest). Sensitive-risk accuracy unproven → the gate may fail. **Mitigation:** binding eval; fallback tree (bigger zero-shot / Laya 322M); fine-tuning only as a separate non-MVP phase.
2. **Send interception + re-fire fragility (highest production risk):** DOM-level; React/controlled composers need native value-setter + input event; re-dispatch may not trigger. **Mitigation:** adapter abstraction, multi-selector fallbacks, fixture tests per platform.
3. **CSP / WASM in offscreen worker:** `wasm-unsafe-eval` must be present or inference fails. **Mitigation:** confirm in P1; pin `extension_pages` CSP.
4. **Model latency / memory:** 141M model (F32 ~562 MB; quantized less) on WebGPU vs WASM (~1–2 s). Could breach the 2 s cap on WASM. **Mitigation:** WebGPU primary, int4/8 quantization, truncation, single shared instance, latency gate in eval.
5. **WebGPU availability** (not all devices/some headless). **Mitigation:** WASM fallback + documented perf delta.
6. **Determinism:** WebGPU int4 numeric variance. **Mitigation:** TEST_MODE CPU/WASM for QA.
7. **Prompt injection:** user text may try to force SAFE; model-level limitation, no rule engine allowed. **Mitigation:** fixed template; documented as accepted.
8. **Ground-truth subjectivity:** sensitive-vs-benign labeling is subjective. **Mitigation:** explicit rubric + dual-annotation on a subset.
9. **Local-only claim nuance:** one-time model download is network traffic (not prompt egress). **Mitigation:** copy identical to system-design (download-once + cache, prompt never egresses); network trace proves no prompt egress.
10. **Clean-restart drift:** no legacy code to constrain; the Developer must not reintroduce AnyJev/second engine/regex — enforced by scope review at each phase.

## 8. Model evaluation gate (explicit)

- **Gates:** HIGH recall ≥ **0.85**; SAFE false-positive rate ≤ **0.20**; p50 latency ≤ **400 ms**; hard timeout ≤ **2 s**.
- **Coverage:** English, Arabic, mixed, RTL, benign, sensitive across categories; small but representative (~200–300 per language + ~100 mixed).
- **Configuration reported:** revision `v1.3`, hyperparameters, labels/template, EP.
- **Decision:** ship if pass; else record blocker + fallback (larger zero-shot or Laya 322M); **no fine-tuning / no training pipeline** in MVP. Fine-tuning only as a separate, explicitly-prerequisite phase if both fail.

## 9. Suggested commit boundaries

1. `chore: scaffold MV3 extension (WXT + TS + manifest + safe CSP)`
2. `feat(runtime): run multilingual-zeroshot-small on-device in offscreen worker`
3. `feat(model): classify contract + exact transformer API + latency instrumentation`
4. `feat(model): pinned revision + download-once cache + SHA-256 verify + disable remote`
5. `test(eval): English+Arabic eval set + metrics + evaluation-gate result`
6. `feat(messaging): typed classify protocol + background routing + shared inference host`
7. `feat(policy): deterministic tier→behavior + uncertainty/truncation/empty rules`
8. `feat(adapters): PlatformAdapter interface + registry + per-platform fixtures`
9. `feat(adapter): chatgpt`
10. `feat(adapter): claude`
11. `feat(adapter): gemini`
12. `feat(ui): warn/confirm/block overlay (a11y + shadow isolation)`
13. `feat(settings): global + per-platform toggles`
14. `feat(error): fail-open with "analysis skipped" notice`
15. `test(int): 4-tier × 3-platform matrix + concurrency`
16. `test(privacy): network trace — zero prompt egress`
17. `docs: final evaluation-gate decision + release notes`
18. `chore: release v0.1.0 (Chrome + Edge)`

## Assumptions (explicit)

- Build tool: **WXT** (fallback Vite+CRXJS if offscreen/worker packaging fails in P1).
- Platform origins: chatgpt.com + chat.openai.com, claude.ai, gemini.google.com.
- Offscreen reason: `WORKERS`; CSP includes `'wasm-unsafe-eval'`.
- Model config default: revision `v1.3`, per-label hypotheses as in P2 (tune in P3).
- Eval set sizes are feasibility-scale, not production benchmark-scale.
- `chrome.storage.local` for settings; Cache API/IndexedDB for the model cache.
