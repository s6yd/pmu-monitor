/* سجل استخدام الميزات المدفوعة (الشروط §٤ — الاسترجاع) — اختبار سلوكي على السيرفر الحقيقي.
   «الاسترجاع خلال ٧ أيام بشرط ما تكون استخدمت أي ميزة مدفوعة» — وقبل السجل كنا نعرف
   الموجود الحين بس: طالب يستعمل ثم يحذف ما يبقى له أثر، والتنبيه الطارئ ما ينسجّل أبداً.
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور Supabase (بقيود الجدول الحقيقية:
   الميزة من قائمة · التفصيل بلا نص حر · المستخدم موجود) والجامعة وتلقرام وPushover.
   (المراقبة والجداول يسجّلها مشغّل في القاعدة — جرّبناه في Postgres حقيقي قبل وبعد؛
    وأدوات المساعد الشخصية في test-ai-tools.)

   أخطار يمسكها:
   ١) إشعار من مراقبة فوق حصة المجاني وصل، أو تنبيه طارئ وصل — وما انسجّل.
   ٢) نسجّل لمن ما يقدر يطلب استرجاعاً (دفع قبل أسبوعين · مجرّب ما دفع · مجاني) —
      بيانات بلا غرض. والمجاني ما نسأل القاعدة عنه أصلاً.
   ٣) سيل صفوف: مرة كل ١٠ دقائق لكل ميزة — **ودفعة جديدة تفتحها فوراً** (تجديد بعد
      استخدام بدقائق كان يخفي أول استخدام بعد الدفع الجديد).
   ٤) اللوحة تقول «ما استخدم» والسجل ما يشتغل (الـSQL ما انشغّل) — كذبة تكلّف فلوس.
   ٥) مراقبة ٢ من ٢ تنحسب استخدام مدفوع · استخدام قبل الدفع ينحسب بعده · ميزة الترم
      تنحسب على طلب التنبيه الطارئ وحده (أو العكس) · تنبيه التجربة من اللوحة يختلط
      باستخدام الطالب.

   node tests/test-paid-usage.js [server.js] */
const path = require('path');
const http = require('http');
const querystring = require('querystring');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const out = [];

/* معرّفات بشكل الإنتاج (UUID) — السجل يرفض غيرها */
const U = {
  pay:   '11111111-1111-4111-8111-111111111111',   /* دفع أمس — ترم + تنبيه طارئ */
  old:   '22222222-2222-4222-8222-222222222222',   /* دفع قبل ١٠ أيام */
  trial: '33333333-3333-4333-8333-333333333333',   /* اشتراك فعّال بلا دفع (مجرّب) */
  free:  '44444444-4444-4444-8444-444444444444',   /* مجاني */
  po:    '55555555-5555-4555-8555-555555555555',   /* اشترى التنبيه الطارئ وحده */
};
const H = 3600e3, D = 24 * H;
const iso = ms => new Date(ms).toISOString();
const NOW = Date.now();
const later = iso(NOW + 60 * D);
const PAID1 = iso(NOW - D), PAIDOLD = iso(NOW - 10 * D), PAIDPO = iso(NOW - 2 * D);
const TOK_PAY = 'tok-pay-uuuuuuuuuuuuuuuuuuuuuuuuuuuu';

const prof = (id, x) => Object.assign({ id, email: id.slice(0, 4) + '@x.com', is_pro: false,
  subscription_expires_at: null, pushover_until: null, pushover_key: null, paid_at: null,
  telegram_chat_id: null, invite_code: null, phone: null }, x);
const DB = {
  profiles: [
    prof(U.pay,   { email: 'pay@x.com', telegram_chat_id: '901', subscription_expires_at: later,
                    pushover_until: later, pushover_key: 'po-key-pay', paid_at: PAID1 }),
    prof(U.old,   { telegram_chat_id: '902', subscription_expires_at: later, pushover_until: later,
                    pushover_key: 'po-key-old', paid_at: PAIDOLD }),
    prof(U.trial, { telegram_chat_id: '903', subscription_expires_at: later }),
    prof(U.free,  { telegram_chat_id: '904' }),
    prof(U.po,    { telegram_chat_id: '905', pushover_until: later, pushover_key: 'po-key-po', paid_at: PAIDPO }),
  ],
  subscriptions: [
    { id: 101, user_id: U.pay, term: '203010', status: 'paid', includes_term: true, pushover: true,
      base_halalas: 1900, pushover_halalas: 1500, discount_halalas: 0, credit_halalas: 0, amount_halalas: 3400,
      gateway: 'edfapay', gateway_ref: 'tx-1', created_at: iso(NOW - D - 60e3), paid_at: PAID1, valid_until: later },
    { id: 102, user_id: U.old, term: '203010', status: 'paid', includes_term: true, pushover: false,
      base_halalas: 1900, pushover_halalas: 0, discount_halalas: 0, credit_halalas: 0, amount_halalas: 1900,
      gateway: 'edfapay', gateway_ref: 'tx-2', created_at: iso(NOW - 10 * D - 60e3), paid_at: PAIDOLD, valid_until: later },
    { id: 103, user_id: U.po, term: '203010', status: 'paid', includes_term: false, pushover: true,
      base_halalas: 0, pushover_halalas: 1500, discount_halalas: 0, credit_halalas: 0, amount_halalas: 1500,
      gateway: 'edfapay', gateway_ref: 'tx-3', created_at: iso(NOW - 2 * D - 60e3), paid_at: PAIDPO, valid_until: later },
    /* معلّق لـ«المجرّب» — المعلّق ما يفتح السجل */
    { id: 104, user_id: U.trial, term: '203010', status: 'pending', includes_term: true, pushover: false,
      base_halalas: 1900, pushover_halalas: 0, discount_halalas: 0, credit_halalas: 0, amount_halalas: 1900,
      gateway: 'edfapay', created_at: iso(NOW - 5 * 60e3), paid_at: null },
  ],
  monitored_courses: [], paid_usage: [], credit_ledger: [], referrals: [], app_events: [],
  app_state: [{ key: 'runtime', value: { toggles: { pushoverMode: 'addon' } } }],
};
const AUTH_USERS = new Set(Object.values(U));
let NEXT = 1000;
let MISSING = false;                      /* جدول السجل ما انخلق (الـSQL ما انشغّل) */
const GATE = [];                          /* من سألنا عنه «دفع خلال ٨ أيام؟» */
const REJECTED = [];                      /* إدراج رفضته قيود الجدول */
const PO = [];

/* ═══ PostgREST المزيّف — بسلوك الحقيقي ═══ */
function cmp(v, op, val) {
  const s = v == null ? null : String(v);
  if (op === 'eq') return s === val;
  if (op === 'neq') return s !== val;
  if (op === 'is') return val === 'null' ? v == null : String(v) === val;
  if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')).includes(s);
  if (v == null) return false;
  const a = Date.parse(s), b = Date.parse(val);
  const [x, y] = (!isNaN(a) && !isNaN(b) && /\d{4}-\d\d-\d\d/.test(val)) ? [a, b] : [Number(s), Number(val)];
  if (op === 'lt') return x < y;
  if (op === 'gt') return x > y;
  if (op === 'lte') return x <= y;
  if (op === 'gte') return x >= y;
  return true;
}
const COLS = { paid_usage: ['id', 'user_id', 'feature', 'n', 'detail', 'at'] };
function filt(table, rows, qs) {
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
    /* PostgREST يرفض الترتيب بعمود غير موجود */
    if (COLS[table] && !COLS[table].includes(col)) return { err: [400, { code: '42703', message: `column ${table}.${col} does not exist` }] };
    r.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  const off = Number(P.get('offset') || 0);
  /* بلا limit صريح: يقصّ عند ١٠٠٠ */
  return { rows: r.slice(off, off + (P.get('limit') ? Number(P.get('limit')) : 1000)) };
}
const FEATURES = ['monitor', 'monitor_course', 'schedule', 'slot', 'alert', 'ai', 'pushover', 'pushover_test'];
function supabase(method, urlPath, body, prefer) {
  const [p, qs = ''] = urlPath.split('?');
  const table = p.replace('/rest/v1/', '');
  if (table === 'paid_usage' && MISSING)
    return [404, { code: 'PGRST205', details: null, hint: null,
      message: "Could not find the table 'public.paid_usage' in the schema cache" }];
  const L = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer || '');
  if (method === 'GET') {
    if (table === 'subscriptions' && /status=eq\.paid/.test(qs) && /paid_at=gt\./.test(qs)) {
      const m = /user_id=eq\.([^&]+)/.exec(qs);
      if (m) GATE.push(decodeURIComponent(m[1]));
    }
    const f = filt(table, L, qs);
    return f.err || [200, f.rows];
  }
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = L.findIndex(x => x.key === b.key);
      if (i >= 0) L[i] = b; else L.push(b);
      return [201, []];
    }
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign({ id: ++NEXT,
      [table === 'paid_usage' ? 'at' : 'created_at']: new Date().toISOString() }, x));
    if (table === 'paid_usage') {
      for (const r of rows) {
        /* قيود الجدول الحقيقي: الميزة من القائمة · التفصيل بلا نص حر · المستخدم موجود */
        if (!FEATURES.includes(r.feature) || (r.detail != null && !/^[a-z0-9_]{1,40}$/.test(r.detail))) {
          REJECTED.push(r); return [400, { code: '23514', message: 'new row violates check constraint' }];
        }
        if (!AUTH_USERS.has(r.user_id)) {
          REJECTED.push(r); return [409, { code: '23503', message: 'violates foreign key constraint' }];
        }
      }
    }
    L.push(...rows);
    return [201, rep ? rows.map(r => Object.assign({}, r)) : []];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const f = filt(table, L, qs);
    if (f.err) return f.err;
    f.rows.forEach(r => Object.assign(r, b));
    return [200, rep ? f.rows.map(r => Object.assign({}, r)) : []];
  }
  if (method === 'DELETE') {
    const f = filt(table, L, qs);
    if (f.err) return f.err;
    for (const r of f.rows) L.splice(L.indexOf(r), 1);
    return [rep ? 200 : 204, rep ? f.rows : []];
  }
  return [200, []];
}

/* شعب الجامعة بصيغتها الحقيقية: ثلاث خانات للشعبة (1xx طلاب · 2xx طالبات) والوقت بلا نقطتين */
let TERM = '';
const SECTIONS = { M1: ['30011', '30012', '30013', '30021', '30022', '30023', '30031', '30032', '30033', '30041'],
                   F1: ['30051'] };
function pmuRows(g) {
  return '<table><tbody>' + (SECTIONS[g] || []).map((crn, i) => '<tr>' + [crn, 'MEEN 3311',
    'Thermodynamics I', (g === 'F1' ? '20' : '10') + (i % 9 + 1), 'UT', '1000 - 1115', 'Ahmad Salem',
    (g === 'F1' ? 'F' : 'M') + '-CORE - G034', 'OPEN'].map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}

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
      let code = 200, o = [], raw = null, headers = {};
      const body = chunks.join('');
      if (opts.path && opts.path.startsWith('/auth/v1/user')) {
        const t = String((opts.headers && opts.headers.Authorization) || '').replace('Bearer ', '');
        if (t === TOK_PAY) o = { id: U.pay, email: 'pay@x.com', user_metadata: { name: 'Pay' } };
        else { code = 401; o = { msg: 'invalid JWT' } }
      } else if (host.includes('pmu.edu.sa')) {
        headers = { 'set-cookie': ['a=b'] };
        if (opts.path !== '/Home/getData') raw = '<input name="__RequestVerificationToken" value="t">';
        else raw = pmuRows((/GenderList=([^&]*)/.exec(body) || [])[1]);
      } else if (host === 'api.pushover.net') {
        let f; try { f = JSON.parse(body) } catch (e) { f = querystring.parse(body) }
        PO.push(f); o = { status: 1, request: 'r' };
      } else if (host === 'api.telegram.org') {
        o = { ok: true, result: { message_id: 1 } };
      } else {
        [code, o] = supabase(opts.method, opts.path, body,
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '');
      }
      const txt = raw != null ? raw : JSON.stringify(o);
      const res = new Readable({ read() { this.push(txt); this.push(null) } });
      res.statusCode = code; res.headers = headers;
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 49000 + (process.pid % 100);
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests', ADMIN_CHAT_ID: '5555', SITE_ENV: 'prod',
  ACTIVE_TERM: '203010', FREE_BETA: 'false', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', TELEGRAM_TOKEN: 'tg',
  EDFAPAY_API_KEY: '', EDFAPAY_WEBHOOK_SECRET: '',
  PUSHOVER_TOKEN: 'po-token', PUSHOVER_USER: 'po-admin',
  PUSHOVER_SUBSCRIBE_URL: 'https://pushover.net/subscribe/Jadwalik-test'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(method, p, { tok, body, admin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = {};
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
const rows = (uid, f) => DB.paid_usage.filter(x => x.user_id === uid && (!f || x.feature === f));
const gateOf = uid => GATE.filter(x => x === uid).length;
/* ثلاث مراقبات شعبة لكل واحد (الثالثة فوق حصة المجاني ٢) — والمجاني واحدة */
function seedMonitors() {
  DB.monitored_courses = [];
  const add = (uid, crns) => crns.forEach((crn, i) => DB.monitored_courses.push({ id: ++NEXT, user_id: uid,
    crn, course_code: 'MEEN 3311', section: '10' + (i + 1), term: TERM, scope: 'section', last_status: 'CLOSED',
    followup_done: true, created_at: iso(NOW - 30 * D + i * 60e3) }));
  add(U.pay, ['30011', '30012', '30013']);
  add(U.old, ['30021', '30022', '30023']);
  add(U.trial, ['30031', '30032', '30033']);
  add(U.free, ['30041']);
}
/* الدورة تنتهي بتعليم المُشعَرين — ننتظرها بدل وقت ثابت */
async function cycle() {
  DB.monitored_courses.forEach(m => { m.last_status = 'CLOSED'; m.notified_at = null });
  PO.length = 0;
  await call('GET', '/api/run-check');
  for (let i = 0; i < 80; i++) {
    await wait(250);
    if (DB.monitored_courses.every(m => m.notified_at)) break;
  }
  await wait(600);                          /* التسجيل بعد الإرسال وبلا انتظار */
}
const adminPay = async () => (await call('GET', '/api/admin/pay', { admin: true })).j;
const recentOf = (d, id) => (d.recent || []).find(x => x.id === id) || {};

(async () => {
  await wait(500);
  TERM = ((await call('GET', '/api/monitor-status')).j || {}).regTerm || '203010';
  seedMonitors();

  /* ═══ ١) اللوحة قبل أي استخدام ═══ */
  let d = await adminPay();
  eq(d.usageLog, 'ok', 'السجل يُقرأ');
  const r1 = recentOf(d, 101);
  ok(r1.usage && Array.isArray(r1.usage.used) && r1.usage.used.length === 0,
     '**طلب مدفوع بلا استخدام: «ما انسجّل شي»** — ' + JSON.stringify(r1.usage));
  ok(r1.usage && Math.abs(Date.parse(r1.usage.until) - (Date.parse(PAID1) + 7 * D)) < 1000,
     'ومدة الاسترجاع: ٧ أيام من الدفع (الشروط §٤) — ' + (r1.usage && r1.usage.until));
  ok(Date.parse((recentOf(d, 102).usage || {}).until) < Date.now(), 'وطلب قبل ١٠ أيام: مدته خلصت');
  eq(recentOf(d, 104).usage, null, 'والمعلّق بلا سطر استخدام');

  /* ═══ ٢) الدورة: إشعار فوق حصة المجاني · تنبيه طارئ وصل ═══ */
  await cycle();
  const nTg = DB.monitored_courses.filter(m => m.notified_at).length;
  ok(nTg >= 10, 'الدورة أرسلت إشعاراتها — ' + nTg);
  eq(rows(U.pay, 'alert').map(x => x.detail), ['section'],
     '**إشعار من المراقبة الثالثة (فوق الحصة) انسجّل** — مرة وحدة');
  eq(rows(U.pay, 'pushover').length, 1, '**والتنبيه الطارئ اللي وصل مفتاحه انسجّل** — مرة وحدة');
  ok(PO.some(f => f.user === 'po-key-pay'), 'والتنبيه وصل فعلاً لمفتاحه');
  eq(rows(U.old).length, 0, '**دفع قبل ١٠ أيام: ما نسجّل** — مدة الاسترجاع خلصت');
  eq(rows(U.trial).length, 0, '**اشتراك فعّال بلا دفع: ما نسجّل** — ما يقدر يطلب استرجاع');
  eq(rows(U.free).length, 0, 'والمجاني ما ينسجّل');
  eq(gateOf(U.free), 0, '**والمجاني ما نسأل القاعدة عنه أصلاً** — الفترة المجانية ما هي استخدام مدفوع');
  eq(REJECTED, [], 'ولا صف رفضته قيود الجدول (الميزة · التفصيل · المستخدم)');
  /* «دفع خلال ٨ أيام؟» مرة لكل ميزة: الدافع والقديم (إشعار + تنبيه) · المجرّب (إشعار؛ بلا إضافة) */
  const gatePay = gateOf(U.pay);
  eq([gatePay, gateOf(U.old), gateOf(U.trial)], [2, 2, 1],
     'سؤال القاعدة مرة لكل ميزة — ثلاث إشعارات وثلاث تنبيهات ما تصير ستة أسئلة');

  /* ═══ ٢ب) الفترة المجانية: كل الشعب للكل والتنبيه لكل من ربط مفتاحه — مو استخدام مدفوع ═══
     المجاني بثلاث مراقبات ومفتاح Pushover، والوضع «link» (الإنتاج الحين): يوصله كل شي.
     ولا نسأل القاعدة عنه حتى — وإلا كل طالب في الفترة المجانية سؤال لكل إشعار */
  await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: true } });
  await call('POST', '/api/admin/pushover-mode', { admin: true, body: { mode: 'link' } });
  const fp = DB.profiles.find(x => x.id === U.free);
  fp.pushover_key = 'po-key-free';
  DB.monitored_courses = DB.monitored_courses.filter(m => m.user_id !== U.free);
  ['30041', '30042', '30043'].forEach((crn, i) => DB.monitored_courses.push({ id: ++NEXT, user_id: U.free,
    crn, course_code: 'MEEN 3311', section: '10' + (i + 1), term: TERM, scope: 'section',
    last_status: 'CLOSED', followup_done: true, created_at: iso(NOW - 30 * D + i * 60e3) }));
  SECTIONS.M1.push('30042', '30043');
  await cycle();
  ok(PO.some(f => f.user === 'po-key-free'), 'الفترة المجانية: التنبيه الطارئ وصل المجاني (وضع link)');
  eq([rows(U.free).length, gateOf(U.free)], [0, 0],
     '**الفترة المجانية: ما ينسجّل ولا نسأل القاعدة** — إشعار فوق الحصة وتنبيه طارئ وصلوه ببلاش');
  await call('POST', '/api/admin/beta-toggle', { admin: true, body: { on: false } });
  await call('POST', '/api/admin/pushover-mode', { admin: true, body: { mode: 'addon' } });
  fp.pushover_key = null;
  DB.monitored_courses = DB.monitored_courses.filter(m => m.user_id !== U.free || m.crn === '30041');
  SECTIONS.M1.splice(SECTIONS.M1.indexOf('30042'), 2);

  /* ═══ ٣) دورة ثانية خلال ١٠ دقائق: ما يتكرر ═══ */
  await cycle();
  eq([rows(U.pay, 'alert').length, rows(U.pay, 'pushover').length], [1, 1],
     '**دورة ثانية خلال ١٠ دقائق: ولا صف زيادة**');
  eq(gateOf(U.pay), gatePay, 'ولا سؤال زيادة للقاعدة');

  /* ═══ ٤) تجديد: دفعة جديدة تفتح السجل فوراً ═══ */
  DB.subscriptions.push({ id: 105, user_id: U.pay, term: '203020', status: 'pending', includes_term: true,
    pushover: false, base_halalas: 1900, pushover_halalas: 0, discount_halalas: 0, credit_halalas: 1900,
    amount_halalas: 0, gateway: 'credit', created_at: iso(Date.now() - 60e3), paid_at: null, valid_until: later });
  const st = await call('GET', '/api/me/pay?id=105', { tok: TOK_PAY });
  ok(st.j && st.j.status === 'paid', 'الطلب الجديد تسوّى — ' + JSON.stringify(st.j).slice(0, 80));
  await cycle();
  eq([rows(U.pay, 'alert').length, rows(U.pay, 'pushover').length], [2, 2],
     '**بعد دفعة جديدة: أول استخدام بعدها ينسجّل ولو قبل ١٠ دقائق** — وإلا ضاع على الطلب الجديد');

  /* ═══ ٥) تنبيه التجربة من اللوحة: ينسجّل وحده ═══ */
  const pt = await call('POST', '/api/admin/push-test', { admin: true, body: { email: 'pay@x.com' } });
  ok(pt.j && pt.j.ok, 'تنبيه التجربة انرسل — ' + JSON.stringify(pt.j).slice(0, 80));
  await wait(300);
  eq(rows(U.pay, 'pushover_test').length, 1, '**تنبيه التجربة من اللوحة ينسجّل باسمه** — لا كاستخدام الطالب');
  eq(rows(U.pay, 'pushover').length, 2, 'وما يغيّر عدّ التنبيه الطارئ');

  /* ═══ ٦) اللوحة تفسّر: حدود المجاني · قبل الدفع · محتوى الطلب ═══ */
  const at = ms => iso(Date.parse(PAID1) + ms);
  DB.paid_usage.push(
    { id: ++NEXT, user_id: U.pay, feature: 'monitor', n: 2, detail: null, at: at(1 * H) },       /* ٢ من ٢: مجانية */
    { id: ++NEXT, user_id: U.pay, feature: 'schedule', n: 2, detail: null, at: at(-1 * H) },     /* قبل الدفع */
    { id: ++NEXT, user_id: U.pay, feature: 'monitor', n: 3, detail: null, at: at(2 * H) },
    { id: ++NEXT, user_id: U.pay, feature: 'slot', n: 3, detail: null, at: at(3 * H) },
    { id: ++NEXT, user_id: U.pay, feature: 'ai', n: null, detail: 'my_day', at: at(4 * H) },
    { id: ++NEXT, user_id: U.old, feature: 'ai', n: null, detail: 'gpa', at: iso(Date.parse(PAIDOLD) + D) },
    { id: ++NEXT, user_id: U.old, feature: 'pushover', n: null, detail: null, at: iso(Date.parse(PAIDOLD) + D) },
    { id: ++NEXT, user_id: U.po, feature: 'ai', n: null, detail: 'my_day', at: iso(Date.parse(PAIDPO) + H) },
    { id: ++NEXT, user_id: U.po, feature: 'monitor_course', n: null, detail: null, at: iso(Date.parse(PAIDPO) + H) },
    { id: ++NEXT, user_id: U.po, feature: 'pushover', n: null, detail: null, at: iso(Date.parse(PAIDPO) + 2 * H) },
  );
  d = await adminPay();
  const u1 = (recentOf(d, 101).usage || {}).used || [];
  eq(u1.map(x => x.kind), ['monitor', 'schedule', 'ai', 'alert', 'pushover', 'pushover_test'],
     '**طلب الترم + التنبيه الطارئ: كل ميزة مرة، بترتيب أول استخدام**');
  const k = n => u1.find(x => x.kind === n) || {};
  eq([k('monitor').n, k('schedule').n, k('ai').detail], [3, 3, 'my_day'],
     '**مراقبة ٢ من ٢ ما تنحسب (أول مدفوع: ٣) · الجدول قبل الدفع ما ينحسب (أول بعده: ٣) · واسم الأداة**');
  eq(((recentOf(d, 102).usage || {}).used || []).map(x => x.kind), ['ai'],
     '**طلب الترم وحده: التنبيه الطارئ ما ينحسب عليه**');
  eq(((recentOf(d, 103).usage || {}).used || []).map(x => x.kind), ['pushover'],
     '**طلب التنبيه الطارئ وحده: ميزات الترم ما تنحسب عليه**');
  eq(((recentOf(d, 105).usage || {}).used || []).map(x => x.kind), ['alert'],
     'والتجديد: استخدامه من بعد دفعه وحده (والتنبيه الطارئ مو من طلبه)');
  ok(JSON.stringify(d.recent).indexOf(U.pay) < 0, 'ورد اللوحة ما فيه معرّف الطالب');

  /* ═══ ٧) السجل ما يشتغل: اللوحة تقولها، لا «ما استخدم» ═══ */
  MISSING = true;
  d = await adminPay();
  eq(d.usageLog, 'missing', '**الجدول ناقص (الـSQL ما انشغّل): اللوحة تنبّه**');
  ok((d.recent || []).every(x => x.usage === null), '**وما نقول «ما استخدم» لأي طلب** — كذبة تكلّف فلوس');
  const keep = DB.subscriptions.splice(0);
  d = await adminPay();
  eq(d.usageLog, 'missing', 'وحتى بلا طلبات مدفوعة: التنبيه يطلع من أول نشر');
  DB.subscriptions.push(...keep);
  MISSING = false;
  d = await adminPay();
  eq(d.usageLog, 'ok', 'ورجع الجدول: يرجع «يشتغل»');

  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log('  ✗ انهار: ' + (e && e.stack || e));
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
