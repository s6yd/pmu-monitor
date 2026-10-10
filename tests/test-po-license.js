/* رخص Pushover بموافقتك — اختبار سلوكي على السيرفر الحقيقي.
   الرخصة علينا (قرار محمد §٧)، وكانت بيده: «لو طلب منك دفعاً، راسلنا ونتكفّل».
   طلبه «ابسط شي بدون تدخل مني» فصارت تنضاف تلقائياً من رصيد الرخص
   (`licenses/assign.json`) — ثم قراره (٩ أكتوبر ٢٠٢٦): **«ما أبي الرخصة تمنح أوتوماتك بدون
   ما أأكد عليها أول»**. فالدورة تلقى المستحق وتسأله على تلقرام بزرّين («✅ أضف الرخصة» ·
   «✖️ لا»)، واللوحة تعرض المنتظرين بنفس الزرّين — ولا رخصة قبل ضغطته.
   شكل Pushover من توثيقهم (Licensing API) حرفاً بحرف:
     نجاح ٢٠٠ ‎{"status":1,"credits":5,"request":"…"}‎ ·
     فشل ‎{"status":0,"request":"…","errors":{"token":["is out of available license credits"]}}‎ ·
     الرصيد ‎GET /1/licenses.json?token=‎ بنفس الشكل.
   وتوصيتهم: «أي خطأ يُرفع، ولا إعادة تلقائية لين يتدخّل إنسان».

   أخطار يمسكها:
   ١) **رخصة بلا موافقته** (فلوس ما ترجع): الدورة تسأل ولا تطلب · ورصيد وصل ما يضيف
      إلا لمن وافق عليه · وزر تلقرام من غير محادثته ما يسوي شي.
   ٢) **رخصة لمن ما يستحق**: داخل مدة الاسترجاع · ما ربط التطبيق · استرجع (ولو بعد
      سؤالنا) · انتهت إضافته أو سُحبت · دفعة تجربة · صاحب الموقع.
   ٣) **رخصتان لطالب**: ضغطتان · زر تلقرام واللوحة معاً · نسختان وقت النشر.
   ٤) **سؤال يتكرر**: كل دورة · بعد كل نشر (يُحفظ مع الحالة) — إلا لو صار مستحقاً من جديد.
   ٥) **موافقة تضيع**: خلص الرصيد وسط الدفعة — اللي وافق عليه يبقى ينتظر.
   ٦) **إعادة تلقائية بعد فشل**: رفض أو رد ضايع يوقف الطالب لين اللوحة.
   ٧) **رمز التطبيق ومفتاح الطالب ما يطلعان** في اللوحة ولا الخطأ ولا رسائلك.
   ٨) **dev ما يصرف شي** ولا يسأل.

   node tests/test-po-license.js [server.js]
   (يشغّل نفسه كعمليات مستقلة لـdev ولإعادة التشغيل — المتغيّرات والحالة تُقرأ عند الإقلاع) */
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

/* الحالة المحفوظة قبل الإقلاع: إعادة التشغيل فيها مين سألناك عنه */
const SAVED = { pushoverMode: 'addon' };
if (MODE === 'restart') SAVED.poLicAsked = [
  [uid(1), Date.now() - 60000],                  /* سألناك قبل دقيقة — ما نعيد */
  [uid(3), Date.now() - 30 * DAY],               /* سألناك قبل ما يصير مستحقاً من جديد */
  ['not-a-uuid', Date.now()], [null, 5]];        /* محفوظ خربان: يُتجاهل */

/* ═══ القاعدة المزيّفة — تطابق PostgREST: الفلاتر، الترتيب، القصّ عند ١٠٠٠،
   Prefer في الترويسة، والمفتاح الأساسي يرجع 23505 والقيود 23514 والأجنبي 23503 ═══ */
const DB = { profiles: [], subscriptions: [], pushover_licenses: [], app_events: [],
  app_state: [{ key: MODE === 'dev' ? 'runtime-dev' : 'runtime', value: { toggles: SAVED } }] };
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

/* ═══ تلقرام المزيّف: الرسائل بأزرارها · التعديل على رسالة الزرّين · ردّ الضغطة ═══ */
const TG = [], EDITS = [], ACKS = [];
let TG_DOWN = false;                /* تلقرام رفض رسالتك (زحمة) — بلا «blocked» حتى ما نفكّ ربطك */
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
        if (/sendMessage$/.test(opts.path)) {
          if (TG_DOWN) res = [429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5' }];
          else TG.push({ chat_id: String(b.chat_id), text: String(b.text || ''), markup: b.reply_markup || null });
        } else if (/editMessageText$/.test(opts.path))
          EDITS.push({ chat_id: String(b.chat_id), message_id: b.message_id, text: String(b.text || ''),
            markup: b.reply_markup || null });
        else if (/answerCallbackQuery$/.test(opts.path)) ACKS.push(String(b.text || ''));
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

const BASES = { prod: 49100, dev: 49200, restart: 49300 };
const PORT = BASES[MODE] + (process.pid % 100), ADMIN = 'admin-token-for-po-license';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: ADMIN, SITE_ENV: MODE === 'dev' ? 'dev' : 'prod', ACTIVE_TERM: '202710',
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
const post = async (act, userId) => {
  const r = (await call('/api/admin/' + act, 'POST', userId ? { userId } : {})).j;
  await wait(80);
  return r || {};
};
const retry = userId => post('po-lic-retry', userId);      /* «▶️ كمّل الحين» بلا طالب · «🔁 أعد» عليه */
const done = userId => post('po-lic-done', userId);
const approve = userId => post('po-lic-approve', userId);  /* «✅ أضف» من اللوحة */
const skip = userId => post('po-lic-skip', userId);        /* «✖️ لا» من اللوحة */
const state = async () => (await call('/api/admin/po-lic?fresh=1', 'GET')).j || {};
/* ضغطة زر في تلقرام: تحديث callback_query على رسالة الزرّين (رقمها ٧٧) */
let UPD = 1000;
async function press(chat, data, text) {
  const id = ++UPD;
  await call('/tg-webhook', 'POST', { update_id: id, callback_query: { id: 'cq' + id,
    from: { id: Number(chat), is_bot: false, first_name: 'x' }, data,
    message: { message_id: 77, chat: { id: Number(chat), type: 'private' }, date: 1, text: text || '🎟' } } });
  await wait(80);
  return EDITS.filter(e => e.chat_id === String(chat) && e.message_id === 77).pop() || null;
}
const row = id => DB.pushover_licenses.find(x => x.user_id === id);
const assignedTo = () => PO.assigns.map(f => f.user);
const reqsFor = n => PO.assigns.filter(f => f.user === key(n)).length;
const tgTo = (chat, re) => TG.filter(m => m.chat_id === String(chat) && re.test(m.text));
const admin = re => TG.filter(m => m.chat_id === '5555' && re.test(m.text));
/* رسالة السؤال عن طالب بعينه (بإيميله) */
const asks = n => admin(/طالب يستحق رخصة Pushover/).filter(m => m.text.includes(`s${n}@example.com\n`));
const asksAll = () => admin(/طالب يستحق رخصة Pushover/).length;

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
const bell = async () => {
  /* جرس EdfaPay لطلب مو لنا يشغّل payTick الحين — الدورة نفسها لا زر اللوحة */
  const raw = JSON.stringify({ orderId: 'ORDER-' + (++UPD), status: 'Approved', type: 'Purchase' });
  const sig = crypto.createHmac('sha256', HOOK_SECRET).update(raw).digest('hex');
  const r = await call('/api/edfapay/webhook', 'POST', raw, { 'Content-Type': 'text/plain', 'X-EdfaPay-Signature': sig });
  await wait(400);
  return r.code;
};

async function prod() {
  /* ── ١) الدورة تسألك ولا تضيف شي ── */
  const A = student(1);                                          /* دفع قبل ٨ أيام وربط ⇒ يستحق */
  const G = student(2, { gift: true });                          /* هدية اليوم وربط ⇒ فوراً */
  const W = student(3, { paidDaysAgo: 3 });                      /* داخل مدة الاسترجاع */
  student(4, { key: null });                                     /* ما ربط التطبيق */
  student(5, { status: 'refunded' });                            /* استرجع */
  student(6, { paidDaysAgo: 200, until: ago(2), valid: ago(2) });   /* انتهت إضافته */
  const OW = student(7, { gift: true, chat: '5555' });           /* صاحب الموقع */
  student(8, { gift: true, until: ago(1) });                     /* سُحبت من اللوحة (الصف باقٍ) */
  student(9, { gateway: 'edfapay-test' });                       /* دفعة تجربة من dev */
  student(10, { pushover: false });                              /* اشترى الترم بلا الإضافة */
  student(11, { key: 'not a key@example.com' });                 /* مفتاح مو مفتاح */
  student(12);                                                   /* أخذها من قبل */
  DB.pushover_licenses.push({ user_id: uid(12), status: 'assigned', source: 'paid', kind: null, credits: 9,
    request: reqId(), error: null, created_at: ago(30), done_at: ago(30) });
  await wait(400);                                               /* استعادة الحالة (الوضع addon) */

  eq(await bell(), 200, 'جرس EdfaPay مقبول');
  eq(PO.assigns.length, 0, '**الدورة (payTick) ما طلبت ولا رخصة** — قرار محمد: «ما أبي الرخصة تمنح أوتوماتك بدون ما أأكد عليها أول»');
  eq(DB.pushover_licenses.map(x => x.user_id), [uid(12)], 'ولا حجزت صفاً لأحد');
  eq([asks(1).length, asks(2).length, asksAll()], [1, 1, 2],
     '**سألتك على تلقرام عن المستحقين وحدهم** (بعد مدة الاسترجاع + الهدية) — لا داخل المدة ولا بلا ربط ' +
     'ولا مسترجع ولا منتهٍ ولا صاحب الموقع ولا مسحوب ولا تجربة ولا بلا إضافة ولا مفتاح غلط ولا مرخّص');
  const qa = asks(1)[0] || { text: '', markup: null }, qg = asks(2)[0] || { text: '', markup: null };
  eq(qa.markup && qa.markup.inline_keyboard, [[{ text: '✅ أضف الرخصة', callback_data: 'pol:ok:' + A },
    { text: '✖️ لا', callback_data: 'pol:no:' + A }]], 'بزرّين: «✅ أضف الرخصة» و«✖️ لا» — بمعرّف الطالب');
  ok(Buffer.byteLength('pol:ok:' + A) <= 64, 'والزر ضمن حد تيليغرام (٦٤ بايت)');
  ok(/اشترى التنبيه الطارئ — خلصت مدة استرجاعه \d+ \S+/.test(qa.text) && /هدية منك/.test(qg.text),
     'وتقول ليش يستحق: اشترى وخلصت مدة استرجاعه (بتاريخها) · أو هدية منك');
  ok(/رصيدك عند Pushover: 4/.test(qa.text), 'ورصيدك الحين');
  ok(/تنخصم رخصة من رصيدك وما ترجع/.test(qa.text), 'وإنها فلوس ما ترجع');
  eq(TG.filter(m => /انضافت رخصة Pushover لحسابك/.test(m.text)).length, 0, 'وما وصل أي طالب شي');
  let st = await state();
  eq([st.approval, st.waiting, (st.waitingList || []).map(x => x.user)], [true, 2, [A, G]],
     'اللوحة: «ينتظرون موافقتك» ٢ — الأقدم أول');
  eq((st.waitingList || []).map(x => [x.email, x.source, x.asked]),
     [['s1@example.com', 'paid', true], ['s2@example.com', 'comp', true]], 'بإيميله ومصدره، وإننا سألناك');
  ok((st.waitingList || []).every(x => !('key' in x) && !JSON.stringify(x).includes(key(1)) && !JSON.stringify(x).includes(key(2))),
     'وبلا مفتاح أحد');
  await retry();
  await bell();
  eq([PO.assigns.length, asksAll()], [0, 2], '**دورتان بعدها: ما سألناك ثانية ولا طلبنا شي**');

  /* ── ٢) «✅ أضف» من اللوحة ── */
  let r = await approve(A);
  eq([r.ok, r.done && r.done.ok, r.done && r.done.email, r.done && r.done.credits], [true, true, 's1@example.com', 3],
     '«✅ أضف» من اللوحة: انضافت — ومعها الرصيد بعدها');
  eq(assignedTo(), [key(1)], 'طلبناها له وحده');
  ok(PO.assigns.every(f => f.token === PO_TOKEN && !('os' in f) && !('email' in f)),
     'برمز التطبيق ومفتاح الطالب، وبلا os (توصيتهم: أول جهاز يسجّله) ولا إيميل (يعلق معلّقاً لو ما طابق)');
  const ra = row(A) || {};
  eq([ra.status, ra.source, ra.credits], ['assigned', 'paid', 3], 'صفّه «انضافت» بمصدره والرصيد بعدها');
  ok(/^[0-9a-f-]{36}$/.test(ra.request || ''), 'ورقم طلبهم');
  ok(tgTo(901, /انضافت رخصة Pushover لحسابك/).length === 1 && tgTo(901, /لو طلب منك دفعاً، راسلنا هنا/).length === 1,
     'الطالب يوصله «انضافت رخصة Pushover لحسابك» — ولو طلب منك دفعاً راسلنا');
  eq([r.waiting, (r.waitingList || []).map(x => x.user)], [1, [G]], 'واللوحة رجعت بالباقين');
  r = await approve(A);
  ok(r.ok === false && /انضافت له من قبل/.test(r.error || ''), 'ضغطة ثانية عليه: «انضافت له من قبل»');
  eq(PO.assigns.length, 1, '**وما طلبنا رخصة ثانية**');

  /* ── ٣) «✅ أضف الرخصة» من تلقرام ── */
  let e = await press('5555', 'pol:ok:' + G);
  eq((row(G) || {}).status, 'assigned', '**زر تلقرام في محادثتك: انضافت**');
  ok(e && /انضافت رخصة Pushover/.test(e.text) && /s2@example\.com/.test(e.text) && /باقي في رصيدك: 2/.test(e.text),
     'ورسالة الزرّين صارت «✅ انضافت — s2@… · باقي في رصيدك: 2» (فما تضغطها ثانية)');
  ok(ACKS.includes('نضيفها…'), 'وتيليغرام يرد على الضغطة فوراً');
  ok(tgTo(902, /انضافت رخصة Pushover لحسابك/).length === 1, 'والطالب وصله سطره');
  ok(admin(/باقي 2 من رخص Pushover/).length === 1, '**قارب الرصيد يخلص (٢): نبّهناك** مرة وحدة');
  e = await press('5555', 'pol:ok:' + G);
  ok(e && /✅ انضافت له من قبل/.test(e.text) && !/⚠️/.test(e.text),
     'ضغطة ثانية بعد ما انضافت: «✅ انضافت له من قبل» — لا تحذير يغطّي النجاح');
  eq(PO.assigns.length, 2, 'وما طلبنا ثانية');
  const X = student(13, { gift: true });
  await retry();
  eq(asks(13).length, 1, 'هدية جديدة: سألناك عنها');
  const ed = EDITS.length;
  for (const chat of ['913', '777']) await press(chat, 'pol:ok:' + X);
  eq([reqsFor(13), row(X), EDITS.length], [0, undefined, ed],
     '**الزر من محادثة غير محادثتك ما يسوي شي** — حتى الطالب نفسه');
  await press('5555', 'pol:ok:abc');
  eq([PO.assigns.length, EDITS.length], [2, ed], 'وزر بمعرّف خربان يُتجاهل');

  /* ── ٤) «✖️ لا» ── */
  e = await press('5555', 'pol:no:' + X);
  eq([(row(X) || {}).status, (row(X) || {}).source, reqsFor(13)], ['manual', 'comp', 0],
     '**«✖️ لا»: ما طلبنا شي** — وصفّه «يدوي» فما نرجع نسألك');
  ok(e && /ما أضفناها/.test(e.text) && /s13@example\.com/.test(e.text) && /«✅ أضفها» على صفّه/.test(e.text),
     'والرسالة تقول «ما أضفناها» ووين ترجع لو غيّرت رأيك');
  await retry();
  eq([asks(13).length, reqsFor(13)], [1, 0], 'والدورة بعدها ما سألتك عنه ثانية');
  ok(!((await state()).waitingList || []).some(x => x.user === X), 'ولا هو في «ينتظرون موافقتك»');
  r = await retry(X);                                           /* «✅ أضفها» على صفّه في اللوحة */
  eq([(row(X) || {}).status, reqsFor(13), r.done && r.done.ok], ['assigned', 1, true],
     'غيّرت رأيك («✅ أضفها» على صفّه): انضافت');
  ok(admin(/باقي 1 من رخص Pushover/).length === 1, 'والرصيد ١: تنبيه ثاني بالرقم الجديد');
  const Y = student(14, { gift: true });
  r = await skip(Y);
  eq([r.ok, r.done && r.done.skipped, (row(Y) || {}).status, reqsFor(14)], [true, true, 'manual', 0],
     '«✖️ لا» من اللوحة كذلك — حتى قبل ما يوصلك السؤال');

  /* ── ٥) ما عاد مستحقاً وقت ضغطتك ── */
  r = await approve(W);
  ok(r.ok === false && /ما عاد مستحقاً/.test(r.error || ''), 'داخل مدة الاسترجاع: «ما عاد مستحقاً» — حتى من اللوحة');
  const Z = student(15);
  await retry();
  eq(asks(15).length, 1, 'سألناك عنه');
  DB.subscriptions.find(s => s.user_id === Z).status = 'refunded';
  e = await press('5555', 'pol:ok:' + Z);
  ok(e && /ما عاد مستحقاً/.test(e.text), '**استرجع بعد سؤالنا وقبل ضغطتك: «ما عاد مستحقاً»** — الفحص وقت الضغط');
  r = await approve(OW);
  eq([reqsFor(15), row(Z), reqsFor(7), row(OW), r.ok], [0, undefined, 0, undefined, false],
     'ما طلبنا له ولا حجزنا — ولا لصاحب الموقع');

  /* ── ٦) خلص الرصيد: اللي وافقت عليه ينتظر، ويكمل لحاله لما تشتري — والباقي لا ── */
  PO.credits = 0;
  const C1 = student(21, { gift: true }), C2 = student(22, { gift: true }), C3 = student(23, { gift: true });
  const C4 = student(24, { gift: true });                        /* ما وافقت عليه */
  await retry();
  ok(asks(21).length === 1 && asks(24).length === 1 && /رصيدك عند Pushover: 0/.test(asks(21)[0].text),
     'سألناك عنهم — والرسالة تقول رصيدك صفر');
  r = await approve(C1);
  ok(r.ok === false && /خلص رصيد الرخص/.test(r.error || ''), 'وافقت عليه والرصيد صفر: «خلص رصيد الرخص — اشترِ ونكمل له»');
  eq([(row(C1) || {}).status, (row(C1) || {}).kind], ['failed', 'credits'], 'وصفّه «فشل · خلص الرصيد»');
  ok(admin(/خلص رصيد رخص Pushover[\s\S]*طالب وافقت عليه ينتظر رخصته/).length >= 1, 'ونبّهناك: اشترِ — ونكمل له لحالنا');
  await approve(C2);
  await approve(C3);
  eq((await state()).state, 'credits', 'اللوحة: «خلص الرصيد — اللي وافقت عليه يكمل بعد ما تشتري»');
  let n0 = PO.assigns.length;
  const reads = PO.creditReads;
  await retry();
  eq(PO.assigns.length - n0, 0, '**والرصيد لسا صفر: ما أعدنا الطلب** — سألنا عن الرصيد بس');
  ok(PO.creditReads > reads, 'سؤال الرصيد (بلا أثر عندهم)');
  PO.credits = 1;                                                /* اشترى رخصة وحدة وثلاثة ينتظرون */
  await retry();
  eq([C1, C2, C3].map(id => [(row(id) || {}).status, (row(id) || {}).kind || null]),
     [['assigned', null], ['failed', 'credits'], ['failed', 'credits']],
     '**اشترى رخصة وحدة: انضافت للأول، والاثنان بعده باقيين «خلص الرصيد» — موافقتك عليهم ما ضاعت**');
  ok(admin(/وصل رصيد رخص Pushover \(1\) — أضفنا 1 ممن وافقت عليهم/).length === 1, 'وقلنا لك: أضفنا ١ ممن وافقت عليهم');
  PO.credits = 5;
  await retry();
  eq([(row(C2) || {}).status, (row(C3) || {}).status], ['assigned', 'assigned'], 'اشترى أكثر: كمّلنا لهم لحالنا');
  ok(admin(/وصل رصيد رخص Pushover \(5\) — أضفنا 2/).length === 1, 'وقلنا لك');
  eq([reqsFor(24), row(C4)], [0, undefined], '**واللي ما وافقت عليه ما انطلب له شي — حتى والرصيد موجود**');
  await skip(C4);
  PO.credits = 100;                                              /* رصيد يكفي باقي الاختبار */

  /* ── ٧) رفضوها: يوقف هالطالب وحده ── */
  PO.mode = 'rejected';
  const R1 = student(31, { gift: true });
  await retry();
  r = await approve(R1);
  ok(r.ok === false && /Pushover رفضها: user: is invalid/.test(r.error || ''), 'رفضوها: نقول لك سببهم نصاً');
  eq([(row(R1) || {}).status, (row(R1) || {}).kind], ['failed', 'rejected'], 'صفّه «فشل · رفض»');
  ok(admin(/Pushover رفض إضافة رخصة[\s\S]*user: is invalid[\s\S]*اللوحة ← «النظام» ← «🎟 رخص Pushover»/).length === 1,
     'ونبّهناك بسببهم ووين تلقاه في اللوحة — تبويب «النظام» (اسمه الفعلي)');
  PO.mode = 'ok';
  const R2 = student(32, { gift: true });
  await retry();
  eq(asks(32).length, 1, 'وطالب جديد يوصلك سؤاله عادي');
  r = await approve(R2);
  eq([r.ok, (row(R2) || {}).status], [true, 'assigned'], '**وتقدر توافق على غيره** — كل طالب بقرارك');
  n0 = reqsFor(31);
  await retry();
  eq(reqsFor(31), n0, '**وما أعدنا للمرفوض لحالنا** — توصية Pushover');
  eq((await state()).state, 'stopped', 'واللوحة: «فيه طالب واقف — يحتاج نظرك»');
  r = await done(R1);
  eq([(row(R1) || {}).status, r.state], ['manual', 'on'], '«✔️ تمّت»: صفّه «يدوي» والوضع رجع «شغّالة»');

  /* ── ٨) رد ضايع: ما ندري انخصمت ولا لا ── */
  for (const m of ['down', 'net']) {
    const n = m === 'down' ? 41 : 42, label = m === 'down' ? '٥٠٣' : 'انقطاع';
    PO.mode = m;
    const U = student(n, { gift: true });
    await retry();
    await approve(U);
    eq([(row(U) || {}).status, (row(U) || {}).kind], ['failed', 'unknown'], `${label}: «ما ندري»`);
    PO.mode = 'ok';
    await retry();
    eq(reqsFor(n), 1, `${label}: **ما أعدنا لحالنا** لين تشوفه`);
    const rr = await retry(U);
    eq([(row(U) || {}).status, rr.done && rr.done.ok, rr.state], ['assigned', true, 'on'], '«🔁 أعد» عليه: انشال صفّه وانضافت');
  }
  eq(admin(/ما ندري انضافت رخصة ولا لا/).length, 2, 'ونبّهناك مرتين: «ما ندري» — شيك على الرصيد');

  /* ── ٩) حجز بلا نتيجة: نسخة ثانية في نصّ نداء · أو انقطعت ── */
  const P1 = student(51, { gift: true });
  DB.pushover_licenses.push({ user_id: P1, status: 'pending', source: 'comp', kind: null, credits: null,
    request: null, error: null, created_at: new Date().toISOString(), done_at: null });
  const P2 = student(52, { gift: true });
  n0 = PO.assigns.length;
  await retry();
  eq([PO.assigns.length - n0, asks(52).length], [0, 0], 'حجز حديث من نسخة ثانية: ننتظرها');
  r = await approve(P1);
  ok(r.ok === false && /ننتظر ردّ Pushover عليه الحين/.test(r.error || ''), 'وضغطتك عليه: «ننتظر ردّ Pushover عليه الحين»');
  row(P1).created_at = ago(11 / 1440);                           /* ١١ دقيقة */
  await retry();
  eq([(row(P1) || {}).status, (row(P1) || {}).kind, PO.assigns.length - n0], ['failed', 'unknown', 0],
     '**حجز عمره ١١ دقيقة بلا نتيجة: «ما ندري»** — ما نعيد');
  eq(asks(52).length, 1, 'وبعدها سألناك عن اللي بعده');
  await done(P1);
  await approve(P2);
  eq((row(P2) || {}).status, 'assigned', 'ووافقت عليه: انضافت');

  /* ── ١٠) نسخة ثانية حجزت الطالب بعد ما قرينا المرشّحين ── */
  const S1 = student(61, { gift: true });
  await retry();
  AFTER_CAND = () => DB.pushover_licenses.push({ user_id: S1, status: 'assigned', source: 'comp', kind: null,
    credits: 1, request: reqId(), error: null, created_at: new Date().toISOString(), done_at: new Date().toISOString() });
  r = await approve(S1);
  ok(r.ok === false && /سبقتنا/.test(r.error || ''), 'المفتاح الأساسي (23505): «نسخة ثانية سبقتنا عليه»');
  eq(reqsFor(61), 0, '**وما طلبنا رخصة ثانية**');

  /* ── ١١) ضغطات معاً ── */
  const D1 = student(71, { gift: true }), D2 = student(72, { gift: true });
  await retry();
  await Promise.all([approve(D1), approve(D1), approve(D1)]);
  await Promise.all([press('5555', 'pol:ok:' + D2), approve(D2), press('5555', 'pol:ok:' + D2)]);
  await wait(200);
  eq([reqsFor(71), reqsFor(72)], [1, 1], '**ثلاث ضغطات معاً = رخصة وحدة** — ولو من تلقرام واللوحة');
  ok(!EDITS.some(x => /شغّالين/.test(x.text)), 'والضغطة اللي جات والأولى شغّالة ما كتبت شي فوق نتيجتها');
  ok((row(D1) || {}).status === 'assigned' && (row(D2) || {}).status === 'assigned', 'وصفّاهما «انضافت»');

  /* ── ١٢) لا رمز التطبيق ولا مفتاح الطالب يطلعان ── */
  PO.mode = 'leak';
  const L1 = student(81, { gift: true });
  await retry();
  r = await approve(L1);
  st = await state();
  PO.mode = 'ok';
  const rl = row(L1) || { error: '' };
  eq([rl.status, rl.kind], ['failed', 'rejected'], 'خطأ فيه رمزنا ومفتاحه: «رفض»');
  ok(!rl.error.includes(PO_TOKEN) && !rl.error.includes(key(81)) && /not a valid user/.test(rl.error),
     '**الخطأ المحفوظ بلا رمز التطبيق ولا مفتاح الطالب** — ونصّهم باقٍ');
  const keys = DB.profiles.map(p => p.pushover_key).filter(k => k && /^[A-Za-z0-9]{20,}$/.test(k));
  const leaks = s => s.includes(PO_TOKEN) || keys.some(k => s.includes(k));
  ok(!leaks(JSON.stringify(r)) && /not a valid user/.test(r.error || ''), 'ولا ردّ الزر');
  ok(!leaks(JSON.stringify(st)), '**اللوحة ما فيها رمز التطبيق ولا أي مفتاح**');
  ok(!admin(/./).some(m => leaks(m.text)) && !EDITS.some(m => leaks(m.text)), 'ولا رسائلك ولا الأزرار');
  await done(L1);

  /* ── ١٣) تلقرام رفض رسالة السؤال: نعيدها الدورة الجاية ── */
  TG_DOWN = true;
  const T1 = student(85, { gift: true });
  await retry();
  TG_DOWN = false;
  eq(asks(85).length, 0, 'تلقرام رفض الرسالة');
  ok(!((await state()).waitingList || []).find(x => x.user === T1 && x.asked), 'فما نحسبها «سألناك»');
  await retry();
  eq(asks(85).length, 1, '**والدورة الجاية سألتك** — ما يضيع طالب لأن الرسالة ما وصلت');
  await skip(T1);

  /* ── ١٤) اللوحة ── */
  const s2 = await state();
  eq([s2.ok, s2.live, s2.table, s2.state, s2.credits, s2.refundDays, s2.approval, s2.waiting],
     [true, true, 'ok', 'on', PO.credits, 7, true, 0],
     'اللوحة: الإنتاج · الجدول موجود · شغّالة · الرصيد من Pushover · مدة الاسترجاع · بموافقتك · ما فيه أحد ينتظر');
  ok(Array.isArray(s2.rows) && s2.rows.some(x => x.email === 's13@example.com' && x.status === 'assigned'),
     'والصفوف بإيميل الطالب');
  for (const f of [approve, skip, retry]) {
    const nr = await f('abc');
    ok(nr.ok === false, 'معرّف غلط مرفوض — ' + f.name);
  }
  for (const a of ['po-lic', 'po-lic-approve', 'po-lic-skip'])
    ok((await call('/api/admin/' + a, a === 'po-lic' ? 'GET' : 'POST', a === 'po-lic' ? null : { userId: A },
      { 'X-Admin-Token': 'wrong' })).code === 401, 'وبلا رمز اللوحة ٤٠١ — ' + a);

  /* ── ١٥) الجدول ناقص (الـSQL ما انشغّل) · الوضع off: ما نسأل ولا نطلب ── */
  NO_TABLE = true;
  const N1 = student(91, { gift: true });
  n0 = PO.assigns.length;
  await retry();
  r = await approve(N1);
  eq([PO.assigns.length - n0, asks(91).length, r.ok], [0, 0, false],
     '**الجدول ناقص: ما سألناك ولا طلبنا** (بلا حجز = بلا ضمان مرة وحدة)');
  eq((await state()).table, 'missing', 'واللوحة تقول «شغّل الـSQL»');
  const ask91 = '🎟 طالب يستحق رخصة Pushover\n\ns91@example.com\nهدية منك (تنبيه طارئ)';
  e = await press('5555', 'pol:ok:' + N1, ask91);
  ok(e && e.text.startsWith('🎟 طالب يستحق رخصة Pushover') && /s91@example\.com/.test(e.text) &&
     /⚠️ تعذّر قراءة المستحقين[\s\S]*جرّب ثانية/.test(e.text),
     '**عطل عابر من تلقرام: الرسالة باقية وتحتها الخطأ** — ' + (e && e.text));
  eq(e && e.markup && e.markup.inline_keyboard.flat().map(b => b.callback_data), ['pol:ok:' + N1, 'pol:no:' + N1],
     '**والزرّان رجعوا** — تجرّب ثانية من تلقرام');
  e = await press('5555', 'pol:ok:' + N1, e ? e.text : ask91);
  eq(e && (e.text.match(/⚠️/g) || []).length, 1, 'وعطل ثاني ما يكدّس سطور الخطأ');
  NO_TABLE = false;
  await call('/api/admin/pushover-mode', 'POST', { mode: 'off' });
  await retry();
  r = await approve(N1);
  eq([PO.assigns.length - n0, asks(91).length, r.ok], [0, 0, false], 'وضع Pushover «off»: ما سألنا ولا طلبنا');
  ok(/مطفأ/.test(r.error || ''), 'والزر يقول «مطفأ»');
  eq((await state()).state, 'off', 'واللوحة تقولها');
  await call('/api/admin/pushover-mode', 'POST', { mode: 'addon' });
  await retry();
  eq(asks(91).length, 1, 'رجع «addon»: سألناك');
  await approve(N1);
  eq((row(N1) || {}).status, 'assigned', 'ووافقت: انضافت');

  /* ── ١٦) مين سألناك عنه يُحفظ مع الحالة ── */
  const saved = (DB.app_state.find(x => x.key === 'runtime') || {}).value || {};
  const pa = (saved.toggles && saved.toggles.poLicAsked) || [];
  ok([A, G, X, C1, N1].every(id => pa.some(p => p[0] === id && Number.isFinite(p[1]))),
     '**مين سألناك عنه ينحفظ** — بلاه يجيك السؤال مرة ثانية مع كل نشر');
}

/* إعادة التشغيل: الحالة المحفوظة فيها مين سألناك عنه */
async function restart() {
  student(1);                                    /* سألناك قبل دقيقة */
  student(2, { gift: true });                    /* ما سألناك */
  student(3);                                    /* سألناك قبل ٣٠ يوم — وصار مستحقاً قبل يوم */
  await wait(400);
  await retry();
  eq([asks(1).length, asks(2).length], [0, 1], '**بعد النشر: ما سألناك ثانية عن اللي سألناك عنه** — والجديد سألناك');
  eq(asks(3).length, 1, 'وصار مستحقاً من جديد بعد سؤالنا (شراء أو هدية جديدة): سألناك ثانية');
  eq(PO.assigns.length, 0, 'وما طلبنا شي');
}

async function dev() {
  const A = student(1);
  student(2, { gift: true });
  await wait(400);
  await bell();
  const r = await retry();
  eq([PO.assigns.length, DB.pushover_licenses.length, asksAll()], [0, 0, 0],
     '**dev ما يسألك ولا يطلب رخصة ولا يحجز صفاً** — القاعدة مشتركة والرخص فلوس');
  ok(r.ok === false && /الإنتاج/.test(r.error || ''), '«كمّل الحين» في dev: «من الإنتاج وحده»');
  const a = await approve(A);
  ok(a.ok === false && /الإنتاج/.test(a.error || ''), '«✅ أضف» في dev: «من الإنتاج وحده»');
  const e = await press('5555', 'pol:ok:' + A);
  ok(e && /الإنتاج وحده/.test(e.text), 'وزر تلقرام لو وصل dev: «من الإنتاج وحده»');
  eq([PO.assigns.length, DB.pushover_licenses.length], [0, 0], 'وما طلبنا شي');
  eq((await state()).state, 'dev', 'واللوحة تقول «dev»');
}

function child(mode) {
  return new Promise(resolve => {
    const c = fork(__filename, [SRV, '--mode=' + mode], { silent: true });
    let o = '';
    c.stdout.on('data', d => o += d);
    c.on('exit', () => resolve([mode, o]));
  });
}

(async () => {
  const kids = MODE === 'prod' ? Promise.all([child('dev'), child('restart')]) : null;
  try {
    await wait(300);
    if (MODE === 'prod') await prod(); else if (MODE === 'restart') await restart(); else await dev();
  } catch (e) {
    fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e));
  }
  if (kids) for (const [mode, o] of await kids) {
    const m = /(\d+) نجحت · (\d+) فشلت/.exec(o);
    if (m) { pass += +m[1]; fail += +m[2] } else { fail++; out.push(`  ✗ [${mode}] ما رجع نتيجة`) }
    for (const l of o.split('\n')) if (/✗/.test(l)) out.push(l);
  }
  console.log = realLog;
  if (out.length) console.log(out.join('\n'));
  console.log(`رخص Pushover: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
