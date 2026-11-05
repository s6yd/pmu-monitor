/* ربط تطبيق Pushover عبر السيرفر، والمشتري اللي ما ربط — اختبار سلوكي على السيرفر الحقيقي.
   تذكرة #50 (٥ نوفمبر ٢٠٢٦): مشتري التنبيه الطارئ دفع قبل شهر وما انربط تطبيقه أبداً، فما وصل
   محمد سؤال رخصته (المرشّحون لازم مفتاحهم مربوط) وخلصت تجربة Pushover المجانية بعد ٣٠ يوم — بصمت.
   الربط كان رمزاً في تخزين المتصفح، والرجوع من Pushover لازم يوصل نفس المتصفح وهو مسجّل؛ ورابط الإيصال
   يفتح من تلقرام في متصفحه الداخلي. صار برمز يوقّعه السيرفر، ومحمد يشوف «دفع وما ربط» ويرسل له الرابط.

   يمسك:
   ١) الرجوع يحفظ المفتاح لصاحب الرمز — بلا جلسة ولا تخزين متصفح، ومن أي متصفح.
   ٢) ما أحد يربط مفتاحه بحساب غيره: رمز معدَّل · رمز نوعه غلط · رمز منتهي · مفتاح مو مفتاح.
   ٣) رابط الإيصال يفتح صفحة Pushover على طول (بلا دخول) — وبرمز رجوع لنفس الطالب.
   ٤) المشتري اللي ما ربط يبان في اللوحة برابطه، ورسالة لمحمد مرة وحدة بعد مدة الاسترجاع بزر
      «📩 أرسل له رابط التفعيل» — والطالب ما يوصله شي إلا بضغطته، وضغطة من غير محادثته ما تسوي شي.
   ٥) أول ما يربط: سؤال رخصته يوصل محمد على طول (لا بعد دورة).
   ٦) المفتاح ما يطلع في السجل.

   node tests/test-pushover-link.js [server.js] */
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
const SUB = 'https://pushover.net/subscribe/Jadwalik-test';
const PO_TOKEN = 'aPoTokenForLinkTests000000000X';

/* ═══ القاعدة المزيّفة — نفس سلوك PostgREST في test-po-license ═══ */
const DB = { profiles: [], subscriptions: [], pushover_licenses: [], app_events: [],
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
const TOK = { 'tok-1-aaaaaaaaaaaaaaaaaaaa': uid(1), 'tok-2-aaaaaaaaaaaaaaaaaaaa': uid(2), 'tok-3-aaaaaaaaaaaaaaaaaaaa': uid(3) };
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

/* Pushover المزيّف: الرصيد والإضافة (نفس شكل توثيقهم) */
const PO = { credits: 3, assigns: [] };
function pushover(p, raw) {
  if (p.startsWith('/1/licenses.json')) return [200, { status: 1, credits: PO.credits, request: crypto.randomUUID() }];
  if (p === '/1/licenses/assign.json') {
    PO.assigns.push(raw);
    PO.credits--;
    return [200, { status: 1, credits: PO.credits, request: crypto.randomUUID() }];
  }
  return [200, { status: 1, request: crypto.randomUUID() }];
}

/* تلقرام المزيّف */
const TG = [], EDITS = [];
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

const PORT = 22800 + (process.pid % 100), ADMIN = 'admin-token-for-pushover-link';
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
const state = async () => (await adminCall('/api/admin/po-lic?fresh=1', 'GET')).j || {};
let UPD = 5000;
async function press(chat, data) {
  const id = ++UPD;
  await call('/tg-webhook', 'POST', { update_id: id, callback_query: { id: 'cq' + id,
    from: { id: Number(chat), is_bot: false, first_name: 'x' }, data,
    message: { message_id: 88, chat: { id: Number(chat), type: 'private' }, date: 1, text: '🎟' } } });
  await wait(120);
  return EDITS.filter(e => e.chat_id === String(chat) && e.message_id === 88).pop() || null;
}
const tgTo = (chat, re) => TG.filter(m => m.chat_id === String(chat) && re.test(m.text));
const tokenOf = url => { try { return new URL(url).searchParams.get('t') || '' } catch (e) { return '' } };
const succOf = url => { try { return new URL(url).searchParams.get('success') || '' } catch (e) { return '' } };

/* مشترٍ: ملف + اشتراك مدفوع بالإضافة (paid = أيام من الدفع · gift = هدية) */
let SUBN = 1;
function buyer(n, o) {
  o = Object.assign({ paidDaysAgo: 10, gift: false, key: null, chat: String(7000 + n), until: ahead(200) }, o || {});
  DB.profiles.push({ id: uid(n), email: `b${n}@example.com`, telegram_chat_id: o.chat, is_pro: false,
    pushover_key: o.key, pushover_until: o.until });
  DB.subscriptions.push({ id: SUBN++, user_id: uid(n), term: '202720', includes_term: true, pushover: true,
    status: o.gift ? 'comp' : 'paid', gateway: o.gift ? null : 'edfapay',
    paid_at: o.gift ? null : ago(o.paidDaysAgo), valid_until: ahead(200), created_at: ago(o.gift ? 1 : o.paidDaysAgo) });
  return uid(n);
}

(async () => {
  const U1 = buyer(1);                                   /* دفع قبل ١٠ أيام وما ربط — مثل التذكرة */
  const U2 = buyer(2, { paidDaysAgo: 2 });               /* داخل مدة الاسترجاع وما ربط */
  const U3 = buyer(3, { key: key(3) });                  /* ربط — سؤال رخصته العادي */
  const U4 = buyer(4, { gift: true, chat: null });       /* هدية وما ربط، ومو رابط تلقرام */
  buyer(5, { paidDaysAgo: 300, until: ago(3) });         /* انتهت إضافته */
  DB.subscriptions[4].valid_until = ago(3);
  await wait(500);                                       /* استعادة الحالة: الوضع addon */

  /* ═══ ١) «تفعيل» من الصفحة: رابط برمز رجوع لصاحب الجلسة ═══ */
  eq((await call('/api/me/pushover-start', 'GET')).code, 405, 'pushover-start: POST وحده');
  eq((await call('/api/me/pushover-start', 'POST', {})).code, 401, 'وبلا جلسة: ٤٠١');
  let r = await call('/api/me/pushover-start', 'POST', {}, { Authorization: 'Bearer tok-2-aaaaaaaaaaaaaaaaaaaa' });
  const url = (r.j || {}).url || '';
  ok(r.code === 200 && r.j.ok === true && url.startsWith(SUB + '?success='), '**رابط صفحة الاشتراك في Pushover** — ' + url.slice(0, 60));
  const succ = succOf(url);
  ok(/\/api\/pushover-return\?t=/.test(succ) && tokenOf(succ).startsWith(U2 + '.'),
     '**والرجوع لسيرفرنا برمز صاحب الجلسة** (لا رمز في تخزين المتصفح) — ' + succ.slice(0, 70));
  ok(/\/\?pushover=fail$/.test((() => { try { return new URL(url).searchParams.get('failure') } catch (e) { return '' } })() || ''),
     'ورابط الرفض يرجّعه للموقع برسالة');

  /* ═══ ٢) الرجوع: المفتاح لصاحب الرمز — بلا جلسة ولا كوكي ═══ */
  const back = (t, extra) => call('/api/pushover-return?t=' + encodeURIComponent(t) + (extra || ''), 'GET');
  const T2 = tokenOf(succ);
  r = await back(T2, '&pushover_user_key=' + key(2));
  ok(r.code === 302 && /\/\?pushover=on$/.test(r.loc), '**رجع من Pushover: ٣٠٢ للموقع «🔔 شغّال»** — ' + r.loc);
  eq(DB.profiles.find(p => p.id === U2).pushover_key, key(2),
     '**المفتاح انحفظ في حسابه — من أي متصفح رجع** (كان يلزم نفس المتصفح وهو مسجّل)');
  const parts = (T2 || '').split('.').concat(['', '', '']);    /* القديم ما يرجّع رمزاً */
  r = await back([U1, parts[1], parts[2]].join('.'), '&pushover_user_key=' + 'EVILKEY'.padEnd(30, 'E'));
  ok(/\/\?pushover=bad$/.test(r.loc) && DB.profiles.find(p => p.id === U1).pushover_key === null,
     '**رمز معدَّل (معرّف طالب ثاني): مرفوض — ما أحد يربط مفتاحه بحساب غيره**');
  r = await back([U2, parts[1], parts[2].replace(/^./, c => c === 'A' ? 'B' : 'A')].join('.'), '&pushover_user_key=' + key(9));
  ok(/\/\?pushover=bad$/.test(r.loc) && DB.profiles.find(p => p.id === U2).pushover_key === key(2), 'وتوقيع غلط: مرفوض');
  r = await back(T2, '&pushover_user_key=' + encodeURIComponent('<script>x</script>'));
  ok(/\/\?pushover=fail$/.test(r.loc) && DB.profiles.find(p => p.id === U2).pushover_key === key(2),
     'ومفتاح مو بشكل مفتاح: ما ينحفظ');
  r = await back('', '&pushover_user_key=' + key(9));
  ok(/\/\?pushover=bad$/.test(r.loc), 'وبلا رمز: مرفوض');
  /* رمز منتهي: ساعة السيرفر (نفس العملية) تتقدّم ٣ ساعات */
  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 3600e3;
  r = await back(T2, '&pushover_user_key=' + key(8));
  Date.now = realNow;
  ok(/\/\?pushover=expired$/.test(r.loc) && DB.profiles.find(p => p.id === U2).pushover_key === key(2),
     '**رابط رجوع عمره فوق ساعتين: «انتهى» وما ينحفظ**');
  r = await back(T2, '&pushover_user_key=&pushover_unsubscribed=1&pushover_unsubscribed_user_key=' + key(2));
  ok(/\/\?pushover=off$/.test(r.loc) && DB.profiles.find(p => p.id === U2).pushover_key === null,
     'وألغى الاشتراك من Pushover: المفتاح انمسح');

  /* ═══ ٣) دفع وما ربط: يبان في اللوحة برابط تفعيل ═══ */
  let S = await state();
  const ul = (S.unlinked || []).map(x => x.user).sort();
  eq(ul, [U1, U2, U4].sort(), '**اللوحة: «دفعوا وما ربطوا التطبيق»** — المشتري والهدية، لا المربوط ولا المنتهي');
  const L1 = (S.unlinked || []).find(x => x.user === U1) || {};
  ok(L1.email === 'b1@example.com' && L1.tg === true && /^https:\/\/jadwalik\.com\/api\/pushover-go\?t=/.test(L1.link || ''),
     'ومعه إيميله وهل هو رابط تلقرام ورابط تفعيله — ' + (L1.link || '').slice(0, 50));
  ok(((S.unlinked || []).find(x => x.user === U4) || {}).tg === false, 'والهدية بلا تلقرام: «مو رابط تيليغرام»');
  ok(!JSON.stringify(S).includes(key(3)), 'ولا مفتاح أحد في رد اللوحة');

  /* رابط التفعيل: صفحة Pushover على طول، برمز رجوع لنفس الطالب */
  r = await call('/api/pushover-go?t=' + tokenOf(L1.link), 'GET');
  ok(r.code === 302 && r.loc.startsWith(SUB + '?success=') && tokenOf(succOf(r.loc)).startsWith(U1 + '.'),
     '**رابط التفعيل: صفحة الاشتراك في Pushover على طول — بلا دخول للموقع** — ' + r.loc.slice(0, 50));
  r = await call('/api/pushover-go?t=' + U1 + '.zzz.' + 'A'.repeat(27), 'GET');
  ok(/\/\?pushover=bad$/.test(r.loc), 'ورابط مزوّر: مرفوض');
  r = await back(tokenOf(L1.link), '&pushover_user_key=' + key(1));
  ok(/\/\?pushover=bad$/.test(r.loc) && DB.profiles.find(p => p.id === U1).pushover_key === null,
     'ورمز التفعيل ما يصلح رمز رجوع (نوعه غير)');

  /* ═══ ٤) رسالة لمحمد مرة وحدة بعد مدة الاسترجاع، بزر «📩 أرسل له رابط التفعيل» ═══ */
  const notes = () => tgTo('5555', /اشترى التنبيه الطارئ وما ربط/);
  await adminCall('/api/admin/po-lic-retry', 'POST', {});      /* «▶️ كمّل الحين» = الدورة نفسها */
  await wait(200);
  const n1 = notes().filter(m => m.text.includes('b1@example.com'));
  eq([n1.length, notes().filter(m => m.text.includes('b2@example.com')).length], [1, 0],
     '**رسالة لمحمد عن اللي خلصت مدة استرجاعه وما ربط** — لا عن اللي داخل المدة');
  eq((n1[0] || {}).markup && n1[0].markup.inline_keyboard,
     [[{ text: '📩 أرسل له رابط التفعيل', callback_data: 'pol:link:' + U1 }]], 'بزر «📩 أرسل له رابط التفعيل»');
  ok(notes().some(m => m.text.includes('b4@example.com') && /مو رابط تيليغرام/.test(m.text) && !m.markup),
     'والهدية بلا تلقرام: رسالة بلا زر تقول انسخ الرابط من اللوحة');
  eq(tgTo('7001', /./).length, 0, '**والطالب ما يوصله شي قبل ضغطتك**');
  ok(tgTo('5555', /طالب يستحق رخصة Pushover/).some(m => m.text.includes('b3@example.com')),
     'والمربوط يوصلك سؤال رخصته كالعادة');
  await adminCall('/api/admin/po-lic-retry', 'POST', {});
  await wait(200);
  eq(notes().filter(m => m.text.includes('b1@example.com')).length, 1, 'ودورة ثانية ما تكرر الرسالة');
  const saved = (DB.app_state.find(x => x.key === 'runtime') || { value: {} }).value;
  ok(JSON.stringify(((saved.toggles || {}).poLicNoted) || []).includes(U1),
     'واللي قلنا لك عنه ينحفظ مع الحالة — النشر ما يكرره');

  /* الزر: من غير محادثتك ما يسوي شي، ومنك يرسل له الرابط */
  await press('7001', 'pol:link:' + U1);
  eq(tgTo('7001', /فعّل التنبيه الطارئ/).length, 0, 'ضغطة من غير محادثة الإدارة: ما وصله شي');
  const e1 = await press('5555', 'pol:link:' + U1);
  const m1 = tgTo('7001', /فعّل التنبيه الطارئ/)[0] || { text: '' };
  ok(/\/api\/pushover-go\?t=/.test(m1.text) && /رخصة التطبيق علينا/.test(m1.text) && /لا تدفع/.test(m1.text),
     '**ضغطتك: وصله رابط التفعيل على تلقرام، و«الرخصة علينا — لا تدفع»**');
  ok(e1 && /أرسلنا له رابط التفعيل/.test(e1.text) && e1.text.includes('b1@example.com'),
     'ورسالتك صارت «📩 أرسلنا له رابط التفعيل» بإيميله — ' + (e1 && e1.text || '').slice(0, 60));

  /* ═══ ٥) يضغط الرابط ويوافق: انربط، وسؤال رخصته يوصلك على طول ═══ */
  const link1 = (m1.text.match(/https:\/\/jadwalik\.com\/api\/pushover-go\?t=\S+/) || [''])[0];
  r = await call('/api/pushover-go?t=' + tokenOf(link1), 'GET');
  const ret1 = tokenOf(succOf(r.loc));
  const asksBefore = tgTo('5555', /طالب يستحق رخصة Pushover/).filter(m => m.text.includes('b1@example.com')).length;
  r = await back(ret1, '&pushover_user_key=' + key(1));
  await wait(400);
  ok(/\/\?pushover=on$/.test(r.loc) && DB.profiles.find(p => p.id === U1).pushover_key === key(1),
     '**ضغط الرابط من تلقرام ووافق: انربط** — بلا دخول للموقع');
  eq([asksBefore, tgTo('5555', /طالب يستحق رخصة Pushover/).filter(m => m.text.includes('b1@example.com')).length], [0, 1],
     '**وسؤال رخصته وصلك على طول** («✅ أضف الرخصة») — لا بعد دورة الخمس دقائق');
  eq(PO.assigns.length, 0, 'ولا رخصة انضافت قبل ضغطتك');
  S = await state();
  ok(!(S.unlinked || []).some(x => x.user === U1), 'وطلع من «ما ربطوا» في اللوحة');

  /* من اللوحة: الزر نفسه — وبلا تلقرام يرجّع الرابط تنسخه */
  r = await adminCall('/api/admin/po-lic-link', 'POST', { userId: U4 });
  ok(r.j && r.j.ok === false && /مو رابط تيليغرام/.test(r.j.error || '') && /pushover-go\?t=/.test(r.j.link || ''),
     'اللوحة: بلا تلقرام ⇒ «أرسل له الرابط بنفسك» ومعه الرابط');
  r = await adminCall('/api/admin/po-lic-link', 'POST', { userId: U3 });
  ok(r.j && r.j.ok === false && /ربط التطبيق من قبل/.test(r.j.error || ''), 'والمربوط: «ربط التطبيق من قبل» — ما نرسل له');
  eq((await call('/api/admin/po-lic-link', 'POST', { userId: U4 })).code, 401, 'والنقطة برمز اللوحة وحده');

  /* ═══ ٦) الوضع مطفأ: لا رابط ولا ربط ═══ */
  await adminCall('/api/admin/pushover-mode', 'POST', { mode: 'off' });
  r = await call('/api/pushover-go?t=' + tokenOf(L1.link), 'GET');
  ok(/\/\?pushover=closed$/.test(r.loc), 'Pushover مطفأ: رابط التفعيل يقول «مو متاح الحين»');
  r = await call('/api/me/pushover-start', 'POST', {}, { Authorization: 'Bearer tok-2-aaaaaaaaaaaaaaaaaaaa' });
  ok(r.j && r.j.ok === false && r.j.why === 'off', 'و«تفعيل» يرد «مطفأ»');

  ok(!LOGS.some(l => [1, 2, 3, 8, 9].some(n => l.includes(key(n)))), '**ولا مفتاح طالب في السجل**');

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + (e && e.stack || e)); process.exit(1) });
