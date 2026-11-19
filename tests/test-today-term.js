/* بيانات «اليوم» بترم الدراسة لا بترم البحث — اختبار سلوكي في Chromium (لقيناها في مراجعة المساعد، ١٩ نوفمبر ٢٠٢٦،
   ومحمد قال «كمل»). الغياب والمواعيد والصور والملفات والمشاركات كانت تنحفظ وتنقرأ بترم القائمة في البحث
   (activeTermCode). وقت التسجيل المبكر للصيفي (11–15 أبريل) القائمة على الصيفي والدراسة ربيع: غياب الربيع ينحفظ
   للصيفي ويختفي من عدّاده، وتصفّح ترم ثاني في البحث يخفي غيابك ومواعيدك.

   أخطار يمسكها:
   ١) غياب أو موعد أو صورة ينحفظ بترم البحث لا ترم الدراسة.
   ٢) «اليوم» يقرأ بترم البحث — فيختفي غيابه لما يتصفّح ترماً ثانياً.
   ٣) تحميل «اليوم» قبل ما توصل حالة الموقع ⇒ بالترم الافتراضي في القائمة (الخريف) طول الجلسة.

   node tests/test-today-term.js [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { console.log(`\nبيانات اليوم بترم الدراسة: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

let chromium = null;
try { ({ chromium } = require('playwright')) } catch (e) {}
ok(!!chromium, 'playwright متوفر');
if (!chromium) done();

const pageHtml = fs.readFileSync(PAGE, 'utf8');
const plansJs = fs.readFileSync(SHARED);
/* أبريل: الدراسة ربيع (202720) ونافذة التسجيل المبكر للصيفي مفتوحة (202730) ⇒ قائمة البحث على الصيفي */
let MON = { term: '202720', regTerm: '202730', canWatch: true, build: '"x"' };
let MON_DELAY = 0;
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('window.ACAD_CAL=[];') }
  if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  if (u.startsWith('/api/')) {
    const send = () => { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(u === '/api/monitor-status' ? MON : { success: true, courses: [], cached: false, age: 0 })) };
    return u === '/api/monitor-status' && MON_DELAY ? setTimeout(send, MON_DELAY) : send();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pageHtml);
});

/* جدوله (صيغة الصفحة المحلية): مادة الاثنين والأربعاء */
const SCHED = [{ crn: '20001', courseCode: 'MEEN 3312', courseTitle: 'Thermodynamics II', section: '101',
  courseDate: 'MW', courseTiming: '0930 - 1045', instructor: 'Doe, Jane', room: 'M-CORE - F155', status: 'OPEN' }];

/* محاكي Supabase في المتصفح: كل eq('term', …) لكل جدول، وكل صف ينضاف */
const SB = `
window.__TERMS={}; window.__ROWS=[];
function q(t){ const o={
  select(){return o}, order(){return o}, limit(){return o}, in(){return o}, gte(){return o}, lte(){return o},
  neq(){return o}, is(){return o},
  eq(k,v){ if(k==='term'){ (window.__TERMS[t]=window.__TERMS[t]||[]).push(v) } return o },
  single(){ return Promise.resolve({data:window.__LAST||null,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} },
  insert(row){ window.__ROWS.push({table:t,row}); window.__LAST=Object.assign({id:'x'+window.__ROWS.length},row); return o },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:t==='profiles'?[{id:'u1',major:'MEEN',plan_ver:'new',prep:false}]:[],error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:{user:{id:'u1',email:'s@x.com'}}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
  from:(t)=>q(t),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null}),upload:async()=>({data:{},error:null}),
    createSignedUrl:async()=>({data:{signedUrl:''},error:null})})}
})};`;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const browser = await chromium.launch();
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.clock.install({ time: new Date('2027-04-12T09:00:00+03:00') });      /* اثنين — وسط نافذة الصيفي المبكرة */
    await pg.addInitScript(SB);
    await pg.addInitScript(s => { try {
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', JSON.stringify('MEEN'));
      localStorage.setItem('pmu_schedules', JSON.stringify([s, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(s));
    } catch (e) {} }, SCHED);
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB }));
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    return { pg, ctx, errs };
  };
  const terms = pg => pg.evaluate(() => window.__TERMS);
  /* «اليوم» يحمّل الأربعة، وبطاقة المادة تحمّل ملفات زملائه (shared_photos) لما تنفتح */
  const TODAY_TABLES = ['absences', 'course_events', 'course_photos', 'shared_events'];

  /* ── ١) أبريل: البحث على الصيفي، والدراسة ربيع ── */
  {
    MON_DELAY = 0;
    const { pg, ctx, errs } = await open();
    await pg.waitForFunction(() => typeof USER !== 'undefined' && USER && typeof MON_STATE !== 'undefined' && MON_STATE, null, { timeout: 8000 }).catch(() => {});
    await pg.clock.runFor(1500);
    eq(await pg.evaluate(() => document.getElementById('term').value), '202730', 'قائمة البحث على الصيفي (نافذته مفتوحة)');
    await pg.evaluate(() => { try { switchTab('today') } catch (e) {} });
    await pg.clock.runFor(1500);
    await pg.evaluate(() => { try { openCourse('20001') } catch (e) {} });
    await pg.clock.runFor(800);
    const T = await terms(pg);
    for (const t of TODAY_TABLES.concat('shared_photos'))
      ok(Array.isArray(T[t]) && T[t].length && T[t].every(v => v === '202720'),
         `**«اليوم» يقرأ ${t} بترم الدراسة (الربيع) لا بترم البحث (الصيفي)** — ${JSON.stringify(T[t])}`);
    const okAbs = await pg.evaluate(() => markAbsent('20001'));
    const rows = await pg.evaluate(() => window.__ROWS);
    const abs = rows.filter(r => r.table === 'absences').map(r => r.row.term);
    ok(okAbs === true && abs.length === 1, 'تسجيل الغياب نجح — ' + JSON.stringify(rows));
    eq(abs, ['202720'], '**الغياب ينحفظ بترم الدراسة (الربيع)** — كان بترم البحث (الصيفي) فيختفي من عدّاد الربيع');
    /* يتصفّح ترماً ثانياً في البحث ⇒ «اليوم» ما يتغيّر */
    await pg.evaluate(() => { const s = document.getElementById('term'); s.value = '202610'; s.dispatchEvent(new Event('change')) });
    await pg.evaluate(() => markAbsent('20001', '2027-04-07'));
    const abs2 = (await pg.evaluate(() => window.__ROWS)).filter(r => r.table === 'absences').map(r => r.row.term);
    eq(abs2, ['202720', '202720'], '**وتصفّح ترم ثاني في البحث ما يغيّر ترم الغياب**');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٢) الدخول أسرع من حالة الموقع: «اليوم» ينتظرها — لا الترم الافتراضي في القائمة ── */
  {
    MON_DELAY = 1500; MON = { term: '202720', canWatch: false, build: '"x"' };
    const { pg, ctx, errs } = await open();
    await pg.evaluate(() => { try { switchTab('today') } catch (e) {} });
    await pg.clock.runFor(300);
    await pg.waitForTimeout(2500);                 /* رد حالة الموقع متأخر بثانية ونص (وقت حقيقي) */
    await pg.clock.runFor(1500);
    const T = await terms(pg);
    const all = TODAY_TABLES.flatMap(t => T[t] || []);
    ok(all.length >= 1 && all.every(v => v === '202720'),
       '**«اليوم» ينتظر حالة الموقع: بترم الدراسة لا بالترم الافتراضي (الخريف)** — ' + JSON.stringify(T));
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٣) فحص ثابت: كل كتابة وقراءة لبيانات «اليوم» بترم الدراسة ── */
  {
    const src = pageHtml;
    ok(!/term:activeTermCode\(\)/.test(src), 'ولا صف ينكتب بترم البحث');
    ok(!/\.eq\('term',activeTermCode\(\)\)/.test(src), 'ولا قراءة لبيانات «اليوم» بترم البحث');
    ok(/function inSchedule\(code\)\{\s*if\(activeTermCode\(\)!==serverTerm\(\)\)/.test(src), 'ووسم «في جدولك» على ترم البحث كما هو');
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { console.log('  ✗ انهار: ' + (e && e.stack || e)); fail++; done() });
