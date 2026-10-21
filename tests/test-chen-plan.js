/* خطة الكيميكال الجديدة (Revised: Spring 2026) والقديمة — اختبار.
   محمد رفع PDF الخطة الجديدة وطلب نضيفها «مثل طريقة الميكانيكال»: الجديدة = CHEN،
   والقديمة = CHEN_OLD، والطالب يختار من بطاقة «الجديدة/القديمة» في «خطتي».
   **والافتراضي القديمة — قرار محمد (٢١ أكتوبر ٢٠٢٦): «نخليه عالقديمة افتراضي عشان ما ياثر
   على احد»** (الميكانيكال افتراضه الجديدة كما كان).
   ١) البيانات = PDF: كل ترم بموادّه بالترتيب وساعاته، وكل متطلب، والمستويات (٣٠/٦٠/٩٠)، والاختياريات.
      منقولة هنا من PDF مرة ثانية — تعديل بالغلط في الخطة يطيح هنا.
   ٢) القديمة ما تغيّر فيها حرف (بصمة الخطة قبل التحديث) — طالبها ما يتأثر.
   ٣) السلوك: النسخة تختار الخطة الصح · المتطلبات تقفل وتفتح · التدريب بعد ٩٠ · توقّع التخرج يخلص ·
      **النسخة المحفوظة**: 'new' انكتبت لكل طالب (ما تعني اختياراً) فالكيميكال بها قديمة،
      والجديدة بختمها 'CHEN:new' وحده.
   ٤) الصفحة: زائر ومسجّل (قاعدة مزيّفة) — الافتراضي القديمة، «الجديدة» تبدّل وتنحفظ وترجع بعد
      إعادة التحميل ومن جهاز ثاني، والميكانيكال ما تغيّر (وتصوير ٣٩٠ بالثيمين: SHOT_DIR).

   node tests/test-chen-plan.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(SRV), 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ═══ PDF الخطة — «Chemical Engineering Study Plan» · 139 ساعة · Revised: Spring 2026 ═══ */
const PDF = {
  F1: [18, 'COMM 1321:3', 'UNIV 1211:2', 'MATH 1422:4', 'CHEM 1421:4', 'PHYS 1421:4', 'PHED 1111:1'],
  F2: [18, 'ISLM 1221:2', 'COMM 1322:3', 'GEEN 1211:2', 'UNIV 1212:2', 'MATH 1423:4', 'CHEM 1422:4', 'PHED 1112:1'],
  S1: [17, 'COMM 2321:3', 'UNIV 1213:2', 'MATH 1324:3', 'CHEN 2391:3', 'GEEN 2211:2', 'ASSE 2111:1', 'CHEN 2311:3'],
  S2: [18, 'CHEN 2312:3', 'GEEN 2313:3', 'MATH 2332:3', 'PHYS 1422:4', 'COMM 2322:3', 'UNIV 1221:2'],
  J1: [16, 'ASSE 3211:2', 'GEEN 3311:3', 'GEEN 3314:3', 'UNIV 2221:2', 'CHEN 3313:3', 'CHEN 3315:3'],
  J2: [17, 'CHEN 3494:4', 'CHEN 3333:3', 'CHEN 3343:3', 'CHEN 3322:3', 'CHEN 3111:1', 'CHEN E1:3'],
  SU: [3, 'CHEN 3301:3'],
  R1: [17, 'CHEN 4493:4', 'CHEN 4492:4', 'CHEN 4320:3', 'CHEN 4396:3', 'CHEN E2:3'],
  R2: [15, 'UNIV 2222:2', 'CHEN 4422:4', 'CHEN 4397:3', 'GEEN 4311:3', 'CHEN E3:3']
};
/* المتطلبات — المربعات المنقّطة. التحضيري واللغة (PRPM 0022 · PREE 0061 · IELTS/APTIS) لها بوابتها.
   CHEN 4493: PDF يكتب «CHEN 3394» (ما لها وجود) — المقصود CHEN 3494. CHEN 3111: CHEN 3333 بنفس ترمه (مصاحب) */
const PRE = {
  'COMM 1322': ['COMM 1321'], 'UNIV 1212': ['UNIV 1211'], 'MATH 1423': ['MATH 1422'],
  'CHEM 1422': ['CHEM 1421'], 'PHED 1112': ['PHED 1111'],
  'COMM 2321': ['COMM 1322'], 'UNIV 1213': ['UNIV 1212'], 'MATH 1324': ['MATH 1423'],
  'CHEN 2391': ['CHEM 1421'], 'GEEN 2211': ['MATH 1423', 'GEEN 1211'], 'CHEN 2311': ['MATH 1422', 'PHYS 1421'],
  'CHEN 2312': ['CHEM 1421'], 'GEEN 2313': ['MATH 1423', 'CHEM 1421'], 'MATH 2332': ['MATH 1324'],
  'PHYS 1422': ['PHYS 1421', 'MATH 1422'], 'COMM 2322': ['COMM 2321'], 'UNIV 1221': ['UNIV 1211'],
  'ASSE 3211': ['ASSE 2111'], 'GEEN 3311': ['GEEN 2313'], 'GEEN 3314': ['PHYS 1422'],
  'UNIV 2221': ['UNIV 1221'], 'CHEN 3313': ['CHEN 2391'], 'CHEN 3315': ['CHEM 1422'],
  'CHEN 3494': ['GEEN 3311', 'CHEN 3315', 'CHEN 2311'], 'CHEN 3333': ['GEEN 3311'],
  'CHEN 3343': ['MATH 1324'], 'CHEN 3322': ['CHEN 3315', 'GEEN 3311'], 'CHEN 3111': ['GEEN 3311'],
  'CHEN 4493': ['CHEN 3494', 'CHEN 3322'], 'CHEN 4492': ['CHEN 3494', 'CHEN 3333'],
  'CHEN 4320': ['CHEN 3494', 'CHEN 3333'], 'CHEN 4396': ['CHEN 3494', 'CHEN 3322'],
  'UNIV 2222': ['UNIV 2221'], 'CHEN 4422': ['CHEN 4320'], 'CHEN 4397': ['CHEN 4396'], 'GEEN 4311': ['CHEN 4396']
};
/* Sophomore Standing · Junior Level (> 60 Cr) · End of Junior Year or 90 Cr. Hours */
const MIN = { 'ASSE 2111': 30, 'ASSE 3211': 60, 'GEEN 3314': 60, 'CHEN 3301': 90 };
const ELECTIVES = ['CHEN E1', 'CHEN E2', 'CHEN E3'];   /* اجتماعية · تقنية I · تقنية II */
const TECH = {
  'CHEN 4312': ['CHEN 3494', 'CHEN 3333'], 'CHEN 4315': ['CHEN 3494', 'CHEN 3333'],
  'CHEN 4332': ['CHEN 3494', 'CHEN 3333'], 'CHEN 4344': ['CHEN 2312', 'CHEN 3333'],
  'CHEN 4351': ['CHEN 3494', 'CHEN 3333'], 'CHEN 4352': ['CHEN 3494', 'CHEN 3333'],
  'CHEN 4355': ['CHEN 3494', 'CHEN 3333'], 'CHEN 4360': ['CHEN 3494', 'CHEN 3333']
};
/* بصمة خطة CHEN قبل التحديث (dev عند 5316654) — CHEN_OLD لازم تبقى هي نفسها حرفاً بحرف */
const OLD_SHA = '20fd8829e81cbbc17f3b6afe06b57539db8dc32476e65a3b8d9f33b3f10d9fc2';

let L = null;
try { L = require(SHARED) } catch (e) { console.log('  ✗ تعذّر require: ' + e.message) }
ok(!!L, 'shared/plans.js يُقرأ');
const P = (L && L.PLANS) || {};
const NEW = P.CHEN || { sems: [] };

/* ═══ ١. البيانات = PDF ═══ */
{
  eq(NEW.total, 139, '**المجموع ١٣٩ ساعة** مثل PDF');
  eq(NEW.sems.map(s => s.id), Object.keys(PDF), 'الترمات: ٨ ترمات والتدريب في الصيف (SU)');
  for (const [id, [hrs, ...list]] of Object.entries(PDF)) {
    const s = NEW.sems.find(x => x.id === id) || { courses: [] };
    eq(s.courses.map(c => `${c.c}:${c.h}`), list, `**${id}: نفس مواد PDF بالترتيب والساعات**`);
    eq(s.hrs, hrs, `${id}: ${hrs} ساعة`);
    ok(typeof s.label === 'string' && s.label.length > 3, `${id}: له عنوان (مثل الميكانيكال)`);
  }
  const all = NEW.sems.flatMap(s => s.courses);
  const badP = all.filter(c => JSON.stringify((c.p || []).slice().sort()) !== JSON.stringify((PRE[c.c] || []).slice().sort()))
    .map(c => `${c.c}: ${JSON.stringify(c.p)}`);
  eq(badP, [], '**كل متطلب سابق مثل PDF**');
  const badMin = all.filter(c => (c.min || 0) !== (MIN[c.c] || 0)).map(c => `${c.c}:${c.min || 0}`);
  eq(badMin, [], '**المستويات: سنة ثانية ٣٠ · سنة ثالثة ٦٠ · التدريب ٩٠**');
  eq(all.filter(c => c.el).map(c => c.c), ELECTIVES, 'ثلاث خانات اختياري: اجتماعية + تقنيتين');
  eq(NEW.tech || {}, TECH, '**الاختياريات التقنية الثمان ومتطلباتها مثل PDF**');
  ok(!all.some(c => /^(MEEN|CVEN|ALIS) /.test(c.c) || /^COMM 1311|^COMM 1312|^COMM 2311|^COMM 2312/.test(c.c)),
    'ولا مادة من الخطة القديمة (ALIS · COMM 13xx · MEEN · CVEN)');
}

/* ═══ ٢. القديمة كما هي ═══ */
{
  eq((L && L.PLAN_ALT || {}).CHEN, 'CHEN_OLD', '**الكيميكال له خطة قديمة (PLAN_ALT) — مثل الميكانيكال**');
  ok(!!P.CHEN_OLD, 'CHEN_OLD موجودة');
  const sha = P.CHEN_OLD ? crypto.createHash('sha256').update(JSON.stringify(P.CHEN_OLD)).digest('hex') : '';
  eq(sha, OLD_SHA, '**CHEN_OLD = خطة الكيميكال قبل التحديث حرفاً بحرف** — طالب القديمة ما يتأثر');
}

/* ═══ ٣. السلوك ═══ */
if (L && typeof L.ctxOf === 'function') {
  const C = (v, completed) => L.ctxOf({ major: 'CHEN', planVer: v, prep: false,
    completed: completed || [], grades: {}, term: '202710' });
  ok(L.hasAltPlan('CHEN'), 'hasAltPlan(CHEN) — بطاقة النسختين تطلع لطالب الكيميكال');
  ok(L.planOf('CHEN', 'new') === P.CHEN && L.planOf('CHEN', 'old') === P.CHEN_OLD,
    '**النسخة الجديدة ← CHEN · القديمة ← CHEN_OLD**');
  ok(!!L.findPlanCourse(C('new'), 'CHEN 3333') && !L.findPlanCourse(C('new'), 'MEEN 3333'),
    'الجديدة: انتقال الحرارة CHEN 3333 (لا MEEN 3333)');
  ok(!!L.findPlanCourse(C('old'), 'MEEN 3333') && !!L.findPlanCourse(C('old'), 'ALIS 1211'),
    'القديمة: باقية بموادها (MEEN 3333 · ALIS 1211)');

  let r = L.prereqCheck(C('new', ['GEEN 3311', 'CHEN 3315']), 'CHEN 3494');
  eq([r.ok, r.missing], [false, ['CHEN 2311']], 'CHEN 3494 مقفلة وناقصها CHEN 2311');
  r = L.prereqCheck(C('new', ['GEEN 3311', 'CHEN 3315', 'CHEN 2311']), 'CHEN 3494');
  ok(r.ok, 'وتنفتح لما يخلص الثلاث');
  r = L.prereqCheck(C('new', ['CHEN 3494', 'CHEN 3322']), 'CHEN 4396');
  ok(r.ok, '**الجديدة: Senior Design I بعد CHEN 3494 وCHEN 3322 — بلا التدريب**');
  r = L.prereqCheck(C('old', ['CHEN 3494', 'CHEN 3322']), 'CHEN 4396');
  eq([r.ok, r.missing], [false, ['CHEN 3301']], 'والقديمة تبقى تشترط التدريب (CHEN 3301)');
  r = L.prereqCheck(C('new', ['CHEN 3494']), 'CHEN 4344');
  eq([r.ok, r.missing], [false, ['CHEN 2312', 'CHEN 3333']], 'الاختياري CHEN 4344: CHEN 2312 وCHEN 3333');
  r = L.prereqCheck(C('new'), 'CHEN 3301');
  eq([r.ok, r.needCr], [false, 90], 'التدريب يحتاج ٩٠ ساعة');

  const g = L.gradPlan(C('new'), {});
  ok(g.done && !g.stuck, `**توقّع التخرج لطالب جديد يخلص الخطة كلها بلا مادة مقفلة** — ${JSON.stringify(g.remaining)}`);
  eq(g.hoursPlanned, 139, 'وكل الـ١٣٩ ساعة انحطّت في ترمات');
  ok(/30$/.test(String(g.internTerm || '')), 'والتدريب في ترم صيفي — ' + g.internTerm);
} else ok(false, 'منطق الخطة ما يُقرأ');

/* ═══ ٣-ب. النسخة المحفوظة — القديمة افتراضية للكيميكال (قرار محمد) ═══
   القيمة في profiles.plan_ver وpmu_plan_ver. الصفحة كانت تكتب 'new' لكل طالب ما اختار
   (مع تخصصه)، فـ'new' ما تعني «اختار الجديدة»: للكيميكال تبقى القديمة، والجديدة بختمها. */
if (L && typeof L.planVerOf === 'function') {
  const V = (m, s) => L.planVerOf(m, s);
  eq(L.planVerDefault('CHEN'), 'old', '**الافتراضي للكيميكال: القديمة**');
  eq(L.planVerDefault('MEEN'), 'new', 'والميكانيكال: الجديدة كما كان');
  eq([V('CHEN', undefined), V('CHEN', null), V('CHEN', 'new'), V('CHEN', 'old'), V('CHEN', 'xyz')],
    ['old', 'old', 'old', 'old', 'old'], '**الكيميكال بلا اختيار مختوم ⇒ القديمة** (و«new» المكتوبة لكل طالب منها)');
  eq([V('CHEN', 'CHEN:new'), V('CHEN', 'CHEN:old'), V('CHEN', 'MEEN:new')], ['new', 'old', 'old'],
    '**اختياره من البطاقة مختوم بتخصصه** — وختم تخصص ثاني ما يحسب له');
  eq([V('MEEN', null), V('MEEN', 'new'), V('MEEN', 'old'), V('MEEN', 'CHEN:new')], ['new', 'new', 'old', 'new'],
    'الميكانيكال ما تغيّر: «old» قديمة، وغيرها جديدة');
  eq([V('COSC', null), V('COSC', 'old')], ['new', 'old'], 'وتخصص بلا نسختين كما كان');
  eq([L.planVerStore('CHEN', 'new'), L.planVerStore('CHEN', 'old'), L.planVerStore('MEEN', 'old'),
      L.planVerStore('MEEN', 'new')], ['CHEN:new', 'CHEN:old', 'old', 'new'],
    'الحفظ: الكيميكال مختوم، والميكانيكال كما كان (قيمته ما تتغيّر في القاعدة)');
  ok(L.planOf('CHEN', V('CHEN', 'new')) === P.CHEN_OLD, '**طالب كيميكال بـ«new» المحفوظة يشوف CHEN_OLD**');
  ok(L.planOf('CHEN', V('CHEN', 'CHEN:new')) === P.CHEN, 'واللي اختار الجديدة يشوف CHEN');
} else ok(false, '**planVerOf موجودة — النسخة الافتراضية لكل تخصص**');

/* ═══ ٣-ج. اللوحة: شارة نسخة الخطة في بطاقة الطالب ═══
   كانت قائمة تخصصات فيها الميكانيكال وحده، فالكيميكال ما يبان. والملوّنة غير الافتراضية:
   تلفت النظر عند قراءة شكوى طالب (القديمة للميكانيكال، والجديدة للكيميكال). */
{
  const ADMIN = path.join(path.dirname(SRV), 'admin.html');
  const src = fs.existsSync(ADMIN) ? fs.readFileSync(ADMIN, 'utf8') : '';
  const m = /function planVerTag\(u\)\{[\s\S]*?\n\}/.exec(src);
  let fn = null;
  try { fn = new Function(m[0] + '\nreturn planVerTag;')() } catch (e) {}
  ok(!!fn, 'planVerTag في اللوحة تنقرأ');
  /* لحالها: الدالة ما تعتمد على شي ثاني في اللوحة (القائمة القديمة كانت ثابتاً بره) */
  const tag = u => { try { return fn(u) } catch (e) { return 'خطأ: ' + e.message } };
  if (fn) {
    const T = (major, planVer, planDef) => tag({ major, planVer, planDef, planAlt: true });
    ok(/الخطة <b>القديمة/.test(T('CHEN', 'old', 'old')),
      '**اللوحة: طالب كيميكال على القديمة (افتراضه) ⇒ «الخطة القديمة» بلا تلوين** — ' + T('CHEN', 'old', 'old'));
    ok(/--warn[^>]*>الجديدة/.test(T('CHEN', 'new', 'old')),
      'واللي اختار الجديدة ملوّنة — ' + T('CHEN', 'new', 'old'));
    ok(/--warn[^>]*>القديمة/.test(T('MEEN', 'old', 'new')) && /الخطة <b>الجديدة/.test(T('MEEN', 'new', 'new')),
      'والميكانيكال كما كان: القديمة ملوّنة والجديدة لا');
    eq(tag({ major: 'COSC', planVer: 'new', planDef: 'new', planAlt: false }), '', 'وتخصص بلا نسختين: بلا شارة');
  }
}

/* ═══ ٤. الصفحة ═══ */
const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
/* مسجّل: صف ملفه في window.__ROW، وكل update يُسجَّل في window.__WRITES — نشوف وش انرفع
   للحساب فعلاً (نفس محاكي test-prep-sync) */
const SUPA_USER = row => `
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
  from:(t)=> t==='profiles' ? q([window.__ROW]) : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

/* حالة خطتي: النسخة · المواد المعروضة · البطاقة · المحفوظ في المتصفح · وش انرفع */
const SNAP = () => {
  switchTab('plan'); renderPlan(); renderPlanVer();
  const box = document.getElementById('planVerBox');
  const txt = (document.getElementById('planSemesters') || {}).textContent || '';
  const on = box && box.querySelector('.pv-b.on');
  return { ver: PLAN_VER, ls: localStorage.getItem('pmu_plan_ver'),
           card: !!(box && box.classList.contains('visible') && box.offsetParent !== null),
           btns: box ? [...box.querySelectorAll('.pv-b')].map(b => b.textContent.trim()) : [],
           on: on ? on.textContent.trim() : '',
           head: ((box && box.querySelector('.pv-t')) || {}).textContent || '',
           newC: ['COMM 1321', 'ISLM 1221', 'CHEN 3333', 'CHEN 2312'].every(c => txt.includes(c)),
           oldC: ['ALIS 1211', 'MEEN 3333', 'COMM 1311'].every(c => txt.includes(c)),
           anyOld: ['ALIS 1211', 'MEEN 3333'].some(c => txt.includes(c)),
           anyNew: ['COMM 1321', 'CHEN 3343'].some(c => txt.includes(c)),
           row: window.__ROW || null, writes: window.__WRITES || null };
};

(async () => {
  let chromium = null;
  try { ({ chromium } = require('playwright')) } catch (e) {}
  if (!chromium) { ok(false, 'playwright متوفر'); return done() }
  const plansJs = fs.existsSync(SHARED) ? fs.readFileSync(SHARED) : Buffer.from('');
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(PAGE));
    }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(u === '/api/monitor-status' ? { term: '202710', canWatch: false, build: '"x"' } : {}));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  /* يفتح الصفحة لطالب: major · local = pmu_plan_ver في متصفحه قبل الفتح (undefined = ما فيه) ·
     row = صف ملفه لو مسجّل. القيم تنكتب مرة لكل سياق — إعادة التحميل تختبر إن الاختيار بقي. */
  const open = async ({ theme = 'dark', major = 'CHEN', local, row } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200,
      contentType: 'application/javascript', body: row ? SUPA_USER(row) : SUPA }));
    await pg.addInitScript(([t, m, l]) => { try {
      if (localStorage.getItem('pmu_major')) return;
      localStorage.setItem('theme', t); localStorage.setItem('guideSeen', '1');
      localStorage.setItem('pmu_major', JSON.stringify(m));
      if (l !== null) localStorage.setItem('pmu_plan_ver', JSON.stringify(l));
    } catch (e) {} }, [theme, major, local === undefined ? null : local]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await ready(pg, !!row);
    return { ctx, pg, errs };
  };
  /* جاهزة: الخطط وصلت، والمسجّل قرأ ملفه (PROFILE) — بلا وقت ثابت */
  const ready = (pg, user) => pg.waitForFunction(u => typeof window.renderPlan === 'function'
      && window.PLANS && window.PLANS.CHEN
      && (!u || (typeof PROFILE !== 'undefined' && !!PROFILE && !!PROFILE.id)),
    user, { timeout: 15000 }).catch(() => {});
  const click = (pg, n) => pg.click(`#planVerBox .pv-b:nth-child(${n})`, { timeout: 3000 }).then(() => true, () => false);
  const STAMP = '"CHEN:new"';

  /* ── (أ) زائر بلا حساب — بالثيمين ── */
  for (const theme of ['dark', 'light']) {
    /* الفاتح: متصفح فيه «new» من قبل (من أيام ما كانت تنكتب لكل طالب) — نفس الحكم */
    const { ctx, pg, errs } = await open({ theme, local: theme === 'light' ? 'new' : undefined });
    let v = await pg.evaluate(SNAP);
    ok(v.card && v.btns.length === 2, `[${theme}] **طالب الكيميكال يشوف بطاقة «الجديدة/القديمة» في خطتي** — ${JSON.stringify(v.btns)}`);
    ok(v.ver === 'old' && v.oldC && !v.anyNew,
      `[${theme}] **الافتراضي الخطة القديمة** (ALIS 1211 · MEEN 3333 · COMM 1311)${theme === 'light' ? ' — حتى لو المتصفح فيه «new»' : ''} — ${JSON.stringify({ ver: v.ver, ls: v.ls })}`);
    eq(v.on, 'القديمة', `[${theme}] والزر المختار «القديمة»`);
    ok(/لو كنت على الخطة الجديدة/.test(v.head), `[${theme}] **والبطاقة تقول «لو كنت على الخطة الجديدة بدّلها من هنا»** — «${v.head}»`);
    if (shots) {
      /* البطاقة تحت الرأس الثابت — ننزل لها ونرجع قدّه */
      await pg.evaluate(() => { const b = document.getElementById('planVerBox');
        if (b) { b.scrollIntoView({ block: 'start' }); window.scrollBy(0, -140) } });
      await pg.waitForTimeout(200);
      await pg.screenshot({ path: path.join(shots, `chen-plan-${theme}.png`) });
    }
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${over}`);
    /* «الجديدة» — بالضغط على زرّها */
    const c1 = await click(pg, 1);
    v = await pg.evaluate(SNAP);
    ok(c1 && v.ver === 'new' && v.newC && !v.anyOld,
      `[${theme}] **«الجديدة» تبدّل للخطة الجديدة** (COMM 1321 · ISLM 1221 · CHEN 3333 · CHEN 2312) — ${JSON.stringify({ ver: v.ver })}`);
    eq(v.ls, STAMP, `[${theme}] **وتنحفظ مختومة (CHEN:new)** — مو «new» اللي انكتبت لكل طالب`);
    await pg.reload({ waitUntil: 'load' });
    await ready(pg, false);
    v = await pg.evaluate(SNAP);
    ok(v.ver === 'new' && v.newC && !v.anyOld, `[${theme}] **وبعد إعادة التحميل يبقى على الجديدة** — ${JSON.stringify({ ver: v.ver, ls: v.ls })}`);
    const c2 = await click(pg, 2);
    v = await pg.evaluate(SNAP);
    ok(c2 && v.ver === 'old' && v.oldC && !v.anyNew, `[${theme}] و«القديمة» ترجّعه — ${JSON.stringify({ ver: v.ver })}`);
    eq(v.ls, '"CHEN:old"', `[${theme}] ومحفوظة مختومة كذلك`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (ب) الميكانيكال ما تغيّر: الجديدة افتراضية، و«القديمة» تنحفظ «old» بلا ختم ── */
  {
    const { ctx, pg, errs } = await open({ major: 'MEEN' });
    let v = await pg.evaluate(SNAP);
    ok(v.card && v.ver === 'new' && v.on === 'الجديدة', `الميكانيكال: الافتراضي الجديدة كما كان — ${JSON.stringify({ ver: v.ver, on: v.on })}`);
    ok(/لو كنت على الخطة القديمة/.test(v.head), `وبطاقته بجملتها: «لو كنت على الخطة القديمة» — «${v.head}»`);
    await click(pg, 2);
    v = await pg.evaluate(SNAP);
    ok(v.ver === 'old' && v.ls === '"old"', `و«القديمة» له تنحفظ «old» كما كانت — ${JSON.stringify({ ver: v.ver, ls: v.ls })}`);
    ok(errs.length === 0, 'الميكانيكال بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (ج) مسجّل: صف ملفه في القاعدة ── */
  {
    /* ١) «new» في ملفه = اللي كانت الصفحة تكتبها لكل طالب ⇒ يبقى على القديمة */
    let o = await open({ row: { id: 'u1', major: 'CHEN', plan_ver: 'new', prep: false } });
    let v = await o.pg.evaluate(SNAP);
    ok(v.ver === 'old' && v.oldC && !v.anyNew,
      `**مسجّل كيميكال وملفه فيه «new» (المكتوبة لكل طالب) ⇒ القديمة** — ${JSON.stringify({ ver: v.ver, ls: v.ls })}`);
    ok(!(v.writes || []).some(w => /:/.test(String(w.plan_ver || ''))) && v.row.plan_ver === 'new',
      'وما ينكتب له اختيار ما اختاره — ' + JSON.stringify(v.writes));
    /* ٢) يضغط «الجديدة» ⇒ ترتفع لحسابه مختومة، بطلب لحالها */
    await click(o.pg, 1);
    await o.pg.waitForFunction(() => window.__ROW.plan_ver !== 'new', null, { timeout: 5000 }).catch(() => {});
    v = await o.pg.evaluate(SNAP);
    ok(v.ver === 'new' && v.newC, 'ضغط «الجديدة» ⇒ الجديدة');
    eq(v.row.plan_ver, 'CHEN:new', '**واختياره انحفظ في حسابه مختوماً** (المساعد يقرأه منه)');
    ok(v.writes.some(w => JSON.stringify(w) === JSON.stringify({ plan_ver: 'CHEN:new' })),
      '**بطلب لحاله** — لو رفضه قيد في القاعدة ما يوقف رفع التخصص — ' + JSON.stringify(v.writes));
    ok(v.writes.filter(w => 'major' in w).every(w => !('plan_ver' in w)),
      'ورفع التخصص ما يحمل المختومة — ' + JSON.stringify(v.writes));
    const row = v.row;
    ok(o.errs.length === 0, 'بلا أخطاء JS: ' + o.errs.slice(0, 2).join(' | '));
    await o.ctx.close();

    /* ٣) جهاز ثاني (تخزين فاضي) ⇒ يجيه اختياره من حسابه */
    o = await open({ row });
    v = await o.pg.evaluate(SNAP);
    ok(v.ver === 'new' && v.newC && !v.anyOld, `**من جهاز ثاني: اختياره (CHEN:new) يجيه من حسابه** — ${JSON.stringify({ ver: v.ver, ls: v.ls })}`);
    eq(v.ls, STAMP, 'وينحفظ في متصفحه');
    await o.ctx.close();

    /* ٤) متصفحه فيه المختومة والحساب «new» (ما وصله ختمنا، أو كتبتها نسخة قديمة من الصفحة)
          ⇒ يبقى على اختياره ونرفعه ثانية — ما يرجع للقديمة بصمت */
    o = await open({ row: { id: 'u1', major: 'CHEN', plan_ver: 'new', prep: false }, local: 'CHEN:new' });
    v = await o.pg.evaluate(SNAP);
    ok(v.ver === 'new' && v.newC, `**المختومة في المتصفح تغلب «new» بلا ختم في الحساب** — ${JSON.stringify({ ver: v.ver, row: v.row.plan_ver })}`);
    eq(v.row.plan_ver, 'CHEN:new', 'وانرفعت للحساب من جديد');
    await o.ctx.close();

    /* ٥) الميكانيكال المسجّل كما كان: «old» في ملفه ⇒ القديمة، والتبديل يرفع «new» مع التخصص */
    o = await open({ major: 'MEEN', row: { id: 'u1', major: 'MEEN', plan_ver: 'old', prep: false } });
    v = await o.pg.evaluate(SNAP);
    ok(v.ver === 'old', `الميكانيكال وملفه «old» ⇒ القديمة كما كان — ${v.ver}`);
    await click(o.pg, 1);
    v = await o.pg.evaluate(SNAP);
    ok(v.ver === 'new' && v.row.plan_ver === 'new'
      && v.writes.some(w => w.major === 'MEEN' && w.plan_ver === 'new'),
      'و«الجديدة» ترفع «new» مع التخصص كما كانت — ' + JSON.stringify(v.writes));
    ok(o.errs.length === 0, 'الميكانيكال المسجّل بلا أخطاء JS: ' + o.errs.slice(0, 2).join(' | '));
    await o.ctx.close();
  }
  await browser.close();
  server.close();
  done();
})().catch(e => { ok(false, 'انهار اختبار الصفحة: ' + (e && e.message)); done() });

function done() {
  console.log(`خطة الكيميكال: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}
