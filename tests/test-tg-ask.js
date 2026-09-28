/* الكلام الحر في البوت: للمساعد ولا للفريق؟ — اختبار سلوكي على السيرفر الحقيقي.
   السيرفر يشتغل فعلاً، ونرسل له تحديثات تيليغرام على /tg-webhook بنفس
   شكلها، و https.request محاكٍ يلعب دور Supabase وتيليغرام والنموذج.

   المشكلة (قرار محمد): الكلام الحر كله كان يوصل محمد كتذكرة، وأغلب
   التذاكر صارت أسئلة للمساعد («جدول الترم» · «كم باقيلي واتخرج؟») أو
   حرفاً واحداً — والطالب يستلم «رقم تذكرتك» بدل جواب.

   أخطار يمسكها:
   ١) كلام حر جديد يصير تذكرة بلا ما يختار الطالب.
   ٢) الزر يضيّع النص (يطلب منه يكتبه ثانية)، أو ضغطتان ترسلانه مرتين.
   ٣) محادثة جارية مع الفريق ينقطع وعدها بسؤال: ردّنا يقول «اكتب هنا مباشرة».
   ٤) غير المربوط يُعرض عليه المساعد وهو ما يجاوبه — زر لطريق مسدود.
   ٥) المساعد مقفل (off · admin) ونعرضه — كذلك طريق مسدود.
   ٦) النشر يمسح الذاكرة فيضيع النص — نقرأه من رسالته اللي رددنا عليها.
   ٧) الصورة تروح للمساعد وهو ما يقرأ الصور.
   ٨) تيليغرام يرفض رسالة الزرّين فتضيع رسالة الطالب — ترجع تذكرة كالسابق.

   node tests/test-tg-ask.js [server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const out = [];

/* ═══ القاعدة المزيّفة — تطابق PostgREST: الفلاتر، القصّ عند ١٠٠٠،
   Prefer في الترويسة ═══ */
const prof = (id, chat, extra) => Object.assign({ id, email: id + '@x.com',
  name: 'Name ' + id, major: 'COSC', plan_ver: 'new', prep: false, is_pro: false,
  subscription_expires_at: null, telegram_chat_id: chat,
  telegram_username: 'user_' + id }, extra || {});
const DB = {
  profiles: [
    prof('u-own', '5555'),                     /* صاحب الموقع = ADMIN_CHAT_ID */
    ...['6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108', '6109', '6110', '6111',
        '6112', '6113', '6114', '6115', '6116']
      .map(c => prof('u-' + c, c)),
  ],
  tickets: [], ticket_messages: [], app_state: [], app_events: [],
  ai_usage: [], ai_threads: [], completed_courses: [], user_schedule: [],
};
const NEXT = { tickets: 80, ticket_messages: 900 };

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
    const m = /^(eq|neq|is|in|lt|gt|lte|gte|ilike)\.(.*)$/.exec(v);
    if (!m) continue;
    if (m[1] === 'ilike') r = r.filter(x => String(x[k] || '').toLowerCase() === m[2].toLowerCase());
    else r = r.filter(x => cmp(x[k], m[1], m[2]));
  }
  const ord = P.get('order');
  if (ord) {
    const [col, dir] = ord.split(',')[0].split('.');
    r.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return r.slice(0, P.get('limit') ? Number(P.get('limit')) : 1000);
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
      table === 'tickets' ? { status: 'open', updated_at: new Date().toISOString() } : {}, x));
    L.push(...rows);
    return [201, rep ? rows.map(r => Object.assign({}, r)) : []];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(L, qs);
    hit.forEach(r => Object.assign(r, b));
    return [200, rep ? hit.map(r => Object.assign({}, r)) : []];
  }
  if (method === 'DELETE') return [200, []];
  return [200, []];
}

/* ═══ تيليغرام والنموذج المزيّفان ═══ */
const TG = [];                 /* كل نداء: { method, b } */
let BOT_MID = 50000;           /* أرقام رسائل البوت */
const AI = [];                 /* كل سؤال وصل النموذج */
const REJECT_ASK = new Set();  /* محادثات يرفض فيها تيليغرام رسالة الزرّين */
/* النموذج المزيّف: يطلب أداة لو السؤال فيه «أداة:<اسمها> {وسائطها}» — بنفس
   الشكل اللي يطلبها به الحقيقي — ويجاوب نصاً بعد ما ترجع نتيجتها.
   AI = أسئلة الطلاب وحدها (بلا جولات الأدوات)، AI_RES = نتائج الأدوات. */
const AI_RES = [];
function fakeModel(b) {
  const msgs = b.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const usage = { input_tokens: 100, output_tokens: 20 };
  const say = t => ({ id: 'msg_1', type: 'message', role: 'assistant', model: b.model,
    content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage });
  if (Array.isArray(last.content) && last.content.some(c => c.type === 'tool_result')) {
    last.content.filter(c => c.type === 'tool_result').forEach(c =>
      AI_RES.push(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)));
    return say('جهّزتها لك — اضغط الزر تحت');
  }
  const q = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  AI.push(q);
  const m = /أداة:([a-z_]+)(\s+\{[^\n]*\})?/.exec(q);
  if (m) return { id: 'msg_t', type: 'message', role: 'assistant', model: b.model,
    content: [{ type: 'tool_use', id: 'tu_' + AI.length, name: m[1],
                input: m[2] ? JSON.parse(m[2].trim()) : {} }],
    stop_reason: 'tool_use', usage };
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
        TG.push({ method, b });
        if (REJECT_ASK.has(String(b.chat_id)) && b.reply_parameters) {
          ++BOT_MID; code = 400;
          o = { ok: false, error_code: 400, description: 'Bad Request: rejected in test' };
        } else
        o = { ok: true, result: { message_id: ++BOT_MID, date: Math.floor(Date.now() / 1000),
              chat: { id: Number(b.chat_id) }, text: b.text || '' } };
      } else if (host === 'api.anthropic.com') {
        let b = {}; try { b = JSON.parse(body || '{}') } catch (e) {}
        o = fakeModel(b);
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

const PORT = 47900 + (process.pid % 100);
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
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end(data || undefined);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ تحديثات تيليغرام كما يرسلها ═══ */
let UPD = 1, MID = 1000;
const now = () => Math.floor(Date.now() / 1000);
const from = chat => ({ id: Number(chat), is_bot: false, first_name: 'Sara', username: 'sara_' + chat });
async function say(chat, text, extra) {
  const message = Object.assign({ message_id: ++MID, date: now(),
    chat: { id: Number(chat), type: 'private' }, from: from(chat), text }, extra || {});
  await call('POST', '/tg-webhook', { body: { update_id: ++UPD, message } });
  return message;
}
/* ضغطة زر: تيليغرام يرسل رسالة البوت كاملة — وهي ردّ على رسالة الطالب،
   فيرجّع رسالة الطالب داخلها (reply_to_message) */
async function press(chat, data, botMsg) {
  await call('POST', '/tg-webhook', { body: { update_id: ++UPD, callback_query: {
    id: 'cq' + UPD, from: from(chat), chat_instance: 'ci', data, message: botMsg } } });
}
/* رسالة الأزرار كما تصل للطالب — من نداء sendMessage اللي سجّلناه */
function botMsgOf(call, studentMsg) {
  return { message_id: call.mid, date: now(), chat: { id: Number(call.b.chat_id), type: 'private' },
    from: { id: 1, is_bot: true, first_name: 'Jadwalik' }, text: call.b.text,
    reply_to_message: studentMsg };
}

const since = n => TG.slice(n);
const sentTo = (list, chat) => list.filter(c => c.method === 'sendMessage' && String(c.b.chat_id) === String(chat));
const btns = c => ((c && c.b.reply_markup && c.b.reply_markup.inline_keyboard) || [])
  .reduce((a, row) => a.concat(row), []);
const datas = c => btns(c).map(x => x.callback_data);
const tickets = () => DB.tickets.length;
const msgsOf = id => DB.ticket_messages.filter(m => m.ticket_id === id);
const ticketOf = chat => DB.tickets.find(t => String(t.chat_id) === String(chat));
/* رقم رسالة البوت: ترتيبها في السجل يطابق عدّاد المحاكي */
TG.push = function (x) { x.mid = BOT_MID + 1; return Array.prototype.push.call(this, x) };

async function main() {
  await wait(300);
  let r = await call('POST', '/api/admin/ai', { admin: true, body: { mode: 'all' } });
  eq(r.j && r.j.mode, 'all', 'المساعد مفتوح للكل');

  /* ── ١) كلام حر جديد من مربوط: يُسأل، ما يصير تذكرة ── */
  let n = TG.length;
  const m1 = await say('6101', 'جدول الترم');
  let mine = sentTo(since(n), '6101');
  eq(mine.length, 1, 'رد واحد على الطالب');
  const chooser = mine[0] || { b: {} };
  eq(datas(chooser), ['ask:ai:' + m1.message_id, 'ask:team:' + m1.message_id],
     '**زرّان: المساعد والفريق — بدل تذكرة**');
  ok(/المساعد/.test(chooser.b.text || '') && /فريق جدولك/.test(chooser.b.text || ''),
     'ونصه يشرح الاثنين');
  eq(chooser.b.reply_parameters && chooser.b.reply_parameters.message_id, m1.message_id,
     'والسؤال ردّ على رسالته نفسها — يعرف أي رسالة نقصد');
  eq(tickets(), 0, '**وما انفتحت تذكرة**');
  eq(sentTo(since(n), '5555').length, 0, '**ولا وصل محمد شي**');
  eq(AI.length, 0, 'ولا سألنا النموذج قبل ما يختار');

  /* ── ٢) يختار المساعد: نفس النص، بلا ما يكتبه ثانية ── */
  n = TG.length;
  await press('6101', 'ask:ai:' + m1.message_id, botMsgOf(chooser, m1));
  eq(AI.length, 1, '**الزر يسأل النموذج مرة**');
  ok(/جدول الترم/.test(AI[0] || ''), '**بنفس رسالته** — ما يكتبها مرة ثانية');
  const ans = sentTo(since(n), '6101');
  ok(ans.some(c => /جواب المساعد/.test(c.b.text || '')), 'ويوصله الجواب');
  /* ملاحظة محمد: يعرف إنه يسأل أي شي، وإن جوابه من اللي عبّاه — ما شاف مقدمة /ai */
  const first = ans.find(c => /جواب المساعد/.test(c.b.text || '')) || { b: {} };
  ok(/💡/.test(first.b.text || '') && /أي شي/.test(first.b.text || '')
     && /أمثلة/.test(first.b.text || '') && /عبّيته/.test(first.b.text || ''),
     '**أول جواب: «اسألني أي شي — الأزرار أمثلة» ومن وين بياناته**');
  ok(ans.some(c => c.b.reply_markup && Array.isArray(c.b.reply_markup.keyboard)),
     'والجواب يدخله وضع المساعد — لوحته تبان');
  const ed = since(n).find(c => c.method === 'editMessageText');
  ok(!!ed && ed.b.message_id === chooser.mid, 'ورسالة الزرّين تتعدّل');
  ok(ed && !ed.b.reply_markup, 'وتنشال أزرارها — ما تنضغط مرة ثانية');
  ok(since(n).some(c => c.method === 'answerCallbackQuery'), 'والضغطة يُرد عليها (يوقف مؤشر التحميل)');
  eq(tickets(), 0, 'ولا تذكرة');

  /* ── ٣) ضغطة ثانية (أو الزر الثاني) ما تعيد ── */
  n = TG.length;
  await press('6101', 'ask:ai:' + m1.message_id, botMsgOf(chooser, m1));
  await press('6101', 'ask:team:' + m1.message_id, botMsgOf(chooser, m1));
  eq(AI.length, 1, '**ضغطة ثانية ما تسأل النموذج مرة ثانية**');
  eq(tickets(), 0, '**ولا الزر الثاني يفتح تذكرة بعد ما اختار**');
  eq(sentTo(since(n), '6101').length, 0, 'ولا رسالة زائدة');

  /* ── ٤) داخل وضع المساعد: كلامه للمساعد بلا سؤال ── */
  n = TG.length;
  await say('6101', 'وبكرة؟');
  eq(AI.length, 2, 'داخل الوضع: للمساعد مباشرة');
  eq(datas(sentTo(since(n), '6101')[0]), [], 'بلا زرّين');
  ok(!/💡/.test((sentTo(since(n), '6101')[0] || { b: {} }).b.text || ''),
     'والسطر ما يتكرر في كل جواب');

  /* والخروج: رسالته الجاية نسأله عنها من جديد */
  n = TG.length;
  await say('6101', '🚪 خروج');
  const bye = sentTo(since(n), '6101')[0] || { b: {} };
  ok(bye.b.reply_markup && bye.b.reply_markup.remove_keyboard === true, 'الخروج يشيل اللوحة');
  ok(!/يوصل الدعم/.test(bye.b.text || ''), '**ورسالة الخروج ما توعده بالدعم مباشرة** — صار يُسأل');
  n = TG.length;
  const m1b = await say('6101', 'سؤال بعد الخروج');
  eq(datas(sentTo(since(n), '6101')[0]), ['ask:ai:' + m1b.message_id, 'ask:team:' + m1b.message_id],
     '**وبعد الخروج: يُسأل من جديد** — لا تذكرة ولا مساعد');
  eq(tickets(), 0, 'ولا تذكرة');

  /* ── ٥) يختار الفريق: تذكرة كاملة كالسابق ── */
  n = TG.length;
  const m2 = await say('6102', 'عندي مشكلة: الخطة فيها غلط في BUSI 3313');
  const ch2 = sentTo(since(n), '6102')[0] || { b: {} };
  n = TG.length;
  await press('6102', 'ask:team:' + m2.message_id, botMsgOf(ch2, m2));
  const t2 = ticketOf('6102');
  ok(!!t2, '**زر الفريق يفتح تذكرة**');
  eq(t2 && msgsOf(t2.id).map(m => m.body), ['عندي مشكلة: الخطة فيها غلط في BUSI 3313'],
     '**بنص رسالته كما هو**');
  const adm = sentTo(since(n), '5555')[0] || { b: {} };
  ok(/الخطة فيها غلط/.test(adm.b.text || '') && /#u6102/.test(adm.b.text || ''),
     '**ومحمد يوصله النص وبصمة الطالب** — يقدر يرد عليه');
  ok(sentTo(since(n), '6102').some(c => /رقم تذكرتك/.test(c.b.text || '')),
     'والطالب يستلم رقم تذكرته');
  eq(AI.length, 2, 'وما سألنا النموذج');
  ok(since(n).some(c => c.method === 'editMessageText' && !c.b.reply_markup),
     'وأزرار السؤال تنشال');

  /* وكلامه بعدها مباشرة للفريق — «طيب» ما نرجع نسأله عنها */
  n = TG.length;
  await say('6102', 'طيب');
  eq(t2 && msgsOf(t2.id).length, 2, '**رسالته الجاية تلتصق بنفس التذكرة**');
  eq(datas(sentTo(since(n), '6102')[0]), [], 'بلا زرّين');
  ok(sentTo(since(n), '5555').length === 1, 'ومحمد يوصله');

  /* ── ٦) ردّنا عليه: «اكتب رسالتك هنا مباشرة» — وعد ما ينكسر ── */
  /* صورة من الطالب: للفريق مباشرة — المساعد ما يقرأ الصور */
  n = TG.length;
  await say('6103', undefined, { caption: 'شوف الخطأ', photo: [{ file_id: 'ph-1', width: 90, height: 90 }] });
  const t3 = ticketOf('6103');
  ok(!!t3, '**الصورة تروح للفريق مباشرة**');
  eq(datas(sentTo(since(n), '6103')[0]), [], 'بلا زرّين');
  ok(since(n).some(c => c.method === 'sendPhoto' && String(c.b.chat_id) === '5555'), 'ومحمد يوصله الصورة');
  eq(AI.length, 2, 'وما راحت للنموذج');
  /* ننتظر نافذة الطالب تنتهي؟ لا — نختبر رد المشرف على طالب آخر ما كلّمنا اليوم */

  /* رد محمد من تيليغرام (ردّ على إشعار فيه #u6104) — الطالب ما عنده محادثة جارية */
  n = TG.length;
  await call('POST', '/tg-webhook', { body: { update_id: ++UPD, message: {
    message_id: ++MID, date: now(), chat: { id: 5555, type: 'private' }, from: from('5555'),
    text: 'السلام عليكم، تحتاج مساعدة؟',
    reply_to_message: { message_id: 7, date: now(), chat: { id: 5555 },
      text: '💬 رسالة من طالب\n\nهلا\n\n#u6104' } } } });
  ok(sentTo(since(n), '6104').some(c => /رد من فريق جدولك/.test(c.b.text || '')),
     'رد محمد يوصل الطالب');
  n = TG.length;
  await say('6104', 'ايه، ما قدرت أضيف الشعبة');
  eq(datas(sentTo(since(n), '6104')[0]), [], '**بعد رد محمد: جوابه يروح للفريق بلا سؤال**');
  ok(!!ticketOf('6104'), 'ويصير تذكرة');
  ok(sentTo(since(n), '5555').some(c => /ما قدرت أضيف الشعبة/.test(c.b.text || '')),
     'ومحمد يوصله');

  /* رد من اللوحة */
  r = await call('POST', '/api/admin/reply', { admin: true, body: { chatId: '6105', text: 'هلا، وش المشكلة؟' } });
  eq(r.j && r.j.ok, true, 'رد اللوحة وصل');
  n = TG.length;
  await say('6105', 'الموقع ما يفتح عندي');
  eq(datas(sentTo(since(n), '6105')[0]), [], '**بعد رد اللوحة: جوابه للفريق بلا سؤال**');
  ok(!!ticketOf('6105'), 'ويصير تذكرة');

  /* /reply من البوت */
  await call('POST', '/tg-webhook', { body: { update_id: ++UPD, message: {
    message_id: ++MID, date: now(), chat: { id: 5555, type: 'private' }, from: from('5555'),
    text: '/reply 6110 تم تحديث خطتك' } } });
  n = TG.length;
  await say('6110', 'شكراً');
  eq(datas(sentTo(since(n), '6110')[0]), [], '**بعد /reply: جوابه للفريق بلا سؤال**');
  ok(!!ticketOf('6110'), 'ويصير تذكرة');

  /* ── ٧) غير المربوط: الزرّان وخطوات الربط ──
     **قاعدة تغيّرت عمداً — قرار محمد:** كان زر الفريق وحده («المساعد ما
     يجاوبه قبل الربط»). صار المساعد يساعده في استعمال الموقع (٧ب). */
  n = TG.length;
  const m7 = await say('7001', 'متى ينتهي تسجيل المواد؟');
  const ch7 = sentTo(since(n), '7001')[0] || { b: {} };
  eq(datas(ch7), ['ask:ai:' + m7.message_id, 'ask:team:' + m7.message_id],
     '**غير المربوط: الزرّان** — المساعد يساعده في استعمال الموقع');
  ok(/اربط/.test(ch7.b.text || '') && /jadwalik\.com/.test(ch7.b.text || ''), 'ويقول له يربط، ووين');
  ok(/1️⃣[\s\S]*2️⃣[\s\S]*3️⃣/.test(ch7.b.text || ''), 'بخطوات مرقّمة');
  ok(/إشعارات تيليغرام/.test(ch7.b.text || ''), 'وباسم القسم كما في الصفحة');
  eq(ticketOf('7001'), undefined, 'وما انفتحت تذكرة');
  await press('7001', 'ask:team:' + m7.message_id, botMsgOf(ch7, m7));
  const t7 = ticketOf('7001');
  eq(t7 && msgsOf(t7.id).map(m => m.body), ['متى ينتهي تسجيل المواد؟'],
     '**وزر الفريق يرسل رسالته كما هي**');
  eq(AI.length, 2, 'وما سألنا النموذج');

  /* ── ٨) ضاع النص من الذاكرة (نشر جديد): من رسالته اللي رددنا عليها ── */
  n = TG.length;
  const lost = { message_id: 999, date: now(), chat: { id: 6106, type: 'private' },
                 from: from('6106'), text: 'وش عندي بكرة؟' };
  await press('6106', 'ask:ai:999', { message_id: 88001, date: now(),
    chat: { id: 6106, type: 'private' }, text: '💬 وين نوصل رسالتك؟', reply_to_message: lost });
  eq(AI.length, 3, '**بعد النشر: الزر يشتغل**');
  ok(/وش عندي بكرة/.test(AI[2] || ''), '**بنص رسالته من تيليغرام نفسه**');
  /* رسالة قديمة (أكثر من يوم): ما نشتغل على سؤال بايت */
  n = TG.length;
  await press('6107', 'ask:ai:998', { message_id: 88002, date: now() - 2 * 86400,
    chat: { id: 6107, type: 'private' }, text: '💬',
    reply_to_message: { message_id: 998, date: now() - 2 * 86400, chat: { id: 6107 }, text: 'قديم' } });
  eq(AI.length, 3, 'سؤال عمره يومان ما نسأل عنه');
  ok(since(n).some(c => c.method === 'editMessageText' && /اكتب رسالتك مرة ثانية/.test(c.b.text || '')),
     'ونقول له يكتبها مرة ثانية');
  /* رقم ما يطابق رسالته: ما نخمّن */
  await press('6107', 'ask:team:997', { message_id: 88003, date: now(),
    chat: { id: 6107, type: 'private' }, text: '💬',
    reply_to_message: { message_id: 555, date: now(), chat: { id: 6107 }, text: 'غيرها' } });
  eq(ticketOf('6107'), undefined, 'رقم ما يطابق رسالته: ما نرسل شي');

  /* ── ٩) زر قديم للفريق وهو داخل المساعد: يطلع من المساعد ── */
  n = TG.length;
  const m9 = await say('6109', 'الموقع يعلّق');
  const ch9 = sentTo(since(n), '6109')[0] || { b: {} };
  await say('6109', '/ai');                                /* دخل المساعد */
  n = TG.length;
  await press('6109', 'ask:team:' + m9.message_id, botMsgOf(ch9, m9));
  ok(!!ticketOf('6109'), 'الزر القديم يرسلها للفريق');
  const conf9 = sentTo(since(n), '6109').find(c => /رقم تذكرتك/.test(c.b.text || '')) || { b: {} };
  ok(conf9.b.reply_markup && conf9.b.reply_markup.remove_keyboard === true,
     '**ويشيل لوحة المساعد** — وإلا كلامه الجاي يروح للمساعد وهو يظن العكس');
  const before9 = AI.length;
  await say('6109', 'ولسا يعلّق');
  eq(AI.length, before9, '**وكلامه الجاي ما يروح للمساعد**');
  eq(msgsOf(ticketOf('6109').id).length, 2, 'يلتصق بتذكرته');

  /* ── ١٠) الأوامر تبقى أوامر ── */
  n = TG.length;
  await say('6108', '/help');
  const help = sentTo(since(n), '6108')[0] || { b: {} };
  ok(/وش يقدر يسوي جدولك/.test(help.b.text || ''), '/help يرد بالدليل');
  eq(datas(help), [], 'بلا زرّين');

  /* ── ١٠ب) ثلاث ضغطات بنفس اللحظة (شبكة بطيئة وأصبع مستعجل): سؤال واحد ── */
  n = TG.length;
  const mr = await say('6112', 'سؤال بضغطات متزامنة');
  const chr = sentTo(since(n), '6112')[0] || { b: {} };
  const aiBefore = AI.length;
  await Promise.all([1, 2, 3].map(() =>
    press('6112', 'ask:ai:' + mr.message_id, botMsgOf(chr, mr))));
  eq(AI.length - aiBefore, 1, '**ثلاث ضغطات بنفس اللحظة = سؤال واحد للنموذج**');
  eq(sentTo(since(n), '6112').filter(c => /جواب المساعد/.test(c.b.text || '')).length, 1,
     'وجواب واحد');

  /* ── ١٠ج) تيليغرام رفض رسالة الزرّين: رسالته ما تضيع ── */
  REJECT_ASK.add('6113');
  n = TG.length;
  await say('6113', 'رسالة والزرّان مرفوضان');
  ok(!!ticketOf('6113'), '**تيليغرام رفض الزرّين: رسالته تصير تذكرة كالسابق** — ما تضيع');
  ok(sentTo(since(n), '5555').some(c => /والزرّان مرفوضان/.test(c.b.text || '')), 'ومحمد يوصله');
  ok(sentTo(since(n), '6113').some(c => /رقم تذكرتك/.test(c.b.text || '')), 'والطالب يستلم رقم تذكرته');

  /* ── ١٠د) غير المربوط يختار المساعد: استعمال الموقع وحده (قرار محمد) ── */
  n = TG.length;
  /* مو نص زر من اللوحة: نصوص الأزرار تروح للمساعد مباشرة بلا زرّين */
  const g1 = await say('7002', 'كيف أثبّت الموقع على جوالي؟');
  const chg = sentTo(since(n), '7002')[0] || { b: {} };
  const aiG = AI.length;
  n = TG.length;
  await press('7002', 'ask:ai:' + g1.message_id, botMsgOf(chg, g1));
  eq(AI.length - aiG, 1, '**غير المربوط: المساعد يجاوبه**');
  ok(/زائر من تلقرام/.test(AI[AI.length - 1] || ''),
     '**والنموذج يعرف إنه زائر: استعمال الموقع وحده**');
  const ga = sentTo(since(n), '7002').find(c => /جواب المساعد/.test(c.b.text || '')) || { b: {} };
  ok(/اربط/.test(ga.b.text || ''), 'وجوابه يقول له يربط عشان جدوله وخطته');
  ok(/أراقب/.test(JSON.stringify(ga.b.reply_markup || {})), 'ولوحته أمثلة من استعمال الموقع');
  eq(ticketOf('7002'), undefined, 'ولا تذكرة');
  /* يطلب جدوله: الأداة ترفض «اربط حسابك» — لا «سجّل دخولك بقوقل» — والخطوات تطلع */
  let r0 = AI_RES.length;
  n = TG.length;
  await say('7002', 'وش عندي بكرة؟ أداة:my_day {"day":"U"}');
  ok(AI_RES.slice(r0).some(x => /اربط حسابك/.test(x)) && !AI_RES.slice(r0).some(x => /سجّل دخولك بقوقل/.test(x)),
     '**أداة تحتاج حسابه: ترفض «اربط حسابك»**');
  ok(sentTo(since(n), '7002').some(c => /1️⃣[\s\S]*3️⃣/.test(c.b.text || '')),
     '**والجواب فيه خطوات الربط كاملة**');
  /* والدليل يشتغل له */
  r0 = AI_RES.length;
  await say('7002', 'كيف أضيف موعد؟ أداة:guide {"lang":"ar"}');
  ok(AI_RES.slice(r0).length === 1 && !/اربط حسابك/.test(AI_RES[r0] || '')
     && /sections/.test(AI_RES[r0] || ''), '**والدليل يشتغل له**');
  /* سقفه اليومي (٣ أسئلة): الرابع يوقف بصياغة تلقرام */
  const aiC = AI.length;
  n = TG.length;
  await say('7002', 'سؤال رابع');
  eq(AI.length, aiC, 'السؤال الرابع ما وصل النموذج — سقف الزوار اليومي');
  const capMsg = (sentTo(since(n), '7002')[0] || { b: {} }).b.text || '';
  ok(/خلصت أسئلتك/.test(capMsg) && !/شبكتك/.test(capMsg) && /اربط/.test(capMsg),
     '**والرسالة بصياغة تلقرام** — «من شبكتك» ما تنطبق هنا — ' + capMsg.slice(0, 50));
  /* زائر الموقع يقرأ التقويم — زائر تلقرام الدليل وحده */
  r0 = AI_RES.length;
  await say('7003', '/ai متى تبدأ الدراسة؟ أداة:academic_calendar');
  ok(AI_RES.slice(r0).some(x => /اربط حسابك/.test(x)),
     '**وغير الدليل يُرفض له — حتى التقويم المفتوح لزائر الموقع**');

  /* ── ١٠هـ) «ذكّرني» من البوت: زر «✅ ثبّت» يكتب التذكير فعلاً ──
     كانت «افتح jadwalik.com واضغط تأكيد» — والموقع ما يعرض اقتراحات
     تلقرام: طريق مسدود، والتذكير صار مثالاً في لوحة البوت. */
  const rt = new Date(Date.now() + 3 * 3600e3 + 3600e3);      /* بعد ساعة بتوقيت الرياض */
  const D = rt.toISOString().slice(0, 10), T = rt.toISOString().slice(11, 16);
  n = TG.length;
  const mr1 = await say('6114',
    `ذكّرني بعد ساعة أذاكر أداة:propose_reminder {"date":"${D}","time":"${T}","body":"أذاكر"}`);
  const chr1 = sentTo(since(n), '6114')[0] || { b: {} };
  n = TG.length;
  await press('6114', 'ask:ai:' + mr1.message_id, botMsgOf(chr1, mr1));
  const pa = sentTo(since(n), '6114').find(c => btns(c).some(x => /^act:ok:/.test(x.callback_data)))
    || { b: {} };
  ok(btns(pa).some(x => /ثبّت/.test(x.text)), '**التذكير: زر «✅ ثبّت» في البوت**');
  ok(!/افتح المساعد في jadwalik/.test(pa.b.text || ''), 'وما يحيله للموقع');
  eq((DB.reminders || []).length, 0, 'وما انكتب شي قبل الضغط');
  const okId = (btns(pa).find(x => /^act:ok:/.test(x.callback_data)) || {}).callback_data;
  n = TG.length;
  await press('6114', okId, botMsgOf(pa, null));
  const rem = DB.reminders || [];
  eq(rem.length, 1, '**الضغط يثبّت التذكير فعلاً**');
  eq([rem[0] && rem[0].user_id, rem[0] && rem[0].env, rem[0] && rem[0].body], ['u-6114', 'prod', 'أذاكر'],
     'لصاحب المحادثة، وبيئة الخدمة (يختمها السيرفر)، وبنصّه');
  ok(rem[0] && Math.abs(Date.parse(rem[0].at) - (Date.now() + 3600e3)) < 120e3, 'وبوقته — بعد ساعة');
  ok(since(n).some(c => c.method === 'editMessageReplyMarkup'), 'وأزراره تنشال');
  ok(sentTo(since(n), '6114').some(c => /ثبّتنا التذكير/.test(c.b.text || '')), 'ويقول له ثبّتناه');
  await press('6114', okId, botMsgOf(pa, null));
  eq((DB.reminders || []).length, 1, '**ضغطة ثانية ما تثبّت تذكيراً ثانياً**');
  n = TG.length;
  await say('6114', `وذكّرني أصلّي أداة:propose_reminder {"date":"${D}","time":"${T}","body":"أصلّي"}`);
  const pb = sentTo(since(n), '6114').find(c => btns(c).some(x => /^act:no:/.test(x.callback_data)))
    || { b: {} };
  await press('6114', (btns(pb).find(x => /^act:no:/.test(x.callback_data)) || {}).callback_data,
              botMsgOf(pb, null));
  eq((DB.reminders || []).length, 1, '«✖️ لا»: ما ينكتب شي');
  /* الزر يعيد فحوص الاقتراح **وقت الضغط** (aiRemindCheck): عنده ٢٠ معلّقة؟ ما يثبّت */
  const propose = async body => {
    const k = TG.length;
    await say('6114', `ذكّرني أداة:propose_reminder {"date":"${D}","time":"${T}","body":"${body}"}`);
    const c = sentTo(since(k), '6114').find(x => btns(x).some(y => /^act:ok:/.test(y.callback_data)))
      || { b: {} };
    return { c, id: (btns(c).find(y => /^act:ok:/.test(y.callback_data)) || {}).callback_data };
  };
  let pr = await propose('ثالث');
  const base = DB.reminders.length;
  for (let i = 0; i < 20; i++) DB.reminders.push({ id: 9000 + i, user_id: 'u-6114', env: 'prod',
    at: new Date(Date.now() + 864e5).toISOString(), body: 'x', sent_at: null });
  n = TG.length;
  await press('6114', pr.id, botMsgOf(pr.c, null));
  eq(DB.reminders.length, base + 20, '**الزر يعيد الفحص وقت الضغط: فوق حد المعلّق ما يثبّت**');
  ok(sentTo(since(n), '6114').some(c => /معلّقة/.test(c.b.text || '')), 'ويقول له ليش');
  DB.reminders.splice(base, 20);
  /* فكّ ربطه بين الاقتراح والضغط: ما نكتب لحساب ما عاد صاحب المحادثة */
  pr = await propose('رابع');
  const P14 = DB.profiles.find(x => x.id === 'u-6114');
  P14.telegram_chat_id = null;
  await press('6114', pr.id, botMsgOf(pr.c, null));
  eq(DB.reminders.length, base, '**فكّ الربط قبل الضغط: ما ينكتب شي**');
  P14.telegram_chat_id = '6114';

  /* ── ١٠و) تذكرة الدعم من المساعد: زر يرسلها للفريق بسياقها ── */
  n = TG.length;
  const ms1 = await say('6115',
    'الموقع يعلّق أداة:propose_support_ticket {"text":"الجدول يعلّق عندي","category":"bug"}');
  const chs1 = sentTo(since(n), '6115')[0] || { b: {} };
  n = TG.length;
  await press('6115', 'ask:ai:' + ms1.message_id, botMsgOf(chs1, ms1));
  const ps = sentTo(since(n), '6115').find(c => btns(c).some(x => /^act:ok:/.test(x.callback_data)))
    || { b: {} };
  ok(btns(ps).some(x => /فريق جدولك/.test(x.text)), '**تذكرة الدعم: زر «أرسلها لفريق جدولك»**');
  eq(ticketOf('6115'), undefined, 'وما انرسلت قبل الضغط');
  n = TG.length;
  await press('6115', (btns(ps).find(x => /^act:ok:/.test(x.callback_data)) || {}).callback_data,
              botMsgOf(ps, null));
  const ts = ticketOf('6115');
  const tsBody = ts ? (msgsOf(ts.id)[0] || {}).body || '' : '';
  ok(/الجدول يعلّق عندي/.test(tsBody) && /من المساعد/.test(tsBody),
     '**الضغط يفتح تذكرة بنصّها وسياقها** — ' + tsBody.slice(0, 60));
  ok(sentTo(since(n), '5555').some(c => /الجدول يعلّق عندي/.test(c.b.text || '')), 'ومحمد يوصله');
  const cs = sentTo(since(n), '6115').find(c => /رقم تذكرتك/.test(c.b.text || '')) || { b: {} };
  ok(cs.b.reply_markup && cs.b.reply_markup.remove_keyboard === true,
     'ويطلع من وضع المساعد — لوحته تنشال');
  const aiS = AI.length;
  await say('6115', 'ولسا يعلّق');
  eq(AI.length, aiS, '**وكلامه الجاي للفريق لا للمساعد**');
  eq(ts ? msgsOf(ts.id).length : 0, 2, 'يلتصق بتذكرته');

  /* ── ١٠ز) رددنا على طالب داخل وضع المساعد: جوابه لنا لا للمساعد ── */
  await say('6116', '/ai');
  n = TG.length;
  await call('POST', '/api/admin/reply', { admin: true, body: { chatId: '6116', text: 'هلا، وصلتنا ملاحظتك' } });
  const rr = sentTo(since(n), '6116').find(c => /رد من فريق جدولك/.test(c.b.text || '')) || { b: {} };
  ok(rr.b.reply_markup && rr.b.reply_markup.remove_keyboard === true,
     '**ردّنا يشيل لوحة المساعد** — وإلا جوابه يروح للمساعد');
  const aiR = AI.length;
  await say('6116', 'تمام شكراً');
  eq(AI.length, aiR, '**وجوابه لنا لا للمساعد**');
  ok(!!ticketOf('6116'), 'ويصير تذكرة');

  /* ── ١١) المساعد لصاحب الموقع وحده (admin): الطلاب للفريق مباشرة ── */
  await call('POST', '/api/admin/ai', { admin: true, body: { mode: 'admin' } });
  n = TG.length;
  await say('6108', 'سؤال وقت التجربة');
  eq(datas(sentTo(since(n), '6108')[0]), [], '**وضع admin: الطالب ما يُعرض عليه مساعد مقفول عليه**');
  ok(!!ticketOf('6108'), 'ورسالته تذكرة كالسابق');
  n = TG.length;
  const mo = await say('5555', 'تجربة من صاحب الموقع');
  eq(datas(sentTo(since(n), '5555')[0]), ['ask:ai:' + mo.message_id, 'ask:team:' + mo.message_id],
     'وصاحب الموقع يُسأل — يجرّب');

  /* ── ١٢) المساعد مقفل: كالسابق تماماً ── */
  await call('POST', '/api/admin/ai', { admin: true, body: { mode: 'off' } });
  n = TG.length;
  const before = tickets();
  await say('6111', 'سؤال والمساعد مقفل');
  eq(datas(sentTo(since(n), '6111')[0]), [], '**off: ولا زر**');
  eq(tickets(), before + 1, 'ورسالته تذكرة كالسابق');
  ok(sentTo(since(n), '6111').some(c => /رقم تذكرتك/.test(c.b.text || '')), 'برقم تذكرتها');
}

main().then(() => {
  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log('انهار: ' + (e && e.stack || e));
  process.exit(1);
});
