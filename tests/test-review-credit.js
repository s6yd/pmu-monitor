/* رصيد تقييم الدكاترة — اختبار عبر الملفات الثلاثة.
   node tests/test-review-credit.js [server.js] [pmu-schedule.html] [admin.html]
   والقرار يوصل الطالب: على تلقرام لو مربوط، وفي الموقع مرة لو مو مربوط — واللوحة تقول
   أي واحد صار (لقاها محمد، ٣ نوفمبر ٢٠٢٦: «قبلته بس ما اشوف راحت رسالة للطالب») */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ADMIN = path.resolve(process.argv[4] || path.join(__dirname, '..', 'admin.html'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const TOK = { 'tok-u1-aaaaaaaaaaaaaaaaaaaa': 'u1', 'tok-u2-bbbbbbbbbbbbbbbbbbbb': 'u2' };
const U1 = 'tok-u1-aaaaaaaaaaaaaaaaaaaa';
let nextId = 100;
const DB = {
  profiles: [{ id: 'u1', name: 'سالم', email: 's@x', telegram_chat_id: '801' },
             { id: 'u2', name: 'نورة', email: 'n@x', telegram_chat_id: '802' }],
  instructor_reviews: ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => ({
    id: i + 1, user_id: 'u1', instructor_name: 'Dr ' + n, rating: 4, course_code: 'MEEN 33' + i,
    comment: 'تعليق ' + n, hidden: n === 'F', created_at: `2026-0${i + 1}-01T10:00:00+00:00` })),
  review_credit_pairs: [{ user_id: 'u2', instructor_name: 'Dr Z', request_id: 1 }],
  review_requests: [], credit_ledger: [], subscriptions: [], referrals: [],
  app_state: [], app_events: [], monitored_courses: []
};
const TG = [];
const TG_FAIL = new Set();          /* محادثات يرفض تيليغرام رسائلها (٥٠٠) */

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer || '');
  const filt = rows => {
    let r = rows.slice();
    for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=eq\.([^&]+)/g)) r = r.filter(x => String(x[m[1]]) === m[2]);
    const inm = /(?:^|&)user_id=in\.\(([^)]*)\)/.exec(qs);
    if (inm) { const ids = new Set(inm[1].split(',').map(x => x.replace(/"/g, ''))); r = r.filter(x => ids.has(x.user_id)) }
    const om = /order=([a-z_]+)\.(asc|desc)/.exec(qs);
    if (om) r.sort((a, b) => (String(a[om[1]]) < String(b[om[1]]) ? -1 : 1) * (om[2] === 'desc' ? -1 : 1));
    const off = /offset=(\d+)/.exec(qs), lim = /limit=(\d+)/.exec(qs);
    if (off) r = r.slice(Number(off[1]));
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
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign({ id: nextId++, created_at: new Date().toISOString() }, x));
    /* القيود كما في القاعدة */
    if (table === 'review_requests' && rows.some(x => list.some(y => y.user_id === x.user_id && y.status === 'pending')))
      return { code: '23505', message: 'review_requests_one_pending' };
    if (table === 'review_credit_pairs' && rows.some(x => list.some(y => y.user_id === x.user_id && y.instructor_name === x.instructor_name)))
      return { code: '23505', message: 'duplicate key review_credit_pairs_pkey' };
    rows.forEach(x => { if (table === 'review_requests' && !x.status) x.status = 'pending' });
    list.push(...rows);
    return rep ? rows : [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(list);
    if (table === 'review_requests' && b.status === 'approved' &&
        hit.some(h => list.some(y => y !== h && y.user_id === h.user_id && y.term === h.term && y.status === 'approved')))
      return { code: '23505', message: 'review_requests_one_per_term' };
    hit.forEach(x => Object.assign(x, b));
    return rep ? hit.map(x => Object.assign({}, x)) : [];
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
      } else if (host === 'api.telegram.org') {
        const m = JSON.parse(chunks.join('') || '{}'); TG.push(m);
        o = TG_FAIL.has(String(m.chat_id)) ? JSON.stringify({ ok: false, error_code: 500, description: 'Internal Server Error' })
                                           : JSON.stringify({ ok: true, result: {} });
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

/* المنفذ يتغيّر مع كل تشغيل: منفذ ثابت يبقى محجوزاً بعد انتهاء
   العملية (TIME_WAIT أو بقايا جلسة)، فيفشل التشغيل التالي بـEADDRINUSE
   والاختبار يطلع أحمر بلا علاقة بالكود. النطاق ١٠٠ لكل ملف فما يتصادمان. */
const PORT = 21600 + (process.pid % 100), TOKEN = 'admin-token-for-tests';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: TOKEN, SITE_ENV: 'dev', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'true'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(p, method, { tok, admin, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (tok) headers.Authorization = 'Bearer ' + tok;
    if (admin) headers['X-Admin-Token'] = TOKEN;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve(j) });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const me = (method) => call('/api/me/reviews-credit', method, { tok: U1 });
const tgTo = chat => TG.filter(m => String(m.chat_id) === chat).map(m => m.text || '');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(400);

  /* ═══ السيرفر ═══ */
  let r = await me('POST');
  ok(r.ok === false && /إطلاق/.test(r.error || ''), 'في الفترة المجانية: الطلب مقفول — الرصيد ما يحترق قبل ما ينصرف');
  r = await me('GET');
  ok(r.open === false, 'والحالة تقول مقفول');

  await call('/api/admin/beta-toggle', 'POST', { admin: true, body: { on: false } });
  r = await me('GET');
  ok(r.open === true && r.needed === 5 && r.eligibleCount === 5, 'بعد الفترة: خمسة مؤهلة (المخفي ما يُحسب) — ' + r.eligibleCount);

  const [a, b] = await Promise.all([me('POST'), me('POST')]);
  ok([a, b].filter(x => x.ok).length === 1, 'طلبان في نفس اللحظة: واحد فقط ينجح — ' + JSON.stringify([a.ok, b.ok]));
  const req = DB.review_requests.find(x => x.user_id === 'u1');
  ok(req && JSON.stringify(req.instructors) === JSON.stringify(['Dr A', 'Dr B', 'Dr C', 'Dr D', 'Dr E']),
     'الطلب فيه الخمسة الأقدم بالترتيب، بلا المخفي — ' + (req && req.instructors));
  ok(tgTo('5555').some(t => /طلب رصيد تقييم جديد/.test(t)), 'ووصلك تنبيه في تلقرام');
  r = await me('GET');
  ok(r.pending === true && r.eligibleCount === 0, 'قيد المراجعة: ولا تقييم متاح لطلب ثانٍ');

  let q = await call('/api/admin/review-requests', 'GET', { admin: true });
  ok(q.requests && q.requests.length === 1 && q.requests[0].reviews.length === 5, 'اللوحة: الطلب بتقييماته الخمسة');
  ok(q.requests[0].reviews[0].comment === 'تعليق A' && q.requests[0].name === 'سالم', 'بالتعليق واسم الطالب');
  ok(q.requests[0].tg === true, '**والطابور يقول إنه مربوط بتلقرام** (قرارك يوصله رسالة)');
  ok(!JSON.stringify(q).includes('801'), 'ورقم محادثته ما يطلع للوحة');

  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: req.id, decision: 'reject', note: '' } });
  ok(r.ok === false && /إلزامي/.test(r.error || ''), 'رفض بلا سبب: ممنوع');
  r = await call('/api/admin/review-decide', 'POST', { admin: true,
    body: { id: req.id, decision: 'reject', note: 'التعليقات قصيرة <b>جداً</b>' } });
  ok(r.ok === true, 'رفض بسبب: تمّ');
  ok(r.notified === true, '**واللوحة تعرف إن السبب وصله على تلقرام** — ' + JSON.stringify(r));
  await wait(100);
  const rejMsg = tgTo('801').find(t => /ما انقبل/.test(t)) || '';
  ok(/قصيرة/.test(rejMsg) && /&lt;b&gt;/.test(rejMsg), 'السبب وصل الطالب — والوسوم فيه مهرّبة');
  r = await me('GET');
  ok(r.latest && r.latest.status === 'rejected' && /قصيرة/.test(r.latest.note), 'الطالب يشوف الرفض وسببه');
  ok(r.eligibleCount === 5 && r.pending === false, 'والخمسة رجعت متاحة — يعدّل ويرسل');

  r = await me('POST');
  ok(r.ok === true, 'أرسل من جديد');
  const req2 = DB.review_requests.find(x => x.user_id === 'u1' && x.status === 'pending');
  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: req2.id, decision: 'approve' } });
  ok(r.ok === true && !r.warning, 'قبول: تمّ بلا تحذير — ' + JSON.stringify(r));
  ok(r.notified === true && r.credit === 500, '**واللوحة تعرف إن رسالة القبول وصلته ونزل له ٥ ريال** — ' + JSON.stringify(r));
  const pairs = DB.review_credit_pairs.filter(x => x.user_id === 'u1');
  ok(pairs.length === 5, 'خمسة دكاترة انحسبوا للأبد');
  const cr = DB.credit_ledger.find(x => x.user_id === 'u1');
  ok(cr && cr.amount_halalas === 500 && cr.reason === 'reviews' && cr.expires_at, 'رصيد ٥ ريال «تقييمات» بتاريخ انتهاء');
  ok(DB.review_requests.find(x => x.id === req2.id).credit_id === cr.id, 'والطلب مربوط بحركة الرصيد');
  await wait(100);
  ok(tgTo('801').some(t => /انقبلت/.test(t) && /5 ريال/.test(t)), 'والطالب وصله «انقبلت — نزل لك ٥ ريال»');

  r = await me('GET');
  ok(r.approvedThisTerm === true && r.eligibleCount === 0, 'انقبل هذا الترم، ولا شي متاح');
  r = await me('POST');
  ok(r.ok === false && /الترم القادم/.test(r.error || ''), 'طلب ثانٍ نفس الترم: مرفوض');

  /* حذف وإعادة: صف جديد برقم جديد — ما يُحتسب */
  DB.instructor_reviews = DB.instructor_reviews.filter(x => x.instructor_name !== 'Dr A');
  DB.instructor_reviews.push({ id: 999, user_id: 'u1', instructor_name: 'Dr A', rating: 5, comment: 'جديد',
                               hidden: false, created_at: new Date().toISOString() });
  r = await me('GET');
  ok(r.eligibleCount === 0, 'حذف تقييم وإعادته ما يرجّعه مؤهلاً — الاحتساب على الدكتور لا على الصف');

  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: req2.id, decision: 'approve' } });
  ok(r.ok === false && /انحسم/.test(r.error || ''), 'قبول طلب محسوم: مرفوض');

  /* الحارس الأخير: مقبول ثانٍ لنفس الترم يرفضه الفهرس */
  DB.review_requests.push({ id: 500, user_id: 'u1', term: '202710', status: 'pending', instructors: ['Dr Q'] });
  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: 500, decision: 'approve' } });
  ok(r.ok === false && /هذا الترم/.test(r.error || ''), 'مقبول ثانٍ لنفس الترم: القاعدة ترفضه');

  /* دكتور محتسب من قبل: القبول يرجع معلّقاً ويقول ليش */
  DB.review_requests.push({ id: 501, user_id: 'u2', term: '202710', status: 'pending', instructors: ['Dr Z', 'Dr Y'] });
  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: 501, decision: 'approve' } });
  ok(r.ok === false && /انحسبوا/.test(r.error || ''), 'دكتور محتسب من قبل: القبول يُرفض بالسبب');
  ok(DB.review_requests.find(x => x.id === 501).status === 'pending', 'والطلب رجع معلّقاً — ما انقبل نصف قبول');
  ok(!DB.credit_ledger.some(x => x.user_id === 'u2'), 'وما نزل رصيد');

  /* ═══ القرار ما وصل الطالب — لقاها محمد (٣ نوفمبر ٢٠٢٦): «قبلته بس ما اشوف راحت رسالة» ═══
     رسالة القرار على تلقرام وحده، وكانت تنرسل بلا انتظار: الطالب مو مربوط ⇒ ولا رسالة،
     واللوحة تقول «انقبل ✅» / «انرفض — وصله السبب» كأنها وصلت */
  /* ١) تيليغرام رفض الرسالة: اللوحة تقول ما وصلت */
  TG_FAIL.add('802');
  r = await call('/api/admin/review-decide', 'POST', { admin: true,
    body: { id: 501, decision: 'reject', note: 'Dr Z انحسب لك من قبل' } });
  TG_FAIL.delete('802');
  ok(r.ok === true && r.notified === false && r.notifyWhy === 'failed',
     '**تيليغرام رفض رسالة الرفض: اللوحة تقول ما وصلت** — ' + JSON.stringify(r));
  let acc = await call('/api/me/account', 'GET', { tok: 'tok-u2-bbbbbbbbbbbbbbbbbbbb' });
  ok(acc.reviewDecision && acc.reviewDecision.status === 'rejected' && /انحسب لك/.test(acc.reviewDecision.note) &&
     acc.reviewDecision.id === 501, '**والقرار في حسابه بالموقع بسببه** — ' + JSON.stringify(acc.reviewDecision));

  /* ٢) طالب مو رابط تيليغرام */
  const U3 = 'tok-u3-cccccccccccccccccccc';
  TOK[U3] = 'u3';
  DB.profiles.push({ id: 'u3', name: 'فهد', email: 'f@x', telegram_chat_id: null });
  ['G', 'H', 'I', 'J', 'K'].forEach((n, i) => DB.instructor_reviews.push({ id: 300 + i, user_id: 'u3',
    instructor_name: 'Dr ' + n, rating: 5, course_code: 'MEEN 34' + i, comment: 'تعليق ' + n, hidden: false,
    created_at: `2026-0${i + 1}-02T10:00:00+00:00` }));
  r = await call('/api/me/reviews-credit', 'POST', { tok: U3 });
  ok(r.ok === true, 'الطالب اللي مو مربوط أرسل طلبه');
  acc = await call('/api/me/account', 'GET', { tok: U3 });
  ok(acc.ok === true && acc.reviewDecision === null, 'قيد المراجعة: ولا قرار في حسابه — ' + JSON.stringify(acc.reviewDecision));
  q = await call('/api/admin/review-requests', 'GET', { admin: true });
  const q3 = (q.requests || []).find(x => x.userId === 'u3');
  ok(q3 && q3.tg === false, '**اللوحة تعرف قبل ما تقرر إنه مو رابط تيليغرام** — ' + JSON.stringify(q3 && q3.tg));
  const tgBefore = TG.length;
  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: q3 && q3.id, decision: 'approve' } });
  ok(r.ok === true && r.status === 'approved' && r.notified === false && r.notifyWhy === 'no-telegram',
     '**قبلته وهو مو مربوط: اللوحة تقول ما وصلته رسالة** — ' + JSON.stringify(r));
  ok(TG.length === tgBefore, 'وما حاولنا نرسل لمحادثة ما لها وجود');
  ok(DB.credit_ledger.some(x => x.user_id === 'u3' && x.amount_halalas === 500 && x.reason === 'reviews'),
     'والرصيد نزل كالعادة');
  acc = await call('/api/me/account', 'GET', { tok: U3 });
  ok(acc.reviewDecision && acc.reviewDecision.status === 'approved' && acc.reviewDecision.halalas === 500 &&
     acc.reviewDecision.id === (q3 && q3.id) && acc.reviewDecision.at,
     '**وحسابه في الموقع فيه القبول ومبلغه — الصفحة تقوله له** — ' + JSON.stringify(acc.reviewDecision));
  ok(acc.credit && acc.credit.available === 500, 'ورصيده في الحساب ٥ ريال — ' + JSON.stringify(acc.credit));

  /* ═══ الصفحة ═══ */
  {
    const { chromium } = require('playwright');
    const srv = http.createServer((q2, res) => {
      const u = q2.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
      /* الصفحة صارت تحمّل الخطط من /plans.js — نخدم الملف الحقيقي.
         تغيير بنية لا تسهيل: قبله كان المحاكي يرد 404 على كل .js، فالصفحة
         تفقد PLANS وتبويب خطتي يعرض رسالة العطل بدل الخطة. */
      if (u === '/plans.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
      }
      if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"courses":[]}');
    });
    await new Promise(z => srv.listen(0, z));
    const browser = await chromium.launch();
    const p = await browser.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', z => z.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},upsert:async()=>({error:null}),delete(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof revCreditHTML === 'function', null, { timeout: 15000 });
    const v = await p.evaluate(async () => {
      LANG = 'ar'; USER = { id: 'u1' }; PROFILE = { id: 'u1' };
      MON_STATE = { freeBeta: false, plans: {} };
      reviews = [{ user_id: 'u1', instructor_name: 'Dr A', rating: 4, created_at: '2026-09-01' }];
      const base = { ok: true, open: true, needed: 5, creditHalalas: 500, eligible: [], pending: false,
                     approvedThisTerm: false, latest: null };
      const show = st => { REVCREDIT = Object.assign({}, base, st); REVCREDIT_AT = Date.now(); renderMyReviews();
                           return document.getElementById('myRevList').innerText };
      const res = {};
      res.three = show({ eligibleCount: 3 });
      res.five = show({ eligibleCount: 5 });
      res.hasBtn = /أرسل تقييماتك للمراجعة/.test(res.five);
      res.pending = show({ eligibleCount: 0, pending: true });
      res.rejected = show({ eligibleCount: 5, latest: { status: 'rejected', note: '<img src=x onerror=alert(1)> قصيرة' } });
      res.rejHtml = document.getElementById('myRevList').innerHTML;
      res.approved = show({ eligibleCount: 0, approvedThisTerm: true });
      const asked = [];
      window.meFetch = async (path, m) => { asked.push((m || 'GET') + ' ' + path);
        return m === 'POST' ? { ok: true, id: 1 } : Object.assign({}, base, { eligibleCount: 0, pending: true }) };
      REVCREDIT = Object.assign({}, base, { eligibleCount: 5 });
      await submitRevCredit(null);
      res.asked = asked; res.after = document.getElementById('myRevList').innerText;
      ACCOUNT = { ok: true, credit: { available: 0 }, invite: { code: 'MHD7K2', paidFriends: 0 } }; ACCOUNT_AT = Date.now();
      REVCREDIT = Object.assign({}, base, { eligibleCount: 3 }); REVCREDIT_AT = Date.now();
      renderSettings(); res.card = document.getElementById('proAcct').innerText;
      /* ── قرار محمد (٣ أكتوبر): خصم التقييم كان في ⚙️ ← «تقييماتي» وحده — صار وين
         يقيّم ووين يدفع ── */
      /* قراءات آمنة: على الصفحة القديمة يطلع ✗ لكل فحص بدل ما ينهار الاختبار */
      const txt = id => { const e = document.getElementById(id); return e ? e.innerText : '' };
      const toastOf = C => typeof revCreditToast === 'function' ? revCreditToast(C) : '';
      window.meFetch = async (path) => /reviews-credit/.test(path) ? REVCREDIT : { ok: false };
      REVCREDIT = Object.assign({}, base, { eligibleCount: 2 }); REVCREDIT_AT = Date.now();
      instructors = ['Dr A', 'Dr B'];
      switchTab('docs'); renderDocs();
      res.docs = txt('docCredit');
      openDoc('Dr B'); res.lineB = txt('docRcLine');
      openDoc('Dr A'); res.lineA = txt('docRcLine');   /* قيّمه قبل */
      backToDocs();
      const ps = () => { openPlans('compare'); const e = document.getElementById('psRc');
                         return e ? { t: e.innerText, hidden: e.hidden } : { t: '', hidden: true } };
      switchTab('search');                  /* من تبويب ثاني: الزر لازم يودّيه للدكاترة فعلاً */
      res.ps = ps();
      const go = document.querySelector('#psRc button'); if (go) go.click();
      res.tabAfter = CUR_TAB;
      REVCREDIT = Object.assign({}, base, { eligibleCount: 5 }); res.ps5 = ps();
      REVCREDIT = Object.assign({}, base, { eligibleCount: 0, pending: true }); res.psPending = ps();
      REVCREDIT = Object.assign({}, base, { eligibleCount: 0, approvedThisTerm: true }); res.psApproved = ps();
      closePlans();
      res.toast3 = toastOf(Object.assign({}, base, { eligibleCount: 3 }));
      res.toast5 = toastOf(Object.assign({}, base, { eligibleCount: 5 }));
      res.toastPending = toastOf(Object.assign({}, base, { eligibleCount: 3, pending: true }));
      /* العدّاد من السيرفر بعد ما ينشر — ما يبقى على الرقم القديم */
      REVCREDIT = Object.assign({}, base, { eligibleCount: 2 }); REVCREDIT_AT = Date.now();
      let fetched = 0;
      window.meFetch = async (path) => { if (/reviews-credit/.test(path)) { fetched++;
        return Object.assign({}, base, { eligibleCount: 3 }) } return { ok: false } };
      window.loadReviews = async () => { reviews.push({ user_id: 'u1', instructor_name: 'Dr B', rating: 5,
        created_at: '2026-10-03' }) };
      const toasts = []; const realToast = window.showToast;
      window.showToast = (m) => toasts.push(m);
      openDoc('Dr B'); openRatingForm(); formStars = 5;
      await submitReview();
      window.showToast = realToast;
      res.fetchedAfterPost = fetched; res.toastAfterPost = toasts.join(' | ');
      backToDocs(); res.docsAfterPost = txt('docCredit');
      /* السيرفر ما رد (عطل): المربّع يُرسم مع كل حرف في بحث الدكاترة — ما نعيد الطلب مع كل حرف */
      let tries = 0;
      window.meFetch = async (path) => { if (/reviews-credit/.test(path)) tries++; return { ok: false } };
      REVCREDIT = null; REVCREDIT_AT = 0;
      for (let i = 0; i < 5; i++) { renderDocs(); await new Promise(z => setTimeout(z, 20)) }
      res.triesAfterFail = tries;
      MON_STATE.freeBeta = true; renderMyReviews(); res.beta = document.getElementById('myRevList').innerText;
      renderDocs(); res.docsBeta = txt('docCredit');
      res.psBeta = ps().hidden; closePlans();
      return res;
    });
    ok(/قيّم 5 دكاترة واكسب 5 ريال/.test(v.three) && /3\/5/.test(v.three) && /باقي 2/.test(v.three),
       'تقييماتي: «قيّم ٥ واكسب ٥ ريال · 3/5 · باقي 2»');
    ok(v.hasBtn, 'عند الخامس: زر «أرسل تقييماتك للمراجعة»');
    ok(/قيد المراجعة/.test(v.pending), 'معلّق: «قيد المراجعة»');
    ok(/ما انقبل/.test(v.rejected) && /قصيرة/.test(v.rejected), 'مرفوض: السبب ظاهر');
    ok(!/<img/.test(v.rejHtml) && /&lt;img/.test(v.rejHtml), 'وسبب الرفض مهرّب — نص الإدارة ما يتنفّذ في الصفحة');
    ok(/انقبل طلبك هذا الترم/.test(v.approved), 'مقبول: «انقبل — نزل لك ٥ ريال»');
    ok(JSON.stringify(v.asked.slice(0, 2)) === JSON.stringify(['POST /api/me/reviews-credit', 'GET /api/me/reviews-credit']) &&
       /قيد المراجعة/.test(v.after), 'الإرسال: POST ثم تحديث الحالة من السيرفر — ' + JSON.stringify(v.asked));
    ok(/تقييم الدكاترة/.test(v.card) && /3\/5/.test(v.card), 'وبطاقة «اشتراكي» فيها سطر التقييم');
    ok(!/قيّم 5/.test(v.beta), 'في الفترة المجانية: لا مربّع رصيد');
    /* وين يقيّم */
    ok(/قيّم 5 دكاترة واكسب 5 ريال/.test(v.docs) && /2\/5/.test(v.docs),
       '**تبويب الدكاترة: مربّع «قيّم ٥ واكسب ٥ ريال · 2/5» فوق القائمة** — ' + v.docs.slice(0, 80));
    ok(/يقرّبك من 5 ريال/.test(v.lineB) && /2\/5/.test(v.lineB),
       '**صفحة دكتور ما قيّمه: سطر «كل دكتور تقيّمه يقرّبك» تحت زر التقييم** — ' + v.lineB);
    ok(v.lineA === '', 'ودكتور قيّمه قبل: بلا سطر — تعديله ما يزيد العدّاد');
    ok(v.fetchedAfterPost >= 1, '**بعد ما ينشر: العدّاد من السيرفر من جديد**');
    ok(/باقي 2 وتاخذ 5 ريال/.test(v.toastAfterPost),
       '**ورسالة النشر تقول وين وصل: «باقي 2 وتاخذ 5 ريال»** — ' + v.toastAfterPost);
    ok(/3\/5/.test(v.docsAfterPost), 'والمربّع فوق القائمة صار 3/5 — ' + v.docsAfterPost.slice(0, 60));
    ok(/باقي 2/.test(v.toast3) && /كمّلت 5/.test(v.toast5) && /أرسلها/.test(v.toast5),
       'الرسالة: باقي كم · وعند الخامس «كمّلت — أرسلها»');
    eq(v.toastPending, '', 'وطلب معلّق: رسالة النشر العادية — ما نعد بشي');
    /* ووين يدفع */
    ok(!v.ps.hidden && /خصم 5 ريال/.test(v.ps.t) && /قيّم 5 دكاترة/.test(v.ps.t) && /2\/5/.test(v.ps.t),
       '**ورقة الباقات: «خصم ٥ ريال: قيّم ٥ دكاترة (عندك 2/5)»** — ' + v.ps.t);
    ok(/بعد مراجعتنا/.test(v.ps.t), '**وبصدق: الرصيد بعد مراجعتنا لا فوري**');
    eq(v.tabAfter, 'docs', '**وزر «قيّم الحين» يقفل الورقة ويفتح تبويب الدكاترة**');
    ok(/أرسلها للمراجعة/.test(v.ps5.t) && /أرسلها/.test(v.ps5.t), 'وعنده الخمسة: «أرسلها للمراجعة» من الورقة');
    ok(/قيد المراجعة/.test(v.psPending.t) && /ينخصم/.test(v.psPending.t), 'ومعلّق: «قيد المراجعة — لو انقبل قبل ما تدفع ينخصم»');
    ok(v.psApproved.hidden, 'وانقبل هذا الترم: ما نكرّر — رصيده محسوب في المجموع');
    ok(!/قيّم 5/.test(v.docsBeta) && v.psBeta, 'وفي الفترة المجانية: لا في الدكاترة ولا في الورقة');
    eq(v.triesAfterFail, 1, '**العدّاد فشل: خمسة أحرف في البحث = طلب واحد** — لا طلب مع كل حرف');
    ok(errs.length === 0, 'الصفحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  /* ═══ الصفحة: القرار يبان للطالب في الموقع مرة — والطالب مسجّل ومو رابط تيليغرام ═══
     القرار يجي من /api/me/account (الصفحة تطلبه أصلاً أول ما تفتح) — بلا طلب زيادة */
  {
    const { chromium } = require('playwright');
    let DEC = null, accountCalls = 0;
    const srv = http.createServer((q2, res) => {
      const u = q2.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
      if (u === '/plans.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
      }
      if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u === '/api/me/account') { accountCalls++;
        return res.end(JSON.stringify({ ok: true, active: false, credit: { available: 500, nextExpiry: null },
          invite: { code: 'MHD7K2', paidFriends: 0 }, reviewDecision: DEC })) }
      if (u === '/api/monitor-status') return res.end(JSON.stringify({ freeBeta: false, plans: {} }));
      if (u.startsWith('/api/me/')) return res.end('{"ok":false}');
      res.end('{"courses":[]}');
    });
    await new Promise(z => srv.listen(0, z));
    const BASE = `http://127.0.0.1:${srv.address().port}/`;
    /* مسجّل وملفه بلا telegram_chat_id — مثل الطالب اللي قبلت طلبه */
    const SUPA_USER = `
window.__ROW={id:'u3',email:'f@x.com',name:'Student',major:'MEEN',plan_ver:'new',prep:false,telegram_chat_id:null};
function q(t){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o}, in(){return o}, or(){return o},
  gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:t==='profiles'?window.__ROW:null,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} },
  insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:t==='profiles'?[window.__ROW]:[],error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:{user:{id:'u3',email:'f@x.com'},access_token:'tok'}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
  from:t=>q(t), channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', z => z.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_USER }));
    await p.addInitScript(() => {
      try { localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_seen_welcome', 'true') } catch (e) {}
      /* كل رسالة طلعت للطالب (نصها كما انعرض) */
      window.__TOASTS = [];
      document.addEventListener('DOMContentLoaded', () => {
        const t = document.getElementById('toast'); if (!t) return;
        new MutationObserver(() => { if (t.classList.contains('show'))
          window.__TOASTS.push({ text: t.textContent, html: t.innerHTML, cls: t.className,
                                 w: Math.round(t.getBoundingClientRect().width) }) })
          .observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
      });
    });
    const visit = async dec => {
      DEC = dec; const n0 = accountCalls;
      await p.goto(BASE, { waitUntil: 'load' });
      /* الحساب وصل والصفحة خلصت ما بعده */
      for (let i = 0; i < 80 && accountCalls === n0; i++) await wait(50);
      await p.waitForTimeout(500);
      return p.evaluate(() => ({ toasts: window.__TOASTS.slice(), xss: !!window.__XSS }));
    };
    const iso = d => new Date(Date.now() - d * 864e5).toISOString();
    const hit = (v, re) => v.toasts.filter(x => re.test(x.text));

    let v1 = await visit({ id: 3, status: 'approved', at: iso(0.5), halalas: 500, note: '' });
    const ap = hit(v1, /انقبلت تقييماتك/);
    ok(ap.length === 1 && /5 ريال رصيد/.test(ap[0].text) && /اشتراكك الجاي/.test(ap[0].text),
       '**الطالب اللي مو مربوط يفتح الموقع: «✅ انقبلت تقييماتك — نزل لك 5 ريال رصيد، ينخصم تلقائياً من اشتراكك الجاي»** — ' +
       JSON.stringify(v1.toasts.map(x => x.text)));
    let v2 = await visit({ id: 3, status: 'approved', at: iso(0.5), halalas: 500, note: '' });
    eq(hit(v2, /انقبلت/).length, 0, '**ومرة وحدة: يفتح الموقع ثانية وما تتكرر**');
    let v3 = await visit({ id: 4, status: 'rejected', at: iso(1), halalas: 0,
      note: '<img src=x onerror="window.__XSS=1"> التعليقات قصيرة' });
    const rj = hit(v3, /ما انقبل/);
    ok(rj.length === 1 && /التعليقات قصيرة/.test(rj[0].text) && /أرسلها من جديد/.test(rj[0].text),
       '**قرار جديد (رفض): يبان بسببه ووش يسوي** — ' + JSON.stringify(v3.toasts.map(x => x.text)));
    ok(rj.length === 1 && /&lt;img/.test(rj[0].html) && !v3.xss, 'وسبب الرفض نص — ما يتنفّذ في الصفحة');
    let v4 = await visit({ id: 5, status: 'approved', at: iso(20), halalas: 500, note: '' });
    eq(hit(v4, /انقبلت/).length, 0, 'قرار أقدم من أسبوعين: ما نطلّعه (جهاز جديد ما ينبش القديم)');
    let v5 = await visit(null);
    eq(hit(v5, /انقبلت|ما انقبل/).length, 0, 'وبلا قرار (أو طلبه معلّق): ولا شي');
    /* الوعد بتلقرام لمن هو مربوط بس */
    const w = await p.evaluate(async () => {
      const base = { ok: true, open: true, needed: 5, creditHalalas: 500, eligible: [], approvedThisTerm: false, latest: null };
      const box = () => { renderMyReviews(); const e = document.getElementById('myRevList'); return e ? e.innerText : '' };
      const out = {};
      REVCREDIT = Object.assign({}, base, { eligibleCount: 0, pending: true }); REVCREDIT_AT = Date.now();
      out.pendOff = box();
      window.meFetch = async (pth, m) => m === 'POST' ? { ok: true, id: 1 } : Object.assign({}, base, { eligibleCount: 0, pending: true });
      window.__TOASTS = [];
      REVCREDIT = Object.assign({}, base, { eligibleCount: 5, pending: false });
      await submitRevCredit(null);
      out.sentOff = (window.__TOASTS[0] || {}).text || '';
      PROFILE = Object.assign({}, PROFILE, { telegram_chat_id: '901' });
      REVCREDIT = Object.assign({}, base, { eligibleCount: 0, pending: true }); REVCREDIT_AT = Date.now();
      out.pendOn = box();
      window.__TOASTS = [];
      REVCREDIT = Object.assign({}, base, { eligibleCount: 5, pending: false });
      await submitRevCredit(null);
      out.sentOn = (window.__TOASTS[0] || {}).text || '';
      /* left:50% كان يخلّي العرض المتاح نص الشاشة: الرسالة الطويلة تنكسر خمسة أسطر في ١٩٥px */
      showToast('✅ انقبلت تقييماتك — نزل لك 5 ريال رصيد، ينخصم تلقائياً من اشتراكك الجاي', 'ok', 9000);
      out.longW = Math.round(document.getElementById('toast').getBoundingClientRect().width);
      /* والرسالة القصيرة تبقى قصيرة — ما تمتد على الشاشة كلها */
      showToast('انسخ الرابط ✅', 'ok');
      out.shortW = Math.round(document.getElementById('toast').getBoundingClientRect().width);
      return out;
    });
    ok(/قيد المراجعة/.test(w.pendOff) && !/تلقرام/.test(w.pendOff) && /يبان لك هنا/.test(w.pendOff),
       '**مو مربوط: «طلبك قيد المراجعة — الرد يبان لك هنا» بلا وعد تلقرام** — ' + w.pendOff.slice(0, 120));
    ok(/انرسل للمراجعة/.test(w.sentOff) && !/تلقرام/.test(w.sentOff),
       '**ورسالة الإرسال كذلك ما تعده بتلقرام** — ' + w.sentOff);
    ok(/يوصلك الرد على تلقرام/.test(w.pendOn) && /يوصلك الرد على تلقرام/.test(w.sentOn),
       'والمربوط: «يوصلك الرد على تلقرام» كما كان — ' + w.sentOn);
    ok(w.longW > 390 * 0.6 && w.longW <= 390 * 0.9 + 1,
       '**والرسالة الطويلة بعرض الشاشة (لين ٩٠٪) لا نصها** — ' + w.longW + 'px');
    ok(w.shortW > 0 && w.shortW < 390 * 0.5, 'والرسالة القصيرة على قدّها — ' + w.shortW + 'px');
    ok(errs.length === 0, 'الصفحة (مسجّل ومو مربوط) بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  /* ═══ اللوحة ═══ */
  {
    const { chromium } = require('playwright');
    let decided = null, DECIDE_RES = { ok: true };
    const srv = http.createServer((q2, res) => {
      const u = q2.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(ADMIN)) }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.endsWith('/review-requests')) return res.end(JSON.stringify({ ok: true, requests: [{
        id: 7, userId: 'u1', name: 'سالم', email: 's@x', createdAt: '2026-10-01T10:00:00Z',
        reviews: [{ instructor: 'Dr A', rating: 4, course: 'MEEN 3311', comment: 'ممتاز <b>', reports: 1 },
                  { instructor: 'Dr B', missing: true }] }] }));
      if (u.endsWith('/review-decide')) {
        let bd = ''; q2.on('data', c => bd += c);
        return q2.on('end', () => { decided = JSON.parse(bd || '{}'); res.end(JSON.stringify(DECIDE_RES)) });
      }
      if (u.endsWith('/health')) return res.end(JSON.stringify({ pricing: { reviewsCreditHalalas: 500 }, monitorInfo: {}, cache: [] }));
      res.end('{}');
    });
    await new Promise(z => srv.listen(0, z));
    const browser = await chromium.launch();
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });   /* محمد يفتح اللوحة من الآيفون */
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.evaluate(() => sessionStorage.setItem('jdw_admin', 'x'.repeat(16)));
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1500);
    const v = await p.evaluate(async () => {
      go('revs');
      const box = document.getElementById('rrBody');
      const res = { text: box.innerText, html: box.innerHTML,
                    badge: document.getElementById('revBadge').textContent };
      window.prompt = () => ''; await decideRR(7, 'reject', 'سالم');
      window.prompt = () => 'التعليق قصير'; await decideRR(7, 'reject', 'سالم');
      return res;
    });
    ok(/طلبات رصيد التقييم \(1\)/.test(v.text) && /سالم/.test(v.text), 'اللوحة: الطابور بعدده واسم الطالب');
    ok(/Dr A/.test(v.text) && /ممتاز/.test(v.text) && /1 بلاغ/.test(v.text), 'وكل تقييم بتعليقه وبلاغاته');
    ok(/محذوف بعد الإرسال/.test(v.text), 'وتقييم حذفه صاحبه يظهر «محذوف»');
    ok(!/<b>ممتاز/.test(v.html) && /&lt;b&gt;/.test(v.html), 'والتعليقات مهرّبة');
    ok(v.badge === '1', 'وعدّاد على تبويب التقييمات');
    ok(decided && decided.decision === 'reject' && decided.note === 'التعليق قصير',
       'رفض بلا سبب ما يُرسل، ومع السبب يُرسل — ' + JSON.stringify(decided));
    /* هل وصلته رسالة؟ قبل القرار (الطابور) وبعده (الرسالة) — كانت «انقبل ✅» و«وصله السبب» دائماً */
    const w = await p.evaluate(() => {
      const card = tg => { RREQS = [{ id: 9, userId: 'u9', name: 'فهد', email: 'f@x', createdAt: '2026-11-02T10:00:00Z', tg,
        reviews: [{ instructor: 'Dr G', rating: 5, course: 'MEEN 3401', comment: 'تمام', reports: 0 }] }];
        renderRRs(); return document.getElementById('rrBody').innerText };
      const out = { off: card(false), on: card(true), old: card(undefined) };
      RREQS = []; renderRRs();
      return out;
    });
    ok(/مو رابط تيليغرام/.test(w.off) && /في الموقع/.test(w.off),
       '**الطابور: «⚠️ مو رابط تيليغرام — قرارك ما يوصله رسالة، يشوفه في الموقع»** — ' + w.off.slice(0, 120));
    ok(!/مو رابط/.test(w.on) && !/مو رابط/.test(w.old), 'والمربوط (أو سيرفر قديم بلا الحقل): بلا السطر');
    const after = async (dec, res) => {
      DECIDE_RES = res;
      return p.evaluate(async d => {
        const seen = []; const real = window.toast;
        window.toast = (m, k, ms) => { real(m, k, ms);
          seen.push({ m, k: k || '', ms: ms || 0, w: Math.round(document.getElementById('toast').getBoundingClientRect().width) }) };
        window.confirm = () => true; window.prompt = () => 'التعليقات قصيرة';
        await decideRR(9, d, 'فهد');
        window.toast = real;
        return seen[0] || { m: '', k: '', ms: 0 };
      }, dec);
    };
    let t1 = await after('approve', { ok: true, status: 'approved', credit: 500, notified: false, notifyWhy: 'no-telegram' });
    ok(/مو رابط تيليغرام/.test(t1.m) && /ما وصلته رسالة/.test(t1.m) && /في الموقع/.test(t1.m) && /5 ريال/.test(t1.m),
       '**قبول وهو مو مربوط: «انقبل ✅ ونزل له 5 ريال — مو رابط تيليغرام، فما وصلته رسالة. بيشوفها في الموقع»** — ' + t1.m);
    ok(t1.ms >= 6000, 'والرسالة تطوّل لين تنقرا — ' + t1.ms);
    /* العرض بنص ثابت — الـCSS نفسه لا طول الرسالة */
    const lw = await p.evaluate(() => { toast('انقبل ✅ ونزل له 5 ريال — مو رابط تيليغرام، فما وصلته رسالة. بيشوفها في الموقع أول ما يفتحه', '', 8000);
      return Math.round(document.getElementById('toast').getBoundingClientRect().width) });
    ok(lw > 390 * 0.6, '**ورسالة اللوحة الطويلة بعرض الشاشة لا نصها** (كانت ١٩٥px فتنكسر خمسة أسطر) — ' + lw + 'px');
    let t2 = await after('approve', { ok: true, status: 'approved', credit: 500, notified: true });
    ok(/وصلته رسالة على تلقرام/.test(t2.m) && t2.k === 'ok', '**قبول ومربوط: «وصلته رسالة على تلقرام»** — ' + t2.m);
    let t3 = await after('reject', { ok: true, status: 'rejected', notified: false, notifyWhy: 'failed' });
    ok(/ما وصلت/.test(t3.m) && /الرسائل/.test(t3.m) && /في الموقع/.test(t3.m),
       '**رفض وتيليغرام ما وصّلها: «رسالة تلقرام ما وصلت (شوف «الرسائل»)»** — ' + t3.m);
    let t4 = await after('reject', { ok: true, status: 'rejected', notified: true });
    ok(/وصله السبب على تلقرام/.test(t4.m), 'رفض ومربوط: «وصله السبب على تلقرام» — ' + t4.m);
    ok(errs.length === 0, 'اللوحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
