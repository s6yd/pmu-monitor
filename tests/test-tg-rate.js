/* تقييم المساعد في البوت — الدفعة الثانية من طلب محمد (١٨ نوفمبر ٢٠٢٦: «ودي الي يستعمل المساعد يجيه تقييم سريع
   بعد المحادثه»). الموقع يسأل لما يقفل اللوح (test-ai-rate)، والبوت لما يضغط «🚪 خروج» بعد جواب.
   السيرفر الحقيقي، وتحديثات تيليغرام على /tg-webhook بشكلها، و https.request محاكٍ (القاعدة · تيليغرام · النموذج).

   أخطار يمسكها:
   ١) يخرج بعد جواب وما يجيه سؤال — أو يجيه بلا جواب أصلاً.
   ٢) 👎 ما يوصل، أو صاحبه غلط، أو قناته «الموقع»، أو بلا الأدوات وعدد الأسئلة.
   ٣) السبب ما يرتبط بتقييمه، أو ضغطتان تكتبان مرتين.
   ٤) يسأله كل مرة (مرة باليوم).
   ٥) محادثة انتهت لحالها (٢٠ دقيقة) تنضم للي بعدها.
   ٦) زر مزوّر يكتب شي، أو سبب برقم تقييم غيره يلحقه في اللوحة.
   ٧) الزائر (غير المربوط) ما يقدر يقيّم — أو ينحسب على أحد.

   node tests/test-tg-rate.js [server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ساعة السيرفر (نفس العملية): نقدّمها لين ينتهي وضع المساعد لحاله */
const realNow = Date.now;
let SHIFT = 0;
Date.now = () => realNow() + SHIFT;

/* ═══ القاعدة المزيّفة — تطابق PostgREST: الفلاتر، القصّ عند ١٠٠٠، Prefer في الترويسة ═══ */
const UA = 'a1111111-1111-4111-8111-111111111111', UB = 'b2222222-2222-4222-8222-222222222222';
const OWN = 'c3333333-3333-4333-8333-333333333333';
const prof = (id, chat) => ({ id, email: id.slice(0, 4) + '@x.com', name: 'Name ' + id.slice(0, 4), major: 'MEEN',
  plan_ver: 'new', prep: false, is_pro: false, subscription_expires_at: null, telegram_chat_id: chat,
  telegram_username: 'user_' + chat });
const DB = {
  profiles: [prof(OWN, '5555'), prof(UA, '7101'), prof(UB, '7103')],
  tickets: [], ticket_messages: [], app_events: [], app_state: [],
  ai_usage: [], ai_threads: [], completed_courses: [], user_schedule: [],
};
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
  if (ord) { const [col, dir] = ord.split(',')[0].split('.');
    r.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)) }
  r = r.slice(0, P.get('limit') ? Number(P.get('limit')) : 1000);
  const sel = P.get('select');
  if (sel && sel !== '*') { const cols = sel.split(','); r = r.map(x => Object.fromEntries(cols.map(c => [c, x[c]]))) }
  return r;
}
function supabase(method, urlPath, body, prefer) {
  const [p, qs = ''] = urlPath.split('?');
  const table = p.replace('/rest/v1/', '');
  const L = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer || '');
  if (method === 'GET') return [200, filt(L, qs)];
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') { const i = L.findIndex(x => x.key === b.key); if (i >= 0) L[i] = b; else L.push(b); return [201, []] }
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign({ id: L.length + 1, created_at: new Date().toISOString() }, x));
    L.push(...rows);
    return [201, rep ? rows : []];
  }
  if (method === 'PATCH') { const b = JSON.parse(body || '{}'); const hit = filt(L, qs); hit.forEach(r => Object.assign(r, b));
    return [200, rep ? hit : []] }
  return [200, []];
}

/* ═══ تيليغرام والنموذج المزيّفان ═══ */
const TG = [];
let BOT_MID = 70000;
const AI = [];
/* النموذج: «أداة:<اسمها>» في السؤال ⇒ يطلبها بنفس شكل الحقيقي، وبعدها يجاوب */
function fakeModel(b) {
  const msgs = b.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const usage = { input_tokens: 100, output_tokens: 20 };
  const say = t => ({ id: 'msg_1', type: 'message', role: 'assistant', model: b.model,
    content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage });
  if (Array.isArray(last.content) && last.content.some(c => c.type === 'tool_result')) return say('جوابك بعد الأداة');
  const q = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  AI.push(q);
  const m = /أداة:([a-z_]+)/.exec(q);
  if (m) return { id: 'msg_t', type: 'message', role: 'assistant', model: b.model,
    content: [{ type: 'tool_use', id: 'tu_' + AI.length, name: m[1], input: {} }], stop_reason: 'tool_use', usage };
  return say('جواب المساعد عن سؤالك');
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
      let code = 200, o = [];
      const body = chunks.join('');
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body || '{}') } catch (e) {}
        const method = String(opts.path || '').split('/').pop();
        TG.push({ method, b, mid: BOT_MID + 1 });
        o = { ok: true, result: { message_id: ++BOT_MID, date: Math.floor(Date.now() / 1000),
              chat: { id: Number(b.chat_id) }, text: b.text || '' } };
      } else if (host === 'api.anthropic.com') {
        let b = {}; try { b = JSON.parse(body || '{}') } catch (e) {}
        o = fakeModel(b);
      } else if (host.includes('pmu.edu.sa')) o = [];
      else [code, o] = supabase(opts.method, opts.path, body,
        (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '');
      const txt = JSON.stringify(o);
      const res = new Readable({ read() { this.push(txt); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 24400 + (process.pid % 100);
Object.assign(process.env, {
  SITE_ENV: 'prod', PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests',
  ADMIN_CHAT_ID: '5555', TELEGRAM_TOKEN: 'tg', ANTHROPIC_API_KEY: 'sk-test-key',
  ACTIVE_TERM: '203010', FREE_BETA: 'true', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k',
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(method, p, { body, admin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = {};
    if (data) h['Content-Type'] = 'application/json';
    if (admin) h['X-Admin-Token'] = 'admin-token-for-tests';
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, res => {
      let o = ''; res.setEncoding('utf8'); res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end(data || undefined);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ تحديثات تيليغرام كما يرسلها ═══ */
let UPD = 1, MID = 1000;
const now = () => Math.floor(Date.now() / 1000);
const from = chat => ({ id: Number(chat), is_bot: false, first_name: 'S', username: 's_' + chat });
async function say(chat, text) {
  const message = { message_id: ++MID, date: now(), chat: { id: Number(chat), type: 'private' }, from: from(chat), text };
  await call('POST', '/tg-webhook', { body: { update_id: ++UPD, message } });
  await wait(30);
  return message;
}
async function press(chat, data, botMid) {
  await call('POST', '/tg-webhook', { body: { update_id: ++UPD, callback_query: {
    id: 'cq' + UPD, from: from(chat), chat_instance: 'ci', data,
    message: { message_id: botMid, date: now(), chat: { id: Number(chat), type: 'private' },
               from: { id: 1, is_bot: true, first_name: 'Jadwalik' }, text: '…' } } } });
  await wait(60);
}
const since = n => TG.slice(n);
const sentTo = (list, chat) => list.filter(c => c.method === 'sendMessage' && String(c.b.chat_id) === String(chat));
const datas = c => (((c && c.b.reply_markup && c.b.reply_markup.inline_keyboard) || [])
  .reduce((a, row) => a.concat(row), [])).map(x => x.callback_data);
const rateMsg = list => list.find(c => c.method === 'sendMessage' && /أفادك Jadwalik AI/.test(c.b.text || ''));
const evs = () => DB.app_events.filter(x => x.kind === 'ai_rate').map(x => x.payload || {});

async function main() {
  await wait(300);
  let r = await call('POST', '/api/admin/ai', { admin: true, body: { mode: 'all' } });
  eq(r.j && r.j.mode, 'all', 'المساعد مفتوح للكل');

  /* ── ١) مربوط: سؤالان (واحد بأداة) ثم «🚪 خروج» ⇒ يجيه سؤال «أفادك؟» ── */
  await say('7101', '/ai');
  await say('7101', 'أداة:my_day وش عندي بكرة؟');
  await say('7101', 'وبعد بكرة؟');
  eq(AI.length, 2, 'سأل المساعد مرتين وجاوبه');
  let n = TG.length;
  await say('7101', '🚪 خروج');
  const mine = sentTo(since(n), '7101');
  const bye = mine.find(c => /خرجت من المساعد/.test(c.b.text || ''));
  const ask = rateMsg(mine);
  ok(!!bye && bye.b.reply_markup && bye.b.reply_markup.remove_keyboard === true, 'رسالة الخروج كما هي (تشيل لوحة الوضع)');
  ok(!!ask && mine.indexOf(ask) > mine.indexOf(bye),
     '**وبعدها رسالة «أفادك Jadwalik AI في هالمحادثة؟»** — ' + JSON.stringify(mine.map(c => (c.b.text || '').slice(0, 30))));
  eq(datas(ask), ['air:up', 'air:down'], '**بزرّين: 👍 أفادني · 👎 ما أفادني**');
  eq(evs().length, 0, 'وما ينكتب شي قبل ما يضغط');

  /* ── ٢) 👎 ⇒ ينكتب على طول، والرسالة تصير «وش كان ناقص؟» بأسبابها ── */
  n = TG.length;
  await press('7101', 'air:down', ask && ask.mid);
  let e = evs().filter(p => p.stage === 'rate');
  const e1 = e[0] || {};
  ok(e.length === 1 && e1.rate === 'down' && e1.user === UA && e1.ch === 'tg' && e1.env === 'prod' && e1.turns === 2,
     '**👎 ينكتب: صاحبه من ربط المحادثة · القناة تلقرام · سؤالان** — ' + JSON.stringify(e1));
  eq(e1.tools, ['my_day'], '**والأدوات اللي اشتغلت في المحادثة**');
  ok(since(n).some(c => c.method === 'answerCallbackQuery'), 'والضغطة يُرد عليها (يوقف مؤشر التحميل)');
  const ed = since(n).find(c => c.method === 'editMessageText');
  const EV = e1.ev || '';
  ok(!!ed && ed.b.message_id === (ask && ask.mid) && /وش كان ناقص/.test(ed.b.text || ''),
     '**ونفس الرسالة تصير «وش كان ناقص؟»**');
  eq(datas(ed), ['airw:' + EV + ':wrong', 'airw:' + EV + ':misread', 'airw:' + EV + ':cant',
                 'airw:' + EV + ':slow', 'airw:' + EV + ':skip'],
     '**بالأسباب الأربعة و«بس كذا» — ورقم التقييم في كل زر** (ينفع بعد نشر يمسح الذاكرة)');
  ok(datas(ed).every(d => d.length <= 64), 'وكل زر داخل حد تيليغرام (٦٤ بايت)');

  /* ضغطة ثانية على نفس الزر: ما تكتب */
  await press('7101', 'air:down', ask && ask.mid);
  await press('7101', 'air:up', ask && ask.mid);
  eq(evs().filter(p => p.stage === 'rate').length, 1, '**ضغطة ثانية (أو الزر الثاني) ما تكتب تقييماً ثانياً**');

  /* السبب: بنفس الرقم، والرسالة تصير شكراً بلا أزرار */
  n = TG.length;
  await press('7101', 'airw:' + EV + ':wrong', ask && ask.mid);
  const w = evs().filter(p => p.stage === 'why');
  ok(w.length === 1 && w[0].ev === EV && w[0].why === 'wrong' && w[0].user === UA && w[0].ch === 'tg',
     '**السبب ينكتب بنفس رقم التقييم وباسم صاحبه** — ' + JSON.stringify(w[0] || null));
  const th = since(n).find(c => c.method === 'editMessageText') || { b: {} };
  ok(/شكراً/.test(th.b.text || '') && !th.b.reply_markup, '**وشكراً — والأزرار تنشال**');
  await press('7101', 'airw:' + EV + ':slow', ask && ask.mid);
  eq(evs().filter(p => p.stage === 'why').length, 1, 'وسبب ثانٍ على نفس الرسالة ما ينكتب');

  /* ── ٣) مرة باليوم: محادثة ثانية بنفس اليوم ما تسأل ── */
  await say('7101', '/ai');
  await say('7101', 'كم غياب باقي لي؟');
  n = TG.length;
  await say('7101', '🚪 خروج');
  ok(!rateMsg(sentTo(since(n), '7101')), '**مرة باليوم: المحادثة الثانية ما تسأل**');

  /* ── ٤) خروج بلا جواب: ما فيه محادثة يقيّمها ── */
  await say('7103', '/ai');
  n = TG.length;
  await say('7103', '🚪 خروج');
  ok(sentTo(since(n), '7103').some(c => /خرجت/.test(c.b.text || '')) && !rateMsg(sentTo(since(n), '7103')),
     '**خرج بلا ما يسأل: ما نسأله**');

  /* ── ٥) محادثة انتهت لحالها ما تنضم للي بعدها ── */
  await say('7103', '/ai');
  await say('7103', 'سؤال أول');
  await say('7103', 'سؤال ثانٍ');
  SHIFT += 21 * 60 * 1000;                                  /* الوضع انتهى بلا خروج (٢٠ دقيقة) */
  await say('7103', '/ai سؤال بعد ما انتهى');               /* محادثة جديدة: جواب واحد */
  n = TG.length;
  await say('7103', '🚪 خروج');
  const askB = rateMsg(sentTo(since(n), '7103'));
  ok(!!askB, 'الخروج بعد جواب يسأل');
  await press('7103', 'air:up', askB && askB.mid);
  const eb = evs().filter(p => p.stage === 'rate' && p.user === UB);
  ok(eb.length === 1 && eb[0].rate === 'up' && eb[0].turns === 1,
     '**المحادثة اللي انتهت لحالها ما تنحسب على الجديدة** — سؤال واحد لا ثلاثة: ' + JSON.stringify(eb[0] || null));
  const thB = TG.slice(n).find(c => c.method === 'editMessageText' && c.b.message_id === (askB && askB.mid)) || { b: {} };
  ok(/شكراً/.test(thB.b.text || '') && !thB.b.reply_markup, '👍 شكراً على طول بلا أسباب');

  /* ── ٦) أزرار مزوّرة: ما تكتب — وسبب برقم تقييم غيره ينكتب باسمه هو وما يلحق تقييم الأول ── */
  const before = evs().length;
  await press('7103', 'airw:zzzzzzzzzzzz:wrong', 99001);
  await press('7103', 'airw:' + EV + ':hack', 99002);
  await press('7103', 'air:maybe', 99003);
  eq(evs().length, before, '**أزرار مزوّرة (رقم مو بشكله · سبب مو من القائمة · تقييم غريب) ما تكتب شي**');
  await press('7103', 'airw:' + EV + ':slow', 99004);
  const forged = evs().filter(p => p.stage === 'why' && p.user === UB);
  ok(forged.length === 1 && forged[0].ev === EV, 'سبب برقم تقييم غيره ينكتب — باسم اللي ضغطه');

  /* ── ٧) الزائر (غير مربوط): يقيّم، وبلا صاحب ── */
  await say('7102', '/ai');
  await say('7102', 'كيف أراقب شعبة؟');
  n = TG.length;
  await say('7102', '🚪 خروج');
  const askG = rateMsg(sentTo(since(n), '7102'));
  ok(!!askG, '**الزائر يجيه السؤال كذلك** (يستعمل المساعد في استعمال الموقع)');
  await press('7102', 'air:down', askG && askG.mid);
  const eg = evs().filter(p => p.stage === 'rate' && p.user === null);
  ok(eg.length === 1 && eg[0].rate === 'down' && eg[0].ch === 'tg' && eg[0].turns === 1,
     '**تقييم الزائر بلا صاحب** — ' + JSON.stringify(eg[0] || null));

  /* ── ٨) اللوحة: تلقرام في قناته، والسبب المزوّر ما يلحق ── */
  r = await call('GET', '/api/admin/ai-rate', { admin: true });
  const S = (r.j && r.j.summary) || {};
  ok(S.ch && S.ch.tg && S.ch.tg.up === 1 && S.ch.tg.down === 2 && S.ch.web && S.ch.web.up === 0,
     '**اللوحة: تقييمات تلقرام في قناتها** — ' + JSON.stringify(S.ch));
  eq(S.reasons, { wrong: 1 }, 'وأسباب 👎 — بلا السبب المزوّر');
  const rowA = ((r.j && r.j.recent) || []).find(x => x.user === UA) || {};
  ok(rowA.why === 'wrong' && rowA.ch === 'tg' && rowA.email === 'a111@x.com', 'سطر الطالب: سببه هو وقناته وإيميله — ' + JSON.stringify(rowA));
}

main().catch(e => ok(false, 'انهار: ' + (e && e.stack || e))).finally(() => {
  console.log = realLog;
  Date.now = realNow;
  out.forEach(l => realLog(l));
  realLog(`\nتقييم المساعد في البوت: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
});
