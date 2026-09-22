/* قلب الاشتراك — اختبار.
   أ) الدوال الصافية: قيود الأسعار، حساب الترم، الرصيد بالأقرب انتهاءً
   ب) سيرفر حقيقي: الأسعار، التفعيل بصف هدية، منح وسحب الرصيد
   ج) اللوحة: محرر الأسعار ودرج الطالب

   node tests/test-sub-core.js [server.js] [admin.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = path.resolve(process.argv[3] || path.join(__dirname, '..', 'admin.html'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

/* ═══ أ) الدوال الصافية ═══ */
const src = fs.readFileSync(SRV, 'utf8');
const a = src.indexOf('/* ═══ الاشتراك: الأسعار والرصيد ═══');
const b = src.indexOf('/* ═══ نهاية كتلة الاشتراك ═══ */');
const ctx = { Date, Number, Object, String, Math, Array };
/* تقويم مصغّر: نهايات الترمات الثلاثة كما في التقويم الرسمي */
ctx.termEndISO = t => ({ '202710': '2026-12-30T20:59:59.000Z',
                         '202720': '2027-06-09T20:59:59.000Z',
                         '202730': '2027-08-17T20:59:59.000Z' })[t] || null;
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + ';this.PRICING_DEFAULT=PRICING_DEFAULT;', ctx);
{
  const D = ctx.PRICING_DEFAULT;
  ok(ctx.validatePricing(Object.assign({}, D)) === null, 'الأسعار الافتراضية صالحة');
  ok(/الوهمية/.test(ctx.validatePricing(Object.assign({}, D, { referrerCreditHalalas: 1600 })) || ''),
     'رصيد الداعي = ما يدفعه الصديق (١٦) مرفوض — الحسابات الوهمية تصير بلا خسارة');
  ok(ctx.validatePricing(Object.assign({}, D, { referrerCreditHalalas: 1599 })) === null,
     'وأقل منه بهللة مقبول');
  ok(ctx.validatePricing(Object.assign({}, D, { friendDiscountHalalas: 1900 })) !== null,
     'خصم الصديق بقيمة الاشتراك كاملة مرفوض');
  ok(ctx.validatePricing(Object.assign({}, D, { freeSchedules: 4 })) !== null, 'أربعة جداول للمجاني مرفوضة');
  ok(ctx.validatePricing(Object.assign({}, D, { termHalalas: 19.5 })) !== null, 'الكسور مرفوضة — هللات صحيحة فقط');

  ok(ctx.nextTerm('202710') === '202720' && ctx.nextTerm('202720') === '202730' &&
     ctx.nextTerm('202730') === '202810', 'الترم التالي: أول ← ثاني ← صيفي ← أول السنة الجاية');
  ok(ctx.termEndApprox('202810') === '2027-12-31T20:59:59.000Z', 'ترم خارج التقويم: تقدير آخر ديسمبر');
  ok(ctx.creditExpiryISO('202710', 2) === '2027-08-17T20:59:59.000Z',
     'رصيد الترم الأول صالح حتى نهاية الصيفي');
  ok(ctx.creditExpiryISO('202720', 2) === '2027-12-31T20:59:59.000Z',
     'رصيد الثاني صالح حتى نهاية الأول القادم — الطالب اللي يتخطّى الصيفي ما يخسره');

  const B = ctx.creditBalance;
  const rows = [
    { amount_halalas: 500, expires_at: '2027-06-09T20:59:59+00:00', created_at: '2026-10-01T10:00:00+00:00' },
    { amount_halalas: 300, expires_at: '2027-12-31T20:59:59.000Z',  created_at: '2026-11-01T10:00:00+00:00' },
    { amount_halalas: -400, expires_at: null,                      created_at: '2027-01-12T10:00:00+00:00' }
  ];
  let r = B(rows, '2027-02-01T00:00:00Z');
  ok(r.available === 400, 'الصرف أخذ من الأقرب انتهاءً أول — المتاح ٤٠٠ — جاء ' + r.available);
  ok(r.nextExpiry && r.nextExpiry.startsWith('2027-06-09'), 'وأقرب انتهاء يونيو (باقي الأول)');
  r = B(rows, '2027-07-01T00:00:00Z');
  ok(r.available === 300 && r.expired === 100, `بعد يونيو: متاح ٣٠٠ ومنتهٍ ١٠٠ — ${r.available}/${r.expired}`);
  r = B([{ amount_halalas: -200, created_at: '2027-01-01T00:00:00Z' },
         { amount_halalas: 500, expires_at: '2027-12-31T00:00:00Z', created_at: '2027-02-01T00:00:00Z' }],
        '2027-03-01T00:00:00Z');
  ok(r.overdraft === 200 && r.available === 500, 'منح بعد الصرف ما يغطيه — يظهر كصرف زائد');
  ok(B([], '2027-01-01T00:00:00Z').available === 0, 'سجل فاضٍ: صفر');
  /* الصيغتان المختلطتان لنفس اللحظة */
  r = B([{ amount_halalas: 100, expires_at: '2027-01-01T00:00:00+00:00', created_at: '2026-01-01T00:00:00Z' }],
        '2026-12-31T23:59:59.000Z');
  ok(r.available === 100, '«+00:00» مقابل «Z» تُقارن كلحظات لا نصوص');
}

/* ═══ ب) السيرفر الحقيقي ═══ */
const DB = { profiles: [], subscriptions: [], credit_ledger: [], monitored_courses: [],
             app_state: [], app_events: [] };
let nextId = 1;
DB.profiles.push({ id: 'u1', name: 'سالم', email: 's@x', is_pro: false, subscription_expires_at: null });

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const rep = /return=representation/.test(prefer || '');
  const filt = rows => {
    let r = rows.slice();
    for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=eq\.([^&]+)/g))
      r = r.filter(x => String(x[m[1]]) === m[2]);
    const om = /order=([a-z_]+)\.(asc|desc)/.exec(qs);
    if (om) r.sort((x, y) => (String(x[om[1]]) < String(y[om[1]]) ? -1 : 1) * (om[2] === 'desc' ? -1 : 1));
    const off = /offset=(\d+)/.exec(qs), lim = /limit=(\d+)/.exec(qs);
    if (off) r = r.slice(Number(off[1]));
    if (lim) r = r.slice(0, Number(lim[1]));
    return r;
  };
  if (method === 'POST') {
    const bb = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === bb.key);
      if (i >= 0) list[i] = bb; else list.push(bb);
      return [];
    }
    const rows = (Array.isArray(bb) ? bb : [bb]).map(x =>
      Object.assign({ id: nextId++, created_at: new Date().toISOString() }, x));
    list.push(...rows);
    return rep ? rows : [];
  }
  if (method === 'PATCH') {
    const bb = JSON.parse(body || '{}');
    const hit = filt(list);
    hit.forEach(x => {
      const real = list.find(y => y === x || y.id === x.id);
      Object.assign(real, bb);
    });
    return rep ? filt(list).map(x => Object.assign({}, x)) : [];
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
      let o = '[]';
      if (host === 'api.telegram.org') o = JSON.stringify({ ok: true, result: {} });
      else if (!host.includes('pmu.edu.sa'))
        o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = 200; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 45881, TOKEN = 'admin-token-for-tests';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: TOKEN, SITE_ENV: 'dev', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(p, method, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/admin/' + p, method,
      headers: Object.assign({ 'X-Admin-Token': TOKEN }, data ? { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 400));

  /* الأسعار */
  {
    let r = await call('pricing', 'GET');
    ok(r.j.pricing && r.j.pricing.termHalalas === 1900, 'الأسعار الافتراضية: ١٩ ريال');
    r = await call('pricing', 'POST', { pricing: { referrerCreditHalalas: 1700 } });
    ok(r.code === 400 && /الوهمية/.test(r.j.error || ''), 'رصيد داعٍ مربح للتحايل: مرفوض بالسبب');
    r = await call('pricing', 'POST', { pricing: { termHalalas: 2500 } });
    ok(r.code === 200 && r.j.pricing.termHalalas === 2500, 'تعديل السعر لـ٢٥ نجح');
    ok(r.j.pricing.pushoverHalalas === 1000, 'والباقي كما هو');
    /* هذا الاختبار يشغّل السيرفر بـ SITE_ENV=dev — فحالته في صف dev لا الإنتاج */
    const saved = DB.app_state.find(x => x.key === 'runtime-dev');
    ok(saved && saved.value.toggles.pricing && saved.value.toggles.pricing.termHalalas === 2500,
       'ومحفوظ — يصمد بعد النشر');
    const h = await call('health', 'GET');
    ok(h.j.pricing && h.j.pricing.termHalalas === 2500, 'واللوحة تشوفه');
  }

  /* التفعيل بصف هدية */
  {
    let r = await call('grant', 'POST', { userId: 'u1', note: 'فائز مسابقة' });
    ok(r.j.ok === true && !r.j.warning, 'التفعيل نجح بلا تحذير — ' + JSON.stringify(r.j));
    ok(DB.profiles[0].subscription_expires_at === '2026-12-30T20:59:59.000Z', 'والملف فُعّل حتى نهاية الترم');
    const subs = DB.subscriptions.filter(x => x.user_id === 'u1');
    ok(subs.length === 1 && subs[0].status === 'comp', 'صف «هدية» في سجل الاشتراكات');
    ok(subs[0] && subs[0].note === 'فائز مسابقة', 'والسبب محفوظ');
    ok(subs[0] && !subs[0].amount_halalas && !subs[0].paid_at, 'بلا مبلغ ولا تاريخ دفع — ما يدخل الإيرادات');
    await call('grant', 'POST', { userId: 'u1' });
    ok(DB.subscriptions.filter(x => x.user_id === 'u1').length === 1, 'تفعيل ثانٍ لنفس الترم ما يكرر الصف');
  }

  /* الرصيد */
  {
    let r = await call('credit-adjust', 'POST', { userId: 'u1', amountHalalas: 500, note: '' });
    ok(r.j.ok === false && /إلزامي/.test(r.j.error || ''), 'منح بلا سبب: مرفوض');
    r = await call('credit-adjust', 'POST', { userId: 'u1', amountHalalas: 500, note: 'تعويض عطل' });
    ok(r.j.ok === true, 'منح ٥ ريال بسبب');
    ok(r.j.row && r.j.row.expires_at === '2027-08-17T20:59:59.000Z',
       'ينتهي مع نهاية الصيفي (ترمان بعد الأول) — ' + (r.j.row && r.j.row.expires_at));
    ok(r.j.row && r.j.row.reason === 'admin' && r.j.row.created_by === 'admin', 'موسوم يدوي من اللوحة');
    r = await call('credit-adjust', 'POST', { userId: 'u1', amountHalalas: -300, note: 'تصحيح' });
    ok(r.j.ok === true, 'سحب ٣ ريال');
    r = await call('credit-adjust', 'POST', { userId: 'u1', amountHalalas: -1000, note: 'أكثر من المتاح' });
    ok(r.j.ok === false && /المتاح 2/.test(r.j.error || ''), 'سحب أكثر من المتاح: مرفوض — ' + r.j.error);
    r = await call('credit-adjust', 'POST', { userId: 'u1', amountHalalas: 12.5, note: 'كسر' });
    ok(r.j.ok === false, 'مبلغ بكسر هللة: مرفوض');

    r = await call('credit?id=u1', 'GET');
    ok(r.j.ok && r.j.balance.available === 200, 'الرصيد المتاح ٢ ريال — ' + (r.j.balance || {}).available);
    ok(r.j.rows && r.j.rows.length === 2, 'وحركتان في السجل');

    r = await call('users', 'GET');
    const u = (r.j.users || []).find(x => x.id === 'u1');
    ok(u && u.creditHalalas === 200, 'قائمة الطلاب تعرض الرصيد');

    r = await call('user?id=u1', 'GET');
    ok(r.j.subscriptions && r.j.subscriptions.length === 1, 'درج الطالب فيه اشتراكاته');
    ok(r.j.credit && r.j.credit.balance.available === 200 && r.j.credit.rows.length === 2,
       'وفيه رصيده وحركاته');
  }

  /* ═══ ج) اللوحة ═══ */
  {
    const { chromium } = require('playwright');
    const USERS = [{ id: 'u1', name: 'سالم', email: 's@x', major: 'MEEN', planVer: 'new', active: true,
                     expires: '2026-12-30T20:59:59.000Z', monitors: 1, creditHalalas: 250 }];
    const DETAIL = { ok: true, user: USERS[0], gpa: 3.1, gpaHours: 30, gradedCourses: 10, completedCount: 10,
      completed: [], schedule: [], prepHint: {},
      subscriptions: [{ term: '202710', status: 'comp', note: 'فائز مسابقة', amount_halalas: 0,
                        valid_until: '2026-12-30T20:59:59.000Z' }],
      credit: { balance: { available: 250, expired: 0, overdraft: 0, nextExpiry: '2027-08-17T20:59:59.000Z' },
                rows: [{ created_at: '2026-10-01T10:00:00Z', amount_halalas: 500, reason: 'admin', note: 'تعويض' },
                       { created_at: '2026-10-02T10:00:00Z', amount_halalas: -250, reason: 'spend', note: '' }] } };
    let lastPricing = null;
    const srv = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(ADMIN)) }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.endsWith('/health')) return res.end(JSON.stringify({ telegramOk: true, freeBeta: true,
        pricing: { termHalalas: 1900, pushoverHalalas: 1000, friendDiscountHalalas: 300,
                   referrerCreditHalalas: 500, reviewsCreditHalalas: 500, reviewsNeeded: 5,
                   creditTerms: 2, lateDays: 3, freeMonitors: 2, freeSchedules: 1 },
        monitorInfo: {}, cache: [] }));
      if (u.endsWith('/users')) return res.end(JSON.stringify({ users: USERS }));
      if (u.endsWith('/user')) return res.end(JSON.stringify(DETAIL));
      if (u.endsWith('/pricing')) {
        let body = ''; req.on('data', c => body += c);
        return req.on('end', () => { lastPricing = JSON.parse(body || '{}').pricing; res.end(JSON.stringify({ pricing: lastPricing })) });
      }
      if (u.endsWith('/monitors')) return res.end(JSON.stringify({ monitors: [] }));
      if (u.endsWith('/reviews')) return res.end(JSON.stringify({ reviews: [] }));
      res.end('{}');
    });
    await new Promise(r => srv.listen(0, r));
    const browser = await chromium.launch();
    const p = await browser.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.evaluate(() => sessionStorage.setItem('jdw_admin', 'x'.repeat(16)));
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1500);

    const sys = await p.evaluate(() => {
      try { go('sys') } catch (e) { try { go('system') } catch (e2) {} }
      const t = document.getElementById('pf_termHalalas');
      return { term: t ? t.value : null, fields: document.querySelectorAll('.price-grid input').length };
    });
    ok(sys.term === '19', 'محرر الأسعار يعرض ١٩ ريالاً لا ١٩٠٠ هللة — ' + sys.term);
    ok(sys.fields === 10, 'وعشرة حقول — ' + sys.fields);

    await p.evaluate(() => { document.getElementById('pf_termHalalas').value = '22.5'; savePricing() });
    await p.waitForTimeout(500);
    ok(lastPricing && lastPricing.termHalalas === 2250, 'الحفظ يرسل هللات: ٢٢٫٥ ← ٢٢٥٠ — ' + JSON.stringify(lastPricing && lastPricing.termHalalas));

    const drawer = await p.evaluate(async () => {
      await openUser('u1');
      await new Promise(r => setTimeout(r, 300));
      return document.getElementById('drawerBody').innerText;
    });
    ok(/2\.50 ريال/.test(drawer), 'الدرج يعرض الرصيد ٢٫٥٠ ريال');
    ok(/هدية/.test(drawer) && /فائز مسابقة/.test(drawer), 'وصف الاشتراك «هدية» مع سببه');
    ok(/صُرف/.test(drawer) && /تعويض/.test(drawer), 'وحركات الرصيد بأسبابها');

    const list = await p.evaluate(() => { try { go('users') } catch (e) {} return document.body.innerText });
    ok(/رصيد\s*2\.50 ريال/.test(list), 'قائمة الطلاب تعرض الرصيد');

    ok(errs.length === 0, 'اللوحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
