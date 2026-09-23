/* قفل الجرس خارج نافذة التسجيل وعلى غير الترم النشط.
   يفتح الصفحة في Chromium فعلاً ويستدعي watchGate كما تستدعيه الأزرار.

   node tests/test-watch-gate.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  if (u.startsWith('/api/')) {
    /* /calendar.js صار يُطلب من الصفحة — ما نرد عليه بـJSON فيُنفَّذ كسكربت */
    /* الصفحة صارت تحمّل الخطط من /plans.js — نخدم الملف الحقيقي.
       تغيير بنية لا تسهيل: قبله كان المحاكي يرد 404 على كل .js، فالصفحة
       تفقد PLANS وتبويب خطتي يعرض رسالة العطل بدل الخطة. */
    if (req.url.split('?')[0] === '/plans.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
    }
    if (req.url.split('?')[0].endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ courses: [], cached: false, age: 0 }));
  }
  res.writeHead(404); res.end('');
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
          'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
          'from:()=>({select(){return this},eq(){return this},order(){return this},' +
          'limit(){return this},insert(){return this},delete(){return this},' +
          'then:(f)=>f({data:[],error:null})}),' +
          'channel:()=>({on(){return this},subscribe(){return this}}),' +
          'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};'
  }));

  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.watchGate === 'function',
    null, { timeout: 15000 }).catch(() => {});

  const ready = await page.evaluate(() => typeof watchGate === 'function');
  ok(ready, 'watchGate موجودة في الصفحة');
  if (!ready) { console.log('SETUP FAILED', errs.slice(0, 3)); await browser.close(); server.close(); process.exit(1) }

  const gate = (state, term) => page.evaluate(([st, t]) => {
    MON_STATE = st; LANG = 'ar';
    return watchGate(t);
  }, [state, term]);

  /* ── داخل النافذة، الترم النشط ── */
  {
    const g = await gate({ canWatch: true, term: '202710' }, '202710');
    ok(g.ok === true, 'داخل النافذة والترم النشط: مسموح');
  }

  /* ── داخل النافذة، ترم آخر ── */
  {
    const g = await gate({ canWatch: true, term: '202710' }, '202720');
    ok(g.ok === false, 'ترم غير نشط: ممنوع');
    ok(/المفتوح للتسجيل/.test(g.msg), 'والرسالة تشرح السبب: ' + g.msg);
  }

  /* ── خارج النافذة ── */
  {
    const g = await gate({ canWatch: false, term: '202710', next: { from: '2027-01-08' } }, '202710');
    ok(g.ok === false, 'خارج فترة التسجيل: ممنوع حتى على الترم النشط');
    ok(/2027-01-08/.test(g.msg), 'والرسالة تقول متى تفتح: ' + g.msg);
  }
  {
    const g = await gate({ canWatch: false, term: '202710' }, '202710');
    ok(g.ok === false && !/undefined/.test(g.msg),
       'بلا نافذة قادمة: رسالة نظيفة بلا undefined — ' + g.msg);
  }

  /* ── تعذّر قراءة الحالة: نسمح بدل ما نقفل على قطع شبكة ── */
  {
    ok((await gate(null, '202710')).ok === true, 'MON_STATE = null: مسموح');
    ok((await gate({}, '202710')).ok === true, 'حالة بلا حقول: مسموح');
    ok((await gate({ term: '202710' }, '202710')).ok === true,
       'سيرفر قديم بلا canWatch: مسموح (ما نقفل على نسخة قديمة)');
  }

  /* ── الإنجليزية ── */
  {
    const g = await page.evaluate(() => {
      MON_STATE = { canWatch: false, term: '202710' }; LANG = 'en';
      return watchGate('202710');
    });
    ok(/registration/i.test(g.msg), 'رسالة إنجليزية للواجهة الإنجليزية');
  }

  /* ── إيقاف مراقبة قائمة لا يمرّ بالحارس ── */
  {
    const src = await page.evaluate(() => toggleMonitorCourseGo.toString());
    const iGate = src.indexOf('watchGate');
    const iDel = src.indexOf('.delete(');
    ok(iGate > 0 && iDel > 0 && iGate < iDel, 'الحارس قبل فرع الإضافة');
    ok(/if\s*\(\s*!\s*ex\s*\)\s*\{[\s\S]{0,120}watchGate/.test(src),
       'الحارس داخل !ex فقط — الإيقاف يبقى متاحاً دائماً');
    const src2 = await page.evaluate(() => toggleMonitorAllGo.toString());
    ok(/if\s*\(\s*!\s*ex\s*\)\s*\{[\s\S]{0,120}watchGate/.test(src2),
       'ونفس الشيء في مراقبة كل الشعب');
  }

  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
