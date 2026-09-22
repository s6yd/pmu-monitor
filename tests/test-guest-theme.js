/* شريط الزائر في «اليوم» وزر الثيم — اختبار سلوكي في Chromium.

   node tests/test-guest-theme.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/') {
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
  if (u === '/api/monitor-status')
    return res.end(JSON.stringify({ term: '202710', canWatch: false, build: '"x"' }));
  res.end(JSON.stringify({ success: true, courses: [], cached: false, age: 0 }));
});

/* جلسة تُقرأ ببطء — اللحظة التي كان يظهر فيها الشريط للمسجّل */
const sb = (signed, delay) => `
function q(rows){ const o={ select(){return o}, eq(){return o}, order(){return o},
  limit(){return o}, in(){return o}, gte(){return o}, lte(){return o},
  single(){ return Promise.resolve({data:rows[0]||null,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  then(f,r){ return Promise.resolve({data:rows,error:null}).then(f,r) } }; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>{ await new Promise(r=>setTimeout(r,${delay}));
           return {data:{session:${signed ? "{user:{id:'u1',email:'m@x.com'}}" : 'null'}}} },
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) },
  from:(t)=> t==='profiles'
    ? q([{id:'u1',major:'MEEN',plan_ver:'new',name:'mohammad'}])
    : t==='user_schedule'
      ? q([{crn:'1',course_code:'MEEN 3311',course_title:'Thermo',section:'01',
            course_date:'UMTWR',course_timing:'10:00-11:50',instructor:'X',room:'M-CORE - G034',slot:1}])
      : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

async function openPage(browser, port, signed, delay, scheme, theme, withSched) {
  const ctx = await browser.newContext({ colorScheme: scheme || 'light' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 150)));
  await p.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.route('**/cdn.jsdelivr.net/**',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: sb(signed, delay) }));
  if (withSched) await p.addInitScript(() => {
    const c = { crn: '1', courseCode: 'MEEN 3311', courseTitle: 'Thermo', section: '01',
      courseDate: 'UMTWRFS', courseTiming: '00:05-23:55', instructor: 'X', room: 'M-CORE - G034' };
    try {
      localStorage.setItem('pmu_schedules', JSON.stringify([[c], [], []]));
      localStorage.setItem('pmu_schedule', JSON.stringify([c]));
      localStorage.setItem('pmu_major', JSON.stringify('MEEN'));
    } catch (e) {}
  });
  if (theme) await p.addInitScript(t => {
    try { localStorage.setItem('pmu_theme', JSON.stringify(t)) } catch (e) {}
  }, theme);
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
  return { p, ctx, errs };
}

const banner = p => p.evaluate(() =>
  /تتصفّح بلا حساب|browsing without an account/.test(
    (document.getElementById('todayBox') || document.body).innerText || ''));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();

  /* ── ١) مسجّل بجلسة بطيئة: الشريط ما يظهر أبداً ──
     الجدول محفوظ محلياً من زيارة سابقة — هكذا يرسم «اليوم» جدوله فوراً
     قبل ما تُقرأ الجلسة، وهذي هي اللحظة التي كان يظهر فيها الشريط. */
  {
    const { p, ctx, errs } = await openPage(browser, port, true, 900, 'light', null, true);
    await p.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 10000 });
    await p.evaluate(() => { try { switchTab('today') } catch (e) {} });
    let seen = false;
    for (let i = 0; i < 16; i++) {                 /* نراقب ٢٫٤ ثانية كل ١٥٠ms */
      if (await banner(p)) { seen = true; break }
      await p.waitForTimeout(150);
    }
    ok(!seen, 'مسجّل: شريط «تتصفّح بلا حساب» ما ظهر ولا لحظة');
    ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٢) زائر فعلاً: الشريط يظهر بعد قراءة الجلسة ── */
  {
    const { p, ctx } = await openPage(browser, port, false, 300);
    await p.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 10000 });
    await p.evaluate(() => {
      try {
        SCHEDULES = [[{ crn: '1', courseCode: 'MEEN 3311', courseTitle: 'Thermo', section: '01',
          courseDate: 'UMTWR', courseTiming: '10:00-11:50', instructor: 'X', room: 'M-CORE - G034' }], [], []];
        schedule = SCHEDULES[0]; switchTab('today');
      } catch (e) {}
    });
    await p.waitForFunction(
      () => !document.documentElement.classList.contains('auth-pending'),
      null, { timeout: 6000 });
    await p.evaluate(() => { TODAY_HTML = ''; renderToday() });
    ok(await banner(p), 'زائر بلا حساب: الشريط يظهر بعد ما تتضح الحالة');
    await ctx.close();
  }

  /* ── ٣) الثيم: من الغامق ضغطة وحدة ترجع للتلقائي ويتبع الجهاز ── */
  {
    const { p, ctx } = await openPage(browser, port, false, 0, 'light', 'dark');
    await p.waitForFunction(() => typeof toggleTheme === 'function', null, { timeout: 10000 });
    await p.waitForTimeout(400);
    const s0 = await p.evaluate(() => ({ T: THEME, light: document.documentElement.classList.contains('light') }));
    ok(s0.T === 'dark' && !s0.light, 'البداية: غامق دائماً على جهاز فاتح');

    const s1 = await p.evaluate(() => {
      let msg = ''; const o = window.showToast; window.showToast = m => { msg = m };
      toggleTheme(); window.showToast = o;
      return { T: THEME, light: document.documentElement.classList.contains('light'),
               msg, stored: localStorage.getItem('pmu_theme') };
    });
    ok(s1.T === 'auto', 'ضغطة وحدة من الغامق ⇒ تلقائي');
    ok(s1.light === true, 'والجهاز فاتح ⇒ الصفحة صارت فاتحة');
    ok(/تلقائي|Auto/.test(s1.msg), 'ورسالة تقول «تلقائي — يتبع جوالك» — ' + s1.msg);
    ok(/auto/.test(String(s1.stored)), 'ومحفوظ');
    await ctx.close();
  }

  /* ── ٤) كل ضغطة لها رسالة تشرح الخطوة التالية ── */
  {
    const { p, ctx } = await openPage(browser, port, false, 0, 'light', 'auto');
    await p.waitForFunction(() => typeof toggleTheme === 'function', null, { timeout: 10000 });
    const msgs = await p.evaluate(() => {
      const out = []; const o = window.showToast; window.showToast = m => out.push(m);
      toggleTheme(); toggleTheme(); toggleTheme(); window.showToast = o;
      return { out, T: THEME };
    });
    ok(msgs.out.length === 3, 'ثلاث ضغطات = ثلاث رسائل — ' + msgs.out.length);
    ok(/فاتح/.test(msgs.out[0]) && /غامق/.test(msgs.out[1]) && /تلقائي/.test(msgs.out[2]),
       'والترتيب: فاتح ← غامق ← تلقائي');
    ok(/اضغط مرة ثانية ليتبع جوالك/.test(msgs.out[1]),
       'ورسالة الغامق تقول كيف ترجع للتلقائي');
    ok(msgs.T === 'auto', 'والدورة ترجع لنقطة البداية');
    await ctx.close();
  }

  /* ── ٥) الجهاز يتبدّل وهو على التلقائي ── */
  {
    const { p, ctx } = await openPage(browser, port, false, 0, 'light', 'auto');
    await p.waitForFunction(() => typeof applyTheme === 'function', null, { timeout: 10000 });
    await p.waitForTimeout(300);
    const a = await p.evaluate(() => document.documentElement.classList.contains('light'));
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.waitForTimeout(300);
    const b = await p.evaluate(() => document.documentElement.classList.contains('light'));
    ok(a === true && b === false, 'تلقائي: الجهاز يتحوّل للغامق فتتحوّل الصفحة معه');
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
