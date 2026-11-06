/* تجربة التنبيه الطارئ من الطالب نفسه — اختبار سلوكي على السيرفر الحقيقي.
   طلب محمد (٦ نوفمبر ٢٠٢٦): «زر يوصله تجربة رسالة فقط انه مشبوك وتمام، واذا يبي يجرب التنبيه الي يرن
   وجوالك صامت يضغط زر ثاني». كانت التجربة من اللوحة وحدها (بإيميل الطالب)، والطالب ما يدري هل ربطه زبط
   لين تنفتح شعبة.

   يمسك:
   ١) «📨 رسالة تجربة» من الموقع: رسالة عادية لمفتاح صاحب الجلسة — لا لمعرّف يرسله المتصفح.
   ٢) «🚨 جرّب التنبيه الطارئ»: نفس قوة تنبيه فتح الشعبة (أولوية 2 · siren · كل 30 ثانية).
   ٣) الحارس نفسه: ما ربط ⇒ «ما ربطت» · بلا الإضافة في وضع addon ⇒ ما نرسل · مطفأ ⇒ ما نرسل · Pushover رفض ⇒ «fail».
   ٤) الحدود: دقيقة بين رسالة وثانية، وخمس بين تنبيه وثاني، وسقف باليوم.
   ٥) تلقرام: الزرّان تحت رسالة «انربط ✅» (بعد الرجوع من Pushover) وتحت رسالة الرخصة، والضغطة لصاحب
      المحادثة وحده — محادثة مو مربوطة ما ترسل لأحد.
   ٦) اللوحة: تجربته بنفسه تبان «جرّب التنبيه بنفسه» — لا «وصله تنبيه تجربة منك».

   node tests/test-pushover-selftest.js [server.js] */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

const DAY = 864e5;
const ago = d => new Date(Date.now() - d * DAY).toISOString();
const ahead = d => new Date(Date.now() + d * DAY).toISOString();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = n => ('u' + String(n).padStart(3, '0')).padEnd(30, 'Z');      /* ٣٠ حرف مثل مفاتيحهم */
const BAD_KEY = 'uBADKEY'.padEnd(30, 'Q');                                /* Pushover يرفضه */
const SUB = 'https://pushover.net/subscribe/Jadwalik-test';
const PO_TOKEN = 'aPoTokenForSelfTests0000000000X';

/* ═══ القاعدة المزيّفة — نفس سلوك PostgREST في test-pushover-link ═══ */
const DB = { profiles: [], subscriptions: [], pushover_licenses: [], paid_usage: [], app_events: [],
  app_state: [{ key: 'runtime', value: { toggles: { pushoverMode: 'addon' } } }] };
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
const TOK = {};
const tok = n => { const t = `tok-${n}-aaaaaaaaaaaaaaaaaaaa`; TOK[t] = uid(n); return 'Bearer ' + t };
function supabase(method, urlPath, body, prefer, auth) {
  if (urlPath.startsWith('/auth/v1/user')) {
    const t = String(auth || '').replace('Bearer ', '');
    return TOK[t] ? [200, { id: TOK[t] }] : [401, {}];
  }
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer);
  if (method === 'GET') {
    let r = filt(list, qs);
    const o = /(?:^|&)order=([^&]+)/.exec(qs);
    if (o) { const [col, dir] = o[1].split(',')[0].split('.'); r.sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[col], b[col])) }
    const off = /(?:^|&)offset=(\d+)/.exec(qs), lim = /(?:^|&)limit=(\d+)/.exec(qs);
    if (off) r = r.slice(Number(off[1]));
    r = r.slice(0, lim ? Number(lim[1]) : 1000);                 /* PostgREST يقصّ عند ١٠٠٠ */
    /* select= أعمدة بعينها: عمود ناقص يرجع بلا قيمة لا خطأ — نرجّع الصف كاملاً (يكفي هنا) */
    return [200, r.map(x => Object.assign({}, x))];
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
        if (list.some(y => y.user_id === x.user_id))
          return [409, { code: '23505', message: 'duplicate key value violates unique constraint "pushover_licenses_pkey"' }];
      }
      const made = rows.map(x => Object.assign({ kind: null, credits: null, request: null, error: null,
        created_at: new Date().toISOString(), done_at: null }, x));
      list.push(...made);
      return [201, rep ? made.map(x => Object.assign({}, x)) : []];
    }
    if (table === 'paid_usage') {                   /* قيود الجدول الحقيقي: الميزة من قائمة · detail رمز · المستخدم موجود */
      const FEATURES = ['monitor', 'monitor_course', 'schedule', 'slot', 'ai', 'alert', 'pushover', 'pushover_test'];
      for (const x of rows) {
        if (!FEATURES.includes(x.feature)) return [400, { code: '23514', message: 'violates check constraint "paid_usage_feature_check"' }];
        if (x.detail != null && !/^[a-z0-9_]{1,40}$/.test(x.detail)) return [400, { code: '23514', message: 'violates check constraint "paid_usage_detail_check"' }];
        if (!DB.profiles.some(u => u.id === x.user_id)) return [409, { code: '23503', message: 'violates foreign key constraint' }];
      }
      const made = rows.map(x => Object.assign({ id: list.length + 1, n: null, detail: null, at: new Date().toISOString() }, x));
      list.push(...made);
      return [201, rep ? made : []];
    }
    const made = rows.map(x => Object.assign({ id: list.length + 1 }, x));
    list.push(...made);
    return [201, rep ? made : []];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
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

/* Pushover المزيّف: الرسائل (بشكل نموذجهم) والرخص */
const PO = { credits: 3, assigns: [], msgs: [] };
function pushover(p, raw) {
  if (p.startsWith('/1/licenses.json')) return [200, { status: 1, credits: PO.credits, request: crypto.randomUUID() }];
  if (p === '/1/licenses/assign.json') {
    PO.assigns.push(raw);
    PO.credits--;
    return [200, { status: 1, credits: PO.credits, request: crypto.randomUUID() }];
  }
  if (p === '/1/messages.json') {
    const f = Object.fromEntries(new URLSearchParams(raw));
    if (f.user === BAD_KEY) return [400, { user: 'invalid', errors: ['user identifier is not a valid user, group, or subscribed user key'], status: 0, request: crypto.randomUUID() }];
    PO.msgs.push(f);
  }
  return [200, { status: 1, request: crypto.randomUUID() }];
}

/* تلقرام المزيّف */
const TG = [], EDITS = [], ACKS = [];
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
        res = [200, { ok: true, result: { message_id: 1 } }];
        if (/sendMessage$/.test(opts.path)) TG.push({ chat_id: String(b.chat_id), text: String(b.text || ''), markup: b.reply_markup || null });
        else if (/editMessageText$/.test(opts.path)) EDITS.push({ chat_id: String(b.chat_id), message_id: b.message_id, text: String(b.text || '') });
        else if (/answerCallbackQuery$/.test(opts.path)) ACKS.push({ id: String(b.callback_query_id), text: String(b.text || ''), alert: !!b.show_alert });
      } else if (host.endsWith('supabase.co'))
        res = supabase(opts.method, opts.path, raw, (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '',
          opts.headers && (opts.headers.Authorization || opts.headers.authorization));
      const [code, body] = res;
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const r = new Readable({ read() { this.push(text); this.push(null) } });
      r.statusCode = code; r.headers = {};
      setImmediate(() => cb(r));
    }
  };
  return req;
};

const PORT = 24600 + (process.pid % 100), ADMIN = 'admin-token-for-pushover-selftest';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: ADMIN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false',
  PUSHOVER_TOKEN: PO_TOKEN, PUSHOVER_USER: 'adminPushoverUserKey00000000000',
  PUSHOVER_SUBSCRIBE_URL: SUB
});
const LOGS = [];
const realLog = console.log;
console.log = (...a) => { LOGS.push(a.map(String).join(' ')) };
require(SRV);

function call(p, method, payload, headers) {
  return new Promise((resolve, reject) => {
    const data = payload == null ? null : typeof payload === 'string' ? payload : JSON.stringify(payload);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({}, data ? { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data) } : {}, headers || {}) }, res => {
      let o = ''; res.setEncoding('utf8'); res.on('data', c => o += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(o) } catch (e) {}
        resolve({ code: res.statusCode, j, o, loc: res.headers.location || '' }) });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const adminCall = (p, method, payload) => call(p, method, payload, { 'X-Admin-Token': ADMIN });
const test = (n, kind, extra) => call('/api/me/pushover-test', 'POST', Object.assign({ kind }, extra || {}), { Authorization: tok(n) });
let UPD = 9000;
async function press(chat, data) {
  const id = ++UPD;
  await call('/tg-webhook', 'POST', { update_id: id, callback_query: { id: 'cq' + id,
    from: { id: Number(chat), is_bot: false, first_name: 'x' }, data,
    message: { message_id: 77, chat: { id: Number(chat), type: 'private' }, date: 1, text: '🔔' } } });
  await wait(150);
  return ACKS.filter(a => a.id === 'cq' + id).pop() || null;
}
const tgTo = (chat, re) => TG.filter(m => m.chat_id === String(chat) && re.test(m.text));
const tokenOf = url => { try { return new URL(url).searchParams.get('t') || '' } catch (e) { return '' } };
const succOf = url => { try { return new URL(url).searchParams.get('success') || '' } catch (e) { return '' } };
const msgsTo = k => PO.msgs.filter(m => m.user === k);
const TEST_KB = [[{ text: '📨 رسالة تجربة', callback_data: 'pot:plain' }, { text: '🚨 جرّب التنبيه الطارئ', callback_data: 'pot:urgent' }]];

/* طالب: ملف + (اختياري) اشتراك مدفوع بالإضافة — paidDaysAgo أيام من الدفع */
let SUBN = 1;
function student(n, o) {
  o = Object.assign({ addon: true, key: null, chat: String(7000 + n), paidDaysAgo: 2 }, o || {});
  DB.profiles.push({ id: uid(n), email: `s${n}@example.com`, telegram_chat_id: o.chat, is_pro: false,
    pushover_key: o.key, pushover_until: o.addon ? ahead(200) : null, subscription_expires_at: ahead(200) });
  if (o.addon) DB.subscriptions.push({ id: SUBN++, user_id: uid(n), term: '202720', includes_term: true, pushover: true,
    status: 'paid', gateway: 'edfapay', amount_halalas: 3400, credit_halalas: 0,
    paid_at: ago(o.paidDaysAgo), valid_until: ahead(200), created_at: ago(o.paidDaysAgo) });
  tok(n);
  return uid(n);
}

(async () => {
  const U1 = student(1, { key: key(1) });                     /* اشترى الإضافة وربط — داخل مدة الاسترجاع */
  const U2 = student(2);                                      /* اشترى وما ربط */
  student(3, { addon: false, key: key(3) });                  /* ربط بلا الإضافة (وضع addon) */
  student(4, { key: key(4) });
  student(6, { key: BAD_KEY });                               /* مفتاح Pushover يرفضه */
  student(7, { key: key(7) });                                /* يجرّب من تلقرام */
  const U8 = student(8, { key: key(8) });                     /* تجربة اللوحة — للمقارنة */
  const U9 = student(9, { paidDaysAgo: 10 });                 /* بعد مدة الاسترجاع وما ربط: يربط ⇒ رخصة */
  student(10, { chat: null });                                /* بلا تلقرام: يربط بلا رسالة */
  const U11 = student(11, { addon: false });                  /* بلا الإضافة يربط: ما نقول «شغّال» */
  await wait(500);                                            /* استعادة الحالة: الوضع addon */
  const realNow = Date.now;
  let warp = 0;
  /* التجارب تنعدّ بيوم الرياض: قرب منتصف الليل نبدأ بعده، وإلا انقلب اليوم وسط الاختبار وتصفّر السقف */
  if (new Date(realNow() + 3 * 3600e3).getUTCHours() >= 23) warp = 2 * 3600e3;
  Date.now = () => realNow() + warp;

  /* ═══ ١) «📨 رسالة تجربة» من الموقع ═══ */
  eq((await call('/api/me/pushover-test', 'GET')).code, 405, 'pushover-test: POST وحده');
  eq((await call('/api/me/pushover-test', 'POST', { kind: 'plain' })).code, 401, 'وبلا جلسة: ٤٠١');
  let r = await test(1, 'plain');
  ok(r.code === 200 && r.j && r.j.ok === true && r.j.kind === 'plain', '**«📨 رسالة تجربة»: انرسلت** — ' + r.o.slice(0, 80));
  const m1 = msgsTo(key(1))[0] || {};
  ok(m1.priority === '0' && !m1.retry && /مربوط/.test(m1.title || '') && /رسالة تجربة/.test(m1.message || ''),
     '**رسالة عادية (أولوية 0) لمفتاحه هو: «مربوط وتمام»** — ' + JSON.stringify({ p: m1.priority, t: m1.title }));
  r = await test(1, 'plain');
  ok(r.j && r.j.ok === false && r.j.why === 'wait' && r.j.after > 0 && r.j.after <= 60 && msgsTo(key(1)).length === 1,
     '**ضغطها ثانية على طول: «جرّب بعد شوي» وما انرسلت ثانية** — ' + r.o);

  /* ═══ ٢) «🚨 جرّب التنبيه الطارئ»: نفس قوة تنبيه فتح الشعبة ═══ */
  r = await test(1, 'urgent');
  const u1 = msgsTo(key(1)).filter(m => m.priority === '2')[0] || {};
  ok(r.j && r.j.ok === true && r.j.kind === 'urgent', '**«🚨 جرّب التنبيه الطارئ»: انرسل** — ' + r.o.slice(0, 80));
  eq([u1.priority, u1.sound, u1.retry, u1.expire], ['2', 'siren', '30', '300'],
     '**أولوية 2 · صفارة · يعيد كل 30 ثانية** (مثل فتح الشعبة) ويوقف بعد ٥ دقائق');
  ok(/Acknowledge/.test(u1.message || '') && /Critical Alerts/.test(u1.message || ''),
     'ونصّه يقول «اضغط Acknowledge» و«فعّل Critical Alerts» لو ما صفّر وجواله صامت');
  r = await test(1, 'urgent');
  ok(r.j && r.j.why === 'wait' && r.j.after > 60 && r.j.after <= 300, 'وتنبيه ثاني قبل ٥ دقائق: «جرّب بعد شوي» — ما تتراكب الصفارات');

  /* الهوية من الجلسة — معرّف في الجسم ما يغيّر شي */
  r = await test(4, 'plain', { userId: U1, user_id: U1, user: key(1) });
  ok(r.j && r.j.ok === true && msgsTo(key(4)).length === 1 && msgsTo(key(1)).length === 2,
     '**معرّف طالب ثاني في الجسم: تجاهلناه — الرسالة لصاحب الجلسة**');

  /* ═══ ٣) الحارس نفسه ═══ */
  const before = PO.msgs.length;
  r = await test(2, 'plain');
  ok(r.j && r.j.ok === false && r.j.why === 'nokey', '**ما ربط التطبيق: «nokey» — ما نرسل لأحد**');
  r = await test(3, 'plain');
  ok(r.j && r.j.ok === false && r.j.why === 'addon', '**ربط بلا الإضافة (وضع addon): ما نقول «مربوط وتمام» لمن ما يوصله تنبيه**');
  r = await test(1, 'loud');
  ok(r.j && r.j.ok === false && r.j.why === 'kind', 'ونوع غير الاثنين: مرفوض');
  eq(PO.msgs.length, before, 'وولا رسالة انرسلت في الثلاث');
  r = await test(6, 'plain');
  ok(r.j && r.j.ok === false && r.j.why === 'fail', '**Pushover رفض مفتاحه: «fail»** (الصفحة تقول «فعّل من جديد»)');

  /* ═══ ٤) الحدود: بعد الدقيقة تنفتح، وسقف باليوم ═══ */
  warp += 61e3;
  r = await test(1, 'plain');
  ok(r.j && r.j.ok === true, 'بعد دقيقة: «رسالة تجربة» ثانية تنرسل');
  let last = r;
  for (let i = 0; i < 9; i++) { warp += 61e3; last = await test(1, 'plain') }
  ok(last.j && last.j.ok === false && last.j.why === 'day', '**وسقف باليوم: الحادية عشرة «خلصت تجارب اليوم»** — ' + last.o);
  warp += 5 * 60e3 + 1e3;
  r = await test(1, 'urgent');
  ok(r.j && r.j.ok === true, 'وبعد ٥ دقائق: التنبيه الطارئ ينرسل ثانية');

  /* الوضع: all ⇒ بلا الإضافة يقدر · off ⇒ ولا أحد */
  await adminCall('/api/admin/pushover-mode', 'POST', { mode: 'all' });
  r = await test(3, 'plain');
  ok(r.j && r.j.ok === true && msgsTo(key(3)).length === 1, 'وضع all: الربط يكفي (بلا الإضافة)');
  await adminCall('/api/admin/pushover-mode', 'POST', { mode: 'off' });
  warp += 61e3;
  r = await test(3, 'plain');
  ok(r.j && r.j.ok === false && r.j.why === 'off' && msgsTo(key(3)).length === 1, '**وضع off: «مو متاح» وما نرسل**');
  await adminCall('/api/admin/pushover-mode', 'POST', { mode: 'addon' });

  /* ═══ ٥) تلقرام: الزرّان لصاحب المحادثة وحده ═══ */
  let a = await press('7007', 'pot:plain');
  ok(a && a.alert && /أرسلنا رسالة تجربة/.test(a.text) && msgsTo(key(7)).length === 1 && msgsTo(key(7))[0].priority === '0',
     '**تلقرام «📨 رسالة تجربة»: انرسلت لمفتاحه، والرد نافذة «أرسلنا… وصلتك؟»** — ' + (a && a.text || '').slice(0, 50));
  a = await press('7007', 'pot:urgent');
  ok(a && /التنبيه الطارئ/.test(a.text) && msgsTo(key(7)).some(m => m.priority === '2' && m.sound === 'siren'),
     '**تلقرام «🚨 جرّب التنبيه الطارئ»: أولوية 2 بصفارة**');
  a = await press('7007', 'pot:urgent');
  ok(a && /جرّب بعد/.test(a.text) && msgsTo(key(7)).filter(m => m.priority === '2').length === 1, 'وثانية على طول: «جرّب بعد…»');
  const n0 = PO.msgs.length;
  a = await press('9999', 'pot:plain');
  ok(a && /ما لقيت حسابك/.test(a.text) && PO.msgs.length === n0, '**محادثة مو مربوطة بحساب: «ما لقيت حسابك» — ما نرسل لأحد**');
  a = await press('7002', 'pot:plain');
  ok(a && /ما ربطت/.test(a.text) && PO.msgs.length === n0, 'وما ربط التطبيق: «ما ربطت — من الموقع ⚙️ الإعدادات ← «تفعيل»»');
  ok(ACKS.every(x => x.text.length <= 200), 'وكل ردود الزرّين ≤ ٢٠٠ حرف (حد تلقرام للنافذة)');

  /* ═══ ٦) «انربط ✅» على تلقرام بعد الرجوع من Pushover — ومعها الزرّان ═══ */
  const link = async (n, extra) => {
    const s = await call('/api/me/pushover-start', 'POST', {}, { Authorization: tok(n) });
    const t = tokenOf(succOf((s.j || {}).url || ''));
    return call('/api/pushover-return?t=' + encodeURIComponent(t) + (extra || '&pushover_user_key=' + key(n)), 'GET');
  };
  r = await link(2);
  await wait(200);
  const lk = tgTo('7002', /انربط بحسابك/);
  ok(/\/\?pushover=on$/.test(r.loc) && lk.length === 1, '**ربط من صفحة Pushover: وصلته على تلقرام «🔔 التنبيه الطارئ انربط بحسابك ✅»** — ' + r.loc);
  eq(lk[0] && lk[0].markup && lk[0].markup.inline_keyboard, TEST_KB, '**ومعها الزرّان: «📨 رسالة تجربة» · «🚨 جرّب التنبيه الطارئ»**');
  ok(lk[0] && /لا تدفع — رخصته علينا/.test(lk[0].text), 'ومشتري الإضافة: «لو طلب منك دفعاً، لا تدفع — رخصته علينا»');
  a = await press('7002', 'pot:plain');
  ok(a && /أرسلنا رسالة تجربة/.test(a.text) && msgsTo(key(2)).length === 1, 'وضغط الزر بعدها: وصلته رسالة التجربة');
  await link(2);
  await wait(150);
  eq(tgTo('7002', /انربط بحسابك/).length, 1, 'وربط ثاني خلال ١٠ دقائق: ما نكرر الرسالة');
  await link(2, '&pushover_user_key=&pushover_unsubscribed=1');
  await wait(150);
  eq(tgTo('7002', /انربط بحسابك/).length, 1, 'وإلغاء الاشتراك: ما يوصله «انربط»');
  const tgBefore = TG.length;
  r = await link(10);
  await wait(150);
  ok(/\/\?pushover=on$/.test(r.loc) && DB.profiles.find(p => p.id === uid(10)).pushover_key === key(10) &&
     !TG.slice(tgBefore).some(m => /انربط بحسابك/.test(m.text)), 'وبلا تلقرام: الربط يمشي وما نرسل لأحد');
  r = await link(11);
  await wait(150);
  eq(tgTo('7011', /انربط بحسابك/).length, 0, '**وبلا الإضافة (وضع addon): ما نقول له «شغّال» — ما يوصله تنبيه حقيقي**');

  /* ═══ ٧) رسالة الرخصة: «جرّبه الحين» ومعها الزرّان ═══ */
  r = await link(9);
  await wait(400);
  ok(tgTo('5555', /طالب يستحق رخصة Pushover/).some(m => m.text.includes('s9@example.com')), 'ربط بعد مدة الاسترجاع: سؤال رخصته وصلك');
  await call('/tg-webhook', 'POST', { update_id: ++UPD, callback_query: { id: 'cq' + UPD,
    from: { id: 5555, is_bot: false, first_name: 'm' }, data: 'pol:ok:' + U9,
    message: { message_id: 66, chat: { id: 5555, type: 'private' }, date: 1, text: '🎟' } } });
  await wait(400);
  const lic = tgTo('7009', /انضافت رخصة Pushover لحسابك/);
  ok(lic.length === 1 && /لو طلب منك دفعاً، راسلنا هنا/.test(lic[0].text) && /جرّبه الحين/.test(lic[0].text),
     '**«✅ أضف الرخصة»: الطالب يوصله «انضافت رخصة… جرّبه الحين»**');
  eq(lic[0] && lic[0].markup && lic[0].markup.inline_keyboard, TEST_KB, '**ومعها الزرّان**');

  /* ═══ ٨) اللوحة: تجربته بنفسه غير تجربتك ═══ */
  const pu = DB.paid_usage.filter(x => x.user_id === U1 && x.feature === 'pushover_test');
  ok(pu.some(x => x.detail === 'self_plain'), '**تجربته بنفسه انسجّلت (يثبت إن ربطه اشتغل — الشروط §٤)** — ' + JSON.stringify(pu.map(x => x.detail)));
  await adminCall('/api/admin/push-test', 'POST', { email: 's8@example.com' });
  await wait(200);
  const pay = (await adminCall('/api/admin/pay', 'GET')).j || {};
  const used = id => ((((pay.recent || []).find(o => o.id === DB.subscriptions.find(s => s.user_id === id).id) || {}).usage || {}).used || []).map(x => x.kind);
  ok(used(U1).includes('pushover_self') && !used(U1).includes('pushover_test'),
     '**اللوحة: تجربته بنفسه «جرّب التنبيه بنفسه» — لا «وصله تنبيه تجربة منك»** — ' + JSON.stringify(used(U1)));
  ok(used(U8).includes('pushover_test') && !used(U8).includes('pushover_self'), 'وتجربتك من اللوحة تبقى «منك»');

  ok(!LOGS.some(l => [1, 2, 3, 4, 7, 8, 9, 10].some(n => l.includes(key(n)))), '**ولا مفتاح طالب في السجل**');

  Date.now = realNow;
  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + (e && e.stack || e)); process.exit(1) });
