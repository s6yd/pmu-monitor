/* مواعيد الجامعة في المساعد — لقاها محمد (١٩ نوفمبر ٢٠٢٦): سأل «متى يبدأ التسجيل؟» فجاوبه «ما عندي تواريخ تسجيل الربيع،
   اللي رجع لي جدول تسجيل الخريف وقد انتهى» — والتقويم الموحّد (ACAD_CAL) فيه تسجيل الربيع ١٠–١٤ يناير.
   registration_calendar كانت ترجّع REG_CAL كما هو: أيام المستويات لتسجيل الخريف (أغسطس) ثابتة في الكود.

   أخطار يمسكها (أدوات المساعد الحقيقية من السيرفر، معزولة في vm، وساعة السيرفر مثبّتة على يوم بعينه):
   ١) «متى يبدأ التسجيل؟» ترجع ترماً خلص بدل ترم التسجيل الجاي.
   ٢) أيام مستويات ترم تنقال عن ترم ثاني — أو يوم مخترع لترم ما نزل توزيعه.
   ٣) النموذج يحسب «كم باقي» بنفسه: الأداة تقول لكل موعد فات ولا الحين ولا جاي وكم باقي.
   ٤) جدول النهائيات بالمواد ما نزل ⇒ «مو معروض» وبس، والتقويم فيه فترة النهائيات.

   node tests/test-ai-dates.js [server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const SHARED = path.join(path.dirname(SRV), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
/* على الكود القديم الأشكال تختلف: فشل مرتّب لا انهيار يخفي الباقي */
const arr = v => (Array.isArray(v) ? v : []);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nمواعيد المساعد: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

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
/* البيانات المشتركة من نفس نسخة السيرفر (على الكود القديم: ملفه القديم) */
delete require.cache[require.resolve(SHARED)];
const PLANS_DATA = require(SHARED);

/* ═══ طلاب ═══ مواد منجزة حقيقية من خطة الميكانيكال لين ساعات المستوى المطلوب */
const plan = PLANS_DATA.planOf('MEEN', PLANS_DATA.planVerOf('MEEN', 'new'));
const courses = [];
(plan.sems || []).forEach(s => (s.c || s.courses || []).forEach(c => courses.push(c)));
/* شكل الخطة في shared/plans.js: c الرمز · h الساعات */
const codeOf = c => c.c;
const credOf = c => Number(c.h) || 0;
function upTo(minCr) {
  const rows = []; let n = 0;
  for (const c of courses) { if (n >= minCr) break; const k = codeOf(c), cr = credOf(c);
    if (!k || !/^[A-Z]{2,5} \d{4}$/.test(k) || !cr) continue; rows.push({ course_code: k, grade: 'B' }); n += cr }
  return rows;
}
const DB = {
  profiles: {
    'u-jr': { id: 'u-jr', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false },
    'u-prep': { id: 'u-prep', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: true },
    'u-empty': { id: 'u-empty', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false },
    'u-nomajor': { id: 'u-nomajor', major: null, is_pro: true, prep: false },
  },
  completed: { 'u-jr': upTo(62), 'u-prep': upTo(12), 'u-nomajor': upTo(62) },
};

let NOW = '2026-11-19T09:00:00Z', ACTIVE = '202710', NEXT_REG = '202720', FINALS = false;
const ctxObj = {
  console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error,
  encodeURIComponent, setTimeout, clearTimeout, Map, Set,
  PLANS_DATA, ACAD_CAL, FREE_BETA: false, SITE_ENV: 'prod',
  riyadhNow: () => new Date(NOW),
  activeTerm: () => ACTIVE, regTerm: () => ACTIVE, nextRegTerm: () => NEXT_REG, currentWindow: () => null,
  absAllowedFor: () => 4, SEARCH_OLD_MS: 15 * 60 * 1000,
  get FINALS_ON() { return FINALS },
  coursesCache: new Map(), ROOM_INDEX: null, finalsCache: { M: null, F: null },
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
    if (table === 'completed_courses') return Promise.resolve(DB.completed[id] || []);
    return Promise.resolve([]);
  },
};
vm.createContext(ctxObj);
for (const f of ['payTermName', 'schedDays', 'schedTime', 'tagGender']) { const c = grab(f); if (c) vm.runInContext(c, ctxObj) }
let loaded = true;
try { vm.runInContext(REGION + '\nthis.aiStudentCtx=aiStudentCtx; this.aiRunTool=aiRunTool;', ctxObj) }
catch (e) { loaded = false; ok(false, 'منطقة الأدوات تشتغل — ' + String(e).slice(0, 160)) }
if (!loaded) done();
const { aiStudentCtx, aiRunTool } = ctxObj;
const GUEST = { userId: null, profile: null, pro: false, guest: true, prep: false, prepInferred: false, plan: null, allow: null };
const run = async (name, args, who) => aiRunTool(name, args || {}, who === 'guest' ? GUEST : await aiStudentCtx(who || 'u-jr'));

(async () => {
  ok(PLANS_DATA.doneCredits((await aiStudentCtx('u-jr')).plan) >= 60, 'طالب الاختبار جونيور (60 ساعة فأكثر من خطته)');

  /* ═══ ١) اليوم ١٩ نوفمبر ٢٠٢٦: «متى يبدأ التسجيل؟» = تسجيل الربيع ═══ */
  let r = await run('registration_calendar');
  ok(r && r.term === '202720' && r.termName === 'ربيع 2026/2027',
     '**التسجيل لترم التسجيل الجاي (الربيع) لا الخريف اللي خلص** — ' + String(JSON.stringify(r)).slice(0, 160));
  const reg = (r && r.registration) || {};
  ok(reg.start === '2027-01-10' && reg.end === '2027-01-14' && reg.when === 'upcoming' && reg.daysLeft === 52,
     '**فترة تسجيل الربيع من التقويم الموحّد: 10–14 يناير، جاية، باقي عليها 52 يوم** — ' + JSON.stringify(reg));
  eq(r && r.classesStart, '2027-01-17', 'وبداية الدراسة');
  const ad = arr(r && r.addDrop).map(e => e.start + '…' + (e.end || ''));
  ok(ad.includes('2027-01-17…2027-01-21') && ad.some(x => x.startsWith('2027-01-28')),
     'والحذف والإضافة وآخر يوم حذف بلا رسوم — ' + ad.join(' · '));
  ok(r && r.levels === null && /ما نزل/.test(r.levelsNote || ''),
     '**أيام المستويات للربيع ما نزلت: levels فاضية بصدق — لا أيام الخريف ولا يوم مخترع** — ' + JSON.stringify(r && r.levels));
  ok(r && r.lastOrder && /الخريف|الأول/.test(r.lastOrder.termAr || '') && arr(r.lastOrder.order).length === 5 &&
     !/2026-08/.test(JSON.stringify(r.lastOrder)),
     'وترتيب المستويات من آخر إعلان بترمه وبلا تواريخه — ' + String(JSON.stringify(r && r.lastOrder)).slice(0, 120));
  ok(r && r.you && r.you.level === 'Junior' && r.you.credits >= 60 && r.you.credits < 90 && !r.you.day,
     '**مستواه من ساعاته في «خطتي»، وبلا يوم ما نعرفه** — ' + JSON.stringify(r && r.you));
  ok(!/2026-08/.test(JSON.stringify(r)), '**ولا تاريخ من تسجيل الخريف في الجواب**');

  /* بلا تخصص · خطة فاضية · زائر: الفترة نفسها وبلا «مستواك» */
  for (const who of ['u-nomajor', 'u-empty', 'guest']) {
    const x = await run('registration_calendar', {}, who);
    ok(x && x.registration && x.registration.start === '2027-01-10' && !x.you,
       `${who}: الفترة نفسها وبلا مستوى (ما نعرف ساعاته) — ${JSON.stringify(x && x.you)}`);
  }

  /* ترم بعينه: الصيفي فيه موعدان */
  r = await run('registration_calendar', { term: '202730' });
  ok(r && r.registration && r.registration.start === '2027-04-11' && arr(r.registrations).length === 2 &&
     r.registrations[1].start === '2027-06-15',
     '**الصيفي: التسجيل المبكر في أبريل والتأكيد في يونيو** — ' + String(JSON.stringify(r && r.registrations)).slice(0, 160));
  ok(!!(await run('registration_calendar', { term: 'abc' })).error, 'ترم بشكل غلط: «ما أعرف»');
  ok(!!(await run('registration_calendar', { term: '209910' })).error, 'ترم ما عندنا تقويمه: «ما أعرف» لا اختراع');

  /* ═══ ٢) يوم ٢٠ أغسطس ٢٠٢٦ (قبل تسجيل الخريف): أيام المستويات معروفة ويومه منها ═══ */
  NOW = '2026-08-20T09:00:00Z'; NEXT_REG = '202710';
  r = await run('registration_calendar');
  ok(r && r.term === '202710' && Array.isArray(r.levels) && r.levels.length === 5 &&
     arr(r.levels).some(l => l.key === 'sr' && l.date === '2026-08-24'),
     '**تسجيل الخريف: أيام المستويات من REG_CAL — لأنها لنفس الترم** — ' + String(JSON.stringify(r && r.levels)).slice(0, 120));
  ok(r && r.registration && r.registration.when === 'upcoming' && r.registration.daysLeft === 3, 'والفترة جاية بعد 3 أيام');
  eq(r && r.you && r.you.day, '2026-08-25', '**ويومه: جونيور ⇒ 25 أغسطس**');
  r = await run('registration_calendar', {}, 'u-prep');
  eq(r && r.you && r.you.day, '2026-08-23', 'والتحضيري يومه يوم المسائي والدراسات العليا والتحضيري');
  NOW = '2026-08-25T09:00:00Z';
  r = await run('registration_calendar');
  ok(r && r.registration && r.registration.when === 'now' && r.registration.daysToEnd === 2,
     'وسط الفترة: «الحين» وكم باقي على نهايتها — ' + JSON.stringify(r && r.registration));

  /* ═══ ٣) التقويم: فات · الحين · جاي — وأقرب موعد من كل نوع ═══ */
  NOW = '2026-11-19T09:00:00Z'; NEXT_REG = '202720';
  r = await run('academic_calendar');
  const ev = arr(r && r.events);
  ok(r && r.today === '2026-11-19' && r.nextRegTermName === 'ربيع 2026/2027' && r.currentTermName === 'خريف 2026/2027',
     '**التقويم يقول اليوم والترم الحالي وترم التسجيل الجاي بأسمائهم**');
  ok(ev.length > 10 && ev.every((e, k) => k === 0 || ev[k - 1].start <= e.start), 'كل المواعيد مرتّبة بتاريخها');
  const nx = (r && r.next) || {};
  ok(nx.off && nx.off.start === '2026-11-22' && nx.off.daysLeft === 3, '**أقرب إجازة: منتصف الترم بعد 3 أيام** — ' + JSON.stringify(nx.off));
  ok(nx.exam && nx.exam.start === '2026-12-20' && nx.exam.daysLeft === 31, 'وأقرب نهائيات: 20 ديسمبر');
  ok(nx.reg && nx.reg.start === '2027-01-10' && nx.reg.termName === 'ربيع 2026/2027', '**وأقرب تسجيل: الربيع 10 يناير**');
  const w = ev.find(e => e.start === '2026-11-05') || {};
  ok(w.when === 'past' && !('daysLeft' in w), 'وموعد فات «past» بلا «باقي»');
  NOW = '2026-11-23T09:00:00Z';
  r = await run('academic_calendar');
  const mid = arr(r && r.events).find(e => e.start === '2026-11-22') || {};
  ok(mid.when === 'now' && mid.daysToEnd === 1, 'ووسط الإجازة «الحين» وكم باقي على نهايتها');
  r = await run('academic_calendar', { term: '202720' });
  ok(arr(r && r.events).every(e => e.term === '202720') && arr(r && r.events).length > 5, 'وترم بعينه: مواعيده وحدها');
  ok(!!(await run('academic_calendar', { term: '209910' })).error, 'وترم ما عندنا: «ما أعرف»');

  /* ═══ ٤) النهائيات: جدول المواد ما نزل ⇒ فترة النهائيات من التقويم ═══ */
  NOW = '2026-11-19T09:00:00Z';
  FINALS = false;
  r = await run('finals', { code: 'MEEN 3311' });
  ok(r && r.available === false && r.examPeriod && r.examPeriod.start === '2026-12-20' && r.examPeriod.end === '2026-12-30' &&
     r.examPeriod.termName === 'خريف 2026/2027',
     '**جدول النهائيات ما نزل: فترة نهائيات الخريف 20–30 ديسمبر بدل «مو معروض» وبس** — ' + String(JSON.stringify(r)).slice(0, 160));
  NOW = '2027-01-05T09:00:00Z';
  r = await run('finals', { code: 'MEEN 3311' });
  ok(r && r.examPeriod && r.examPeriod.start === '2027-05-30', 'وبعد نهائيات الخريف: فترة نهائيات الربيع');
  FINALS = true; NOW = '2026-11-19T09:00:00Z';
  r = await run('finals', { code: 'MEEN 3311' });
  ok(r && r.examPeriod && r.examPeriod.start === '2026-12-20', 'والجدول مفعّل بس ما وصلت بياناته: الفترة كذلك');

  /* ═══ ٥) التعليمات تقول وين المواعيد ═══ */
  const sys = (src.match(/const AI_SYSTEM = `[\s\S]*?`;/) || [''])[0];
  ok(/registration_calendar/.test(sys) && /academic_calendar/.test(sys) && /levels: null/.test(sys) && /examPeriod/.test(sys),
     'التعليمات: المواعيد من أداتي التقويم، وأيام المستويات ما تنخترع، وفترة النهائيات');
})().catch(e => ok(false, 'انهار: ' + (e && e.stack || e))).finally(done);
