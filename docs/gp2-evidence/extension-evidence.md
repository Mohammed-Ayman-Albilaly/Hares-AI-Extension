# Extension evidence for the GP2 report

Answers to `report-for-extension-agent.md`, sections E1 to E10.

- **Code under test:** commit `3cb1f381b6269b3e82b2b76e81276da5e9717d69` (`main`, 2026-11-24). The evaluation scripts and this folder were added on top of it on the branch `gp2-evidence`; they change no product code.
- **Machine for every local measurement:** Windows 11 Home, Intel Core i5-13420H (8 cores, 12 logical processors), 15.7 GB RAM, Node v26.13.0, Chrome 157.0.8103.80.
- **Data:** synthetic only.
- **Pending (owner)** marks work the project owner will do by hand later. It is a to-do list, not report content: do not copy it into the report. Each mark names an item (P1 to P10) of the block at the end of this file. When an item is done, its result goes into the section and the mark is deleted. Any item still listed at submission is a limitation.

## E1. Detection accuracy on a labelled set

**Not met as required:** rules plus model reach 90.8% finding recall, but the false positive rate on clean prompts is 15.2% (target: at most 10%). Details below.

Files: [accuracy/dataset-public.json](accuracy/dataset-public.json) (the set as committed), [../../eval/accuracy/build-dataset.mjs](../../eval/accuracy/build-dataset.mjs) (generator, fixed seed), [../../eval/accuracy.eval.ts](../../eval/accuracy.eval.ts) (script), [accuracy/results-rules-only.json](accuracy/results-rules-only.json), [accuracy/results-rules-and-model.json](accuracy/results-rules-and-model.json), [accuracy/run.txt](accuracy/run.txt). Produced on `3cb1f38`, 2026-11-25, Node, CPU.

### The set

| | Count |
|---|---|
| Prompts | 356 |
| With sensitive data | 251 |
| Clean | 105 (29.5%): 55 ordinary, 50 hard negatives |
| English / Arabic / mixed | 200 / 148 / 8 |
| Categories with at least 5 prompts | 22: the 21 that have patterns, plus LEGAL (model only) |
| Detection-model labels with at least 5 prompts | 22 of the 23 enabled (none written for SECRET) |

- The committed copy of the set leaves out the text of 58 prompts that carry a synthetic key, token, password or certificate: those values have the shape of real credentials and the repository host refuses a push that contains them. Their labels are kept. The full set is produced by `node eval/accuracy/build-dataset.mjs` (fixed seed, same file every time); its SHA-256 is recorded in the committed copy.
- A "finding" is a category in a prompt. Spans are not compared.
- Labels were written before the detector was run. One rule is applied mechanically: a prompt that uses a sensitive word (password, token, secret and so on) is also labelled KEYWORD.
- Expected risk is the highest built-in tier of the expected categories; a person's name alone is MEDIUM.
- The built-in policy is used, with no organisation rules. TOPIC rules are in E10.
- Organisation names are not measured: the ORGANIZATION label is switched off in the extension.
- Two mistakes in my own data were fixed after the first run, and the set was regenerated: Saudi IBANs were generated with 26 characters instead of 24 (so they were not valid IBANs), and one template mentioned `.npmrc` without being labelled as a file path. No detector code, threshold or expectation was changed.

### Results

| | Rules only | Rules + detection model |
|---|---|---|
| Finding precision | 93.5% | 87.6% |
| Finding recall | 84.2% | 90.8% |
| Finding F1 (micro / macro) | 0.886 / 0.867 | 0.892 / 0.882 |
| True / false / missed findings | 229 / 16 / 43 | 247 / 35 / 25 |
| Prompt-level risk accuracy | 84.8% (302 of 356) | 89.0% (317 of 356) |
| Risk rated too low / too high | 39 / 15 | 7 / 32 |
| Clean prompts flagged (false positive rate) | 12 of 105 = **11.4%** | 16 of 105 = **15.2%** |
| of which ordinary prompts | 0 of 55 | 0 of 55 |
| of which hard negatives | 12 of 50 | 16 of 50 |

Against the GP1 targets:

- **At least 90% accuracy for structured patterns.** On the 215 prompts whose value has a built-in pattern, the rules alone find every expected category in 208 (96.7%), with finding recall 97.0% and precision 98.3%. **Met for the rules.** With the model added, the same prompts drop to 93.0% (200 of 215), because the model relabels some values (student numbers as national IDs).
- **False positive rate at most 10%.** 11.4% with rules only and 15.2% with the model, on a clean set where almost half the prompts are hard negatives. **Not met.** On ordinary prompts the rate is 0%.

Risk confusion matrix, rows = expected, columns = predicted:

| Rules only | SAFE | LOW | MEDIUM | HIGH |
|---|---|---|---|---|
| SAFE | 93 | 0 | 12 | 0 |
| LOW | 0 | 6 | 0 | 0 |
| MEDIUM | 39 | 0 | 93 | 3 |
| HIGH | 0 | 0 | 0 | 110 |

| Rules + model | SAFE | LOW | MEDIUM | HIGH |
|---|---|---|---|---|
| SAFE | 89 | 0 | 12 | 4 |
| LOW | 0 | 6 | 0 | 0 |
| MEDIUM | 7 | 0 | 112 | 16 |
| HIGH | 0 | 0 | 0 | 110 |

No HIGH prompt was rated lower than HIGH in either configuration.

By language:

| | Prompts | Rules only: P / R / F1 | Risk acc. | Rules + model: P / R / F1 | Risk acc. | Clean flagged (rules / +model) |
|---|---|---|---|---|---|---|
| English | 200 | 94.5% / 86.3% / 0.902 | 86.0% | 91.4% / 93.1% / 0.923 | 91.5% | 6 / 7 of 53 |
| Arabic | 148 | 91.2% / 79.8% / 0.851 | 82.4% | 81.1% / 86.5% / 0.837 | 85.1% | 6 / 9 of 52 |
| Mixed | 8 | 100% / 100% / 1.0 | 100% | 100% / 100% / 1.0 | 100% | none in the set |

Per category (true / false / missed, then precision, recall, F1):

| Category | Rules only | | Rules + model | |
|---|---|---|---|---|
| ACCOUNT | 5 / 0 / 6 | 100% / 45.5% / 0.625 | 9 / 1 / 2 | 90.0% / 81.8% / 0.857 |
| AUTH_SECRET | 35 / 0 / 0 | 100% / 100% / 1.0 | 35 / 0 / 0 | 100% / 100% / 1.0 |
| CONTACT | 20 / 0 / 0 | 100% / 100% / 1.0 | 20 / 0 / 0 | 100% / 100% / 1.0 |
| CORPORATE | 6 / 0 / 6 | 100% / 50.0% / 0.667 | 12 / 1 / 0 | 92.3% / 100% / 0.960 |
| CRYPTO | 9 / 0 / 0 | 100% / 100% / 1.0 | 9 / 0 / 0 | 100% / 100% / 1.0 |
| DATETIME | 2 / 0 / 3 | 100% / 40.0% / 0.571 | 2 / 0 / 3 | 100% / 40.0% / 0.571 |
| DEV_SECRET | 14 / 0 / 0 | 100% / 100% / 1.0 | 14 / 0 / 0 | 100% / 100% / 1.0 |
| EDUCATION | 4 / 0 / 1 | 100% / 80.0% / 0.889 | 0 / 0 / 5 | none found |
| FILE_PATH | 9 / 0 / 0 | 100% / 100% / 1.0 | 9 / 0 / 0 | 100% / 100% / 1.0 |
| FINANCIAL | 24 / 3 / 0 | 88.9% / 100% / 0.941 | 24 / 3 / 0 | 88.9% / 100% / 0.941 |
| FINGERPRINT | 7 / 0 / 9 | 100% / 43.8% / 0.609 | 7 / 0 / 9 | 100% / 43.8% / 0.609 |
| HEALTH | 8 / 0 / 0 | 100% / 100% / 1.0 | 8 / 0 / 0 | 100% / 100% / 1.0 |
| KEYWORD | 19 / 0 / 0 | 100% / 100% / 1.0 | 19 / 0 / 0 | 100% / 100% / 1.0 |
| LEGAL | 0 / 0 / 6 | none found | 3 / 0 / 3 | 100% / 50.0% / 0.667 |
| LOCATION | 5 / 0 / 6 | 100% / 45.5% / 0.625 | 10 / 4 / 1 | 71.4% / 90.9% / 0.800 |
| LOGS | 5 / 0 / 0 | 100% / 100% / 1.0 | 5 / 0 / 0 | 100% / 100% / 1.0 |
| NETWORK | 15 / 2 / 0 | 88.2% / 100% / 0.938 | 15 / 2 / 0 | 88.2% / 100% / 0.938 |
| NUMERIC | 5 / 11 / 0 | 31.3% / 100% / 0.476 | 3 / 6 / 2 | 33.3% / 60.0% / 0.429 |
| PERSONAL_IDENTITY | 20 / 0 / 6 | 100% / 76.9% / 0.870 | 26 / 18 / 0 | 59.1% / 100% / 0.743 |
| SHIPPING | 5 / 0 / 0 | 100% / 100% / 1.0 | 5 / 0 / 0 | 100% / 100% / 1.0 |
| VEHICLE | 5 / 0 / 0 | 100% / 100% / 1.0 | 5 / 0 / 0 | 100% / 100% / 1.0 |
| WEB_LINK | 7 / 0 / 0 | 100% / 100% / 1.0 | 7 / 0 / 0 | 100% / 100% / 1.0 |

Types only the detection model can find (36 prompts: names, street addresses, usernames, tax IDs, device IDs, licence numbers): the rules find 0, rules plus model find the expected category in 26.

### The 20 most instructive failures (rules + model)

| # | Prompt id | What happened | Reason |
|---|---|---|---|
| 1 | en-161, ar-162, en-163 | An IMEI is reported as a card number, HIGH instead of MEDIUM | A 15-digit IMEI passes the same Luhn check as a card, and the card pattern wins the overlap over the `imei` pattern |
| 2 | en-184 to en-188 | A 9-digit student number is reported as a national ID (HIGH), and EDUCATION is never reported | The model tags the number NATIONAL_ID; a HIGH detection beats the MEDIUM `student-id` rule on overlap. The rules alone get 4 of 5 right |
| 3 | en-313, ar-338, ar-354 | "8000000000" and "141000000" are reported as a national ID (HIGH) in a clean prompt | The model tags any long round number NATIONAL_ID. Only 10-digit numbers starting with 1 or 2 are checksum-checked |
| 4 | ar-337 | The speed of light, 299792458, is a national ID (HIGH) in Arabic; in English (en-312) it is NUMERIC (MEDIUM) | Same cause, and the model is less stable on Arabic text |
| 5 | en-312, en-319, en-320, en-329 | Physical constants, digits of pi, an ISBN and a parameter count are flagged NUMERIC | The `long-number` rule flags any 9 or more digits, whatever the context. It accounts for 11 of the 16 false findings of the rules |
| 6 | en-309, ar-334 | Version numbers 1.2.3.4 and 1.2.3.5 are flagged as IP addresses | A four-part version number has the shape of an IPv4 address. Known gap, also a skipped unit test (E4) |
| 7 | en-316 | "Marie Curie" in a clean prompt is flagged as a person | The model cannot tell a public figure from a private person. "Albert Einstein", "ابن سينا" and "الخوارزمي" were not flagged |
| 8 | ar-347, ar-350, ar-356 | Arabic sentences with "997", "البوابة 14", "القاعة 2041" are flagged as a street address | The model reads a place word next to a number as an address in Arabic. No English equivalent was flagged |
| 9 | ar-116 | An Arabic firewall request is given an extra street-address finding next to the correct IP address | Same cause as 8 |
| 10 | en-174, en-178 | "date of birth, 22/8/1975" is not detected | The `date-of-birth` rule allows `:`, `=`, `is` or nothing between the keyword and the date, not a comma. The model did not tag it either |
| 11 | ar-177 | "تاريخ ميلاد المريض 15/10/1995" is not detected | A word sits between the keyword and the date |
| 12 | ar-170, ar-172 | Arabic "رقم العميل CUS-…" is reported as an ID number (HIGH) instead of an account ID (MEDIUM) | The model's DRIVER_LICENSE tag (shown as ID_NUMBER) beats the `account-id` rule on overlap. The English versions are correct |
| 13 | en-224, en-226 | A device ID "5F63-6T6S-AA96-J923" is not detected in English | No rule for device IDs, and the model's score stayed under 0.7 |
| 14 | ar-225, ar-227, ar-229 | The same device IDs in Arabic are reported as an ID number (HIGH) | The model tags them DRIVER_LICENSE in Arabic |
| 15 | en-228 | A serial number is reported as an account ID | Right tier (MEDIUM), wrong category |
| 16 | ar-231 | An Arabic medical licence number is not detected | No rule for licence numbers; the model missed it |
| 17 | ar-233, ar-235 | Arabic licence numbers are reported as an ID number (HIGH) instead of LEGAL (MEDIUM) | Same model confusion as 14 |
| 18 | en-189, ar-190 | An insurance policy number is reported as a national ID or a tax ID | The model picks a specific ID type for any long number |
| 19 | ar-209 | An Arabic street address is not detected | The model missed 1 of 6 addresses; the other five were found |
| 20 | (rules only) en-200 to ar-223 | Names, addresses, usernames and tax IDs are all missed without the model | There are no rules for them by design |

Pattern in the failures: the rules are precise but blind to names and free-form identifiers; the model adds recall and brings two costs, both stronger in Arabic: it relabels numbers as national IDs or ID numbers (raising MEDIUM prompts to HIGH), and it flags long numbers in clean text.

## E2. Performance in a real browser

Measured so far: timing of the whole check in Chrome on ChatGPT (six messages), model load from cache, analysis time by prompt size in Node, build size.

<!-- OWNER-TODO -->**Pending (owner):** P1, P2, P3, P4, P5.<!-- /OWNER-TODO -->

GP1 targets: detection within 200 ms, notification within 200 ms, memory at most 100 MB.

### Whole check in Chrome (send to result)

Chrome 157.0.8103.80, ChatGPT, 2026-11-24, commit `3cb1f38` minus the last change (see note), two TOPIC rules, both models warm. Cross-origin isolation **active**, **4 threads** (reported by the worker: `isolated=true threads=4 cores=12`). Times are the extension's own measurement of one check, in milliseconds.

| Message | Whole check | Policy check | Detection model | Topic model | Enter to dialog or notice |
|---|---|---|---|---|---|
| Layoffs with an email (first after page load) | 1699 | 856 | 440 | 637 | 1950 |
| Layoffs and bonuses | 1140 | 737 | 93 | 290 | 1180 |
| Short layoffs message | 140 | 32 | 46 | 91 | 173 |
| General salary question | 575 | 20 | 143 | 295 | 1300 (notice, after the send) |
| Coping with job loss | 599 | 488 | 84 | 106 | not shown (clean) |
| Layoffs in Arabic | 300 | 84 | 152 | 141 | 320 |

- Median of the six whole checks: 587 ms; maximum 1699 ms. **The 200 ms targets are not met** when the policy check or the models take part; one message of six was under 200 ms.
- Before isolation (single thread, same machine, same day): 2.0 to 3.3 seconds per message over five messages, and one message exceeded the then 4-second topic limit.
- Note: these runs were made on the experiment build (`experiment/wasm-threads`), which has everything in `3cb1f38` except that the topic model still waited for the policy check. <!-- OWNER-TODO -->**Pending (owner):** P5, the timing after that last change.<!-- /OWNER-TODO -->
- One further run started its check about 3 seconds after Enter. Cause not found; not repeated.

### Model load time

| Model | From cache | First load with download |
|---|---|---|
| Detection (`pii-redactor-small`, 268 MB) | 4654 ms | pending (P2) |
| Topic (`multilingual-zeroshot-small`, 268 MB) | 4826 ms | pending (P2) |

Read from the offscreen console on 2026-11-24, before isolation was switched on (one thread).

### Analysis time by prompt size (Node, not the browser)

[performance/node-timing.json](performance/node-timing.json), script [../../eval/perf.eval.ts](../../eval/perf.eval.ts), 50 runs per size, warm model, commit `3cb1f38`, 2026-11-25. The machine was not idle and the Node runtime is not the browser's, so the model figures are an upper indication only.

| Prompt size | Rules only: median / p95 / max | Rules + model: median / p95 / max | Runs over 2,500 ms |
|---|---|---|---|
| 100 characters | 0.33 / 8.8 / 37.5 ms | 378 / 698 / 835 ms | 0 of 50 |
| 1,000 characters | 0.88 / 5.0 / 5.7 ms | 2600 / 3789 / 4419 ms | 29 of 50 |
| 5,000 characters | 1.66 / 10.1 / 18.2 ms | 2088 / 13500 / 16938 ms | 21 of 50 |

- Rules only: well under 200 ms at every size. **Met for the rules.**
- With the model the target is not met in Node, and long prompts often pass the 2,500 ms limit, after which the extension goes on with the rules alone. <!-- OWNER-TODO -->**Pending (owner):** P3, the same measurement in the browser with several threads.<!-- /OWNER-TODO -->
- In the accuracy run (short prompts, quieter machine) the same code took 22 ms median, 89 ms p95, 483 ms max per prompt with the model.

### Size and memory

| | Value |
|---|---|
| Built extension, unpacked, without models | 22 MB (21 MB of it is the ONNX runtime `.wasm`) |
| Zip | 5.36 MB |
| Each model file (downloaded on first use, not in the package) | about 268 MB |
| Memory before load, after load, after 50 analyses | pending (P1) |

The 100 MB memory target is very unlikely to be met with a 268 MB model loaded. The procedure for every measurement is in [performance-procedure.md](performance-procedure.md).

## E3. Functional test on the real AI platforms

Run so far: part of the list, on ChatGPT. The full list is in [functional-tests.md](functional-tests.md).

<!-- OWNER-TODO -->**Pending (owner):** P6, P7.<!-- /OWNER-TODO -->

Supported today (host permissions and adapters): ChatGPT (`chatgpt.com`, `chat.openai.com`), Claude (`claude.ai`), Gemini (`gemini.google.com`). **Actually tested in this period: ChatGPT.**

Run on ChatGPT, Chrome 157.0.8103.80, 2026-11-24, signed in to the live platform (`hares-ai.vercel.app`) unless noted:

| Case | Result |
|---|---|
| SAFE prompt goes through untouched, by Enter | Pass |
| MEDIUM (email): dialog with Confirm, Send revised, Edit | Pass |
| MEDIUM: Send revised sends the placeholder, not the value | Pass (`[EMAIL_1]` was sent) |
| MEDIUM: Edit or Escape returns to the composer, nothing sent | Pass |
| TOPIC rule with WARN, English and Arabic prompt | Pass |
| TOPIC rule with ALLOW: sent with the quiet notice | Pass |
| TOPIC match together with a maskable value | Pass (both listed, Send revised offered) |
| Two TOPIC rules matching one message | Pass (both listed; Confirm and Edit; Edit selected) |
| TOPIC rule without an English description is skipped | Pass (not in the stored policy; the platform saw no event for it) |
| Arabic prompt | Pass |
| Policy bundle reaches the extension; re-checked every minute | Pass (`200 UPDATED`, then `304 UNCHANGED` in the service worker console) |
| Events reach the platform | Pass (platform side counted them: 11 WARNED on the layoffs rule, 4 ALLOWED on the salaries rule) |
| Model too slow: the message is checked without it | Pass as designed (seen with the topic model on the earlier build) |
| Logged-out state: protection with the stored policy, nothing reported | Pass (trial policy in storage, signed out) |

Right-to-left interface: not applicable. The extension's own texts are English only (see E8).

<!-- OWNER-TODO -->**Pending (owner):** P6 (LOW notice; HIGH with each choice; send button; paste; cross-message detection; placeholder stability across a conversation; detection-model timeout; a policy change reaching an open page, which is fixed and unit-tested but not re-run live; offline queue and later upload; custom PATTERN and KEYWORD rules from the platform) and P7 (every case on Claude and Gemini).<!-- /OWNER-TODO -->

## E4. The skipped tests

At `3cb1f38` (2026-11-25), `npx vitest run`: **25 test files, 372 tests: 366 passed, 6 skipped, 0 failed.** Log: [unit-tests.txt](unit-tests.txt).

The six are `it.skip` entries generated in `tests/unit/scenarios.test.ts` from fixture cases marked `gap`:

| Test | Why skipped | Kind | Plan |
|---|---|---|---|
| `en-safe-07` "Upgrade the package to version 1.2.3.4 please" | A four-part version number is reported as an IPv4 address | Product limitation (also seen in E1) | Needs a rule for the word "version" before the number; not scheduled |
| `en-gap-01` name and street address in English | The suite runs the rules only; names and addresses come from the detection model | Not a limitation: covered by `eval/ner.eval.ts` and E1 | Leave as is, or move to a model test |
| `ar-gap-01` name and district in Arabic | Same | Same | Same |
| `en-gap-02` "unreleased Q3 merger terms" | The risk is in the context, not in a value | Product limitation, partly addressed: a TOPIC rule covers it when an admin defines the topic; without one nothing is detected | Text of the skip reason should be updated to say so |
| `ar-gap-02` unannounced acquisition terms in Arabic | Same | Same | Same |
| `ar-gap-03` "الباس حقي سمسم2020" | The slang "الباس" without a separator is not recognised as a password keyword | Product limitation | Not scheduled |

## E5. Code coverage

Vitest coverage with the v8 provider, added without changing any test (`@vitest/coverage-v8` 5.0.2 as a dev dependency). Commit `3cb1f38`, 2026-11-25. Files: [coverage/coverage-summary.json](coverage/coverage-summary.json), [coverage/coverage-by-module.json](coverage/coverage-by-module.json), [coverage/by-module.py](coverage/by-module.py).

Command: `npx vitest run --coverage --coverage.provider=v8 --coverage.reporter=json-summary --coverage.reportsDirectory=docs/gp2-evidence/coverage --coverage.include='src/**' --coverage.include='worker/**' --coverage.include='entrypoints/**'`

**Overall: statements 49.6% (1130 of 2277), branches 57.5%, functions 49.6%, lines 49.6%.**

| Module | Files | Statements | Branches | Functions | Lines |
|---|---|---|---|---|---|
| Rules and validators | 9 | 88.1% | 79.9% | 89.7% | 92.8% |
| Model detector (NER) | 6 | 45.8% | 48.9% | 36.7% | 46.7% |
| Topic rules (decision model) | 5 | 69.6% | 73.6% | 81.8% | 66.7% |
| Pipeline and merge | 2 | 95.0% | 90.5% | 84.6% | 100% |
| Decision policy | 7 | 82.6% | 79.7% | 76.9% | 83.8% |
| Placeholder vault | 1 | 91.9% | 100% | 91.7% | 90.6% |
| Interceptor | 2 | 7.1% | 7.6% | 24.0% | 7.1% |
| Platform adapters | 5 | 0% | 0% | 0% | 0% |
| Policy sync | 2 | 93.3% | 91.7% | 100% | 95.0% |
| Uploader, outbox and log events | 5 | 96.4% | 91.0% | 90.5% | 100% |
| Session and API | 5 | 92.8% | 87.8% | 93.5% | 97.2% |
| Background wiring | 2 | 0% | 0% | 0% | 0% |
| Popup | 2 | 0% | 0% | 0% | 0% |
| Dialog and toast | 3 | 5.0% | 10.3% | 4.5% | 5.5% |
| Offscreen document and worker | 2 | 0% | 0% | 0% | 0% |
| Content script entry points | 3 | 0% | n/a | 0% | 0% |
| Contract, messaging and helpers | 9 | 83.1% | 90.4% | 88.9% | 83.9% |

Least covered, all at 0% of statements: `src/interceptor/interceptor.ts` (156 statements), `entrypoints/offscreen/offscreen.ts` (134), `worker/inference.worker.ts` (102), `src/backend/runtime.ts` (101), `entrypoints/popup/main.ts` (72), `entrypoints/background.ts` (63), `src/adapters/types.ts` (51), `src/adapters/editor.ts` (42), `worker/ner.ts` (37), `worker/topics.ts` (37), `src/ui/toast.ts` (32), `src/ner/client.ts` (14).

Reading: the logic that can run without a browser (rules, pipeline, policy, vault, session, uploader) is at 83 to 96%. Everything that touches the page, the browser APIs or the model runtime has no unit test; it is exercised only by hand (E3).

## E6. Open questions about the code

1. **Minimum Chrome 116.** The manifest sets no `minimum_chrome_version`; 116 is only stated in the README. What the code needs: `offscreen` (109), `chrome.storage.session` (102), `scripting` (88), `runtime.getContexts` (116, with a fallback to `clients.matchAll` in `hasOffscreenDocument`, `entrypoints/background.ts`), and the manifest keys `cross_origin_embedder_policy` / `cross_origin_opener_policy` added for several threads. **Tested: Chrome 157 only.** No older version was tested, so the real minimum is unknown; the fallback path has never been run.
2. **Other browsers.** Edge: a build target exists (`npm run build:edge`) and Edge loads the Chrome build; **not tested** with the current code (the last Edge build is from October). Brave: not tested. Firefox: not built and not expected to work, because Firefox has no `offscreen` API.
3. **Zero-shot model.** It is used for TOPIC rules only (`worker/topics.ts`, `src/topics/`). Nothing judges a prompt that matches no TOPIC rule.
4. **Dead code of the old context classification**, still in the repository and reachable by no user action:
   - `worker/inference.worker.ts`: `initializeRuntime`, `loadPipeline`, `classify`, `runClassification`, `handleClassify` (a four-label "safe / low / medium / high" judgement).
   - `src/model/config.ts`: `HYPOTHESES`, `HYPOTHESIS_TEMPLATE`, `UNCERTAINTY_THRESHOLD`, `MULTI_CLASS` (only `MODEL` is used, by the topic model). `src/model/contract.ts`: `ClassifyResult`.
   - `src/messaging/protocol.ts`: `MSG.CLASSIFY`, `MSG.CLASSIFY_RESULT`, `MSG.PROBE` and their types; the handlers `handleClassify` / `handleProbe` in `entrypoints/background.ts` and `classifyViaWorker` / `probeWorker` in `entrypoints/offscreen/offscreen.ts`. Nothing sends these messages.
   - `src/policy/decision.ts`: `contextTierOf` and the `context` argument of `decide`; `AnalyzeOptions.context` in `src/pipeline/analyze.ts`. Always empty in the product.
   - `src/policy/types.ts`: `Policy.decision` (hypotheses, examples, uncertaintyThreshold), validated in `src/policy/validate.ts` and never read.
   - `src/test/TEST_MODE.ts`.
5. **What leaves the browser.** All calls are made by the background service worker through `apiRequest` (`src/backend/api.ts`), except the model download, made by the worker through the model library:

   | Call | Sent |
   |---|---|
   | `GET` model and tokenizer files from `huggingface.co` and its CDN hosts, first use only | Nothing from the user |
   | `POST /api/extension/login` | `email`, `password` (once; the password is not stored) |
   | `POST /api/extension/refresh` | `refresh_token` |
   | `POST /api/extension/logout` | `refresh_token` |
   | `GET /api/policy/bundle` | `Authorization: Bearer` access token, `If-None-Match` |
   | `POST /api/logs` | `log_id`, `event_time`, `platform`, `risk_level`, `action`, `categories`, `classification_source`, `user_decision`, `rule_id`, `schema_version` (`LogEvent`, `src/logging/event.ts`) |

   No prompt text, detected value, placeholder mapping or model score is in any request. `tests/unit/log-event.test.ts` ("contains no prompt text, and only contract fields") and `tests/unit/topic-decision.test.ts` ("carries no score and no text") check the event. The message itself goes to the AI platform when the user sends it; that is the user's own traffic, not the extension's.
6. **Numbers.**
   - 55 built-in patterns in 21 of 24 categories: **confirmed** (`PATTERNS`, `src/detectors/patterns.ts`). The three without patterns are LEGAL, UNIVERSAL_ID and REGIONAL.
   - Validators: **11, not 10** (`VALIDATORS`, `src/detectors/validators.ts`): luhn, card, saudiId, iban, jwt, highEntropy, passwordLike, phone, gps, vin, ipv6.
   - 29 model labels, 23 enabled: **confirmed** (`MODEL_LABELS`, `src/ner/labels.ts`). Off: LOCATION, ORGANIZATION, DATE, AGE, POSTCODE, URL.
   - Detection-model windows of 1,200 characters with 150 overlap: **confirmed** (`WINDOW_CHARS`, `WINDOW_OVERLAP`, `src/ner/runner.ts`). The topic model uses 1,200 with **200** overlap and at most 6 pieces (`src/topics/runner.ts`).
   - Cross-message tail of 160 characters: **confirmed** (`HISTORY_TAIL_CHARS`, `src/pipeline/conversation.ts`).
   - Policy sync, current behaviour exactly: the background checks the bundle every minute (`POLICY_REFRESH_MINUTES = 1`, an alarm), on browser start and after sign-in. When a message is sent, the page asks the background for a fresh check if the last one is older than 15 seconds (`POLICY_MAX_AGE_ON_SEND_MS`); the background waits up to 1.5 seconds for it and the page up to 2.2 seconds, then the page reads the stored policy. **The decision still waits for that check.** What changed in "stop waiting for the policy check" is only when the models start: the detection model starts at once, and the topic model starts on the topics of the stored policy and is asked again only if the check brings different topic descriptions (`modelDetectionsFor`, `src/interceptor/interceptor.ts`).

## E7. Installation and store publication

**Not met today:** GP1 asks for at most 3 steps; the extension is not in the Chrome Web Store.

Steps today, from the zip (no build needed): 1. unzip to a folder that stays; 2. open `chrome://extensions`; 3. turn on Developer mode; 4. Load unpacked and choose the folder; 5. wait about a minute while the detection model downloads (first time); 6. optionally sign in from the popup. From source, add: clone, `npm install`, `npm run build` (README, "Install it (for testers)").

Still needed for the store:

- **Icons.** The manifest has no `icons` and no action icon; the store requires a 128×128 icon.
- **Privacy policy** page and the store's data-use form (the extension sends an email address and password to the platform on sign-in, and metadata events).
- **Permission justifications** for `offscreen`, `storage`, `alarms`, `scripting`, and each host permission (three AI sites, the platform API, four Hugging Face hosts).
- **Model delivery.** Each model is 268 MB and is downloaded from Hugging Face at first use. The store reviews code that fetches and runs remote content; model weights are data, not code, and the ONNX runtime is packaged, but this needs to be explained in the listing. Pinning is by revision for both models.
- **Cross-origin isolation** keys are in the manifest (see E10.6).
- A `minimum_chrome_version`, once the real minimum is known.
- Store listing: description, screenshots, a single purpose statement.

Store link and step count after publication: not available, not published.

## E8. Screens

All texts of the extension itself are **English only**; there is no Arabic variant of any screen. Arabic appears only where it comes from data: a rule's name in the findings list.

| Surface | How to reach it |
|---|---|
| Popup, signed out | Click the toolbar icon while signed out. Title "Hares AI", "Sign in with your Hares AI account to apply your organisation's policy.", Email, Password, "Sign in" |
| Popup, signing in | Submit the form: the button reads "Signing in…"; after 5 seconds "Connecting… the first sign-in can take up to a minute." |
| Popup, sign-in errors | Wrong password ("Wrong email or password."); unapproved account; deactivated account; too many attempts (with a countdown); server unreachable; server slow |
| Popup, signed out with a reason | After the session ends: "Your session ended. Please sign in again." or the deactivated-account text |
| Popup, signed in | "Protection is on.", then Account, Policy (version), Checked (time), Waiting (events to upload), "Sign out" |
| Popup, uploads paused | Signed in while the department is inactive: "Uploads are paused: your department is inactive. Protection continues." |
| Decision dialog, MEDIUM | Send "Please reply to sara@example.com": badge MEDIUM, "This message contains sensitive data", findings, revised message, Confirm / Send revised / Edit |
| Decision dialog, HIGH | Send "my password is Hunter2!": badge HIGH, "Sensitive data blocked", Send revised / Edit |
| Decision dialog, no revised version | A TOPIC warning alone: "Send it as written, or edit your message.", Confirm / Edit |
| Dialog, value continued from the previous message | Send a card number split over two messages: "↩ continues previous message" next to the finding |
| Status "Hares AI: checking…" | Any send whose check takes more than 300 ms |
| Notice, LOW | Send "How do I reset my password?": "Low risk: possibly sensitive wording noticed." |
| Notice, personal exception | Needs a user exception in storage: "Sent under your personal exception (…). Still logged as …" |
| Notice, model still downloading | Send a message in the first minute after install |
| Notice, revised message copied | When the site's editor refuses the revised text: "Revised message copied. Replace your text with Ctrl+V, then send." |
| Notice, could not press send | "Hares AI could not press send. Press Enter to send." |
| Notice, analysis failed | "Hares AI could not analyse this message. Press Enter again to send." |
| Notice, extension updated | Only if the extension is reloaded and cannot re-insert itself: "Hares AI was updated. Refresh this page to turn protection back on." |
| Offline | There is no offline screen. Events wait and the popup shows their number under Waiting |

## E9. Documentation changelog

Created: [../../DOCS-CHANGELOG.md](../../DOCS-CHANGELOG.md), with one line per behaviour change since `1a985492`.

## E10. TOPIC rules

1. **Facts: all confirmed**, with one correction to the wording of the event.

   | Statement | Where |
   |---|---|
   | Judged on the device by the zero-shot model against the English description | `scoreTopics`, `src/topics/runner.ts`; `runTopics`, `worker/topics.ts`; `topicRulesOf` takes `definitionEn` as the hypothesis, `src/topics/rules.ts` |
   | Matches at or above its threshold; default 0.3; kept within 0.2 to 0.9 | `topicDetections`, `src/topics/detect.ts`; `parseTopicFields`, `TOPIC_THRESHOLD_DEFAULT/MIN/MAX`, `src/topics/rules.ts` |
   | Only ALLOW or WARN, never blocks | `TOPIC_MAX_ENFORCEMENT`, `capped`, `src/topics/detect.ts`; test "a TOPIC rule never blocks" |
   | At most 10 rules are scored | `MAX_TOPIC_RULES`, `topicRulesOf` |
   | Longer than about 1,200 characters: at most 6 overlapping pieces | `chunkText`, `CHUNK_CHARS`, `CHUNK_OVERLAP` (200), `MAX_CHUNKS`, `src/topics/runner.ts` |
   | Model downloading, failed or over 6 seconds: rules not applied, message not held | `requestTopicScores`, `TOPICS_TIMEOUT_MS = 6000`, `src/topics/client.ts`; `runTopics` answers `loading` at once |
   | Event carries the rule id, `LOCAL_AI`, no score, no text | `log` in `src/interceptor/interceptor.ts`, `pickRuleId` and `buildEventDraft` in `src/logging/event.ts`; tests in `tests/unit/topic-decision.test.ts` |

   Correction: when several rules match one message, the event carries **one** rule id, the strictest (`pickRuleId`).
2. **Accuracy set.** Committed under [topic/](topic/): the prompt set (`topic-cases.json`), the original script (`topic.eval.ts.txt`) and its raw result (`topic-2026-11-22.json`), and the wording comparison (`topic-wording.eval.ts.txt`, `topic-wording-2026-11-24.json`). **The numbers hold for the extension's own scoring code:** the same 80 prompts scored through `scoreTopics` give the same table at every threshold ([topic/topic-extension-runner.json](topic/topic-extension-runner.json), script [../../eval/topic-extension.eval.ts](../../eval/topic-extension.eval.ts), commit `3cb1f38`, 2026-11-25, Node):

   | Threshold | Caught | English | Arabic | Near-topic flagged | Ordinary flagged |
   |---|---|---|---|---|---|
   | 0.3 | 44 of 48 = 91.7% | 95.8% | 87.5% | 5 of 16 | 0 of 16 |
   | 0.4 | 42 of 48 = 87.5% | 91.7% | 83.3% | 4 of 16 | 0 of 16 |
   | 0.5 | 40 of 48 = 83.3% | 91.7% | 75.0% | 1 of 16 | 0 of 16 |

   That run is still Node. The full set has **not** been run inside the built extension in a browser; there, ten messages were checked by hand against two rules and behaved as their Node scores predicted.
3. **Items the document lists as not verified.**
   - The one run that started about 3 seconds late: not explained, not reproduced. This stays a limitation.
   - <!-- OWNER-TODO -->**Pending (owner):** P2 (first-time download of both models with cross-origin isolation on), P8 (speed with 10 TOPIC rules; two were used), P4 (a machine with fewer cores), P5 (timing after the whole "nothing waits for the policy check" change).<!-- /OWNER-TODO -->
4. **Unit tests for TOPIC** at `3cb1f38`, all passing: `topic-decision` 19, `topic-rules` 17, `topic-runner` 15, `throttle` 3.
5. **What the user sees.** English only; there is no Arabic text.
   - TOPIC warning: badge "MEDIUM", title "This message contains sensitive data", line "Send it as written, or edit your message.", the rule's name under "Detected", buttons "Confirm" and "Edit" (Edit selected). With a maskable value in the same message the line is "Send it as written, or send the revised version with sensitive values replaced by placeholders." and "Send revised" is added (`dialogHint`, `src/ui/dialog.ts`).
   - Quiet notice (ALLOW): "Low risk: possibly sensitive wording noticed." The notice does not name the rule.
   - When TOPIC rules were not applied to a message, **the user is not told.** Only the page console says `topic rules not applied to this message (decision model: …)`.
6. **Permissions and manifest changes for this work.**
   - Added: `cross_origin_embedder_policy: require-corp` and `cross_origin_opener_policy: same-origin` (commit `3cb1f38`), so the models run on several threads.
   - Not changed for TOPIC: permissions (`offscreen`, `storage`, `alarms`, `scripting`), host permissions, content scripts. There are no `web_accessible_resources`.
   - Store review: the two isolation keys are standard manifest keys and need no extra permission. Their effect on the first model download is the untested item in point 3. The second model doubles the remote download (536 MB in total for an organisation that uses TOPIC rules), which belongs in the listing's description of what is fetched.

<!-- OWNER-TODO:START — everything from here to OWNER-TODO:END is a to-do list for the project owner. Delete the whole block once it is empty. -->
## Pending: manual work for the project owner

This block is **not report content**. It lists what still needs a person at the browser. To clear an item: do it, put the result in the section named, delete the item's row here, and delete the matching `Pending (owner)` mark in that section (search this file for `OWNER-TODO`). When no row is left, delete this block. An item still listed at submission goes into the report's Limitations section.

| Item | What to do | How | Where the result goes |
|---|---|---|---|
| P1 | Memory of the extension: before the models load, after each loads, after 50 messages | [performance-procedure.md](performance-procedure.md), step 5 | E2, "Size and memory" |
| P2 | First-time download of both models with cross-origin isolation on, with the load times | Remove the extension and add it again; [performance-procedure.md](performance-procedure.md), step 4 | E2, "Model load time"; E10 point 3 |
| P3 | Timing in the browser for prompts of 100, 1,000 and 5,000 characters, 50 runs each, and how often the 2,500 ms limit is hit | [performance-procedure.md](performance-procedure.md), step 2 | E2, a new table next to the Node one |
| P4 | Repeat P3 on a machine with 4 cores or fewer | [performance-procedure.md](performance-procedure.md), step 6 | E2; E10 point 3 |
| P5 | Timing of a few messages on the current build (after "nothing waits for the policy check") | [performance-procedure.md](performance-procedure.md), step 2 | E2, "Whole check in Chrome"; E10 point 3 |
| P6 | The functional tests on ChatGPT that have no date | [functional-tests.md](functional-tests.md), table "ChatGPT" | E3 and that table |
| P7 | The whole functional list on Claude and on Gemini | [functional-tests.md](functional-tests.md) | E3 and the two empty tables |
| P8 | Speed with 10 TOPIC rules | Create 10 TOPIC rules on a test department; [performance-procedure.md](performance-procedure.md), step 2 | E10 point 3 |
| P9 | Optional: try an older Chrome and Edge, to state a real minimum version | Install the build and run tests F01, F03 and F21 | E6 points 1 and 2 |
| P10 | Publish to the Chrome Web Store, then give the link and the number of install steps | What is needed is listed in E7 | E7 |

<!-- OWNER-TODO:END -->
