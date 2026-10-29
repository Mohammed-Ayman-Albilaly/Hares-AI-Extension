# Hares AI — Browser Extension

Hares AI stops sensitive data from being sent to AI chat platforms by accident. It checks your message **before** it is sent to ChatGPT, Claude or Gemini, finds sensitive data (passwords, API keys, card numbers, national IDs, emails, names, addresses…), and offers a **revised** version where that data is replaced by placeholders such as `[EMAIL_1]` or `[PASSWORD_1]`.

Everything runs **on your device**. Your messages are never sent to any server by the extension.

> Graduation project (SWE 496, CCIS, KSU). This repository contains the **browser extension** only. The admin platform (backend + dashboards) is a separate part of the system.

---

## Contents

1. [What it does](#what-it-does)
2. [Install it (for testers)](#install-it-for-testers)
3. [Use it](#use-it)
4. [Try it: test messages](#try-it-test-messages)
5. [Privacy](#privacy)
6. [Troubleshooting](#troubleshooting)
7. [For developers](#for-developers)
8. [Project status and known limitations](#project-status-and-known-limitations)
9. [Documentation](#documentation)

---

## What it does

| Your message contains | What happens |
|---|---|
| Nothing sensitive | Sent normally. You see nothing |
| A sensitive word but no value ("my password reset link") — **LOW** | Sent, with a small notice in the corner that fades away |
| Personal or contact data (email, phone, name, address…) — **MEDIUM** | A dialog asks you to choose: **Confirm** (send as written), **Send revised** (send with placeholders) or **Edit** |
| Secrets or identity/financial data (password, API key, card, national ID, IBAN…) — **HIGH** | Blocked. You can only **Send revised** or **Edit** — the original cannot be sent |

**How detection works**

```
You press Enter or Send
  → 1. Rules (≈60 patterns, English + Arabic, with checksum validation)       < 10 ms
  → 2. Detection model (names, addresses, usernames), running in the browser  ~100–270 ms
  → 3. Sensitive values replaced by placeholders ([EMAIL_1], [PERSON_1]…)
  → 4. Decision: SAFE / LOW / MEDIUM / HIGH → send, notice, or dialog
```

- **Arabic and English**, including Gulf dialect (`الباسورد حقي :`) and Arabic digits (`١٠٨٧٦٥٤٣٢١`).
- **Conversations:** a value split across two messages ("my password is" … next message "Hunter2!") is still caught, and the same value keeps the same placeholder for the whole chat.
- **Department policies:** an organisation can change levels per data type, switch patterns off and add its own keywords (see [docs/policy.md](docs/policy.md)).

---

## Install it (for testers)

The extension is not in the Chrome Web Store yet. You load it in **Developer mode**.

### Requirements

- **Google Chrome 116+** or **Microsoft Edge 116+** on a computer (not mobile).
- **Node.js 20 or newer** ([download](https://nodejs.org)) and **Git**, to build it.
- About **300 MB** of free disk space and an internet connection for the first run (the detection model is downloaded once).

### Step 1 — Get the code and build it

```bash
git clone https://github.com/Mohammed-Ayman-Albilaly/Hares-AI-Extension.git
cd Hares-AI-Extension
npm install
npm run build
```

This creates the folder `.output/chrome-mv3`. (For Edge you can use the same folder.)

> If someone already gave you a built **`.zip`** of the extension, skip this step: unzip it into a folder and use that folder in Step 2.

### Step 2 — Load it in the browser

1. Open **`chrome://extensions`** (Edge: **`edge://extensions`**).
2. Turn on **Developer mode** (top-right in Chrome, left side in Edge).
3. Click **Load unpacked**.
4. Choose the **`.output/chrome-mv3`** folder inside the project.
5. **Hares AI** appears in the list. Pin it from the puzzle-piece icon if you like.

### Step 3 — Wait for the detection model (first time only)

Right after installing, the extension downloads its detection model (**268 MB**, once). It takes about **1 minute** on a normal connection. Until it finishes, messages are still protected by the rules; names and addresses are detected once the model is ready.

To check it finished:

1. In `chrome://extensions`, on the Hares AI card, click **`offscreen.html`** (under "Inspect views").
2. Open the **Console** tab.
3. Wait for: `[hares] detection model ready in … ms`.

After that, the model loads from your disk in a few seconds every time the browser starts.

### Step 4 — Open an AI platform

Open (or **refresh**, if already open) **chatgpt.com**, **claude.ai** or **gemini.google.com**, sign in as usual, and start typing.

### Step 5 — Sign in to your organisation (optional)

Click the **Hares AI** icon in the toolbar and sign in with your Hares AI account. Your organisation's policy is then applied and each checked message is reported to the platform (without its text). Without signing in, the extension protects you with its built-in policy and reports nothing.

By default the extension talks to the development API at `http://localhost:3000/api`. To build for another server, set `WXT_API_BASE_URL` first, for example `WXT_API_BASE_URL=https://api.example.com/api npm run build` (PowerShell: `$env:WXT_API_BASE_URL = "..."; npm run build`). Details: [docs/backend-integration.md](docs/backend-integration.md).

### Updating to a newer version

```bash
git pull
npm install
npm run build
```

Then press **↻ (Reload)** on the Hares AI card in `chrome://extensions` and refresh the AI platform tabs.

---

## Use it

Type and send as you normally do — with **Enter** or the send button.

**In the dialog (MEDIUM / HIGH):**

| Key | Action |
|---|---|
| **← / →** (or Tab) | Move between the buttons |
| **Enter** | Press the selected button (the filled one) |
| **Esc** | Close and go back to editing — nothing is sent |

- The dialog lists what was found (type + placeholder) and shows the **revised message** with placeholders highlighted.
- **Send revised** replaces your text in the platform's box and sends it. If a site does not accept the replacement, the revised text is **copied** instead — paste it with **Ctrl+V** and send.
- The default button is **Send revised**, so pressing Enter by habit never sends the original.
- A small **"Hares AI: checking…"** may appear for a moment while the model reads a long message.

---

## Try it: test messages

Use **fake data only**. The values below are synthetic.

| Type this | Expected |
|---|---|
| `What is the capital of France?` | Sent normally |
| `This document is confidential, summarize it` | Sent + small notice |
| `Please reply to sara@example.com` | MEDIUM dialog → revised: `Please reply to [EMAIL_1]` |
| `Please send the contract to Sarah Mitchell` | MEDIUM → `[PERSON_1]` |
| `اكتب خطاب توصية لزميلي فهد الدوسري` | MEDIUM → `[PERSON_1]` |
| `my password is Hunter2! and key sk-proj-abcdEFGH1234ijklMNOP5678` | HIGH → `[PASSWORD_1]`, `[API_KEY_1]` |
| `رقم الهوية ١٠٨٧٦٥٤٣٢١` | HIGH → `[NATIONAL_ID_1]` |
| Send `الباسورد حقي :` then, as a second message, `محمد_الو_تراها_ماهي_بيانات_سرية` | LOW, then HIGH "continues previous message" |

The full checklist (English, Arabic and multi-message conversations) is in **[docs/testing/manual-tests.md](docs/testing/manual-tests.md)**.

---

## Privacy

- **Your messages stay on your device.** Detection runs inside the browser (in the page and in an extension worker).
- **Network traffic** is limited to two things: downloading the detection model from Hugging Face (`huggingface.co`, `*.hf.co`) the first time, and, only if you sign in, talking to the Hares AI platform API (sign-in, policy, activity log). No message text is included in any request.
- **The placeholder memory** (which `[EMAIL_1]` is which email) lives only in the open tab's memory and disappears when you close it.
- **Activity log:** while you are signed in, each checked message produces a log entry **without the text**: risk level, action, the categories of data found (such as `CONTACT_INFO`), platform, your choice, the rule that matched (if any) and the time. Entries wait in the extension (`chrome.storage.local`, at most 500) and are sent to the platform. If you are not signed in, nothing is recorded.
- **Sign-in:** your password is sent once to sign in and is never stored. The extension keeps session tokens only.
- **Permissions:** `storage` (settings, session and the log queue), `offscreen` (runs the model in the background), `alarms` (checks the policy every 5 minutes), and access only to the three AI platforms, Hugging Face for the model download, and the platform API.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| No dialog appears at all | Refresh the AI platform tab after installing or reloading the extension. Check the extension is enabled in `chrome://extensions` |
| `detection model failed to load: Failed to fetch` in the offscreen console | The download was interrupted or blocked. The extension retries automatically (15 s, 1 min, 5 min, then every 15 min). If it keeps failing, open `https://huggingface.co/Horizon-Labs/pii-redactor-small/resolve/main/config.json` in the same browser — if that page does not load, a VPN, proxy, antivirus or network policy is blocking Hugging Face |
| Names are not detected, but emails/passwords are | The model is still downloading (see Step 3). Rules work meanwhile |
| "Revised message copied" notice | The site did not accept the automatic replacement. Paste with **Ctrl+V** and send. Please report which site |
| "Wrong email or password", or the account is waiting for approval | Use the account from your administrator. A new account must be approved first |
| Popup says "Cannot reach the Hares AI server" | The API URL of this build is wrong or the server is down (see Step 5). Protection with the built-in policy continues |
| The popup shows events waiting to upload | They are sent automatically when the server is reachable (within a minute). While your department is inactive, uploads pause and protection continues |
| A platform changed its design and sending is not intercepted | Report it with the lines starting with `[hares]` from that tab's Console (F12) |

When reporting a problem, include: browser and version, which site, the exact test message (fake data), what you expected, and what happened.

---

## For developers

### Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Dev build with auto-reload in a test browser |
| `npm run build` / `npm run build:edge` | Production build → `.output/chrome-mv3` / `.output/edge-mv3` |
| `npm run zip` | Build a `.zip` to share with testers |
| `npm test` | Unit and scenario tests (rules, masking, decisions, policies, conversations) |
| `npm run eval` | Detection-model evaluation on `tests/fixtures/ner-cases.json` (downloads the model, slow) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint checks |

### Project structure

```
entrypoints/        Extension entry points: content scripts (chatgpt, claude, gemini),
                    background service worker, offscreen document
worker/             Web Worker hosting the local models (ONNX Runtime / Transformers.js)
src/adapters/       Per-site selectors + replacing text in each site's editor
src/interceptor/    Catches the send, runs the analysis, prevents loops
src/detectors/      Rules: patterns, validators (Luhn, IBAN, Saudi ID…), categories and tiers
src/ner/            Detection model: running it, offsets, label mapping
src/masking/        Placeholder vault ([EMAIL_1] ↔ value)
src/pipeline/       Analysis pipeline and per-conversation state
src/policy/         Decision table, department policies, user exceptions
src/ui/             Dialog and notices (shadow DOM)
src/logging/        Activity log events (no prompt text)
tests/              Unit tests and fixtures (English, Arabic, conversations, model cases)
eval/               Model evaluation scripts and saved results
docs/               Design, requirements, coverage, policy and testing docs
```

### Adding a test case

Add it to `tests/fixtures/prompts-en.json`, `prompts-ar.json` or `conversations.json`, run `npm test`, then regenerate the manual checklist:

```bash
node scripts/gen-manual-tests.mjs
```

---

## Project status and known limitations

| Phase | Status |
|---|---|
| 1. Rules, dialog, revised send, conversations (ChatGPT) | ✅ Done |
| 2. Claude and Gemini | ✅ Done |
| 3. Detection model (names, addresses) | ✅ Done |
| — Department policies and user exceptions | ✅ Done (no settings screen yet) |
| 4. Decision model (sensitive *context* with no specific value, e.g. unreleased deal terms) | ⏳ Next |
| 5. Fixes from testing, wider evaluation, docs | ⏳ |
| Platform integration (sign-in, policy sync, sending logs) | ✅ Built; tested against a mocked API, joint test with the platform pending |

**Known limitations**

- Only **typed text** is checked — not uploaded files or images.
- Sensitive **context** without a concrete value ("our unreleased merger terms") is not detected until Phase 4.
- A 4-part version number (`1.2.3.4`) is flagged as an IP address; every URL counts as MEDIUM.
- Deliberate evasion (spacing out digits, base64, splitting across many messages) is out of scope.
- The detection model's Arabic results come from a small test set (41 cases); a wider evaluation is planned.
- Placeholder numbers do not restart in a new chat (e.g. the first phone number in a second chat can be `[PHONE_2]`). Meaning is unaffected; fix planned for Phase 5.
- User exceptions have no settings screen yet; the organisation's policy does not offer them (see [docs/policy.md](docs/policy.md)).
- TOPIC rules from the platform are not enforced.

---

## Documentation

| Document | Content |
|---|---|
| [docs/coverage-and-models.md](docs/coverage-and-models.md) | What is detected today, what each model adds, model details and measurements (Arabic) |
| [docs/policy.md](docs/policy.md) | Policy shape, user exceptions and the log event fields (for the platform team) |
| [docs/backend-integration.md](docs/backend-integration.md) | How the extension uses the platform API: sign-in, policy bundle, events, joint test steps |
| [docs/testing/manual-tests.md](docs/testing/manual-tests.md) | Manual test checklist |
| [docs/requirements-mvp.md](docs/requirements-mvp.md) | Requirements |
| [docs/system-design.md](docs/system-design.md) | System design |
| [docs/Hares AI.pdf](docs/Hares%20AI.pdf) | Full project document (extension + platform) |
