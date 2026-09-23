/* حالة التحضيري في السحابة — اختبار.
   كانت في localStorage وحده، فتضيع لو مسح الطالب تخزينه أو دخل من
   جهاز ثاني، والنسخة المثبّتة على الشاشة الرئيسية في iOS تخزينها
   منفصل عن سفاري أصلاً — فيفتحها ويلقى التحضيري مطفأً وخطته ناقصة.

   ثلاثة أخطار يمسكها:
   ١) القيمة ما تُرفع للقاعدة عند التبديل، فتبقى محلية.
   ٢) طالب موجود قيمته في متصفحه تنطفي لأن القاعدة NULL.
   ٣) NULL تُقرأ «مطفأ» بدل «ما انضبطت» فتنمسح قيمة الطالب.

   node tests/test-prep-sync.js [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ROOT = path.dirname(PAGE);
const SHARED = path.join(ROOT, 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ═══ فحص ثابت: الصفحة ترفع prep مع التخصص ═══ */
{
  const src = fs.readFileSync(PAGE, 'utf8');
  const pp = /async function pushProfile\(\)[\s\S]*?\n\}/.exec(src);
  ok(!!pp, 'pushProfile موجودة');
  if (pp) {
    ok(/prep\s*:/.test(pp[0]), 'pushProfile ترفع prep مع التخصص ونسخة الخطة');
    ok(/prepOn\(\)/.test(pp[0]), 'وقيمتها من prepOn لا من عنصر الواجهة');
  }
  const tog = /function onPrepToggle\(\)[\s\S]*?\n\}/.exec(src);
  ok(!!tog && /pushProfile\(\)/.test(tog[0]),
     'تبديل التحضيري يرفع القيمة للسحابة فوراً');

  /* NULL تُقرأ «ما انضبطت» لا «مطفأ» */
  ok(/typeof\s+prof\.prep\s*===\s*'boolean'/.test(src),
     'الصفحة تميّز القيمة المحفوظة بـtypeof — NULL مو false');

  /* prep ليس عمود فوترة: ما يُضاف للحارس */
  const BILLING = ['is_pro', 'subscription_expires_at', 'paid_at', 'invite_code', 'pushover_until'];
  const upd = [...src.matchAll(/profiles'\)\.update\(\{([^}]*)\}/g)].map(m => m[1]);
  for (const u of upd) for (const b of BILLING) {
    ok(!new RegExp('\\b' + b + '\\s*:').test(u),
       `الصفحة ما تكتب عمود الفوترة ${b} — «${u.slice(0, 60)}»`);
  }
  ok(upd.some(u => /prep\s*:/.test(u)), 'وتكتب prep فعلاً');
}

/* ═══ سلوكي: الصفحة في متصفح حقيقي مع قاعدة مزيّفة ═══ */
let chromium = null;
try { ({ chromium } = require('playwright')) } catch (e) {}
ok(!!chromium, 'playwright متوفر');
if (!chromium) { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(1) }

const pageHtml = fs.readFileSync(PAGE, 'utf8');
const plansJs = fs.readFileSync(SHARED);
const CAL_JS = 'window.ACAD_CAL=[];';

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(CAL_JS) }
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

/* محاكي Supabase في المتصفح: صف الملف يعيش في window.__ROW،
   وكل update يُسجَّل في window.__WRITES — فنرى وش رُفع فعلاً. */
const SB = row => `
window.__ROW=${JSON.stringify(row)};
window.__WRITES=[];
function q(rows){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o},
  in(){return o}, gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:Array.isArray(rows)?rows[0]:rows,error:null}) },
  update(v){ window.__WRITES.push(v); Object.assign(window.__ROW,v);
             return {eq:async()=>({data:[],error:null})} },
  insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:rows,error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:{user:{id:'u1',email:'m@x.com'}}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
         signOut:async()=>({}) },
  from:(t)=> t==='profiles' ? q([window.__ROW])
           : t==='completed_courses' ? q([]) : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

(async () => {
  await new Promise(r => server.listen(46601, r));
  const browser = await chromium.launch();

  /* يفتح الصفحة بصف ملف معيّن وقيمة متصفح معيّنة */
  const open = async (row, localPrep) => {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.addInitScript(SB(row));
    if (localPrep !== undefined) {
      await pg.addInitScript(v => {
        try { localStorage.setItem('pmu_prep', JSON.stringify(v));
              localStorage.setItem('pmu_major', JSON.stringify('COSC')) } catch (e) {}
      }, localPrep);
    }
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB(row) }));
    await pg.goto('http://127.0.0.1:46601/', { waitUntil: 'load' });
    await pg.waitForTimeout(1500);
    return { pg, ctx, errs };
  };

  const state = pg => pg.evaluate(() => ({
    prepOn: typeof prepOn === 'function' ? prepOn() : null,
    row: window.__ROW,
    writes: window.__WRITES,
    sems: (typeof PLAN !== 'undefined' && PLAN) ? PLAN.length : -1,
    checkbox: (document.getElementById('prepChk') || {}).checked,
  }));

  /* ── ١) القيمة المحفوظة تغلب قيمة المتصفح ── */
  {
    const { pg, ctx, errs } = await open(
      { id: 'u1', major: 'COSC', plan_ver: 'new', prep: true }, false);
    const s = await state(pg);
    ok(s.prepOn === true, 'القاعدة true والمتصفح false ⇒ يغلب المحفوظ');
    ok(s.checkbox === true, 'والخانة في الإعدادات تعكسه');
    ok(errs.length === 0, 'بلا أخطاء JS — ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  {
    const { pg, ctx } = await open(
      { id: 'u1', major: 'COSC', plan_ver: 'new', prep: false }, true);
    const s = await state(pg);
    ok(s.prepOn === false, 'القاعدة false والمتصفح true ⇒ يغلب المحفوظ');
    ok(s.checkbox === false, 'والخانة مطفأة');
    await ctx.close();
  }

  /* ── ٢) بلا قيمة في القاعدة: قيمة المتصفح تصعد مرة وحدة ── */
  {
    const { pg, ctx } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new' }, true);
    const s = await state(pg);
    ok(s.prepOn === true, 'القاعدة NULL ⇒ قيمة المتصفح تبقى');
    const prepWrites = s.writes.filter(w => 'prep' in w);
    ok(prepWrites.length >= 1, 'ورُفعت للقاعدة — ' + JSON.stringify(prepWrites));
    ok(prepWrites.every(w => w.prep === true), 'بالقيمة الصحيحة');
    ok(s.row.prep === true, 'وصف الملف صار فيه القيمة');
    /* ولا كتابة لأعمدة الفوترة */
    const BILLING = ['is_pro', 'subscription_expires_at', 'paid_at', 'invite_code', 'pushover_until'];
    ok(s.writes.every(w => BILLING.every(b => !(b in w))),
       'ولا كتابة لعمود فوترة — ' + JSON.stringify(s.writes));
    await ctx.close();
  }
  {
    /* بلا قيمة وبلا تحضيري في المتصفح: ما نزعج القاعدة بكتابة بلا داعٍ */
    const { pg, ctx } = await open({ id: 'u1', major: 'COSC', plan_ver: 'new' }, false);
    const s = await state(pg);
    ok(s.prepOn === false, 'القاعدة NULL والمتصفح false ⇒ مطفأ');
    await ctx.close();
  }

  /* ── ٣) التبديل من الإعدادات ينحفظ ويرجع بعد إعادة التحميل ── */
  {
    const row = { id: 'u1', major: 'COSC', plan_ver: 'new', prep: false };
    const { pg, ctx } = await open(row, false);
    const before = await state(pg);
    ok(before.prepOn === false, 'البداية: مطفأ');

    const after = await pg.evaluate(() => {
      const el = document.getElementById('prepChk');
      if (!el) return { err: 'ما فيه خانة تحضيري' };
      el.checked = true; onPrepToggle();
      return { prepOn: prepOn(), row: window.__ROW, writes: window.__WRITES,
               sems: PLAN.length };
    });
    ok(!after.err, 'خانة التحضيري موجودة');
    ok(after.prepOn === true, 'بعد التبديل: شغّال');
    ok(after.row && after.row.prep === true, 'وانحفظ في القاعدة فوراً');
    ok(after.sems > before.sems,
       `والخطة زادت فصول التحضيري — ${before.sems} ← ${after.sems}`);

    /* جهاز ثاني / تخزين ممسوح: نفتح بصف الملف المحدَّث وتخزين فاضٍ */
    await ctx.close();
    const fresh = await open(after.row, undefined);
    const s2 = await state(fresh.pg);
    ok(s2.prepOn === true, 'جهاز ثاني بتخزين فاضٍ: القيمة رجعت من القاعدة');
    ok(s2.sems === after.sems, 'وبنفس عدد فصول الخطة');
    await fresh.ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('  ✗ انهار: ' + e.message);
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
