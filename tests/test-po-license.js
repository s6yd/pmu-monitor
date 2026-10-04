/* رخص Pushover تنضاف تلقائياً — اختبار سلوكي على السيرفر الحقيقي.
   الرخصة علينا (قرار محمد §٧)، وكانت بيده: «لو طلب منك دفعاً، راسلنا ونتكفّل».
   طلبه «ابسط شي بدون تدخل مني»: الدورة تضيفها من رصيد الرخص بـ`licenses/assign.json`.
   شكل Pushover من توثيقهم (Licensing API) حرفاً بحرف:
     نجاح ٢٠٠ ‎{"status":1,"credits":5,"request":"…"}‎ ·
     فشل ‎{"status":0,"request":"…","errors":{"token":["is out of available license credits"]}}‎ ·
     الرصيد ‎GET /1/licenses.json?token=‎ بنفس الشكل.
   وتوصيتهم: «أي خطأ يُرفع، ولا إعادة تلقائية لين يتدخّل إنسان».

   أخطار يمسكها:
   ١) **رخصة لمن ما يستحق** (فلوس ما ترجع): داخل مدة الاسترجاع · ما ربط التطبيق ·
      استرجع · انتهت إضافته أو سُحبت · دفعة تجربة · صاحب الموقع.
   ٢) **رخصتان لطالب**: دورة ثانية · نسختان وقت النشر (الحجز قبل النداء).
   ٣) **إعادة تلقائية بعد فشل**: رفض أو رد ضايع يوقف الكل لين اللوحة — إلا خلص
      الرصيد: نكمل لحالنا أول ما يشتري.
   ٤) **الدورة نفسها تشغّلها** (payTick)، لا زر اللوحة وحده — وdev ما يصرف شي.
   ٥) **رمز التطبيق ومفتاح الطالب ما يطلعان** في اللوحة ولا في الخطأ المحفوظ.

   node tests/test-po-license.js [server.js]
   (يشغّل نفسه مرة ثانية كعملية مستقلة لـdev — المتغيّرات تُقرأ مرة عند الإقلاع) */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');
const { Readable } = require('stream');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=prod').slice(7);

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${MODE}] ` + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const DAY = 864e5;
const ago = d => new Date(Date.now() - d * DAY).toISOString();
const ahead = d => new Date(Date.now() + d * DAY).toISOString();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = n => ('k' + String(n).padStart(3, '0')).padEnd(30, 'Q');     /* ٣٠ حرف مثل مفاتيحهم */
const PO_TOKEN = 'aPoTokenForTests0000000000000X';
const HOOK_SECRET = 'hook-secret-for-po-license-tests';

/* ═══ القاعدة المزيّفة — تطابق PostgREST: الفلاتر، الترتيب، القصّ عند ١٠٠٠،
   Prefer في الترويسة، والمفتاح الأساسي يرجع 23505 والقيود 23514 والأجنبي 23503 ═══ */
const DB = { profiles: [], subscriptions: [], pushover_licenses: [], app_events: [],
  app_state: [{ key: MODE === 'dev' ? 'runtime-dev' : 'runtime', value: { toggles: { pushoverMode: 'addon' } } }] };
let NO_TABLE = false;
let AFTER_CAND = null;              /* يحاكي نسخة ثانية تحجز طالباً بعد ما قرينا المرشّحين */
const LIC_COLS = ['user_id', 'status', 'source', 'kind', 'credits', 'request', 'error', 'created_at', 'done_at'];

function cmp(a, b) {
  const x = Date.parse(a), y = Date.parse(b);
  if (Number.isFinite(x) && Number.isFinite(y) && /\d{4}-\d\d-\d\d/.test(String(a))) return x - y;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
function filt(rows, qs) {
  let r = rows.slice();
  for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=(eq|neq|lt|gt|gte|lte|in|is)\.([^&]*)/g)) {
    const [, col, op, v] = m;
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    r = r.filter(x => {
      const a = x[col];
      if (op === 'eq') return a != null && String(a) === v;
      if (op === 'neq') return a == null || String(a) !== v;
      if (op === 'is') return v === 'null' ? a == null : String(a) === v;
      if (op === 'in') return new Set(v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, ''))).has(String(a));
      if (a == null) return false;
      const c = cmp(a, v);
      return op === 'lt' ? c < 0 : op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : c <= 0;
    });
  }
  return r;
}
function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  if (table === 'pushover_licenses' && NO_TABLE)
    return [404, { code: 'PGRST205', message: "Could not find the table 'public.pushover_licenses' in the schema cache" }];
  const list = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer);
  if (method === 'GET') {
    let r = filt(list, qs);
    const o = /(?:^|&)order=([^&]+)/.exec(qs);
    if (o) {
      const [col, dir] = o[1].split(',')[0].split('.');
      if (table === 'pushover_licenses' && !LIC_COLS.includes(col))
        return [400, { code: '42703', message: `column pushover_licenses.${col} does not exist` }];
      r.sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[col], b[col]));
    }
    const off = /(?:^|&)offset=(\d+)/.exec(qs), lim = /(?:^|&)limit=(\d+)/.exec(qs);
    if (off) r = r.slice(Number(off[1]));
    r = r.slice(0, lim ? Number(lim[1]) : 1000);                 /* PostgREST يقصّ عند ١٠٠٠ */
    const ret = r.map(x => Object.assign({}, x));
    /* بعد ما قرينا المرشّحين وصفوف الرخص — قبل الحجز */
    if (table === 'profiles' && /id=in\./.test(qs) && AFTER_CAND) { const f = AFTER_CAND; AFTER_CAND = null; f() }
    return [200, ret];
  }
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
      return [201, []];
    }
    const rows = Array.isArray(b) ? b : [b];
    if (table === 'pushover_licenses') {
      for (const x of rows) {
        if (!DB.profiles.some(u => u.id === x.user_id)) return [409, { code: '23503', message: 'violates foreign key constraint' }];
        if (!['pending', 'assigned', 'failed', 'manual'].includes(x.status) || !['paid', 'comp'].includes(x.source))
          return [400, { code: '23514', message: 'violates check constraint' }];
        if (list.some(y => y.user_id === x.user_id))
          return [409, { code: '23505', message: 'duplicate key value violates unique constraint "pushover_licenses_pkey"' }];
      }
      const made = rows.map(x => Object.assign({ kind: null, credits: null, request: null, error: null,
        created_at: new Date().toISOString(), done_at: null }, x));
      list.push(...made);
      return [201, rep ? made.map(x => Object.assign({}, x)) : []];
    }
    const made = rows.map(x => Object.assign({ id: list.length + 1 }, x));
    list.push(...made);
    return [201, rep ? made : []];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    if (table === 'pushover_licenses') {
      if (b.kind != null && !['credits', 'rejected', 'unknown'].includes(b.kind))
        return [400, { code: '23514', message: 'violates check constraint "pushover_licenses_kind_check"' }];
      if (b.error != null && String(b.error).length > 300)
        return [400, { code: '23514', message: 'violates check constraint "pushover_licenses_error_check"' }];
      if (b.request != null && !/^[A-Za-z0-9-]{1,64}$/.test(b.request))
        return [400, { code: '23514', message: 'violates check constraint "pushover_licenses_request_check"' }];
    }
    const hit = filt(list, qs);
    hit.forEach(x => Object.assign(x, b));
    return [200, rep ? hit.map(x => Object.assign({}, x)) : []];
  }
  if (method === 'DELETE') {
    const hit = filt(list, qs);
    DB[table] = list.filter(x => !hit.includes(x));
    return [200, rep ? hit : []];
  }
  return [200, []];
}

/* ═══ Pushover المزيّف ═══ */
const PO = { mode: 'ok', credits: 4, assigns: [], creditReads: 0, n: 0 };
const reqId = () => crypto.randomUUID();
function pushover(p, raw) {
  if (p.startsWith('/1/licenses.json')) {
    PO.creditReads++;
    const tok = querystring.parse(p.split('?')[1] || '').token;
    if (tok !== PO_TOKEN) return [400, { status: 0, request: reqId(), errors: { token: ['is invalid'] } }];
    return [200, { status: 1, credits: PO.credits, request: reqId() }];
  }
  if (p === '/1/licenses/assign.json') {
    const f = querystring.parse(raw);
    PO.assigns.push(f);
    const m = PO.mode;
    if (m === 'net') return 'net';
    if (m === 'down') return [503, '<html>Service Unavailable</html>'];
    if (m === 'rejected') return [400, { status: 0, request: reqId(), errors: { user: ['is invalid'] } }];
    if (m === 'leak') return [400, { status: 0, request: reqId(),
      errors: { user: [`${f.user} is not a valid user for ${f.token}`] } }];
    if (PO.credits <= 0)
      return [400, { status: 0, request: reqId(), errors: { token: ['is out of available license credits'] } }];
    PO.credits--;
    return [200, { status: 1, credits: PO.credits, request: reqId() }];
  }
  return [200, { status: 1, request: reqId() }];                  /* رسالة إشعار */
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
    end() {
      const raw = chunks.join('');
      let res = [200, []];
      if (host === 'api.pushover.net') res = pushover(opts.path, raw);
      else if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(raw) } catch (e) {}
        if (/sendMessage$/.test(opts.path)) TG.push({ chat_id: String(b.chat_id), text: String(b.text || '') });
        res = [200, { ok: true, result: { message_id: 1 } }];
      } else if (host.endsWith('supabase.co'))
        res = supabase(opts.method, opts.path, raw, (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '');
      if (res === 'net') return setImmediate(() => req._err && req._err(new Error('socket hang up')));
      const [code, body] = res;
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const r = new Readable({ read() { this.push(text); this.push(null) } });
      r.statusCode = code; r.headers = {};
      setImmediate(() => cb(r));
    }
  };
  return req;
};

const BASES = { prod: 49100, dev: 49200 };
const PORT = BASES[MODE] + (process.pid % 100), ADMIN = 'admin-token-for-po-license';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: ADMIN, SITE_ENV: MODE, ACTIVE_TERM: '202710',
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false',
  PUSHOVER_TOKEN: PO_TOKEN, PUSHOVER_USER: 'adminPushoverUserKey00000000000',
  PUSHOVER_SUBSCRIBE_URL: 'https://pushover.net/subscribe/Jadwalik-test',
  EDFAPAY_WEBHOOK_SECRET: HOOK_SECRET
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(p, method, payload, headers) {
  return new Promise((resolve, reject) => {
    const data = payload == null ? null : typeof payload === 'string' ? payload : JSON.stringify(payload);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'X-Admin-Token': ADMIN }, data ? { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data) } : {}, headers || {}) }, res => {
      let o = ''; res.setEncoding('utf8'); res.on('data', c => o += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(o) } catch (e) {} resolve({ code: res.statusCode, j, o }) });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const retry = async userId => { const r = (await call('/api/admin/po-lic-retry', 'POST', userId ? { userId } : {})).j; await wait(80); return r };
const done = async userId => { const r = (await call('/api/admin/po-lic-done', 'POST', { userId })).j; await wait(80); return r };
const state = async () => (await call('/api/admin/po-lic?fresh=1', 'GET')).j;
const row = id => DB.pushover_licenses.find(x => x.user_id === id);
const assignedTo = () => PO.assigns.map(f => f.user);
const tgTo = (chat, re) => TG.filter(m => m.chat_id === String(chat) && re.test(m.text));
const admin = re => TG.filter(m => m.chat_id === '5555' && re.test(m.text));

/* طالب: ملف + اشتراك. paid = أيام من الدفع (null = هدية) */
let SUBN = 1;
function student(n, o) {
  o = Object.assign({ paidDaysAgo: 8, gift: false, key: true, until: ahead(200), status: null,
    gateway: 'edfapay', pushover: true, chat: String(900 + n), valid: ahead(200) }, o || {});
  DB.profiles.push({ id: uid(n), email: `s${n}@example.com`, telegram_chat_id: o.chat, is_pro: false,
    subscription_expires_at: ahead(200), pushover_key: o.key === true ? key(n) : o.key, pushover_until: o.until });
  DB.subscriptions.push({ id: SUBN++, user_id: uid(n), term: '202720', includes_term: true, pushover: o.pushover,
    status: o.status || (o.gift ? 'comp' : 'paid'), gateway: o.gift ? null : o.gateway,
    paid_at: o.gift ? null : ago(o.paidDaysAgo), valid_until: o.valid, created_at: ago(o.gift ? 0 : o.paidDaysAgo) });
  return uid(n);
}

async function prod() {
  /* ── ١) من يستحق ومن لا ── */
  const A = student(1);                                          /* دفع قبل ٨ أيام وربط ⇒ يستحق */
  const G = student(2, { gift: true });                          /* هدية اليوم وربط ⇒ فوراً */
  const W = student(3, { paidDaysAgo: 3 });                      /* داخل مدة الاسترجاع */
  const NK = student(4, { key: null });                          /* ما ربط التطبيق */
  const RF = student(5, { status: 'refunded' });                 /* استرجع */
  const EX = student(6, { paidDaysAgo: 200, until: ago(2), valid: ago(2) });   /* انتهت إضافته */
  const OW = student(7, { gift: true, chat: '5555' });           /* صاحب الموقع */
  const RV = student(8, { gift: true, until: ago(1) });          /* سُحبت من اللوحة (الصف باقٍ) */
  const TS = student(9, { gateway: 'edfapay-test' });            /* دفعة تجربة من dev */
  const NP = student(10, { pushover: false });                   /* اشترى الترم بلا الإضافة */
  const BK = student(11, { key: 'not a key@example.com' });      /* مفتاح مو مفتاح */
  student(12);                                                   /* أخذها من قبل */
  DB.pushover_licenses.push({ user_id: uid(12), status: 'assigned', source: 'paid', kind: null, credits: 9,
    request: reqId(), error: null, created_at: ago(30), done_at: ago(30) });
  await wait(400);                                               /* استعادة الحالة (الوضع addon) */

  /* الدورة نفسها (payTick) تشغّلها — جرس EdfaPay لطلب مو لنا يشغّل الدورة الحين */
  const raw = JSON.stringify({ orderId: 'ORDER-1', status: 'Approved', type: 'Purchase' });
  const sig = crypto.createHmac('sha256', HOOK_SECRET).update(raw).digest('hex');
  eq((await call('/api/edfapay/webhook', 'POST', raw, { 'Content-Type': 'text/plain', 'X-EdfaPay-Signature': sig })).code,
     200, 'جرس EdfaPay مقبول');
  await wait(400);
  eq(assignedTo().sort(), [key(1), key(2)].sort(),
     '**الدورة (payTick) أضافت الرخصة للمستحقين وحدهم**: بعد مدة الاسترجاع + الهدية — ' +
     'لا داخل المدة ولا بلا ربط ولا مسترجع ولا منتهٍ ولا صاحب الموقع ولا مسحوب ولا تجربة ولا بلا إضافة ولا مفتاح غلط ولا مرخّص');
  ok(PO.assigns.every(f => f.token === PO_TOKEN && !('os' in f) && !('email' in f)),
     'برمز التطبيق ومفتاح الطالب، وبلا os (توصيتهم: أول جهاز يسجّله) ولا إيميل (يعلق معلّقاً لو ما طابق)');
  eq([row(A).status, row(G).status, row(A).source, row(G).source], ['assigned', 'assigned', 'paid', 'comp'],
     'صفّان «انضافت» بمصدرهما');
  ok(/^[0-9a-f-]{36}$/.test(row(A).request) && Number.isFinite(row(A).credits), 'ومعها رقم طلبهم والرصيد بعدها');
  for (const s of [W, NK, RF, EX, OW, RV, TS, NP, BK]) ok(!row(s), 'ما انحجز صف لغير المستحق — ' + s.slice(-2));
  ok(tgTo(901, /انضافت رخصة Pushover لحسابك/).length === 1 && tgTo(902, /انضافت رخصة Pushover/).length === 1,
     'الطالب يوصله «انضافت رخصة Pushover لحسابك» مرة وحدة');
  ok(tgTo(901, /لو طلب منك دفعاً، راسلنا هنا/).length === 1, 'ومعها: لو طلب منك دفعاً راسلنا');
  ok(admin(/باقي 2 من رخص Pushover/).length === 1, '**قارب الرصيد يخلص (٢): نبّهناك** مرة وحدة');

  /* ── ٢) مرة للأبد · وبعد مدة الاسترجاع ── */
  await retry();
  eq(PO.assigns.length, 2, '**دورة ثانية ما تضيف رخصة ثانية لأحد**');
  DB.subscriptions.find(s => s.user_id === W).paid_at = ago(8);
  await retry();
  eq(assignedTo().slice(2), [key(3)], 'لما تخلص مدة استرجاعه: انضافت له');
  ok(admin(/باقي 1 من رخص Pushover/).length === 1, 'والرصيد ١: تنبيه ثاني بالرقم الجديد');

  /* ── ٣) خلص الرصيد: وقف · ونكمل لحالنا لما يشتري ── */
  PO.credits = 0;
  const C1 = student(21, { gift: true }), C2 = student(22, { gift: true });
  let n0 = PO.assigns.length;
  await retry();
  eq(PO.assigns.length - n0, 1, '**خلص الرصيد: طلب واحد وبس، وما كمّلنا للي بعده**');
  const cf = [C1, C2].map(row).find(Boolean);
  eq([cf && cf.status, cf && cf.kind], ['failed', 'credits'], 'وصفّه «فشل · خلص الرصيد»');
  ok(admin(/خلص رصيد رخص Pushover/).length === 1, 'ونبّهناك: اشترِ — ونكمل لحالنا');
  n0 = PO.assigns.length;
  const reads = PO.creditReads;
  await retry();
  eq(PO.assigns.length - n0, 0, '**والرصيد لسا صفر: ما أعدنا الطلب** — سألنا عن الرصيد بس');
  ok(PO.creditReads > reads, 'سؤال الرصيد (بلا أثر عندهم)');
  PO.credits = 5;
  await retry();
  ok(row(C1) && row(C1).status === 'assigned' && row(C2) && row(C2).status === 'assigned',
     '**اشترى رصيداً: كمّلنا للاثنين لحالنا**');
  ok(admin(/وصل رصيد رخص Pushover \(5\)/).length === 1, 'وقلنا لك إننا كمّلنا');
  PO.credits = 100;                                              /* رصيد يكفي باقي الاختبار */

  /* ── ٤) رفضوها: وقف كامل لين اللوحة ── */
  PO.mode = 'rejected';
  const R1 = student(31, { gift: true });
  await retry();
  eq([row(R1).status, row(R1).kind], ['failed', 'rejected'], 'رفضوها: «فشل · رفض»');
  ok(admin(/Pushover رفض إضافة رخصة/).length === 1 && admin(/user: is invalid/).length === 1,
     'ونبّهناك بسببهم نصاً');
  ok(admin(/Pushover رفض إضافة رخصة[\s\S]*اللوحة ← «النظام» ← «🎟 رخص Pushover»/).length === 1,
     'ووين تلقاها في اللوحة — تبويب «النظام» (اسمه الفعلي)');
  PO.mode = 'ok';
  const R2 = student(32, { gift: true });
  n0 = PO.assigns.length;
  await retry();
  eq(PO.assigns.length - n0, 0, '**بعد الرفض ما نكمل لأحد ولا نعيد** — توصية Pushover');
  eq((await state()).state, 'stopped', 'واللوحة تقول «موقوفة»');
  const dn = await done(R1);
  eq(row(R1).status, 'manual', '«✔️ تمّت»: صفّه «يدوي» — ما نرجع له');
  eq([row(R2) && row(R2).status, dn.state], ['assigned', 'on'], 'والباقين كمّلوا فوراً');

  /* ── ٥) رد ضايع: ما ندري انخصمت ولا لا ── */
  for (const m of ['down', 'net']) {
    PO.mode = m;
    const U = student(m === 'down' ? 41 : 42, { gift: true });
    await retry();
    eq([row(U).status, row(U).kind], ['failed', 'unknown'], `${m === 'down' ? '٥٠٣' : 'انقطاع'}: «ما ندري»`);
    PO.mode = 'ok';
    n0 = PO.assigns.length;
    student(m === 'down' ? 43 : 44, { gift: true });
    await retry();
    eq(PO.assigns.length - n0, 0, `${m === 'down' ? '٥٠٣' : 'انقطاع'}: **ما أعدنا ولا كمّلنا** لين تشوفه`);
    const rr = await retry(U);
    eq(row(U).status, 'assigned', '«🔁 أعد» عليه: انشال صفّه وانضافت');
    eq(rr.state, 'on', 'والدورة رجعت تشتغل');
  }
  ok(admin(/ما ندري انضافت رخصة ولا لا/).length === 2, 'ونبّهناك مرتين: «ما ندري» — شيك على الرصيد');

  /* ── ٦) حجز بلا نتيجة: نسخة ثانية في نصّ نداء · أو انقطعت ── */
  const P1 = student(51, { gift: true });
  DB.pushover_licenses.push({ user_id: P1, status: 'pending', source: 'comp', kind: null, credits: null,
    request: null, error: null, created_at: new Date().toISOString(), done_at: null });
  const P2 = student(52, { gift: true });
  n0 = PO.assigns.length;
  await retry();
  eq([PO.assigns.length - n0, row(P2)], [0, undefined], '**حجز حديث من نسخة ثانية: ننتظرها** — ما نبدأ غيره');
  row(P1).created_at = ago(11 / 1440);                           /* ١١ دقيقة */
  await retry();
  eq([row(P1).status, row(P1).kind, PO.assigns.length - n0], ['failed', 'unknown', 0],
     '**حجز عمره ١١ دقيقة بلا نتيجة: «ما ندري» ووقف** — ما نعيد');
  await done(P1);
  eq(row(P2) && row(P2).status, 'assigned', '«✔️ تمّت» عليه ⇒ الباقين كمّلوا');

  /* ── ٧) نسخة ثانية حجزت طالباً بعد ما قرينا المرشّحين: ما نطلب له ── */
  const S1 = student(61, { gift: true });
  AFTER_CAND = () => DB.pushover_licenses.push({ user_id: S1, status: 'assigned', source: 'comp', kind: null,
    credits: 1, request: reqId(), error: null, created_at: new Date().toISOString(), done_at: new Date().toISOString() });
  n0 = PO.assigns.length;
  await retry();
  eq(PO.assigns.length - n0, 0, '**المفتاح الأساسي يمنع رخصة ثانية** (23505 ⇒ نتخطّاه)');

  /* ── ٨) ضغطتان معاً ── */
  const D1 = student(71, { gift: true }), D2 = student(72, { gift: true });
  n0 = PO.assigns.length;
  await Promise.all([retry(), retry(), retry()]);
  await wait(200);
  eq(PO.assigns.slice(n0).map(f => f.user).sort(), [key(71), key(72)].sort(), 'ثلاث ضغطات معاً = رخصة لكل واحد');
  ok(row(D1).status === 'assigned' && row(D2).status === 'assigned', 'وصفّاهما «انضافت»');

  /* ── ٩) لا رمز التطبيق ولا مفتاح الطالب يطلعان ── */
  PO.mode = 'leak';
  const L1 = student(81, { gift: true });
  await retry();
  const st = await state();
  PO.mode = 'ok';
  eq([row(L1).status, row(L1).kind], ['failed', 'rejected'], 'خطأ فيه رمزنا ومفتاحه: «رفض»');
  ok(!row(L1).error.includes(PO_TOKEN) && !row(L1).error.includes(key(81)) && /not a valid user/.test(row(L1).error),
     '**الخطأ المحفوظ بلا رمز التطبيق ولا مفتاح الطالب** — ونصّهم باقٍ');
  const sj = JSON.stringify(st);
  ok(!sj.includes(PO_TOKEN) && !DB.profiles.some(p => p.pushover_key && sj.includes(p.pushover_key)),
     '**اللوحة ما فيها رمز التطبيق ولا أي مفتاح**');
  ok(!admin(/./).some(m => m.text.includes(PO_TOKEN) || m.text.includes(key(81))), 'ولا رسائلك');
  await done(L1);

  /* ── ١٠) اللوحة ── */
  const s2 = await state();
  eq([s2.ok, s2.live, s2.table, s2.state, s2.credits, s2.refundDays], [true, true, 'ok', 'on', PO.credits, 7],
     'اللوحة: الإنتاج · الجدول موجود · شغّالة · الرصيد من Pushover · مدة الاسترجاع');
  ok(Array.isArray(s2.rows) && s2.rows.some(x => x.email === 's1@example.com' && x.status === 'assigned'),
     'والصفوف بإيميل الطالب');
  eq(s2.waiting, 0, 'وما فيه أحد ينتظر');
  const nr = (await call('/api/admin/po-lic-retry', 'POST', { userId: 'abc' })).j;
  ok(nr && nr.ok === false, 'معرّف غلط مرفوض');
  ok((await call('/api/admin/po-lic', 'GET', null, { 'X-Admin-Token': 'wrong' })).code === 401, 'وبلا رمز اللوحة ٤٠١');

  /* ── ١١) الجدول ناقص (الـSQL ما انشغّل) · الوضع off: ما نصرف شي ── */
  NO_TABLE = true;
  student(91, { gift: true });
  n0 = PO.assigns.length;
  await retry();
  eq(PO.assigns.length - n0, 0, '**الجدول ناقص: ما نطلب رخصة** (بلا حجز = بلا ضمان مرة وحدة)');
  eq((await state()).table, 'missing', 'واللوحة تقول «شغّل الـSQL»');
  NO_TABLE = false;
  await call('/api/admin/pushover-mode', 'POST', { mode: 'off' });
  await retry();
  eq(PO.assigns.length - n0, 0, 'وضع Pushover «off»: ما نطلب');
  eq((await state()).state, 'off', 'واللوحة تقولها');
  await call('/api/admin/pushover-mode', 'POST', { mode: 'addon' });
  await retry();
  eq(row(uid(91)) && row(uid(91)).status, 'assigned', 'رجع «addon»: انضافت');
}

async function dev() {
  student(1);
  student(2, { gift: true });
  await wait(400);
  const raw = JSON.stringify({ orderId: 'ORDER-1', status: 'Approved', type: 'Purchase' });
  const sig = crypto.createHmac('sha256', HOOK_SECRET).update(raw).digest('hex');
  await call('/api/edfapay/webhook', 'POST', raw, { 'Content-Type': 'text/plain', 'X-EdfaPay-Signature': sig });
  await wait(400);
  const r = await retry();
  eq([PO.assigns.length, DB.pushover_licenses.length], [0, 0], '**dev ما يطلب رخصة ولا يحجز صفاً** — القاعدة مشتركة والرخص فلوس');
  ok(r && r.ok === false && /الإنتاج/.test(r.error), '«أعد» في dev: «من الإنتاج وحده»');
  eq((await state()).state, 'dev', 'واللوحة تقول «dev»');
}

(async () => {
  let child = null;
  if (MODE === 'prod') {
    child = new Promise(resolve => {
      const c = fork(__filename, [SRV, '--mode=dev'], { silent: true });
      let o = '';
      c.stdout.on('data', d => o += d);
      c.on('exit', () => resolve(o));
    });
  }
  try {
    await wait(300);
    if (MODE === 'prod') await prod(); else await dev();
  } catch (e) {
    fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e));
  }
  if (child) {
    const o = await child;
    const m = /(\d+) نجحت · (\d+) فشلت/.exec(o);
    if (m) { pass += +m[1]; fail += +m[2] } else { fail++; out.push('  ✗ [dev] ما رجع نتيجة') }
    for (const l of o.split('\n')) if (/✗/.test(l)) out.push(l);
  }
  console.log = realLog;
  if (out.length) console.log(out.join('\n'));
  console.log(`رخص Pushover: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
