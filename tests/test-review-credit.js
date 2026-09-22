/* رصيد تقييم الدكاترة — اختبار عبر الملفات الثلاثة.
   node tests/test-review-credit.js [server.js] [pmu-schedule.html] [admin.html] */
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
        TG.push(JSON.parse(chunks.join('') || '{}')); o = JSON.stringify({ ok: true, result: {} });
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

const PORT = 45887, TOKEN = 'admin-token-for-tests';
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

  r = await call('/api/admin/review-decide', 'POST', { admin: true, body: { id: req.id, decision: 'reject', note: '' } });
  ok(r.ok === false && /إلزامي/.test(r.error || ''), 'رفض بلا سبب: ممنوع');
  r = await call('/api/admin/review-decide', 'POST', { admin: true,
    body: { id: req.id, decision: 'reject', note: 'التعليقات قصيرة <b>جداً</b>' } });
  ok(r.ok === true, 'رفض بسبب: تمّ');
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
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
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
      MON_STATE.freeBeta = true; renderMyReviews(); res.beta = document.getElementById('myRevList').innerText;
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
    ok(errs.length === 0, 'الصفحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  /* ═══ اللوحة ═══ */
  {
    const { chromium } = require('playwright');
    let decided = null;
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
        return q2.on('end', () => { decided = JSON.parse(bd || '{}'); res.end(JSON.stringify({ ok: true })) });
      }
      if (u.endsWith('/health')) return res.end(JSON.stringify({ pricing: { reviewsCreditHalalas: 500 }, monitorInfo: {}, cache: [] }));
      res.end('{}');
    });
    await new Promise(z => srv.listen(0, z));
    const browser = await chromium.launch();
    const p = await browser.newPage();
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
    ok(errs.length === 0, 'اللوحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
