/* إشعار EdfaPay الموقَّع — اختبار سلوكي على السيرفر الحقيقي.
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور Supabase وتلقرام.

   الشكل من توثيقهم حرفاً بحرف (Webhook · Webhook Validation · Webhook Payloads):
   POST بـ`Content-Type: text/plain`، وترويسة `X-EdfaPay-Signature` =
   HMAC-SHA256(السرّ، الجسم كما وصل) بصيغة hex، والجسم مثالهم نفسه.

   أخطار يمسكها:
   ١) **إشعار مزوّر يُقبل**: توقيع غلط، أو بلا توقيع، أو جسم تغيّر بعد التوقيع.
   ٢) **الإشعار الصحيح يُرفض**: لو السيرفر حلّل JSON وأعاده نصاً قبل التوقيع،
      `100.00` تصير `100` فما يطابق أبداً — مثالهم نفسه فيه `100.00`.
   ٣) **بلا سرّ في Render الإشعار مفتوح للكل** — لازم يكون مقفلاً.
   ٤) **الرفض بلا سبب**: محمد يجرّب من لوحة EdfaPay ويشوف ٤٠١ وبس — الرد
      يقول رمز سببه، واللوحة تقول وش يسوي.
   ٥) **السرّ أو التوقيع في السجل أو اللوحة** — أطوال وأسباب بس.
   ٦) **علامات الاتجاه المخفية** من النسخ على الجوال في Render ما تكسر المطابقة.

   node tests/test-edfapay-hook.js [server.js]
   (يشغّل نفسه مرتين إضافيتين كعمليتين مستقلتين: بلا سرّ · سرّ لُصق بحروف
    مخفية — المتغيّرات تُقرأ مرة عند الإقلاع) */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=on').slice(7);

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${MODE}] ` + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const https = require('https');
https.request = function (opts, cb) {
  const req = {
    on() { return req }, setTimeout() { return req }, destroy() {}, write() {},
    end() {
      const txt = (opts.hostname || '') === 'api.telegram.org'
        ? JSON.stringify({ ok: true, result: { message_id: 1 } }) : '[]';
      const res = new Readable({ read() { this.push(txt); this.push(null) } });
      res.statusCode = 200; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const SECRET = 'ep-hook-secret-7f3a91c2d4b8e6';
const BASES = { on: 48600, nosecret: 48700, hidden: 48800 };
const PORT = BASES[MODE] + (process.pid % 100);
Object.assign(process.env, {
  EDFAPAY_WEBHOOK_SECRET: { on: SECRET, nosecret: '',
    /* لُصق في Render من رسالة عربية على الجوال: علامتا اتجاه وسطر جديد */
    hidden: '‏' + SECRET + '‎ \n' }[MODE],
  EDFAPAY_API_KEY: MODE === 'on' ? 'ep-api-key-for-tests' : '',
  SITE_ENV: 'prod', PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests', ADMIN_CHAT_ID: '5555',
  ACTIVE_TERM: '203010', FREE_BETA: 'true', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', TELEGRAM_TOKEN: 'tg'
});
const realLog = console.log;
/* سجل السيرفر محفوظ لا مطبوع: نفحص إن سطوره ما فيها السرّ ولا توقيع أبداً */
const LOGS = [];
console.log = (...a) => { LOGS.push(a.map(String).join(' ')) };
require(SRV);

/* مثال توثيقهم (Webhook Validation) كما هو — بمسافاته و`100.00` */
const DOC_BODY = `{
  "transactionId": "123e4567-e89b-12d3-a456-426614174000",
  "orderId": "ORDER-12345",
  "amount": 100.00,
  "currencyCode": "682",
  "cardScheme": "Visa",
  "cardNumber": "4111 **** **** 1111",
  "cardChannel": "PHYSICAL_CARD",
  "status": "Success",
  "channel": "Payment Gateway",
  "type": "Purchase",
  "createdAt": "2026-08-03T12:00:00Z",
  "finishedAt": "2026-08-03T12:00:05Z",
  "merchantId": "11111111-2222-3333-4444-555555555555",
  "cardToken": "TKN-12345678-1234-1234-1234-123456789012",
  "pgDetails": {
    "reason": "Approved"
  },
  "rrn": "123456789012"
}`;
/* ومثال «Approved» من Webhook Payloads — برقم طلب من طلباتنا */
const APPROVED = orderId => JSON.stringify({
  transactionId: '7fcae16d-4035-43e4-806b-87b51881135e', orderId, amount: 19.0,
  currencyCode: '682', cardScheme: 'MasterCard', status: 'Approved', channel: 'Payment Gateway',
  type: 'Purchase', createdAt: '2026-04-02T14:09:30.764985', finishedAt: '2026-04-02T14:10:46.397810922',
  merchantId: '7da313e4-5424-4527-befc-53d81c977b1f', pgDetails: { reason: null }, rrn: '609211300976' });
const sign = (raw, secret) => crypto.createHmac('sha256', secret || SECRET).update(raw).digest('hex');

function post(raw, sig, extra) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const h = Object.assign({ 'Content-Type': 'text/plain', 'Content-Length': buf.length }, extra || {});
    if (sig !== undefined) h['X-EdfaPay-Signature'] = sig;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/edfapay/webhook', method: 'POST', headers: h },
      res => {
        let o = ''; res.on('data', c => o += c);
        res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
      });
    r.on('error', reject); r.end(buf);
  });
}
function admin() {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/admin/pay', method: 'GET',
      headers: { 'X-Admin-Token': 'admin-token-for-tests' } }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = {} } resolve({ raw: o, j }) });
    });
    r.on('error', reject); r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const noSecretAnywhere = (what, s, sigs) => {
  ok(!String(s).includes(SECRET), `**${what} ما فيه السرّ**`);
  ok(!(sigs || []).some(x => String(s).toLowerCase().includes(x.toLowerCase())), `**ولا التوقيع** (${what})`);
};

async function onSuite() {
  const sigs = [];
  /* ── ١) مثال توثيقهم كما هو ⇒ ٢٠٠ ── */
  const s1 = sign(DOC_BODY); sigs.push(s1);
  let r = await post(DOC_BODY, s1);
  eq([r.code, r.j && r.j.ok], [200, true], '**مثال توثيقهم بتوقيعه ⇒ ٢٠٠** (الجسم كما وصل، بـ100.00)');
  let a = (await admin()).j || {};
  eq([a.keySet, a.hookSet, a.hookLen], [true, true, SECRET.length], 'اللوحة: المفتاح والسرّ مضبوطان وطول السرّ');
  let L = a.hookLast || {};
  eq([L.ok, L.why, L.json, L.status, L.type, L.order], [true, 'ok', true, 'Success', 'Purchase', 'other'],
     'آخر إشعار: مقبول · حالته ونوعه · ورقم طلب مو من طلباتنا ما يُعرض');
  ok(L.okAt === L.at, 'ووقت آخر مقبول');

  /* ── ٢) التوقيع على الجسم المعاد تنسيقه ⇒ مرفوض: السيرفر لازم يوقّع البايتات كما وصلت ── */
  const reser = JSON.stringify(JSON.parse(DOC_BODY));
  ok(!reser.includes('100.00'), '(تأكيد: إعادة التنسيق تغيّر 100.00)');
  r = await post(DOC_BODY, sign(reser));
  eq([r.code, r.j && r.j.why], [401, 'bad-signature'], 'توقيع على نسخة معاد تنسيقها ⇒ مرفوض');

  /* ── ٣) hex بحروف كبيرة ⇒ نفس التوقيع ── */
  const body2 = APPROVED('JDW-77'), s2 = sign(body2); sigs.push(s2);
  r = await post(body2, s2.toUpperCase());
  eq(r.code, 200, 'التوقيع بحروف hex كبيرة يُقبل');
  L = (await admin()).j.hookLast;
  eq([L.status, L.type, L.order], ['Approved', 'Purchase', 'JDW-77'], 'ورقم طلبنا يُعرض (JDW-77)');

  /* ── ٤) مزوّر ── */
  r = await post(body2, sign(body2, 'other-secret'));
  eq([r.code, r.j && r.j.why], [401, 'bad-signature'], '**سرّ ثاني ⇒ ٤٠١ bad-signature**');
  const forged = body2.replace('"amount":19', '"amount":1');
  ok(forged !== body2, '(تأكيد: غيّرنا المبلغ)');
  r = await post(forged, s2);
  eq([r.code, r.j && r.j.why], [401, 'bad-signature'], '**الجسم تغيّر بعد التوقيع (المبلغ) ⇒ ٤٠١**');
  r = await post(body2);
  eq([r.code, r.j && r.j.why], [401, 'no-signature'], '**بلا ترويسة توقيع ⇒ ٤٠١ no-signature**');
  r = await post(body2, '');
  eq([r.code, r.j && r.j.why], [401, 'no-signature'], 'ترويسة فاضية ⇒ no-signature');
  r = await post(body2, s2.slice(0, 40));
  eq([r.code, r.j && r.j.why], [401, 'bad-signature'], 'توقيع ناقص ⇒ bad-signature');
  L = (await admin()).j.hookLast;
  eq([L.ok, L.why, L.want, L.sigLen], [false, 'bad', SECRET.length, 40], 'اللوحة: مرفوض · السبب · الأطوال');
  ok(L.okAt && L.okAt !== L.at, '**وآخر مقبول باقٍ** — الرفض بعده ما يغطّيه');
  ok(L.status === undefined && L.order === undefined, '**جسم مرفوض ما يُقرأ منه شي**');

  /* ── ٥) جسم مو JSON لكن موقَّع ⇒ ٢٠٠ (التوقيع صحيح) ── */
  r = await post('ping', sign('ping'));
  eq(r.code, 200, 'موقَّع وجسمه مو JSON ⇒ ٢٠٠ (ما نخلّيهم يعيدون)');
  eq((await admin()).j.hookLast.json, false, 'واللوحة تقول الجسم مو JSON');

  /* ── ٦) كبير ── */
  const huge = Buffer.alloc(300 * 1024, 'a');
  r = await post(huge, sign(huge));
  eq([r.code, r.j && r.j.why], [401, 'too-large'], 'جسم أكبر من ٢٥٦ ك.ب ⇒ مرفوض');

  /* ── ٧) أسرار ── */
  const ad = await admin();
  noSecretAnywhere('رد اللوحة', ad.raw, sigs);
  noSecretAnywhere('السجل', LOGS.join('\n'), sigs);
  ok(LOGS.some(l => /pay: إشعار EdfaPay مقبول \(Success · Purchase\)/.test(l)), 'السجل: سطر المقبول بحالته');
  ok(LOGS.some(l => /pay: إشعار EdfaPay مرفوض — التوقيع ما طابق/.test(l)), 'السجل: سطر التوقيع الغلط');
  ok(LOGS.some(l => /pay: edfapay · app-api\.edfapay\.com · المفتاح مضبوط · الإشعار مضبوط \(\d+ حرف\)/.test(l)),
     'سطر الإقلاع — ' + (LOGS.find(l => /^pay: /.test(l)) || 'ما طلع'));
  const once = LOGS.filter(l => /التوقيع ما طابق/.test(l)).length;
  eq(once, 1, 'سطر لكل سبب بالدقيقة — أربع محاولات غلط = سطر واحد');
}

async function nosecretSuite() {
  const body = APPROVED('JDW-5');
  const r = await post(body, sign(body));
  eq([r.code, r.j && r.j.why], [401, 'no-secret-configured'], '**بلا سرّ في Render: مقفل — حتى الموقَّع**');
  const a = (await admin()).j || {};
  eq([a.keySet, a.hookSet, a.hookLast && a.hookLast.why], [false, false, 'nosecret'], 'واللوحة تقول السرّ ناقص');
  ok(LOGS.some(l => /EDFAPAY_WEBHOOK_SECRET ناقص في Render/.test(l)), 'والسجل يسمّي المتغيّر');
  ok(LOGS.some(l => /pay: edfapay · app-api\.edfapay\.com · المفتاح ناقص · الإشعار بلا سرّ/.test(l)), 'وسطر الإقلاع');
}

async function hiddenSuite() {
  const body = APPROVED('JDW-6');
  const r = await post(body, sign(body));
  eq(r.code, 200, '**سرّ Render فيه علامات مخفية: الإشعار الصحيح يُقبل**');
  const a = (await admin()).j || {};
  eq([a.hookLen, a.hookHidden], [SECRET.length, 2], 'واللوحة: الطول الحقيقي، وحرفان مخفيان تجاهلناهما');
  ok(LOGS.some(l => /الإشعار مضبوط \(\d+ حرف · تجاهلنا 2 حرف مخفي\)/.test(l)), 'وسطر الإقلاع يقولها');
}

(async () => {
  await wait(400);
  try {
    await ({ on: onSuite, nosecret: nosecretSuite, hidden: hiddenSuite })[MODE]();
  } catch (e) { fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e)) }
  console.log = realLog;

  if (MODE === 'on') {
    for (const m of ['nosecret', 'hidden']) {
      const res = await new Promise(resolve => {
        const ch = fork(__filename, [SRV, '--mode=' + m], { silent: true });
        let o = '';
        ch.stdout.on('data', d => o += d);
        ch.stderr.on('data', d => o += d);
        ch.on('exit', () => resolve(o));
      });
      const mm = /(\d+) نجحت · (\d+) فشلت\s*$/.exec(res.trim());
      if (!mm) { fail++; out.push(`  ✗ [${m}] ما رجع ملخص:\n` + res.slice(-800)) }
      else {
        pass += Number(mm[1]); fail += Number(mm[2]);
        res.split('\n').filter(l => l.includes('✗')).forEach(l => out.push(l));
      }
    }
  }
  out.forEach(l => console.log(l));
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
