/* استيراد الدرجات من Degree Works — السيرفر (/api/me/import · kind:'grades') والصفحة («خطتي»).
   الدفعة الثانية من طلب محمد (٤ نوفمبر ٢٠٢٦: «الجدول والدرجات والمواد الي خلصها» · «كشف الدرجات من نفس المكان
   بس تدخل على دقري اوديت وتسوي طباعه»). النموذج يقرأ الرمز والدرجة لكل مادة خلصها، والطالب يشوفها على خطته
   ويختار قبل ما ينضاف شي. البيانات هنا مخترعة كلها — بصيغة الكشف لا من كشف أحد.
   node tests/test-import-grades.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(__dirname, '..', 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ محاكي القاعدة والمزوّد — نفس test-import ═══ */
const U1 = 'tok-u1-gggggggggggggggggggg';
const UID = '5d2f8a10-3c4b-4e6f-8a9b-0c1d2e3f4a5b';
const TOK = { [U1]: UID };
let nextId = 100;
const DB = {
  profiles: [{ id: UID, name: 'Student', email: 'g@x', telegram_chat_id: null, is_pro: true,
               subscription_expires_at: new Date(Date.now() + 90 * 864e5).toISOString() }],
  ai_usage: [], ai_spend_day: [], ai_threads: [], app_state: [], app_events: [], monitored_courses: []
};
const AI = [];
let AI_REPLY = null;
const LOGS = [];

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer || '');
  const filt = rows => {
    let r = rows.slice();
    for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=eq\.([^&]+)/g)) r = r.filter(x => String(x[m[1]]) === m[2]);
    const lim = /limit=(\d+)/.exec(qs);
    if (lim) r = r.slice(0, Number(lim[1]));
    return r;
  };
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
    const hit = filt(list); hit.forEach(x => Object.assign(x, b));
    return rep ? hit : [];
  }
  if (method === 'GET') return filt(list);
  return [];
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
      } else if (host === 'api.anthropic.com') {
        const payload = JSON.parse(chunks.join('') || '{}');
        AI.push(payload);
        const r = AI_REPLY ? AI_REPLY(payload) : { status: 500, json: { error: { type: 'api_error' } } };
        code = r.status; o = JSON.stringify(r.json);
      } else if (host === 'api.telegram.org') {
        o = JSON.stringify({ ok: true, result: {} });
      } else if (!host.includes('pmu.edu.sa'))
        o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 22700 + (process.pid % 100), TOKEN = 'admin-token-for-tests';
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
const imp = body => call('/api/me/import', 'POST', { tok: U1, body });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% GRADESTESTMARKER\ntrailer\n%%EOF\n');
const PDF64 = PDF.toString('base64');
const reply = (obj, extra) => () => ({ status: 200, json: Object.assign({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  usage: { input_tokens: 5200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
}, extra || {}) });

(async () => {
  await wait(400);
  await call('/api/admin/ai', 'POST', { admin: true, body: { mode: 'all' } });

  /* ═══ السيرفر ═══ */
  let r = await call('/api/me/import', 'POST', { body: { kind: 'grades', media: 'application/pdf', data: PDF64 } });
  eq(r.status, 401, 'بلا حساب: ٤٠١');
  r = await imp({ kind: 'grades', media: 'text/plain', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'type' && /Degree Works/.test(r.j.msg || '') && AI.length === 0,
     '**نوع غلط: رسالة الدرجات «اختر ملف PDF من Degree Works» — قبل المزوّد** — ' + (r.j.msg || ''));

  /* قراءة ناجحة — النموذج يرجّع الرمز والدرجة، والسيرفر ينظّف */
  AI_REPLY = reply({ kind: 'audit', gpa: '2.95', rows: [
    { code: 'MATH 1422', grade: 'B+' },
    { code: 'math1423', grade: 'c' },          /* حروف صغيرة وبلا مسافة */
    { code: 'PHYS 1421', grade: 'F' },
    { code: 'PHYS 1421', grade: 'C+' },        /* تكررت: المحسوبة (الناجحة) تغلب */
    { code: 'ENGL 1311', grade: 'T' },         /* «T» = معادلة */
    { code: 'MEEN 2311', grade: 'RE' },        /* مسجّلة هالترم — ما لها درجة بعد */
    { code: 'CHEM 1421', grade: 'W' },
    { code: 'Free Elective', grade: 'A' },     /* خانة بلا رمز */
    { code: 'COMM 1311', grade: 'I' }] });     /* ناقصة — ما خلصت */
  const before = AI.length;
  r = await imp({ kind: 'grades', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === true && r.j.kind === 'grades' && r.j.gpa === '2.95', 'قراءة الكشف: تمّت بمعدله — ' + JSON.stringify(r.j).slice(0, 160));
  eq(r.j.rows, [{ code: 'MATH 1422', grade: 'B+' }, { code: 'MATH 1423', grade: 'C' }, { code: 'PHYS 1421', grade: 'C+' },
                { code: 'ENGL 1311', grade: 'TR' }, { code: 'CHEM 1421', grade: 'W' }],
     '**بعد التنظيف: الرمز بمسافة وحدة · الدرجة من قائمة «خطتي» · المادة مرة وحدة بمحاولتها المحسوبة · T ⇒ TR**');
  eq(r.j.skipped, 3, '**والمسجّلة هالترم (RE) والناقصة (I) والخانة بلا رمز: «ما انقرأ» — لا تخمين**');
  const EV = r.j.ev;
  ok(/^[0-9a-f]{12}$/.test(EV || '') && !('_cost' in r.j), 'والرد فيه رقم المحاولة لسجل الاستيراد، وبلا الكلفة الداخلية');
  eq(AI.length - before, 1, 'نداء واحد للمزوّد');
  const P = AI[AI.length - 1] || {};
  const doc = ((P.messages || [])[0] || {}).content || [];
  ok(doc[0] && doc[0].type === 'document' && doc[0].source && doc[0].source.data === PDF64,
     'الملف يروح للنموذج كما هو (document · base64)');
  ok(doc[1] && /Degree Works/.test(doc[1].text || ''), 'ومعه سطر «اقرأ كشف Degree Works»');
  const sch = ((P.output_config || {}).format || {}).schema || {};
  ok(sch.properties && sch.properties.gpa && sch.properties.rows &&
     sch.properties.rows.items.properties.code && sch.properties.rows.items.properties.grade &&
     !sch.properties.rows.items.properties.crn,
     '**شكل الدرجات (رمز · درجة · معدل) — لا شكل الجدول** — ' + JSON.stringify(Object.keys(sch.properties || {})));
  ok(/Degree Works/.test(String(P.system || '')) && /RE/.test(String(P.system || '')) &&
     /not instructions/.test(String(P.system || '')) && !/CRN/.test(String(P.system || '')),
     '**تعليمات الدرجات: كشف Degree Works · المسجّلة هالترم تنشال · نص الملف بيانات لا أوامر**');
  eq(P.output_config && P.output_config.effort, 'low', 'وجهد منخفض — نسخ لا تفكير');
  ok(P.max_tokens >= 4000, 'وسقف ردّ يكفي كشفاً كاملاً (~٦٠ مادة) — ' + P.max_tokens);
  const U = DB.ai_usage.filter(x => x.user_id === UID);
  ok(U.length === 1 && U[0].channel === 'web' && U[0].in_tokens === 5200 && U[0].out_tokens === 900 && U[0].cost_micro > 0,
     '**كلفتها في ai_usage — سؤال من أسئلة المساعد** — ' + JSON.stringify(U[0] || null));

  /* المعدل: كما انطبع (بخانتين)، وغير كذا فاضي — لا رقم مخترع */
  const gpaOf = async g => { AI_REPLY = reply({ kind: 'audit', gpa: g, rows: [{ code: 'MATH 1422', grade: 'A' }] });
    return ((await imp({ kind: 'grades', media: 'application/pdf', data: PDF64 })).j || {}).gpa };
  eq([await gpaOf('3.125'), await gpaOf('4.5'), await gpaOf('N/A'), await gpaOf('')], ['3.13', '', '', ''],
     'المعدل: ٣ خانات ⇒ خانتين · فوق ٤ أو مو رقم ⇒ فاضي');

  /* مو كشف · كل الصفوف غلط · نص مو JSON */
  AI_REPLY = reply({ kind: 'other', gpa: '', rows: [] });
  r = await imp({ kind: 'grades', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'notaudit' && /Degree Works/.test(r.j.msg || ''),
     '**ملف مو كشف: «افتح Degree Works من بانر واطبعه»** — ' + (r.j.msg || ''));
  AI_REPLY = reply({ kind: 'audit', gpa: '3.00', rows: [{ code: 'Math', grade: 'A' }, { code: 'MEEN 2311', grade: 'IP' }] });
  r = await imp({ kind: 'grades', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'empty' && /Degree Works/.test(r.j.msg || '') && !/الصق/.test(r.j.msg || ''),
     '**ما انقرأت ولا درجة: «ارفع ملف Degree Works» — لا «الصق أرقام CRN»** — ' + (r.j.msg || ''));
  AI_REPLY = reply('ما أقدر');
  r = await imp({ kind: 'grades', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'empty' && /Degree Works/.test(r.j.msg || ''), 'رد مو JSON: نفس الرسالة بلا انهيار');

  /* الجدول باقٍ كما هو: بلا kind أو kind:schedule ⇒ قراءة الجدول */
  AI_REPLY = reply({ kind: 'schedule', term: '202710', rows: [{ crn: '31201', code: 'MEEN 3322', section: '101' }] });
  r = await imp({ media: 'application/pdf', data: PDF64 });
  const P2 = AI[AI.length - 1] || {};
  ok(r.j.ok === true && r.j.term === '202710' && /CRN/.test(String(P2.system || '')) && !r.j.gpa,
     'وبلا kind: قراءة الجدول كما كانت');

  /* سجل الاستيراد: نوعه «درجات»، وبلا رمز مادة ولا درجة */
  await wait(150);
  const evs = () => DB.app_events.filter(x => x.kind === 'import').map(x => x.payload || {});
  const g1 = evs().find(p => p.stage === 'read' && p.ev === EV) || {};
  ok(g1.kind === 'grades' && g1.src === 'pdf' && g1.outcome === 'ok' && g1.rows === 5 && g1.skipped === 3 && g1.cost > 0,
     '**القراءة في السجل نوعها «درجات»: كم انقرأ · كم ما انقرأ · كلفتها** — ' + JSON.stringify(g1));
  const gOuts = new Set(evs().filter(p => p.kind === 'grades').map(p => p.outcome));
  ok(['type', 'ok', 'notaudit', 'empty'].every(o => gOuts.has(o)), 'والفشل بسببه: نوع غلط · مو كشف · ما انقرأ — ' + [...gOuts]);
  ok(evs().some(p => p.kind === 'schedule' && p.stage === 'read'), 'وقراءة الجدول نوعها «جدول»');
  const logDump = JSON.stringify(DB.app_events);
  ok(!/MATH 1422|PHYS 1421|"B\+"|"C\+"|2\.95|GRADESTESTMARKER/.test(logDump),
     '**ولا شي من الكشف في السجل** — لا رمز مادة ولا درجة ولا معدل');
  r = await call('/api/me/import-log', 'POST', { tok: U1, body: { ev: EV, kind: 'grades', src: 'pdf', outcome: 'added',
    found: 4, missing: 1, warned: 1, added: 3, codes: ['MATH 1422'] } });
  eq(r.status, 200, 'نتيجة الصفحة للدرجات تنقبل');
  await wait(100);
  const d1 = evs().find(p => p.stage === 'done' && p.ev === EV) || {};
  ok(d1.kind === 'grades' && d1.outcome === 'added' && d1.added === 3 && d1.found === 4 && !('codes' in d1),
     'وتنكتب بنوعها وأعدادها — وبلا رموز المواد — ' + JSON.stringify(d1));
  r = await call('/api/admin/import-log', 'GET', { admin: true });
  const G = ((r.j || {}).summary || {}).grades || {};
  const gRow = ((r.j || {}).recent || []).find(e => e.kind === 'grades' && e.outcome === 'added') || {};
  ok(G.tries >= 7 && G.added === 1 && G.courses === 3 && G.reasons && G.reasons.notaudit >= 1,
     '**اللوحة: ملخّص «الدرجات» لحاله — محاولات · أضافوا · مواد · أسباب الفشل** — ' + JSON.stringify(G).slice(0, 180));
  ok(gRow.email === 'g@x' && gRow.rows === 5 && gRow.added === 3, 'وسطرها بإيميل صاحبها — ' + JSON.stringify(gRow));
  ok(!/MATH 1422|PHYS 1421|2\.95/.test(JSON.stringify(r.j)), 'ولا درجات في رد اللوحة');

  /* الخصوصية: الملف ما ينحفظ ولا ينطبع */
  ok(!JSON.stringify(DB).includes(PDF64.slice(10, 50)), '**الملف ما ينحفظ في القاعدة**');
  ok(!LOGS.some(l => l.includes('GRADESTESTMARKER') || l.includes(PDF64.slice(10, 50))), 'ولا يطلع في السجل');

  /* ═══ الصفحة ═══ */
  const { chromium } = require('playwright');
  const SEEN = { imports: [], logs: [] };
  let IMPORT_RES = null, AI_ST_RES = { on: true, why: '' };
  const srv = http.createServer((q2, res) => {
    const u = q2.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(SHARED)) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u === '/api/courses') return res.end(JSON.stringify({ success: true, count: 0, courses: [] }));
    if (u === '/api/me/import') { let bd = ''; q2.setEncoding('utf8'); q2.on('data', c => bd += c);
      return q2.on('end', () => { SEEN.imports.push(JSON.parse(bd || '{}')); res.end(JSON.stringify(IMPORT_RES || { ok: false })) }) }
    if (u === '/api/me/import-log') { let bd = ''; q2.setEncoding('utf8'); q2.on('data', c => bd += c);
      return q2.on('end', () => { SEEN.logs.push(JSON.parse(bd || '{}')); res.end('{"ok":true}') }) }
    if (u === '/api/me/ai') return res.end(JSON.stringify(AI_ST_RES));
    if (u === '/api/monitor-status') return res.end(JSON.stringify({ freeBeta: false, plans: {} }));
    if (u.startsWith('/api/me/')) return res.end('{"ok":false}');
    res.end('{}');
  });
  await new Promise(z => srv.listen(0, z));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const SUPA_GUEST = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},upsert:async()=>({error:null}),insert(){return this},delete(){return this},update(){return {eq:async()=>({data:[],error:null})}},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
  const SUPA_USER = `
window.__ROW={id:'u1',email:'g@x.com',name:'Student',major:'MEEN',plan_ver:'new',prep:false,telegram_chat_id:'901'};
function q(t){ const o={ select(){return o}, eq(){return o}, order(){return o}, limit(){return o}, in(){return o}, or(){return o},
  gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:t==='profiles'?window.__ROW:null,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} }, insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:t==='profiles'?[window.__ROW]:[],error:null}).then(f,r) } }; return o }
window.supabase={createClient:()=>({ auth:{ getSession:async()=>({data:{session:{user:{id:'u1',email:'g@x.com'},access_token:'tok'}}}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
  from:t=>q(t), channel:()=>({on(){return this},subscribe(){return this}}), storage:{from:()=>({list:async()=>({data:[],error:null})})} })};`;
  const browser = await chromium.launch();
  const errs = [];
  const open = async supa => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    p.setDefaultTimeout(4000);
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', z => z.fulfill({ status: 200, contentType: 'application/javascript', body: supa }));
    await p.addInitScript(() => { try { localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_seen_welcome', 'true');
      localStorage.setItem('pmu_major', '"MEEN"') } catch (e) {} });
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 15000 });
    await p.waitForTimeout(1200);
    return { ctx, p };
  };
  const sheet = p => p.evaluate(() => { const e = document.getElementById('giSheet');
    const ov = document.getElementById('giOv'); return { open: !!(ov && ov.classList.contains('open')), text: e ? e.innerText : '' } });
  const btn = p => p.evaluate(() => { const b = document.getElementById('giBtn');
    return { shown: !!(b && !b.hidden && b.offsetParent), big: !!(b && b.classList.contains('big')), text: b ? b.textContent : '' } });
  const toasts = p => p.evaluate(() => { window.__T = []; const t = document.getElementById('toast');
    if (t) new MutationObserver(() => { if (t.classList.contains('show')) window.__T.push(t.textContent) })
      .observe(t, { attributes: true, childList: true, characterData: true, subtree: true }) });
  const pickFile = (p, f) => p.setInputFiles('#giFileIn', f).catch(() => {});

  /* ── زائر: الزر في «خطتي» واللوح بخطوات محمد ── */
  {
    const { ctx, p } = await open(SUPA_GUEST);
    await p.evaluate(() => switchTab('plan'));
    await p.waitForTimeout(200);
    const b = await btn(p);
    ok(b.shown && b.big && /Degree Works/.test(b.text), '**«خطتي» فاضية: زر كبير «📥 استورد درجاتك من Degree Works»** — ' + b.text);
    await p.click('#giBtn').catch(() => {});
    let s = await sheet(p);
    ok(s.open && /Student Records/.test(s.text) && /Degree Works/.test(s.text) && /Print/.test(s.text) && /Save to Files/.test(s.text),
       '**اللوح يفتح بالخطوات: بانر ← Student Records ← Degree Works ← Print ← Save to Files**');
    ok(/ما نحفظه/.test(s.text), 'ويقول إن الملف ما ينحفظ');
    await pickFile(p, { name: 'audit.pdf', mimeType: 'application/pdf', buffer: PDF });
    await p.waitForTimeout(300);
    s = await sheet(p);
    ok(/سجّل دخولك/.test(s.text) && SEEN.imports.length === 0, '**زائر يختار ملفاً: «سجّل دخولك» وبلا طلب**');
    eq(SEEN.logs.length, 0, 'والزائر ما ينكتب له شي في السجل');
    await ctx.close();
  }

  /* ── مسجّل: يرفع كشفه ويختار ── */
  {
    const { ctx, p } = await open(SUPA_USER);
    await toasts(p);
    /* خطته فيها مادتان من قبل: وحدة بنفس درجة الكشف، ووحدة بدرجة غيرها */
    await p.evaluate(() => { switchTab('plan'); completed = ['PHYS 1421', 'CHEM 1421'];
      grades = { 'PHYS 1421': 'C+', 'CHEM 1421': 'B' }; save('pmu_completed', completed); save('pmu_grades', grades); renderPlan() });
    await p.waitForTimeout(200);
    const b0 = await btn(p);
    ok(b0.shown && !b0.big, '**خطته فيها مواد: الزر سطر خفيف لا زر كبير**');
    IMPORT_RES = { ok: true, kind: 'grades', gpa: '2.95', skipped: 1, ev: '0123456789ab', rows: [
      { code: 'MATH 1422', grade: 'B+' },     /* من خطته — جديدة */
      { code: 'PHYS 1421', grade: 'C+' },     /* نفس اللي عنده */
      { code: 'CHEM 1421', grade: 'A' },      /* عنده B */
      { code: 'MEEN 4312', grade: 'B' },      /* اختياري تقني */
      { code: 'ARTS 2301', grade: 'A' },      /* مو في خطته */
      { code: 'PRPM 0012', grade: 'P' }] };   /* تحضيري والتحضيري مطفي */
    await p.evaluate(() => { if (typeof openGrades === 'function') openGrades() });
    await pickFile(p, { name: 'Degree Works.pdf', mimeType: 'application/pdf', buffer: PDF });
    await p.waitForTimeout(700);
    const sent = SEEN.imports[SEEN.imports.length - 1] || {};
    ok(sent.kind === 'grades' && sent.media === 'application/pdf' && sent.data === PDF64,
       '**الملف يروح للسيرفر بنوع «درجات» (PDF · base64)**');
    const rows = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#giSheet .im-row')].map(r => {
      const i = r.querySelector('input') || {};
      return [r.dataset.code, { text: r.innerText.replace(/\n/g, ' '), on: !!i.checked, dis: !!i.disabled }] })));
    const R = c => rows[c] || {};
    ok(R('MATH 1422').on && !R('MATH 1422').dis && /جديدة/.test(R('MATH 1422').text) && /B\+/.test(R('MATH 1422').text),
       '**مادة من خطته ما علّمها: مختارة و«جديدة» بدرجتها** — ' + R('MATH 1422').text);
    ok(R('PHYS 1421').dis && !R('PHYS 1421').on && /موجودة في خطتك/.test(R('PHYS 1421').text),
       '**نفس درجتها في «خطتي»: «موجودة» وبلا اختيار**');
    ok(R('CHEM 1421').on && /B/.test(R('CHEM 1421').text) && /تصير/.test(R('CHEM 1421').text),
       '**درجة غير اللي عنده: مختارة وتقول وش كانت ووش تصير** — ' + R('CHEM 1421').text);
    ok(R('MEEN 4312').on && /اختياري تقني/.test(R('MEEN 4312').text),
       '**الاختياري التقني: مختار ويقول علّم خانته في الخطة** — ' + R('MEEN 4312').text);
    ok(R('ARTS 2301').dis && !R('ARTS 2301').on && /مو في خطتك/.test(R('ARTS 2301').text),
       '**مو في خطته: يبان «مو في خطتك» وبلا اختيار** — «خطتي» ما تحسبها أصلاً');
    ok(R('PRPM 0012').dis && !R('PRPM 0012').on, 'ومادة التحضيري والتحضيري مطفي: بلا اختيار');
    let s = await sheet(p);
    ok(/التحضيري/.test(s.text) && /الإعدادات/.test(s.text) && await p.evaluate(() => !!document.getElementById('giPrep')),
       '**ومعها: «فعّل أنا في البرنامج التحضيري من الإعدادات وارجع استورد»**');
    ok(/مادتين مو في خطتك ما تنضاف/.test(s.text) && /اختياري/.test(s.text),
       '**وسطر: «مادتين مو في خطتك ما تنضاف — لو منها اختياري علّم خانته»**');
    ok(/2\.95/.test(s.text) && /Degree Works/.test(s.text), '**ومعدله في Degree Works يبان، وإن معدل «خطتي» ممكن يفرق**');
    ok(/1 سطر ما انقرأت درجته/.test(s.text), 'والسطر اللي ما انقرأ يُقال');
    const addTxt = () => p.evaluate(() => (document.getElementById('giAddBtn') || {}).textContent || '');
    ok(/أضف 3 مواد/.test(await addTxt()), '**الزر يعدّ المختارة: «أضف 3 مواد لـ«خطتي»»** — ' + await addTxt());
    await p.evaluate(() => { const i = document.querySelector('#giSheet .im-row[data-code="MEEN 4312"] input'); if (i) i.click() });
    ok(/أضف مادتين/.test(await addTxt()), 'شال وحدة: «أضف مادتين»');
    await p.evaluate(() => { const i = document.querySelector('#giSheet .im-row[data-code="MEEN 4312"] input'); if (i) i.click() });
    await p.evaluate(() => { if (typeof GI === 'undefined') return; const k = GI.rows.findIndex(x => x.code === 'ARTS 2301'); if (k >= 0) giToggle(k, true) });
    ok(/أضف 3 مواد/.test(await addTxt()), 'رجّعها — والمادة اللي مو في خطته ما تنختار ولو بالقوة');
    await p.click('#giAddBtn').catch(() => {});
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => {
      const sel = c => { const pc = [...document.querySelectorAll('#planSemesters .pc')].find(x => (x.querySelector('.pc-code') || {}).textContent
        && x.querySelector('.pc-code').textContent.startsWith(c)); const g = pc && pc.querySelector('.grade-sel');
        return { done: !!(pc && pc.classList.contains('done')), g: g ? g.value : null, dir: g ? getComputedStyle(g).direction : null } };
      const ov = document.getElementById('giOv');
      return { completed: completed.slice().sort(), grades: Object.assign({}, grades),
        lsC: JSON.parse(localStorage.getItem('pmu_completed') || '[]').length, lsG: JSON.parse(localStorage.getItem('pmu_grades') || '{}'),
        open: !!(ov && ov.classList.contains('open')), math: sel('MATH 1422'), chem: sel('CHEM 1421'),
        gpa: calcGPA(), toasts: (window.__T || []).join(' | ') } });
    eq(after.completed, ['CHEM 1421', 'MATH 1422', 'MEEN 4312', 'PHYS 1421'],
       '**انضافت المختارة لـ«خطتي» — واللي مو في خطته والتحضيري لا**');
    eq([after.grades['MATH 1422'], after.grades['CHEM 1421'], after.grades['MEEN 4312'], after.grades['PHYS 1421']],
       ['B+', 'A', 'B', 'C+'], '**بدرجاتها — والدرجة المختلفة صارت درجة الكشف**');
    ok(after.lsC === 4 && after.lsG['CHEM 1421'] === 'A', 'وانحفظت (pmu_completed · pmu_grades)');
    ok(after.math.done && after.math.g === 'B+' && after.chem.g === 'A', '**والخطة ترسمها منجزة بدرجتها في قائمة الدرجة** — ' + JSON.stringify(after.math));
    ok(after.math.dir === 'ltr', '**وقائمة الدرجة من اليسار لليمين: «B+» لا «+B»** (نص فيه + داخل سياق عربي ينقلب) — ' + after.math.dir);
    ok(after.gpa && after.gpa.n === 4 && after.gpa.gpa > 0, '**والمعدل انحسب منها (٤ مواد — والتقني منها)** — ' + JSON.stringify(after.gpa));
    ok(!after.open && /انضافت 3 مواد لـ«خطتي»/.test(after.toasts), 'اللوح انقفل، و«✅ انضافت 3 مواد لـ«خطتي» بدرجاتها» — ' + after.toasts);
    await wait(200);
    const L1 = SEEN.logs[SEEN.logs.length - 1] || {};
    ok(SEEN.logs.length === 1 && L1.ev === '0123456789ab' && L1.kind === 'grades' && L1.src === 'pdf' && L1.outcome === 'added' &&
       L1.found === 4 && L1.missing === 2 && L1.warned === 1 && L1.added === 3,
       '**السجل: نفس رقم القراءة · درجات · لقينا ٤ في خطته · ٢ برّاها · ١ درجته تغيّرت · أضاف ٣** — ' + JSON.stringify(L1));
    ok(!/MATH|PHYS|CHEM|MEEN|ARTS|PRPM|B\+|2\.95/.test(JSON.stringify(SEEN.logs)), 'وبلا رموز مواد ولا درجات');

    /* نسخة الخطة: أغلب اللي مو في خطته في النسخة الثانية ⇒ نقولها */
    const oldOnly = await p.evaluate(() => { const codes = v => new Set(PlanLogic.planOf(MAJOR, v).sems.flatMap(s => s.courses.map(c => c.c)));
      const n = codes('new'); return [...codes('old')].filter(c => !n.has(c) && !/^ELEC/.test(c)).slice(0, 3) });
    IMPORT_RES = { ok: true, kind: 'grades', gpa: '', ev: 'bbbbbbbbbbbb', rows: oldOnly.map(c => ({ code: c, grade: 'B' }))
      .concat([{ code: 'MATH 1423', grade: 'C' }]) };
    await p.evaluate(() => { if (typeof openGrades === 'function') openGrades() });
    await pickFile(p, { name: 'audit.pdf', mimeType: 'application/pdf', buffer: PDF });
    await p.waitForTimeout(600);
    s = await sheet(p);
    ok(oldOnly.length === 3 && /الخطة القديمة/.test(s.text) && /نسخة خطتك/.test(s.text) &&
       await p.evaluate(() => !!document.getElementById('giAlt')),
       '**أغلب اللي مو في خطته في القديمة: «يمكن نسخة خطتك غلط — غيّرها وارجع استورد»** — ' + oldOnly.join(','));
    ok(!(await p.evaluate(() => !!document.getElementById('giPrep'))), 'وبلا سطر التحضيري هنا (ما فيه مواد تحضيري)');
    await p.evaluate(() => { if (typeof closeGrades === 'function') closeGrades() });
    await wait(200);
    const L2 = SEEN.logs[SEEN.logs.length - 1] || {};
    ok(SEEN.logs.length === 2 && L2.kind === 'grades' && L2.outcome === 'closed' && L2.ev === 'bbbbbbbbbbbb',
       '**قفل اللوح وقت المراجعة: «قفل» في السجل** — ' + JSON.stringify(L2));
    await p.evaluate(() => { if (typeof closeGrades === 'function') closeGrades() });
    await wait(100);
    eq(SEEN.logs.length, 2, 'والقفل مرة ثانية ما يكرره');

    /* رفض السيرفر: رسالته كما هي، وما تتكرر في السجل */
    IMPORT_RES = { ok: false, why: 'notaudit', ev: 'cccccccccccc',
      msg: 'هذا مو كشف Degree Works. افتح Degree Works من بانر واطبعه، وجرّب ثانية.' };
    await p.evaluate(() => { if (typeof openGrades === 'function') openGrades() });
    await pickFile(p, { name: 'x.pdf', mimeType: 'application/pdf', buffer: PDF });
    await p.waitForTimeout(500);
    s = await sheet(p);
    ok(/مو كشف Degree Works/.test(s.text) && /Student Records/.test(s.text), '**مو كشف: رسالة السيرفر، والخطوات باقية تحتها**');
    await p.evaluate(() => { if (typeof closeGrades === 'function') closeGrades() });
    await wait(150);
    eq(SEEN.logs.length, 2, 'ورفض السيرفر ما تكرره الصفحة — السيرفر سجّله');
    IMPORT_RES = { ok: false, why: 'off', msg: 'المساعد مقفل حالياً — باقي الموقع شغّال عادي.' };
    await p.evaluate(() => { if (typeof openGrades === 'function') openGrades() });
    await pickFile(p, { name: 'x.pdf', mimeType: 'application/pdf', buffer: PDF });
    await p.waitForTimeout(500);
    s = await sheet(p);
    ok(/مو متاحة الحين/.test(s.text) && /علّم موادك/.test(s.text), '**المساعد انقفل: «قراءة الملفات مو متاحة — علّم موادك من الخطة»**');
    await p.evaluate(() => { if (typeof closeGrades === 'function') closeGrades() });
    /* كبير · نوع غلط: من الصفحة قبل ما يوصلنا */
    const nImp = SEEN.imports.length;
    await p.evaluate(() => { if (typeof openGrades === 'function') openGrades() });
    await pickFile(p, { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(700 * 1024, 65)]) });
    await wait(300);
    const LB = SEEN.logs[SEEN.logs.length - 1] || {};
    ok(SEEN.imports.length === nImp && LB.kind === 'grades' && LB.outcome === 'big' && !LB.ev,
       '**PDF كبير: «كبير» في السجل من الصفحة، وما نرسله** — ' + JSON.stringify(LB));
    await p.evaluate(() => { if (typeof openGrades === 'function') openGrades() });
    await pickFile(p, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await p.waitForTimeout(300);
    s = await sheet(p);
    ok(/PDF من Degree Works/.test(s.text) && (SEEN.logs[SEEN.logs.length - 1] || {}).outcome === 'type',
       'ملف نصي: «اختر ملف PDF من Degree Works» و«نوع غلط» في السجل');
    /* بالإنجليزي */
    const en = await p.evaluate(() => { if (typeof renderGrades !== 'function') return ''; LANG = 'en'; GI.state = 'pick'; GI.msg = ''; renderGrades();
      const t = document.getElementById('giSheet').innerText; LANG = 'ar'; renderGrades(); return t });
    ok(/Degree Works/.test(en) && /Save to Files/.test(en) && !/ادخل|اختر ملف/.test(en), 'واللوح بالإنجليزي كامل');
    await p.evaluate(() => { if (typeof closeGrades === 'function') closeGrades() });
    /* بلا تخصص: ما فيه خطة ⇒ ما فيه زر */
    const nomaj = await p.evaluate(() => { localStorage.removeItem('pmu_major'); renderPlan();
      const b = document.getElementById('giBtn'); return !!(b && b.hidden) });
    ok(nomaj, '**ما اختار تخصصه: الزر مخفي** — ما فيه خطة نحط عليها');
    await ctx.close();
  }

  /* ── المساعد مقفل: ما فيه قراءة ملفات ⇒ الزر مخفي ── */
  {
    AI_ST_RES = { on: false, why: 'off', msg: 'المساعد مقفل' };
    const { ctx, p } = await open(SUPA_USER);
    await p.evaluate(() => switchTab('plan'));
    await p.waitForTimeout(200);
    const b = await p.evaluate(() => { const e = document.getElementById('giBtn'); return { exists: !!e, hidden: !!(e && e.hidden) } });
    ok(b.exists && b.hidden, '**المساعد مقفل: زر استيراد الدرجات مخفي** — بلا طريق مسدود');
    await ctx.close();
  }
  ok(errs.length === 0, 'الصفحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
  await browser.close(); srv.close();

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + (e && e.stack || e)); process.exit(1) });
