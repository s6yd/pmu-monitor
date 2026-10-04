/* بوابة الدفع (EdfaPay) — اختبار سلوكي على السيرفر الحقيقي.
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور Supabase وEdfaPay وتلقرام.
   **EdfaPay وحدها — قرار محمد** (٣٠ سبتمبر ٢٠٢٦): كان الملف لـPaylink، وكل حماية
   فيه انتقلت هنا كما هي. اللي انشال حالات مفتاح إشعار Paylink (الترويسة · ?key= ·
   خانة الاسم) — بوابة ما عادت موجودة؛ وإشعار EdfaPay موقَّع ويختبره test-edfapay-hook.

   شكل EdfaPay من توثيقهم (OpenAPI على app-api/api-docs): رد الحالة
   (`/api/v1/payment/status`) بأمثلتهم الثلاثة حرفاً بحرف — PAID · FAILED (ومعها
   reason) · ACTIVE (الصفحة مفتوحة وما دفع، بلا رقم عملية) — مغلّفة بـdata كما في
   أمثلتهم، ومرة بلا غلاف كما في مخطّطهم. والإشعار مثال «Approved» حرفاً بحرف.
   ورد فتح الدفع `data` بلا شكل موثّق: الاسم `redirectUrl` من Postman — ونجرّبه
   داخل data وبلا غلاف.

   أخطار يمسكها:
   ١) **التفعيل بلا إثبات**: رجوع الطالب والإشعار جرس — حتى الموقَّع. التفعيل بعد
      ما نسأل EdfaPay: PAID · المبلغ بالهللة · رقم الطلب · رقم العملية. أي اختلاف ⇒ لا.
   ٢) **التفعيل مرتين** (إشعار يتكرر، رجوع + إشعار) ⇒ رصيد داعٍ مرتين. **وعملية وحدة
      لطلبين**: رقم العملية فريد في القاعدة.
   ٣) **رصيد يضيع**: دفعة ما اكتملت ⇒ الرصيد المحجوز يرجع بصلاحيته الأصلية.
   ٤) **أقل دفع نقدي ١٠ ريال** والرصيد يغطي الباقي.
   ٥) **البيئتان تتشاركان القاعدة**: dev لصاحب الموقع وحده، وما يلمس صفوف الإنتاج.
      والإنتاج على خادمهم الحقيقي دائماً — `EDFAPAY_HOST` ما يغيّره.
   ٦) **قبل الإطلاق** الطلاب ما يدفعون (الفترة المجانية) — صاحب الموقع وحده.
   ٧) آخر أيام النافذة ⇒ الترم الجاي — وخارج النوافذ كذلك (قرار محمد).
   ٨) **عطل عند EdfaPay ما يلغي طلباً** — ما نحكم بلا جواب، وننبّهك بعد ٢٤ ساعة.
   ٩) **رابط صفحة دفع من نطاق ثاني** ما نودّي له طالباً.
   ١٠) **الإيصال** (لقاها محمد): وش اشترى وكم ووين — وآخره وصف الخدمة ورقم السجل،
       بلا اسم المؤسسة. **وما نبيع إضافة ما تنفعّل**: وضعها «off» يخفيها.

   node tests/test-pay.js [server.js]
   (يشغّل نفسه خمس مرات إضافية كعمليات مستقلة: dev · dev بخادم من EDFAPAY_HOST ·
    dev بمفتاح لخادم ثاني · إنتاج بلا مفتاح · مفتاح يرفضه EdfaPay — المتغيّرات
    تُقرأ مرة عند الإقلاع) */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=prod').slice(7);

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${MODE}] ` + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ═══ القاعدة المزيّفة — تطابق PostgREST: الفلاتر، القصّ عند ١٠٠٠،
   Prefer في الترويسة، والقيود الفريدة ترجع 23505 ═══ */
const TOK = {
  'tok-own-aaaaaaaaaaaaaaaaaaaaaa': 'u-own',   /* صاحب الموقع: تلقرامه = ADMIN_CHAT_ID */
  'tok-st-bbbbbbbbbbbbbbbbbbbbbbb': 'u-st',
  'tok-cr-ccccccccccccccccccccccc': 'u-cr',
  'tok-full-dddddddddddddddddddddd': 'u-full',
  'tok-ref-eeeeeeeeeeeeeeeeeeeeeee': 'u-ref',
  'tok-late-ffffffffffffffffffffff': 'u-late',
  'tok-miss-gggggggggggggggggggggg': 'u-miss',
  'tok-race-hhhhhhhhhhhhhhhhhhhhhh': 'u-race',
  'tok-po-iiiiiiiiiiiiiiiiiiiiiiiii': 'u-po',
};
const tokOf = u => Object.keys(TOK).find(k => TOK[k] === u);
const prof = (id, extra) => Object.assign({ id, email: id + '@x.com', name: 'Name ' + id,
  is_pro: false, subscription_expires_at: null, pushover_until: null, paid_at: null,
  telegram_chat_id: null, invite_code: null, phone: null }, extra || {});
const DB = {
  profiles: [
    prof('u-own', { telegram_chat_id: '5555' }),
    prof('u-st', { telegram_chat_id: '6001' }),
    prof('u-cr', { phone: '0500000001' }),
    prof('u-full', { telegram_chat_id: '6011' }),
    prof('u-ref', { phone: '0500000003', telegram_chat_id: '6003' }),
    prof('u-friend', { invite_code: 'FRD234', telegram_chat_id: '7777' }),
    prof('u-late', { phone: '0500000004' }),
    prof('u-miss', { phone: '0500000005' }),
    prof('u-race', { phone: '0500000006', telegram_chat_id: '6006' }),
    prof('u-friend2', { invite_code: 'FRE234', telegram_chat_id: '7778' }),
    prof('u-po', { phone: '0500000010', telegram_chat_id: '6010' }),
  ],
  credit_ledger: [
    { id: 1, user_id: 'u-cr', amount_halalas: 1500, reason: 'reviews',
      expires_at: '2027-03-01T20:59:59+00:00', created_at: '2026-09-01T10:00:00+00:00' },
    { id: 2, user_id: 'u-full', amount_halalas: 5000, reason: 'admin',
      expires_at: '2029-03-01T20:59:59+00:00', created_at: '2026-09-01T10:00:00+00:00' },
  ],
  subscriptions: [], referrals: [], app_state: [], app_events: []
};
const NEXT = { subscriptions: 100, credit_ledger: 500, referrals: 50 };
const PATCHES = [];

function cmp(v, op, val) {
  const s = v == null ? null : String(v);
  if (op === 'eq') return s === val;
  if (op === 'neq') return s !== val;
  if (op === 'is') return val === 'null' ? v == null : String(v) === val;
  if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(s);
  const a = Date.parse(s), b = Date.parse(val);
  const [x, y] = (!isNaN(a) && !isNaN(b)) ? [a, b] : [Number(s), Number(val)];
  if (op === 'lt') return x < y;
  if (op === 'gt') return x > y;
  if (op === 'lte') return x <= y;
  if (op === 'gte') return x >= y;
  return true;
}
function filt(rows, qs) {
  const P = new URLSearchParams(qs);
  let r = rows.slice();
  for (const [k, v] of P) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^(eq|neq|is|in|lt|gt|lte|gte)\.(.*)$/.exec(v);
    if (m) r = r.filter(x => cmp(x[k], m[1], m[2]));
  }
  const ord = P.get('order');
  if (ord) {
    const [col, dir] = ord.split(',')[0].split('.');
    r.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return r.slice(0, P.get('limit') ? Number(P.get('limit')) : 1000);
}
/* قيود subscriptions في القاعدة الحقيقية (قريناها منها): الحالة من خمس،
   والمبالغ موجبة، والمبلغ = الترم + الإضافة − الخصم − الرصيد */
const SUB_ST = ['pending', 'paid', 'failed', 'refunded', 'comp'];
function checkBad(table, r) {
  if (table !== 'subscriptions') return false;
  const n = k => Number(r[k] || 0);
  if (!SUB_ST.includes(r.status)) return true;
  if (['base_halalas', 'pushover_halalas', 'discount_halalas', 'credit_halalas', 'amount_halalas']
      .some(k => n(k) < 0)) return true;
  return n('amount_halalas') !== n('base_halalas') + n('pushover_halalas') - n('discount_halalas') - n('credit_halalas');
}
/* self: الصف نفسه وقت التعديل — ما يتصادم مع نفسه */
function unique(table, row, self) {
  const L = DB[table].filter(x => x !== self);
  if (table === 'referrals' && L.some(x => x.invited_id === row.invited_id)) return true;
  if (table === 'subscriptions') {
    if (row.gateway_ref && L.some(x => x.gateway_ref === row.gateway_ref)) return true;
    /* فهرس الـSQL الجديد: طلب معلّق واحد لكل طالب وبوابة */
    if (row.status === 'pending' && L.some(x => x.status === 'pending' &&
        x.user_id === row.user_id && x.gateway === row.gateway)) return true;
  }
  return false;
}
function supabase(method, urlPath, body, prefer) {
  const [p, qs = ''] = urlPath.split('?');
  const table = p.replace('/rest/v1/', '');
  const L = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer || '');
  if (method === 'GET') return [200, filt(L, qs)];
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = L.findIndex(x => x.key === b.key);
      if (i >= 0) L[i] = b; else L.push(b);
      return [201, []];
    }
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign(
      { id: (NEXT[table] = (NEXT[table] || 1) + 1), created_at: new Date().toISOString() },
      table === 'subscriptions' ? { status: 'pending' } : {}, x));
    for (const r of rows) {
      if (checkBad(table, r)) return [400, { code: '23514', message: 'violates check constraint' }];
      if (unique(table, r)) return [409, { code: '23505', message: 'duplicate key value violates unique constraint' }];
    }
    L.push(...rows);
    return [201, rep ? rows.map(r => Object.assign({}, r)) : []];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(L, qs);
    PATCHES.push({ table, qs: decodeURIComponent(qs), body: b, n: hit.length });
    for (const r of hit) {
      const next = Object.assign({}, r, b);
      if (checkBad(table, next)) return [400, { code: '23514', message: 'violates check constraint' }];
      if (unique(table, next, r)) return [409, { code: '23505', message: 'duplicate key' }];
    }
    hit.forEach(r => Object.assign(r, b));
    return [200, rep ? hit.map(r => Object.assign({}, r)) : []];
  }
  /* DELETE بفلتر يشيل ما طابق — كان يرجع ٢٠٠ وما يشيل شي، فحذف يعوّض سباقاً ما ينفحص */
  if (method === 'DELETE') {
    const hit = filt(L, qs);
    for (const r of hit) L.splice(L.indexOf(r), 1);
    return [rep ? 200 : 204, rep ? hit : []];
  }
  return [200, []];
}

/* ═══ EdfaPay المزيّف ═══
   الردود بشكل توثيقهم: الحالة مثال «Paid status example» حرفاً بحرف، والخطأ
   مثال «Bad request example» حرفاً بحرف */
const EP = { hosts: new Set(), calls: [], ord: {}, n: 0, shape: 'data', url: null, initFail: 0, statusFail: 0 };
const uuid = n => `7fcae16d-4035-43e4-806b-${String(870000000000 + n).padStart(12, '0')}`;
const EP_BAD = { code: 400, message: 'Error invalid request exception, something wrong', errorCode: '400', data: null };
function edfapay(method, p, body, headers, host) {
  const b = body ? JSON.parse(body) : {};
  EP.calls.push({ method, p, b, key: headers['X-API-KEY'] });
  /* مفتاح يقبله خادم واحد بس (مفتاح Test Mode لخادم ما نعرفه): app-api وحده */
  const k = headers['X-API-KEY'];
  if (!(k === 'ep-live-key-for-tests' || (k === 'ep-app-only-key' && host === 'app-api.edfapay.com')))
    return [401, { code: 401, message: 'Unauthorized', errorCode: '401', data: null }];
  if (method === 'POST' && p === '/api/v1/payment/initiate') {
    if (EP.initFail) return [EP.initFail, EP_BAD];
    const n = ++EP.n;
    EP.ord[b.orderId] = { number: b.orderId, amount: b.amount, currency: b.currency, status: 'ACTIVE', tx: uuid(n) };
    const url = EP.url || 'https://checkout.edfapay.com/pay/s-' + n + '?token=sess-secret-' + n;
    /* 'other': الرابط باسم ثاني (افتراض — نثبت إن السجل يقول الأسماء لا القيم) */
    if (EP.shape === 'other') return [200, { code: 200, message: 'Success', errorCode: null,
      data: { sessionId: 'b08e4f9d-35cc-4230-8a2e-06ca74a09a2e', checkoutLink: url } }];
    return [200, EP.shape === 'flat' ? { redirectUrl: url }
      : { code: 200, message: 'Success', errorCode: null, data: { redirectUrl: url } }];
  }
  const m = /^\/api\/v1\/payment\/status\?orderId=([^&]+)$/.exec(p);
  if (method === 'GET' && m) {
    /* عطل: ٥٠٠ — أو (افتراض دفاعي، ما شفناه في توثيقهم) ٢٠٠ وفي الغلاف code ٤٠١ بلا data */
    if (EP.statusFail === 'wrap401') return [200, { code: 401, message: 'Unauthorized', errorCode: '401', data: null }];
    if (EP.statusFail) return [EP.statusFail, { code: EP.statusFail, message: 'Internal error', errorCode: String(EP.statusFail), data: null }];
    const o = EP.ord[decodeURIComponent(m[1])];
    if (!o) return [400, EP_BAD];
    const order = { number: o.number, amount: o.amount, currency: o.currency, description: 'Test order' };
    const customer = { name: 'Alice', email: 'alice@example.com' };
    /* بأمثلتهم: ACTIVE بلا brand ولا rrn ولا رقم عملية · FAILED معها reason */
    const d = o.status === 'ACTIVE' ? { date: '2026-04-07T15:30:00', status: 'ACTIVE', order, customer }
      : Object.assign({ date: '2026-04-07T15:30:00', status: o.status, brand: 'Visa', order, customer,
          rrn: '123456789012', transactionId: o.tx }, o.status === 'FAILED' ? { reason: 'Insufficient balance' } : {});
    return [200, EP.flatStatus ? d : { code: 200, message: 'Success', errorCode: null, data: d }];
  }
  return [404, {}];
}
/* الطلب عند EdfaPay برقم صفّنا */
const ord = id => EP.ord[(MODE.startsWith('dev') ? 'JDWT-' : 'JDW-') + id];

const TG = [];
const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { if (ev === 'error') req._err = fn; return req },
    setTimeout() { return req }, destroy() {},
    write(d) { chunks.push(d) },
    end(d) {
      if (d) chunks.push(d);
      let code = 200, o = [];
      const body = chunks.join('');
      if (opts.path && opts.path.startsWith('/auth/v1/user')) {
        const t = String((opts.headers && opts.headers.Authorization) || '').replace('Bearer ', '');
        if (TOK[t]) o = { id: TOK[t], email: TOK[t] + '@x.com', user_metadata: { name: 'Name ' + TOK[t] } };
        else { code = 401; o = { msg: 'invalid JWT' } }
      } else if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body || '{}') } catch (e) {}
        if (/sendMessage/.test(opts.path || '')) TG.push(b);
        o = { ok: true, result: { message_id: 1 } };
      } else if (/edfapay\.com$/.test(host)) {
        EP.hosts.add(host);
        [code, o] = edfapay(opts.method, opts.path, body, opts.headers || {}, host);
      } else if (/paylink\.sa$/.test(host)) {
        EP.hosts.add(host);                  /* ما لازم يوصلها شي أبداً */
        code = 500; o = {};
      } else if (host.includes('pmu.edu.sa')) {
        o = [];
      } else {
        [code, o] = supabase(opts.method, opts.path, body,
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '');
      }
      const txt = JSON.stringify(o);
      const res = new Readable({ read() { this.push(txt); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const BASES = { prod: 47500, dev: 47600, nokeys: 47700, badkey: 47800, devhost: 48400, devhint: 48500 };
const PORT = BASES[MODE] + (process.pid % 100);
const HOOK_SECRET = 'ep-hook-secret-for-tests-5c1e';
const KEYS = {
  /* الإنتاج ومعه EDFAPAY_HOST لخادم التجربة: لازم يتجاهله */
  prod:    { SITE_ENV: 'prod', EDFAPAY_API_KEY: 'ep-live-key-for-tests', EDFAPAY_HOST: 'demo-api.edfapay.com' },
  dev:     { SITE_ENV: 'dev',  EDFAPAY_API_KEY: 'ep-live-key-for-tests', EDFAPAY_HOST: '' },
  devhost: { SITE_ENV: 'dev',  EDFAPAY_API_KEY: 'ep-live-key-for-tests', EDFAPAY_HOST: 'https://revamp-api.edfapay.com/' },
  /* مفتاح Test Mode ينقبل على app-api وحده، وdev على demo-api: زر التجربة يقول وين */
  devhint: { SITE_ENV: 'dev',  EDFAPAY_API_KEY: 'ep-app-only-key', EDFAPAY_HOST: '' },
  nokeys:  { SITE_ENV: 'prod', EDFAPAY_API_KEY: '', EDFAPAY_WEBHOOK_SECRET: '' },
  badkey:  { SITE_ENV: 'prod', EDFAPAY_API_KEY: 'ep-wrong-key' },
}[MODE];
Object.assign(process.env, { EDFAPAY_WEBHOOK_SECRET: HOOK_SECRET }, KEYS, {
  PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests', ADMIN_CHAT_ID: '5555',
  /* ترم بعيد وثابت: الاختبار ما يتغيّر مع التاريخ الحقيقي (نهايته 2029-12-31) */
  ACTIVE_TERM: '203010', FREE_BETA: 'true', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', TELEGRAM_TOKEN: 'tg',
  /* رابط اشتراك Pushover موجود — والوضع يبدأ «off» كما في الإنتاج قبل ما يُشغَّل */
  PUSHOVER_SUBSCRIBE_URL: 'https://pushover.net/subscribe/Jadwalik-test'
});
const realLog = console.log;
/* سجل السيرفر محفوظ لا مطبوع: نفحص إن سطوره ما فيها مفتاح ولا رابط جلسة أبداً */
const LOGS = [];
console.log = (...a) => { LOGS.push(a.map(String).join(' ')) };
require(SRV);

function call(method, p, { tok, body, headers, admin, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : null;
    const h = Object.assign({}, headers || {});
    if (data && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (tok) h.Authorization = 'Bearer ' + tok;
    if (admin) h['X-Admin-Token'] = 'admin-token-for-tests';
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end(data || undefined);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const riyadh = n => new Date(Date.now() + 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const setWindow = (from, to) => call('POST', '/api/admin/monitor-window', { admin: true, body: { from, to } });
/* إشعار EdfaPay بشكل مثالهم «Approved» حرفاً بحرف، موقَّع بسرّنا (أو بغيره).
   السيرفر يرد ٢٠٠ **قبل** ما يسأل عن الطلب — فننتظر شوي بعد الرد */
const sign = (raw, s) => crypto.createHmac('sha256', s || HOOK_SECRET).update(raw).digest('hex');
async function hook(orderId, extra, sig) {
  const raw = JSON.stringify(Object.assign({
    transactionId: '7fcae16d-4035-43e4-806b-87b51881135e', orderId, amount: 19.0, currencyCode: '682',
    cardScheme: 'MasterCard', status: 'Approved', channel: 'Payment Gateway', type: 'Purchase',
    createdAt: '2026-04-02T14:09:30.764985', finishedAt: '2026-04-02T14:10:46.397810922',
    merchantId: '7da313e4-5424-4527-befc-53d81c977b1f', pgDetails: { reason: null }, rrn: '609211300976' }, extra || {}));
  const h = await call('POST', '/api/edfapay/webhook', { raw,
    headers: Object.assign({ 'Content-Type': 'text/plain' }, sig === '' ? {} : { 'X-EdfaPay-Signature': sig || sign(raw) }) });
  await wait(250);
  return h;
}
const sub = id => DB.subscriptions.find(s => s.id === id);
const P = id => DB.profiles.find(p => p.id === id);
const ledger = u => DB.credit_ledger.filter(r => r.user_id === u);
const inits = () => EP.calls.filter(c => c.p === '/api/v1/payment/initiate');
const tgTo = (chat, re) => TG.filter(m => String(m.chat_id) === chat && re.test(String(m.text || '')));
const END_NOW = '2029-12-31T20:59:59.000Z';    /* termEndApprox('203010') */
const END_NEXT = '2030-06-15T20:59:59.000Z';   /* termEndApprox('203020') */

async function prodSuite() {
  /* وسط نافذة يدوية: ترم الشراء = ترم الدراسة، فالتواريخ ثابتة (END_NOW) */
  await setWindow(riyadh(-5), riyadh(+10));

  /* ── ١) قبل الإطلاق: الطالب ما يدفع، وصاحب الموقع يجرّب ── */
  let q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'beta'], '**الفترة المجانية: الطالب ما يشوف دفعاً**');
  let r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-st'), body: { phone: '0512345678' } })).j;
  eq([r.ok, r.why], [false, 'beta'], 'ولو نادى الدفع بنفسه يترفض');
  eq(inits().length, 0, 'وما انفتحت صفحة دفع');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-own') })).j;
  eq(q.pay && q.pay.open, true, '**وصاحب الموقع يقدر يجرّب بدفعة حقيقية**');
  eq([q.term, q.termEnd, q.late], ['203010', END_NOW, false], 'ترم الشراء وسط النافذة: ترمها');

  /* ── ٢) بدء الدفع ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: {} })).j;
  eq([r.ok, r.why], [false, 'phone'], 'بلا جوال: نطلبه');
  /* رقم غلط: يقول له الصح بالضبط (لقاها محمد) — كانت «اكتب رقم جوالك» وهو كاتبه */
  for (const bad of ['051234567', '05123456789', '0612345678', '12345']) {
    r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: bad } })).j;
    ok(r.ok === false && r.why === 'phone' && /يبدأ بـ05 ويكون 10 أرقام/.test(r.error || ''),
       `رقم غلط (${bad}): «لازم يبدأ بـ05 ويكون 10 أرقام» — ` + JSON.stringify(r));
  }
  eq(inits().length, 0, 'وما انفتحت صفحة دفع برقم غلط');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '٠٥١٢٣٤٥٦٧٨' } })).j;
  ok(r.ok && /^https:\/\/checkout\.edfapay\.com\//.test(r.url || ''), 'رابط صفحة الدفع عند EdfaPay — ' + JSON.stringify(r));
  const s1 = sub(r.id) || {};
  const a1 = (inits()[0] || {}).b || {};
  eq(a1.amount, 19, 'المبلغ بالريال: ١٩');
  eq([a1.orderId, a1.currency], ['JDW-' + r.id, 'SAR'], 'رقم الطلب من صفّنا، بالريال');
  eq([a1.successUrl, a1.failureUrl], ['https://jadwalik.com/?pay=' + r.id, 'https://jadwalik.com/?pay=' + r.id],
     '**رابط الرجوع على نطاقنا دائماً** — لا ترويسة Host');
  eq(a1.customerDetails && a1.customerDetails.phone, '+966-512345678', '**الأرقام العربية من كيبورد الآيفون تتحوّل** (+966- بصيغة مثالهم)');
  eq(a1.backButtonUrl, 'https://jadwalik.com/?pay=' + r.id, 'وزر الرجوع في صفحتهم يرجّعه لنا');
  const exp = Date.parse(a1.expireDate) - Date.now();
  ok(exp > 23.9 * 3600e3 && exp <= 24 * 3600e3, '**الجلسة تنتهي عندهم بعد ٢٤ ساعة** — مع مهلة الإلغاء عندنا (§٨-٨) — ' + a1.expireDate);
  eq(a1.description, 'اشتراك جدولك — خريف 2029/2030', 'ووصف الطلب بالترم باسمه');
  eq(a1.customerDetails && [a1.customerDetails.name, a1.customerDetails.email], ['Name u-own', 'u-own@x.com'], 'اسم الطالب وإيميله');
  ok(!('card' in a1) && !('cardNumber' in a1), '**صفحة مستضافة: ما نرسل بطاقة أبداً** (§٨-٢)');
  eq([s1.status, s1.gateway, s1.gateway_ref || null, s1.amount_halalas, s1.term, s1.valid_until],
     ['pending', 'edfapay', null, 1900, '203010', END_NOW], 'الصف معلّق بكل تفاصيله — ورقم العملية بعد الدفع');
  eq(P('u-own').phone, '0512345678', 'والجوال انحفظ في الملف');
  eq([...EP.hosts], ['app-api.edfapay.com'], '**الإنتاج على app-api — ولو EDFAPAY_HOST يقول خادم التجربة**');
  ok(EP.calls.every(c => c.key === 'ep-live-key-for-tests'), 'وكل طلب بترويسة X-API-KEY');
  ok(!LOGS.some(l => /sess-secret|checkout\.edfapay\.com\/pay/.test(l)), '**رابط الجلسة ما ينكتب في السجل**');

  const r2 = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '0512345678' } })).j;
  eq([r2.ok, r2.why, r2.id], [false, 'pending', r.id], '**طلب ثانٍ والأول معلّق: نرجّعه له لا صفحة ثانية**');
  eq(r2.url, r.url, 'ومعه نفس الرابط يكمّل منه');
  eq(inits().length, 1, 'وما انفتحت صفحة دفع ثانية');

  /* ── ٣) الرجوع والإشعار: جرس لا إثبات ── */
  let st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-own') })).j;
  eq(st.status, 'pending', 'رجع وما دفع: معلّق');
  eq(P('u-own').subscription_expires_at, null, 'وما انفعّل');
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-st') })).j;
  eq(st.ok, false, '**طالب ثانٍ ما يقرأ طلب غيره**');

  const oid = 'JDW-' + r.id;
  eq((await hook(oid, {}, '')).code, 401, 'إشعار بلا توقيع: مرفوض');
  eq((await hook(oid, {}, sign('x', 'other-secret'))).code, 401, 'وبتوقيع غلط: مرفوض');
  /* **الإشعار الموقَّع نفسه ما يفعّل**: يقول Approved وEdfaPay لسا يقول PENDING */
  eq(sub(r.id).status, 'pending', '(الإشعارات المرفوضة ما لمست شي)');

  ord(r.id).status = 'PAID'; ord(r.id).amount = 1;
  await hook(oid);
  eq([sub(r.id).status, P('u-own').subscription_expires_at], ['pending', null],
     '**EdfaPay يقول PAID بمبلغ غلط: ما نفعّل** — ولو الإشعار موقَّع');
  ok(tgTo('5555', /تحتاج نظرك[\s\S]*المبلغ/).length === 1, 'ونبلّغ صاحب الموقع');

  ord(r.id).amount = 19; ord(r.id).number = 'JDW-999';
  await hook(oid);
  eq(sub(r.id).status, 'pending', '**رقم طلب ما يطابق: ما نفعّل**');
  ord(r.id).number = '';
  await hook(oid);
  eq(sub(r.id).status, 'pending', '**ورقم طلب ناقص = ما يطابق** (نقفل عند الشك)');
  ord(r.id).number = oid; ord(r.id).currency = 'USD';
  await hook(oid);
  eq(sub(r.id).status, 'pending', '**عملة غير الريال: ما نفعّل**');
  ord(r.id).currency = 'SAR';
  const tx = ord(r.id).tx; ord(r.id).tx = '';
  await hook(oid);
  eq(sub(r.id).status, 'pending', '**بلا رقم عملية: ما نفعّل**');
  ok(tgTo('5555', /رقم العملية ناقص/).length === 1, 'ونقول ليش');
  ord(r.id).tx = tx;

  const hk = await hook(oid);
  eq(hk.code, 200, 'الإشعار الصحيح: ٢٠٠');
  eq(sub(r.id).status, 'paid', '**تحقّقنا من EdfaPay بأنفسنا ⇒ مدفوع**');
  eq(sub(r.id).gateway_ref, tx, '**ورقم العملية انحفظ مع التسوية** (فريد في القاعدة)');
  eq(P('u-own').subscription_expires_at, END_NOW, 'والاشتراك حتى نهاية نهائيات الترم');
  ok(!!P('u-own').paid_at, 'وpaid_at للدفع الحقيقي');
  eq(tgTo('5555', /اشتراكك فعّال/).length, 1, 'الطالب وصله «اشتراكك فعّال»');
  /* الإيصال — لقاها محمد: كانت «اشتراكك فعّال حتى …» وبس */
  const rt = String((tgTo('5555', /إيصال/).pop() || {}).text || '');
  ok(rt.includes('إيصال JDW-' + r.id), '**بعد الدفع يوصله إيصال برقم الطلب** — ' + rt.slice(0, 120));
  ok(rt.includes('• اشتراك خريف 2029/2030: 19 ريال'), 'وش اشترى: الترم باسمه وسعره');
  ok(rt.includes('<b>المدفوع: 19 ريال</b> · عبر EdfaPay'), 'وكم دفع ووين');
  ok(rt.includes('رقم العملية: <code>' + tx + '</code>'), 'ورقم العملية عند EdfaPay');
  ok(rt.includes('ساري حتى: 31 ديسمبر 2029'), 'وحتى متى — بالسنة');
  /* اللائحة التنفيذية لنظام التجارة الإلكترونية: وصف الخدمة ورقم السجل في الفاتورة —
     بلا اسم المؤسسة (قرار محمد ٣٠ سبتمبر ٢٠٢٦) */
  ok(rt.endsWith('ساري حتى: 31 ديسمبر 2029\n\nاشتراك ترم في جدولك · سجل تجاري 7055288521'),
     '**آخر الإيصال: وصف الخدمة ورقم السجل** — ' + JSON.stringify(rt.slice(-150)));
  ok(!/مؤسسة|المسبح/.test(rt), 'وبلا اسم المؤسسة');
  ok(!/Pushover/.test(rt), 'وبلا التنبيه الطارئ: ما فيه خطوات تفعيل');

  await hook(oid);
  await wait(4100);
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-own') });
  eq(tgTo('5555', /اشتراكك فعّال/).length, 1, '**الإشعار يتكرر والرجوع بعده: تفعيل واحد بس**');
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-own') })).j;
  eq([st.status, st.until], ['paid', END_NOW], 'وصفحة الرجوع تقول مدفوع وحتى متى');

  /* ── ٤) الإطلاق: الطلاب يدفعون ── */
  eq((await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } })).code, 200,
     'إطفاء الفترة المجانية مسموح والمفتاح جاهز');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && q.pay.open, true, 'بعد الإطلاق: الطالب يدفع');

  /* ── ٥) أقل دفع نقدي ١٠ ريال (الشروط §٣)، والرصيد المحجوز يرجع بصلاحيته ── */
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-cr') })).j;
  eq([q.credit, q.amount, q.minCash], [900, 1000, 1000], '**رصيد ١٥ وسعر ١٩: نصرف ٩ ويدفع ١٠** — أقل دفع نقدي');
  /* رقم جديد غلط والقديم محفوظ (ولا دفعة معلّقة): كان يُتجاهل بصمت ويكمل بالقديم */
  const nA = inits().length;
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: { phone: '05123' } })).j;
  eq([r.ok, r.why], [false, 'phone'], '**رقم جديد غلط: نقوله له — ما نكمل بالمحفوظ بصمت**');
  eq([inits().length, ledger('u-cr').filter(x => x.reason === 'spend').length, P('u-cr').phone],
     [nA, 0, '0500000001'], 'وما انفتحت صفحة دفع ولا انحجز رصيد، والمحفوظ ما تغيّر');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: {} })).j;
  ok(r.ok && r.url, 'الجوال المحفوظ يكفي — ' + JSON.stringify(r));
  const sp = ledger('u-cr').find(x => x.reason === 'spend');
  eq(sp && [sp.amount_halalas, sp.ref, String(sp.expires_at).slice(0, 10)],
     [-900, 'subscription:' + r.id, '2027-03-01'], 'حجز ٩ من الرصيد، بصلاحية منحته');
  eq((inits().pop() || {}).b.amount, 10, 'وصفحة الدفع بعشرة ريال');
  /* ٢٥ ساعة بلا دفع ⇒ تنلغي ويرجع الرصيد */
  sub(r.id).created_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq([st.status, sub(r.id).status], ['failed', 'failed'], '**بعد ٢٤ ساعة بلا دفع: فشل**');
  const rv = ledger('u-cr').find(x => x.reason === 'reversal');
  eq(rv && [rv.amount_halalas, String(rv.expires_at).slice(0, 10)], [900, '2027-03-01'],
     '**والرصيد رجع بصلاحيته الأصلية** — لا أطول ولا أقصر');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-cr') })).j;
  eq(q.creditAvailable, 1500, 'ورصيده ١٥ كما كان');

  /* ── ٥ب) عطل عند EdfaPay ما يلغي طلباً: ما نحكم بلا جواب ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: {} })).j;
  sub(r.id).created_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  EP.statusFail = 500;
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq([st.status, sub(r.id).status], ['pending', 'pending'],
     '**EdfaPay ما ردّ (٥٠٠) وعمره ٢٥ ساعة: يبقى معلّقاً** — يمكن دفع، ما نلغيه');
  ok(tgTo('5555', /ما قدرنا نسأل EdfaPay عنها من ٢٤ ساعة/).length === 1, 'وننبّهك');
  EP.statusFail = 'wrap401';
  await wait(4100);
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq(sub(r.id).status, 'pending', '**رد ٢٠٠ وفي غلافه code ٤٠١ بلا data: عطل لا «طلب ما عندهم»** — ما نلغي');
  EP.statusFail = 0;
  await wait(4100);
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq(st.status, 'failed', 'رجع يرد وما دفع: فشل ويرجع الرصيد');
  eq(ledger('u-cr').filter(x => x.reason === 'reversal').length, 2, 'والرصيد رجع');

  /* ── ٥ج) FAILED (مثالهم: رصيد البطاقة ما يكفي): ما دفع — يقدر يجرّب ثانية، وبعد ٢٤ ساعة فشل ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: {} })).j;
  ord(r.id).status = 'FAILED';
  await hook('JDW-' + r.id, { status: 'Declined' });
  eq(sub(r.id).status, 'pending', '**FAILED: ما نفعّل — والطلب باقٍ يقدر يجرّب ببطاقة ثانية**');
  /* لقاها محمد: البنك رفض والصفحة تقول «ننتظر تأكيد الدفع — لو دفعت يتفعّل». الرد يقول
     «انرفض» وسببه رمزاً (لا نص البنك الإنجليزي) — والطلب يبقى معلّقاً */
  await wait(4100);
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq([st.status, st.declined], ['pending', 'funds'],
     '**FAILED ومعه «Insufficient balance»: الرد يقول انرفض (الرصيد) — والطلب معلّق**');
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq(st.declined, 'funds', 'وضغطة ثانية خلال ٤ ثوانٍ (ما نسأل EdfaPay) تقولها كذلك');
  sub(r.id).created_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  await wait(4100);
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq(st.status, 'failed', 'وبعد ٢٤ ساعة: فشل ويرجع الرصيد');
  ok(!st.declined, 'والفاشل ما يقول «انرفض» — حالته تكفي');

  /* ── ٥د) الحالة عندهم ACTIVE (الصفحة مفتوحة) والإشعار الموقَّع قال Declined: يكفي للرسالة ──
     رفض التحقق (3-D Secure) — اللي صار مع محمد: «Authentication for sale transaction failed» */
  /* «Declined» لرقم طلب ما انخلق بعد (تجربة من لوحتهم): ما يعلّم الطلب اللي ياخذ رقمه بعدين */
  const nextNo = NEXT.subscriptions + 1;
  await hook('JDW-' + nextNo, { status: 'Declined' });
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: {} })).j;
  eq(r.id, nextNo, 'الطلب الجديد أخذ نفس الرقم');
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq([st.status, st.declined || null], ['pending', null],
     '**«Declined» لرقم ما كان موجود ما يعلّم الطلب اللي أخذ رقمه** — وقبل أي رفض: معلّق بلا «انرفض»');
  /* الإشعار الحقيقي اللي وصل محمد (أول أكتوبر ٢٠٢٦) بحقوله — ورقم البطاقة مقنّع مزيّف:
     السبب `DO_NOT_PROCEED` = توصية البوابة بعد تحقق 3-D Secure «لا تكمل». كان يطلع «سبب
     غير معروف» فالجملة العامة، والصحيح رسالة التحقق */
  await hook('JDW-' + r.id, { amount: 10, cardScheme: 'Mada', cardNumber: '4000 00** **** 0000',
    cardChannel: 'PHYSICAL_CARD', status: 'Declined', pgDetails: { reason: 'DO_NOT_PROCEED' } });
  await wait(4100);
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq([st.status, st.declined], ['pending', 'auth'],
     '**إشعار «Declined» بسبب DO_NOT_PROCEED (التحقق — شكله الحقيقي): الرد يقول انرفض التحقق**');
  ord(r.id).status = 'PAID';
  await wait(4100);
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-cr') })).j;
  eq([st.status, st.declined || null], ['paid', null], '**والرفض ما يمنع دفعة بعده: جرّب ثانية ودفع ⇒ يتفعّل**');

  /* ── ٦) رصيد أكبر من السعر: يدفع ١٠ نقداً والرصيد يغطي الباقي ── */
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-full') })).j;
  eq([q.credit, q.amount], [900, 1000], '**رصيد ٥٠ وسعر ١٩: يدفع ١٠ والرصيد ٩** — ما فيه تفعيل بالرصيد وحده');
  const nI = inits().length;
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-full'), body: {} })).j;
  eq([r.ok, r.why], [false, 'phone'], 'يدفع نقداً ⇒ يحتاج جوال — ما تفعّل بلا دفع');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-full'), body: { phone: '0500000011' } })).j;
  ok(r.ok && r.url && !r.activated, 'صفحة دفع لا تفعيل بالرصيد وحده — ' + JSON.stringify(r));
  eq([inits().length, (inits().pop() || {}).b.amount], [nI + 1, 10], 'انفتحت صفحة دفع بعشرة ريال');
  const sf = ledger('u-full').find(x => x.reason === 'spend');
  eq(sf && sf.amount_halalas, -900, 'وحجز ٩ من الرصيد');
  ord(r.id).status = 'PAID';
  EP.flatStatus = true;                  /* مخطّطهم: الرد PaymentStatusResponse بلا غلاف */
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-full') });
  EP.flatStatus = false;
  eq([sub(r.id).status, sub(r.id).gateway], ['paid', 'edfapay'], '**مدفوع — ورد الحالة بلا غلاف data (كما في مخطّطهم) يُقرأ**');
  eq(P('u-full').subscription_expires_at, END_NOW, 'والاشتراك فعّال');
  ok(!!P('u-full').paid_at, 'ودفع فعلي (١٠ نقداً) — يُحسب في الإحصاء');
  ok(tgTo('6011', /إيصال JDW-/).some(m => /• من رصيدك: −9 ريال/.test(m.text)
     && /<b>المدفوع: 10 ريال<\/b> · عبر EdfaPay/.test(m.text)), 'وإيصاله: من رصيدك −٩ والمدفوع ١٠');

  /* ── ٦ب) عملية وحدة لطلبين: رقم العملية فريد في القاعدة ── */
  {
    const Pd = prof('u-dup', { phone: '0500000012' });
    DB.profiles.push(Pd); TOK['tok-dup-kkkkkkkkkkkkkkkkkkkkkkk'] = 'u-dup';
    const rd = (await call('POST', '/api/me/checkout', { tok: 'tok-dup-kkkkkkkkkkkkkkkkkkkkkkk', body: {} })).j;
    ord(rd.id).status = 'PAID'; ord(rd.id).tx = ord(r.id).tx;       /* رقم عملية طلب u-full */
    await hook('JDW-' + rd.id);
    eq([sub(rd.id).status, P('u-dup').subscription_expires_at], ['pending', null],
       '**رقم عملية مستعمل لطلب ثاني: ما نفعّل** — عملية وحدة ما تفعّل طلبين');
    ok(tgTo('5555', /رقم العملية مستعمل لطلب ثاني/).length === 1, 'وننبّهك');
  }

  /* ── ٧) الدعوة تنسجّل لحظة التسوية — مرة للأبد، والرصيد بعد ٧ أيام (§١٠ تحت) ── */
  q = (await call('GET', '/api/me/quote?ref=FRD234', { tok: tokOf('u-ref') })).j;
  eq([q.discount, q.amount], [300, 1600], 'كود صديق: −٣');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-ref'), body: { ref: 'frd234' } })).j;
  ok(r.ok, 'بدأ الدفع بكود صديقه');
  eq(sub(r.id).referral_code, 'FRD234', 'والكود محفوظ في الطلب');
  eq(ledger('u-friend').length, 0, 'وما نزل رصيد للداعي قبل الدفع');
  ord(r.id).status = 'PAID';
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-ref') })).j;
  eq(st.status, 'paid', 'رجع من صفحة الدفع وقد دفع: مدفوع (بلا انتظار الإشعار)');
  eq(DB.referrals.filter(x => x.invited_id === 'u-ref').length, 1, 'صف دعوة واحد');
  eq(ledger('u-friend').length, 0, '**والداعي ما نزل له شي قبل مدة الاسترجاع**');
  ok(tgTo('7777', /صديقك اشترك/).some(m => /بعد 7 أيام، لما تخلص مدة الاسترجاع/.test(m.text)),
     'ووصله خبر: ينزل لك ٥ بعد ٧ أيام');
  await hook('JDW-' + r.id);
  await wait(4100);
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-ref') });
  eq([ledger('u-friend').length, DB.referrals.filter(x => x.invited_id === 'u-ref').length], [0, 1],
     '**إشعار ورجوع بعد التسوية: ولا دعوة ثانية ولا رصيد**');

  /* ── ٧ب) سباق: إشعاران ورجوع الطالب بنفس اللحظة ──
     الثلاثة يقرون الطلب «معلّقاً» قبل ما يسوّيه أحدهم — التحديث المشروط
     وحده يخلّي واحداً يفعّل. بلاه: تفعيلان ورسالتان. */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-race'), body: { ref: 'FRE234' } })).j;
  ord(r.id).status = 'PAID';
  await Promise.all([hook('JDW-' + r.id),
                     call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-race') }),
                     hook('JDW-' + r.id)]);
  await wait(300);
  eq(sub(r.id).status, 'paid', 'السباق: مدفوع');
  eq(tgTo('6006', /اشتراكك فعّال/).length, 1, '**ثلاثة أجراس بنفس اللحظة: تفعيل واحد ورسالة وحدة**');
  eq(DB.referrals.filter(x => x.invited_id === 'u-race').length, 1, 'ودعوة وحدة');

  /* ── ٨) آخر أيام النافذة ⇒ الترم الجاي ── */
  await setWindow(riyadh(-5), riyadh(0));
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-late') })).j;
  eq([q.late, q.term, q.termEnd], [true, '203020', END_NEXT], '**آخر يوم في النافذة: الاشتراك للترم الجاي**');
  const ms = (await call('GET', '/api/monitor-status')).j;
  eq(ms.plans && ms.plans.termEnd, END_NEXT, 'وورقة الباقات تعرض نفس التاريخ');
  await setWindow(riyadh(-5), riyadh(+5));
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-late') })).j;
  eq([q.late, q.term], [false, '203010'], 'وسط النافذة: الترم الحالي');

  /* ── ٨ب) خارج النوافذ ⇒ الترم الجاي (قرار محمد) ── */
  await setWindow('2000-01-01', '2000-01-02');                 /* انقفلت من زمان */
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-late') })).j;
  eq([q.late, q.term, q.termEnd], [true, '203020', END_NEXT],
     '**بعد ما انقفل التسجيل: الاشتراك للترم الجاي**');
  eq((await call('GET', '/api/monitor-status')).j.plans.termEnd, END_NEXT,
     'وورقة الباقات تعرض نفس التاريخ — معادلة وحدة');
  {
    const P3 = prof('u-after', { phone: '0500000008' });
    DB.profiles.push(P3); TOK['tok-after-jjjjjjjjjjjjjjjjjjjjjj'] = 'u-after';
    const ra = (await call('POST', '/api/me/checkout', { tok: 'tok-after-jjjjjjjjjjjjjjjjjjjjjj', body: {} })).j;
    const sa = sub(ra.id) || {};
    eq([sa.term, sa.valid_until], ['203020', END_NEXT], '**والطلب نفسه للترم الجاي** — لا للي انقفل تسجيله');
    ok(/خارج التسجيل/.test(sa.note || ''), 'وسبب الترم مكتوب في الصف — ' + sa.note);
    await call('POST', '/api/me/pay-cancel', { tok: 'tok-after-jjjjjjjjjjjjjjjjjjjjjj', body: { id: ra.id } });
  }
  await setWindow(riyadh(+10), riyadh(+20));                   /* ما بدأت بعد */
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-late') })).j;
  eq([q.late, q.term, q.termEnd], [true, '203020', END_NEXT],
     '**قبل ما يبدأ التسجيل: لترم النافذة الجاية**');
  /* والتقويم الحقيقي (بلا نافذة يدوية): ترم نافذته الجاية بالاسم */
  const cal = (await call('POST', '/api/admin/monitor-window', { admin: true, body: { reset: true } })).j;
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-late') })).j;
  if (!cal.current && cal.next && cal.next.term)
    eq([q.late, q.term], [true, cal.next.term], '**التقويم الحقيقي: ترم نافذته الجاية** — ' + cal.next.ar);
  else if (!cal.current)
    eq([q.late, q.term], [true, '203020'], 'التقويم الحقيقي بلا نافذة جاية: الترم بعد ترم الدراسة');
  ok(Date.parse(q.termEnd) > Date.now(), 'وما نبيع اشتراكاً منتهياً — ' + q.termEnd);
  await setWindow(riyadh(-5), riyadh(+5));

  /* ── ٨ج) الهدية من اللوحة = ترم الشراء نفسه (لقاها محمد وهو يهدي طالبة ترماً) ──
     كانت حتى نهاية ترم الدراسة: هدية بعد ما ينقفل التسجيل تنتهي قبل التسجيل
     الجاي، والدافع في نفس اليوم ياخذ الترم الجاي كاملاً. */
  {
    const gift = (act, body) => call('POST', '/api/admin/' + act, { admin: true, body }).then(x => x.j);
    const LONG = '2031-01-01T00:00:00+00:00';                     /* بصيغة القاعدة لا Z */
    DB.profiles.push(prof('u-gift'), prof('u-gift2'),
                     prof('u-gift3', { subscription_expires_at: LONG, pushover_until: LONG }));
    const comps = u => DB.subscriptions.filter(x => x.user_id === u && x.status === 'comp');

    await setWindow('2000-01-01', '2000-01-02');                 /* انقفل التسجيل من زمان */
    let g = await gift('grant', { userId: 'u-gift', note: 'ساعدتنا بأفكار للموقع' });
    q = (await call('GET', '/api/me/quote', { tok: tokOf('u-late') })).j;
    eq([g.ok, g.term, g.expires], [true, '203020', END_NEXT],
       '**هدية بعد ما انقفل التسجيل: ترم الشراء الجاي كاملاً** — لا نهاية ترم الدراسة');
    eq(g.expires, q.termEnd, 'ونفس تاريخ الشراء في نفس اللحظة — قاعدة وحدة');
    eq(P('u-gift').subscription_expires_at, END_NEXT, 'والحساب انحدّث');
    eq(comps('u-gift').map(x => [x.term, x.valid_until, x.note, !!x.paid_at]),
       [['203020', END_NEXT, 'ساعدتنا بأفكار للموقع', false]], 'وصف «هدية» واحد بترمها وسببها — بلا paid_at');
    g = await gift('grant-pushover', { userId: 'u-gift', note: 'معها' });
    eq([g.ok, g.until], [true, END_NEXT], '**والتنبيه الطارئ هدية لنفس المدة**');
    eq(P('u-gift').pushover_until, END_NEXT, 'وانكتب في الحساب');

    await setWindow(riyadh(-5), riyadh(+5));                     /* وسط النافذة */
    g = await gift('grant', { userId: 'u-gift2' });
    eq([g.ok, g.term, g.expires], [true, '203010', END_NOW], 'وسط النافذة: ترمها مثل الشراء');
    await setWindow(riyadh(-5), riyadh(0));                      /* آخر يوم فيها */
    g = await gift('grant', { userId: 'u-gift2' });
    eq([g.ok, g.term, g.expires], [true, '203020', END_NEXT], 'آخر أيام النافذة: الترم الجاي مثل الشراء');
    eq(comps('u-gift2').map(x => x.term), ['203010', '203020'], 'صف هدية لكل ترم');

    /* ما تقصّر اشتراكاً أطول منها: كانت تكتب فوقه */
    g = await gift('grant', { userId: 'u-gift3' });
    eq([g.ok, g.kept, g.expires], [true, true, LONG], '**عنده أطول من الهدية: ما تقصّره**');
    ok(/أطول/.test(g.warning || ''), 'واللوحة تقول ليش ما تغيّر شي — ' + g.warning);
    eq([P('u-gift3').subscription_expires_at, comps('u-gift3').length], [LONG, 0], 'وتاريخه باقٍ وما انكتب صف هدية');
    g = await gift('grant-pushover', { userId: 'u-gift3' });
    eq([g.ok, g.kept, P('u-gift3').pushover_until], [true, true, LONG], 'ولا تقصّر التنبيه الطارئ');
    g = await gift('grant', { userId: 'u-nobody' });
    eq(g.ok, false, 'حساب ما يوجد: رفض صريح — ' + g.error);
  }
  await setWindow(riyadh(-5), riyadh(+5));

  /* ── ٩) ألغاها ثم دفعها من تبويب قديم: فلوسه وصلت ⇒ نفعّل ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-late'), body: {} })).j;
  let c = (await call('POST', '/api/me/pay-cancel', { tok: tokOf('u-late'), body: { id: r.id } })).j;
  eq([c.status, sub(r.id).status], ['failed', 'failed'], 'الإلغاء: فشل');
  ord(r.id).status = 'PAID';
  await hook('JDW-' + r.id);
  eq(sub(r.id).status, 'paid', '**دفعة وصلت بعد الإلغاء: فعّلناه** — الفلوس ما تضيع');
  eq(P('u-late').subscription_expires_at, END_NOW, 'والاشتراك فعّال');

  /* ── ٩ب) مدفوعة بتفاصيل ما تطابق ثم ضغط «ألغها»: ما نلغي فلوساً وصلت ── */
  {
    const P2 = prof('u-mis2', { phone: '0500000007' });
    DB.profiles.push(P2); TOK['tok-mis2-iiiiiiiiiiiiiiiiiiiiii'] = 'u-mis2';
    const rr = (await call('POST', '/api/me/checkout', { tok: 'tok-mis2-iiiiiiiiiiiiiiiiiiiiii', body: {} })).j;
    ord(rr.id).status = 'PAID'; ord(rr.id).amount = 18;
    const cc = (await call('POST', '/api/me/pay-cancel', { tok: 'tok-mis2-iiiiiiiiiiiiiiiiiiiiii', body: { id: rr.id } })).j;
    eq([cc.status, cc.review, sub(rr.id).status], ['pending', true, 'pending'],
       '**مدفوعة بمبلغ ما يطابق ثم «ألغها»: تبقى معلّقة لمراجعتك** — ما نلغي فلوساً ربما وصلت');
  }

  /* ── ١٠) فاتها الإشعار والرجوع: الدورة تسوّيها ولو بعد ٢٤ ساعة ──
     إشعار موقَّع لغير طلباتنا (زر تجربة في لوحتهم) = جرس للمعلّقات كلها */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-miss'), body: {} })).j;
  sub(r.id).created_at = new Date(Date.now() - 26 * 3600e3).toISOString();
  ord(r.id).status = 'PAID';
  /* ودعوتان: وحدة مرّ عليها ٨ أيام واشتراكها مدفوع، والثانية انسترجع اشتراكها (§٧) */
  const rfA = DB.referrals.find(x => x.invited_id === 'u-ref'), rfB = DB.referrals.find(x => x.invited_id === 'u-race');
  const d8 = new Date(Date.now() - 8 * 864e5).toISOString();
  rfA.created_at = d8; rfB.created_at = d8;
  sub(rfB.subscription_id).status = 'refunded';
  /* وثالثة: كتبنا رصيدها وانقطعنا قبل ما نحجز الدعوة — الدورة تربطه، ما تكتب ثانٍ */
  DB.profiles.push(prof('u-inv3'), prof('u-friend3', { telegram_chat_id: '7779' }));
  DB.subscriptions.push({ id: 991, user_id: 'u-inv3', status: 'paid', gateway: 'edfapay', term: '203010',
    base_halalas: 1900, pushover_halalas: 0, discount_halalas: 300, credit_halalas: 0, amount_halalas: 1600 });
  DB.referrals.push({ id: 93, referrer_id: 'u-friend3', invited_id: 'u-inv3', subscription_id: 991,
    credit_id: null, created_at: d8 });
  DB.credit_ledger.push({ id: 991, user_id: 'u-friend3', amount_halalas: 500, reason: 'referral', ref: 'referral:93',
    expires_at: '2031-01-01T20:59:59+00:00', created_at: d8 });
  eq((await hook('ORDER-12345')).code, 200, 'إشعار تجربة من لوحتهم (رقم طلب مو لنا): ٢٠٠');
  await wait(500);                                  /* الدورة تسوّي بعد الرد */
  eq(sub(r.id).status, 'paid', '**مدفوعة فاتها الإشعار: تُسوّى لا تُلغى** — الجرس سوّى المعلّقات');
  eq(ledger('u-friend').map(x => [x.amount_halalas, x.reason, x.ref]), [[500, 'referral', 'referral:' + rfA.id]],
     '**بعد ٧ أيام والاشتراك مدفوع: الداعي نزل له ٥** — مرة وحدة');
  eq(rfA.credit_id, ledger('u-friend')[0] && ledger('u-friend')[0].id, 'والدعوة مربوطة برصيدها — ما تنمنح ثانية');
  await wait(300);                                  /* رسالة تلقرام ما تُنتظر */
  ok(tgTo('7777', /<b>نزل لك 5 ريال رصيد<\/b>/).length === 1, 'ووصله «نزل لك ٥» مرة وحدة');
  eq([ledger('u-friend2').length, rfB.credit_id || null], [0, null],
     '**صديقه استرجع اشتراكه: ما ينزل للداعي شي**');
  eq([ledger('u-friend3').length, (DB.referrals.find(x => x.id === 93) || {}).credit_id], [1, 991],
     '**انقطع بين الكتابة والحجز: ربطنا رصيده ولا كتبنا ثانٍ**');
  const nTick = EP.calls.length;
  await hook('ORDER-12346');
  eq(EP.calls.length, nTick, 'وجرس ثاني خلال ١٠ ثواني ما يسأل EdfaPay عن شي');

  /* ── ١١) اللوحة ── */
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq([ap.ready, ap.gateway, ap.host, ap.openTo], [true, 'edfapay', 'app-api.edfapay.com', 'all'],
     'اللوحة: جاهز · edfapay · app-api · للكل');
  ok(ap.counts.paid >= 4 && ap.counts.failed >= 1, 'وعدّاداته — ' + JSON.stringify(ap.counts));
  eq([ap.keySet, ap.hookSet, ap.hookLen], [true, true, HOOK_SECRET.length], 'والمفتاح والسرّ مضبوطان');
  ok(!/ep-live-key-for-tests|ep-hook-secret/.test(JSON.stringify(ap)), '**وما فيها حرف من المفتاح ولا السرّ**');
  const pg = (await call('POST', '/api/admin/pay-ping', { admin: true })).j;
  eq([pg.ok, pg.host], [true, 'app-api.edfapay.com'], 'زر «جرّب الاتصال» ينجح بالمفتاح الصحيح');
  ok(EP.calls.some(c => /orderId=JDW-PING-/.test(c.p)), 'وهو سؤال حالة لطلب ما يوجد — بلا أثر عندهم');

  /* ── ١٢) رد فتح الدفع بلا غلاف · رابط من نطاق ثاني · بوابة ما ردّت ── */
  {
    const mk = (u, ph) => { DB.profiles.push(prof(u, { phone: ph })); TOK['tok-' + u + '-zzzzzzzzzzzzzzzzzzzz'] = u;
      return 'tok-' + u + '-zzzzzzzzzzzzzzzzzzzz' };
    EP.shape = 'flat';
    const t1 = mk('u-flat', '0500000013');
    let rr = (await call('POST', '/api/me/checkout', { tok: t1, body: {} })).j;
    ok(rr.ok && /^https:\/\/checkout\.edfapay\.com\//.test(rr.url || ''), '**redirectUrl بلا غلاف data: يشتغل**');
    await call('POST', '/api/me/pay-cancel', { tok: t1, body: { id: rr.id } });
    EP.shape = 'data';

    EP.url = 'https://evil.example.com/pay?token=sess-secret-evil';
    const t2 = mk('u-evil', '0500000014');
    DB.credit_ledger.push({ id: 992, user_id: 'u-evil', amount_halalas: 500, reason: 'admin',
      expires_at: '2031-01-01T20:59:59+00:00', created_at: '2026-09-01T10:00:00+00:00' });
    rr = (await call('POST', '/api/me/checkout', { tok: t2, body: {} })).j;
    eq([rr.ok, rr.url], [false, undefined], '**رابط صفحة دفع من نطاق ثاني: ما نودّي له الطالب**');
    const se = DB.subscriptions.filter(x => x.user_id === 'u-evil').pop() || {};
    eq(se.status, 'failed', 'والطلب فشل');
    eq(ledger('u-evil').reduce((n, x) => n + x.amount_halalas, 0), 500, 'ورصيده رجع كامل');
    ok(LOGS.some(l => /نطاق غير متوقع \(evil\.example\.com\)/.test(l)), 'والسجل يقول النطاق');
    ok(!LOGS.some(l => /sess-secret-evil/.test(l)), '**بلا الرابط نفسه** (فيه رمز الجلسة)');
    EP.url = null;

    EP.shape = 'other';
    const t4 = mk('u-other', '0500000017');
    rr = (await call('POST', '/api/me/checkout', { tok: t4, body: {} })).j;
    ok(rr.ok === false && /بوابة الدفع ما ردّت/.test(rr.error || ''), 'الرابط باسم ما نعرفه: ما نودّيه لشي — «جرّب بعد شوي»');
    ok(LOGS.some(l => /200 بلا redirectUrl — الحقول: code, message, errorCode, data · data: sessionId, checkoutLink/.test(l)),
       '**والسجل يقول أسماء الحقول اللي رجعت** — يتصلّح بدفعة وحدة — ' + (LOGS.find(l => /بلا redirectUrl/.test(l)) || 'ولا سطر'));
    ok(!LOGS.some(l => /sess-secret|b08e4f9d/.test(l)), '**بلا قيمها** (فيها رابط الجلسة)');
    EP.shape = 'data';

    EP.initFail = 400;
    const t3 = mk('u-down', '0500000015');
    rr = (await call('POST', '/api/me/checkout', { tok: t3, body: {} })).j;
    ok(rr.ok === false && /بوابة الدفع ما ردّت/.test(rr.error || ''), 'EdfaPay رفض فتح الدفع: نقول للطالب يجرّب بعد شوي');
    eq((DB.subscriptions.filter(x => x.user_id === 'u-down').pop() || {}).status, 'failed', 'والطلب فشل');
    EP.initFail = 0;
  }

  /* ── ١٢ب) إشعار موقَّع يقول مدفوع وEdfaPay يقول لا: نعيد السؤال ثم ننبّهك — لا تفعيل ── */
  {
    DB.profiles.push(prof('u-says', { phone: '0500000016' })); TOK['tok-says-yyyyyyyyyyyyyyyyyyyyyy'] = 'u-says';
    const rr = (await call('POST', '/api/me/checkout', { tok: 'tok-says-yyyyyyyyyyyyyyyyyyyyyy', body: {} })).j;
    const n0 = EP.calls.filter(c => c.p.includes('orderId=JDW-' + rr.id)).length;
    await hook('JDW-' + rr.id);
    eq(sub(rr.id).status, 'pending', '**الإشعار يقول Approved وEdfaPay يقول PENDING: ما نفعّل**');
    await wait(10600);
    eq(EP.calls.filter(c => c.p.includes('orderId=JDW-' + rr.id)).length, n0 + 2, 'وسألنا مرة ثانية بعد ١٠ ثواني');
    ok(tgTo('5555', /إشعار EdfaPay يقول مدفوع وسؤال الحالة ما أكّد/).length === 1, '**وبعدها نبّهناك** — فلوس ربما وصلت');
    eq(sub(rr.id).status, 'pending', 'والطلب باقٍ معلّقاً لمراجعتك');
  }

  /* ── ١٣) التنبيه الطارئ: ما يُباع وهو ما ينفعّل، ومن اشتراه يوصله كيف يفعّله ── */
  let ms13 = (await call('GET', '/api/monitor-status')).j || {};
  eq(ms13.plans && ms13.plans.pushoverOffered, false, '**وضع التنبيه الطارئ «off»: الورقة ما تعرضه**');
  q = (await call('GET', '/api/me/quote?pushover=1', { tok: tokOf('u-po') })).j;
  eq([q.pushover, q.po, q.amount], [false, 0, 1900],
     '**ولو طلبه بنفسه: ما يُحسب** — كان يدفع على شي بطاقة تفعيله مخفية');
  await call('POST', '/api/admin/pushover-mode', { admin: true, body: { mode: 'addon' } });
  ms13 = (await call('GET', '/api/monitor-status')).j || {};
  eq(ms13.plans && ms13.plans.pushoverOffered, true, 'وضع «addon»: تنعرض');
  eq(ms13.plans && ms13.plans.termCode, q.term, 'والورقة تعرف أي ترم تبيع — نفس ترم السعر');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-po'), body: { pushover: true } })).j;
  ok(r.ok, 'اشترى الترم مع التنبيه الطارئ — ' + JSON.stringify(r));
  const s13 = sub(r.id) || {};
  /* السعر ١٥ ريال (قرار محمد ٣٠ سبتمبر ٢٠٢٦ — كان ١٠) */
  eq([s13.pushover, s13.amount_halalas], [true, 3400], 'الصف: مع الإضافة · ٣٤ ريال');
  ord(r.id).status = 'PAID';
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-po') });
  eq(sub(r.id).status, 'paid', 'ودفع');
  const rp = String((tgTo('6010', /إيصال/).pop() || {}).text || '');
  ok(rp.includes('• التنبيه الطارئ: 15 ريال') && rp.includes('<b>المدفوع: 34 ريال</b>'),
     'الإيصال فيه الإضافة والمجموع — ' + rp.slice(0, 160));
  ok(/فعّل التنبيه الطارئ/.test(rp) && /تطبيق <b>Pushover<\/b>/.test(rp) &&
     rp.includes('https://jadwalik.com/?pushover=1'), '**ومعه خطوات تفعيل التنبيه الطارئ ورابطها**');
  ok(/Critical Alerts/.test(rp), 'وكيف يرن وهو صامت');
  ok(/لو طلب منك دفعاً/.test(rp), 'ووعد الصفحة نفسه: إضافتك تغطي التطبيق');
  ok(rp.indexOf('سجل تجاري 7055288521') > rp.indexOf('ساري حتى') &&
     rp.indexOf('سجل تجاري 7055288521') < rp.indexOf('فعّل التنبيه الطارئ'),
     'ورقم السجل آخر الفاتورة — قبل خطوات التفعيل لا بعدها');

  /* ── ١٤) الأسرار والسجل ── */
  ok(!LOGS.some(l => /ep-live-key-for-tests|ep-hook-secret-for-tests/.test(l)), '**ولا المفتاح ولا السرّ في السجل أبداً**');
  ok(LOGS.some(l => /^pay: edfapay · app-api\.edfapay\.com · المفتاح مضبوط · الإشعار مضبوط \(\d+ حرف\)$/.test(l)),
     'سطر الإقلاع — ' + (LOGS.find(l => /^pay: /.test(l)) || ''));
  ok(![...EP.hosts].some(h => /paylink/.test(h)), '**ولا طلب واحد لـPaylink** — انشالت كلها');
  eq((await call('POST', '/api/paylink/webhook', { body: {} })).code === 200, false, 'ومسار إشعار Paylink ما عاد يقبل شي');
}

async function devSuite() {
  await setWindow('2000-01-01', '2000-01-02');
  let q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'test'],
     '**dev: الطالب ما يدفع** — الملف مشترك مع الإنتاج، فدفعة تجربة كانت بتعطيه اشتراكاً حقيقياً');
  eq((await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } })).code, 200,
     'في dev إطفاء الفترة المجانية ما يُحرس');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && q.pay.open, false, 'ولو انطفت الفترة المجانية: dev لصاحب الموقع وحده');
  const r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '+966 51 234 5678' } })).j;
  ok(r.ok, 'صاحب الموقع يجرّب — ' + JSON.stringify(r));
  const s = sub(r.id) || {};
  const a = (inits()[0] || {}).b || {};
  eq(s.gateway, 'edfapay-test', '**بوابة التجربة باسمها** — خارج الإيرادات');
  eq(a.orderId, 'JDWT-' + r.id, 'ورقم طلبها غير الإنتاج');
  eq(a.customerDetails && a.customerDetails.phone, '+966-512345678', '+966 بمسافات يتحوّل');
  eq(a.successUrl, `https://127.0.0.1:${PORT}/?pay=${r.id}`, 'والرجوع على عنوان التجربة نفسه');
  eq([...EP.hosts], ['demo-api.edfapay.com'], '**dev على demo-api (خادم التجربة في توثيقهم) لا الإنتاج**');
  /* صف إنتاج معلّق في نفس القاعدة: dev ما يلمسه */
  DB.subscriptions.push({ id: 9001, user_id: 'u-st', term: '203010', status: 'pending', gateway: 'edfapay',
    gateway_ref: null, amount_halalas: 1900, credit_halalas: 0, includes_term: true,
    valid_until: END_NOW, created_at: new Date(Date.now() - 30 * 3600e3).toISOString() });
  ord(r.id).status = 'PAID';
  await hook('JDWT-' + r.id);
  eq(sub(r.id).status, 'paid', 'إشعار برقم طلب التجربة: مدفوع');
  ok(tgTo('5555', new RegExp('إيصال JDWT-' + r.id + '</b> \\(تجربة\\)')).length === 1,
     'وإيصال التجربة مكتوب عليه «تجربة»');
  eq(P('u-own').paid_at, null, '**دفعة تجريبية ما تُحسب «دفع فعلي»** في إحصاء الإنتاج');
  /* دعوة إنتاج نضجت (٨ أيام واشتراكها مدفوع): dev ما يمنحها — القاعدة مشتركة */
  DB.profiles.push(prof('u-dinv'), prof('u-dref'));
  DB.subscriptions.push({ id: 9002, user_id: 'u-dinv', status: 'paid', gateway: 'edfapay', term: '203010',
    base_halalas: 1900, pushover_halalas: 0, discount_halalas: 300, credit_halalas: 0, amount_halalas: 1600 });
  DB.referrals.push({ id: 94, referrer_id: 'u-dref', invited_id: 'u-dinv', subscription_id: 9002, credit_id: null,
    created_at: new Date(Date.now() - 8 * 864e5).toISOString() });
  const n0 = EP.calls.length;
  await hook('JDW-9001');                          /* رقم طلب الإنتاج وصل dev: جرس لصفوف dev وحدها */
  await wait(500);
  eq(sub(9001).status, 'pending', '**صف الإنتاج المعلّق ما لمسه dev** — كل بيئة تنظّف صفوفها');
  ok(!EP.calls.slice(n0).some(c => /orderId=JDW-9001/.test(c.p)), 'وما سأل عنه EdfaPay أصلاً');
  eq(ledger('u-dref').length, 0, '**ورصيد دعوة الإنتاج ما يمنحه dev** — الإنتاج وحده يمنح');
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq([ap.live, ap.host, ap.hostBad, ap.openTo], [false, 'demo-api.edfapay.com', false, 'owner'], 'اللوحة: التجربة · demo-api · لك وحدك');
}

/* مفتاح «Test Mode» من لوحة التاجر ما قالوا لأي خادم: dev يقبل EDFAPAY_HOST من خوادمهم */
async function devhostSuite() {
  const r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '0512345678' } })).j;
  ok(r.ok, 'صاحب الموقع يجرّب — ' + JSON.stringify(r));
  eq([...EP.hosts], ['revamp-api.edfapay.com'], '**EDFAPAY_HOST (بـhttps:// وشرطة) يغيّر خادم dev**');
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq([ap.host, ap.hostBad], ['revamp-api.edfapay.com', false], 'واللوحة تقوله');
}

async function devhintSuite() {
  const pg = (await call('POST', '/api/admin/pay-ping', { admin: true })).j;
  eq([pg.ok, pg.hostHint], [false, 'app-api.edfapay.com'], '**مفتاح Test Mode مرفوض على demo-api: زر التجربة يجرّب الباقي ويقول وين انقبل**');
  ok(/EDFAPAY_HOST/.test(pg.error || '') && /app-api\.edfapay\.com/.test(pg.error || ''), 'ويقول وش يضبط في Render — ' + pg.error);
  ok(!/ep-app-only-key/.test(JSON.stringify(pg)), 'بلا المفتاح نفسه');
}

async function nokeysSuite() {
  const q = (await call('GET', '/api/me/quote', { tok: tokOf('u-own') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'nokeys'], 'الإنتاج بلا مفتاح: الدفع مقفل حتى لصاحب الموقع');
  const b = await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } });
  eq(b.code, 400, '**§١٠: ما تنطفي الفترة المجانية في الإنتاج قبل البوابة**');
  ok(/EDFAPAY_API_KEY/.test(String(b.j && b.j.error)), 'والرسالة تسمّي المتغيّر — ' + (b.j && b.j.error));
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq([ap.ready, ap.keySet, ap.hookSet, ap.openTo], [false, false, false, 'none'], 'اللوحة تقول المفتاح والسرّ ناقصان');
  const pg = (await call('POST', '/api/admin/pay-ping', { admin: true })).j;
  ok(pg.ok === false && /EDFAPAY_API_KEY/.test(pg.error || ''), 'وزر التجربة يسمّي المتغيّر');
  const h = await hook('JDW-1');
  eq([h.code, h.j && h.j.why], [401, 'no-secret-configured'], '**بلا سرّ في Render: الإشعار مقفل**');
  eq(EP.calls.length, 0, 'وما طلبنا EdfaPay بلا مفتاح');
  ok(LOGS.some(l => /^pay: edfapay · app-api\.edfapay\.com · المفتاح ناقص · الإشعار بلا سرّ$/.test(l)), 'وسطر الإقلاع');
}

/* مفتاح يرفضه EdfaPay (تجربة في الإنتاج، أو نسخ ناقص) */
async function badkeySuite() {
  const pg = (await call('POST', '/api/admin/pay-ping', { admin: true })).j;
  ok(pg.ok === false && /رفض المفتاح \(401\)/.test(pg.error || '') && /Test Mode/.test(pg.error || ''),
     '**زر «جرّب الاتصال»: EdfaPay رفض المفتاح — ويقول وش يحط** — ' + pg.error);
  DB.credit_ledger.push({ id: 993, user_id: 'u-own', amount_halalas: 500, reason: 'admin',
    expires_at: '2031-01-01T20:59:59+00:00', created_at: '2026-09-01T10:00:00+00:00' });
  const r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '0512345678' } })).j;
  ok(r.ok === false && /بوابة الدفع ما ردّت/.test(r.error || ''), 'صاحب الموقع يدفع: «ما ردّت، جرّب بعد شوي»');
  eq(ledger('u-own').reduce((n, x) => n + x.amount_halalas, 0), 500, 'ورصيده المحجوز رجع');
  ok(LOGS.some(l => /EdfaPay initiate: 401/.test(l)), 'والسجل فيه رد EdfaPay');
  ok(!LOGS.some(l => /ep-wrong-key/.test(l)), 'بلا المفتاح نفسه');
}

(async () => {
  await wait(400);
  try {
    await ({ prod: prodSuite, dev: devSuite, devhost: devhostSuite, devhint: devhintSuite, nokeys: nokeysSuite,
             badkey: badkeySuite })[MODE]();
  } catch (e) { fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e)) }
  console.log = realLog;

  /* الأب يشغّل البقية كعمليات مستقلة ويجمع النتائج */
  if (MODE === 'prod') {
    for (const m of ['dev', 'devhost', 'devhint', 'nokeys', 'badkey']) {
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
