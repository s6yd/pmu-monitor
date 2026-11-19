/* «وش عندي بكرة؟» بالتاريخ — مراجعة المساعد (١٩ نوفمبر ٢٠٢٦، طلب محمد: «ابيك تراجع ال ai … ابي يكون ذكي»).
   my_day كانت تاخذ حرف اليوم وحده، فما تعرف التاريخ: «وش عندي بكرة؟» والأحد الجاي إجازة منتصف الترم ⇒ محاضرات يوم
   عادي، ووقت النهائيات وبعد الترم كذلك. وجدوله النشط لترم ثاني (حاط الربيع في جدوله الأول) ⇒ محاضرات الربيع ليوم
   في الخريف.

   أخطار يمسكها (الأدوات الحقيقية من السيرفر معزولة في vm، والتقويم ACAD_CAL الحقيقي، وساعة السيرفر مثبّتة):
   ١) يوم إجازة أو نهائيات أو بين ترمين يطلع يوم محاضرات عادي.
   ٢) «بكرة» بتاريخ ما ينفهم — أو حرف يوم بلا تاريخ ما يعرف أي أسبوع.
   ٣) محاضرات جدول لترم ثاني تطلع ليوم في هالترم.

   node tests/test-ai-day.js [server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const SHARED = path.join(path.dirname(SRV), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const arr = v => (Array.isArray(v) ? v : []);
const codes = r => arr(r && r.lectures).map(x => x.code);
const short = r => String(JSON.stringify(r)).slice(0, 160);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nيوم الطالب في المساعد: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

const src = fs.readFileSync(SRV, 'utf8');
const L = src.split('\n');
const grab = name => { const i = L.findIndex(x => x.startsWith('function ' + name + '('));
  const j = L.findIndex((x, n) => n > i && x === '}'); return i >= 0 && j > i ? L.slice(i, j + 1).join('\n') : '' };
const i0 = src.indexOf('/* ═══════════ أدوات المساعد — القراءة'), j0 = src.indexOf('/* ═══ نهاية أدوات المساعد ═══');
ok(i0 >= 0 && j0 > i0, 'منطقة أدوات المساعد موجودة');
if (i0 < 0 || j0 <= i0) done();
const REGION = src.slice(i0, j0);
const ci = src.indexOf('const ACAD_CAL = ['), cj = src.indexOf('\n];', ci);
const ACAD_CAL = new Function(src.slice(ci, cj + 3) + '; return ACAD_CAL;')();
delete require.cache[require.resolve(SHARED)];
const PLANS_DATA = require(SHARED);

/* صفوف user_schedule بصيغة الجامعة حرفاً بحرف: الوقت بلا نقطتين · الأيام حروف متلاصقة · والترم على كل صف */
const ROW = (user, slot, term, crn, code, title, d, t) => ({ user_id: user, slot, term, crn, course_code: code,
  course_title: title, section: '101', course_date: d, course_timing: t, room: 'M-CORE - G034', instructor: 'Doe, Jane' });
const DB = {
  profiles: {
    'u-a': { id: 'u-a', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false, active_slot: 1 },
    'u-b': { id: 'u-b', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false, active_slot: 1 },
    'u-c': { id: 'u-c', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false, active_slot: 1 },
    'u-empty': { id: 'u-empty', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false },
  },
  schedule: {
    /* جدول الخريف في جدوله الأول */
    'u-a': [ROW('u-a', 1, '202710', '10201', 'MEEN 3311', 'Thermodynamics I', 'UT', '0800 - 0915'),
            ROW('u-a', 1, '202710', '10202', 'PHYS 1421', 'Physics for Engineers I', 'MW', '1000 - 1115'),
            ROW('u-a', 1, '202710', '10203', 'COMM 2311', 'Technical Communication', 'R', '1300 - 1350')],
    /* حط الربيع في جدوله الأول (النشط)، والخريف في الثاني */
    'u-b': [ROW('u-b', 1, '202720', '20201', 'MEEN 3312', 'Thermodynamics II', 'UT', '0930 - 1045'),
            ROW('u-b', 1, '202720', '20202', 'MATH 2421', 'Calculus III', 'MW', '1100 - 1215'),
            ROW('u-b', 2, '202710', '10301', 'MEEN 2311', 'Statics', 'UT', '0800 - 0915')],
    /* الربيع وحده */
    'u-c': [ROW('u-c', 1, '202720', '20301', 'MEEN 3312', 'Thermodynamics II', 'UT', '0930 - 1045')],
  },
  /* الصفحة تكتب الغياب والمواعيد بترم الدراسة (activeTermCode) */
  absences: { 'u-b': [{ crn: '10301', on_date: '2026-10-04', term: '202710' }, { crn: '10301', on_date: '2026-10-06', term: '202710' }] },
  events: { 'u-b': [{ crn: '10301', kind: 'quiz', on_date: '2026-11-25', note: 'Ch 4', term: '202710' }] },
};
let NOW = '2026-11-19T09:00:00Z';
let SCHED_READS = 0;
const ctxObj = {
  console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error,
  encodeURIComponent, setTimeout, clearTimeout, Map, Set,
  PLANS_DATA, ACAD_CAL, FREE_BETA: false, SITE_ENV: 'prod',
  riyadhNow: () => new Date(NOW),
  activeTerm: () => '202710', regTerm: () => '202710', nextRegTerm: () => '202720', currentWindow: () => null,
  absAllowedFor: () => 4, SEARCH_OLD_MS: 15 * 60 * 1000, FINALS_ON: true,
  coursesCache: new Map(), ROOM_INDEX: null,
  finalsCache: { M: { exams: [{ crn: '10301', code: 'MEEN 2311', title: 'Statics', section: '101', instructor: 'Doe, Jane',
    building: 'M-CORE', room: 'G034', day: 'Sunday', date: '2026-12-20', hour: '0800 - 1000', gender: 'M' }] }, F: null },
  getCourses: () => Promise.resolve({ courses: [] }), buildRoomIndex: () => Promise.resolve(null),
  fetchPage: () => Promise.resolve(''), getFinals: () => Promise.resolve([]),
  hasAccess: p => !!(p && p.is_pro),
  PRICING: { termHalalas: 1900, pushoverHalalas: 1500, friendDiscountHalalas: 300, referrerCreditHalalas: 500,
    referralHoldDays: 0, reviewsCreditHalalas: 500, reviewsNeeded: 5, creditTerms: 2, lateDays: 3,
    freeMonitors: 2, freeSchedules: 1, minCashHalalas: 1000 },
  pushoverOn: () => false, pushoverReady: () => 'off', usageLog: () => {},
  sb: (method, table, opt) => {
    const q = (opt && opt.query) || '';
    const m = /(?:id|user_id)=eq\.([^&]+)/.exec(q);
    const id = m ? decodeURIComponent(m[1]) : null;
    if (table === 'profiles') return Promise.resolve(DB.profiles[id] ? [DB.profiles[id]] : []);
    if (table === 'absences' || table === 'course_events') {
      const t = (/term=eq\.([^&]+)/.exec(q) || [])[1];
      return Promise.resolve(((table === 'absences' ? DB.absences : DB.events)[id] || []).filter(x => x.term === decodeURIComponent(t || '')));
    }
    if (table === 'user_schedule') { SCHED_READS++;
      return Promise.resolve((DB.schedule[id] || []).slice().sort((x, y) => (x.crn < y.crn ? -1 : 1))) }
    return Promise.resolve([]);
  },
};
vm.createContext(ctxObj);
for (const f of ['payTermName', 'tagGender']) { const c = grab(f); if (c) vm.runInContext(c, ctxObj) }
{ /* schedDays · schedTime — من السيرفر لا نسخة (§٦: النسخة المزيّفة كررت الخطأ فبقيت خضراء) */
  const i = L.findIndex(x => x.startsWith('function schedDays(')), j = L.findIndex(x => x.startsWith('/* ═══ إشعار تغيّر الجدول ═══'));
  if (i >= 0 && j > i) vm.runInContext(L.slice(i, j).join('\n'), ctxObj); else ok(false, 'ما لقيت schedDays في السيرفر');
}
let loaded = true;
try { vm.runInContext(REGION + '\nthis.aiStudentCtx=aiStudentCtx; this.aiRunTool=aiRunTool; this.AI_TOOLS=AI_TOOLS;', ctxObj) }
catch (e) { loaded = false; ok(false, 'منطقة الأدوات تشتغل — ' + String(e).slice(0, 160)) }
if (!loaded) done();
const { aiStudentCtx, aiRunTool, AI_TOOLS } = ctxObj;
const run = async (args, who) => aiRunTool('my_day', args || {}, await aiStudentCtx(who || 'u-a'));
const tool = async (name, args, who) => aiRunTool(name, args || {}, await aiStudentCtx(who || 'u-a'));

(async () => {
  /* ═══ ١) الخميس ١٩ نوفمبر ٢٠٢٦ — والأحد الجاي (٢٢) أول يوم في إجازة منتصف الترم (٢٢–٢٤) ═══ */
  NOW = '2026-11-19T09:00:00Z';
  let r = await run({ day: 'U' });
  ok(r && r.count === 0 && !codes(r).length && r.holiday && r.holiday.name === 'إجازة منتصف الترم',
     '**«وش عندي بكرة؟» (الأحد) يوم إجازة منتصف الترم: إجازة — لا محاضرات يوم عادي** — ' + short(r));
  ok(r && r.date === '2026-11-22' && r.holiday && r.holiday.start === '2026-11-22' && r.holiday.end === '2026-11-24',
     'بتاريخه، والإجازة بحدودها (٢٢–٢٤ نوفمبر) — ' + short(r));
  ok(!/MEEN 3311/.test(JSON.stringify(r || {})), 'وما تطلع محاضرة الأحد العادية (الثيرمو)');
  r = await run({ date: '2026-11-22' });
  ok(r && r.holiday && r.count === 0 && r.date === '2026-11-22', '**ويوم بتاريخه (date) كذلك** — ' + short(r));
  r = await run({ date: '2026-11-24' });
  ok(r && r.holiday && r.count === 0, 'وآخر يوم في الإجازة (الثلاثاء ٢٤) إجازة');

  r = await run({ date: '2026-11-25' });
  eq(codes(r), ['PHYS 1421'], '**الأربعاء ٢٥ بعد الإجازة: محاضراته العادية**');
  ok(r && r.date === '2026-11-25' && r.day === 'W' && r.dayName === 'الأربعاء' && !r.holiday,
     'ومعها التاريخ واسم اليوم — ' + short(r));
  r = await run({ day: 'R' });
  ok(r && r.date === '2026-11-19' && codes(r).join() === 'COMM 2311',
     '**حرف اليوم = أقرب يوم بهالحرف من اليوم — الخميس اليوم نفسه** — ' + short(r));
  r = await run({});
  ok(r && r.date === '2026-11-19' && r.day === 'R' && codes(r).join() === 'COMM 2311', '**بلا يوم ولا تاريخ: اليوم** — ' + short(r));
  r = await run({ date: '2026-11-20' });
  ok(r && r.count === 0 && /ما فيه محاضرات/.test(r.note || '') && !r.holiday, 'الجمعة: ما فيه محاضرات (مو إجازة من التقويم)');

  /* ═══ ٢) النهائيات وما بين الترمين ═══ */
  NOW = '2026-12-21T09:00:00Z';
  r = await run({ day: 'M' });
  ok(r && r.count === 0 && r.examPeriod && r.examPeriod.start === '2026-12-20' && r.examPeriod.end === '2026-12-30',
     '**الاثنين ٢١ ديسمبر في النهائيات: فترة النهائيات بحدودها — لا محاضرات** — ' + short(r));
  ok(/finals/.test((r && r.note) || ''), 'وتقول للنموذج يجيب نهائياته من أداة finals — ' + (r && r.note));
  r = await run({ date: '2026-12-31' });
  ok(r && r.count === 0 && r.classesStart && r.classesStart.date === '2027-01-17' && r.classesStart.termName === 'ربيع 2026/2027',
     '**بعد النهائيات (٣١ ديسمبر): ما فيه دراسة — والربيع يبدأ ١٧ يناير** — ' + short(r));
  r = await run({ date: '2027-01-05' });
  ok(r && r.count === 0 && r.holiday && r.holiday.name === 'إجازة منتصف السنة' && r.holiday.end === '2027-01-16',
     'وفي إجازة منتصف السنة باسمها — ' + short(r));
  NOW = '2026-08-25T09:00:00Z';
  r = await run({ date: '2026-08-26' });
  ok(r && r.count === 0 && r.classesStart && r.classesStart.date === '2026-08-30',
     '**قبل بداية الدراسة (٢٦ أغسطس): «الدراسة تبدأ ٣٠ أغسطس»** — ' + short(r));
  r = await run({ day: 'U' });
  ok(r && r.date === '2026-08-30' && codes(r).join() === 'MEEN 3311', 'وأول يوم دراسة (الأحد ٣٠ أغسطس) يوم محاضرات — ' + short(r));

  /* ═══ ٣) الجدول اللي لترم اليوم ═══ */
  NOW = '2026-11-19T09:00:00Z';
  r = await run({ date: '2026-11-29' }, 'u-b');
  ok(r && r.slot === 2 && codes(r).join() === 'MEEN 2311' && !/MEEN 3312/.test(JSON.stringify(r)),
     '**جدوله النشط للربيع وجدوله الثاني للخريف: يوم في الخريف يجي من الثاني** — ' + short(r));
  ok(/2/.test((r && r.note) || '') && /خريف 2026\/2027/.test((r && r.note) || ''),
     'ويقول من أي جدول ولأي ترم — ' + (r && r.note));
  r = await run({ date: '2026-11-29', slot: 1 }, 'u-b');
  ok(r && r.count === 0 && !codes(r).length && r.otherTerm && r.otherTerm.termName === 'ربيع 2026/2027',
     '**رقم جدول صريح لترم ثاني: ما نعرض محاضرات الربيع ليوم في الخريف** — ' + short(r));
  r = await run({ date: '2026-11-29' }, 'u-c');
  ok(r && r.count === 0 && r.otherTerm && r.otherTerm.termName === 'ربيع 2026/2027' &&
     /خريف 2026\/2027/.test(r.note || '') && /استورد/.test(r.note || ''),
     '**جدوله كله للربيع: يقولها، ويحثّه يضيف جدول الخريف** — ' + short(r));
  r = await run({ date: '2027-01-18' }, 'u-b');
  ok(r && r.slot === 1 && codes(r).join() === 'MATH 2421', 'ويوم في الربيع (١٨ يناير) من جدوله النشط (الربيع) — ' + short(r));
  r = await run({ date: '2027-01-18' });
  ok(r && r.count === 0 && r.otherTerm && r.otherTerm.termName === 'خريف 2026/2027',
     '**جدوله القديم (الخريف) ويوم في الربيع: ما نعرض الخريف** — ' + short(r));
  r = await run({ date: '2099-01-05' });
  eq(codes(r), ['PHYS 1421'], 'تاريخ برّا التقويم: محاضرات يومه كما كانت (ما نعرف عنه شي)');

  /* ═══ ٤) الإجازة من التقويم ولو جدوله فاضي — وبلا قراءة جدول ═══ */
  let reads = SCHED_READS;
  r = await run({ day: 'U' }, 'u-empty');
  ok(r && r.holiday && r.count === 0, '**جدول فاضي ويوم إجازة: الإجازة (حقيقة من التقويم)** — ' + short(r));
  eq(SCHED_READS, reads, 'وما احتجنا نقرأ جدوله');
  r = await run({ date: '2026-11-25' }, 'u-empty');
  ok(r && r.scheduleEmpty === true, 'وجدول فاضي يوم دراسة: «جدول فاضي» كما كان');

  /* ═══ ٥) الغياب والمواعيد ونهائياته: بجدول ترم الدراسة — الصفحة تكتبها بترم الدراسة ═══ */
  NOW = '2026-11-19T09:00:00Z';
  r = await tool('my_absences', {}, 'u-b');
  const ab = arr(r && r.courses);
  ok(ab.length === 1 && ab[0].code === 'MEEN 2311' && ab[0].absences === 2 && r.term === '202710',
     '**غيابه في الخريف ينقرأ ولو جدوله النشط للربيع** (كان «ما غبت ولا مرة») — ' + short(r));
  r = await tool('my_absences', {}, 'u-c');
  ok(r && r.count === 0 && r.otherTerm && r.otherTerm.termName === 'ربيع 2026/2027' && /خريف 2026\/2027/.test(r.note || ''),
     '**جدوله كله للربيع: «ما عندنا جدولك للخريف» — لا «صفر غياب» لمواد الربيع** — ' + short(r));
  r = await tool('my_absences', {}, 'u-a');
  eq(arr(r && r.courses).map(x => x.code).sort(), ['COMM 2311', 'MEEN 3311', 'PHYS 1421'], 'وجدول الخريف النشط كما كان');
  r = await tool('my_appointments', { days: 30 }, 'u-b');
  const ap = arr(r && r.appointments);
  ok(ap.length === 1 && ap[0].code === 'MEEN 2311' && ap[0].kind === 'quiz' && r.term === '202710',
     '**مواعيده (كويز الخريف) تنقرأ بترم الدراسة** — ' + short(r));
  r = await tool('finals', { mine: true }, 'u-b');
  ok(r && r.count === 1 && arr(r.exams)[0] && r.exams[0].code === 'MEEN 2311',
     '**نهائياته من جدول الخريف (ترم الدراسة)** — ' + short(r));
  r = await tool('finals', { mine: true }, 'u-c');
  ok(r && r.count === 0 && r.otherTerm && /استورد/.test(r.note || ''),
     '**وجدوله كله للربيع: يقولها — لا «ما عندك نهائيات»** — ' + short(r));
  r = await tool('finals', { mine: true }, 'u-empty');
  ok(r && r.count === 0 && r.scheduleEmpty === true, 'وجدول فاضي: «جدول فاضي»');

  /* ═══ ٦) وسائط غلط ═══ */
  for (const bad of ['2026-02-30', 'بكرة', '2026-13-01', '19-11-2026'])
    ok(!!(await run({ date: bad })).error, `تاريخ غلط «${bad}» يُرفض`);
  ok(!!(await run({ day: 'Z' })).error, 'ويوم غلط يُرفض كما كان');

  /* ═══ ٧) المخطط والتعليمات ═══ */
  const sch = AI_TOOLS.my_day && AI_TOOLS.my_day.input_schema;
  ok(!!(sch && sch.properties && sch.properties.date) && !arr(sch.required).includes('day'),
     'المخطط فيه date، وday ما عاد إلزامياً');
  const sys = (src.match(/const AI_SYSTEM = `[\s\S]*?`;/) || [''])[0];
  ok(/my_day/.test(sys) && /date/.test(sys), 'التعليمات: «وش عندي بكرة/يوم كذا» ⇒ my_day بالتاريخ');
})().catch(e => ok(false, 'انهار: ' + (e && e.stack || e))).finally(done);
