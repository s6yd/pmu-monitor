/* بوابة الدفع (Paylink) — اختبار سلوكي على السيرفر الحقيقي.
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور Supabase وPaylink وتلقرام.

   أخطار يمسكها:
   ١) **التفعيل بلا إثبات**: رجوع الطالب والإشعار جرس — التفعيل بعد ما نسأل
      Paylink: Paid · المبلغ بالهللة · رقم الطلب · رقم العملية. أي اختلاف ⇒ لا.
   ٢) **التفعيل مرتين** (إشعار يتكرر، رجوع + إشعار) ⇒ رصيد داعٍ مرتين.
   ٣) **رصيد يضيع**: دفعة ما اكتملت ⇒ الرصيد المحجوز يرجع بصلاحيته الأصلية.
   ٤) **فاتورة أقل من ٥ ريال** ترفضها البوابة ⇒ الرصيد يُصرف بقدر يترك ٥.
   ٥) **البيئتان تتشاركان القاعدة**: dev ببطاقات تجريبية عامة ⇒ لصاحب الموقع
      وحده، وما يلمس صفوف الإنتاج. والإنتاج يرفض مفتاح التجربة العام.
   ٦) **قبل الإطلاق** الطلاب ما يدفعون (الفترة المجانية) — صاحب الموقع وحده.
   ٧) آخر أيام النافذة ⇒ الترم الجاي — وخارج النوافذ كذلك (قرار محمد).
   ٨) **الإشعار يرفض بلا سبب**: زر Test في Paylink رجّع `{"ok":false}` وبس، فما
      عرفنا وش الغلط. الرفض يقول رمز سببه، واللوحة الأسماء والأطوال (لا القيم)،
      وعلامات الاتجاه المخفية من النسخ على الجوال ما تكسر المطابقة.
   ٩) **Paylink ما يرسل ترويستنا** (شفناها في اللوحة على الإنتاج) ⇒ المفتاح في
      الرابط (`?key=`) يُقبل — وما ينكتب في سجل ولا لوحة.
   ١٠) **الإيصال** (لقاها محمد): «اشتراكك فعّال» وحدها ما تقول وش اشترى ولا كم
       — وآخره وصف الخدمة ورقم السجل، بلا اسم المؤسسة (قرار محمد)
      دفع — ومن اشترى التنبيه الطارئ ما يدري إن فيه خطوة تفعيل. **وما نبيع
      إضافة ما تنفعّل**: وضعها «off» يخفي بطاقة التفعيل.

   node tests/test-pay.js [server.js]
   (يشغّل نفسه أربع مرات إضافية كعمليات مستقلة: dev · إنتاج بلا مفاتيح ·
    إنتاج بمفتاح التجربة العام · مفتاح إشعار لُصق بحروف مخفية — المتغيّرات
    تُقرأ مرة عند الإقلاع) */
const path = require('path');
const http = require('http');
const net = require('net');
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

/* ═══ Paylink المزيّف ═══ */
const PL = { hosts: new Set(), calls: [], inv: {}, tx: 7000, auth: 0 };
function paylink(method, p, body, headers) {
  const b = body ? JSON.parse(body) : {};
  PL.calls.push({ method, p, b });
  if (p === '/api/auth') {
    PL.auth++;
    if (b.apiId === process.env.PAYLINK_API_ID && b.secretKey === process.env.PAYLINK_SECRET)
      return [200, { id_token: 'pl-token-1' }];
    return [401, { detail: 'Invalid credentials' }];
  }
  if (headers.Authorization !== 'Bearer pl-token-1') return [401, { detail: 'Unauthorized' }];
  if (p === '/api/addInvoice') {
    const tx = String(++PL.tx) + '1234';
    PL.inv[tx] = { transactionNo: tx, orderStatus: 'Pending', amount: b.amount, success: true,
      url: 'https://payment.paylink.sa/pay/order/' + tx, gatewayOrderRequest: Object.assign({}, b) };
    return [200, PL.inv[tx]];
  }
  const m = /^\/api\/getInvoice\/(.+)$/.exec(p);
  if (m) return PL.inv[m[1]] ? [200, PL.inv[m[1]]] : [404, { detail: 'not found' }];
  if (p === '/api/cancelInvoice') {
    if (PL.inv[b.transactionNo]) PL.inv[b.transactionNo].orderStatus = 'Canceled';
    return [200, { success: true }];
  }
  return [404, {}];
}

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
      } else if (/paylink\.sa$/.test(host)) {
        PL.hosts.add(host);
        [code, o] = paylink(opts.method, opts.path, body, opts.headers || {});
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

const BASES = { prod: 47500, dev: 47600, nokeys: 47700, testkey: 47800, hookenv: 48400 };
const PORT = BASES[MODE] + (process.pid % 100);
const KEYS = {
  prod:    { SITE_ENV: 'prod', PAYLINK_API_ID: 'APP_ID_LIVE_9', PAYLINK_SECRET: 'live-secret' },
  dev:     { SITE_ENV: 'dev',  PAYLINK_API_ID: 'APP_ID_1123453311', PAYLINK_SECRET: 'pub-test-secret' },
  /* بلا مفاتيح Paylink ولا مفتاح إشعار */
  nokeys:  { SITE_ENV: 'prod', PAYLINK_API_ID: '', PAYLINK_SECRET: '', PAYLINK_WEBHOOK_KEY: '' },
  testkey: { SITE_ENV: 'prod', PAYLINK_API_ID: 'APP_ID_1123453311', PAYLINK_SECRET: 'pub-test-secret' },
  /* مفتاح الإشعار لُصق في Render من رسالة عربية على الجوال: علامتا اتجاه
     مخفيتان حوله وسطر جديد في آخره */
  hookenv: { SITE_ENV: 'prod', PAYLINK_API_ID: 'APP_ID_LIVE_9', PAYLINK_SECRET: 'live-secret',
             PAYLINK_WEBHOOK_KEY: '\u200fhook-key-1234567890\u200e \n' },
}[MODE];
Object.assign(process.env, { PAYLINK_WEBHOOK_KEY: 'hook-key-1234567890' }, KEYS, {
  PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests', ADMIN_CHAT_ID: '5555',
  /* ترم بعيد وثابت: الاختبار ما يتغيّر مع التاريخ الحقيقي (نهايته 2029-12-31) */
  ACTIVE_TERM: '203010', FREE_BETA: 'true', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', TELEGRAM_TOKEN: 'tg',
  /* رابط اشتراك Pushover موجود — والوضع يبدأ «off» كما في الإنتاج قبل ما يُشغَّل */
  PUSHOVER_SUBSCRIBE_URL: 'https://pushover.net/subscribe/Jadwalik-test'
});
const realLog = console.log;
/* سجل السيرفر محفوظ لا مطبوع: نفحص إن سطوره ما فيها قيمة مفتاح أبداً */
const LOGS = [];
console.log = (...a) => { LOGS.push(a.map(String).join(' ')) };
require(SRV);

function call(method, p, { tok, body, headers, admin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = Object.assign({}, headers || {});
    if (data) h['Content-Type'] = 'application/json';
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
const hook = (body, key) => call('POST', '/api/paylink/webhook',
  { body, headers: key === undefined ? { 'X-Jadwalik-Key': 'hook-key-1234567890' } : (key ? { 'X-Jadwalik-Key': key } : {}) });
/* إشعار بالبايتات كما هي: http.request يرمّز الترويسة UTF-8 مرة ثانية لما
   تنضم للجسم، فالعلامة المخفية توصل بغير بايتاتها الحقيقية */
function rawHook(keyBytes) {
  return new Promise((resolve, reject) => {
    const req = Buffer.concat([Buffer.from('POST /api/paylink/webhook HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
      'Content-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\nX-Jadwalik-Key: '),
      keyBytes, Buffer.from('\r\n\r\n{}')]);
    let o = '';
    const c = net.connect(PORT, '127.0.0.1', () => c.end(req));
    c.on('data', d => o += d);
    c.on('end', () => resolve(Number((/^HTTP\/1\.1 (\d+)/.exec(o) || [])[1]) || 0));
    c.on('error', reject);
  });
}
const sub = id => DB.subscriptions.find(s => s.id === id);
const P = id => DB.profiles.find(p => p.id === id);
const ledger = u => DB.credit_ledger.filter(r => r.user_id === u);
const adds = () => PL.calls.filter(c => c.p === '/api/addInvoice');
const tgTo = (chat, re) => TG.filter(m => String(m.chat_id) === chat && re.test(String(m.text || '')));
const END_NOW = '2029-12-31T20:59:59.000Z';    /* termEndApprox('203010') */
const END_NEXT = '2030-06-15T20:59:59.000Z';   /* termEndApprox('203020') */

async function prodSuite() {
  /* وسط نافذة يدوية: ترم الشراء = ترم الدراسة، فالتواريخ ثابتة (END_NOW).
     **كانت «بلا نافذة»** — وبلا نافذة صار الشراء للترم الجاي (قرار محمد،
     القسم ٨ب)، فنقلنا الحالة الأساسية لوسط النافذة: نفس ما كان يختبره. */
  await setWindow(riyadh(-5), riyadh(+10));

  /* ── ١) قبل الإطلاق: الطالب ما يدفع، وصاحب الموقع يجرّب ── */
  let q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'beta'], '**الفترة المجانية: الطالب ما يشوف دفعاً**');
  let r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-st'), body: { phone: '0512345678' } })).j;
  eq([r.ok, r.why], [false, 'beta'], 'ولو نادى الدفع بنفسه يترفض');
  eq(adds().length, 0, 'وما انفتحت فاتورة');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-own') })).j;
  eq(q.pay && q.pay.open, true, '**وصاحب الموقع يقدر يجرّب بدفعة حقيقية**');
  eq([q.term, q.termEnd, q.late], ['203010', END_NOW, false], 'ترم الشراء وسط النافذة: ترمها');

  /* ── ٢) بدء الدفع ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: {} })).j;
  eq([r.ok, r.why], [false, 'phone'], 'بلا جوال: نطلبه — Paylink يشترطه');
  /* رقم غلط: يقول له الصح بالضبط (لقاها محمد) — كانت «اكتب رقم جوالك» وهو كاتبه */
  for (const bad of ['051234567', '05123456789', '0612345678', '12345']) {
    r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: bad } })).j;
    ok(r.ok === false && r.why === 'phone' && /يبدأ بـ05 ويكون 10 أرقام/.test(r.error || ''),
       `رقم غلط (${bad}): «لازم يبدأ بـ05 ويكون 10 أرقام» — ` + JSON.stringify(r));
  }
  eq(adds().length, 0, 'وما انفتحت فاتورة برقم غلط');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '٠٥١٢٣٤٥٦٧٨' } })).j;
  ok(r.ok && /^https:\/\/payment\.paylink\.sa\//.test(r.url || ''), 'رابط صفحة الدفع — ' + JSON.stringify(r));
  const s1 = sub(r.id) || {};
  const a1 = (adds()[0] || {}).b || {};
  eq(a1.amount, 19, 'الفاتورة بالريال: ١٩');
  eq(a1.orderNumber, 'JDW-' + r.id, 'رقم الطلب من صفّنا');
  eq(a1.callBackUrl, 'https://jadwalik.com/?pay=' + r.id, '**رابط الرجوع على نطاقنا دائماً** — لا ترويسة Host');
  eq(a1.clientMobile, '0512345678', '**الأرقام العربية من كيبورد الآيفون تتحوّل**');
  eq(a1.clientName, 'Name u-own', 'اسم الطالب');
  eq([s1.status, s1.gateway, s1.gateway_ref, s1.amount_halalas, s1.term, s1.valid_until],
     ['pending', 'paylink', a1 && Object.keys(PL.inv).pop(), 1900, '203010', END_NOW], 'الصف معلّق بكل تفاصيله');
  eq(P('u-own').phone, '0512345678', 'والجوال انحفظ في الملف');
  ok([...PL.hosts].every(h => h === 'restapi.paylink.sa'), 'الإنتاج على restapi — ' + [...PL.hosts]);

  const r2 = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '0512345678' } })).j;
  eq([r2.ok, r2.why, r2.id], [false, 'pending', r.id], '**طلب ثانٍ والأول معلّق: نرجّعه له لا فاتورة ثانية**');
  ok(/payment\.paylink\.sa/.test(r2.url || ''), 'ومعه رابط يكمّل منه');
  eq(adds().length, 1, 'وما انفتحت فاتورة ثانية');

  /* ── ٣) الرجوع والإشعار: جرس لا إثبات ── */
  let st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-own') })).j;
  eq(st.status, 'pending', 'رجع وما دفع: معلّق');
  eq(P('u-own').subscription_expires_at, null, 'وما انفعّل');
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-st') })).j;
  eq(st.ok, false, '**طالب ثانٍ ما يقرأ طلب غيره**');

  const tx = s1.gateway_ref;
  eq((await hook({ transactionNo: tx }, '')).code, 401, 'إشعار بلا ترويسة: مرفوض');
  eq((await hook({ transactionNo: tx }, 'wrong-key-000000000')).code, 401, 'وبترويسة غلط: مرفوض');

  PL.inv[tx].orderStatus = 'Paid'; PL.inv[tx].amount = 1;
  await hook({ transactionNo: tx });
  eq([sub(r.id).status, P('u-own').subscription_expires_at], ['pending', null],
     '**Paylink يقول Paid بمبلغ غلط: ما نفعّل**');
  ok(tgTo('5555', /تحتاج نظرك[\s\S]*المبلغ/).length === 1, 'ونبلّغ صاحب الموقع');

  PL.inv[tx].amount = 19; PL.inv[tx].gatewayOrderRequest.orderNumber = 'JDW-999';
  await hook({ transactionNo: tx });
  eq(sub(r.id).status, 'pending', '**رقم طلب ما يطابق: ما نفعّل**');
  delete PL.inv[tx].gatewayOrderRequest.orderNumber;
  await hook({ transactionNo: tx });
  eq(sub(r.id).status, 'pending', '**ورقم طلب ناقص = ما يطابق** (نقفل عند الشك)');

  PL.inv[tx].gatewayOrderRequest.orderNumber = 'JDW-' + r.id;
  const hk = await hook({ transactionNo: tx });
  eq(hk.code, 200, 'الإشعار الصحيح: ٢٠٠');
  eq(sub(r.id).status, 'paid', '**تحقّقنا من Paylink بأنفسنا ⇒ مدفوع**');
  eq(P('u-own').subscription_expires_at, END_NOW, 'والاشتراك حتى نهاية نهائيات الترم');
  ok(!!P('u-own').paid_at, 'وpaid_at للدفع الحقيقي');
  eq(tgTo('5555', /اشتراكك فعّال/).length, 1, 'الطالب وصله «اشتراكك فعّال»');
  /* الإيصال — لقاها محمد: كانت «اشتراكك فعّال حتى …» وبس */
  const rt = String((tgTo('5555', /إيصال/).pop() || {}).text || '');
  ok(rt.includes('إيصال JDW-' + r.id), '**بعد الدفع يوصله إيصال برقم الطلب** — ' + rt.slice(0, 120));
  ok(rt.includes('• اشتراك خريف 2029/2030: 19 ريال'), 'وش اشترى: الترم باسمه وسعره');
  ok(rt.includes('<b>المدفوع: 19 ريال</b> · عبر Paylink'), 'وكم دفع ووين');
  ok(rt.includes('رقم العملية: <code>' + tx + '</code>'), 'ورقم العملية عند Paylink');
  ok(rt.includes('ساري حتى: 31 ديسمبر 2029'), 'وحتى متى — بالسنة');
  /* اللائحة التنفيذية لنظام التجارة الإلكترونية: وصف الخدمة ورقم السجل في الفاتورة —
     بلا اسم المؤسسة (قرار محمد ٣٠ سبتمبر ٢٠٢٦) */
  ok(rt.endsWith('ساري حتى: 31 ديسمبر 2029\n\nاشتراك ترم في جدولك · سجل تجاري 7055288521'),
     '**آخر الإيصال: وصف الخدمة ورقم السجل** — ' + JSON.stringify(rt.slice(-150)));
  ok(!/مؤسسة|المسبح/.test(rt), 'وبلا اسم المؤسسة');
  ok(!/Pushover/.test(rt), 'وبلا التنبيه الطارئ: ما فيه خطوات تفعيل');

  await hook({ transactionNo: tx });
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-own') });
  eq(tgTo('5555', /اشتراكك فعّال/).length, 1, '**الإشعار يتكرر والرجوع بعده: تفعيل واحد بس**');
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-own') })).j;
  eq([st.status, st.until], ['paid', END_NOW], 'وصفحة الرجوع تقول مدفوع وحتى متى');

  /* ── ٤) الإطلاق: الطلاب يدفعون ── */
  eq((await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } })).code, 200,
     'إطفاء الفترة المجانية مسموح والمفاتيح جاهزة');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && q.pay.open, true, 'بعد الإطلاق: الطالب يدفع');

  /* ── ٥) أقل دفع نقدي ١٠ ريال (الشروط §٣ — قرار محمد، كان «نترك ٥ للبوابة»)،
     والرصيد المحجوز يرجع بصلاحيته ── */
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-cr') })).j;
  eq([q.credit, q.amount, q.minCash], [900, 1000, 1000], '**رصيد ١٥ وسعر ١٩: نصرف ٩ ويدفع ١٠** — أقل دفع نقدي');
  /* رقم جديد غلط والقديم محفوظ (ولا دفعة معلّقة): كان يُتجاهل بصمت ويكمل بالقديم */
  const nA = adds().length;
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: { phone: '05123' } })).j;
  eq([r.ok, r.why], [false, 'phone'], '**رقم جديد غلط: نقوله له — ما نكمل بالمحفوظ بصمت**');
  eq([adds().length, ledger('u-cr').filter(x => x.reason === 'spend').length, P('u-cr').phone],
     [nA, 0, '0500000001'], 'وما انفتحت فاتورة ولا انحجز رصيد، والمحفوظ ما تغيّر');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-cr'), body: {} })).j;
  ok(r.ok && r.url, 'الجوال المحفوظ يكفي — ' + JSON.stringify(r));
  const sp = ledger('u-cr').find(x => x.reason === 'spend');
  eq(sp && [sp.amount_halalas, sp.ref, String(sp.expires_at).slice(0, 10)],
     [-900, 'subscription:' + r.id, '2027-03-01'], 'حجز ٩ من الرصيد، بصلاحية منحته');
  eq((adds().pop() || {}).b.amount, 10, 'والفاتورة ١٠ ريال');
  /* ٢٥ ساعة بلا دفع ⇒ تنلغي ويرجع الرصيد */
  sub(r.id).created_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  await hook({ something: 'else' });           /* جرس بجسم ما نعرفه ⇒ تسوية المعلّقات */
  eq(sub(r.id).status, 'failed', '**بعد ٢٤ ساعة بلا دفع: فشل**');
  eq(PL.inv[sub(r.id).gateway_ref].orderStatus, 'Canceled', 'وألغينا الفاتورة عند Paylink');
  const rv = ledger('u-cr').find(x => x.reason === 'reversal');
  eq(rv && [rv.amount_halalas, String(rv.expires_at).slice(0, 10)], [900, '2027-03-01'],
     '**والرصيد رجع بصلاحيته الأصلية** — لا أطول ولا أقصر');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-cr') })).j;
  eq(q.creditAvailable, 1500, 'ورصيده ١٥ كما كان');

  /* ── ٦) رصيد أكبر من السعر: يدفع ١٠ نقداً والرصيد يغطي الباقي ──
     كانت «الرصيد يغطي الكل ⇒ تفعيل بلا فاتورة». تغيّرت عمداً (الشروط §٣ — قرار محمد):
     طلب بلا دفع نقدي ما يغطي رسوم البوابة لو انسترجع أو انعرض عليه اعتراض */
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-full') })).j;
  eq([q.credit, q.amount], [900, 1000], '**رصيد ٥٠ وسعر ١٩: يدفع ١٠ والرصيد ٩** — ما فيه تفعيل بالرصيد وحده');
  const nAdds = adds().length;
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-full'), body: {} })).j;
  eq([r.ok, r.why], [false, 'phone'], 'يدفع نقداً ⇒ يحتاج جوال — ما تفعّل بلا دفع');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-full'), body: { phone: '0500000011' } })).j;
  ok(r.ok && r.url && !r.activated, 'فاتورة لا تفعيل بالرصيد وحده — ' + JSON.stringify(r));
  eq([adds().length, (adds()[adds().length - 1] || {}).b && adds()[adds().length - 1].b.amount], [nAdds + 1, 10],
     'انفتحت فاتورة بعشرة ريال');
  const sf = ledger('u-full').find(x => x.reason === 'spend');
  eq(sf && sf.amount_halalas, -900, 'وحجز ٩ من الرصيد');
  PL.inv[sub(r.id).gateway_ref].orderStatus = 'Paid';
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-full') });
  eq([sub(r.id).status, sub(r.id).gateway], ['paid', 'paylink'], 'مدفوع عبر البوابة');
  eq(P('u-full').subscription_expires_at, END_NOW, 'والاشتراك فعّال');
  ok(!!P('u-full').paid_at, 'ودفع فعلي (١٠ نقداً) — يُحسب في الإحصاء');
  ok(tgTo('6011', /إيصال JDW-/).some(m => /• من رصيدك: −9 ريال/.test(m.text)
     && /<b>المدفوع: 10 ريال<\/b> · عبر Paylink/.test(m.text)), 'وإيصاله: من رصيدك −٩ والمدفوع ١٠');

  /* ── ٧) الدعوة تنسجّل لحظة التسوية — مرة للأبد، والرصيد بعد ٧ أيام (§١٠ تحت) ──
     الشروط §٣ (الجولة الثانية): «٥ ريال رصيد بعد ٧ أيام من اشتراكه… وإذا استُرجع
     اشتراكه قبلها، ما ينضاف لك» — كان ينزل لحظة الدفع. تغيّرت القاعدة عمداً */
  q = (await call('GET', '/api/me/quote?ref=FRD234', { tok: tokOf('u-ref') })).j;
  eq([q.discount, q.amount], [300, 1600], 'كود صديق: −٣');
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-ref'), body: { ref: 'frd234' } })).j;
  ok(r.ok, 'بدأ الدفع بكود صديقه');
  eq(sub(r.id).referral_code, 'FRD234', 'والكود محفوظ في الطلب');
  eq(ledger('u-friend').length, 0, 'وما نزل رصيد للداعي قبل الدفع');
  const txr = sub(r.id).gateway_ref;
  PL.inv[txr].orderStatus = 'Paid';
  st = (await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-ref') })).j;
  eq(st.status, 'paid', 'رجع من صفحة الدفع وقد دفع: مدفوع (بلا انتظار الإشعار)');
  eq(DB.referrals.filter(x => x.invited_id === 'u-ref').length, 1, 'صف دعوة واحد');
  eq(ledger('u-friend').length, 0, '**والداعي ما نزل له شي قبل مدة الاسترجاع**');
  ok(tgTo('7777', /صديقك اشترك/).some(m => /بعد 7 أيام، لما تخلص مدة الاسترجاع/.test(m.text)),
     'ووصله خبر: ينزل لك ٥ بعد ٧ أيام');
  await hook({ transactionNo: txr });
  await wait(4100);
  await call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-ref') });
  eq([ledger('u-friend').length, DB.referrals.filter(x => x.invited_id === 'u-ref').length], [0, 1],
     '**إشعار ورجوع بعد التسوية: ولا دعوة ثانية ولا رصيد**');

  /* ── ٧ب) سباق: الإشعار ورجوع الطالب بنفس اللحظة ──
     الاثنان يقرون الطلب «معلّقاً» قبل ما يسوّيه أحدهما — التحديث المشروط
     وحده يخلّي واحداً يفعّل. بلاه: تفعيلان ورسالتان. */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-race'), body: { ref: 'FRE234' } })).j;
  const txq = sub(r.id).gateway_ref;
  PL.inv[txq].orderStatus = 'Paid';
  await Promise.all([hook({ transactionNo: txq }),
                     call('GET', '/api/me/pay?id=' + r.id, { tok: tokOf('u-race') }),
                     hook({ orderNumber: 'JDW-' + r.id })]);
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

  /* ── ٨ب) خارج النوافذ ⇒ الترم الجاي (قرار محمد) ──
     كان ترم الدراسة: من يشتري بعد ما ينقفل التسجيل يدفع لترم ما بقى
     فيه شي يراقبه. صار للترم الجاي، وباقي الحالي هدية. */
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

  /* ── ٩) ألغاها ثم دفعها من تبويب قديم: فلوسه وصلت ⇒ نفعّل ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-late'), body: {} })).j;
  const txl = sub(r.id).gateway_ref;
  let c = (await call('POST', '/api/me/pay-cancel', { tok: tokOf('u-late'), body: { id: r.id } })).j;
  eq([c.status, sub(r.id).status, PL.inv[txl].orderStatus], ['failed', 'failed', 'Canceled'], 'الإلغاء: فشل + إلغاء عند Paylink');
  PL.inv[txl].orderStatus = 'Paid';
  await hook({ transactionNo: txl });
  eq(sub(r.id).status, 'paid', '**دفعة وصلت بعد الإلغاء: فعّلناه** — الفلوس ما تضيع');
  eq(P('u-late').subscription_expires_at, END_NOW, 'والاشتراك فعّال');

  /* ── ٩ب) مدفوعة بتفاصيل ما تطابق ثم ضغط «ألغها»: ما نلغي فلوساً وصلت ── */
  {
    const P2 = prof('u-mis2', { phone: '0500000007' });
    DB.profiles.push(P2); TOK['tok-mis2-iiiiiiiiiiiiiiiiiiiiii'] = 'u-mis2';
    const rr = (await call('POST', '/api/me/checkout', { tok: 'tok-mis2-iiiiiiiiiiiiiiiiiiiiii', body: {} })).j;
    const tm = sub(rr.id).gateway_ref;
    PL.inv[tm].orderStatus = 'Paid'; PL.inv[tm].amount = 18;
    const cc = (await call('POST', '/api/me/pay-cancel', { tok: 'tok-mis2-iiiiiiiiiiiiiiiiiiiiii', body: { id: rr.id } })).j;
    eq([cc.status, cc.review, sub(rr.id).status], ['pending', true, 'pending'],
       '**مدفوعة بمبلغ ما يطابق ثم «ألغها»: تبقى معلّقة لمراجعتك** — ما نلغي فلوساً ربما وصلت');
    eq(PL.inv[tm].orderStatus, 'Paid', 'وما ألغيناها عند Paylink');
  }

  /* ── ١٠) فاتها الإشعار والرجوع: الدورة تسوّيها ولو بعد ٢٤ ساعة ── */
  r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-miss'), body: {} })).j;
  sub(r.id).created_at = new Date(Date.now() - 26 * 3600e3).toISOString();
  PL.inv[sub(r.id).gateway_ref].orderStatus = 'Paid';
  /* ودعوتان: وحدة مرّ عليها ٨ أيام واشتراكها مدفوع، والثانية انسترجع اشتراكها (§٧) */
  const rfA = DB.referrals.find(x => x.invited_id === 'u-ref'), rfB = DB.referrals.find(x => x.invited_id === 'u-race');
  const d8 = new Date(Date.now() - 8 * 864e5).toISOString();
  rfA.created_at = d8; rfB.created_at = d8;
  sub(rfB.subscription_id).status = 'refunded';
  /* وثالثة: كتبنا رصيدها وانقطعنا قبل ما نحجز الدعوة — الدورة تربطه، ما تكتب ثانٍ */
  DB.profiles.push(prof('u-inv3'), prof('u-friend3', { telegram_chat_id: '7779' }));
  DB.subscriptions.push({ id: 991, user_id: 'u-inv3', status: 'paid', gateway: 'paylink', term: '203010',
    base_halalas: 1900, pushover_halalas: 0, discount_halalas: 300, credit_halalas: 0, amount_halalas: 1600 });
  DB.referrals.push({ id: 93, referrer_id: 'u-friend3', invited_id: 'u-inv3', subscription_id: 991,
    credit_id: null, created_at: d8 });
  DB.credit_ledger.push({ id: 991, user_id: 'u-friend3', amount_halalas: 500, reason: 'referral', ref: 'referral:93',
    expires_at: '2031-01-01T20:59:59+00:00', created_at: d8 });
  await wait(10100);                              /* جرس المعلّقات مرة كل ١٠ ثواني */
  await hook({});
  eq(sub(r.id).status, 'paid', '**مدفوعة فاتها الإشعار: تُسوّى لا تُلغى**');
  eq(ledger('u-friend').map(x => [x.amount_halalas, x.reason, x.ref]), [[500, 'referral', 'referral:' + rfA.id]],
     '**بعد ٧ أيام والاشتراك مدفوع: الداعي نزل له ٥** — مرة وحدة');
  eq(rfA.credit_id, ledger('u-friend')[0] && ledger('u-friend')[0].id, 'والدعوة مربوطة برصيدها — ما تنمنح ثانية');
  await wait(300);                                  /* رسالة تلقرام ما تُنتظر */
  ok(tgTo('7777', /<b>نزل لك 5 ريال رصيد<\/b>/).length === 1, 'ووصله «نزل لك ٥» مرة وحدة');
  eq([ledger('u-friend2').length, rfB.credit_id || null], [0, null],
     '**صديقه استرجع اشتراكه: ما ينزل للداعي شي**');
  eq([ledger('u-friend3').length, (DB.referrals.find(x => x.id === 93) || {}).credit_id], [1, 991],
     '**انقطع بين الكتابة والحجز: ربطنا رصيده ولا كتبنا ثانٍ**');

  /* ── ١١) اللوحة ── */
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq([ap.ready, ap.gateway, ap.openTo], [true, 'paylink', 'all'], 'اللوحة: جاهز · paylink · للكل');
  ok(ap.counts.paid >= 4 && ap.counts.failed >= 1, 'وعدّاداته — ' + JSON.stringify(ap.counts));
  ok(!JSON.stringify(ap).includes('live-secret'), '**وما فيها حرف من المفتاح السري**');
  const pg = (await call('POST', '/api/admin/pay-ping', { admin: true })).j;
  eq(pg.ok, true, 'زر «جرّب الاتصال» ينجح بالمفاتيح الصحيحة');

  /* ── ١٢) الإشعار يقول ليش رفض ──
     زر Test في Paylink رجّع لمحمد `{"ok":false}` وبس: الترويسة ما وصلت؟ المفتاح
     ما طابق؟ ما نعرف. الرد صار فيه رمز السبب (بلا أطوال ولا أسماء)، واللوحة
     فيها أسماء الترويسات والأطوال — **لا قيمة أبداً** */
  const hookLast = async () => ((await call('GET', '/api/admin/pay', { admin: true })).j || {}).hookLast || {};
  const post = headers => call('POST', '/api/paylink/webhook', { body: {}, headers });
  let h = await hook({}, '');
  eq([h.code, h.j && h.j.why], [401, 'no-header'], '**بلا ترويسة: الرد يقول السبب** — زر Test يعرضه كما هو');
  let L = await hookLast();
  eq([L.ok, L.why], [false, 'noheader'], 'واللوحة: ما وصلت الترويسة');
  ok((L.headers || []).includes('content-type'), 'ومعها أسماء الترويسات اللي وصلت — ' + JSON.stringify(L.headers));

  h = await hook({}, 'wrong-key');
  eq([h.code, h.j && h.j.why], [401, 'mismatch'], 'مفتاح غلط: السبب mismatch');
  L = await hookLast();
  eq([L.why, L.via, L.len, L.want], ['mismatch', 'x-jadwalik-key', 9, 19],
     '**واللوحة بالأطوال**: وصل ٩ حروف والمضبوط ١٩ — يعرف إن النسخ ناقص');
  eq(Object.keys(h.j || {}).sort(), ['ok', 'why'], 'والرد العام رمز السبب وبس — بلا أطوال ولا أسماء');

  h = await post({ 'hook-key-1234567890': 'X-Jadwalik-Key' });
  eq([h.code, h.j && h.j.why], [401, 'key-in-header-name'], '**المفتاح في خانة الاسم بدل القيمة: نقولها بالضبط**');
  L = await hookLast();
  eq(L.why, 'swapped', 'واللوحة كذلك');
  ok(!JSON.stringify(L).includes('hook-key-1234567890'), '**والمفتاح ما ينكتب في اللوحة ولو جا اسماً**');

  h = await post({ Authorization: 'Bearer paylink-own-token-xyz' });
  L = await hookLast();
  eq([h.code, L.why, L.via], [401, 'mismatch', 'authorization'],
     'Authorization بمفتاح غير مفتاحنا (مفتاح Paylink نفسه؟): اللوحة تسمّي الترويسة');

  h = await post({ 'X-Jadwalik_Key': 'hook-key-1234567890' });
  eq(h.code, 200, '**المفتاح وصل باسم ترويسة مكتوب غلط: مقبول** — السرّ المفتاح لا الاسم');
  L = await hookLast();
  eq([L.ok, L.via], [true, 'x-jadwalik_key'], 'واللوحة تقول باسم وش وصل');

  /* علامة اتجاه (U+200F) حول المفتاح — ببايتاتها UTF-8 كما يرسلها غيرنا */
  const rlm = Buffer.from('\u200f', 'utf8');
  eq(await rawHook(Buffer.concat([rlm, Buffer.from('hook-key-1234567890'), rlm])), 200,
     '**مفتاح لُصق بعلامات اتجاه مخفية (نسخ من رسالة عربية): مقبول**');
  L = await hookLast();
  eq([L.ok, L.hidden], [true, 2], 'واللوحة تقول: حرفان مخفيان تجاهلناهما');
  const okAt = L.at;
  await hook({}, '');
  L = await hookLast();
  eq([L.ok, L.okAt], [false, okAt], '**رفض بعد قبول ما يغطّي وقت آخر مقبول**');

  eq((await hook({}, 'hook-key-123456789')).code, 401, 'والمفتاح الناقص حرفاً مرفوض كما هو');
  eq((await hook({}, 'hook-key-1234567890x')).code, 401, 'والزائد حرفاً ظاهراً مرفوض');

  /* ── المفتاح في الرابط: زر Test في Paylink ما أرسل ولا ترويسة من عندنا — «آخر
     إشعار» على الإنتاج عرض ١٧ ترويسة كلها من Cloudflare وRender. والرابط يوصل دائماً ── */
  const hookUrl = qs => call('POST', '/api/paylink/webhook' + qs, { body: {} });
  h = await hookUrl('?key=hook-key-1234567890');
  eq(h.code, 200, '**المفتاح في رابط الإشعار (?key=): مقبول** — بلا أي ترويسة');
  L = await hookLast();
  eq([L.ok, L.via], [true, 'url'], 'واللوحة تقول: وصل في الرابط');
  ok(!JSON.stringify(L).includes('hook-key-1234567890'), '**والمفتاح ما ينكتب في اللوحة**');
  h = await hookUrl('?key=url-wrong-key-77');
  L = await hookLast();
  eq([h.code, h.j && h.j.why, L.why, L.via, L.len], [401, 'mismatch', 'mismatch', 'url', 16],
     'مفتاح غلط في الرابط: mismatch بطوله — يعرف إنه نسخ ناقص');
  eq((await hookUrl('?key=%E2%80%8Fhook-key-1234567890%E2%80%8E')).code, 200,
     'ولو لُصق بعلامات مخفية (مرمّزة في الرابط): مقبول');
  eq((await hookUrl('?k=hook-key-1234567890')).code, 401, 'باسم ثاني في الرابط: مرفوض — `key` وحده');
  eq((await hookUrl('?key=hook-key-123456789')).code, 401, 'والناقص حرفاً في الرابط مرفوض');

  const n0 = LOGS.length;
  for (let i = 0; i < 8; i++) await hook({}, 'wrong-key-' + i);
  const re = /^pay: إشعار مرفوض — المفتاح/;
  ok(LOGS.some(l => re.test(l)), '**السجل يقول ليش رفض** — ' + (LOGS.find(l => /إشعار/.test(l)) || 'ولا سطر'));
  ok(LOGS.slice(n0).filter(l => re.test(l)).length <= 1, '**ثمانية رفضات ورا بعض: سطر واحد بالدقيقة** لا ثمانية');
  /* صياغة السطر تغيّرت عمداً: صار يذكر الرابط (?key=) لأنه الطريقة اللي تشتغل مع Paylink */
  ok(LOGS.some(l => /^pay: إشعار مرفوض — ما وصل المفتاح \(لا \?key= في الرابط ولا ترويسة X-Jadwalik-Key\) · وصلت: .*content-type/.test(l)),
     'وسطر «ما وصل» فيه أسماء اللي وصل — ' + (LOGS.find(l => /ما وصل/.test(l)) || 'ولا سطر'));
  ok(!LOGS.some(l => /hook-key-1234567890|wrong-key|paylink-own-token|url-wrong-key/.test(l)),
     '**ولا قيمة ترويسة ولا مفتاح رابط في السجل أبداً**');
  ok(LOGS.some(l => /^pay: paylink .* الإشعار مضبوط \(19 حرف\)$/.test(l)),
     'وسطر الإقلاع فيه طول المفتاح — ' + (LOGS.find(l => /^pay: paylink/.test(l)) || ''));

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
  PL.inv[s13.gateway_ref].orderStatus = 'Paid';
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
}

async function devSuite() {
  await setWindow('2000-01-01', '2000-01-02');
  let q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'test'],
     '**dev ببطاقات تجريبية عامة: الطالب ما يدفع** — وإلا أخذ اشتراكاً حقيقياً ببطاقة تجريبية');
  eq((await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } })).code, 200,
     'في dev إطفاء الفترة المجانية ما يُحرس');
  q = (await call('GET', '/api/me/quote', { tok: tokOf('u-st') })).j;
  eq(q.pay && q.pay.open, false, 'ولو انطفت الفترة المجانية: dev لصاحب الموقع وحده');
  const r = (await call('POST', '/api/me/checkout', { tok: tokOf('u-own'), body: { phone: '+966 51 234 5678' } })).j;
  ok(r.ok, 'صاحب الموقع يجرّب — ' + JSON.stringify(r));
  const s = sub(r.id) || {};
  const a = (adds()[0] || {}).b || {};
  eq(s.gateway, 'paylink-test', '**بوابة التجربة باسمها** — خارج الإيرادات');
  eq(a.orderNumber, 'JDWT-' + r.id, 'ورقم طلبها غير الإنتاج');
  eq(a.clientMobile, '0512345678', '+966 بمسافات يتحوّل');
  eq(a.callBackUrl, `https://127.0.0.1:${PORT}/?pay=${r.id}`, 'والرجوع على عنوان التجربة نفسه');
  eq([...PL.hosts], ['restpilot.paylink.sa'], '**dev على restpilot لا الإنتاج**');
  /* صف إنتاج معلّق في نفس القاعدة: dev ما يلمسه */
  DB.subscriptions.push({ id: 9001, user_id: 'u-st', term: '203010', status: 'pending', gateway: 'paylink',
    gateway_ref: 'PROD-TX-1', amount_halalas: 1900, credit_halalas: 0, includes_term: true,
    valid_until: END_NOW, created_at: new Date(Date.now() - 30 * 3600e3).toISOString() });
  PL.inv[s.gateway_ref].orderStatus = 'Paid';
  await call('POST', '/api/paylink/webhook', { body: { orderNumber: 'JDWT-' + r.id },
    headers: { 'X-Jadwalik-Key': 'hook-key-1234567890' } });
  eq(sub(r.id).status, 'paid', 'إشعار برقم طلب التجربة: مدفوع');
  ok(tgTo('5555', new RegExp('إيصال JDWT-' + r.id + '</b> \\(تجربة\\)')).length === 1,
     'وإيصال التجربة مكتوب عليه «تجربة»');
  eq(P('u-own').paid_at, null, '**دفعة تجريبية ما تُحسب «دفع فعلي»** في إحصاء الإنتاج');
  /* دعوة إنتاج نضجت (٨ أيام واشتراكها مدفوع): dev ما يمنحها — القاعدة مشتركة */
  DB.profiles.push(prof('u-dinv'), prof('u-dref'));
  DB.subscriptions.push({ id: 9002, user_id: 'u-dinv', status: 'paid', gateway: 'paylink', term: '203010',
    base_halalas: 1900, pushover_halalas: 0, discount_halalas: 300, credit_halalas: 0, amount_halalas: 1600 });
  DB.referrals.push({ id: 94, referrer_id: 'u-dref', invited_id: 'u-dinv', subscription_id: 9002, credit_id: null,
    created_at: new Date(Date.now() - 8 * 864e5).toISOString() });
  await hook({ transactionNo: 'PROD-TX-1' });
  await hook({});
  eq(sub(9001).status, 'pending', '**صف الإنتاج المعلّق ما لمسه dev** — كل بيئة تنظّف صفوفها');
  eq(ledger('u-dref').length, 0, '**ورصيد دعوة الإنتاج ما يمنحه dev** — الإنتاج وحده يمنح');
}

async function nokeysSuite() {
  const q = (await call('GET', '/api/me/quote', { tok: tokOf('u-own') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'nokeys'], 'الإنتاج بلا مفاتيح: الدفع مقفل حتى لصاحب الموقع');
  const b = await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } });
  eq(b.code, 400, '**§١٠: ما تنطفي الفترة المجانية في الإنتاج قبل البوابة**');
  ok(/Paylink/.test(String(b.j && b.j.error)), 'والرسالة تقول ليش — ' + (b.j && b.j.error));
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq([ap.ready, ap.idSet, ap.openTo], [false, false, 'none'], 'اللوحة تقول المفاتيح ناقصة');
  const h = await hook({});
  eq([h.code, h.j && h.j.why], [401, 'no-key-configured'], '**بلا مفتاح إشعار في Render: الرد يقول كذا**');
  const L = ((await call('GET', '/api/admin/pay', { admin: true })).j || {}).hookLast || {};
  eq([L.why, L.want], ['nokey', 0], 'واللوحة كذلك');
  ok(LOGS.some(l => /PAYLINK_WEBHOOK_KEY ناقص في Render/.test(l)), 'والسجل يسمّي المتغيّر');
}

/* مفتاح الإشعار في Render لُصق بعلامات اتجاه مخفية: `trim` ما تشيلها، فكان
   السيرفر يقول «مضبوط» ويرفض كل إشعار صحيح */
async function hookenvSuite() {
  eq((await hook({})).code, 200, '**مفتاح Render فيه علامات مخفية: الإشعار الصحيح يُقبل**');
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j || {};
  eq([ap.hookSet, ap.hookLen, ap.hookHidden], [true, 19, 2], 'واللوحة: ١٩ حرف، وحرفان مخفيان تجاهلناهما');
  ok(LOGS.some(l => /الإشعار مضبوط \(19 حرف · تجاهلنا 2 حرف مخفي\)/.test(l)),
     'وسطر الإقلاع يقولها — ' + (LOGS.find(l => /^pay: paylink/.test(l)) || ''));
  eq((await hook({}, 'hook-key-123456789')).code, 401, 'والناقص حرفاً مرفوض');
}

async function testkeySuite() {
  const q = (await call('GET', '/api/me/quote', { tok: tokOf('u-own') })).j;
  eq(q.pay && [q.pay.open, q.pay.why], [false, 'nokeys'], '**الإنتاج يرفض مفتاح التجربة العام**');
  const pg = (await call('POST', '/api/admin/pay-ping', { admin: true })).j;
  ok(pg.ok === false && /الحقيقية/.test(pg.error || ''), 'وزر التجربة يقول حط مفاتيحك الحقيقية');
  eq(PL.auth, 0, 'وما حاولنا ندخل Paylink بمفتاح عام من الإنتاج');
  const ap = (await call('GET', '/api/admin/pay', { admin: true })).j;
  eq(ap.testIdInProd, true, 'واللوحة تسمّي السبب');
}

(async () => {
  await wait(400);
  try {
    await ({ prod: prodSuite, dev: devSuite, nokeys: nokeysSuite, testkey: testkeySuite,
             hookenv: hookenvSuite })[MODE]();
  } catch (e) { fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e)) }
  console.log = realLog;

  /* الأب يشغّل البقية كعمليات مستقلة ويجمع النتائج */
  if (MODE === 'prod') {
    for (const m of ['dev', 'nokeys', 'testkey', 'hookenv']) {
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
