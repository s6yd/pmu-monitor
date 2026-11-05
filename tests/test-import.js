/* استيراد الجدول من ملف الجامعة — السيرفر (/api/me/import) والصفحة («جدولي»).
   طلب محمد (٤ نوفمبر ٢٠٢٦): الطلاب ودّهم الموقع يجيب جدولهم من الجامعة. الطالب يطلعه من بانر
   (Student Records ← Print Class Schedule ← Share ← Print ← A3 ← Save to Files) أو يصوّره، أو يلصق
   أرقام CRN — والنموذج يقرأ أرقام الشعب وحدها، والباقي من بيانات الجامعة، والطالب يأكّد قبل الإضافة.
   node tests/test-import.js [server.js] [pmu-schedule.html] */
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

/* ═══ محاكي القاعدة والمزوّد ═══ */
const U1 = 'tok-u1-aaaaaaaaaaaaaaaaaaaa';
/* معرّف بشكل UUID مثل الإنتاج: سجل الاستيراد في اللوحة يجيب الإيميل للمعرّفات بشكل UUID وحدها (isUuid) */
const UID = '0b7e2c1a-4d3f-4a5b-9c8d-1e2f3a4b5c6d';
const TOK = { [U1]: UID };
let nextId = 100;
const DB = {
  profiles: [{ id: UID, name: 'Student', email: 's@x', telegram_chat_id: null, is_pro: false,
               subscription_expires_at: null }],
  ai_usage: [], ai_spend_day: [], ai_threads: [], app_state: [], app_events: [], monitored_courses: []
};
const AI = [];                 /* كل نداء وصل للمزوّد */
let AI_REPLY = null;           /* payload ⇒ { status, json } */
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

const PORT = 22500 + (process.pid % 100), TOKEN = 'admin-token-for-tests';
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

/* ملف PDF صغير بأول بايتاته الحقيقية — والمحتوى نفسه ما يهم (النموذج محاكى) */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% IMPORTTESTMARKER\ntrailer\n%%EOF\n');
const PDF64 = PDF.toString('base64');
const PNG64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/* رد بصيغة المزوّد: نص JSON (output_config.format) واستهلاك */
const reply = (obj, extra) => () => ({ status: 200, json: Object.assign({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  usage: { input_tokens: 2100, output_tokens: 350, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
}, extra || {}) });

(async () => {
  await wait(400);

  /* ═══ السيرفر ═══ */
  let r = await call('/api/me/import', 'POST', { body: { kind: 'schedule', media: 'application/pdf', data: PDF64 } });
  eq(r.status, 401, 'بلا حساب: ٤٠١ — القراءة سؤال للمساعد على حساب الطالب');

  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'off' && AI.length === 0,
     '**المساعد مقفل (off): ولا نداء للمزوّد** — ' + JSON.stringify(r.j));

  await call('/api/admin/ai', 'POST', { admin: true, body: { mode: 'all' } });

  r = await imp({ kind: 'schedule', media: 'text/plain', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'type' && AI.length === 0, 'نوع غير PDF/صورة: مرفوض قبل المزوّد');
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: Buffer.from('<html>not a pdf</html>').toString('base64') });
  ok(r.j.ok === false && r.j.why === 'type' && AI.length === 0, '**«PDF» بلا بايتات PDF: مرفوض** — النوع من الملف لا من الاسم');
  r = await imp({ kind: 'schedule', media: 'image/png', data: 'not base64 at all!' });
  ok(r.j.ok === false && r.j.why === 'type', 'نص مو base64: مرفوض');
  const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(700 * 1024, 65)]).toString('base64');
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: bigPdf });
  ok(r.j.ok === false && r.j.why === 'big' && /A3/.test(r.j.msg || '') && AI.length === 0,
     '**PDF فوق ٦٠٠ كيلو: «اطبعه على A3» — قبل ما نرسل شي** — ' + JSON.stringify(r.j).slice(0, 120));
  r = await call('/api/me/import', 'POST', { tok: U1, raw: JSON.stringify({ media: 'image/png', data: 'A'.repeat(2.3e6) }) });
  ok(r.status === 200 && r.j.why === 'big', 'جسم الطلب فوق الحد: «كبير» بلا انهيار');

  /* قراءة ناجحة: النموذج يرجّع صفوفاً، والسيرفر يقبل الشكل الصحيح وحده */
  AI_REPLY = reply({ kind: 'schedule', term: '202710', rows: [
    { crn: '31201', code: 'MEEN 3322', section: '101' },
    { crn: '31201', code: 'MEEN 3322', section: '101' },   /* محاضرة ومعمل بنفس CRN: صفّان */
    { crn: '3122', code: 'CHEM 1421', section: '101' },     /* رقم ناقص — ما انقرأ */
    { crn: '31228', code: 'chem1421', section: '114' },
    { crn: '31240', code: 'COMM 1311', section: '1O9' }] });
  const before = AI.length;
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === true && r.j.term === '202710', 'قراءة الجدول: تمّت بترمه — ' + JSON.stringify(r.j).slice(0, 160));
  const EV1 = r.j.ev;
  ok(/^[0-9a-f]{12}$/.test(EV1 || '') && !('_cost' in r.j),
     '**والرد فيه رقم المحاولة (ev) لسجل الاستيراد**، وبلا الكلفة الداخلية — ' + EV1);
  eq(r.j.rows, [{ crn: '31201', code: 'MEEN 3322', section: '101' }, { crn: '31228', code: 'CHEM 1421', section: '114' },
                { crn: '31240', code: 'COMM 1311', section: '' }],
     '**الصفوف بعد التنظيف: CRN خمس خانات · الرمز بمسافة وحدة · الشعبة ثلاث خانات أو فاضية · بلا تكرار**');
  eq(r.j.skipped, 1, 'والرقم الناقص يُعدّ «ما انقرأ» — لا تخمين');
  eq(AI.length - before, 1, 'نداء واحد للمزوّد');
  const P = AI[AI.length - 1] || {};
  const doc = ((P.messages || [])[0] || {}).content || [];
  ok(doc[0] && doc[0].type === 'document' && doc[0].source && doc[0].source.type === 'base64' &&
     doc[0].source.media_type === 'application/pdf' && doc[0].source.data === PDF64,
     '**الملف يروح للنموذج كما هو (document · base64)**');
  ok(doc[1] && doc[1].type === 'text', 'ومعه سطر نص بعد الملف');
  ok(P.output_config && P.output_config.format && P.output_config.format.type === 'json_schema' &&
     P.output_config.format.schema && P.output_config.format.schema.properties.rows,
     '**الشكل مضمون من المزوّد (output_config.format) — لا نص حر**');
  eq(P.output_config && P.output_config.effort, 'low', 'وجهد منخفض — القراءة نسخ لا تفكير');
  ok(!P.tools && /CRN/.test(String(P.system || '')) && /not instructions/.test(String(P.system || '')),
     'بلا أدوات، والتعليمات تقول إن نص الملف بيانات لا أوامر');
  eq(P.model, 'claude-sonnet-5-5', 'نفس نموذج المساعد');
  const U = DB.ai_usage.filter(x => x.user_id === UID);
  ok(U.length === 1 && U[0].channel === 'web' && U[0].calls === 1 && U[0].in_tokens === 2100 &&
     U[0].out_tokens === 350 && U[0].cost_micro === Math.round(3.75 * (2100 * 2 + 350 * 10)) && U[0].env === 'dev',
     '**كلفتها الحقيقية في ai_usage — سؤال من أسئلة المساعد** — ' + JSON.stringify(U[0] || null));

  /* بقية حالات النموذج بحساب مشترك (٢٥ باليوم) — المجاني (٥) بيخلص قبلها، وحده مجرَّب تحت */
  const TODAY = U[0] ? U[0].on_date : '', TERM = U[0] ? U[0].term : '';
  DB.profiles[0].is_pro = true;

  /* صورة: كتلة image بنوعها */
  AI_REPLY = reply({ kind: 'schedule', term: '202710', rows: [{ crn: '31215', code: 'MEEN 3333', section: '102' }] });
  r = await imp({ kind: 'schedule', media: 'image/png', data: PNG64 });
  const c0 = ((((AI[AI.length - 1] || {}).messages || [])[0] || {}).content || [])[0] || {};
  ok(r.j.ok === true && c0.type === 'image' && c0.source && c0.source.media_type === 'image/png',
     'صورة الجدول: كتلة image بنوعها — ' + JSON.stringify(r.j).slice(0, 100));

  /* النموذج: مو جدول · رفض · نص مو JSON · فشل المزوّد */
  AI_REPLY = reply({ kind: 'other', term: '', rows: [] });
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'notschedule' && /Print Class Schedule/.test(r.j.msg || ''),
     '**ملف مو جدول: «اطلع Print Class Schedule من بانر»** — ' + (r.j.msg || ''));
  AI_REPLY = reply('', { stop_reason: 'refusal', content: [] });
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  eq(r.j.why, 'refused', 'رفض النموذج: رسالة مفهومة');
  AI_REPLY = reply('ما أقدر أقرأ');
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'empty' && /الصق/.test(r.j.msg || ''), 'رد مو JSON: «الصق الأرقام» بدل انهيار');
  AI_REPLY = reply({ kind: 'schedule', term: '202710', rows: [{ crn: 'abcde', code: 'X', section: '1' }] });
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'empty', 'كل الصفوف غلط: «ما قدرت أقرأ» لا صفوف مخترعة');
  const usedBefore = DB.ai_usage.length;
  AI_REPLY = () => ({ status: 500, json: { type: 'error', error: { type: 'api_error' } } });
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'error' && DB.ai_usage.length === usedBefore,
     'المزوّد تعطّل: «صار خلل» وبلا سطر كلفة (ما انصرف شي)');

  /* السقف اليومي للمجاني (٥) يحرسه — القراءة سؤال */
  DB.profiles[0].is_pro = false;
  ok(DB.ai_usage.filter(x => x.user_id === UID && x.on_date === TODAY).length >= 5,
     '**كل قراءة انكتبت سؤالاً في يومه** — ' + DB.ai_usage.length);
  for (let i = DB.ai_usage.filter(x => x.user_id === UID && x.on_date === TODAY).length; i < 5; i++)
    DB.ai_usage.push({ id: nextId++, user_id: UID, env: 'dev', term: TERM, on_date: TODAY, calls: 1, cost_micro: 1 });
  const aiBefore = AI.length;
  AI_REPLY = reply({ kind: 'schedule', term: '202710', rows: [{ crn: '31201', code: 'MEEN 3322', section: '101' }] });
  r = await imp({ kind: 'schedule', media: 'application/pdf', data: PDF64 });
  ok(r.j.ok === false && r.j.why === 'day' && AI.length === aiBefore && /خلصت/.test(r.j.msg || ''),
     '**خلصت أسئلته اليومية: ما نقرأ — نفس سقف المساعد** — ' + JSON.stringify(r.j).slice(0, 120));

  /* الخصوصية: الملف ما ينحفظ في أي جدول ولا يطلع في السجل */
  const dump = JSON.stringify(DB);
  ok(!dump.includes(PDF64.slice(10, 50)) && !dump.includes(PNG64.slice(10, 50)),
     '**الملف ما ينحفظ في القاعدة** (ولا في المحادثة)');
  ok(!LOGS.some(l => l.includes(PDF64.slice(10, 50)) || l.includes('IMPORTTESTMARKER')),
     '**ولا يطلع في السجل** — حتى وقت الفشل');

  /* ═══ سجل الاستيراد — طلب محمد (٥ نوفمبر ٢٠٢٦: «نعرف الي استخدم هذي الميزات ونشوف لو نجحت او اذا فشلت») ═══
     حدث في app_events لكل قراءة (السيرفر) ولنتيجتها (الصفحة) — أعداد ورموز، بلا شي من الملف */
  await wait(150);
  const evs = () => DB.app_events.filter(x => x.kind === 'import').map(x => x.payload || {});
  const reads = evs().filter(p => p.stage === 'read');
  const r1 = reads.find(p => p.ev === EV1) || {};
  ok(r1.user === UID && r1.kind === 'schedule' && r1.src === 'pdf' && r1.outcome === 'ok' && r1.rows === 3 &&
     r1.skipped === 1 && r1.cost === Math.round(3.75 * (2100 * 2 + 350 * 10)) && r1.env === 'dev',
     '**كل قراءة تنكتب في السجل: مين · من وين · النتيجة · كم انقرأ · كم ما انقرأ · كلفتها** — ' + JSON.stringify(r1));
  const outs = new Set(reads.map(p => p.outcome));
  ok(['off', 'type', 'big', 'ok', 'notschedule', 'refused', 'empty', 'error', 'day'].every(o => outs.has(o)),
     '**والفشل بسببه**: مقفل · نوع غلط · كبير · مو جدول · رفض · ما انقرأ · خلل · خلصت أسئلته — ' + [...outs].join(','));
  ok(reads.some(p => p.src === 'image' && p.outcome === 'ok'), 'والصورة مصدرها «صورة»');
  ok(reads.every(p => /^[0-9a-f]{12}$/.test(p.ev || '')) && new Set(reads.map(p => p.ev)).size === reads.length,
     'ولكل محاولة رقم خاص بها');
  eq(reads.length, 14, 'محاولة مسجّلة لكل نداء بحساب (والطلب بلا حساب ما ينكتب)');
  ok(reads.some(p => p.src === 'other' && p.outcome === 'type'), 'ونوع ما نعرفه مصدره «غير معروف» لا «ملف PDF»');
  const logDump = JSON.stringify(DB.app_events);
  ok(!/31201|31228|MEEN 3322|CHEM 1421|IMPORTTESTMARKER/.test(logDump) && !logDump.includes(PDF64.slice(10, 50)),
     '**ولا شي من محتوى الملف في السجل** — لا CRN ولا رمز مادة ولا الملف');

  /* نتيجة الصفحة: كم لقينا وكم أضاف — بنفس رقم المحاولة */
  const LG = body => call('/api/me/import-log', 'POST', { tok: U1, body });
  eq((await call('/api/me/import-log', 'POST', { body: { kind: 'schedule', src: 'pdf', outcome: 'added' } })).status, 401,
     'نتيجة الصفحة بلا حساب: ٤٠١');
  eq((await LG({ kind: 'schedule', src: 'pdf', outcome: 'hacked' })).status, 400, 'نتيجة ما نعرفها: مرفوضة');
  eq((await LG({ kind: 'transcript', src: 'pdf', outcome: 'added' })).status, 400, 'ونوع ما نعرفه: مرفوض');
  r = await LG({ ev: EV1, kind: 'schedule', src: 'pdf', outcome: 'added', found: 3, missing: 1, warned: 1, added: 2,
                 note: 'MEEN 3322 تجربة', crns: ['31201'] });
  ok(r.status === 200 && r.j.ok === true, 'النتيجة انكتبت — ' + JSON.stringify(r.j));
  await wait(100);
  const d1 = evs().find(p => p.stage === 'done' && p.ev === EV1) || {};
  ok(d1.user === UID && d1.outcome === 'added' && d1.found === 3 && d1.missing === 1 && d1.warned === 1 && d1.added === 2,
     '**الصفحة تكمّل: لقينا ٣ · ما لقينا ١ · بتحذير ١ · أضاف ٢ — بنفس الرقم** — ' + JSON.stringify(d1));
  ok(!('note' in d1) && !('crns' in d1) && !/31201|MEEN/.test(JSON.stringify(d1)),
     'وأي حقل ثاني من الصفحة ما ينكتب (لا نص ولا أرقام شعب)');
  await LG({ kind: 'schedule', src: 'paste', outcome: 'nocrn' });
  await LG({ ev: 'zz-not-hex', kind: 'schedule', src: 'paste', outcome: 'added', found: 2, added: 99999 });
  await wait(100);
  const pastes = evs().filter(p => p.stage === 'done' && p.src === 'paste');
  ok(pastes.length === 2 && pastes.every(p => /^[0-9a-f]{12}$/.test(p.ev)) && pastes.some(p => p.added === 500),
     'اللصق محاولة لحالها برقم جديد، والأرقام بحدّها — ' + JSON.stringify(pastes.map(p => [p.outcome, p.added])));

  /* اللوحة: سطر لكل محاولة بإيميل صاحبها، وملخّص */
  DB.app_events.push({ id: nextId++, kind: 'import', at: new Date().toISOString(),
    payload: { ev: 'aaaaaaaaaaaa', stage: 'read', env: 'prod', user: UID, kind: 'schedule', src: 'pdf', outcome: 'ok', rows: 9, at: Date.now() } });
  eq((await call('/api/admin/import-log', 'GET')).status, 401, 'سجل الاستيراد في اللوحة برمزها وحده');
  r = await call('/api/admin/import-log', 'GET', { admin: true });
  const A = r.j || {}, S = (A.summary || {}).schedule || {};
  const row1 = (A.recent || []).find(e => e.rows === 3 && e.added === 2) || {};
  ok(A.ok === true && row1.email === 's@x' && row1.outcome === 'added' && row1.found === 3 && row1.missing === 1 &&
     row1.warned === 1 && row1.skipped === 1 && row1.src === 'pdf' && row1.sar > 0,
     '**اللوحة: القراءة ونتيجتها سطر واحد بإيميل صاحبها** — ' + JSON.stringify(row1));
  ok((A.recent || []).some(e => e.src === 'image' && e.outcome === 'left'),
     'وانقرأ وما كمّل (قفل قبل ما يختار) يبان «ما كمّل»');
  ok(S.tries >= 15 && S.added >= 2 && S.courses >= 2 && S.users === 1 && S.failed >= 9 &&
     S.reasons && S.reasons.notschedule >= 1 && S.reasons.day >= 1 && S.reasons.nocrn >= 1,
     '**والملخّص: محاولات · أضافوا · مواد · طلاب · فشلت وأسبابها** — ' + JSON.stringify(S).slice(0, 200));
  ok(!(A.recent || []).some(e => e.rows === 9), 'ومحاولات البيئة الثانية ما تختلط (القاعدة مشتركة)');
  ok(!/31201|31228|MEEN 3322|IMPORTTESTMARKER/.test(JSON.stringify(A)), 'ولا محتوى ملف في رد اللوحة');

  /* سقف: الصفحة ما تقدر تعبّي السجل */
  let last = 200;
  for (let i = 0; i < 45 && last !== 429; i++) last = (await LG({ kind: 'schedule', src: 'paste', outcome: 'closed' })).status;
  eq(last, 429, 'نتائج الصفحة بسقف لكل طالب بالساعة — ما تعبّي السجل');

  /* ═══ الصفحة ═══ */
  const { chromium } = require('playwright');
  const C = (crn, code, title, sec, days, time, ins, room) => ({ crn, courseCode: code, courseTitle: title, section: sec,
    courseDate: days, courseTiming: time, instructor: ins, room, status: 'CLOSE', gender: sec[0] === '2' ? 'F' : 'M' });
  /* صيغة الجامعة حرفاً بحرف: الوقت بلا نقطتين · الأيام حروف · المعمل من العنوان · محاضرة ومعمل بنفس CRN صفّان */
  const COURSES = [
    C('31201', 'MEEN 3322', 'Mechanics of Materials', '101', 'UT', '0800 - 0915', 'Doe, Jane', 'M-COE - G101'),
    C('31215', 'MEEN 3333', 'Fluid Mechanics', '102', 'MW', '1100 - 1215', 'Roe, Rick', 'M-CORE - F110'),
    C('31220', 'CHEM 1421', 'Chemistry &amp; Materials', '101', 'UT', '1400 - 1450', 'Poe, Ella', 'M-SCI - 120'),
    C('31228', 'CHEM 1421', 'Chemistry&amp;Materials LAB', '114', 'W', '1500 - 1745', 'Moe, Sam', 'M-SCI - L130'),
    C('20031', 'PHYS 1421', 'Physics for Engineers I', '101', 'MW', '0930 - 1045', 'Brown, Mark', 'M-SCI - 201'),
    C('20031', 'PHYS 1421', 'Physics for Engineers I', '101', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L105'),
    C('20231', 'PHYS 1421', 'Physics for Engineers I', '201', 'MW', '0930 - 1045', 'Smith, Sara', 'F-SCI - 201')
  ];
  const SEEN = { courses: [], imports: [], logs: [] };
  let IMPORT_RES = null, AI_ST_RES = { on: true, why: '' };
  const srv = http.createServer((q2, res) => {
    const u = q2.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(SHARED)) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u === '/api/courses') { SEEN.courses.push(q2.url);
      return res.end(JSON.stringify({ success: true, count: COURSES.length, courses: COURSES })) }
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
  const errs = [];
  const open = async supa => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    p.setDefaultTimeout(4000);                 /* عنصر ناقص (الكود القديم) = ✗ سريع لا انتظار ٣٠ ثانية */
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', z => z.fulfill({ status: 200, contentType: 'application/javascript', body: supa }));
    await p.addInitScript(() => { try { localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_seen_welcome', 'true');
      localStorage.setItem('pmu_major', '"MEEN"') } catch (e) {} });
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 15000 });
    await p.waitForTimeout(1200);              /* الجلسة والملف وحالة المساعد توصل */
    return { ctx, p };
  };
  const sheet = p => p.evaluate(() => { const e = document.getElementById('imSheet');
    const ov = document.getElementById('imOv'); return { open: !!(ov && ov.classList.contains('open')), text: e ? e.innerText : '' } });
  const toasts = p => p.evaluate(() => { window.__T = []; const t = document.getElementById('toast');
    if (t) new MutationObserver(() => { if (t.classList.contains('show')) window.__T.push(t.textContent) })
      .observe(t, { attributes: true, childList: true, characterData: true, subtree: true }) });

  /* ── زائر: «جدولي» الفاضي ولصق الأرقام ── */
  {
    const { ctx, p } = await open(SUPA_GUEST);
    await toasts(p);
    const v = await p.evaluate(() => { switchTab('sched');
      const e = document.querySelector('#schedEmpty .im-open'), b = document.getElementById('imBtn');
      return { empty: !!(e && e.offsetParent), small: !!(b && !b.hidden), label: e ? e.textContent : '' } });
    ok(v.empty && /استورد جدولك من بانر/.test(v.label), '**«جدولك فاضي»: زر «📥 استورد جدولك من بانر»** — ' + v.label);
    ok(!v.small, 'والسطر الصغير تحت الأزرار مخفي — ما يتكرر الزر');
    await p.click('#schedEmpty .im-open').catch(() => {});
    let s = await sheet(p);
    ok(s.open && /Student Records/.test(s.text) && /Print Class Schedule/.test(s.text) && /A3/.test(s.text) &&
       /Save to Files/.test(s.text), '**اللوح يفتح بخطوات محمد: Student Records ← Print Class Schedule ← A3 ← Save to Files**');
    ok(/ما نحفظه/.test(s.text), 'ويقول إن الملف ما ينحفظ');

    /* ملف بلا حساب: «سجّل دخولك» بلا طلب */
    await p.setInputFiles('#imFileIn', { name: 'schedule.pdf', mimeType: 'application/pdf', buffer: PDF }).catch(() => {});
    await p.waitForTimeout(300);
    s = await sheet(p);
    ok(/سجّل دخولك/.test(s.text) && SEEN.imports.length === 0, '**زائر يختار ملفاً: «سجّل دخولك — أو الصق الأرقام» وبلا طلب**');

    /* لصق: أرقام هندية · رقم جامعي تسع خانات ما ينحسب · رقم ما له شعبة */
    await p.fill('#imPaste', 'CRN: 31201، 31228 و ٢٠٠٣١ و 99999 — رقمي 201912345').catch(() => {});
    await p.click('#imSheet .im-row2 .btn-sm').catch(() => {});
    await p.waitForTimeout(500);
    s = await sheet(p);
    const lastQ = SEEN.courses[SEEN.courses.length - 1] || '';
    ok(/term=202710/.test(lastQ) && /college=ALL/.test(lastQ) && /gender=ALL/.test(lastQ),
       'اللصق يدوّر في بيانات الجامعة (/api/courses) بترم البحث — ' + lastQ);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#imSheet .im-row')].map(r => ({
      crn: r.dataset.crn, text: r.innerText, on: !!(r.querySelector('input') || {}).checked })));
    eq(rows.map(r => r.crn), ['31201', '31228', '20031'], '**الأرقام الثلاثة لقيناها — والهندية انقلبت، والرقم الجامعي ما انحسب**');
    ok(rows.length === 3 && rows.every(r => r.on), 'وكلها مختارة');
    ok(/MW 0930 - 1045/.test((rows[2] || {}).text || '') && /R 1300 - 1550/.test((rows[2] || {}).text || ''),
       '**المحاضرة والمعمل بنفس CRN سطر وحد باجتماعين**');
    ok(/Chemistry&Materials LAB/.test((rows[1] || {}).text || ''), 'والنص بعد فك &amp;');
    ok(/99999/.test(s.text) && /ما لقينا/.test(s.text), '**والرقم اللي ما له شعبة: «ما لقينا في خريف 2026/2027: 99999»**');
    /* نشيل المعمل ونضيف */
    await p.evaluate(() => { const i = document.querySelector('#imSheet .im-row[data-crn="31228"] input'); if (i) i.click() });
    const btn = await p.evaluate(() => (document.getElementById('imAddBtn') || {}).textContent || '');
    ok(/أضف مادتين/.test(btn), '**الزر يعدّ المواد: «أضف مادتين لـ«جدول 1»»** — ' + btn);
    await p.click('#imAddBtn').catch(() => {});
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => { const ov = document.getElementById('imOv'), b = document.getElementById('imBtn');
      return { crns: schedule.map(c => c.crn), open: !!(ov && ov.classList.contains('open')),
      saved: (JSON.parse(localStorage.getItem('pmu_schedules') || '[[]]')[0] || []).length, toasts: (window.__T || []).join(' | '),
      small: !!(b && !b.hidden) } });
    eq(after.crns, ['31201', '20031', '20031'], '**انضافت: MEEN 3322 والفيزياء باجتماعيها — والمعمل اللي شلناه لا**');
    ok(!after.open && after.saved === 3, 'اللوح انقفل، والجدول انحفظ');
    ok(/انضافت مادتين/.test(after.toasts), 'ورسالة «✅ انضافت مادتين لـ«جدول 1»» — ' + after.toasts);
    ok(after.small, 'والجدول صار فيه مواد: السطر الصغير «📥 استورد» تحت الأزرار ظهر');
    /* مرة ثانية: الموجود ما يتكرر */
    await p.evaluate(() => { if (typeof openImport === 'function') openImport() });
    await p.fill('#imPaste', '31201').catch(() => {});
    await p.click('#imSheet .im-row2 .btn-sm').catch(() => {});
    await p.waitForTimeout(400);
    const dup = await p.evaluate(() => { const r = document.querySelector('#imSheet .im-row[data-crn="31201"]');
      return { text: r ? r.innerText : '', dis: !!(r && r.querySelector('input').disabled),
               add: !!(document.getElementById('imAddBtn') || {}).disabled } });
    ok(/موجودة في جدولك/.test(dup.text) && dup.dis && dup.add, '**المضافة من قبل: «موجودة في جدولك» وما تتكرر**');
    await p.evaluate(() => { if (typeof closeImport === 'function') closeImport() });
    /* بلا أرقام */
    await p.evaluate(() => { if (typeof openImport === 'function') openImport() });
    await p.fill('#imPaste', 'ما عندي أرقام 123').catch(() => {});
    await p.click('#imSheet .im-row2 .btn-sm').catch(() => {});
    s = await sheet(p);
    ok(/خمس خانات/.test(s.text), 'لصق بلا أرقام: «كل رقم CRN خمس خانات»');
    /* بالإنجليزي */
    const en = await p.evaluate(() => { if (typeof renderImport !== 'function') return '';
      LANG = 'en'; renderImport(); const t = document.getElementById('imSheet').innerText; LANG = 'ar'; renderImport(); return t });
    ok(/Print Class Schedule/.test(en) && /Paste|paste/.test(en) && !/الصق/.test(en), 'واللوح بالإنجليزي كامل');
    eq(SEEN.logs.length, 0, '**الزائر ما ينكتب له شي في سجل الاستيراد** — ما له حساب نربطه به');
    await ctx.close();
  }

  /* ── مسجّل: يرفع ملف PDF ── */
  {
    const { ctx, p } = await open(SUPA_USER);
    await toasts(p);
    IMPORT_RES = { ok: true, kind: 'schedule', term: '202710', skipped: 1, ev: 'abcdef012345', rows: [
      { crn: '31215', code: 'MEEN 3333', section: '102' },
      { crn: '31220', code: 'CHEM 1421', section: '101' },
      { crn: '31228', code: 'MEEN 9999', section: '114' }] };
    /* MEEN 3333 متطلباتها ما انضبطت في «خطتي» — البحث كان بيرفضها، والجدول المسجّل حقيقة */
    const pre = await p.evaluate(() => { const r = prereqCheck('MEEN 3333'); return { known: r.known, ok: r.ok } });
    await p.evaluate(() => { switchTab('sched'); if (typeof openImport === 'function') openImport() });
    await p.setInputFiles('#imFileIn', { name: 'Student Schedule.pdf', mimeType: 'application/pdf', buffer: PDF }).catch(() => {});
    await p.waitForTimeout(700);
    const sent = SEEN.imports[SEEN.imports.length - 1] || {};
    ok(sent.kind === 'schedule' && sent.media === 'application/pdf' && sent.data === PDF64,
       '**الملف يروح للسيرفر كما هو (PDF · base64)**');
    const lastQ = SEEN.courses[SEEN.courses.length - 1] || '';
    ok(/term=202710/.test(lastQ) && /gender=M1/.test(lastQ), 'والبحث بترم الملف وجنس الشعب (1xx = طلاب) — ' + lastQ);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#imSheet .im-row')].map(r => ({
      crn: r.dataset.crn, text: r.innerText, on: !!(r.querySelector('input') || {}).checked })));
    const m = rows.find(r => r.crn === '31228') || {};
    ok(rows.length === 3 && !m.on && /لشعبة ثانية/.test(m.text || '') && /MEEN 9999/.test(m.text || ''),
       '**رقم يطابق شعبة غير اللي في الملف: يطلع بتحذير وبلا اختيار** — ' + (m.text || '').replace(/\n/g, ' '));
    const s = await sheet(p);
    ok(/1 سطر ما انقرأ/.test(s.text), 'والسطر اللي ما انقرأ يُقال — «ضيفه من البحث»');
    await p.click('#imAddBtn').catch(() => {});
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => schedule.map(c => c.crn));
    eq(after, ['31215', '31220'], '**انضافت المختارة — ومنها MEEN 3333 بلا حارس المتطلبات (مسجّلة في الجامعة)**');
    ok(pre.known && !pre.ok, '(والحارس كان بيمنعها فعلاً: متطلباتها ناقصة في «خطتي»)');
    await wait(200);
    const L1 = SEEN.logs[SEEN.logs.length - 1] || {};
    ok(SEEN.logs.length === 1 && L1.ev === 'abcdef012345' && L1.kind === 'schedule' && L1.src === 'pdf' &&
       L1.outcome === 'added' && L1.found === 3 && L1.missing === 0 && L1.warned === 1 && L1.added === 2,
       '**بعد الإضافة الصفحة تكمّل السجل بنفس رقم القراءة: لقينا ٣ · بتحذير ١ · أضاف مادتين** — ' + JSON.stringify(L1));
    ok(!/31215|31220|MEEN 3333|CHEM 1421/.test(JSON.stringify(SEEN.logs)), 'وبلا أرقام شعب ولا رموز مواد');

    /* صورة: تنضغط JPEG قبل الرفع */
    IMPORT_RES = { ok: true, kind: 'schedule', term: '202710', rows: [{ crn: '31201', code: 'MEEN 3322', section: '101' }] };
    await p.evaluate(() => { if (typeof openImport === 'function') openImport() });
    await p.setInputFiles('#imFileIn', { name: 'IMG_0001.png', mimeType: 'image/png', buffer: Buffer.from(PNG64, 'base64') }).catch(() => {});
    await p.waitForTimeout(800);
    const img = SEEN.imports[SEEN.imports.length - 1] || {};
    ok(img.media === 'image/jpeg' && /^\/9j\//.test(img.data || ''), '**الصورة تنضغط JPEG قبل الرفع**');
    await p.evaluate(() => { if (typeof closeImport === 'function') closeImport() });
    await wait(200);
    const L2 = SEEN.logs[SEEN.logs.length - 1] || {};
    ok(SEEN.logs.length === 2 && L2.outcome === 'closed' && L2.src === 'image' && L2.added === 0,
       '**قفل اللوح وقت المراجعة بلا إضافة: «قفل» في السجل** — ' + JSON.stringify(L2));
    await p.evaluate(() => { if (typeof closeImport === 'function') closeImport() });
    await wait(100);
    eq(SEEN.logs.length, 2, 'والقفل مرة ثانية ما يكرر السطر');

    /* رفض السيرفر: الرسالة كما هي · والمقفل يودّي للصق */
    IMPORT_RES = { ok: false, why: 'day', msg: 'خلصت أسئلتك المجانية لهذا اليوم (5). ترجع لي بكرة.' };
    await p.evaluate(() => { if (typeof openImport === 'function') openImport() });
    await p.setInputFiles('#imFileIn', { name: 's.pdf', mimeType: 'application/pdf', buffer: PDF }).catch(() => {});
    await p.waitForTimeout(500);
    let t = (await sheet(p)).text;
    ok(/خلصت أسئلتك المجانية/.test(t), 'خلص سقفه: رسالة السيرفر نفسها');
    await wait(150);
    eq(SEEN.logs.length, 2, 'ورفض السيرفر ما تكرره الصفحة — السيرفر سجّله بسببه');
    IMPORT_RES = { ok: false, why: 'off', msg: 'المساعد مقفل حالياً — باقي الموقع شغّال عادي.' };
    await p.setInputFiles('#imFileIn', { name: 's.pdf', mimeType: 'application/pdf', buffer: PDF }).catch(() => {});
    await p.waitForTimeout(500);
    t = (await sheet(p)).text;
    ok(/مو متاحة الحين/.test(t) && /الصق أرقام CRN/.test(t), '**المساعد مقفل: «قراءة الملفات مو متاحة — الصق أرقام CRN»**');
    /* ترم ما نعرضه: نقول ودوّرنا في ترم البحث */
    IMPORT_RES = { ok: true, kind: 'schedule', term: '202530', rows: [{ crn: '31201', code: 'MEEN 3322', section: '101' }] };
    await p.setInputFiles('#imFileIn', { name: 's.pdf', mimeType: 'application/pdf', buffer: PDF }).catch(() => {});
    await p.waitForTimeout(600);
    t = (await sheet(p)).text;
    ok(/202530/.test(t) && /مو من الترمات/.test(t), 'ترم الملف مو من ترماتنا: يُقال، ونكمل بترم البحث');
    await p.evaluate(() => { if (typeof closeImport === 'function') closeImport() });
    /* ملف PDF كبير: يرفضه الجوال قبل ما يوصلنا — فالصفحة تسجّله */
    const nImp = SEEN.imports.length;
    await p.evaluate(() => { if (typeof openImport === 'function') openImport() });
    await p.setInputFiles('#imFileIn', { name: 'big.pdf', mimeType: 'application/pdf',
      buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(700 * 1024, 65)]) }).catch(() => {});
    await wait(300);
    const LB = SEEN.logs[SEEN.logs.length - 1] || {};
    ok(SEEN.imports.length === nImp && LB.outcome === 'big' && LB.src === 'pdf' && !LB.ev,
       '**PDF كبير قبل الرفع: «كبير» في السجل من الصفحة، وما نرسل الملف** — ' + JSON.stringify(LB));
    /* ملف مو PDF ولا صورة */
    await p.evaluate(() => { if (typeof openImport === 'function') openImport() });
    await p.setInputFiles('#imFileIn', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }).catch(() => {});
    await p.waitForTimeout(300);
    t = (await sheet(p)).text;
    ok(/PDF أو صورة/.test(t), 'ملف نصي: «اختر ملف PDF أو صورة»');
    await wait(200);
    ok((SEEN.logs[SEEN.logs.length - 1] || {}).outcome === 'type', 'وفي السجل «نوع ملف غلط»');
    await ctx.close();
  }

  /* ── المساعد مقفل (aiShown خطأ): اللوح بلا زر الملف، واللصق باقٍ ── */
  {
    AI_ST_RES = { on: false, why: 'off', msg: 'المساعد مقفل' };
    const { ctx, p } = await open(SUPA_USER);
    const v = await p.evaluate(() => { switchTab('sched'); if (typeof openImport === 'function') openImport();
      const sh = document.getElementById('imSheet');
      return { file: !!document.getElementById('imFileIn'), paste: !!document.getElementById('imPaste'),
               text: sh ? sh.innerText : '' } });
    ok(!v.file && v.paste && /مو متاحة الحين/.test(v.text), '**المساعد مقفل: بلا زر الملف، واللصق باقٍ**');
    await ctx.close();
  }
  ok(errs.length === 0, 'الصفحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
  await browser.close(); srv.close();

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + (e && e.stack || e)); process.exit(1) });
