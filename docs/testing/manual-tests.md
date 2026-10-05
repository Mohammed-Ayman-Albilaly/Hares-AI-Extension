# Hares AI — manual test checklist (ChatGPT)

Generated from `tests/fixtures/` by `node scripts/gen-manual-tests.mjs` — edit the JSON, not this file.
All values are synthetic. Never test with real data.

**How to read "Expected":**
SAFE = sends, nothing shown · LOW = sends + small toast · MEDIUM = dialog (Confirm / Send revised / Edit) · HIGH = dialog without Confirm.
For MEDIUM/HIGH also check that **Send revised** puts the placeholder version into ChatGPT and that ChatGPT receives it.

## English — single messages

| ID | Type this | Expected | Note | Pass |
|---|---|---|---|---|
| en-safe-01 | What is the capital of France? | SAFE |  | ☐ |
| en-safe-02 | Write a Python function that reverses a string. | SAFE |  | ☐ |
| en-safe-03 | Summarize this article about climate change in 3 bullet points. | SAFE |  | ☐ |
| en-safe-04 | Convert 25 Celsius to Fahrenheit and explain the formula. | SAFE |  | ☐ |
| en-safe-05 | My order arrived late, write a polite complaint email to the store. | SAFE |  | ☐ |
| en-safe-06 | Change the button color to #ff00aa and the border radius to 8px. | SAFE |  | ☐ |
| en-safe-07 | Upgrade the package to version 1.2.3.4 please | SAFE | ⚠️ Known gap: Known false positive: a 4-part version number looks like an IPv4 address. | ☐ |
| en-low-01 | I need a password reset link for my account | LOW |  | ☐ |
| en-low-02 | Where should I store an api_key safely in a React app? | LOW |  | ☐ |
| en-low-03 | This document is confidential, summarize it. | LOW |  | ☐ |
| en-med-01 | Please reply to sara@example.com about the meeting | MEDIUM — [EMAIL_n] |  | ☐ |
| en-med-02 | Call me on 0551234567 after 5pm | MEDIUM — [PHONE_n] |  | ☐ |
| en-med-03 | Our London office number is +44 20 7946 0958 | MEDIUM — [PHONE_n] |  | ☐ |
| en-med-04 | The staging server is at 10.0.0.12, why is it slow? | MEDIUM — [IP_ADDRESS_n] |  | ☐ |
| en-med-05 | My laptop MAC address is 00:1A:2B:3C:4D:5E | MEDIUM — [MAC_ADDRESS_n] |  | ☐ |
| en-med-06 | Look up record 3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90 in the logs | MEDIUM — [UUID_n] |  | ☐ |
| en-med-07 | Open C:\Users\ali\Desktop\salaries.xlsx and explain the totals | MEDIUM — [FILE_PATH_n] |  | ☐ |
| en-med-08 | Why is my .env file not loading in Vite? | MEDIUM — [SECRET_FILE_n] |  | ☐ |
| en-med-09 | Find restaurants near 24.7136, 46.6753 | MEDIUM — [GPS_n] |  | ☐ |
| en-med-10 | Patient DOB: 1990-05-12, what vaccines are due? | MEDIUM — [DATE_OF_BIRTH_n] |  | ☐ |
| en-med-11 | Where is my parcel? tracking number: 1Z999AA10123456784 | MEDIUM — [TRACKING_NUMBER_n] |  | ☐ |
| en-med-12 | Decode this VIN 1HGCM82633A004352 for me | MEDIUM — [VIN_n] |  | ☐ |
| en-med-13 | Read https://docs.python.org/3/library/json.html and summarize it | MEDIUM — [URL_n] |  | ☐ |
| en-high-01 | Is this card valid? 4111 1111 1111 1111 | HIGH — [CARD_NUMBER_n] |  | ☐ |
| en-high-02 | the cvv: 123 keeps getting rejected | HIGH — [CVV_n] |  | ☐ |
| en-high-03 | Send the salary to SA03 8000 0000 6080 1016 7519 | HIGH — [IBAN_n] |  | ☐ |
| en-high-04 | My national ID is 1087654321, fill the form | HIGH — [NATIONAL_ID_n] |  | ☐ |
| en-high-05 | passport number: A12345678 expires next year | HIGH — [PASSPORT_n] |  | ☐ |
| en-high-06 | Is 123-45-6789 a valid SSN format? | HIGH — [SSN_n] |  | ☐ |
| en-high-07 | Fix my config: password is Hunter2! and email ali@example.com | HIGH — [PASSWORD_n], [EMAIL_n] |  | ☐ |
| en-high-08 | my password for gmail is Hunter2! | HIGH — [PASSWORD_n] |  | ☐ |
| en-high-09 | Why does sk-proj-abcdEFGH1234ijklMNOP5678 return 401? | HIGH — [API_KEY_n] |  | ☐ |
| en-high-10 | aws_access_key_id = AKIAIOSFODNN7EXAMPLE | HIGH — [API_KEY_n] |  | ☐ |
| en-high-11 | git push fails with token ghp_abcdefghijklmnopqrstuvwxyz0123456789 | HIGH — [GITHUB_TOKEN_n] |  | ☐ |
| en-high-12 | Decode this: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U | HIGH — [JWT_n] |  | ☐ |
| en-high-13 | -----BEGIN RSA PRIVATE KEY-----<br>MIIEowIBAAKCAQEAfakefakefake<br>-----END RSA PRIVATE KEY-----<br>why does ssh reject this? | HIGH — [PRIVATE_KEY_n] |  | ☐ |
| en-high-14 | connect with postgres://admin:S3cret@db.internal:5432/prod | HIGH — [CONNECTION_STRING_n] |  | ☐ |
| en-high-15 | DB_PASSWORD=SuperSecret123 is in my env, is that ok? | HIGH — [ENV_SECRET_n] |  | ☐ |
| en-high-16 | curl -H "Authorization: Bearer abcdef1234567890abcdef" https://api.example.com | HIGH — [AUTH_HEADER_n] |  | ☐ |
| en-high-17 | my OTP is 482913, why did login fail? | HIGH — [PIN_n] |  | ☐ |
| en-gap-01 | My name is John Carter and I live at 12 Baker Street, London | MEDIUM | ⚠️ Known gap: Names and street addresses need the NER model (Phase 3). | ☐ |
| en-gap-02 | Here are our unreleased Q3 merger terms with Acme, rewrite them formally | MEDIUM | ⚠️ Known gap: Context-only risk needs the decision model (Phase 4). | ☐ |

## Arabic — single messages

| ID | Type this | Expected | Note | Pass |
|---|---|---|---|---|
| ar-safe-01 | ما هي عاصمة فرنسا؟ | SAFE |  | ☐ |
| ar-safe-02 | اكتب لي قصيدة قصيرة عن البحر | SAFE |  | ☐ |
| ar-safe-03 | اشرح لي كيف يعمل التشفير بشكل مبسط | SAFE |  | ☐ |
| ar-safe-04 | لخص هذا المقال في ثلاث نقاط | SAFE |  | ☐ |
| ar-safe-05 | كم يساوي ٢٥ درجة مئوية بالفهرنهايت؟ | SAFE |  | ☐ |
| ar-safe-06 | ابغى خطة مذاكرة لاختبار الرياضيات الأسبوع الجاي | SAFE |  | ☐ |
| ar-low-01 | وين أحفظ الباسورد بشكل آمن؟ | LOW |  | ☐ |
| ar-low-02 | هذا المستند سري للغاية، لخصه لي | LOW |  | ☐ |
| ar-low-03 | كيف أغير كلمة المرور في جيميل؟ | LOW |  | ☐ |
| ar-med-01 | راسلني على ali@example.com بخصوص الاجتماع | MEDIUM — [EMAIL_n] |  | ☐ |
| ar-med-02 | جوالي 0551234567 اتصل علي بعد العصر | MEDIUM — [PHONE_n] |  | ☐ |
| ar-med-03 | رقمي +966 55 123 4567 | MEDIUM — [PHONE_n] |  | ☐ |
| ar-med-04 | تاريخ الميلاد: 1995/03/12 احسب عمري | MEDIUM — [DATE_OF_BIRTH_n] |  | ☐ |
| ar-med-05 | رقم الطلب: ORD-558812 متى يوصل؟ | MEDIUM — [TRACKING_NUMBER_n] |  | ☐ |
| ar-med-06 | الرقم الجامعي 441000123 وش معدلي؟ | MEDIUM — [STUDENT_ID_n] |  | ☐ |
| ar-med-07 | السيرفر على 192.168.1.20 وما يرد | MEDIUM — [IP_ADDRESS_n] |  | ☐ |
| ar-med-08 | دور لي مطاعم قريبة من 24.7136, 46.6753 | MEDIUM — [GPS_n] |  | ☐ |
| ar-high-01 | شف هذه هو الباسورد حقي :<br>محمد_الو_تراها_ماهي_بيانات_سرية | HIGH — [PASSWORD_n] |  | ☐ |
| ar-high-02 | الباسورد هو Riyadh2024 | HIGH — [PASSWORD_n] |  | ☐ |
| ar-high-03 | كلمة المرور: Abc@12345 | HIGH — [PASSWORD_n] |  | ☐ |
| ar-high-04 | كلمة السر حقتي هي sm_9981 | HIGH — [PASSWORD_n] |  | ☐ |
| ar-high-05 | كلمة المرور الخاصة بي: تفاحة | HIGH — [PASSWORD_n] |  | ☐ |
| ar-high-06 | رقم الهوية ١٠٨٧٦٥٤٣٢١ عبي النموذج | HIGH — [NATIONAL_ID_n] |  | ☐ |
| ar-high-07 | هويتي 1087654321 | HIGH — [NATIONAL_ID_n] |  | ☐ |
| ar-high-08 | رقم الإقامة 2100000005 منتهي؟ | HIGH — [NATIONAL_ID_n] |  | ☐ |
| ar-high-09 | حول المبلغ على الآيبان SA03 8000 0000 6080 1016 7519 | HIGH — [IBAN_n] |  | ☐ |
| ar-high-10 | بطاقتي ٤١١١ ١١١١ ١١١١ ١١١١ ليش مرفوضة؟ | HIGH — [CARD_NUMBER_n] |  | ☐ |
| ar-high-11 | رمز التحقق 482913 وصلني الحين | HIGH — [PIN_n] |  | ☐ |
| ar-high-12 | الرقم السري للبطاقة 4821 | HIGH — [PIN_n] |  | ☐ |
| ar-high-13 | مفتاح الـ API حقي sk-proj-abcdEFGH1234ijklMNOP5678 ما يشتغل | HIGH — [API_KEY_n] |  | ☐ |
| ar-high-14 | رقم الجواز A12345678 متى ينتهي؟ | HIGH — [PASSPORT_n] |  | ☐ |
| ar-gap-01 | اسمي محمد العتيبي وأسكن في حي النرجس، الرياض | MEDIUM | ⚠️ Known gap: Arabic names and addresses need the NER model (Phase 3). | ☐ |
| ar-gap-02 | هذه شروط صفقة الاستحواذ غير المعلنة، صغها بشكل رسمي | MEDIUM | ⚠️ Known gap: Context-only risk needs the decision model (Phase 4). | ☐ |
| ar-gap-03 | الباس حقي سمسم2020 | HIGH — [PASSWORD_n] | ⚠️ Known gap: Slang 'الباس' without a separator is not recognised yet. | ☐ |

## Conversations

### conv-en-split-password — Password announced in one message, value in the next

Start a **new chat**, then send in order:

1. `Can you help me log in to my server?` → **SAFE**
2. `my password is` → **LOW**
3. `Hunter2!x` → **HIGH** (placeholders: PASSWORD; shows "↩ continues previous message"; revised = `[PASSWORD_1]`)

☐ Pass

### conv-en-split-card — Card number split across two messages

Start a **new chat**, then send in order:

1. `my card number is 4111 1111` → **SAFE**
2. `1111 1111 and it expires 09/27` → **HIGH** (placeholders: CARD_NUMBER; shows "↩ continues previous message")

☐ Pass

### conv-en-placeholders — Same value keeps the same placeholder across messages

Start a **new chat**, then send in order:

1. `Email sara@example.com about the launch` → **MEDIUM** (revised = `Email [EMAIL_1] about the launch`; then choose **Send revised**)
2. `Also cc ali@example.com` → **MEDIUM** (revised = `Also cc [EMAIL_2]`; then choose **Send revised**)
3. `Actually only email sara@example.com` → **MEDIUM** (revised = `Actually only email [EMAIL_1]`)

☐ Pass

### conv-en-revised-pasted-back — Revised text pasted back is not flagged again (no loop)

Start a **new chat**, then send in order:

1. `Fix my config: password is Hunter2! and email ali@example.com` → **HIGH**
2. `(paste the revised text from the previous step)` → **at most LOW**

☐ Pass

### conv-en-no-false-join — Unrelated numbers in consecutive messages are not joined

Start a **new chat**, then send in order:

1. `The order total is 4111` → **SAFE**
2. `1111 people attended the event` → **SAFE**

☐ Pass

### conv-en-history-does-not-leak — A keyword in the previous message does not flag an unrelated next message

Start a **new chat**, then send in order:

1. `What's a good password manager?` → **LOW**
2. `thanks, also explain how DNS works` → **SAFE**

☐ Pass

### conv-ar-split-password — الباسورد في رسالة والقيمة في الرسالة اللي بعدها

Start a **new chat**, then send in order:

1. `ابغاك تساعدني ادخل حسابي` → **SAFE**
2. `الباسورد حقي :` → **LOW**
3. `محمد_الو_تراها_ماهي_بيانات_سرية` → **HIGH** (placeholders: PASSWORD; shows "↩ continues previous message")

☐ Pass

### conv-ar-split-card — رقم بطاقة بالأرقام العربية مقسوم على رسالتين

Start a **new chat**, then send in order:

1. `رقم بطاقتي ٤١١١ ١١١١` → **SAFE**
2. `١١١١ ١١١١` → **HIGH** (placeholders: CARD_NUMBER; shows "↩ continues previous message")

☐ Pass

### conv-ar-otp — رمز التحقق يُذكر ثم يُرسل في رسالة منفصلة

Start a **new chat**, then send in order:

1. `وصلني رمز التحقق` → **SAFE**
2. `482913` → **HIGH** (placeholders: PIN; shows "↩ continues previous message")

☐ Pass

### conv-ar-placeholders — نفس الإيميل ياخذ نفس البليسهولدر عبر المحادثة

Start a **new chat**, then send in order:

1. `أرسل التقرير إلى sara@example.com` → **MEDIUM** (revised = `أرسل التقرير إلى [EMAIL_1]`; then choose **Send revised**)
2. `وأرسل نسخة إلى ali@example.com` → **MEDIUM** (revised = `وأرسل نسخة إلى [EMAIL_2]`; then choose **Send revised**)
3. `لا، فقط إلى sara@example.com` → **MEDIUM** (revised = `لا، فقط إلى [EMAIL_1]`)

☐ Pass

### conv-mixed-iban — English then Arabic, IBAN in the second message

Start a **new chat**, then send in order:

1. `Hi, I need help with a bank transfer` → **SAFE**
2. `الآيبان حقي SA03 8000 0000 6080 1016 7519` → **HIGH** (placeholders: IBAN)

☐ Pass
