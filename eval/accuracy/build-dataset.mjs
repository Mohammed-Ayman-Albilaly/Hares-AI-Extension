// Builds the labelled accuracy set for docs/gp2-evidence (section E1).
//
// Every value is synthetic and generated here, with a valid checksum where the
// product validates one (card and IMEI: Luhn; Saudi ID: Luhn; IBAN: mod 97). The
// labels are what a person would say the prompt contains, written before the
// detector is run: they are not derived from the detector's patterns.
//
// One labelling rule is applied mechanically: a prompt that uses one of the
// sensitive words of the product's "Keyword-Based Sensitive Patterns" category
// (password, secret, token, api key, authorization, ssn, dob, confidential,
// credentials and their Arabic equivalents) is also labelled KEYWORD.
//
// Deterministic: the same seed gives the same file.
// Run: node eval/accuracy/build-dataset.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// --- deterministic random -----------------------------------------------------
let seed = 20261125;
function rnd() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (list) => list[int(0, list.length - 1)];
const from = (alphabet, n) => Array.from({ length: n }, () => alphabet[int(0, alphabet.length - 1)]).join('');
const DIGITS = '0123456789';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const ALNUM = DIGITS + UPPER + LOWER;
const HEX = '0123456789abcdef';
const B64 = ALNUM + '+/';
const digits = (n) => from(DIGITS, n);

// --- checksums ------------------------------------------------------------------
function luhnCheckDigit(body) {
  let sum = 0;
  let double = true;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    let d = Number(body[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}
const luhnNumber = (prefix, length) => {
  const body = prefix + digits(length - prefix.length - 1);
  return body + luhnCheckDigit(body);
};
function ibanSA() {
  // A Saudi IBAN is 24 characters: SA, two check digits, then 20 digits.
  const bban = digits(20);
  const numeric = `${bban}2810` + '00'; // S=28, A=10, then "00"
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  const check = String(98 - remainder).padStart(2, '0');
  return `SA${check}${bban}`;
}
const spaced = (value, size = 4) => value.replace(new RegExp(`(.{${size}})(?=.)`, 'g'), '$1 ');

// --- values ---------------------------------------------------------------------
const FIRST = ['daniel', 'maria', 'omar', 'lina', 'peter', 'hana', 'yusuf', 'nora'];
const LAST = ['whitmore', 'castell', 'haddad', 'nasser', 'lindqvist', 'okafor', 'rahimi', 'salem'];
const password = () => `${pick(['Sunset', 'Falcon', 'Marble', 'Tiger', 'Coral', 'Winter'])}${int(10, 99)}${pick(['!', '#', '$', '@'])}${from(LOWER, 3)}`;
const b64block = (lines) => Array.from({ length: lines }, () => from(B64, 64)).join('\n');

const V = {
  privateKey: () => `-----BEGIN RSA PRIVATE KEY-----\n${b64block(3)}\n-----END RSA PRIVATE KEY-----`,
  certificate: () => `-----BEGIN CERTIFICATE-----\n${b64block(3)}\n-----END CERTIFICATE-----`,
  sshKey: () => `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${from(ALNUM, 43)}`,
  connectionString: () => `${pick(['postgres', 'mongodb', 'mysql', 'redis'])}://app_user:${from(ALNUM, 14)}@db-${int(1, 9)}.internal.example:${pick([5432, 27017, 3306, 6379])}/orders`,
  githubToken: () => `ghp_${from(ALNUM, 36)}`,
  npmToken: () => `npm_${from(ALNUM, 36)}`,
  envSecret: () => `${pick(['DB_PASSWORD', 'STRIPE_SECRET_KEY', 'SESSION_SECRET', 'MAIL_API_KEY'])}=${from(ALNUM, 18)}`,
  jwt: () => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ${from(ALNUM, 34)}.${from(ALNUM, 43)}`,
  openaiKey: () => `sk-proj-${from(ALNUM, 40)}`,
  awsKey: () => `AKIA${from(DIGITS + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 16)}`,
  googleKey: () => `AIza${from(ALNUM, 35)}`,
  slackToken: () => `xoxb-${digits(12)}-${digits(13)}-${from(ALNUM, 24)}`,
  stripeKey: () => `sk_live_${from(ALNUM, 24)}`,
  apiKeyAssignment: () => `api_key = "${from(ALNUM, 28)}"`,
  bearerHeader: () => `Authorization: Bearer ${from(ALNUM, 40)}`,
  password,
  otp: () => digits(6),
  iban: () => (rnd() < 0.5 ? ibanSA() : spaced(ibanSA())),
  card: () => {
    const n = luhnNumber(pick(['4', '51', '52', '55']), 16);
    return rnd() < 0.5 ? n : spaced(n);
  },
  cvv: () => digits(3),
  swift: () => `${from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4)}${pick(['SA', 'AE', 'GB', 'DE'])}${from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 2)}`,
  bankAccount: () => digits(14),
  saudiId: () => luhnNumber(pick(['1', '2']), 10),
  passport: () => `${from(UPPER, 1)}${digits(8)}`,
  ssn: () => `${int(100, 665)}-${int(10, 99)}-${int(1000, 9999)}`,
  licenceId: () => `${from(UPPER, 1)}${digits(8)}`,
  mrn: () => digits(8),
  icd: () => `${pick(['E11', 'J45', 'I10', 'F32', 'K21'])}.${int(0, 9)}`,
  email: () => `${pick(FIRST)}.${pick(LAST)}@${pick(['example.com', 'example.org', 'example.net'])}`,
  saudiMobile: () => (rnd() < 0.5 ? `05${digits(8)}` : `+9665${digits(8)}`),
  intlPhone: () => `+${pick(['1', '44', '49', '971'])} ${int(200, 899)} ${int(200, 899)} ${digits(4)}`,
  ipv4: () => `${pick(['10', '172', '192'])}.${int(16, 254)}.${int(0, 254)}.${int(1, 254)}`,
  ipv6: () => `2001:db8:${from(HEX, 4)}:${from(HEX, 4)}:${from(HEX, 4)}:${from(HEX, 4)}:${from(HEX, 4)}:${from(HEX, 4)}`,
  mac: () => Array.from({ length: 6 }, () => from(HEX, 2).toUpperCase()).join(':'),
  url: () => `https://intranet.example.com/${pick(['reports', 'hr', 'finance', 'projects'])}/${int(2024, 2026)}/doc?id=${int(1000, 99999)}`,
  gps: () => `${int(16, 31)}.${digits(4)}, ${int(36, 55)}.${digits(4)}`,
  vin: () => `1HG${from('BCDEFGHJKLMNPRSTUVWXYZ', 2)}${digits(3)}${from('ABCDEFGHJKLMNPRSTUVWXYZ', 3)}${digits(6)}`,
  saudiVat: () => `3${digits(13)}3`,
  cr: () => `${pick(['1010', '2050', '4030'])}${digits(6)}`,
  windowsPath: () => `C:\\Users\\${pick(FIRST)}.${pick(LAST)}\\Documents\\${pick(['salaries', 'contracts', 'budget'])}_${int(2024, 2026)}.xlsx`,
  unixPath: () => `/home/${pick(FIRST)}/${pick(['app', 'backups', 'projects'])}/config/${pick(['settings', 'database', 'deploy'])}.yml`,
  secretFile: () => pick(['.env', 'id_rsa', 'credentials.json', '.npmrc']),
  uuid: () => `${from(HEX, 8)}-${from(HEX, 4)}-4${from(HEX, 3)}-a${from(HEX, 3)}-${from(HEX, 12)}`,
  hash: () => from(HEX, 64),
  imei: () => luhnNumber('35', 15),
  tracking: () => `${pick(['1Z', 'TRK', 'SMSA'])}${digits(12)}`,
  accountId: () => `CUS-${digits(8)}`,
  dob: () => `${int(1, 28)}/${int(1, 12)}/${int(1965, 2004)}`,
  userAgent: () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${int(120, 131)}.0.0.0 Safari/537.36`,
  studentId: () => `44${digits(7)}`,
  longNumber: () => digits(12),
  personEn: () => `${pick(['Daniel Whitmore', 'Maria Castell', 'Peter Lindqvist', 'Grace Okafor', 'Thomas Brennan', 'Helen Varga'])}`,
  personAr: () => `${pick(['سلمان القحطاني', 'نورة العتيبي', 'فهد الدوسري', 'ريم الشهري', 'عبدالله الحربي', 'هند المطيري'])}`,
  addressEn: () => `${int(10, 9999)} ${pick(['Oak Avenue', 'Maple Street', 'Harbor Road', 'Cedar Lane'])}, Apt ${int(1, 40)}, ${pick(['Springfield', 'Riverton', 'Lakewood'])}`,
  addressAr: () => `شارع ${pick(['الأمير سلطان', 'الملك فهد', 'التحلية', 'العليا'])}، مبنى ${int(1, 90)}، حي ${pick(['الروضة', 'النرجس', 'الملز', 'الشاطئ'])}`,
  username: () => `${pick(FIRST)}_${pick(LAST).slice(0, 4)}${int(10, 99)}`,
  taxId: () => `${int(10, 98)}-${digits(7)}`,
  deviceId: () => `${from(UPPER + DIGITS, 4)}-${from(UPPER + DIGITS, 4)}-${from(UPPER + DIGITS, 4)}-${from(UPPER + DIGITS, 4)}`,
  licenceNumber: () => `${pick(['ML', 'ENG', 'LAW'])}-${digits(6)}`,
  none: () => '',
};

// --- sensitive types: [id, category, model label or '', value, count, en templates, ar templates] ---
const HIGH = 'HIGH';
const MEDIUM = 'MEDIUM';
const LOW = 'LOW';
const TIER = {
  CRYPTO: HIGH, DEV_SECRET: HIGH, AUTH_SECRET: HIGH, FINANCIAL: HIGH, PERSONAL_IDENTITY: HIGH, HEALTH: HIGH,
  CONTACT: MEDIUM, NETWORK: MEDIUM, WEB_LINK: MEDIUM, LOCATION: MEDIUM, VEHICLE: MEDIUM, CORPORATE: MEDIUM,
  FILE_PATH: MEDIUM, FINGERPRINT: MEDIUM, SHIPPING: MEDIUM, ACCOUNT: MEDIUM, DATETIME: MEDIUM, LOGS: MEDIUM,
  EDUCATION: MEDIUM, NUMERIC: MEDIUM, LEGAL: MEDIUM, KEYWORD: LOW,
};

const TYPES = [
  ['private-key', 'CRYPTO', '', V.privateKey, 3, ['Why does this key fail to load on the server?\n{v}', 'Convert this key to PKCS8 format:\n{v}'], ['ليش هذا المفتاح ما يشتغل على السيرفر؟\n{v}', 'حوّل لي هذا المفتاح لصيغة PKCS8:\n{v}']],
  ['certificate', 'CRYPTO', '', V.certificate, 3, ['Can you tell me when this expires?\n{v}', 'Explain the fields of this file:\n{v}'], ['متى تنتهي صلاحية هذه الشهادة؟\n{v}', 'اشرح لي محتوى هذا الملف:\n{v}']],
  ['ssh-key', 'CRYPTO', '', V.sshKey, 3, ['Add this line to authorized_keys for the deploy user: {v}', 'Is this a valid public key? {v}'], ['أضف هذا السطر لملف authorized_keys: {v}', 'هل هذا مفتاح صحيح؟ {v}']],
  ['connection-string', 'DEV_SECRET', '', V.connectionString, 3, ['The app cannot connect with {v} , what is wrong?', 'Rewrite this for a read replica: {v}'], ['التطبيق ما يتصل باستخدام {v} وش المشكلة؟', 'عدّل لي هذا الرابط لقاعدة بيانات ثانية: {v}']],
  ['github-token', 'DEV_SECRET', '', V.githubToken, 3, ['CI fails when I use {v} for the checkout step.', 'I pushed {v} by mistake, how do I clean the history?'], ['الـ CI يفشل لما أستخدم {v} في خطوة السحب.', 'رفعت {v} بالغلط، كيف أنظف السجل؟']],
  ['npm-token', 'DEV_SECRET', '', V.npmToken, 3, ['Publishing fails with {v} as the registry credential, any idea?', 'Where should I store {v} in GitHub Actions?'], ['النشر يفشل مع {v} وش الحل؟', 'وين أحفظ {v} في GitHub Actions؟']],
  ['env-secret', 'DEV_SECRET', '', V.envSecret, 3, ['My config has {v} and the service still refuses to start.', 'Is it fine to keep {v} in docker-compose.yml?'], ['ملف الإعدادات فيه {v} والخدمة ما تشتغل.', 'هل عادي أخلي {v} داخل docker-compose.yml؟']],
  ['jwt', 'AUTH_SECRET', '', V.jwt, 3, ['Decode this for me: {v}', 'Why is this rejected by the gateway? {v}'], ['فك لي هذا: {v}', 'ليش البوابة ترفض هذا؟ {v}']],
  ['openai-key', 'AUTH_SECRET', '', V.openaiKey, 3, ['My script uses {v} and gets a 401.', 'Is {v} in the right format?'], ['السكربت يستخدم {v} ويرجع 401.', 'هل {v} بالصيغة الصحيحة؟']],
  ['aws-key', 'AUTH_SECRET', '', V.awsKey, 3, ['The S3 upload fails with access key {v}.', 'Which IAM user owns {v}?'], ['الرفع على S3 يفشل مع {v}.', 'أي مستخدم IAM يملك {v}؟']],
  ['google-key', 'AUTH_SECRET', '', V.googleKey, 3, ['Maps returns REQUEST_DENIED for {v}.', 'How do I restrict {v} to my domain?'], ['الخرائط ترجع خطأ مع {v}.', 'كيف أقيّد {v} على نطاقي فقط؟']],
  ['slack-token', 'AUTH_SECRET', '', V.slackToken, 3, ['The bot posts nothing when I set {v}.', 'Does {v} have the chat:write scope?'], ['البوت ما يرسل شيء لما أحط {v}.', 'هل {v} عنده صلاحية الكتابة؟']],
  ['stripe-key', 'AUTH_SECRET', '', V.stripeKey, 3, ['Charges fail in production with {v}.', 'Can I rotate {v} without downtime?'], ['عمليات الدفع تفشل مع {v}.', 'أقدر أغيّر {v} بدون توقف؟']],
  ['api-key-assignment', 'AUTH_SECRET', '', V.apiKeyAssignment, 3, ['This line in settings.py looks wrong: {v}', 'Move {v} out of the source file for me.'], ['هذا السطر في الإعدادات شكله غلط: {v}', 'انقل لي {v} خارج ملف الكود.']],
  ['bearer-header', 'AUTH_SECRET', '', V.bearerHeader, 3, ['The request with this header returns 403:\n{v}', 'Turn this into a curl command:\n{v}'], ['الطلب بهذا الترويسة يرجع 403:\n{v}', 'حوّل لي هذا لأمر curl:\n{v}']],
  ['password', 'AUTH_SECRET', 'PASSWORD', V.password, 5, ['my password is {v} and it keeps getting rejected', 'The wifi password: {v} , make a QR code text for it.'], ['كلمة المرور هي {v} وما تقبل معي', 'الباسورد حقي: {v} ابغى أسوي منه QR']],
  ['otp', 'AUTH_SECRET', '', V.otp, 3, ['The verification code is {v} but the site says it expired.', 'My OTP code is {v}, where do I enter it?'], ['رمز التحقق {v} والموقع يقول منتهي.', 'الرقم السري للبطاقة {v} ونسيت وين أغيره.']],
  ['iban', 'FINANCIAL', '', V.iban, 3, ['Please check this IBAN before I send the transfer: {v}', 'Write a payment instruction to {v} for 4,500 riyals.'], ['تأكد لي من هذا الآيبان قبل التحويل: {v}', 'اكتب أمر تحويل إلى {v} بمبلغ 4500 ريال.']],
  ['card', 'FINANCIAL', 'CREDIT_CARD', V.card, 5, ['The payment page rejects my card {v}.', 'Fill this refund form, card number {v}.'], ['صفحة الدفع ترفض بطاقتي {v}.', 'عبّي نموذج الاسترجاع، رقم البطاقة {v}.']],
  ['cvv', 'FINANCIAL', 'CREDIT_CARD_CVV', V.cvv, 5, ['The CVV is {v} and the bank still declines.', 'They asked for cvv {v} over the phone, is that normal?'], ['رمز الأمان {v} والبنك يرفض العملية.', 'طلبوا مني cvv {v} بالتلفون، هل هذا طبيعي؟']],
  ['swift', 'FINANCIAL', '', V.swift, 3, ['The SWIFT code {v} is not accepted by the form.', 'Which bank has BIC {v}?'], ['نموذج التحويل ما يقبل swift code {v}.', 'أي بنك له swift {v}؟']],
  ['bank-account', 'FINANCIAL', 'BANK_ACCOUNT', V.bankAccount, 5, ['Salary should go to account number {v} from next month.', 'Bank account no {v} was debited twice.'], ['حوّلوا الراتب على رقم الحساب {v} من الشهر الجاي.', 'رقم الحساب {v} انخصم منه مرتين.']],
  ['saudi-id', 'PERSONAL_IDENTITY', 'NATIONAL_ID', V.saudiId, 5, ['Fill in the form for the employee with national ID {v}.', 'The applicant, ID {v}, asks for a reference letter.'], ['عبّي النموذج للموظف صاحب الهوية {v}.', 'المتقدم برقم {v} يطلب خطاب تعريف.']],
  ['passport', 'PERSONAL_IDENTITY', 'PASSPORT', V.passport, 5, ['Book the flight with passport number {v}.', 'My passport {v} expires in March, can I still travel?'], ['احجز الرحلة برقم الجواز {v}.', 'جواز السفر {v} ينتهي في مارس، أقدر أسافر؟']],
  ['ssn', 'PERSONAL_IDENTITY', '', V.ssn, 3, ['The tax form needs my social security number, {v}.', 'Is it safe to email {v} to HR?'], ['نموذج الضريبة يطلب الرقم {v}.', 'هل آمن أرسل {v} للموارد البشرية بالإيميل؟']],
  ['licence-id', 'PERSONAL_IDENTITY', 'DRIVER_LICENSE', V.licenceId, 5, ["Renew the driver's license number {v} online.", 'Update the record for employee id {v}.'], ['جدّد لي رخصة القيادة، رقم الإقامة {v}.', 'حدّث سجل الموظف، رقم الهوية {v}.']],
  ['mrn', 'HEALTH', 'MEDICAL_ID', V.mrn, 5, ['Summarise the visit notes for MRN {v}.', 'The lab result belongs to medical record number {v}.'], ['لخّص ملاحظات الزيارة، رقم الملف الطبي {v}.', 'نتيجة التحليل تخص رقم الملف الطبي {v}.']],
  ['icd', 'HEALTH', '', V.icd, 3, ['The patient was given diagnosis code {v}, what does it mean for insurance?', 'Explain ICD-10 code {v} in simple words for the family.'], ['المريض تشخيصه diagnosis code {v} وش يعني للتأمين؟', 'اشرح ICD-10 code {v} لأهل المريض.']],
  ['email', 'CONTACT', 'EMAIL', V.email, 5, ['Please reply to {v} about the invoice.', 'Add {v} to the meeting invite.'], ['رد على {v} بخصوص الفاتورة.', 'أضف {v} لدعوة الاجتماع.']],
  ['saudi-mobile', 'CONTACT', 'PHONE', V.saudiMobile, 4, ['Call me back on {v} after five.', 'Send the delivery code to {v}.'], ['كلمني على {v} بعد العصر.', 'أرسل رمز التوصيل على {v}.']],
  ['intl-phone', 'CONTACT', 'PHONE', V.intlPhone, 3, ['The supplier can be reached at {v}.', 'Format {v} for a business card.'], ['المورد رقمه {v}.', 'نسّق لي {v} لبطاقة العمل.']],
  ['ipv4', 'NETWORK', 'IP_ADDRESS', V.ipv4, 4, ['The server at {v} stopped answering pings.', 'Open port 443 on {v} in the firewall rule.'], ['السيرفر {v} ما يرد على ping.', 'افتح منفذ 443 على {v} في الجدار الناري.']],
  ['ipv6', 'NETWORK', 'IP_ADDRESS', V.ipv6, 3, ['Why can I not reach {v} from the office?', 'Add a AAAA record for {v}.'], ['ليش ما أوصل لـ {v} من المكتب؟', 'أضف سجل AAAA للعنوان {v}.']],
  ['mac', 'NETWORK', 'MAC_ADDRESS', V.mac, 5, ['Whitelist the laptop with MAC {v} on the router.', 'Which vendor makes the card {v}?'], ['اسمح للابتوب صاحب الماك {v} على الراوتر.', 'أي شركة تصنع الكرت {v}؟']],
  ['url', 'WEB_LINK', '', V.url, 5, ['Summarise the page at {v}.', 'The link {v} gives a 404 for my colleague.'], ['لخّص الصفحة {v}.', 'الرابط {v} ما يفتح عند زميلي.']],
  ['gps', 'LOCATION', 'COORDINATE', V.gps, 5, ['The site is at {v}, how far is it from the port?', 'Put a pin at {v} on the map for the driver.'], ['الموقع عند {v} كم يبعد عن الميناء؟', 'حط علامة عند {v} للسائق.']],
  ['vin', 'VEHICLE', 'VEHICLE_ID', V.vin, 5, ['Check the recall status of the car with VIN {v}.', 'The insurance form asks for chassis number {v}.'], ['تأكد من استدعاءات السيارة، رقم الهيكل {v}.', 'نموذج التأمين يطلب رقم الهيكل {v}.']],
  ['saudi-vat', 'CORPORATE', 'TAX_ID', V.saudiVat, 3, ['Put VAT number {v} on the invoice template.', 'Is {v} a valid VAT registration?'], ['حط الرقم الضريبي {v} في قالب الفاتورة.', 'هل {v} رقم ضريبي صحيح؟']],
  ['cr', 'CORPORATE', '', V.cr, 3, ['Our commercial registration {v} needs renewing.', 'The contract must mention CR number {v}.'], ['السجل التجاري {v} يحتاج تجديد.', 'العقد لازم يذكر السجل التجاري {v}.']],
  ['windows-path', 'FILE_PATH', '', V.windowsPath, 3, ['Excel cannot open {v} since the update.', 'Write a script that backs up {v} every night.'], ['الإكسل ما يفتح {v} بعد التحديث.', 'اكتب سكربت ينسخ {v} كل ليلة.']],
  ['unix-path', 'FILE_PATH', '', V.unixPath, 3, ['The service cannot read {v} , permission denied.', 'What should the owner of {v} be?'], ['الخدمة ما تقدر تقرأ {v} بسبب الصلاحيات.', 'مين لازم يكون مالك الملف {v} ؟']],
  ['secret-file', 'FILE_PATH', '', V.secretFile, 3, ['I committed my {v} file, what now?', 'Should {v} be listed in .gitignore?'], ['رفعت ملف {v} بالغلط، وش أسوي؟', 'هل لازم أضيف {v} في gitignore؟']],
  ['uuid', 'FINGERPRINT', '', V.uuid, 3, ['Find the log lines for session {v}.', 'The record {v} is duplicated in two tables.'], ['طلّع لي سطور السجل للجلسة {v}.', 'السجل {v} مكرر في جدولين.']],
  ['hash', 'FINGERPRINT', '', V.hash, 3, ['Does the checksum {v} match the download?', 'Which algorithm produced {v}?'], ['هل البصمة {v} تطابق الملف؟', 'أي خوارزمية طلّعت {v}؟']],
  ['imei', 'FINGERPRINT', 'DEVICE_ID', V.imei, 3, ['Block the stolen phone, IMEI {v}.', 'The carrier asks for imei {v} to unlock it.'], ['احظر الجوال المسروق، IMEI {v}.', 'شركة الاتصالات تطلب imei {v} لفتح القفل.']],
  ['tracking', 'SHIPPING', '', V.tracking, 5, ['Where is the parcel with tracking number {v}?', 'The courier lost shipment, tracking no {v}.'], ['وين وصلت الشحنة، رقم التتبع {v}؟', 'شركة الشحن ضيعت الطرد، رقم الشحنة {v}.']],
  ['account-id', 'ACCOUNT', 'ACCOUNT_ID', V.accountId, 5, ['Close the subscription for customer id {v}.', 'Customer number {v} was billed twice.'], ['أغلق اشتراك العميل، رقم العميل {v}.', 'رقم العميل {v} انحسب عليه مرتين.']],
  ['dob', 'DATETIME', 'DATE_OF_BIRTH', V.dob, 5, ['The form needs my date of birth, {v}.', 'Patient birth date {v}, calculate the age today.'], ['النموذج يطلب تاريخ الميلاد {v}.', 'تاريخ ميلاد المريض {v} احسب العمر.']],
  ['user-agent', 'LOGS', '', V.userAgent, 5, ['What browser is this from our access log?\n{v}', 'Parse this header line:\n{v}'], ['أي متصفح هذا من سجل الدخول؟\n{v}', 'حلل لي هذا السطر:\n{v}']],
  ['student-id', 'EDUCATION', '', V.studentId, 5, ['Register student id {v} for the makeup exam.', 'The transcript for university id {v} has a wrong grade.'], ['سجّل الطالب صاحب الرقم الجامعي {v} في الاختبار البديل.', 'كشف الدرجات للرقم الجامعي {v} فيه درجة غلط.']],
  ['long-number', 'NUMERIC', '', V.longNumber, 5, ['My insurance policy {v} was cancelled without notice.', 'The meter {v} shows a wrong reading.'], ['وثيقة التأمين حقتي {v} انلغت بدون إشعار.', 'العداد {v} قراءته غلط.']],
  ['keyword-only', 'KEYWORD', '', V.none, 6, ['How should a small team store a shared password safely?', 'Explain what a refresh token is in OAuth.', 'Write a notice that this document is confidential.'], ['ما أفضل طريقة لحفظ كلمة المرور بين فريق صغير؟', 'اشرح لي وش هو التوكن في OAuth.', 'اكتب تنبيه أن هذه معلومات سرية.']],
  // Types only the detection model can find.
  ['person', 'PERSONAL_IDENTITY', 'PERSON', null, 6, ['Please draft an offer letter for {en}.', 'Write a short reference for my colleague {en}.', '{en} complained about the last delivery, write an apology.'], ['اكتب خطاب شكر للموظف {ar}.', 'جهّز تقييم أداء لـ {ar}.', 'العميلة {ar} تشتكي من التأخير، اكتب رد اعتذار.']],
  ['address', 'LOCATION', 'STREET_ADDRESS', null, 6, ['Deliver the documents to {en} before noon.', 'The tenant at {en} is two months late on rent.', 'Send the technician to {en} tomorrow.'], ['وصّل الأوراق إلى {ar} قبل الظهر.', 'المستأجر في {ar} متأخر شهرين.', 'أرسل الفني إلى {ar} بكرة.']],
  ['username', 'ACCOUNT', 'USERNAME', V.username, 6, ['My username is {v} and I cannot log in.', 'Reset the account of user {v} please.', 'The login {v} is locked after three tries.'], ['اسم المستخدم حقي {v} وما أقدر أدخل.', 'أعد تفعيل حساب المستخدم {v}.', 'الحساب {v} انقفل بعد ثلاث محاولات.']],
  ['tax-id', 'CORPORATE', 'TAX_ID', V.taxId, 6, ['Our tax ID is {v}, put it on the W-9.', 'The vendor form asks for the employer tax ID {v}.', 'Is tax identification number {v} formatted correctly?'], ['الرقم الضريبي للشركة {v} أضفه للنموذج.', 'نموذج المورد يطلب الرقم الضريبي {v}.', 'هل الرقم الضريبي {v} مكتوب صح؟']],
  ['device-id', 'FINGERPRINT', 'DEVICE_ID', V.deviceId, 6, ['The tablet with device ID {v} will not sync.', 'Unenroll device id {v} from the MDM.', 'Serial number {v} is still under warranty?'], ['التابلت صاحب معرّف الجهاز {v} ما يتزامن.', 'احذف الجهاز {v} من نظام الإدارة.', 'الرقم التسلسلي {v} عليه ضمان؟']],
  ['licence-number', 'LEGAL', 'LICENSE_NUMBER', V.licenceNumber, 6, ['Verify the medical license number {v} with the council.', 'The lawyer practises under license no {v}.', 'Our contractor license {v} expires next month.'], ['تحقق من رقم الترخيص الطبي {v} مع الهيئة.', 'المحامي يعمل برخصة رقم {v}.', 'رخصة المقاول {v} تنتهي الشهر الجاي.']],
];

// --- prompts with several findings, and mixed-language prompts -------------------
const MULTI = [
  ['en', ['CONTACT', 'PERSONAL_IDENTITY'], HIGH, () => `Send the onboarding pack to ${V.email()} and file it under national ID ${V.saudiId()}.`],
  ['en', ['AUTH_SECRET', 'CONTACT'], HIGH, () => `Log in as ${V.email()} with password: ${V.password()} and export the report.`],
  ['en', ['FINANCIAL', 'CONTACT'], HIGH, () => `Refund card ${V.card()} and confirm by SMS to ${V.saudiMobile()}.`],
  ['en', ['NETWORK', 'DEV_SECRET'], HIGH, () => `From ${V.ipv4()} the app connects with ${V.connectionString()} and times out.`],
  ['en', ['CONTACT', 'WEB_LINK'], MEDIUM, () => `Ask ${V.email()} to review ${V.url()} today.`],
  ['ar', ['CONTACT', 'FINANCIAL'], HIGH, () => `حوّل المبلغ على الآيبان ${ibanSA()} وأرسل الإيصال على ${V.email()}.`],
  ['ar', ['PERSONAL_IDENTITY', 'CONTACT'], HIGH, () => `الموظف صاحب الهوية ${V.saudiId()} جواله ${V.saudiMobile()} حدّث بياناته.`],
  ['ar', ['AUTH_SECRET', 'NETWORK'], HIGH, () => `السيرفر ${V.ipv4()} كلمة المرور هي ${V.password()} وما يدخل.`],
  ['mixed', ['CONTACT'], MEDIUM, () => `ابغى أرسل meeting invite لـ ${V.email()} بخصوص الـ budget review.`],
  ['mixed', ['AUTH_SECRET'], HIGH, () => `الـ deploy فشل لأن الـ key هذا ${V.openaiKey()} مو شغال في production.`],
  ['mixed', ['NETWORK'], MEDIUM, () => `الـ server حقنا ${V.ipv4()} عليه latency عالي من أمس.`],
  ['mixed', ['FINANCIAL'], HIGH, () => `الـ payment gateway يرفض الـ card رقم ${V.card()} في الـ checkout.`],
  ['mixed', ['DEV_SECRET'], HIGH, () => `سويت push بالغلط وفيه ${V.githubToken()} داخل الـ repo.`],
  ['mixed', ['CONTACT'], MEDIUM, () => `كلم الـ client على ${V.saudiMobile()} وأكد معه الـ delivery date.`],
  ['mixed', ['FINGERPRINT'], MEDIUM, () => `الـ request صاحب الـ id ${V.uuid()} رجع error 500.`],
  ['mixed', ['WEB_LINK'], MEDIUM, () => `شف الـ dashboard هنا ${V.url()} وقل لي وش الـ issue.`],
];

// --- clean prompts ----------------------------------------------------------------
const CLEAN_EN = [
  'What is the capital of France?', 'Explain the difference between TCP and UDP in simple terms.',
  'Write a Python function that removes duplicates from a list while keeping the order.',
  'Give me five ideas for a team-building activity for ten people.', 'Rewrite this sentence to sound more polite: send me the file today.',
  'Plan a three-day trip to Istanbul for a family with two kids.', "Translate 'thank you for your patience' into Spanish.",
  'Write a short agenda for a weekly project status meeting.', 'What are the main causes of inflation?',
  'Suggest a healthy lunch that takes under fifteen minutes to make.', 'How does a binary search work?',
  'Write a haiku about rain in the desert.', 'Summarise the plot of Hamlet in three sentences.',
  'What is the difference between a list and a tuple in Python?', 'Draft a polite out-of-office reply for next week.',
  'How do vaccines train the immune system?', 'Give me a stretching routine for people who sit all day.',
  'Explain what a REST API is to a new intern.', 'What should I check before buying a used laptop?',
  'Write a SQL query that counts rows per month in a sales table.', 'How do I centre a div with CSS grid?',
  'Suggest three names for a neighbourhood bakery.', 'What are good questions to ask in a job interview?',
  'Explain compound interest with a small example.', 'How can I improve the battery life of my phone?',
  'Write a thank-you note to a teacher at the end of the year.', 'What is the best way to learn touch typing?',
  'Describe how photosynthesis works for a ten-year-old.',
];
const CLEAN_AR = [
  'ما هي عاصمة اليابان؟', 'اشرح لي الفرق بين الذاكرة العشوائية والتخزين بشكل مبسط.',
  'اكتب لي دالة بايثون ترتب قائمة أرقام تصاعديًا.', 'أعطني خمس أفكار لنشاط جماعي لفريق من عشرة أشخاص.',
  'أعد صياغة هذه الجملة بأسلوب رسمي: أرسل لي الملف اليوم.', 'اقترح لي برنامج رحلة ثلاثة أيام في أبها مع العائلة.',
  'ترجم عبارة شكرًا على صبركم إلى الإنجليزية.', 'اكتب جدول أعمال قصير لاجتماع أسبوعي لمتابعة المشروع.',
  'ما أسباب ارتفاع الأسعار؟', 'اقترح وجبة غداء صحية تجهز في ربع ساعة.',
  'كيف يعمل البحث الثنائي؟', 'اكتب بيتين شعر عن المطر في الصحراء.',
  'لخّص لي قصة كليلة ودمنة في ثلاث جمل.', 'ما الفرق بين القائمة والقاموس في بايثون؟',
  'اكتب رد تلقائي مهذب للإجازة الأسبوع القادم.', 'كيف تعمل اللقاحات؟',
  'أعطني تمارين إطالة لمن يجلس طول اليوم.', 'اشرح لي وش هو الـ API لمتدرب جديد.',
  'وش أتأكد منه قبل ما أشتري لابتوب مستعمل؟', 'اكتب استعلام SQL يحسب عدد الطلبات لكل شهر.',
  'كيف أوسّط عنصر في الصفحة باستخدام CSS؟', 'اقترح ثلاثة أسماء لمخبز في الحي.',
  'ما الأسئلة الجيدة التي أسألها في مقابلة العمل؟', 'اشرح الفائدة المركبة بمثال بسيط.',
  'كيف أطوّل عمر بطارية الجوال؟', 'اكتب رسالة شكر لمعلم في نهاية السنة.',
  'كيف أتعلم الكتابة السريعة على الكيبورد؟',
];
// Hard negatives: things that look like sensitive data and are not.
const HARD_EN = [
  'Upgrade the package to version 2.14.3 please.', 'Does Node 20.11.1 support the fetch API?',
  'We moved from release 1.2.3.4 to 1.2.3.5 last night.', 'Order 4521 arrived late, write a complaint to the shop.',
  'Ticket #88213 is still open, how do I escalate it?', 'The speed of light is 299792458 metres per second, right?',
  'The world population passed 8000000000 in 2022, what changed?', 'Compare the cloud pricing of Microsoft, Google and Amazon.',
  'Who was Albert Einstein and what is he known for?', 'Summarise the career of Marie Curie in a paragraph.',
  'What happened on 12 March 2025 in the tech news?', 'The meeting is on 2026-01-15 at 10:30, write a reminder.',
  'Is 3.14159265358979 enough digits of pi for engineering?', 'ISBN 9780131103627 is which book?',
  'The invoice total is 12,450.00 riyals, write it in words.', 'Call 911 or 112 in an emergency, which one works in Europe?',
  'Use the colour #1a2b3c for the header and #ffffff for text.', 'Chapter 10.2.1 of the manual explains the reset procedure.',
  'The flight SV1021 leaves from gate 14 at 18:45.', 'Riyadh, Jeddah and Dammam are the three largest Saudi cities.',
  'Explain what the placeholder [EMAIL_1] means in a masked message.', 'Our office is open from 8 to 5, Sunday to Thursday.',
  'The model has 141000000 parameters, is that small?', 'Apple released the first iPhone in 2007.',
  'Room 2041 on floor 20 is booked for the workshop.',
];
const HARD_AR = [
  'حدّث المكتبة إلى الإصدار 2.14.3 لو سمحت.', 'هل الإصدار 20.11.1 من Node يدعم fetch؟',
  'انتقلنا من النسخة 1.2.3.4 إلى 1.2.3.5 البارحة.', 'الطلب 4521 وصل متأخر، اكتب شكوى للمتجر.',
  'التذكرة رقم 88213 ما زالت مفتوحة، كيف أصعّدها؟', 'سرعة الضوء 299792458 متر في الثانية، صح؟',
  'عدد سكان العالم تجاوز 8000000000 في 2022، وش تغيّر؟', 'قارن أسعار الخدمات السحابية بين مايكروسوفت وجوجل وأمازون.',
  'من هو ابن سينا وبماذا اشتهر؟', 'لخّص سيرة الخوارزمي في فقرة.',
  'ماذا حدث يوم 12 مارس 2025 في أخبار التقنية؟', 'الاجتماع يوم 2026-01-15 الساعة 10:30، اكتب تذكير.',
  'هل 3.14159265358979 كافية كقيمة تقريبية لـ ط؟', 'الكتاب صاحب الرقم الدولي 9780131103627 وش اسمه؟',
  'إجمالي الفاتورة 12,450.00 ريال، اكتبه بالحروف.', 'أتصل على 997 أو 911 في الطوارئ؟',
  'استخدم اللون #1a2b3c للعنوان و #ffffff للنص.', 'الفصل 10.2.1 من الدليل يشرح طريقة إعادة الضبط.',
  'الرحلة SV1021 تقلع من البوابة 14 الساعة 18:45.', 'الرياض وجدة والدمام أكبر ثلاث مدن سعودية.',
  'اشرح معنى العلامة [EMAIL_1] في رسالة معدّلة.', 'دوامنا من 8 إلى 5 من الأحد إلى الخميس.',
  'النموذج فيه 141000000 معامل، هل يعتبر صغير؟', 'أرامكو أعلنت نتائجها السنوية، لخّص أهم الأرقام المنشورة.',
  'القاعة 2041 في الدور 20 محجوزة للورشة.',
];

// --- labelling rule for KEYWORD ---------------------------------------------------
const KEYWORD_WORDS = /(?<![A-Za-z0-9_])(?:password|passwd|secret|token|api[_ -]?key|authorization|ssn|dob|confidential|credentials)(?![A-Za-z0-9_])|كلمة\s*(?:ال)?(?:مرور|سر)|باسو?ورد|الرقم\s*السري|مفتاح\s*(?:ال)?سري|توكن|سري\s*للغاية|(?:معلومات|بيانات)\s*سرية/i;

function maxRisk(categories, label) {
  const rank = { SAFE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  let best = 'SAFE';
  for (const c of categories) {
    // A person's name alone is MEDIUM, although its category is HIGH.
    const tier = c === 'PERSONAL_IDENTITY' && label === 'PERSON' ? MEDIUM : TIER[c];
    if (rank[tier] > rank[best]) best = tier;
  }
  return best;
}

const cases = [];
let n = 0;
function add(lang, kind, type, categories, modelLabel, text, risk) {
  const set = new Set(categories);
  if (kind === 'sensitive' && KEYWORD_WORDS.test(text)) set.add('KEYWORD');
  n += 1;
  cases.push({
    id: `${lang}-${String(n).padStart(3, '0')}`,
    lang,
    kind,
    type,
    expectedCategories: [...set].sort(),
    modelLabel: modelLabel || undefined,
    expectedRisk: risk ?? maxRisk(set, modelLabel),
    text,
  });
}

for (const [id, category, modelLabel, value, count, en, ar] of TYPES) {
  for (let i = 0; i < count; i += 1) {
    const lang = i % 2 === 0 ? 'en' : 'ar';
    const templates = lang === 'en' ? en : ar;
    const template = templates[Math.floor(i / 2) % templates.length];
    let text;
    if (id === 'person') text = template.replace('{en}', V.personEn()).replace('{ar}', V.personAr());
    else if (id === 'address') text = template.replace('{en}', V.addressEn()).replace('{ar}', V.addressAr());
    else text = template.replace('{v}', value());
    add(lang, 'sensitive', id, [category], modelLabel, text);
  }
}
for (const [lang, categories, risk, make] of MULTI) add(lang, 'sensitive', 'multi', categories, '', make(), risk);
for (const text of CLEAN_EN) add('en', 'clean', 'ordinary', [], '', text, 'SAFE');
for (const text of CLEAN_AR) add('ar', 'clean', 'ordinary', [], '', text, 'SAFE');
for (const text of HARD_EN) add('en', 'clean', 'hard-negative', [], '', text, 'SAFE');
for (const text of HARD_AR) add('ar', 'clean', 'hard-negative', [], '', text, 'SAFE');

const count = (f) => cases.filter(f).length;
const summary = {
  total: cases.length,
  sensitive: count((c) => c.kind === 'sensitive'),
  clean: count((c) => c.kind === 'clean'),
  hardNegatives: count((c) => c.type === 'hard-negative'),
  byLanguage: { en: count((c) => c.lang === 'en'), ar: count((c) => c.lang === 'ar'), mixed: count((c) => c.lang === 'mixed') },
  perCategory: Object.fromEntries(
    [...new Set(cases.flatMap((c) => c.expectedCategories))].sort().map((cat) => [cat, count((c) => c.expectedCategories.includes(cat))]),
  ),
  perModelLabel: Object.fromEntries(
    [...new Set(cases.map((c) => c.modelLabel).filter(Boolean))].sort().map((l) => [l, count((c) => c.modelLabel === l)]),
  ),
};

mkdirSync('docs/gp2-evidence/accuracy', { recursive: true });
const full = JSON.stringify(
    {
      $comment:
        'Labelled accuracy set for the Hares AI extension (GP2 evidence, E1). Generated by eval/accuracy/build-dataset.mjs with a fixed seed. All values are synthetic. expectedCategories = what a person would say the prompt contains; a prompt that uses a sensitive word (password, token, secret...) is also labelled KEYWORD. modelLabel = the detection-model label the prompt was written to exercise, if any.',
      summary,
      cases,
    },
    null,
    2,
);
// The full set stays on this machine (it is in .gitignore): its synthetic keys
// and tokens have the shape of real ones, and the repository host refuses a
// push that contains them. The same seed always produces the same file.
writeFileSync('docs/gp2-evidence/accuracy/dataset.json', full);

// The committed copy leaves out the text of prompts that carry a credential-shaped value.
const CREDENTIAL_CATEGORIES = new Set(['CRYPTO', 'DEV_SECRET', 'AUTH_SECRET']);
const withheld = (c) => c.expectedCategories.some((cat) => CREDENTIAL_CATEGORIES.has(cat));
writeFileSync(
  'docs/gp2-evidence/accuracy/dataset-public.json',
  JSON.stringify(
    {
      $comment:
        'Committed copy of the labelled accuracy set. Same cases and labels as dataset.json, but the text of prompts that contain a synthetic key, token, password or certificate is left out (text: null), because such values look real to secret scanners. Run `node eval/accuracy/build-dataset.mjs` to produce the full dataset.json; its SHA-256 must equal fullDatasetSha256.',
      fullDatasetSha256: createHash('sha256').update(full).digest('hex'),
      summary: { ...summary, textWithheld: cases.filter(withheld).length },
      cases: cases.map((c) => (withheld(c) ? { ...c, text: null } : c)),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary, null, 2));
