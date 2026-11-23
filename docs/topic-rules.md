# TOPIC rules

A TOPIC rule names a subject in words, for example "plans to lay off employees". The extension decides on the user's device whether a message is about that subject. The message text never leaves the device.

Status: built in the extension and covered by unit tests. Not yet tested in a browser against a real bundle, because the platform does not send the two new fields yet.

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
- The send never waits on the model: while it is downloading, if it failed to load, or if scoring takes more than 4 seconds, TOPIC rules are **not applied** to that message. The page console says so (`topic rules not applied to this message`). Other protection is unaffected.

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

## Not verified yet

- Speed inside the browser. Scoring 8 topics took about 0.2 to 0.35 seconds per message in Node; the browser's WASM runtime may be slower, and the 4-second limit has not been checked against real use.
- A joint test with the platform, once its bundle carries `definition_en` and `threshold`.
- The 80 test prompts were written for the test; real topics from admins may behave differently.

## Trying it by hand

`scripts/try-topic.mjs` on the branch `experiment/topic-try-it` scores typed prompts against a list of topics, outside the extension.
