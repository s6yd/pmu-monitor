/* «الترم الجاي» في أدوات المساعد — مراجعة المساعد (١٩ نوفمبر ٢٠٢٦، طلب محمد: «ابيك تراجع ال ai … ابي يكون ذكي»).
   كانت الشعب ومين يدرّس المادة تقرأ ترم الدراسة وحده (بلا وسيط ترم)، والباني ترم التسجيل اللي خارج النافذة = ترم
   الدراسة: في نوفمبر «وش شعب MATH 1423 الترم الجاي؟» ⇒ شعب الخريف الشغّال كأنها للربيع، و«ابن لي جدول» ⇒ جدول للخريف
   اللي انقفل تسجيله. و«تنطرح الترم الجاي؟» لتخصص ما عندنا جدول طرحه ⇒ «ما فيه تحذير» فيفهمها النموذج «تُطرح».

   أخطار يمسكها (الأدوات الحقيقية من السيرفر معزولة في vm، والكاش بجدولي الخريف والربيع):
   ١) شعب ترم تطلع على إنها ترم ثاني — أو ترم ما نزل جدوله يتعوّض بغيره.
   ٢) الباني يبني لترم انقفل تسجيله بدل ترم التسجيل الجاي.
   ٣) «تُطرح؟» بلا جدول طرح ⇒ «ما فيه تحذير» بدل «ما نعرف» أو الجواب من جدول الجامعة.

   node tests/test-ai-nextterm.js [server.js] */
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
const done = () => { out.forEach(l => console.log(l)); console.log(`\nالترم الجاي في المساعد: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

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

/* صيغة الجامعة حرفاً بحرف: الوقت بلا نقطتين · الأيام حروف · المقفلة CLOSE */
const SEC = (crn, code, title, section, d, t, ins, st) => ({ crn, courseCode: code, courseTitle: title, section,
  courseDate: d, courseTiming: t, room: 'M-CORE - G034', instructor: ins, status: st || 'OPEN' });
const FALL = [SEC('10101', 'MATH 1423', 'Calculus II', '101', 'MW', '0800 - 0915', 'Fall, Teacher'),
  SEC('10102', 'PHYS 1421', 'Physics for Engineers I', '101', 'UT', '1000 - 1115', 'Fall, Physicist')];
const SPRING = [SEC('20101', 'MATH 1423', 'Calculus II', '101', 'MW', '0930 - 1045', 'Spring, Teacher'),
  SEC('20102', 'MATH 1423', 'Calculus II', '102', 'UT', '1300 - 1415', 'Spring, Other', 'CLOSE'),
  SEC('20103', 'COMM 1312', 'Communication II', '101', 'UT', '0800 - 0915', 'Spring, Writer')];

const DB = {
  profiles: { 'u-cosc': { id: 'u-cosc', major: 'COSC', plan_ver: 'new', is_pro: true, prep: false },
              'u-meen': { id: 'u-meen', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false } },
  completed: { 'u-cosc': [{ course_code: 'MATH 1422', grade: 'A' }, { course_code: 'COMM 1311', grade: 'B' }] },
};
let NOW = '2026-11-19T09:00:00Z', ACTIVE = '202710', NEXT_REG = '202720', REG = '202710';
const PULLED = [];
const ctxObj = {
  console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error,
  encodeURIComponent, setTimeout, clearTimeout, Map, Set,
  PLANS_DATA, ACAD_CAL, FREE_BETA: false, SITE_ENV: 'prod',
  riyadhNow: () => new Date(NOW),
  activeTerm: () => ACTIVE, regTerm: () => REG, nextRegTerm: () => NEXT_REG, currentWindow: () => null,
  absAllowedFor: () => 4, SEARCH_OLD_MS: 15 * 60 * 1000, FINALS_ON: true,
  coursesCache: new Map(), ROOM_INDEX: null, finalsCache: { M: null, F: null },
  /* تسخين ترم ما نزل: الجامعة ترجّع فاضي — ما ينكتب كاش */
  getCourses: (t) => { PULLED.push(t); return Promise.resolve({ courses: [] }) },
  buildRoomIndex: () => Promise.resolve(null), fetchPage: () => Promise.resolve(''), getFinals: () => Promise.resolve([]),
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
    if (table === 'completed_courses') return Promise.resolve(DB.completed[id] || []);
    return Promise.resolve([]);
  },
};
vm.createContext(ctxObj);
for (const f of ['payTermName', 'tagGender']) { const c = grab(f); if (c) vm.runInContext(c, ctxObj) }
{ /* schedDays · schedTime · باني الجداول · schedClash — من السيرفر لا نسخة */
  const i = L.findIndex(x => x.startsWith('function schedDays(')), j = L.findIndex(x => x.startsWith('/* ═══ إشعار تغيّر الجدول ═══'));
  if (i >= 0 && j > i) vm.runInContext(L.slice(i, j).join('\n'), ctxObj); else ok(false, 'ما لقيت schedDays والباني في السيرفر');
}
let loaded = true;
try { vm.runInContext(REGION + '\nthis.aiStudentCtx=aiStudentCtx; this.aiRunTool=aiRunTool;', ctxObj) }
catch (e) { loaded = false; ok(false, 'منطقة الأدوات تشتغل — ' + String(e).slice(0, 160)) }
if (!loaded) done();
const { aiStudentCtx, aiRunTool } = ctxObj;
const run = async (name, args, who) => aiRunTool(name, args || {}, await aiStudentCtx(who || 'u-cosc'));
const cache = (term, rows) => {
  if (rows) ctxObj.coursesCache.set(term + '|ALL|M1', { at: Date.now(), courses: rows });
  else ['M1', 'F1'].forEach(g => ctxObj.coursesCache.delete(term + '|ALL|' + g));
};

(async () => {
  cache('202710', FALL);

  /* ═══ ١) الشعب ═══ */
  let r = await run('sections', { code: 'MATH 1423' });
  ok(r && r.term === '202710' && r.termName === 'خريف 2026/2027' && arr(r.sections).every(s => s.crn === '10101'),
     'بلا ترم: شعب الترم الحالي باسمه — ' + String(JSON.stringify(r)).slice(0, 120));
  cache('202720', SPRING);
  r = await run('sections', { code: 'MATH 1423', term: '202720' });
  ok(r && r.term === '202720' && r.termName === 'ربيع 2026/2027' && arr(r.sections).length === 2 &&
     arr(r.sections).every(s => s.crn.startsWith('201')),
     '**«شعب الترم الجاي»: شعب الربيع باسمه — لا شعب الخريف** — ' + String(JSON.stringify(r)).slice(0, 140));
  r = await run('sections', { code: 'MATH 1423', term: '202720', openOnly: true });
  ok(r && arr(r.sections).length === 1 && r.sections[0].crn === '20101', 'والمفتوحة وحدها من الربيع');
  cache('202720', null);
  r = await run('sections', { code: 'MATH 1423', term: '202720' });
  ok(r && r.available === false && /ربيع 2026\/2027/.test(r.error || '') && !/10101/.test(JSON.stringify(r)),
     '**جدول الربيع ما نزل: نقولها — ولا نعرض شعب الخريف بداله** — ' + String(JSON.stringify(r)).slice(0, 140));
  ok(PULLED.includes('202720'), 'وحاولنا نجيبه من نفس طبقة البحث (بحرّاس التسخين)');
  ok(!!(await run('sections', { code: 'MATH 1423', term: 'spring' })).error, 'ترم بشكل غلط: «ما أعرف»');

  /* ═══ ٢) مين يدرّسها ═══ */
  cache('202720', SPRING);
  r = await run('course_instructors', { codes: ['MATH 1423'], term: '202720' });
  const teach = arr(((arr(r && r.courses)[0]) || {}).teaching).map(x => x.name);
  ok(r && r.term === '202720' && r.termName === 'ربيع 2026/2027' && teach.includes('Spring, Teacher') && !teach.includes('Fall, Teacher'),
     '**مين يدرّسها الترم الجاي: من جدول الربيع** — ' + teach.join(' · '));
  r = await run('course_instructors', { codes: ['MATH 1423'] });
  ok(r && r.term === '202710' && arr(((arr(r.courses)[0]) || {}).teaching).some(x => x.name === 'Fall, Teacher'),
     'وبلا ترم: الترم الحالي كما كان');
  cache('202720', null);
  r = await run('course_instructors', { codes: ['MATH 1423'], term: '202720' });
  ok(r && /ربيع 2026\/2027/.test(r.scheduleNote || '') && !arr(((arr(r.courses)[0]) || {}).teaching).length,
     'جدول الربيع ما نزل: القائمة من التقييمات وحدها وتقول ليش — ' + (r && r.scheduleNote));

  /* ═══ ٣) باني الجداول: لترم التسجيل الجاي ═══ */
  cache('202720', SPRING);
  r = await run('build_schedule', { codes: ['MATH 1423', 'COMM 1312'] });
  ok(r && r.term === '202720' && !/10101/.test(JSON.stringify(r)),
     '**«ابن لي جدول» في نوفمبر: للربيع (ترم التسجيل الجاي) — لا للخريف اللي انقفل تسجيله** — term ' + (r && r.term));
  cache('202720', null);
  r = await run('build_schedule', { codes: ['MATH 1423'] });
  ok(r && r.available === false && /ربيع 2026\/2027/.test(r.error || '') && !/10101/.test(JSON.stringify(r)),
     '**جدول الربيع ما نزل: نقولها — لا جدول من شعب الخريف** — ' + String(JSON.stringify(r)).slice(0, 140));
  cache('202720', SPRING);
  r = await run('build_schedule', { codes: ['MATH 1423'], term: '202710' });
  ok(r && r.term === '202710', 'وطلب الترم الحالي صراحةً يبني له');

  /* ═══ ٤) «تنطرح الترم الجاي؟» لتخصص بلا جدول طرح ═══ */
  r = await run('course_offering', { code: 'MATH 1423' });
  ok(r && r.status === 'offered' && r.sections === 2 && r.termName === 'ربيع 2026/2027',
     '**حاسب (بلا جدول طرح): من جدول الربيع — لها شعبتان** — ' + String(JSON.stringify(r)).slice(0, 140));
  r = await run('course_offering', { code: 'PHYS 1421' });
  ok(r && r.status === 'no_sections', 'ومادة ما لها شعب في جدول الربيع: «ما لها شعب الحين» — ' + (r && r.status));
  cache('202720', null);
  r = await run('course_offering', { code: 'MATH 1423' });
  ok(r && r.status === 'unknown' && !/تحذير/.test(JSON.stringify(r)),
     '**وجدول الربيع ما نزل: «ما نعرف» — لا «ما فيه تحذير» اللي يفهمها النموذج «تُطرح»** — ' + String(JSON.stringify(r)).slice(0, 140));
  /* الميكانيكال: جدول الطرح من وثيقة الجامعة كما كان */
  r = await run('course_offering', { code: 'MATH 1423' }, 'u-meen');
  ok(r && r.known === true && ['ok', 'not_offered_now', 'last_chance'].includes(r.status), 'والميكانيكال من جدول طرحه كما كان — ' + (r && r.status));

  /* ═══ ٥) حارس: الترم من قائمة قصيرة — كل ترم جديد سحبة من الجامعة، وترم بلا جدول عندهم يرجع فاضي ═══ */
  const pulled = PULLED.length;
  for (const [tool, args] of [['sections', { code: 'MATH 1423' }], ['build_schedule', { codes: ['MATH 1423'] }],
                              ['course_instructors', { codes: ['MATH 1423'] }]])
    for (const bad of ['199910', '205010', '202630']) {
      r = await run(tool, Object.assign({ term: bad }, args));
      ok(r && /خريف 2026\/2027/.test(r.error || '') && /ربيع 2026\/2027/.test(r.error || ''),
         `**${tool} بترم ${bad}: يرفض ويقول وش نقدر نشوف (الحالي والجاي)** — ` + String(JSON.stringify(r)).slice(0, 120));
    }
  eq(PULLED.length, pulled, '**ولا سحبة من الجامعة لترم برّا القائمة**');

  /* ═══ ٦) التعليمات ═══ */
  const sys = (src.match(/const AI_SYSTEM = `[\s\S]*?`;/) || [''])[0];
  ok(/«الترم الجاي» في الشعب/.test(sys) && /course_offering/.test(sys), 'التعليمات: «الترم الجاي» ترم التسجيل الجاي، وunknown ما تعني تُطرح');
})().catch(e => ok(false, 'انهار: ' + (e && e.stack || e))).finally(done);
