/* بطاقة الترم وترتيب القائمة وومضة الدخول — اختبار عرض في Chromium.

   node tests/test-term-ui.js [مسار pmu-schedule.html] */
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
  res.end(JSON.stringify({ courses: [], cached: false, age: 0 }));
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
          'update(){return {eq:async()=>({data:[],error:null})}},' +
          'then:(f)=>f({data:[],error:null})}),' +
          'channel:()=>({on(){return this},subscribe(){return this}}),' +
          'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};'
  }));

  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.syncTermSelect === 'function',
    null, { timeout: 15000 }).catch(() => {});

  const ready = await page.evaluate(() => typeof syncTermSelect === 'function');
  ok(ready, 'دوال الترم موجودة');
  if (!ready) { console.log('SETUP FAILED', errs.slice(0, 3)); await browser.close(); server.close(); process.exit(1) }

  const setup = (st) => page.evaluate(s2 => {
    MON_STATE = s2; LANG = 'ar';
    syncTermSelect();
    return {
      order: [...document.getElementById('term').options].map(o => o.value),
      value: document.getElementById('term').value,
      hint: document.getElementById('termHint').textContent,
      hidden: document.getElementById('termHint').className.includes('hide')
    };
  }, st);

  /* ── ٠) قبل أي نداء: ما يظهر صندوق فاضٍ ── */
  {
    const r = await page.evaluate(() => {
      const el = document.getElementById('termHint');
      el.textContent = ''; el.className = 'term-hint hide';
      const cs = getComputedStyle(el);
      return { disp: cs.display, txt: el.textContent };
    });
    ok(r.disp === 'none', 'الصندوق مخفيّ ما دام فاضياً');
    const raw = await page.evaluate(() =>
      document.documentElement.outerHTML.includes('class="term-hint hide" id="termHint"'));
    ok(raw, 'والحالة الابتدائية في HTML مخفية — لا وميض صندوق فاضٍ');
  }

  /* ── ١) الترتيب ── */
  {
    const r = await setup({ term: '202710', canWatch: false });
    const sorted = [...r.order].sort((a, b) => Number(b) - Number(a));
    ok(JSON.stringify(r.order) === JSON.stringify(sorted),
       'القائمة مرتّبة من الأحدث للأقدم — ' + r.order.join(' '));
    ok(r.order[0] === '202730', 'الأحدث أولاً');
  }

  /* ── ٢) التسجيل مقفول: ما نقول «قادم» ── */
  {
    const r = await setup({ term: '202710', canWatch: false });
    ok(r.value === '202710', 'المحدَّد هو الترم النشط');
    ok(/الترم الحالي/.test(r.hint), 'يقول «الترم الحالي» — جاء: ' + r.hint);
    ok(!/قادم/.test(r.hint), 'وما يوعد بتسجيل قادم');
  }

  /* ── ٣) التسجيل مفتوح ── */
  {
    const r = await setup({ term: '202710', canWatch: true });
    ok(/المفتوح للتسجيل/.test(r.hint), 'يقول إن التسجيل مفتوح — ' + r.hint);
  }

  /* ── ٤) الترم النشط تبدّل: البطاقة تتبعه بلا تعديل كود ── */
  {
    const r = await setup({ term: '202720', canWatch: true });
    ok(r.value === '202720', 'المحدَّد تبع الترم الجديد');
    ok(/المفتوح للتسجيل/.test(r.hint), 'والبطاقة عليه');
    const other = await page.evaluate(() => {
      document.getElementById('term').value = '202610';
      termHint();
      return document.getElementById('termHint').className;
    });
    ok(/hide/.test(other), 'وترم قديم: البطاقة تختفي');
  }

  /* ── ٥) نص تبويب الخطة يتبع الحالة ── */
  {
    const closed = await page.evaluate(() => {
      MON_STATE = { term: '202710', canWatch: false }; LANG = 'ar';
      syncPlanHint();
      return document.getElementById('tapTip').textContent;
    });
    ok(/الترم الحالي/.test(closed), 'نص الخطة: الترم الحالي — ' + closed);
    const open = await page.evaluate(() => {
      MON_STATE = { term: '202710', canWatch: true };
      syncPlanHint();
      return document.getElementById('tapTip').textContent;
    });
    ok(/التسجيل القادم/.test(open), 'ومع فتح التسجيل: ترم التسجيل القادم');
  }

  /* ── ٦) ومضة الدخول ── */
  {
    const p2 = await browser.newPage();
    await p2.route('**/fonts.googleapis.com/**',
      r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    /* جلسة بطيئة القراءة — هذي اللحظة التي كان يومض فيها «دخول»
       لطالب هو أصلاً مسجّل */
    await p2.route('**/cdn.jsdelivr.net/**', r => r.fulfill({
      status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{' +
            'getSession:async()=>{await new Promise(x=>setTimeout(x,900));' +
            'return {data:{session:null}}},' +
            'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
            'from:()=>({select(){return this},eq(){return this},order(){return this},' +
            'limit(){return this},then:(f)=>f({data:[],error:null})}),' +
            'channel:()=>({on(){return this},subscribe(){return this}}),' +
            'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    await p2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
    await p2.waitForSelector('#authBtn', { state: 'attached', timeout: 8000 });
    const early = await p2.evaluate(() => {
      const b = document.getElementById('authBtn');
      const n = document.getElementById('syncNote');
      return { btn: getComputedStyle(b).visibility,
               note: getComputedStyle(n).display,
               pending: document.documentElement.classList.contains('auth-pending') };
    });
    ok(early.pending === true, 'قبل قراءة الجلسة: الصفحة في وضع انتظار');
    ok(early.btn === 'hidden', 'زر الدخول مخفيّ — لا يومض');
    ok(early.note === 'none', 'وشريط «غير مسجّل» مخفيّ');

    await p2.waitForFunction(
      () => !document.documentElement.classList.contains('auth-pending'),
      null, { timeout: 8000 });
    const late = await p2.evaluate(() => ({
      btn: getComputedStyle(document.getElementById('authBtn')).visibility,
      txt: document.getElementById('authBtn').textContent.trim()
    }));
    ok(late.btn === 'visible', 'وبعد قراءة الجلسة يظهر الزر');
    ok(late.txt.length > 0, 'وفيه نص — ' + late.txt);
    await p2.close();
  }

  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
