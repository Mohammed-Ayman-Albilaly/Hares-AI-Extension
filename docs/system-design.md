Hares AI — MVP System Design
Doc status: Finalized for MVP build hand-off. Date: 2026-09-30 Applies to: Google Chrome + Microsoft Edge (Chromium). Manifest V3.

1. System Overview
Hares AI is a Manifest V3 (MV3) browser extension that prevents the accidental disclosure of sensitive information when a user sends a prompt to an AI platform. It targets the specific failure moment between "draft" and "send" — a single careless click that cannot be recalled.

The product bet is that a small, fully local decision model can give a real-time signal by classifying each outgoing prompt into one of four risk tiers, with no prompt ever leaving the device for analysis.

Primary goal of the MVP (feasibility validation): determine whether a small local decision model can run inside a browser extension and produce useful multilingual (English + Arabic) risk classification that users can act on, with no external analysis.

Supported platforms (MVP): ChatGPT, Claude, Gemini (web apps).

Out of scope by design: regex detection, deterministic secret detection, NER, a second detection/classification engine, the previous AnyJev / dual-level triage architecture, cloud/API inference, response scanning, redaction, and enterprise/admin functionality.

2. MVP Architecture
The extension has six on-device parts. Inference is fully local; the model is the sole analysis component.

#	Component	Responsibility
1	Per-platform content scripts (chatgpt.ts, claude.ts, gemini.ts)	Intercept the send action, extract the prompt, prevent default send, render the Hares overlay, re-fire the send when allowed/confirmed.
2	Background service worker	Thin orchestrator: holds settings, routes classification requests, applies the tier→behavior policy and fail-open rule, returns the decision. Does not run heavy inference.
3	Offscreen document → Web Worker	The inference host. chrome.offscreen gives an invisible extension page with real DOM/window so the worker can survive service-worker suspension; it runs onnxruntime-web (WebGPU primary, WASM SIMD fallback). One shared model instance for all tabs.
4	Local model artifact	Quantized ONNX of a zero-shot multilingual classifier (see §5). Shipped as an extension resource, or downloaded once and cached. Verified against a pinned revision and SHA-256 checksum.
5	Settings + cache	chrome.storage for global on/off and per-platform toggles; Cache API / IndexedDB for the model artifact.
6	Overlay UI	Extension-rendered warning / confirm / block surfaces, accessibility-correct.
No part of the prompt is transmitted to any server; the prompt only travels over chrome.runtime IPC between extension contexts.

3. Core Flow
Prompt → Send Interception → Local Model → Risk Level → Policy/UI
Prompt → Send Interception → Local Model → Risk Level → Policy/UI
┌────────────────────────────┼────────────────────────────┐
SAFE MEDIUM HIGH
(auto-send) (require confirm) (block)
User writes a prompt in the platform composer.
User triggers send (button click, or Enter / Cmd+Enter).
The content script captures the send event (capture phase) and calls preventDefault() — the send is held.
The content script extracts the prompt text and sends classify(prompt) to the background.
The background forwards to the offscreen worker, which runs the local model.
The model returns labels + scores (SAFE / LOW / MEDIUM / HIGH with confidence).
The background maps the result to a risk tier and applies the decision policy.
The content script enforces the behavior and either re-fires the send or shows the appropriate UI.
Interception mechanism (high level)
MV3 consumer extensions cannot reliably block the outgoing network request (chrome.webRequest blocking is restricted to policy-installed extensions). Interception is therefore DOM/UI-level:

Capture-phase listener on the send button click and on keydown for Enter / Cmd+Enter.
On intercept → preventDefault() → extract prompt → classify → hold send.
For SAFE / LOW / confirmed-MEDIUM → re-fire the send by re-dispatching a synthetic click (or re-focusing the composer and dispatching Enter).
Each platform adapter uses multiple selector/fallback strategies for the send control and composer, because the platforms change their DOM frequently.
Mermaid
sequenceDiagram
  actor U as User
  participant P as Platform web app
  participant CS as Content Script
  participant BG as Background SW
  participant OFF as Offscreen Worker (ONNX)
  participant M as Zero-shot classifier

  U->>P: type prompt
  U->>P: trigger send (click / Enter)
  P->>CS: send event (capture phase)
  CS->>CS: preventDefault + extract prompt
  CS->>BG: classify(prompt)
  alt Platform disabled
    BG-->>CS: release (no analysis)
    CS->>P: send proceeds
  else Platform enabled
    BG->>OFF: classify(prompt)
    OFF->>M: tokenize + score 4 hypotheses (batched)
    M-->>OFF: entailment scores
    OFF-->>BG: {labels, scores, top, top_score, uncertain}
    alt Model OK
      BG->>BG: map top/score to tier + confidence policy
    else Model error / timeout / unavailable
      BG->>BG: fail-open -> "analysis skipped" notice
    end
    BG-->>CS: decision {tier, conf, policy}
    alt SAFE
      CS->>P: re-fire send (no warning)
    else LOW
      CS->>CS: show transient warning
      CS->>P: re-fire send
    else MEDIUM
      CS->>CS: show confirm dialog
      U->>CS: confirm
      CS->>P: re-fire send
    else HIGH
      CS->>CS: show block dialog (no send)
    end
  end
4. Risk Decision Behavior
The model returns exactly one tier per prompt ↓ one behavior. Mapping is deterministic and controlled.

Tier	Behavior	UI
SAFE	Allow the message to be sent automatically.	No warning.
LOW	Show a non-blocking warning, then allow the send automatically.	Transient notice; send proceeds without delay.
MEDIUM	Show a warning and require explicit user confirmation.	Confirm dialog; send only after explicit confirm; cancel/dismiss aborts the send.
HIGH	Show a warning and block the send.	Block dialog; message is not sent.
Confidence / uncertainty policy (applied to the model's own scores — not a second engine):

top label (argmax) → tier.
uncertain if top_score < threshold (e.g., 0.40) → escalate to MEDIUM (require confirmation). Default is conservative but not blocking.
Empty / whitespace prompt → SAFE (nothing to leak).
Over context budget → classify a bounded prefix, mark truncation, and escalate to MEDIUM.
5. Model Architecture / Model Selection
Selected model for MVP
Horizon-Labs/multilingual-zeroshot-small (Hugging Face)

Attribute	Value
Architecture	ModernBERT / mmBERT-small encoder, sequence-classification (NLI-style) head
Parameters	141M
License	Apache-2.0 (commercially clean training data only)
Languages	30+ incl. Arabic (ar) and English (en) — text can be Arabic; labels/template stay English
Browser	ONNX included for CPU + browser, transformers.js/onnxruntime-web compatible
Context	8k-token window (tuned to 1,024)
Training needed	None — it is a ready-made zero-shot classifier
Interface	Supply candidate labels at request time; it scores entailment per label in a single batched forward pass → returns labels + scores
This is a ready-made zero-shot model — بدون fine-tuning في الـMVP. It is a single-forward-pass, non-autoregressive, candidate-scoring decision model, which preserves the "small local decision model + single analysis component" concept (a Jev-style analog, not the MacJev/Laya lineage).

Why not MacJev-322M-4K-Laya
chaoliangUNSW/MacJev-322M-4K-Laya (Apache-2.0, mmBERT-base 307M + 15M decision head, 4096-token input) is a fine-tune of Laya multilingual. It is:

English + Chinese only — does not satisfy the binding Arabic requirement.
A general decision model, not a sensitive-data risk classifier.
It remains a valid architecture / browser-feasibility reference (the same family already ships browser ONNX: killkli/open-jev-laya-multilingual-onnx, fp16 ~647 MB, Apache-2.0), but it is not the final MVP model.

The Arabic Jev model (atmaneayoub/jev-ar) is CC BY-NC 4.0 (non-commercial) and is an intent router, not a risk classifier → not usable commercially.

Model contract
The extension calls the model via zero-shot classification:

Plain text
classify(prompt):
  text = prompt
  candidate_labels = [
    { id: "safe",   hyp: "This prompt contains no sensitive information." },
    { id: "low",    hyp: "This prompt contains a small amount of personal or sensitive information." },
    { id: "medium", hyp: "This prompt contains sensitive personal or private information." },
    { id: "high",   hyp: "This prompt contains highly sensitive information such as credentials, national IDs, financial or health records, or internal secrets." }
  ]
  hypothesis_template = "The content of this prompt: {}. This example is {}."
  multi_class = false

returns:
  { labels: ["medium","low","high","safe"], scores: [0.42,0.31,0.20,0.07],
    top: "medium", top_score: 0.42, input_tokens: 312, latency_ms: 180, uncertain: false }
Fallback strategy if evaluation fails (fallback strategy إذا فشل التقييم)
Because Arabic is a binding requirement and the model card gives no sensitive-data-risk accuracy (only topic/intent), the MVP cannot be approved by declaration. It is gated by a mandatory English + Arabic evaluation set. The decision tree:

Run the Option-1 model on the en+ar eval set. If it clears a modest "useful, not perfect" bar (e.g., HIGH recall ≥ 0.85, SAFE false-positive ≤ 0.20) → ship, no fine-tuning.
If Arabic is too weak (the published Arabic mean is ~0.554, the model's weakest language) → swap to a larger ready-made zero-shot model or convaiinnovations/laya-multilingual (Apache-2.0, 322M, browser ONNX already published, 100+ languages, true Jev-style). Still no fine-tuning.
Only if both fail → fine-tune Laya multilingual on the same eval set (which becomes training data). Treat this as a separate prerequisite phase (not part of the MVP build) and state: why no existing model sufficed, minimum dataset size, training infrastructure, and the added ML engineering.
6. Browser Runtime Architecture
Host: chrome.offscreen document (Chromium-only) that spawns a dedicated Web Worker. The worker runs onnxruntime-web (WebGPU back-end preferred, WASM SIMD fallback) through transformers.js.

Component	Role
Content Script	Runs in the page's isolated world; intercepts send; extracts prompt; renders overlay; re-fires send.
Background Service Worker	Orchestrates and enforces policy. MV3 SWs are suspended on idle and do not reliably offer WebGPU, so it never runs inference.
Offscreen Document	Invisible extension page created with chrome.offscreen; provides a persistent DOM/window to host the large model and long-running work.
Web Worker	Owns the ONNX model and performs inference, keeping the extension page/host page responsive.
ONNX Runtime Web / Transformers.js	The inference engine. WebGPU EP (int4 weights) for speed; WASM SIMD fallback for unsupported devices. MV3's default CSP permits wasm-unsafe-eval (verified at build).
Why not the service worker or content script for inference: the service worker is terminated on idle and lacks reliable WebGPU; running the model in the content script would duplicate a large model per tab and burden the host page. The offscreen worker is a single shared instance.

Mermaid
flowchart TD
  subgraph Device["User Device (local-only)"]
    subgraph Browser["Chromium Browser (Chrome / Edge)"]
      subgraph Platform["AI Web Apps (untrusted)"]
        CH["ChatGPT"]
        CL["Claude"]
        GE["Gemini"]
      end
      subgraph Ext["Hares AI Extension (MV3)"]
        CS["Content Scripts<br/>chatgpt.ts / claude.ts / gemini.ts"]
        UI["Overlay UI<br/>warn / confirm / block"]
        BG["Background Service Worker<br/>orchestrator + tier policy + settings"]
        OFF["Offscreen Document -> Web Worker<br/>onnxruntime-web (WebGPU / WASM)"]
        ST["chrome.storage + Cache/IDB<br/>settings + model cache"]
      end
    end
    ART["Model artifact<br/>zero-shot multilingual classifier ONNX<br/>(141M, Apache-2.0, pinned + SHA-256)"]
  end

  CH <-->|"send action + prompt"| CS
  CL <-->|"send action + prompt"| CS
  GE <-->|"send action + prompt"| CS
  CS -->|"intercept send"| UI
  CS -->|"classify(prompt)"| BG
  BG -->|"classify(prompt)"| OFF
  OFF <-->|"load once, verify SHA-256"| ART
  OFF -->|"labels + scores + conf"| BG
  BG -->|"decision {tier, conf, policy}"| CS
  CS -->|"allow / confirm / block"| UI
  UI -.->|"re-fire send (SAFE / LOW / MEDIUM confirm)"| CS
  CS -->|"trigger send"| CH
  CS -->|"trigger send"| CL
  CS -->|"trigger send"| GE
  BG -.->|"settings"| ST
  BG -.->|"model cache"| ST
7. Local-Only & Privacy Architecture
No prompt egress. The prompt travels only content script → background → offscreen worker and back, all via chrome.runtime IPC. No fetch/XHR to any origin carries prompt text.
Verified via network trace (dev/test) that analysis produces zero prompt-carrying outbound requests.
Trust boundary: the host AI page is untrusted. The Hares overlay is rendered in the extension's isolated world, not the page's, so the page cannot spoof it.
Prompt injection resilience: the classification instruction uses a fixed, non-user-influenced template with the prompt as state; note that prompt-injection robustness is a model-level property and a known limitation (not mitigated by a rule engine — none may be added).
Data minimization: the extension reads the prompt only at the moment of send; it does not persist a copy unless classification history is later enabled (future work).
Model provenance: the model is a third-party artifact. Pin the exact HF revision; do not rely on mutable "latest" references.
Determinism: QA/test mode forces a single-threaded CPU/WASM execution provider (disables WebGPU) so the same prompt yields a reproducible tier, since WebGPU int4 can introduce small numeric variance.
8. Model Loading / Caching / Integrity
Download-once + local cache. The model may be downloaded during installation/first setup; thereafter it is stored locally and inference runs entirely on-device Alert.
Do not bundle the full model in the extension package unless technically necessary (bundling increases install/update size significantly).
Integrity: verify the downloaded artifact against a pinned revision and a SHA-256 checksum before use; reject and re-download on mismatch. (Authors such as MacJev/Laya already publish manifest.json checksums — reuse that pattern.)
Store the model in the Cache API / IndexedDB (allows hundreds of MB), not chrome.storage.sync (limited quota).
Runtime model loading is disabled for remote URLs in production — the model is only ever loaded from local, verified storage.
The model does not need to be in web_accessible_resources; keep model and runtime assets non-accessible to the host page.
9. Failure Handling
Model-unavailable policy — Fail-open
If the local model is unavailable, crashes, or exceeds the inference timeout:

Show a clear "Analysis skipped — model unavailable" notice.
Allow the prompt to be sent.
Do not add a configurable fail-open/fail-closed setting in the MVP.
Why fail-open: the tool is an assistive guard, not a DLP enforcement layer. Blocking legitimate sends when the classifier is broken would be more destructive than skipping analysis and would drive uninstalls. The architecture is left extensible so fail-closed (and a user toggle) can be added without re-architecting.

Handling details:

Loading / cold start: show a non-blocking "Analyzing…" affordance; warm the model on install/first run.
Timeout: hard cap on inference (default ~2 s); over budget → fail-open path.
Retry: one retry on a transient inference error, then degrade to fail-open.
Over-budget / empty prompt: empty/whitespace → SAFE; over context budget → truncate + escalate to MEDIUM.
No queues and no dead-letter handling (single synchronous decision path; no external dependency in the happy path).
10. Browser Scope
MVP supported browsers:

Google Chrome
Microsoft Edge
Both are Chromium-based, providing full support for chrome.offscreen, WebGPU, and MV3's wasm-unsafe-eval CSP default.

Explicitly excluded from the MVP:

Firefox — MV3 differs; chrome.offscreen and WebGPU support are not equivalent.
Safari — MV3/runtime differences; not in scope.
Treat Firefox/Safari as future work; the architecture (platform adapters + a swappable inference host) should not preclude adding them later, but they are not MVP targets.

11. Performance & Evaluation Gates
Latency
Target: p50 ≤ ~400 ms, p95 ≤ ~800 ms on WebGPU for short prompts; hard cap ~2 s (then fail-open).
WASM fallback is slower (est. ~1–2 s) — tolerated only where WebGPU is unavailable; this is why supported browsers are narrowed to Chromium and why a measurable cap matters.
Classification must not freeze the host page (run in the worker).
Accuracy / evaluation gates (binding)
Build a labeled English + Arabic sensitive-data risk evaluation set: English, Arabic, mixed English/Arabic, RTL text, multiple sensitive-data categories, and normal non-sensitive prompts (~200–500 labeled examples per language).
Gate bar ("useful, not perfect"): HIGH recall ≥ ~0.85 and SAFE false-positive rate ≤ ~0.20 (adjust to the PM/BA's agreed numbers).
Decision gate: ship Option-1 model if it clears the bar; else apply the §5 fallback tree (bigger zero-shot or Laya multilingual, then fine-tuning only if both fail).
Do not declare the model Arabic-capable from its model card alone; require actual evaluation evidence.
12. Security Considerations
Least privilege: scope host permissions to the three platform origins only; use chrome.storage, chrome.offscreen, chrome.scripting. Avoid <all_urls>, webRequest, debugger.
No prompt exfiltration: model and runtime must not make network calls; runtime remote model loading is disabled; model assets are not in web_accessible_resources.
License hygiene: ship only models that are Apache-2.0 (or otherwise commercially usable). jev-ar (CC BY-NC) and similar are disqualified.
Supply chain: pin model revisions and verify checksums; keep an audit trail of the exact artifact used.
Prompt injection: treat prompt text as untrusted; use a fixed instruction template. A malicious prompt must not be able to force a SAFE verdict (a known, documented model-level limitation).
Not a guarantee: the tool reduces, not eliminates, risk. UI and copy must not imply a DLP/guarantee.
Accessibility: warn/confirm/block surfaces must be keyboard-operable, screen-reader readable, with sufficient contrast and clear focus (WCAG 2.2 AA).
13. MVP Exclusions
The MVP explicitly does not include and must not reintroduce:

Regex detection.
Deterministic secret detection (e.g., Luhn/SSN patterns).
NER (named-entity recognition / entity-span extraction).
A second detection/classification engine — the selected model is the only analysis component.
AnyJev / the previous dual-level triage architecture.
Cloud / API inference — inference is fully local.
Response scanning (analyzing AI responses).
Redaction / auto-masking of sensitive content.
Enterprise / centralized admin or network DLP policy enforcement.
Mobile app support.
Cross-device settings sync.
AI platforms beyond ChatGPT, Claude, Gemini.
Model training / fine-tuning in-browser (offline fine-tuning, if ever needed, is a separate phase).
14. Architecture Decisions / Constraints
Decision	Status	Rationale
Local-only definition	Download-once + local cache; inference fully on-device; prompt never egresses; pinned revision + SHA-256.	Preserves the privacy claim while avoiding a bloated extension package.
Model	Horizon-Labs/multilingual-zeroshot-small (141M, Apache-2.0), ready-made zero-shot, no fine-tuning in MVP (بدون fine-tuning في الـMVP).	Smallest path that ships without an ML training pipeline and is commercially clean.
Fallback	Bigger zero-shot or Laya multilingual (322M) if eval fails; fine-tuning only as a last, separate phase.	Keeps fine-tuning from becoming an assumed MVP requirement.
Failure policy	Fail-open with a visible "analysis skipped" notice; no toggle yet.	Not a DLP layer; blocking when broken is more harmful than skipping. Extensible to fail-closed.
Supported browsers	Chrome + Edge (Chromium) only.	Offscreen + WebGPU are Chromium-only.
Tier behavior	SAFE auto-send · LOW warn-then-send · MEDIUM require confirm · HIGH block.	Minimal friction; one tier ↔ one behavior.
Inference host	Offscreen document → dedicated Web Worker using ONNX Runtime Web / Transformers.js.	Survives SW suspension; single shared model; keeps host pages responsive.
Interception	DOM/UI-level (capture-phase click + Enter/Cmd+Enter) with per-platform adapters + re-fire send.	MV3 consumer extensions cannot reliably block the network request.
Determinism	Test mode forces CPU/WASM EP.	Same prompt → same tier, for reproducible QA (NR-4).
Constraint summary (bounding the whole design)
English + Arabic is a binding, first-class requirement, measured by evaluation evidence, not by model-card claims.
Jev is the first and only prompt-analysis component.
Prompt analysis is local-only; no prompt content is transmitted for analysis.
Keep the MVP as small as possible; the goal is to validate feasibility and usefulness of a small local decision model inside a browser extension.