/* تقييم المساعد بعد المحادثة — طلب محمد (١٨ نوفمبر ٢٠٢٦: «ودي الي يستعمل المساعد يجيه تقييم سريع بعد المحادثه»).
   ثلاثة أجزاء:
   ١) السيرفر (/api/me/ai-rate · /api/admin/ai-rate): الضغطة تنكتب على طول ويرجع رقمها، والسبب يلحقها بنفس الرقم ·
      الهوية من الجلسة لا من الطلب · قائمة مغلقة (التقييم · السبب · الأدوات) والسطر بحدّه · الزائر يقيّم وعنوانه ما
      ينكتب · سقف بالساعة · واللوحة: سطر لكل تقييم بإيميل صاحبه، وسبب «مزوّر» من غيره ما يلحق تقييمه، وكل بيئة لحالها.
   ٢) الصفحة (Chromium على ٣٩٠ بالثيمين): يقفل اللوح بعد جواب ⇒ بطاقة 👍/👎 تحت · 👎 ⇒ «وش كان ناقص؟» وسبب وسطر ·
      مرة لكل محادثة ومرة باليوم، و✕ = أسبوع بلا سؤال · بلا جواب حقيقي أو بإقفال مو منه ما تطلع · تختفي لحالها ·
      الزائر يقيّم بلا رمز · مساحة ✕ ما تسرق الأزرار · الحقل 16px.
   ٣) اللوحة: البطاقة تعرض أرقام السيرفر · السطر مهرّب · «💬 محادثته» تفتح المحادثة ولو قائمة الاستهلاك فاضية.

   node tests/test-ai-rate.js [server.js] [pmu-schedule.html] [admin.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ADMIN = path.resolve(process.argv[4] || path.join(__dirname, '..', 'admin.html'));
const SHARED = path.join(__dirname, '..', 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ محاكي القاعدة: eq · in · gte · order · limit · select — والقص عند ١٠٠٠ بلا limit مثل PostgREST ═══ */
const U1 = 'tok-u1-aaaaaaaaaaaaaaaaaaaa', U2 = 'tok-u2-bbbbbbbbbbbbbbbbbbbb';
const UID = '0b7e2c1a-4d3f-4a5b-9c8d-1e2f3a4b5c6d', UID2 = '5f1c9a2e-7b3d-4e6f-8a1b-2c3d4e5f6a7b';
const TOK = { [U1]: UID, [U2]: UID2 };
let nextId = 100;
const DB = {
  profiles: [{ id: UID, name: 'Student', email: 's@x', telegram_chat_id: null, is_pro: false, subscription_expires_at: null },
             { id: UID2, name: 'Second', email: 't@x', telegram_chat_id: null, is_pro: false, subscription_expires_at: null }],
  ai_usage: [], ai_spend_day: [], ai_threads: [], app_state: [], app_events: [], monitored_courses: []
};
const LOGS = [];

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const q = qs.split('&').filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] });
  const arg = k => (q.find(x => x[0] === k) || [])[1];
  const filt = rows => {
    let r = rows.slice();
    for (const [k, v] of q) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const m = /^(eq|neq|gte|lte|gt|lt|in|is)\.(.*)$/.exec(v || '');
      if (!m) continue;
      const val = m[2], get = x => (x[k] == null ? null : String(x[k]));
      if (m[1] === 'eq') r = r.filter(x => get(x) === val);
      else if (m[1] === 'neq') r = r.filter(x => get(x) !== val);
      else if (m[1] === 'gte') r = r.filter(x => get(x) != null && get(x) >= val);
      else if (m[1] === 'lte') r = r.filter(x => get(x) != null && get(x) <= val);
      else if (m[1] === 'gt') r = r.filter(x => get(x) != null && get(x) > val);
      else if (m[1] === 'lt') r = r.filter(x => get(x) != null && get(x) < val);
      else if (m[1] === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''));
        r = r.filter(x => set.includes(get(x))) }
      else if (m[1] === 'is') r = r.filter(x => (val === 'null' ? x[k] == null : String(x[k]) === val));
    }
    const ord = arg('order');
    if (ord) { const [col, dir] = ord.split('.');
      r.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)) }
    r = r.slice(0, arg('limit') ? Number(arg('limit')) : 1000);
    const sel = arg('select');
    if (sel && sel !== '*') { const cols = sel.split(','); r = r.map(x => Object.fromEntries(cols.map(c => [c, x[c]]))) }
    return r;
  };
  const rep = /return=representation/.test(prefer || '');
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
      return [];
    }
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign({ id: nextId++ }, x));
    list.push(...rows);
    return rep ? rows : [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(list); hit.forEach(x => Object.assign(list.find(y => y.id === x.id) || x, b));
    return rep ? hit : [];
  }
  if (method === 'DELETE') return [];
  return filt(list);
}

const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { if (ev === 'error') req._err = fn; return req },
    setTimeout() { return req }, destroy() {},
    write(d) { chunks.push(d) },
    end() {
      let o = '[]', code = 200;
      if (opts.path && opts.path.startsWith('/auth/v1/user')) {
        const t = String((opts.headers && opts.headers.Authorization) || '').replace('Bearer ', '');
        if (TOK[t]) o = JSON.stringify({ id: TOK[t] }); else { code = 401; o = '{}' }
      } else if (host === 'api.telegram.org') o = JSON.stringify({ ok: true, result: {} });
      else if (host === 'api.anthropic.com') { code = 500; o = '{}' }
      else if (!host.includes('pmu.edu.sa'))
        o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 24300 + (process.pid % 100), TOKEN = 'admin-token-for-tests';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: TOKEN, SITE_ENV: 'dev', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false', ANTHROPIC_API_KEY: 'sk-test'
});
const realLog = console.log;
console.log = (...a) => { LOGS.push(a.map(String).join(' ')) };
require(SRV);

function call(p, method, { tok, admin, body, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw != null ? raw : (body ? JSON.stringify(body) : null);
    const headers = {};
    if (tok) headers.Authorization = 'Bearer ' + tok;
    if (admin) headers['X-Admin-Token'] = TOKEN;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
      let o = ''; res.setEncoding('utf8'); res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ status: res.statusCode, j }) });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const RT = (body, tok) => call('/api/me/ai-rate', 'POST', { tok, body });
const evs = () => DB.app_events.filter(x => x.kind === 'ai_rate').map(x => x.payload || {});

(async () => {
  await wait(400);

  /* ═══ ١) السيرفر ═══ */
  eq((await call('/api/me/ai-rate', 'GET')).status, 405, 'النقطة POST وحدها');

  /* 👎 من طالب مسجّل — ومعه حقول ما لها مكان (هوية ثانية · بيئة · قناة · سطر في الضغطة) */
  let r = await RT({ rate: 'down', turns: 3, tools: ['my_day', 'free_rooms', 'my_day', 'rm_rf', '__proto__', 'constructor'],
                     user: UID2, env: 'prod', ch: 'tg', note: 'في الضغطة' }, U1);
  ok(r.status === 200 && r.j && r.j.ok === true && /^[0-9a-f]{12}$/.test(r.j.ev || ''),
     '**👎 ينكتب على طول ويرجع رقمه (ev)** — ' + JSON.stringify(r.j));
  const EV = (r.j && r.j.ev) || '';
  await wait(80);
  const e1 = evs().find(p => p.ev === EV && p.stage === 'rate') || {};
  ok(e1.user === UID && e1.rate === 'down' && e1.turns === 3 && e1.ch === 'web' && e1.env === 'dev',
     '**الضغطة: صاحبها من الجلسة لا من الطلب · كم سؤال · القناة والبيئة من السيرفر** — ' + JSON.stringify(e1));
  eq(e1.tools, ['my_day', 'free_rooms'], '**الأدوات: المعروفة وحدها ومرة وحدة** (ولا «__proto__» ولا «constructor»)');
  ok(!('note' in e1) && !JSON.stringify(e1).includes('في الضغطة'), 'وسطر داخل الضغطة ما ينكتب — السطر مع السبب وحده');
  ok(/^\d{4}-\d\d-\d\dT/.test((DB.app_events.find(x => x.payload && x.payload.ev === EV) || {}).at || ''),
     'والحدث بوقته في عمود at (التنظيف بعد ٣٠ يوم يمشي عليه)');

  /* السبب يلحق الضغطة بنفس الرقم — والسطر بلا علامات تقلب الاتجاه ولا أسطر، وبحدّه */
  const LONG = '  قال عندي مادتين\u202e وعندي ثلاث\n\n' + 'ك'.repeat(400);
  r = await RT({ ev: EV, why: 'wrong', note: LONG }, U1);
  ok(r.status === 200 && r.j.ok === true && r.j.ev === EV, 'السبب انقبل بنفس الرقم — ' + JSON.stringify(r.j));
  await wait(80);
  const e2 = evs().find(p => p.ev === EV && p.stage === 'why') || {};
  ok(e2.user === UID && e2.why === 'wrong' && typeof e2.note === 'string' && e2.note.length === 300 &&
     e2.note.startsWith('قال عندي مادتين وعندي ثلاث ك') && !/[\u202e\n]/.test(e2.note),
     '**السبب وسطره: من القائمة · ٣٠٠ حرف على الأكثر · بلا علامة تقلب اللوحة ولا أسطر** — ' + JSON.stringify(e2).slice(0, 140));

  /* قائمة مغلقة */
  eq((await RT({ rate: 'meh' }, U1)).status, 400, 'تقييم مو 👍/👎: مرفوض');
  eq((await RT({ ev: 'zz-not-hex', why: 'wrong' }, U1)).status, 400, 'سبب برقم مو بشكله: مرفوض');
  eq((await RT({ ev: EV, why: 'hack' }, U1)).status, 400, 'سبب مو من القائمة وبلا سطر: مرفوض');
  eq((await RT({ ev: EV, note: '   \n ' }, U1)).status, 400, 'سطر فاضي بلا سبب: مرفوض');
  eq((await call('/api/me/ai-rate', 'POST', { tok: U1, raw: 'not json' })).status, 400, 'جسم مو JSON: مرفوض بلا انهيار');

  /* الزائر يقيّم (يسأل المساعد بلا حساب) — وعنوانه للسقف وحده. ورمز منتهٍ = زائر، ما ينحسب على أحد */
  r = await RT({ rate: 'up', turns: 1, tools: ['find_course'] });
  ok(r.status === 200 && r.j.ok === true, 'الزائر يقيّم بلا رمز — ' + JSON.stringify(r.j));
  r = await RT({ rate: 'up', turns: 2 }, 'tok-expired');
  ok(r.status === 200 && r.j.ok === true, 'ورمز منتهٍ يمر زائراً');
  await wait(80);
  const guests = evs().filter(p => p.stage === 'rate' && p.rate === 'up');
  ok(guests.length === 2 && guests.every(p => p.user === null), '**تقييم الزائر بلا صاحب** (لا معرّف مخترع ولا صاحب الرمز المنتهي)');
  ok(!/127\.0\.0\.1|::1|ffff/.test(JSON.stringify(DB.app_events)), '**وعنوان الشبكة ما ينكتب أبداً**');

  /* طالب ثانٍ: 👍 — ويرسل «سبباً» برقم تقييم الأول (تزوير): ينكتب باسمه هو، وما يلحق تقييم غيره */
  r = await RT({ rate: 'up', turns: 5, tools: ['build_schedule'] }, U2);
  ok(r.status === 200 && r.j.ok === true, 'الطالب الثاني قيّم');
  r = await RT({ ev: EV, why: 'slow', note: 'تزوير' }, U2);
  eq(r.status, 200, 'سبب برقم تقييم غيره ينقبل (ما نقرأ القاعدة لكل طلب) — بس ينكتب باسمه');

  /* أحداث ما تطلع في اللوحة: بيئة ثانية · أقدم من المدة */
  const old = new Date(Date.now() - 40 * 864e5);
  DB.app_events.push({ id: nextId++, kind: 'ai_rate', at: new Date().toISOString(),
    payload: { ev: 'aaaaaaaaaaaa', stage: 'rate', env: 'prod', ch: 'web', user: UID, rate: 'down', turns: 9, tools: [], at: Date.now() } });
  DB.app_events.push({ id: nextId++, kind: 'ai_rate', at: old.toISOString(),
    payload: { ev: 'bbbbbbbbbbbb', stage: 'rate', env: 'dev', ch: 'web', user: UID, rate: 'down', turns: 8, tools: [], at: +old } });

  /* اللوحة */
  eq((await call('/api/admin/ai-rate', 'GET')).status, 401, 'تقييمات اللوحة برمزها وحده');
  r = await call('/api/admin/ai-rate', 'GET', { admin: true });
  const A = r.j || {}, S = A.summary || {};
  ok(A.ok === true && A.env === 'dev' && A.days === 30, 'اللوحة ترد — ' + JSON.stringify(A).slice(0, 120));
  ok(S.up === 3 && S.down === 1 && S.pct === 75 && S.raters === 2 && S.guest === 2 && S.notes === 1,
     '**الملخّص: 👍 ٣ · 👎 ١ · ٧٥٪ · طالبان · تقييما زوار** — ' + JSON.stringify(S));
  eq(S.reasons, { wrong: 1 }, '**وأسباب 👎** (والسبب المزوّر ما ينحسب على تقييم غيره)');
  eq(S.tools, { my_day: 1, free_rooms: 1 }, 'والأدوات في المحادثات اللي ما أفادت');
  ok(S.ch && S.ch.web && S.ch.web.up === 3 && S.ch.web.down === 1 && S.ch.tg && S.ch.tg.up === 0, 'وحسب القناة');
  const rows = A.recent || [];
  const mine = rows.find(e => e.user === UID) || {};
  ok(mine.rate === 'down' && mine.why === 'wrong' && mine.email === 's@x' && mine.name === 'Student' && mine.turns === 3 &&
     mine.guest === false && /^قال عندي مادتين/.test(mine.note || '') && !/تزوير/.test(mine.note || ''),
     '**سطر التقييم: 👎 وسببه وسطره بإيميل صاحبه — والمزوّر ما لحقه** — ' + JSON.stringify(mine).slice(0, 160));
  ok(rows.filter(e => e.guest).length === 2 && rows.filter(e => e.guest).every(e => e.user === null && e.email === null),
     'والزائر «زائر» بلا معرّف ولا إيميل');
  ok(!rows.some(e => e.turns === 9 || e.turns === 8), '**تقييمات البيئة الثانية والأقدم من ٣٠ يوم ما تطلع** (القاعدة مشتركة)');
  ok(rows.length === 4 && rows.every((e, i) => i === 0 || Date.parse(rows[i - 1].at) >= Date.parse(e.at)),
     'سطر لكل تقييم، الأحدث أول — ' + rows.length);
  ok(!/127\.0\.0\.1|tok-u1|tok-u2/.test(JSON.stringify(A)), 'ولا عنوان شبكة ولا رمز في رد اللوحة');

  /* السقف: ١٢ بالساعة لكل طالب — والزائر بسقف لحاله */
  let last = 200, n = 0;
  for (; n < 20 && last !== 429; n++) last = (await RT({ rate: 'up' }, U2)).status;
  ok(last === 429 && n <= 12, `**سقف بالساعة لكل طالب** — ٤٢٩ بعد ${n} طلب`);
  eq((await RT({ rate: 'up' }, U1)).status, 200, 'وسقف طالب ما يوقف غيره');

  /* ═══ ٢) الصفحة ═══ */
  const { chromium } = require('playwright');
  const STATUS = { active: false, reason: 'offseason', env: 'prod', freeBeta: false, term: '202710', regTerm: '202710',
    nextRegTerm: '202720', canWatch: false, window: null, build: '"x"',
    plans: { termHalalas: 1900, pushoverHalalas: 1500, freeMonitors: 2, freeSchedules: 1 } };
  const SEEN = { rates: [], asks: 0 };
  let AI_ST = { on: true, why: '', used: { day: 0, dayCap: 25 } };
  let ANSWER = { ok: true, answer: 'عندك مادتين بكرة: الثيرمو 8:00 والفيزياء 9:30', tools: ['my_day'], used: { day: 1, dayCap: 25 } };
  const srv = http.createServer((q2, res) => {
    const u = q2.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(SHARED)) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    let bd = ''; q2.setEncoding('utf8'); q2.on('data', c => bd += c);
    q2.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let b = {}; try { b = JSON.parse(bd || '{}') } catch (e) {}
      if (u === '/api/me/ai-rate') { SEEN.rates.push({ body: b, auth: q2.headers.authorization || null });
        return res.end(JSON.stringify(b.rate ? { ok: true, ev: 'abcdef123456' } : { ok: true, ev: b.ev })) }
      if (u === '/api/me/ai') {
        if (q2.method !== 'POST') return res.end(JSON.stringify(AI_ST));
        if (b.reset) return res.end('{"ok":true,"reset":true}');
        SEEN.asks++; return res.end(JSON.stringify(ANSWER));
      }
      if (u === '/api/monitor-status') return res.end(JSON.stringify(STATUS));
      if (u.startsWith('/api/me/')) return res.end('{"ok":false}');
      res.end('{}');
    });
  });
  await new Promise(z => srv.listen(0, '127.0.0.1', z));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const SUPA_GUEST = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},upsert:async()=>({error:null}),insert(){return this},delete(){return this},update(){return {eq:async()=>({data:[],error:null})}},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
  const SUPA_USER = `
window.__ROW={id:'u1',email:'s@x.com',name:'Student',major:'MEEN',plan_ver:'new',prep:false,telegram_chat_id:'901'};
function q(t){ const o={ select(){return o}, eq(){return o}, order(){return o}, limit(){return o}, in(){return o}, or(){return o},
  gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:t==='profiles'?window.__ROW:null,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} }, insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:t==='profiles'?[window.__ROW]:[],error:null}).then(f,r) } }; return o }
window.supabase={createClient:()=>({ auth:{ getSession:async()=>({data:{session:{user:{id:'u1',email:'s@x.com'},access_token:'tok'}}}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
  from:t=>q(t), channel:()=>({on(){return this},subscribe(){return this}}), storage:{from:()=>({list:async()=>({data:[],error:null})})} })};`;
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const errs = [];
  const open = async (supa, theme) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const p = await ctx.newPage();
    p.setDefaultTimeout(4000);                 /* عنصر ناقص (الكود القديم) = ✗ سريع لا انتظار ٣٠ ثانية */
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', z => z.fulfill({ status: 200, contentType: 'application/javascript', body: supa }));
    await p.addInitScript(() => { try { localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_seen_welcome', 'true');
      localStorage.setItem('pmu_major', '"MEEN"'); localStorage.setItem('pmu_guestbar_off', String(Date.now())) } catch (e) {} });
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof switchTab === 'function' && typeof openAi === 'function', null, { timeout: 15000 });
    await p.waitForTimeout(1200);              /* الجلسة والملف وحالة المساعد توصل */
    return { ctx, p };
  };
  const run = (p, fn, arg) => p.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  const CARD = () => { const b = document.getElementById('aiRate');
    if (!b) return { exists: false, visible: false };
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { exists: true, visible: !b.hidden && cs.display !== 'none' && r.height > 0 && b.classList.contains('show'),
      text: b.innerText, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight,
      sw: document.documentElement.scrollWidth } };
  /* محادثة: يفتح اللوح ويسأل وينتظر الجواب */
  const chat = async (p, q) => {
    await run(p, () => openAi());
    await p.waitForTimeout(250);
    await p.fill('#aiQ', q).catch(() => {});
    await p.click('#aiSendBtn').catch(() => {});
    await p.waitForFunction(() => !AI_BUSY, null, { timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(150);
  };
  const closeX = async p => { await p.click('#aiSheet .ai-head button').catch(() => {}); await p.waitForTimeout(450) };
  const ls = (p, k) => run(p, k => { try { return localStorage.getItem(k) } catch (e) { return null } }, k);

  /* ── طالب مسجّل · الغامق ── */
  {
    const { ctx, p } = await open(SUPA_USER, 'dark');
    await run(p, () => { AI_RATE_HIDE.ask = 60000 });
    await chat(p, 'وش عندي بكرة؟');
    ok(SEEN.asks === 1, 'سأل المساعد وجاه جواب');
    await closeX(p);
    let c = await run(p, CARD);
    ok(c.visible && /أفادك Jadwalik AI/.test(c.text || '') && /أفادني/.test(c.text || '') && /ما أفادني/.test(c.text || ''),
       '**قفل اللوح بعد جواب ⇒ بطاقة «أفادك Jadwalik AI في هالمحادثة؟» بـ👍 و👎** — ' + JSON.stringify(c).slice(0, 160));
    ok(c.visible && c.left >= 0 && c.right <= c.vw && c.bottom <= c.vh && c.top > c.vh * 0.6 && c.sw <= c.vw,
       'تحت الشاشة وداخلها، وبلا تمرير بالعرض — ' + JSON.stringify([c.top, c.bottom, c.left, c.right, c.sw]));
    const lsAt = Number(await ls(p, 'pmu_ai_rate_at'));
    ok(Math.abs(Date.now() - lsAt) < 60000, 'والجهاز يتذكّر متى سألناه (مرة باليوم)');
    /* مساحة ✕ أوسع منه — وما تسرق 👍 و👎 */
    const hit = await run(p, () => {
      const x = document.querySelector('#aiRate .ai-rate-x'); if (!x) return null;
      const r = x.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const xs = [[cx - 14, cy], [cx + 12, cy], [cx, cy - 13], [cx, cy + 13]].map(([a, b]) => document.elementFromPoint(a, b) === x);
      /* الحافة المستقيمة (١٤px من الجنب — الزاوية مدوّرة) بعد بكسل من فوق: مساحة ✕ تنزل تحته بكسلين، وبلا ترتيب
         الطبقات كانت ضغطة طرف 👎 اللي تحت ✕ تروح له */
      const bs = [...document.querySelectorAll('#aiRate .ai-rate-b button')].map(b => { const q = b.getBoundingClientRect();
        return [[q.left + 14, q.top + 1], [q.right - 14, q.top + 1], [q.left + q.width / 2, q.top + q.height / 2],
                [q.left + 14, q.bottom - 1], [q.right - 14, q.bottom - 1]]
          .every(([a, c2]) => { const e = document.elementFromPoint(a, c2); return e === b || b.contains(e) }) });
      return { xs, bs, h: Math.round(Math.min(...[...document.querySelectorAll('#aiRate .ai-rate-b button')].map(b => b.getBoundingClientRect().height))) };
    });
    ok(hit && hit.xs.every(Boolean), '**✕ ينضغط من حوله** (مساحة أوسع من الحرف) — ' + JSON.stringify(hit && hit.xs));
    ok(hit && hit.bs.length === 2 && hit.bs.every(Boolean) && hit.h >= 40,
       '**و👍 👎 ينضغطان كاملين (≥40px) — مساحة ✕ ما تسرقهم** — ' + JSON.stringify(hit));
    if (shots) await p.screenshot({ path: path.join(shots, 'rate-ask-dark.png') });

    /* 👎 ⇒ ينكتب على طول، والبطاقة تسأل وش كان ناقص */
    await p.click('#aiRate button[data-r="down"]').catch(() => {});
    await p.waitForTimeout(300);
    const r0 = SEEN.rates[0] || {};
    ok(r0.body && r0.body.rate === 'down' && r0.body.turns === 1 && JSON.stringify(r0.body.tools) === '["my_day"]' &&
       r0.auth === 'Bearer tok' && !('note' in r0.body),
       '**👎 يروح على طول: التقييم · كم سؤال · الأدوات اللي اشتغلت — بجلسته** — ' + JSON.stringify(r0));
    c = await run(p, CARD);
    const why = await run(p, () => [...document.querySelectorAll('#aiRate .ai-rate-w button')].map(b => b.textContent));
    ok(c.visible && /وش كان ناقص/.test(c.text || '') && Array.isArray(why) && why.length === 4 &&
       why.includes('معلومة غلط') && why.includes('ما فهم سؤالي') && why.includes('ما قدر يسوي اللي طلبته') && why.includes('بطيء'),
       '**ومع 👎: «وش كان ناقص؟» بأربعة أسباب** — ' + JSON.stringify(why));
    const fs16 = await run(p, () => { const i = document.getElementById('aiRateNote'); return i ? getComputedStyle(i).fontSize : null });
    eq(fs16, '16px', 'خانة السطر 16px (سفاري iOS يزوّم على أصغر)');
    if (shots) await p.screenshot({ path: path.join(shots, 'rate-why-dark.png') });
    await p.click('#aiRate .ai-rate-w button[data-w="wrong"]').catch(() => {});
    const on = await run(p, () => [...document.querySelectorAll('#aiRate .ai-rate-w button.on')].map(b => b.dataset.w));
    eq(on, ['wrong'], 'السبب المختار يتلوّن');
    await p.fill('#aiRateNote', 'قال عندي مادتين وعندي ثلاث').catch(() => {});
    await p.click('#aiRate .ai-rate-go').catch(() => {});
    await p.waitForTimeout(300);
    const r1 = SEEN.rates[1] || {};
    ok(r1.body && r1.body.ev === 'abcdef123456' && r1.body.why === 'wrong' && r1.body.note === 'قال عندي مادتين وعندي ثلاث' &&
       !('rate' in r1.body),
       '**«إرسال»: السبب والسطر بنفس رقم الضغطة** — ' + JSON.stringify(r1));
    c = await run(p, CARD);
    ok(c.visible && /شكراً/.test(c.text || ''), 'وشكراً — ' + (c.text || ''));
    await p.waitForTimeout(2300);
    c = await run(p, CARD);
    ok(c.exists && !c.visible, '**والشكر يختفي لحاله**');

    /* نفس المحادثة: قفل ثاني ما يسأل */
    await run(p, () => openAi()); await p.waitForTimeout(250);
    await closeX(p);
    c = await run(p, CARD);
    ok(c.exists && !c.visible && SEEN.rates.length === 2, '**مرة لكل محادثة**: فتح وقفل ثاني ما يسأل');

    /* محادثة جديدة بنفس اليوم: ما يسأل (مرة باليوم) */
    await run(p, () => openAi()); await p.waitForTimeout(200);
    await run(p, () => aiNew()); await p.waitForTimeout(200);
    await closeX(p);
    await chat(p, 'كم غياب باقي لي؟');
    await closeX(p);
    c = await run(p, CARD);
    ok(c.exists && !c.visible, '**مرة باليوم في الجهاز**: محادثة جديدة بنفس اليوم ما تسأل');

    /* بعد يوم: يسأل — و✕ قبل التقييم = أسبوع بلا سؤال، وبلا أي إرسال */
    await run(p, () => localStorage.setItem('pmu_ai_rate_at', String(Date.now() - 25 * 3600e3)));
    await run(p, () => openAi()); await p.waitForTimeout(200);
    await closeX(p);
    c = await run(p, CARD);
    ok(c.visible, 'بعد يوم: المحادثة نفسها (ما انسألت) يسأل عنها');
    await p.click('#aiRate .ai-rate-x').catch(() => {});
    await p.waitForTimeout(450);
    c = await run(p, CARD);
    const off = Number(await ls(p, 'pmu_ai_rate_off'));
    ok(c.exists && !c.visible && Math.abs(Date.now() - off) < 60000 && SEEN.rates.length === 2,
       '**✕ يقفلها بلا إرسال ويأجّل السؤال أسبوعاً**');
    await run(p, () => { localStorage.setItem('pmu_ai_rate_at', String(Date.now() - 3 * 864e5)); aiNew() });
    await p.waitForTimeout(200); await closeX(p);
    await chat(p, 'وين قاعة فاضية الحين؟');
    await closeX(p);
    c = await run(p, CARD);
    ok(c.exists && !c.visible, 'وخلال الأسبوع ما يسأل — ولو مرّ يوم');

    /* بلا جواب فعلي (سقف · خطأ): ما فيه محادثة يقيّمها */
    await run(p, () => { localStorage.removeItem('pmu_ai_rate_off'); localStorage.removeItem('pmu_ai_rate_at'); aiNew() });
    await p.waitForTimeout(200); await closeX(p);
    ANSWER = { ok: false, why: 'day', answer: 'خلصت أسئلتك اليوم — ترجع بكرة', tools: [] };
    await chat(p, 'وش عندي بكرة؟');
    await closeX(p);
    c = await run(p, CARD);
    ok(c.exists && !c.visible, '**رد السقف أو الخطأ ما هو محادثة: ما يسأل**');

    /* إقفال مو منه (الدخول بقوقل من اللوح) ما يسأل — والضغط برّا اللوح يسأل */
    ANSWER = { ok: true, answer: 'الثيرمو يدرّسه Doe, Jane', tools: ['course_instructors'], used: { day: 2, dayCap: 25 } };
    await run(p, () => aiNew()); await p.waitForTimeout(200);
    await chat(p, 'مين يدرّس ثيرمو 1؟');
    await run(p, () => closeAi());
    await p.waitForTimeout(400);
    c = await run(p, CARD);
    ok(c.exists && !c.visible, 'إقفال اللوح من الكود (الدخول بقوقل) ما يسأل');
    await run(p, () => openAi()); await p.waitForTimeout(300);
    await p.mouse.click(195, 40);
    await p.waitForTimeout(450);
    c = await run(p, CARD);
    const ovOpen = await run(p, () => document.getElementById('aiOv').classList.contains('open'));
    ok(!ovOpen && c.visible, '**الضغط برّا اللوح يقفله ويسأل** (مثل ✕)');

    /* تختفي لحالها بلا ما ينرسل شي */
    await run(p, () => { aiRateHide() });
    await p.waitForTimeout(400);
    await run(p, () => { AI_RATE_HIDE.ask = 400; AI_RATE.asked = false; localStorage.removeItem('pmu_ai_rate_at'); aiRateShow() });
    await p.waitForTimeout(150);
    const vis1 = (await run(p, CARD)).visible;
    await p.waitForTimeout(900);
    c = await run(p, CARD);
    ok(vis1 && c.exists && !c.visible && SEEN.rates.length === 2, '**تختفي لحالها لو ما لمسها، وبلا إرسال**');

    /* الإنجليزي */
    const en = await run(p, () => { toggleLang(); aiRateDraw('ask'); const s = document.getElementById('aiRate').innerText;
      aiRateHide(); toggleLang(); return s });
    ok(/Did Jadwalik AI help you/.test(en || '') && /Helpful/.test(en || '') && /Not helpful/.test(en || ''),
       'وبالإنجليزي — ' + String(en || '').replace(/\s+/g, ' ').slice(0, 80));
    await ctx.close();
  }

  /* ── زائر · الفاتح ── */
  {
    const before = SEEN.rates.length;
    AI_ST = { on: true, why: '', guest: true, used: { day: 0, dayCap: 5 } };
    ANSWER = { ok: true, answer: 'شعب ثيرمو 1: ثلاث شعب للطلاب ووحدة للطالبات', tools: ['sections'], guest: true };
    const { ctx, p } = await open(SUPA_GUEST, 'light');
    await chat(p, 'وش شعب ثيرمو 1؟');
    await closeX(p);
    let c = await run(p, CARD);
    ok(c.visible && /أفادك/.test(c.text || ''), '**الزائر يجيه السؤال كذلك** (يسأل المساعد بلا حساب)');
    ok(c.left >= 0 && c.right <= c.vw && c.bottom <= c.vh && c.sw <= c.vw, 'وداخل الشاشة بالفاتح');
    if (shots) await p.screenshot({ path: path.join(shots, 'rate-ask-light.png') });
    await p.click('#aiRate button[data-r="up"]').catch(() => {});
    await p.waitForTimeout(300);
    const g = SEEN.rates[before] || {};
    ok(g.body && g.body.rate === 'up' && g.body.turns === 1 && JSON.stringify(g.body.tools) === '["sections"]' && g.auth === null,
       '**👍 الزائر يروح بلا رمز** — ' + JSON.stringify(g));
    c = await run(p, CARD);
    ok(c.visible && /شكراً/.test(c.text || '') && SEEN.rates.length === before + 1, '👍 شكراً على طول بلا سؤال ثاني');
    if (shots) await p.screenshot({ path: path.join(shots, 'rate-thanks-light.png') });
    /* «وش كان ناقص» بالفاتح — للصورة والقياس */
    await run(p, () => { aiRateHide() }); await p.waitForTimeout(400);
    await run(p, () => { AI_RATE.asked = false; localStorage.removeItem('pmu_ai_rate_at'); aiRateShow() });
    await p.waitForTimeout(400);
    await p.click('#aiRate button[data-r="down"]').catch(() => {});
    await p.waitForTimeout(350);
    c = await run(p, CARD);
    ok(c.visible && c.top > c.vh * 0.5 && c.right <= c.vw, '«وش كان ناقص» بالفاتح داخل الشاشة — ' + JSON.stringify([c.top, c.right]));
    if (shots) await p.screenshot({ path: path.join(shots, 'rate-why-light.png') });
    await ctx.close();
  }
  ok(errs.length === 0, 'الصفحة بلا أخطاء JS — ' + (errs[0] || ''));
  srv.close();

  /* ═══ ٣) اللوحة ═══ */
  const UU = '9d3c1b2a-1111-4222-8333-944455556666';
  const RATE_FIX = { ok: true, days: 30, env: 'prod',
    summary: { up: 7, down: 3, pct: 70, raters: 6, guest: 2, notes: 2, reasons: { wrong: 2, slow: 1 },
               tools: { free_rooms: 2, my_day: 1 }, ch: { web: { up: 6, down: 3 }, tg: { up: 1, down: 0 } } },
    recent: [
      { at: new Date().toISOString(), user: UU, guest: false, email: 'n@x.com', name: 'Student A', ch: 'web', rate: 'down',
        why: 'wrong', note: '<img src=x onerror=alert(1)> قال القاعة فاضية وهي مو فاضية', turns: 4, tools: ['free_rooms'] },
      { at: new Date(Date.now() - 3600e3).toISOString(), user: null, guest: true, email: null, name: null, ch: 'web',
        rate: 'up', why: null, note: '', turns: 1, tools: [] }] };
  const ADM = { rate: RATE_FIX, threads: [] };
  const asrv = http.createServer((q2, res) => {
    const u = q2.url.split('?')[0];
    if (u === '/' || u === '/admin.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(ADMIN)) }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u.endsWith('/ai-rate')) return res.end(JSON.stringify(ADM.rate));
    if (u.endsWith('/ai-top')) return res.end(JSON.stringify({ ym: '2026-11', truncated: false, top: [] }));
    if (u.endsWith('/import-log')) return res.end(JSON.stringify({ ok: true, days: 30, env: 'prod', summary: {}, recent: [] }));
    if (u.endsWith('/ai-thread')) { ADM.threads.push(q2.url);
      return res.end(JSON.stringify({ id: UU, env: 'prod', name: 'Student A', email: 'n@x.com', major: 'MEEN', turns: 2, summary: '',
        messages: [{ role: 'user', text: 'وين قاعة فاضية؟' }, { role: 'assistant', text: 'M-CORE G034 فاضية لين 12' }] })) }
    if (u.endsWith('/ai')) return res.end(JSON.stringify({ mode: 'all', modes: ['off', 'admin', 'all'], ready: true, env: 'prod',
      model: 'claude-sonnet-5-5', modelEnv: 'claude-sonnet-5-5', modelCustom: false, modelKnown: true,
      caps: { day: 25, dayFree: 5, term: 200, monthSar: 200 }, defaults: { day: 25, dayFree: 5, term: 200, monthSar: 200 },
      alerted: '', fails: 0, unlogged: 0, spend: { monthSar: 1, todaySar: 0.1, questions: 10, pct: 1, byEnv: { prod: 1 } } }));
    if (u.endsWith('/health')) return res.end(JSON.stringify({ monitorInfo: {} }));
    if (u.endsWith('/monitors')) return res.end(JSON.stringify({ monitors: [] }));
    if (u.endsWith('/users')) return res.end(JSON.stringify({ users: [] }));
    if (u.endsWith('/reviews')) return res.end(JSON.stringify({ reviews: [] }));
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(z => asrv.listen(0, '127.0.0.1', z));
  const ABASE = `http://127.0.0.1:${asrv.address().port}/`;
  const aerrs = [], dialogs = [];
  const openAdmin = async () => {
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
    pg.setDefaultTimeout(4000);
    pg.on('pageerror', e => aerrs.push(String(e).slice(0, 160)));
    pg.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}) });
    await pg.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.goto(ABASE, { waitUntil: 'load' });
    await pg.evaluate(() => { sessionStorage.setItem('jdw_admin', 'x'.repeat(16)) });
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.renderAi === 'function', null, { timeout: 15000 }).catch(() => {});
    await pg.click('.tab[data-p="ai"]').catch(() => {});
    await pg.waitForFunction(() => { const b = document.getElementById('aiBody'); return b && !b.querySelector('.spinner') },
      null, { timeout: 8000 }).catch(() => {});
    await pg.waitForTimeout(300);
    return pg;
  };
  {
    const pg = await openAdmin();
    const t = (await pg.textContent('#aiBody').catch(() => '')) || '';
    ok(/⭐ تقييم المساعد/.test(t), '**اللوحة: بطاقة «⭐ تقييم المساعد»** في تبويب المساعد');
    ok(/👍 أفادهم\s*7/.test(t) && /👎 ما أفادهم\s*3/.test(t) && /70%/.test(t),
       '**الأرقام والنسبة كما رجّعها السيرفر** — لا حساب في اللوحة');
    ok(/معلومة غلط ×2/.test(t) && /بطيء ×1/.test(t), 'وأسباب 👎 بعددها');
    ok(/free_rooms ×2/.test(t), 'والأدوات اللي اشتغلت في المحادثات اللي ما أفادت');
    ok(/✈️ تلقرام/.test(t) && /🌐 الموقع/.test(t), 'وحسب القناة');
    ok(/Student A/.test(t) && /👎 ما أفاده/.test(t) && /زائر/.test(t) && /👍 أفاده/.test(t), 'وسطر لكل تقييم: صاحبه وتقييمه، والزائر «زائر»');
    const inj = await pg.evaluate(() => ({ img: !!document.querySelector('#aiBody img[src="x"]'),
      txt: document.getElementById('aiBody').textContent.includes('<img src=x onerror=alert(1)>') }));
    ok(!inj.img && inj.txt && dialogs.length === 0, '**سطر الطالب نص مهرّب** — ما ينفّذ شي في اللوحة');
    const btns = await pg.evaluate(() => [...document.querySelectorAll('#aiBody .row')]
      .filter(r => /أفاده/.test(r.textContent)).map(r => !![...r.querySelectorAll('button')].find(b => /محادثته/.test(b.textContent))));
    eq(btns, [true, false], '«💬 محادثته» للمسجّل وحده — الزائر ما له محادثة محفوظة');
    await pg.evaluate(() => { const r = [...document.querySelectorAll('#aiBody .row')].find(x => /أفاده/.test(x.textContent));
      const b = r && [...r.querySelectorAll('button')].find(x => /محادثته/.test(x.textContent)); if (b) b.click() });
    await pg.waitForTimeout(500);
    const tb = await pg.evaluate(() => { const e = document.getElementById('aiThreadBox'); return e ? e.parentElement.textContent : '' });
    ok(ADM.threads.length === 1 && ADM.threads[0].includes('user=' + UU) && /وين قاعة فاضية/.test(tb),
       '**«💬 محادثته» تفتح محادثة صاحب التقييم — ولو قائمة الاستهلاك فاضية** — ' + JSON.stringify(ADM.threads));
    await pg.close();
  }
  {
    ADM.rate = { ok: false, error: 'تعذّر قراءة التقييمات' };
    let pg = await openAdmin();
    let t = (await pg.textContent('#aiBody').catch(() => '')) || '';
    ok(/تعذّر قراءة التقييمات/.test(t) && /جرّب المساعد/.test(t), 'قراءة فشلت: السبب يبان وباقي التبويب يكمل');
    await pg.close();
    ADM.rate = { ok: true, days: 30, env: 'prod', summary: { up: 0, down: 0, pct: null, ch: {} }, recent: [] };
    pg = await openAdmin();
    t = (await pg.textContent('#aiBody').catch(() => '')) || '';
    ok(/ما أحد قيّم المساعد للحين/.test(t), 'وبلا تقييمات: «ما أحد قيّم المساعد للحين»');
    await pg.close();
  }
  ok(aerrs.length === 0, 'اللوحة بلا أخطاء JS — ' + (aerrs[0] || ''));
  asrv.close();
  await browser.close();
})().catch(e => ok(false, 'انهار: ' + (e && e.stack || e))).finally(() => {
  console.log = realLog;
  out.forEach(l => realLog(l));
  realLog(`\nتقييم المساعد: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
});
