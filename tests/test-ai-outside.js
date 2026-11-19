/* مادة برّا خطة الطالب في المساعد — مراجعة المساعد (١٩ نوفمبر ٢٠٢٦، طلب محمد: «ابيك تراجع ال ai … ابي يكون ذكي»).
   course_info وfind_course وcourse_offering كانت تدوّر في خطته وحدها: طالب ميكانيكا يسأل عن «Data Structures» أو مادة
   محاسبة يبيها اختياري ⇒ «ما لقيتها في بيانات جدولك» — والمادة في خطة تخصص ثاني عندنا.

   أخطار يمسكها (الأدوات الحقيقية من السيرفر معزولة في vm، والخطط الحقيقية من shared/plans.js):
   ١) مادة موجودة في خطة ثانية تطلع «ما لقيتها».
   ٢) مادة برّا خطته تتقدّم كأنها منها (بلا «مو في خطتك» ومن أي خطة).
   ٣) مادة في خطته يتغيّر جوابها، أو مادة ما لها وجود تنخترع.

   node tests/test-ai-outside.js [server.js] */
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
const short = r => String(JSON.stringify(r)).slice(0, 170);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nمادة برّا الخطة: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

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
const planName = k => PLANS_DATA.PLANS[k].ar || PLANS_DATA.PLANS[k].name;

const SEC = (crn, code, title, section, d, t) => ({ crn, courseCode: code, courseTitle: title, section,
  courseDate: d, courseTiming: t, room: 'M-COBA - G034', instructor: 'Doe, Jane', status: 'OPEN' });
const DB = {
  profiles: { 'u-meen': { id: 'u-meen', major: 'MEEN', plan_ver: 'new', is_pro: true, prep: false },
              'u-nomajor': { id: 'u-nomajor', major: null, is_pro: true, prep: false } },
  completed: { 'u-meen': [{ course_code: 'MATH 1422', grade: 'A' }] },
};
const ctxObj = {
  console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error,
  encodeURIComponent, setTimeout, clearTimeout, Map, Set,
  PLANS_DATA, ACAD_CAL, FREE_BETA: false, SITE_ENV: 'prod',
  riyadhNow: () => new Date('2026-11-19T09:00:00Z'),
  activeTerm: () => '202710', regTerm: () => '202710', nextRegTerm: () => '202720', currentWindow: () => null,
  absAllowedFor: () => 4, SEARCH_OLD_MS: 15 * 60 * 1000, FINALS_ON: true,
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
for (const f of ['payTermName', 'tagGender']) { const c = grab(f); if (c) vm.runInContext(c, ctxObj) }
{
  const i = L.findIndex(x => x.startsWith('function schedDays(')), j = L.findIndex(x => x.startsWith('/* ═══ إشعار تغيّر الجدول ═══'));
  if (i >= 0 && j > i) vm.runInContext(L.slice(i, j).join('\n'), ctxObj); else ok(false, 'ما لقيت schedDays في السيرفر');
}
let loaded = true;
try { vm.runInContext(REGION + '\nthis.aiStudentCtx=aiStudentCtx; this.aiRunTool=aiRunTool;', ctxObj) }
catch (e) { loaded = false; ok(false, 'منطقة الأدوات تشتغل — ' + String(e).slice(0, 160)) }
if (!loaded) done();
const { aiStudentCtx, aiRunTool } = ctxObj;
const run = async (name, args, who) => aiRunTool(name, args || {}, await aiStudentCtx(who || 'u-meen'));

(async () => {
  /* ═══ ١) course_info ═══ */
  let r = await run('course_info', { code: 'GEIT 2421' });
  ok(r && r.known === true && r.inYourPlan === false && r.name === 'Data Structures' && r.credits === 4 &&
     JSON.stringify(r.prereqs) === '["GEIT 1412"]',
     '**طالب ميكانيكا يسأل عن Data Structures: معلوماتها من خطة ثانية — لا «ما لقيتها»** — ' + short(r));
  ok(r && r.fromPlan === planName('COSC') && /مو في خطته/.test(r.note || ''),
     'ويقول إنها مو في خطته، ومن أي خطة (والمتطلبات حسبها) — ' + (r && r.fromPlan));
  ok(!(r && r.yourStatus), 'وما يحسب «مفتوحة لك؟» على خطة مو خطته');
  r = await run('course_info', { code: 'ACCT 2311' });
  ok(r && r.known === true && r.inYourPlan === false && r.name === 'Fundamentals of Financial Accounting',
     '**مادة محاسبة يبيها اختياري: معروفة** — ' + short(r));
  r = await run('course_info', { code: 'COMM 1311' });
  ok(r && r.known === true && r.inYourPlan === false && r.fromPlan === 'الهندسة الميكانيكية (الخطة القديمة)' &&
     /نسخة خطته/.test(r.note || '') && /الجديدة\/القديمة/.test(r.note || ''),
     '**مادة في النسخة الثانية من خطة تخصصه: «موجودة في الخطة القديمة لتخصصك» — لا «في خطة الحاسب»** — ' + short(r));
  r = await run('course_info', { code: 'CHEN 2311' });
  ok(r && r.known === true && r.fromPlan === 'الهندسة الكيميائية (الخطة الجديدة)' && /مو في خطته/.test(r.note || ''),
     'ومادة في نسختين لتخصص ثاني: من الجديدة أول — ' + (r && r.fromPlan));
  r = await run('course_info', { code: 'MEEN 2311' });
  ok(r && r.known === true && r.inYourPlan === undefined && !!r.yourStatus,
     'ومادة من خطته كما كانت (وحالتها له) — ' + short(r));
  r = await run('course_info', { code: 'XXXX 9999' });
  ok(r && r.known === false, 'ومادة ما لها وجود في أي خطة: «ما لقيتها» — ما ننخترع');

  /* ═══ ٢) find_course ═══ */
  r = await run('find_course', { query: 'data structures' });
  ok(r && r.inYourPlan === false && arr(r.matches)[0] && r.matches[0].code === 'GEIT 2421' && r.matches[0].fromPlan,
     '**«data structures» من طالب ميكانيكا: يلقاها في خطة ثانية** — ' + short(r));
  r = await run('find_course', { query: 'محاسبة' });
  ok(r && r.inYourPlan === false && arr(r.matches).length && arr(r.matches).every(x => /^ACCT /.test(x.code) || /accounting/i.test(x.name)),
     '**«محاسبة» بالعربي (جسر العربي نفسه): مواد المحاسبة من خطط ثانية** — ' + short(r));
  r = await run('find_course', { query: 'قثقث' });
  ok(r && r.found === 0, 'وكلمة عربية ما لها جسر ولا مطابقة: صفر — ما ننخترع');
  r = await run('find_course', { query: 'financial accounting' });
  ok(r && r.inYourPlan === false && arr(r.matches).some(x => x.code === 'ACCT 2311') && /مو في خطته/.test(r.note || ''),
     '**«financial accounting»: ACCT 2311 من خطة ثانية، ويقول إنها برّا خطته** — ' + short(r));
  ok(!arr(r && r.matches).some(x => /ELEC|E\d$/.test(x.code)), 'وخانات الاختياري (ELEC 1 …) ما تطلع كمواد');
  r = await run('find_course', { query: 'thermo' });
  ok(r && r.inYourPlan === undefined && arr(r.matches).some(x => /^MEEN/.test(x.code)),
     'ومادة من خطته (thermo) كما كانت — من خطته أول — ' + short(r));
  r = await run('find_course', { query: 'zzqqxx' });
  ok(r && r.found === 0, 'وما لها مطابقة أبداً: صفر');

  /* ═══ ٣) course_offering لمادة برّا خطته — من جدول الجامعة للترم ═══ */
  ctxObj.coursesCache.set('202720|ALL|M1', { at: Date.now(), courses: [
    SEC('22001', 'ACCT 2311', 'Fundamentals of Financial Accounting', '101', 'UT', '0800 - 0915'),
    SEC('22002', 'ACCT 2311', 'Fundamentals of Financial Accounting', '102', 'MW', '0930 - 1045')] });
  r = await run('course_offering', { code: 'ACCT 2311' });
  ok(r && r.known === true && r.inYourPlan === false && r.status === 'offered' && r.sections === 2 && r.termName === 'ربيع 2026/2027',
     '**«تنطرح ACCT 2311 الترم الجاي؟» من طالب ميكانيكا: من جدول الربيع — لها شعبتان** — ' + short(r));
  r = await run('course_offering', { code: 'GEIT 2421' });
  ok(r && r.known === true && r.status === 'no_sections', 'ومادة ما لها شعب في جدول الربيع: «ما لها شعب الحين» — ' + short(r));
  r = await run('course_offering', { code: 'XXXX 9999' });
  ok(r && r.known === false, 'وما لها وجود: «ما لقيتها»');

  /* ═══ ٤) بلا تخصص كما كان: ما نجاوب عن الخطة ═══ */
  r = await run('course_info', { code: 'ACCT 2311' }, 'u-nomajor');
  ok(r && !!r.error && r.known !== true, 'بلا تخصص: يطلب يختار تخصصه (كما كان) — ' + short(r));

  /* ═══ ٥) اسمه في التعليمات ═══ */
  const sys = (src.match(/const AI_SYSTEM = `[\s\S]*?`;/) || [''])[0];
  ok(/^const AI_SYSTEM = `أنت «Jadwalik AI»/.test(sys), '**اسمه في تعليماته «Jadwalik AI»** — مثل الموقع (كان «مساعد جدولك»)');
})().catch(e => ok(false, 'انهار: ' + (e && e.stack || e))).finally(done);
