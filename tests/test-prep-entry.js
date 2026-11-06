/* من وين بدأ التحضيري — اختبار (تذكرة #81، ٦ نوفمبر ٢٠٢٦).
   صفحة البرنامج التحضيري في موقع الجامعة («Sequence of Courses»): الجدول هو المسار «المثالي» لمن
   يبدأ من التأسيسي (أربعة ترمات)، ومن يبدأ من المبتدئ أو المتوسط يتخطّى اللي تحته، ومن يبدأ من
   المتقدم: «need only take study skills II, but they will have to complete the second semester of the
   mathematics requirement in their first semester in Core» — Introductory Algebra في المتقدم، ورياضيات
   تخصصه الثانية (Pre-Calculus أو Intermediate Algebra) في أول ترم بتخصصه. كان الموقع يعرض المسار
   المثالي للكل: اللي بدأ من المتقدم يشوف مستويات ما دخلها تقفل عليه، وPre-Calculus في المتقدم.

   وخطأ قديم معه: الخطة عند التحميل تنبني **بلا التحضيري** (pullCloud تعيد بناءها للميكانيكال والكيميكال
   وحدهما)، فطالب التحضيري يفتح «خطتي» بلا مستوياته والخانة مفعّلة — لين يطفيها ويشغّلها.

   node tests/test-prep-entry.js [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ROOT = path.dirname(PAGE);
const SHARED = path.join(ROOT, 'shared', 'plans.js');
const PORT = 20500 + (process.pid % 100);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* ═══ ١. المنطق المشترك (shared/plans.js) ═══ */
let L = null;
try { L = require(SHARED) } catch (e) { console.log('  ✗ تعذّر require: ' + e.message) }
ok(!!L, 'shared/plans.js يُقرأ');
if (!L) done();

const hasFrom = typeof L.prepFromOf === 'function';
ok(hasFrom, 'prepFromOf مُصدَّرة');
const fromOf = hasFrom ? L.prepFromOf : () => 'PP1';
const codes = sem => (sem ? sem.courses : []).map(c => c.c);

{
  eq(['PP1', 'PP2', 'PP3', 'PP4'].map(fromOf), ['PP1', 'PP2', 'PP3', 'PP4'], 'المستويات الأربعة تُقبل كما هي');
  for (const v of [undefined, null, '', 'pp4', 'PP5', 'Advanced', 4])
    eq(fromOf(v), 'PP1', `${JSON.stringify(v)} ⇒ التأسيسي (الافتراضي = ما كان)`);
}

/* المسار المثالي ما يتغيّر — مادة مادة كما كان قبل الدفعة */
const full = L.prepSems('CHEN');
{
  eq(full.map(s => s.id), ['PP1', 'PP2', 'PP3', 'PP4'], 'بلا مستوى: الأربعة كما كانت');
  eq(full.map(s => codes(s).join(',')), [
    'PRPC 0002,PRPW 0002,PRPE 0002',
    'PRPC 0021,PRPW 0021,PRPE 0021',
    'PRPC 0041,PRPW 0041,PRPI 0041,PRPL 0011,PRPM 0011',
    'PRPC 0061,PRPW 0061,PRPA 0061,PRPL 0012,PRPM 0022,PREE 0061'],
    'المسار المثالي مادة مادة كما كان (Pre-Calculus في المتقدم)');
  eq(L.prepSems('CHEN', 'PP1'), full, 'التأسيسي = المسار المثالي حرفاً بحرف');
  eq(L.semesters('CHEN', 'new', true, 'PP1'), L.semesters('CHEN', 'new', true), 'والفصول كذلك');
}

/* المبتدئ والمتوسط: المستويات اللي تحته ما تخصّه */
{
  eq(L.prepSems('CHEN', 'PP2'), full.slice(1), 'بدأ من المبتدئ: ثلاثة مستويات (المبتدئ · المتوسط · المتقدم)');
  eq(L.prepSems('CHEN', 'PP3'), full.slice(2), 'بدأ من المتوسط: مستويان');
  const s3 = L.semesters('COSC', 'new', true, 'PP3');
  eq(s3.slice(0, 3).map(s => s.id), ['PP3', 'PP4', 'F1'], 'خطته: المتوسط ثم المتقدم ثم أول ترم بتخصصه');
  eq(s3[2], L.planOf('COSC', 'new').sems[0], 'وأول ترم بتخصصه ما يتغيّر (Pre-Calculus خلّصها في المتقدم)');
}

/* المتقدم */
{
  const adv = L.prepSems('CHEN', 'PP4');
  eq(adv.map(s => s.id), ['PP4'], '**بدأ من المتقدم: مستوى تحضيري واحد**');
  const a = codes(adv[0]);
  ok(a.includes('PRPL 0012'), 'فيه Study Skills II (PRPL 0012)');
  ok(a.includes('PRPM 0011'), '**وIntroductory Algebra (PRPM 0011) — أول ترمين الرياضيات**');
  ok(!a.includes('PRPL 0011'), 'وبلا Study Skills I');
  ok(!a.includes(L.PREP_MATH.CHEN), '**وبلا Pre-Calculus — مكانها أول ترم بتخصصه**');
  ok(a.includes(L.PREP_EXIT), 'واختبار الخروج فيه');
  eq((adv[0].courses || []).filter(c => c.adm && c.c !== L.PREP_EXIT).map(c => c.c),
     full[3].courses.filter(c => c.adm && c.c !== L.PREP_EXIT).map(c => c.c),
     'ومواد اللغة نفس مواد المتقدم في المسار المثالي');

  const plan = L.planOf('CHEN', 'new');
  const f1Before = JSON.stringify(plan.sems[0]);
  const s4 = L.semesters('CHEN', 'new', true, 'PP4');
  eq(s4.map(s => s.id), ['PP4'].concat(plan.sems.map(s => s.id)), 'الخطة: المتقدم ثم ترمات التخصص كلها');
  const m = (s4[1] && s4[1].courses[0]) || {};
  eq(m.c, L.PREP_MATH.CHEN, '**أول ترم بتخصصه: Pre-Calculus أول مادة**');
  ok(m.prep === true && m.h === 0, 'مادة تحضيري بلا ساعات — ما تدخل الساعات ولا المعدل');
  eq(m.p, ['PRPM 0011'], 'ومتطلبها Introductory Algebra');
  eq(s4[1] && s4[1].courses.slice(1), plan.sems[0].courses, 'وباقي الترم كما هو');
  eq(JSON.stringify(plan.sems[0]), f1Before, 'وبيانات الخطة المشتركة ما انلمست (نسخة من الترم)');
  eq((L.semesters('ACCT', 'new', true, 'PP4')[1] || { courses: [{}] }).courses[0].c, 'PRPM 0012',
     'الإداري: Intermediate Algebra في أول ترم بتخصصه');
  eq(L.semesters('CHEN', 'new', false, 'PP4'), plan.sems, 'التحضيري مطفأ: المستوى ما يغيّر شي');
  eq(L.ctxOf({ major: 'CHEN', planVer: 'new', prep: true, prepFrom: 'PP4' }).sems.map(s => s.id).slice(0, 2),
     ['PP4', 'F1'], 'ctxOf يبني الفصول من prepFrom (المساعد يمرّره من الحساب)');
  eq(L.ctxOf({ major: 'CHEN', planVer: 'new', prep: true }).prepFrom, 'PP1', 'وبلاه التأسيسي');
}

/* المقترح والقفل وتوقّع التخرج لمن بدأ من المتقدم */
{
  const C = o => L.ctxOf(Object.assign({ major: 'CHEN', planVer: 'new', prep: true, prepFrom: 'PP4' }, o));
  const s0 = L.suggestNext(C({}));
  eq(s0.prepSem && s0.prepSem.id, 'PP4', '**مستواه الحالي المتقدم — لا التأسيسي**');
  eq(s0.crit.map(c => c.c).sort(), ['PRPL 0012', 'PRPM 0011'], 'مقترحه: Study Skills II وIntroductory Algebra');
  eq(s0.opt, [], 'وبلا مواد تخصص وهو في التحضيري');
  ok(L.prereqCheck(C({}), 'PRPM 0011').ok, 'Introductory Algebra مفتوحة له — ما يقفلها مستوى ما دخله');

  const pp4 = codes(L.prepSems('CHEN', 'PP4')[0]);
  const g = Object.fromEntries(pp4.map(c => [c, 'A']));
  const s1 = L.suggestNext(C({ completed: pp4, grades: g }));
  eq(s1.crit[0] && s1.crit[0].c, L.PREP_MATH.CHEN, '**بعد المتقدم: Pre-Calculus أول المقترح (أساسية)**');
  const c1 = s1.crit.concat(s1.opt).map(c => c.c);
  ok(!c1.includes('MATH 1422'), 'وCalculus I تنتظرها (بوابة الرياضيات) — ' + c1.join(','));
  ok(c1.includes('UNIV 1211'), 'ومواد اللغة انفتحت باختبار الخروج — ' + c1.join(','));
  const s2 = L.suggestNext(C({ completed: pp4.concat([L.PREP_MATH.CHEN]),
                               grades: Object.assign({}, g, { [L.PREP_MATH.CHEN]: 'B' }) }));
  ok(s2.crit.concat(s2.opt).some(c => c.c === 'MATH 1422'), 'وبعد Pre-Calculus تنفتح Calculus I');

  const gp = L.gradPlan(C({ term: '202720' }), {});
  const at = code => (gp.terms || []).findIndex(t => (t.courses || []).some(c => c.code === code));
  ok(at('PRPM 0011') === 0, 'توقّع التخرج: Introductory Algebra أول ترم');
  ok(at(L.PREP_MATH.CHEN) === 1, 'وPre-Calculus الترم اللي بعده (أول ترم بتخصصه) — ' + at(L.PREP_MATH.CHEN));
  ok(at('MATH 1422') > at(L.PREP_MATH.CHEN), 'وCalculus I بعدها');
}

/* ═══ ٢. فحص ثابت: الرفع للحساب طلب لحاله وبلا أعمدة فوترة ═══ */
const src = fs.readFileSync(PAGE, 'utf8');
{
  const pf = /async function pushPrepFrom\(\)[\s\S]*?\n\}/.exec(src);
  ok(!!pf, 'pushPrepFrom موجودة');
  ok(!!pf && /update\(\{prep_from:prepFrom\(\)\}\)/.test(pf[0]), 'وترفع prep_from وحده (طلب مستقل — قبل الـSQL يفشل وحده)');
  const pp = /async function pushProfile\(\)[\s\S]*?\n\}/.exec(src);
  ok(!!pp && !/prep_from/.test(pp[0]), 'وpushProfile ما يحمله (فشله قبل الـSQL ما يوقف رفع التخصص)');
  ok(/id="prepFromBox"/.test(src) && !/id="prepFromBox"[^>]*data-i18n/.test(src),
     'مكان «بدأت من أي مستوى؟» موجود، وبلا data-i18n (يكتبه JS)');
}

/* ═══ ٣. سلوكي: الصفحة في متصفح حقيقي مع قاعدة مزيّفة ═══ */
let chromium = null;
try { ({ chromium } = require('playwright')) } catch (e) {}
ok(!!chromium, 'playwright متوفر');
if (!chromium) done();

const pageHtml = src;
const plansJs = fs.readFileSync(SHARED);
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('window.ACAD_CAL=[];') }
  if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  if (u.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(u === '/api/monitor-status'
      ? { term: '202710', canWatch: false, build: '"x"' }
      : { success: true, courses: [], cached: false, age: 0 }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pageHtml);
});

/* محاكي Supabase في المتصفح: صف الملف في window.__ROW (null = زائر بلا جلسة)، وكل update
   يُسجَّل في window.__WRITES. وقبل الـSQL: الصف بلا مفتاح prep_from أصلاً (select=* ما يرجعه) */
const SB = row => `
window.__ROW=${JSON.stringify(row)};
window.__WRITES=[];
function q(rows){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o},
  in(){return o}, gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:Array.isArray(rows)?rows[0]:rows,error:null}) },
  update(v){ window.__WRITES.push(v); if(window.__ROW)Object.assign(window.__ROW,v);
             return {eq:async()=>({data:[],error:null})} },
  insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:rows,error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:window.__ROW?{user:{id:'u1',email:'m@x.com'}}:null}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
         signOut:async()=>({}) },
  from:(t)=> t==='profiles' ? q(window.__ROW?[window.__ROW]:[]) : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

(async () => {
  await new Promise((r, j) => { server.once('error', j); server.listen(PORT, '127.0.0.1', r) });
  const browser = await chromium.launch();
  const ERRS = [];

  /* يفتح الصفحة بصف ملف (null = زائر) وتخزين متصفح معيّن */
  const open = async (row, local, opt) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
      colorScheme: (opt && opt.scheme) || 'dark' });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => ERRS.push(String(e).slice(0, 160)));
    await pg.addInitScript(SB(row));
    /* دليل أول زيارة وترحيبها يغطّيان الصفحة — شافها قبل؛ والثيم صريح لا من الجهاز وحده */
    const seen = { pmu_seen_guide: true, pmu_seen_welcome: true, pmu_theme: (opt && opt.scheme) || 'dark' };
    await pg.addInitScript(v => {
      try { for (const k in v) localStorage.setItem(k, JSON.stringify(v[k])) } catch (e) {}
    }, Object.assign(seen, local || {}));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB(row) }));
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && window.PLANS_OK === true,
      null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(1200);           /* pullCloud للمسجّل */
    return { pg, ctx };
  };
  const state = pg => pg.evaluate(() => ({
    sems: (typeof PLAN !== 'undefined' && PLAN) ? PLAN.map(s => s.id) : [],
    f1: (typeof PLAN !== 'undefined' && PLAN) ? ((PLAN.find(s => !s.prep) || { courses: [] }).courses[0] || {}).c : null,
    from: localStorage.getItem('pmu_prep_from'),
    writes: window.__WRITES, row: window.__ROW,
  }));
  const ideal = ['PP1', 'PP2', 'PP3', 'PP4', 'F1'];

  /* ── أ) خطأ قديم: الخطة عند التحميل بلا التحضيري ── */
  {
    const { pg, ctx } = await open(null, { pmu_major: 'COSC', pmu_prep: true });
    const s = await state(pg);
    eq(s.sems.slice(0, 5), ideal, '**زائر بالتحضيري: الخطة فيها مستوياته من أول تحميل** (كانت تبدأ بـF1)');
    await ctx.close();
  }
  {
    const { pg, ctx } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: true },
                                   { pmu_major: 'COSC', pmu_prep: true });
    const s = await state(pg);
    eq(s.sems.slice(0, 5), ideal, '**مسجّل وتخصصه نفس الحساب: مستوياته من أول تحميل** (كانت للميكانيكال والكيميكال وحدهما)');
    ok(s.writes.every(w => !('prep_from' in w)), 'وقبل الـSQL (العمود ما يرجع) ما نرفع prep_from — ' + JSON.stringify(s.writes));
    await ctx.close();
  }
  {
    const { pg, ctx } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: true },
                                   { pmu_major: 'COSC', pmu_prep: false });
    const s = await state(pg);
    eq(s.sems.slice(0, 5), ideal, '**الحساب true والمتصفح false: الخطة تنبني من جديد بالتحضيري** (كانت تبقى بقيمة المتصفح)');
    await ctx.close();
  }

  /* ── ب) الاختيار من الإعدادات ── */
  {
    const row = { id: 'u1', major: 'CHEN', plan_ver: 'CHEN:new', prep: true, prep_from: null };
    const { pg, ctx } = await open(row, { pmu_major: 'CHEN', pmu_prep: true, pmu_plan_ver: 'CHEN:new' });
    await pg.evaluate(() => switchTab('set'));
    await pg.waitForTimeout(300);
    const ui = await pg.evaluate(() => {
      const b = document.getElementById('prepFromBox');
      return { vis: !!b && b.classList.contains('visible') && b.offsetHeight > 0,
               btns: b ? [...b.querySelectorAll('[data-pf]')].map(x => x.dataset.pf) : [],
               on: b ? [...b.querySelectorAll('.pv-b.on')].map(x => x.dataset.pf) : [] };
    });
    ok(ui.vis, '«بدأت التحضيري من أي مستوى؟» يطلع تحت الخانة لمن فعّلها');
    eq(ui.btns, ['PP1', 'PP2', 'PP3', 'PP4'], 'وفيه المستويات الأربعة');
    eq(ui.on, ['PP1'], 'والمختار التأسيسي افتراضياً');

    /* كود قديم بلا الزر: فشل مرتّب ونكمل باقي الحالات بدل انتظار ٣٠ ثانية */
    if (!ui.btns.includes('PP4')) { ok(false, 'ما فيه زر «المتقدم» — نتخطّى الضغط'); await ctx.close() }
    else {
    await pg.click('#prepFromBox [data-pf="PP4"]');
    await pg.waitForTimeout(400);
    const s = await state(pg);
    eq(s.from, '"PP4"', 'الضغطة تنحفظ في المتصفح');
    eq(s.writes.filter(w => 'prep_from' in w), [{ prep_from: 'PP4' }], 'وتنرفع للحساب بطلب لحاله');
    const BILLING = ['is_pro', 'subscription_expires_at', 'paid_at', 'invite_code', 'pushover_until',
                     'telegram_chat_id', 'telegram_username', 'telegram_link_code'];
    ok(s.writes.every(w => BILLING.every(b => !(b in w))), 'ولا كتابة لعمود فوترة أو هوية');
    eq(s.sems.slice(0, 2), ['PP4', 'F1'], '**وخطته صارت من المتقدم**');
    eq(s.f1, L.PREP_MATH.CHEN, '**وPre-Calculus أول مادة في أول ترم بتخصصه**');
    const ui2 = await pg.evaluate(() => {
      const b = document.getElementById('prepFromBox');
      return { on: [...b.querySelectorAll('.pv-b.on')].map(x => x.dataset.pf),
               note: (b.querySelector('.pv-n') || {}).textContent || '',
               toast: (document.getElementById('toast') || {}).textContent || '' };
    });
    eq(ui2.on, ['PP4'], 'والزر المختار المتقدم');
    ok(/Pre-Calculus/.test(ui2.note) && /أول ترم بتخصصه/.test(ui2.note),
       'والملاحظة تقول وين راحت Pre-Calculus — ' + ui2.note.slice(0, 90));

    /* عدّاد التحضيري من الخطة المرسومة: ٦ في المتقدم + Pre-Calculus في أول ترم بتخصصه */
    await pg.evaluate(() => switchTab('plan'));
    await pg.waitForTimeout(400);
    const prog = await pg.evaluate(() => {
      const b = document.getElementById('prepProg');
      return b ? b.textContent.replace(/\s+/g, ' ') : '';
    });
    ok(/\/ 7 /.test(prog), 'عدّاد التحضيري يعدّ مواد خطته (٧) — ' + prog.slice(0, 60));
    const planTxt = await pg.evaluate(() => (document.getElementById('pagePlan') || {}).textContent || '');
    ok(/Introductory Algebra/.test(planTxt), 'و«خطتي» فيها Introductory Algebra');

    /* إطفاء التحضيري يخفي السؤال */
    await pg.evaluate(() => { switchTab('set'); const el = document.getElementById('prepChk'); el.checked = false; onPrepToggle() });
    await pg.waitForTimeout(200);
    ok(await pg.evaluate(() => !document.getElementById('prepFromBox').classList.contains('visible')),
       'التحضيري مطفأ: السؤال مخفي');
    await ctx.close();
    }
  }

  /* ── ج) الحساب يغلب، وNULL «ما انضبط» ── */
  {
    /* جهاز ثاني بتخزين فاضٍ */
    const { pg, ctx } = await open({ id: 'u1', major: 'CHEN', plan_ver: 'CHEN:new', prep: true, prep_from: 'PP4' }, {});
    const s = await state(pg);
    eq(s.sems.slice(0, 2), ['PP4', 'F1'], '**جهاز ثاني: المستوى رجع من الحساب**');
    eq(s.f1, L.PREP_MATH.CHEN, 'وPre-Calculus في أول ترم بتخصصه');
    await ctx.close();
  }
  {
    const { pg, ctx } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: true, prep_from: null },
                                   { pmu_major: 'COSC', pmu_prep: true, pmu_prep_from: 'PP4' });
    const s = await state(pg);
    eq(s.writes.filter(w => 'prep_from' in w), [{ prep_from: 'PP4' }], 'الحساب NULL: قيمة المتصفح تصعد مرة وحدة');
    eq(s.sems.slice(0, 2), ['PP4', 'F1'], 'وتبقى خطته من المتقدم');
    await ctx.close();
  }
  {
    const { pg, ctx } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new', prep: true, prep_from: 'PP3' },
                                   { pmu_major: 'COSC', pmu_prep: true, pmu_prep_from: 'PP4' });
    const s = await state(pg);
    eq(s.from, '"PP3"', 'المحفوظ في الحساب يغلب المتصفح');
    eq(s.sems.slice(0, 3), ['PP3', 'PP4', 'F1'], '**والخطة تنبني من جديد بمستوى الحساب** (تخصص بلا نسخة ثانية)');
    ok(s.writes.every(w => !('prep_from' in w)), 'وبلا رفع');
    await ctx.close();
  }

  /* ── هـ) بلاغ «غلط في الخطة» يقول من وين بدأ — تذكرة #81 جت بلاه ── */
  {
    const { pg, ctx } = await open(null, { pmu_major: 'CHEN', pmu_prep: true, pmu_prep_from: 'PP4' });
    const v = await pg.evaluate(async () => {
      if (typeof reportPlan !== 'function') return '';
      reportPlan(); await new Promise(r => setTimeout(r, 400));
      return (document.getElementById('fbText') || {}).value || '';
    });
    ok(/CHEN \+ تحضيري من المتقدم/.test(v), 'بلاغ غلط الخطة يقول «تحضيري من المتقدم» — ' + v.slice(0, 60));
    await ctx.close();
  }

  /* ── د) الإنجليزي، ومقاس الجوال بالثيمين ── */
  for (const scheme of ['dark', 'light']) {
    const { pg, ctx } = await open(null, { pmu_major: 'CHEN', pmu_prep: true, pmu_prep_from: 'PP4' }, { scheme });
    await pg.evaluate(() => switchTab('set'));
    await pg.waitForTimeout(300);
    for (const lang of ['ar', 'en']) {
      if (lang === 'en') { await pg.evaluate(() => toggleLang()); await pg.waitForTimeout(250) }
      const m = await pg.evaluate(() => {
        const b = document.getElementById('prepFromBox');
        if (!b) return { txt: [], inside: false, clip: [], pageW: 0, vw: 0 };
        const bs = [...b.querySelectorAll('.pv-b')];
        const r = b.getBoundingClientRect();
        return { txt: bs.map(x => x.textContent.trim()),
                 inside: bs.every(x => { const q = x.getBoundingClientRect(); return q.left >= r.left - 1 && q.right <= r.right + 1 }),
                 clip: bs.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()),
                 pageW: document.documentElement.scrollWidth, vw: innerWidth };
      });
      if (lang === 'en') eq(m.txt, ['Pre-Beginner', 'Beginner', 'Intermediate', 'Advanced'], `${scheme}: الأزرار بالإنجليزي`);
      else eq(m.txt, ['التأسيسي', 'المبتدئ', 'المتوسط', 'المتقدم'], `${scheme}: الأزرار بالعربي`);
      ok(m.inside, `${scheme}/${lang}: الأزرار داخل البطاقة على ٣٩٠`);
      eq(m.clip, [], `${scheme}/${lang}: ولا نص مقصوص`);
      ok(m.pageW <= m.vw, `${scheme}/${lang}: بلا تمرير أفقي — ${m.pageW} > ${m.vw}`);
    }
    await ctx.close();
  }

  eq(ERRS, [], 'بلا أخطاء JS في الصفحة');
  await browser.close();
  server.close();
  done();
})().catch(e => {
  console.log('  ✗ انهار: ' + (e && e.message || e));
  fail++;
  done();
});
