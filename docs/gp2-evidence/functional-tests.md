# Functional tests on the live AI platforms

The manual test list for the GP2 report (section E3). One table per platform. A row with no date has **not been run yet**: it is a to-do for the project owner (items P6 and P7 in `extension-evidence.md`), not a result. Only rows with a date are evidence.

How to run: load the build (`.output/chrome-mv3`), sign in from the popup with a test account whose department has the rules named below, open the platform, and follow the steps. Use only the synthetic values given here. Record the actual result, pass or fail, the date and the Chrome version.

Test rules needed on the platform for the account's department: a KEYWORD rule `falcon` (WARN), a PATTERN rule `PRJ-\d{4}` (WARN), a TOPIC rule "This text discusses layoffs, job cuts or restructuring." (WARN, 0.3), a TOPIC rule "This text discusses employee salaries, pay raises or bonuses." (ALLOW, 0.5), and one enabled TOPIC rule with no English description.

## Test list

| Id | Steps | Expected |
|---|---|---|
| F01 | Type `What is the capital of France?`, press Enter | Sent at once, nothing shown |
| F02 | Type `How do I reset my password?`, press Enter | Sent, with the notice "Low risk: possibly sensitive wording noticed." |
| F03 | Type `Please reply to sara@example.com`, press Enter, choose **Confirm** | MEDIUM dialog; the original text is sent |
| F04 | Same, choose **Send revised** | `Please reply to [EMAIL_1]` is sent |
| F05 | Same, choose **Edit** | Dialog closes, text stays in the box, nothing sent |
| F06 | Same, press **Escape** | Same as F05 |
| F07 | Type `my password is Sunset42!abc`, press Enter, choose **Send revised** | HIGH dialog without Confirm; the revised text is sent |
| F08 | Same, choose **Edit** | Nothing sent |
| F09 | Same, press **Escape** | Nothing sent |
| F10 | Type `Please reply to sara@example.com`, click the **send button** | Same dialog as F03 |
| F11 | **Paste** `Refund card 4111 1111 1111 1111` into the box, press Enter | HIGH dialog |
| F12 | After F05, change the address to `the support team`, press Enter | Sent at once |
| F13 | Send `my card number is 4111 1111` (Confirm if asked), then send `1111 1111` | The second message shows a card finding marked "continues previous message" |
| F14 | In one conversation, send `mail sara@example.com` with Send revised, then `again sara@example.com` with Send revised | Both use `[EMAIL_1]` |
| F15 | Right after installing, while the model is still downloading, send `Write a reference for Daniel Whitmore` | Sent, with the notice that the detector is still downloading; no name finding |
| F16 | On the platform, disable the category Contact Information for the department; wait 1 minute; without reloading the page send `Please reply to sara@example.com` | Sent at once |
| F17 | Go offline (DevTools, Network, Offline), send two clean messages, open the popup; go online, wait 1 minute | "Waiting: 2", then 0; the platform shows each event once |
| F18 | Sign out in the popup, send `Please reply to sara@example.com` | Dialog as in F03 (built-in policy); no event reaches the platform |
| F19 | Send `The falcon report is ready` | Warning naming the KEYWORD rule |
| F20 | Send `Status of PRJ-4821 please` | Warning naming the PATTERN rule |
| F21 | Send `We plan to cut 120 positions in January` | Warning naming the layoffs TOPIC rule; Confirm and Edit |
| F22 | Send `Draft a memo about the annual bonus amounts for the sales team.` | Sent, with the quiet notice |
| F23 | Send `We plan to cut 120 positions in January, write to sara@example.com` | Warning listing the topic and the email; Send revised offered |
| F24 | Inspect the stored policy (service worker console) | The TOPIC rule without an English description is not listed |
| F25 | Send `نخطط لتسريح 120 موظف في يناير، اكتب لي صيغة الإعلان` | Warning naming the layoffs TOPIC rule |
| F26 | Send `راسلني على sara@example.com` | MEDIUM dialog |
| F27 | Right-to-left interface | Not applicable: the extension's own texts are English only |

## ChatGPT (chatgpt.com)

| Id | Actual | Result | Date | Chrome |
|---|---|---|---|---|
| F01 | Sent at once | Pass | 2026-11-24 | 157.0.8103.80 |
| F02 | | not run | | |
| F03 | | not run with Confirm | | |
| F04 | Sent with `[EMAIL_1]` (message also had a topic match) | Pass | 2026-11-24 | 157.0.8103.80 |
| F05 | | not run with the Edit button | | |
| F06 | Dialog closed, nothing sent | Pass | 2026-11-24 | 157.0.8103.80 |
| F07 to F09 | | not run | | |
| F10 | | not run | | |
| F11 | | not run | | |
| F12 | | not run | | |
| F13 | | not run | | |
| F14 | | not run | | |
| F15 | | not run for the detection model. Seen for the topic model: when it passed its limit the message was checked without TOPIC rules | | |
| F16 | | not run after the fix (unit-tested in `policy-live.test.ts`) | | |
| F17 | | not run | | |
| F18 | Dialog shown while signed out, with a trial policy in storage | Pass | 2026-11-24 | 157.0.8103.80 |
| F19, F20 | | not run | | |
| F21 | Warning with the layoffs rule | Pass | 2026-11-24 | 157.0.8103.80 |
| F22 | Sent with the notice (salary messages) | Pass | 2026-11-24 | 157.0.8103.80 |
| F23 | Topic and email listed, Send revised offered | Pass | 2026-11-24 | 157.0.8103.80 |
| F24 | Not listed; the platform saw no event for it | Pass | 2026-11-24 | 157.0.8103.80 |
| F25 | Warning with the layoffs rule | Pass | 2026-11-24 | 157.0.8103.80 |
| F26 | | not run | | |

Also seen on 2026-11-24: a message matching both TOPIC rules listed both, with Confirm and Edit and Edit selected; "What is the average salary of a software engineer in Germany?" was sent with the notice (a false alert on the salaries rule).

## Claude (claude.ai)

Not run.

## Gemini (gemini.google.com)

Not run.
