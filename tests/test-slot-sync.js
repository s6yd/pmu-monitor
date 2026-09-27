/* الجدول النشط في الحساب — اختبار سلوكي في Chromium.
   كان رقم الجدول المختار (١–٣) في تخزين المتصفح وحده، فالمساعد والبوت
   ما يعرفون أي جدول يستعمله الطالب ويفترضون الأول: «وش عندي بكرة» من
   البوت يطلع من جدول بديل ما يستعمله. الحين في profiles.active_slot.

   أربعة أخطار يمسكها:
   ١) التبديل ما يُرفع للحساب، فالسيرفر يبقى أعمى.
   ٢) المحفوظ في الحساب ما يُقرأ، فجهاز ثانٍ يفتح على جدول غير اللي يستعمله.
   ٣) طالب موجود قيمته في متصفحه والحساب NULL ⇒ ما تصعد أبداً.
   ٤) جدول مقفول (انتهى اشتراكه) محفوظ في الحساب ⇒ البوت يقرأ جدولاً
      الصفحة نفسها ما تعرضه له.
   وحارس: قبل ما ينفّذ محمد الـSQL (العمود ناقص) ما نكتب عند التحميل.

   node tests/test-slot-sync.js [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(__dirname, '..', 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ═══ فحص ثابت: الرفع طلب مستقل ═══
   لو دخل active_slot في pushProfile، فقبل الـSQL يفشل الطلب كله —
   ويوقف معه رفع التخصص ونسخة الخطة والتحضيري. */
{
  const src = fs.readFileSync(PAGE, 'utf8');
  const pp = /async function pushProfile\(\)[\s\S]*?\n\}/.exec(src);
  ok(!!pp && !/active_slot/.test(pp[0]),
     'active_slot خارج pushProfile — عمود ناقص ما يوقف رفع التخصص');
  const BILLING = ['is_pro', 'subscription_expires_at', 'paid_at', 'invite_code', 'pushover_until'];
  const ps = /async function pushSlot\(\)[\s\S]*?\n\}/.exec(src);
  ok(!!ps, 'pushSlot موجودة');
  if (ps) for (const b of BILLING)
    ok(!new RegExp('\\b' + b + '\\b').test(ps[0]), `pushSlot ما تلمس عمود الفوترة ${b}`);
}

let chromium = null;
try { ({ chromium } = require('playwright')) } catch (e) {}
ok(!!chromium, 'playwright متوفر');
if (!chromium) { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(1) }

const pageHtml = fs.readFileSync(PAGE, 'utf8');
const plansJs = fs.readFileSync(SHARED);
/* حالة المراقبة: الفترة المجانية تفتح الجداول الثلاثة للمسجّل —
   نطفيها في حالة القفل */
let MON = { term: '202710', canWatch: false, build: '"x"' };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('window.ACAD_CAL=[];') }
  if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  if (u.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(u === '/api/monitor-status' ? MON
      : { success: true, courses: [], cached: false, age: 0 }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pageHtml);
});

/* صيغة user_schedule كما في القاعدة: الوقت بلا نقطتين والأيام حروف */
const US = [
  { slot: 1, crn: '10002', course_code: 'MATH 1422', course_title: 'Calculus I', section: '101',
    course_date: 'MW', course_timing: '0930 - 1045', instructor: 'Sara Nasser', room: 'M-CORE - F155' },
  { slot: 2, crn: '20001', course_code: 'PHYS 1421', course_title: 'Physics I', section: '102',
    course_date: 'R', course_timing: '1200 - 1250', instructor: 'Noura Faisal', room: 'M-SCI - 101' },
  { slot: 3, crn: '11156', course_code: 'CHEM 1421', course_title: 'Chemistry for Engineers I',
    section: '101', course_date: 'UTR', course_timing: '1200 - 1250', instructor: 'A', room: 'M-CORE - F155' },
];

/* محاكي Supabase في المتصفح: صف الملف في window.__ROW، وكل update
   يُسجَّل في window.__WRITES — فنرى وش رُفع فعلاً */
const SB = row => `
window.__ROW=${JSON.stringify(row)};
window.__WRITES=[];
function q(rows){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o},
  in(){return o}, gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:Array.isArray(rows)?rows[0]:rows,error:null}) },
  update(v){ window.__WRITES.push(v); Object.assign(window.__ROW,v);
             return {eq:async()=>({data:[],error:null})} },
  insert(){ return Promise.resolve({data:[],error:null}) },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:rows,error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:{user:{id:'u1',email:'m@x.com'}}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
         signOut:async()=>({}) },
  from:(t)=> t==='profiles' ? q([window.__ROW])
           : t==='user_schedule' ? q(${JSON.stringify(US)}) : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const PORT = server.address().port;
  const browser = await chromium.launch();

  const open = async (row, localSlot) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.addInitScript(SB(row));
    await pg.addInitScript(v => {
      try { localStorage.setItem('pmu_major', JSON.stringify('COSC'));
            if (v !== undefined) localStorage.setItem('pmu_slot', JSON.stringify(String(v))) } catch (e) {}
    }, localSlot);
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB(row) }));
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await pg.waitForTimeout(1600);
    return { pg, ctx, errs };
  };
  const state = pg => pg.evaluate(() => ({
    slot: typeof SLOT === 'number' ? SLOT : null,
    codes: (typeof schedule !== 'undefined' && Array.isArray(schedule)) ? schedule.map(c => c.courseCode) : null,
    on: [...document.querySelectorAll('#slotBar .slot-pick')].findIndex(b => b.classList.contains('on')),
    stored: (() => { try { return JSON.parse(localStorage.getItem('pmu_slot')) } catch (e) { return null } })(),
    slotWrites: (window.__WRITES || []).filter(w => 'active_slot' in w).map(w => w.active_slot),
    row: window.__ROW,
  }));

  /* ── ١) المحفوظ في الحساب يغلب: جهاز ثانٍ يفتح على جدوله ── */
  {
    const { pg, ctx, errs } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: false,
                                           active_slot: 3 }, 0);
    let s = await state(pg);
    eq(s.slot, 2, '**الحساب يقول جدول ٣ والمتصفح ١ ⇒ يفتح على ٣**');
    eq(s.codes, ['CHEM 1421'], 'ومواده هي مواد الجدول الثالث');
    eq(s.on, 2, 'والزر الثالث هو المضاء');
    eq(s.stored, '2', 'والمتصفح يتذكّره');
    eq(s.slotWrites, [], 'وما نكتب شيئاً — القيمة جت من الحساب نفسه');

    /* ── ٢) التبديل يُرفع للحساب ── */
    await pg.evaluate(() => switchSlot(1));
    await pg.waitForTimeout(300);
    s = await state(pg);
    eq(s.slotWrites, [2], '**التبديل لجدول ٢ ينرفع للحساب** — هذا اللي يقرأه المساعد والبوت');
    eq(s.row.active_slot, 2, 'والحساب صار ٢');
    eq(s.codes, ['PHYS 1421'], 'والصفحة على الجدول الثاني');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٣) الحساب NULL وقيمة المتصفح غير الأول ⇒ تصعد مرة وحدة ── */
  {
    const { pg, ctx, errs } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: false,
                                           active_slot: null }, 1);
    const s = await state(pg);
    eq(s.slot, 1, 'NULL ما يمسح اختيار المتصفح');
    eq(s.slotWrites, [2], '**وقيمة المتصفح تصعد للحساب مرة وحدة**');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٤) قبل الـSQL: العمود ناقص ⇒ ما نكتب عند التحميل ── */
  {
    const { pg, ctx, errs } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: false }, 1);
    const s = await state(pg);
    eq(s.slot, 1, 'بلا العمود: الصفحة على اختيار المتصفح كما كانت');
    eq(s.slotWrites, [], '**وما نكتب عموداً ما انضاف بعد** مع كل تحميل');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٥) جدول مقفول محفوظ في الحساب ⇒ نصحّح الحساب لما تعرضه الصفحة ── */
  {
    MON = { term: '202710', canWatch: false, build: '"x"', freeBeta: false,
            plans: { freeSchedules: 1 } };
    const { pg, ctx, errs } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: false,
                                           is_pro: false, active_slot: 3 }, 0);
    await pg.waitForTimeout(600);
    const s = await state(pg);
    eq(s.slot, 0, 'انتهى اشتراكه: الصفحة على الجدول الأول');
    ok(s.slotWrites.length >= 1 && s.slotWrites[s.slotWrites.length - 1] === 1,
       '**والحساب ينصحّح لـ١** — وإلا البوت يقرأ جدولاً مقفولاً عليه — ' + JSON.stringify(s.slotWrites));
    eq(s.row.active_slot, 1, 'والحساب صار ١');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
    MON = { term: '202710', canWatch: false, build: '"x"' };
  }

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('انهار: ' + (e && e.stack || e));
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
