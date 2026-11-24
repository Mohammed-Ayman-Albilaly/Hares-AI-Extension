# TOPIC rules

A TOPIC rule names a subject in words, for example "plans to lay off employees". The extension decides on the user's device whether a message is about that subject. The message text never leaves the device.

Status: built, covered by unit tests, and tested in Chrome on ChatGPT against the live platform on 2026-11-24 (see "Joint test" and "Speed"). The first version added 2 to 3.3 seconds to every message; with the models on several threads a check now takes 0.15 to 1.7 seconds. Not yet checked: a first-time model download with the new isolation settings.

## How a message is judged

1. The policy bundle lists the TOPIC rules of the user's department.
2. When a message is about to be sent, the local decision model reads the message and each rule's English description and returns a score from 0 to 1 for each rule.
3. A rule matches when its score reaches the rule's **threshold**. Its action then applies: ALLOW (notice) or WARN (confirm dialog). **A TOPIC rule never blocks.**

Code: [src/topics/](../src/topics/) (rules, scoring, matches), [worker/topics.ts](../worker/topics.ts) (the model).

## The rule in the bundle

Agreed with the platform (platform decision 66):

```json
{
  "id": "8e7d6c5b-4a39-4281-b7c6-d5e4f3a2b1c0",
  "name": "تسريح الموظفين",
  "kind": "TOPIC",
  "definition": "أي حديث عن خطط تسريح موظفين أو إلغاء وظائف",
  "definition_en": "This text discusses plans to lay off employees, cut positions or restructure departments.",
  "threshold": 0.3,
  "risk_level": "MEDIUM",
  "action": "WARN"
}
```

| Field | What the extension does |
|---|---|
| `definition_en` | The sentence the model reads. Missing, `null`, or outside 20 to 300 characters → the rule is skipped (rules saved before this field existed arrive with `null`) |
| `threshold` | Missing, `null` or not a number → 0.3. Outside 0.2 to 0.9 → moved to the nearest limit |
| `definition` | Not used for matching. It stays in the admin's language for the platform's screens |
| `action` | `ALLOW` or `WARN`. A TOPIC rule that arrives with `BLOCK` is enforced and logged as `WARN` |
| unknown fields | Ignored |

`definition_en` and `threshold` are `null` on KEYWORD and PATTERN rules; they are ignored there. The platform lets the admin write the English description (it does not translate), validates both fields, and caps enabled TOPIC rules at 10 per department. The extension also scores at most the first 10.

## What the user sees

A topic match is about the message as a whole. There is no value to replace with a placeholder, so there is no "revised version" that fixes it.

| Rule action | Dialog |
|---|---|
| ALLOW | Sent, with the quiet notice |
| WARN | Confirm (send as written) or Edit. If the message also has values that can be masked, Send revised is offered too and masks those |
| BLOCK | Not supported for TOPIC rules: treated as WARN |

Why no block: the model's answer is a likelihood, not a fact like a card number, and at the default threshold 5 of 16 near-topic test prompts were flagged by mistake. A wrong block would stop someone's work with nothing they could mask to get past it. Other detections in the same message (a card number, a BLOCK keyword rule) still block as usual.

The dialog names the rule (`name`), and selects the safe button by default: Send revised when there is one, otherwise Edit.

## The model

- `Horizon-Labs/multilingual-zeroshot-small`, int8, about 268 MB, the same model the TOPIC experiments measured. It runs in the extension's worker on the CPU (WASM).
- It is downloaded only when a policy with TOPIC rules is seen, once, and then loads from disk. With the detection model the total first download is about 536 MB.
- A message longer than about 1200 characters is read in overlapping pieces (at most 6: the first five and the last), and the highest score of each topic is kept.
- The send never waits on the model: while it is downloading, if it failed to load, or if scoring takes more than 6 seconds, TOPIC rules are **not applied** to that message. The page console says so (`topic rules not applied to this message`). Other protection is unaffected.

## Log events

A TOPIC match is reported like a KEYWORD or PATTERN match: its `rule_id`, the rule's risk and action (`WARNED` or `ALLOWED`; a topic alone is never `BLOCKED`), and no category of its own (`categories` can be `[]`). `classification_source` is `LOCAL_AI`. No score and no text is sent.

## What was measured

80 Arabic and English prompts against 8 topics, in Node on a laptop CPU (branch `experiment/topic-zeroshot-eval`, one run).

| Threshold | On-topic prompts caught | Arabic prompts caught | Near-topic prompts flagged by mistake | Ordinary prompts flagged by mistake |
|---|---|---|---|---|
| 0.5 | 83% | 75% | 1 of 16 | 0 of 16 |
| 0.4 | 88% | 83% | 4 of 16 | 0 of 16 |
| 0.3 | 92% | 88% | 5 of 16 | 0 of 16 |

- The description must be in English: written in Arabic it caught 21 to 31% of prompts.
- A full sentence works better than a short name: 83% against 48%.
- Short prompts score around 0.35, so they are missed at 0.5 and caught at 0.3.
- Five other models were tried (three embedding models, mDeBERTa, GLiClass); none came close. Their results are on the `experiment/topic-*` branches.
- Wording of the description (branch `experiment/topic-short-descriptions`): a short form with plain nouns ("This text discusses layoffs, job cuts or restructuring.") is not better in general than a full sentence. At 0.5 both caught 83%, with 3 of 16 near-topic prompts flagged for the short form against 1 of 16. What clearly hurts is a long description crowded with verbs and alternatives: on one topic it caught 3 of 9 prompts where the others caught 8 or 9. The best wording varies by topic.

## Joint test

Chrome on ChatGPT, signed in to the live platform, 2026-11-24. The bundle had two TOPIC rules (layoffs: WARN at 0.3; salaries: ALLOW at 0.5) and one old rule with `definition_en: null`.

| Message | Result | Enter to result |
|---|---|---|
| "We plan to cut 120 positions in January" | Warned by the layoffs rule | not timed |
| The same idea in Arabic | Warned by the layoffs rule | not timed |
| An Arabic message about two employees' salaries | Sent with the notice (salaries, ALLOW) | not timed |
| "What is the capital of France?" | Sent, nothing shown | not timed |
| Layoffs message with an email address, first try after about 50 idle minutes | **Topic missed**: the model took more than 4 seconds; only the email was shown | over 4 s |
| The same message again | Warned: the topic and the email, with Send revised | 3.3 s |
| A message about layoffs and bonuses | Warned, both rules listed, Confirm and Edit only | 3.1 s |
| "What is the average salary of a software engineer in Germany?" | Sent with the notice: a false alert on the salaries rule, as predicted (score 0.63) | 2.0 s |
| "What are healthy ways to cope with stress after losing a job?" | Sent, nothing shown | 2.6 s |
| An ordinary request in Arabic | Sent, nothing shown | 2.2 s |

- The old rule without an English description was not loaded.
- The topic model loaded from disk in about 4.8 seconds.
- The first four rows were run by hand; the rest were driven and timed by script (time from releasing Enter to the dialog, or to the end of the check).
- The payloads of `POST /logs` were not inspected in the browser; the platform side confirms the events.

## Speed

The first version made every message wait 2 to 3.3 seconds, and the first message after a long idle passed the limit, so its topic was missed (see "Joint test"). Four changes followed:

1. **Several threads.** The manifest makes the extension's pages cross-origin isolated (`cross_origin_embedder_policy`, `cross_origin_opener_policy`), which lets the ONNX runtime use several CPU threads. This is the change that matters.
2. **Warm-up.** Both models run once on nothing when the page opens and when the user starts typing after a minute's pause, so the real run is not the slow first one after idling.
3. **Nothing waits for the policy check.** The detection model starts at once, and the topic model starts on the stored policy's topics; it is asked again only if the check brings different descriptions.
4. **Limit.** The topic model's limit is 6 seconds instead of 4.

Measured in Chrome on ChatGPT, 2026-11-24, two TOPIC rules, a 12-core laptop, 4 threads in use. Times are the extension's own, per message:

| Message | Whole check | Policy check | Detection model | Topic model | Result |
|---|---|---|---|---|---|
| Layoffs with an email, first message after loading | 1.7 s | 0.86 s | 0.44 s | 0.64 s | Topic and email caught |
| Layoffs and bonuses | 1.1 s | 0.74 s | 0.09 s | 0.29 s | Both rules |
| Short layoffs message | 0.14 s | 0.03 s | 0.05 s | 0.09 s | Warned |
| General salary question | 0.58 s | 0.02 s | 0.14 s | 0.30 s | Notice (false alert) |
| Coping with job loss | 0.60 s | 0.49 s | 0.08 s | 0.11 s | Nothing |
| Layoffs in Arabic | 0.30 s | 0.08 s | 0.15 s | 0.14 s | Warned |

- These runs had changes 1, 2 and 4 and half of change 3 (the detection model already started early, the topic model still waited for the policy check). With the whole of change 3 the check should take about as long as the slower of the policy check and the two models; that has not been measured.
- In one further run the check started about 3 seconds after Enter was pressed. The cause was not found; it did not repeat.
- Before these changes the same messages took 2.0 to 3.3 seconds, single-threaded.

## Known problems

- **First-time download under isolation is untested.** The models were already on disk in every run above. A new user downloads them from Hugging Face, and the isolation settings add rules for cross-origin requests. If that download were blocked, both models would stay off. Test by removing the extension, adding it again and watching the models load.
- **Slower machines.** The numbers come from one 12-core laptop. With fewer cores the runtime uses fewer threads.

## Not verified yet

- Speed with more than two TOPIC rules (up to 10 are allowed).
- The 80 test prompts were written for the test; real topics from admins may behave differently.

## Trying it by hand

`scripts/try-topic.mjs` on the branch `experiment/topic-try-it` scores typed prompts against a list of topics, outside the extension.
