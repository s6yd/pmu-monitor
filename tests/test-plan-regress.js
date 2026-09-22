/* انهيار تبويب الخطة وضياع التخصص — اختبار سلوكي في Chromium.
   الحالة الحقيقية: طالب ميكانيكا مسجّل، وتخزينه المحلي فرغ.
   ومعه فحص ثابت يمنع صنف الخطأ نفسه: اسم دالة معرّف مرتين.

   node tests/test-plan-regress.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

/* ── ٠) فحص ثابت: لا دالة معرّفة مرتين ──
   في JavaScript التعريف الأخير يغلب بصمت. هكذا تبدّل معنى activeTermCode
   في ١٦ موضعاً دون أي خطأ. */
{
  const src = fs.readFileSync(FILE, 'utf8');
  const js = [...src.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n');
  const names = {};
  for (const m of js.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm))
    names[m[1]] = (names[m[1]] || 0) + 1;
  const dup = Object.entries(names).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
  ok(dup.length === 0, 'لا دالة معرّفة مرتين — المكرّر: ' + dup.join(' · '));
  ok(!/\bUPCOMING_TERM\b/.test(js), 'لا مرجع لثابت محذوف (UPCOMING_TERM)');
}

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  /* /calendar.js صار يُطلب من الصفحة — ما نرد عليه بـJSON فيُنفَّذ كسكربت */
  if (req.url.split('?')[0].endsWith('.js')) { res.writeHead(404); return res.end('') }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u === '/api/monitor-status')
    return res.end(JSON.stringify({ term: '202710', canWatch: false, build: '"x"' }));
  res.end(JSON.stringify({ success: true, courses: [], cached: false, age: 0 }));
});

const SB = `
window.__PROFILE={id:'u1',major:'MEEN',plan_ver:'old',name:'mohammad',
                  telegram_chat_id:'1',is_pro:true};
window.__CC=[{course_code:'MATH 1422',grade:'A'},{course_code:'PHYS 1421',grade:'B+'},
             {course_code:'COMM 1311',grade:'A'},{course_code:'ALIS 1211',grade:'A'}];
function q(rows){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o},
  in(){return o}, gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:Array.isArray(rows)?rows[0]:rows,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} },
  insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:rows,error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:window.__NOSESSION?null:
           {user:{id:'u1',email:'m@x.com'}}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
         signOut:async()=>({}) },
  from:(t)=> t==='profiles' ? q([window.__PROFILE])
           : t==='completed_courses' ? q(window.__CC) : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB }));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());      /* سجل سفاري انمسح */
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);

  /* ── ١) التخصص يرجع من الحساب بلا ما يُسأل ── */
  {
    const r = await page.evaluate(() => ({
      chosen: majorChosen(), stored: localStorage.getItem('pmu_major'),
      sel: (document.getElementById('majorSelect') || {}).value
    }));
    ok(r.chosen === true, 'تخزين فاضٍ + تخصص في الحساب ⇒ ما يُسأل عن تخصصه');
    ok(/MEEN/.test(String(r.stored)), 'والتخصص انحفظ محلياً — ' + r.stored);
    ok(r.sel === 'MEEN', 'وقائمة الإعدادات عليه');
  }

  /* ── ٢) تبويب الخطة يرسم المواد بلا انهيار ── */
  {
    const before = errs.length;
    const r = await page.evaluate(() => {
      switchTab('plan'); renderPlan();
      return {
        sems: document.querySelectorAll('.sem-block').length,
        sug: (document.getElementById('sugList') || {}).innerHTML || ''
      };
    });
    ok(errs.length === before, 'renderPlan بلا أخطاء — ' + errs.slice(before).join(' | '));
    ok(r.sems >= 8, `الترمات مرسومة — ${r.sems}`);
    ok(r.sug.length > 50, 'والمقترح للترم الجاي مرسوم');
  }

  /* ── ٣) اختيار نفس التخصص يدوياً لا يكسر شيئاً ── */
  {
    const before = errs.length;
    await page.evaluate(() => {
      localStorage.removeItem('pmu_major');
      const el = document.getElementById('majorSelect');
      el.value = 'MEEN'; onMajorChange();
    });
    const n = await page.evaluate(() => document.querySelectorAll('.sem-block').length);
    ok(errs.length === before, 'اختيار التخصص بلا أخطاء');
    ok(n >= 8, 'والمواد تظهر بعده — ' + n);
  }

  /* ── ٣ب) بلا حساب: تخزين فاضٍ = يُسأل، وهذا صحيح ── */
  {
    const p2 = await browser.newPage();
    await p2.route('**/fonts.googleapis.com/**',
      r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p2.route('**/cdn.jsdelivr.net/**', r => r.fulfill({
      status: 200, contentType: 'application/javascript',
      body: 'window.__NOSESSION=true;' + SB }));
    await p2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p2.evaluate(() => localStorage.clear());
    await p2.reload({ waitUntil: 'load' });
    await p2.waitForTimeout(1000);
    const chosen = await p2.evaluate(() => majorChosen());
    ok(chosen === false, 'زائر بلا حساب وتخزين فاضٍ: يُسأل عن تخصصه كما ينبغي');
    await p2.close();
  }

  /* ── ٤) «ابحث عنها» من المقترح وصفحة الدكتور ── */
  {
    const before = errs.length;
    const r = await page.evaluate(() => {
      searchIn('MEEN 3311');
      return document.getElementById('term').value;
    });
    ok(errs.length === before, 'searchIn بلا أخطاء');
    ok(r === '202710', 'ويضبط الترم على الترم النشط — ' + r);
  }

  /* ── ٥) تبويب الدكاترة يحمّل ── */
  {
    const before = errs.length;
    await page.evaluate(() => { try { switchTab('docs') } catch (e) {} });
    await page.waitForTimeout(1200);
    ok(errs.length === before, 'تبويب الدكاترة بلا أخطاء — ' + errs.slice(before).join(' | '));
  }

  /* ── ٦) الغياب والمواعيد على معناها الأصلي: الترم المعروض ── */
  {
    const r = await page.evaluate(() => {
      const sel = document.getElementById('term');
      sel.value = '202720';
      const a = activeTermCode();
      sel.value = '202710';
      return { a, s: serverTerm() };
    });
    ok(r.a === '202720', 'activeTermCode ترجع الترم المعروض كما كانت');
    ok(r.s === '202710', 'و serverTerm ترجع ترم السيرفر — اسمان لمعنيين');
  }

  ok(errs.length === 0, 'لا أخطاء JS إجمالاً: ' + errs.slice(0, 2).join(' | '));

  await browser.close(); server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
