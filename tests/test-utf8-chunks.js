/* الحرف العربي ينكسر بين قطعتين — اختبار سلوكي على السيرفر الحقيقي.
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور Supabase وتيليغرام والنموذج.

   المشكلة (لقاها محمد في اللوحة): جواب المساعد طلع «فعّل الاشتراك م��الموقع».
   المحفوظ في القاعدة سليم — الكسر وقت القراءة: السيرفر كان يجمع الرد قطعة
   قطعة بـ`out += c`، فكل قطعة تتحوّل نصاً لوحدها. والحرف العربي بايتان
   (والإيموجي أربعة)، فلو انقطعت القطعة في نصّه طلع نصفاه «��».
   الشبكة ما تعرف وين الحرف: الرد الطويل يجي قطعاً دائماً، والقطع يقع وين ما وقع.
   الإصلاح: `setEncoding('utf8')` قبل القراءة — يحفظ نصف الحرف للقطعة الجاية.

   هنا **كل** رد من المحاكي يوصل قطعاً من ٥ بايتات (فالقطع يقع في نص حروف
   كثيرة)، وجسم كل طلب نرسله للسيرفر ينقطع في نص حرف. ونفحص:
   ١) سؤال الطالب يوصل النموذج سليماً (جسم الطلب — readBody).
   ٢) محادثته المحفوظة توصل النموذج سليمة (قراءة القاعدة — sb).
   ٣) جواب النموذج يوصل الطالب سليماً (رد المزوّد — aiCall).
   ٤) اللوحة تعرض المحادثة سليمة — هذي اللي شافها محمد.
   ٥) تلقرام: رسالة الطالب (جسم الـwebhook) والجواب له سليمان.
   ٦) ولا «�» في أي طلب يطلع من السيرفر ولا في أي رد له.
   ٧) فحص ثابت: كل قارئ يجمع نصاً من قطع فيه setEncoding — قارئ جديد بلاه يُمسك هنا.

   node tests/test-utf8-chunks.js [server.js] */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const BAD = '�';
const clean = s => typeof s === 'string' && !s.includes(BAD);

/* ═══ البيانات — بأشكال الإنتاج (المحادثة نفسها اللي انكسرت) ═══ */
const UID = '1b0e4d8a-2c3f-4a5b-9c6d-7e8f90a1b2c3';
const UID_TG = '2c1f5e9b-3d4a-4b6c-8d7e-8f9a01b2c3d4';
const OLD_Q = 'كم باقي واخلص؟';
const OLD_A = 'هذي الميزة تحتاج اشتراك عشان أقدر أحسب لك باقي المواد والتخرج المتوقع. '
  + 'فعّل الاشتراك من الموقع وأقدر أوريك التفاصيل كاملة 🙂';
const Q_WEB = 'وش عندي بكرة؟ وكم غياب باقي لي في ثيرمو ١؟';
const Q_TG = 'ذكّرني اليوم الساعة ٨ أسوي أسايمنت الأسسمنت لاب';
const ANSWER = 'بكرة عندك محاضرتين: الأولى الساعة 8:00 والثانية 10:00 في قاعة M-204. '
  + 'وغيابك في ثيرمو باقي لك منه ثلاث مرات 👍 — وجدولك من اللي عبّيته في الموقع.';

const prof = (id, chat) => ({ id, email: 'student@x.com', name: 'طالب التجربة',
  major: 'COSC', plan_ver: 'new', prep: false, is_pro: false, subscription_expires_at: null,
  telegram_chat_id: chat, telegram_username: 'u' + chat });
const DB = {
  profiles: [prof(UID, '7100'), prof(UID_TG, '7200')],
  ai_threads: [{ user_id: UID, env: 'prod', summary: '', turns: 1,
    messages: [{ role: 'user', text: OLD_Q }, { role: 'assistant', text: OLD_A }] }],
  ai_usage: [], completed_courses: [], user_schedule: [], tickets: [], ticket_messages: [],
  app_events: [], app_state: [{ key: 'runtime', value: { toggles: {} } }],
};
const NEXT = {};

function filt(rows, qs) {
  const P = new URLSearchParams(qs);
  let r = rows.slice();
  for (const [k, v] of P) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^(eq|is)\.(.*)$/.exec(v);
    if (!m) continue;
    r = r.filter(x => m[1] === 'is' ? (m[2] === 'null' ? x[k] == null : String(x[k]) === m[2])
                                     : String(x[k]) === m[2]);
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
    /* المحادثة: upsert على مفتاحها (الطالب + البيئة) — merge-duplicates كالحقيقي */
    if (table === 'ai_threads' && /merge-duplicates/.test(prefer || '')) {
      const i = L.findIndex(x => x.user_id === b.user_id && x.env === b.env);
      if (i >= 0) Object.assign(L[i], b); else L.push(b);
      return [201, rep ? [Object.assign({}, i >= 0 ? L[i] : b)] : []];
    }
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign(
      { id: (NEXT[table] = (NEXT[table] || 1) + 1), created_at: new Date().toISOString() }, x));
    L.push(...rows);
    return [201, rep ? rows : []];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(L, qs);
    hit.forEach(r => Object.assign(r, b));
    return [200, rep ? hit : []];
  }
  return [200, []];
}

/* ═══ تيليغرام والنموذج ═══ */
const TG = [];          /* نداءات تيليغرام */
const AI_REQ = [];      /* كل طلب وصل النموذج كما هو */
const SENT = [];        /* كل جسم طلب طلع من السيرفر — نفحص إن ما فيه «�» */
function fakeModel(b) {
  AI_REQ.push(b);
  return { id: 'msg_1', type: 'message', role: 'assistant', model: b.model,
    content: [{ type: 'text', text: ANSWER }], stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 } };
}

/* قطع من ٥ بايتات: الحرف العربي بايتان والإيموجي أربعة، فأغلب القطع تقع في نص حرف */
const pieces = (buf, n) => { const a = []; for (let i = 0; i < buf.length; i += n) a.push(buf.subarray(i, i + n)); return a };
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
      const body = Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(String(c)))).toString('utf8');
      SENT.push({ host, path: opts.path, body });
      let code = 200, o = [];
      if (opts.path && opts.path.startsWith('/auth/v1/user')) {
        const t = String((opts.headers && opts.headers.Authorization) || '').replace('Bearer ', '');
        if (t === 'tok-student-0123456789abcdef') o = { id: UID, email: 'student@x.com',
          user_metadata: { name: 'طالب التجربة', full_name: 'طالب التجربة' } };
        else { code = 401; o = { msg: 'invalid JWT' } }
      } else if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body || '{}') } catch (e) {}
        TG.push({ method: String(opts.path || '').split('/').pop(), b });
        o = { ok: true, result: { message_id: 900 + TG.length, date: Math.floor(Date.now() / 1000),
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
      const parts = pieces(Buffer.from(JSON.stringify(o)), 5);
      const res = new Readable({ read() { for (const p of parts) this.push(p); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 47600 + (process.pid % 100);
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

/* الطلب للسيرفر: الجسم ينقطع **في نص حرف** ويوصل على دفعتين بينهما مهلة —
   كذا تجي رسائل الطلاب الطويلة في الحقيقة. ونقرأ الرد نصاً (setEncoding) عشان
   الكسر لو طلع يكون من السيرفر لا من الاختبار. */
function call(method, p, { body, admin, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const h = {};
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length }
    if (admin) h['X-Admin-Token'] = 'admin-token-for-tests';
    if (token) h.Authorization = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, res => {
      let o = ''; res.setEncoding('utf8');
      res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j, raw: o }) });
    });
    r.on('error', reject);
    if (!data) return r.end();
    /* آخر حرف عربي في الجسم (نص السؤال أو الرسالة — آخر خانة فيه): نقطع بعد بايته الأول */
    let cut = -1;
    for (let i = data.length - 1; i >= 0; i--) if (data[i] >= 0xD8 && data[i] <= 0xDB) { cut = i; break }
    cut = cut > 0 ? cut + 1 : Math.floor(data.length / 2);
    r.write(data.subarray(0, cut));
    setTimeout(() => r.end(data.subarray(cut)), 60);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await wait(300);
  let r = await call('POST', '/api/admin/ai', { admin: true, body: { mode: 'all' } });
  eq(r.j && r.j.mode, 'all', 'المساعد مفتوح للكل');

  /* ── ١–٣) سؤال من الموقع ── */
  const n0 = AI_REQ.length;
  r = await call('POST', '/api/me/ai', { token: 'tok-student-0123456789abcdef', body: { q: Q_WEB } });
  eq(r.code, 200, 'المساعد رد');
  const req1 = AI_REQ[n0] || { messages: [] };
  const msgs = req1.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const lastText = typeof last.content === 'string' ? last.content : '';
  ok(lastText.endsWith(Q_WEB),
     '**١) سؤال الطالب وصل النموذج سليماً** رغم إن جسم الطلب انقطع في نص حرف — جانا: '
     + JSON.stringify(lastText.slice(-60)));
  eq(msgs.slice(0, 2).map(m => m.content), [OLD_Q, OLD_A],
     '**٢) محادثته المحفوظة وصلت النموذج سليمة** (قراءة القاعدة جات قطعاً)');
  eq(r.j && r.j.answer, ANSWER, '**٣) جواب النموذج وصل الطالب سليماً** (رد المزوّد جا قطعاً)');

  /* والمحفوظ بعد الجواب سليم — وإلا انحفظ الكسر للأبد في محادثته */
  const th = DB.ai_threads.find(t => t.user_id === UID) || { messages: [] };
  ok((th.messages || []).every(m => clean(m.text)), 'والمحادثة انحفظت بلا «�»');
  ok((th.messages || []).some(m => m.text === ANSWER), 'وفيها الجواب كما هو');

  /* ── ٤) اللوحة: نفس المحادثة اللي شافها محمد ── */
  r = await call('GET', '/api/admin/ai-thread?user=' + UID, { admin: true });
  eq(r.code, 200, 'اللوحة فتحت المحادثة');
  const texts = ((r.j && r.j.messages) || []).map(m => m.text);
  ok(texts.includes(OLD_A),
     '**٤) اللوحة تعرض «فعّل الاشتراك من الموقع» سليمة** — جانا: '
     + JSON.stringify((texts.find(x => /فعّل/.test(x)) || '').slice(60, 110)));
  eq(r.j && r.j.name, 'طالب التجربة', 'واسم الطالب سليم');

  /* ── ٥) تلقرام: رسالة الطالب والجواب له ── */
  const n1 = AI_REQ.length, t1 = TG.length;
  await call('POST', '/tg-webhook', { body: { update_id: 1, message: { message_id: 10,
    date: Math.floor(Date.now() / 1000), chat: { id: 7200, type: 'private' },
    from: { id: 7200, is_bot: false, first_name: 'سارة' }, text: '/ai ' + Q_TG } } });
  const req2 = AI_REQ[n1] || { messages: [] };
  const m2 = (req2.messages || []).slice(-1)[0] || {};
  const q2 = typeof m2.content === 'string' ? m2.content : '';
  ok(q2.endsWith(Q_TG), '**٥) رسالة الطالب من تلقرام وصلت النموذج سليمة** — جانا: '
     + JSON.stringify(q2.slice(-50)));
  const reply = TG.slice(t1).find(c => c.method === 'sendMessage' && String(c.b.chat_id) === '7200');
  ok(!!reply && String(reply.b.text || '').includes(ANSWER),
     '**والجواب وصله في تلقرام سليماً**');

  /* ── ٦) ولا «�» في أي شي طلع من السيرفر ── */
  const dirty = SENT.filter(s => !clean(s.body));
  eq(dirty.map(s => s.host + ' ' + String(s.path).split('?')[0]), [],
     '**٦) ولا «�» في أي طلب طلع من السيرفر** (للقاعدة وتلقرام والنموذج)');

  /* ── ٧) فحص ثابت: كل قارئ يجمع نصاً من قطع لازم setEncoding قبله ── */
  const src = fs.readFileSync(SRV, 'utf8');
  /* «x += c» حيث c القطعة نفسها — لا «n += c.length» (عدّاد بايتات قارئ الإشعار) */
  const readers = [...src.matchAll(/(\b\w+)\.on\(\s*'data'\s*,\s*(\w+)\s*=>\s*\{?[^;\n]*?\b\w+\s*\+=\s*\2\b(?!\.)/g)];
  ok(readers.length >= 10, 'لقينا قرّاء النصوص في السيرفر (' + readers.length + ')');
  const bad = readers.filter(m => {
    const before = src.slice(Math.max(0, m.index - 500), m.index);
    return !new RegExp('\\b' + m[1] + "\\.setEncoding\\('utf8'\\)").test(before);
  }).map(m => src.slice(0, m.index).split('\n').length + ': ' + m[0].slice(0, 60));
  eq(bad, [], '**٧) كل قارئ يجمع نصاً فيه setEncoding(\'utf8\')** — قارئ بلاه يكسر الحروف العربية');
  /* وقارئ إشعار الدفع يبقى بايتات: التوقيع على الجسم كما وصل (§٣) */
  ok(/parts\.push\(c\)/.test(src) && /Buffer\.concat\(parts\)/.test(src),
     'وقارئ إشعار EdfaPay يبقى بايتات — التوقيع على البايتات كما وصلت');
}

main().catch(e => { fail++; out.push('  ✗ انهار: ' + (e && e.stack || e)) }).finally(() => {
  console.log = realLog;
  console.log(out.join('\n'));
  console.log(`\nالحروف بين القطع: ${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
});
