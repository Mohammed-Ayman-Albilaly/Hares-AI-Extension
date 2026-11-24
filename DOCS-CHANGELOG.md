# Documentation changelog

One line for every change that alters behaviour, a rule, a threshold, a model, a permission, a screen or a test count. The documentation workflow reads this file together with the git diff. Pure refactoring needs no line.

Format: `date | commit | what changed (one sentence) | area | added, changed or removed`

Areas: rules, model, pipeline, decision, masking, adapters, sync, logging, popup, permissions, tests.

2026-11-24 | 9a4e9bf | TOPIC rules are read from the policy bundle with an English description (`definition_en`, 20 to 300 characters) and a threshold (default 0.3, kept within 0.2 to 0.9); a TOPIC rule without a usable description is skipped. | rules | added
2026-11-24 | 9a4e9bf | 15 unit tests for reading TOPIC rules (`topic-rules.test.ts`); total 327 passed, 6 skipped. | tests | added
2026-11-24 | f1a997f | The zero-shot model `Horizon-Labs/multilingual-zeroshot-small` (int8, about 268 MB) now scores a message against TOPIC descriptions in the worker; it loads only when a policy has TOPIC rules, and a message longer than about 1,200 characters is read in at most 6 overlapping pieces. | model | added
2026-11-24 | f1a997f | A send waits at most 4 seconds for the topic scores; past that, TOPIC rules are not applied to the message. | pipeline | added
2026-11-24 | f1a997f | 15 unit tests for topic scoring and its client (`topic-runner.test.ts`); total 342 passed, 6 skipped. | tests | added
2026-11-24 | 912e812 | A TOPIC rule whose score reaches its threshold is applied when a message is sent, with the rule's own action and risk; at most 10 TOPIC rules are scored. | decision | added
2026-11-24 | 912e812 | A match that cannot be masked (a TOPIC rule, a report-only keyword) that blocks a message removes "Send revised" from the dialog, also when other values could be masked. | decision | changed
2026-11-24 | 912e812 | The decision dialog selects the safe button by default (Send revised, otherwise Edit); before, a warning without a revised version selected Confirm. | popup | changed
2026-11-24 | 912e812 | New dialog texts when there is no revised version: "Send it as written, or edit your message." and "This message cannot be sent as written. Edit it and try again." | popup | added
2026-11-24 | 912e812 | The event of a TOPIC match carries the rule id with no category of its own, no score and no text, and classification source LOCAL_AI. | logging | added
2026-11-24 | 912e812 | 17 unit tests for TOPIC matches in the send check (`topic-decision.test.ts`); total 359 passed, 6 skipped. | tests | added
2026-11-24 | 6057af5 | A TOPIC rule never blocks: one that arrives with the action BLOCK is enforced and logged as WARN, and the risk the admin declared is still reported. | decision | changed
2026-11-24 | 6057af5 | `topic-decision.test.ts` grows from 17 to 19 tests; total 361 passed, 6 skipped. | tests | changed
2026-11-24 | 8453fbf | The detection model and the topic model are run once on nothing when the page opens and when the user starts typing after a minute's pause, so the first real message is not their slow first run. | pipeline | added
2026-11-24 | 8453fbf | The time limit for the topic scores goes from 4 to 6 seconds. | pipeline | changed
2026-11-24 | 8453fbf | The detection model starts as soon as a message is sent, while the policy is being checked, instead of after it. | pipeline | changed
2026-11-24 | 8453fbf | Each check prints its duration and where the time went in the page console (`[hares] check took …`). | logging | added
2026-11-24 | 8453fbf | 3 unit tests for the warm-up throttle and the time limit (`throttle.test.ts`); total 364 passed, 6 skipped. | tests | added
2026-11-24 | 3cb1f38 | The manifest sets `cross_origin_embedder_policy: require-corp` and `cross_origin_opener_policy: same-origin`, so the local models run on several CPU threads (4 on the test machine). | permissions | added
2026-11-24 | 3cb1f38 | The topic model starts on the topics of the stored policy while the policy is being checked, and is asked again only if the check brings different descriptions; the decision itself still waits for the check. | pipeline | changed
2026-11-24 | 3cb1f38 | 2 unit tests for reusing topic scores (`topic-rules.test.ts` grows from 15 to 17); total 366 passed, 6 skipped, 25 test files. | tests | added
