/* أدوات المساعد — القراءة. اختبار (CLAUDE.md §٩-أ-٢).
   نموذج مزيّف يستدعي الأدوات بأسمائها ووسائطها JSON — كما يستدعيها
   الحقيقي — فيثبت الأدوات والخصوصية والحصة و«ما أعرف».

   ثلاثة أخطار يمسكها:
   ١) أداة ترجع بيانات طالب غيره، أو تقبل معرّفاً من الوسائط.
   ٢) أداة تخترع: تخمّن ساعات مادة أو متطلبها بدل «ما لقيتها».
   ٣) أداة للمشتركين تشتغل لمجاني.

   node tests/test-ai-tools.js [server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ROOT = path.dirname(SRV);
const SHARED = path.join(ROOT, 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const src = fs.readFileSync(SRV, 'utf8');

/* ═══ اقتطاع منطقة الأدوات وتشغيلها معزولة ═══ */
const START = '/* ═══════════ أدوات المساعد — القراءة';
const END = '/* ═══ نهاية أدوات المساعد ═══';
const i = src.indexOf(START), j = src.indexOf(END);
ok(i >= 0 && j > i, 'منطقة الأدوات موجودة بعلامتيها');
if (i < 0 || j <= i) { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(1) }
const REGION = src.slice(i, j);

let PLANS_DATA = null;
try { PLANS_DATA = require(SHARED) } catch (e) {}
ok(!!PLANS_DATA, 'shared/plans.js يُقرأ');
if (!PLANS_DATA) { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(1) }

/* التقويم من السيرفر نفسه */
const ci = src.indexOf('const ACAD_CAL = [');
const cj = src.indexOf('\n];', ci);
const ACAD_CAL = new Function(src.slice(ci, cj + 3) + '; return ACAD_CAL;')();

/* قاعدة مزيّفة: صفوف طالبين، حتى نثبت إن الأداة ما تخلط بينهما */
const DB = {
  profiles: {
    'u-pro':  { id: 'u-pro',  major: 'COSC', plan_ver: 'new', is_pro: true,  name: 'صاحب السؤال' },
    'u-free': { id: 'u-free', major: 'COSC', plan_ver: 'new', is_pro: false, name: 'مجاني' },
    'u-other':{ id: 'u-other',major: 'MEEN', plan_ver: 'old', is_pro: true,  name: 'طالب ثانٍ' },
    /* التحضيري: محفوظة true · محفوظة false · بلا قيمة (NULL) */
    'u-prep-on':  { id: 'u-prep-on',  major: 'COSC', plan_ver: 'new', is_pro: true, prep: true },
    'u-prep-off': { id: 'u-prep-off', major: 'COSC', plan_ver: 'new', is_pro: true, prep: false },
    'u-prep-null':{ id: 'u-prep-null',major: 'COSC', plan_ver: 'new', is_pro: true },
  },
  completed: {
    'u-pro':  [{ course_code: 'ALIS 1211', grade: 'A' }, { course_code: 'MATH 1422', grade: 'F' },
               { course_code: 'COMM 1311', grade: 'W' }],
    'u-free': [{ course_code: 'ALIS 1211', grade: 'A' }],
    'u-other':[{ course_code: 'MEEN 2311', grade: 'A' }, { course_code: 'MEEN 2312', grade: 'B' }],
    /* الثلاثة عندهم مادة تحضيري منجزة — فالاستنتاج يقول «نعم» لهم كلهم.
       المحفوظة لازم تغلبه عند الأولين. */
    'u-prep-on':  [{ course_code: 'PRPC 0002', grade: 'A' }],
    'u-prep-off': [{ course_code: 'PRPC 0002', grade: 'A' }],
    'u-prep-null':[{ course_code: 'PRPC 0002', grade: 'A' }],
  },
  /* جدول الطالب وغيابه ومواعيده — ولصاحبنا وللطالب الثاني،
     حتى نثبت إن ولا صف من الثاني يتسرّب. */
  schedule: {
    'u-pro': [
      { user_id:'u-pro', slot:1, crn:'10001', course_code:'ALIS 1212', course_title:'Islamic Culture II',
        section:'01', course_date:'UT', course_timing:'08:00 - 08:50', room:'M-COBA - G034',
        instructor:'د. أحمد', term:'202710' },
      { user_id:'u-pro', slot:1, crn:'10002', course_code:'MATH 1422', course_title:'Calculus I',
        section:'02', course_date:'UT', course_timing:'10:00 - 10:50', room:'M-COBA - G040',
        instructor:'د. سارة', term:'202710' },
      { user_id:'u-pro', slot:1, crn:'10003', course_code:'COMM 1311', course_title:'Communication',
        section:'03', course_date:'MW', course_timing:'09:00 - 09:50', room:'M-COBA - G012',
        instructor:'د. خالد', term:'202710' },
      /* جدول ثانٍ — ما يظهر إلا لو طُلب */
      { user_id:'u-pro', slot:2, crn:'20001', course_code:'PHYS 1421', course_title:'Physics I',
        section:'01', course_date:'R', course_timing:'12:00 - 12:50', room:'M-SCI - 101',
        instructor:'د. نورة', term:'202710' },
    ],
    'u-other': [
      { user_id:'u-other', slot:1, crn:'90001', course_code:'MEEN 3311', course_title:'سرّ الطالب الثاني',
        section:'99', course_date:'MW', course_timing:'14:00 - 14:50', room:'F-ENG - 999',
        instructor:'د. لا أحد', term:'202710' },
    ],
  },
  absences: {
    'u-pro': [
      { user_id:'u-pro', term:'202710', crn:'10001', on_date:'2026-09-01' },
      { user_id:'u-pro', term:'202710', crn:'10001', on_date:'2026-09-08' },
      { user_id:'u-pro', term:'202710', crn:'10002', on_date:'2026-09-02' },
    ],
    'u-other': [{ user_id:'u-other', term:'202710', crn:'90001', on_date:'2026-09-01' }],
  },
  events: {
    'u-pro': [
      { user_id:'u-pro', term:'202710', crn:'10002', kind:'quiz',
        on_date:'2099-01-05', note:'الفصل الثالث' },
      { user_id:'u-pro', term:'202710', crn:'10001', kind:'assignment',
        on_date:'2099-01-02', note:null },
      { user_id:'u-pro', term:'202710', crn:'10003', kind:'project',
        on_date:'2000-01-01', note:'قديم — خارج النافذة' },
    ],
    'u-other': [{ user_id:'u-other', term:'202710', crn:'90001', kind:'quiz',
        on_date:'2099-01-05', note:'سرّ الطالب الثاني' }],
  },
  /* التقييمات عامة — مجهولة الكاتب. صف مخفي لازم ما يرجع. */
  reviews: [
    { user_id:'u-pro',  instructor_name:'د. أحمد', rating:5, course_code:'ALIS 1212',
      comment:'شرحه ممتاز', tags:['واضح','متعاون'], agree:3, disagree:0, hidden:false },
    { user_id:'u-other',instructor_name:'د. أحمد', rating:3, course_code:'ALIS 1212',
      comment:'الاختبارات صعبة', tags:['صعب'], agree:1, disagree:1, hidden:false },
    { user_id:'u-free', instructor_name:'د. أحمد', rating:1, course_code:'ALIS 1212',
      comment:'تعليق مخفي ما يرجع', tags:['سيء'], agree:0, disagree:9, hidden:true },
    { user_id:'u-other',instructor_name:'د. سارة', rating:4, course_code:'MATH 1422',
      comment:'ممتازة', tags:['واضح'], agree:2, disagree:0, hidden:false },
  ],
};
let SB_CALLS = [];
let PULLED = [];        /* كل نداء يسحب من الجامعة يُسجَّل هنا */

const ctxObj = {
  console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date,
  RegExp, Error, encodeURIComponent, setTimeout, Map, Set,
  get PULLED() { return PULLED },
  PLANS_DATA, ACAD_CAL,
  FREE_BETA: false,
  regTerm: () => '202710',
  riyadhNow: () => new Date('2099-01-01T09:00:00Z'),
  schedDays: v => String(v || '').toUpperCase().split('').filter(c => 'UMTWRFS'.includes(c)),
  schedTime: v => { const m = String(v || '').match(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/);
    return m ? { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] } : null },
  absAllowedFor: () => 4,          /* حد ثابت — منطقه مُختبَر في مكانه */
  activeTerm: () => '202710',
  FINALS_ON: true,
  coursesCache: new Map(),
  ROOM_INDEX: null,
  finalsCache: { M: null, F: null },
  /* لو أداة نادت واحدة من هذي فقد سحبت من الجامعة — نمسكها متلبّسة */
  getCourses: () => { PULLED.push('getCourses'); return Promise.resolve({ courses: [] }) },
  buildRoomIndex: () => { PULLED.push('buildRoomIndex'); return Promise.resolve(null) },
  fetchPage: () => { PULLED.push('fetchPage'); return Promise.resolve('') },
  freeRooms: (idx, o) => {
    const rooms = [...idx.rooms.entries()]
      .filter(([, r]) => !o.gender || r.gender === o.gender)
      .filter(([, r]) => !r.slots.some(s => s.day === o.day && s.start < o.to && s.end > o.from))
      .map(([name, r]) => ({ room: name, building: r.building, freeUntil: null }));
    return { total: rooms.length, rooms: rooms.slice(0, o.limit || 5) };
  },
  hasAccess: p => !!(p && p.is_pro),
  sb: (method, table, opt) => {
    SB_CALLS.push({ method, table, query: (opt && opt.query) || '' });
    const q = (opt && opt.query) || '';
    const m = /(?:id|user_id)=eq\.([^&]+)/.exec(q);
    const id = m ? decodeURIComponent(m[1]) : null;
    if (table === 'profiles') return Promise.resolve(DB.profiles[id] ? [DB.profiles[id]] : []);
    if (table === 'completed_courses') return Promise.resolve(DB.completed[id] || []);
    /* PostgREST الحقيقي يحترم order= — والمحاكي لازم يطابقه، وإلا مرّت
       أداة تعتمد على ترتيب ما يجي فعلاً في الإنتاج. */
    const ord = (/[?&]order=([a-z_]+)\.(asc|desc)/.exec(q) || []).slice(1);
    const sort = rows => {
      if (!ord.length) return rows;
      const [col, dir] = ord;
      return rows.slice().sort((x, y) => {
        const a = x[col], b = y[col];
        if (a === b) return 0;
        const r = (a > b ? 1 : -1);
        return dir === 'desc' ? -r : r;
      });
    };
    if (table === 'user_schedule') return Promise.resolve(sort(DB.schedule[id] || []));
    if (table === 'absences') return Promise.resolve(sort(DB.absences[id] || []));
    if (table === 'course_events') return Promise.resolve(sort(DB.events[id] || []));
    if (table === 'instructor_reviews') {
      /* PostgREST: ilike.*x* و hidden=is.false */
      const like = (/instructor_name=ilike\.\*([^*&]+)\*/.exec(q) || [])[1];
      const who = like ? decodeURIComponent(like) : '';
      let rows = DB.reviews.filter(r => !r.hidden);
      if (who) rows = rows.filter(r => String(r.instructor_name).includes(who));
      return Promise.resolve(sort(rows));
    }
    return Promise.resolve([]);
  },
};
vm.createContext(ctxObj);
vm.runInContext(REGION + '\nthis.aiStudentCtx=aiStudentCtx; this.aiRunTool=aiRunTool;'
  + 'this.aiToolSchemas=aiToolSchemas; this.AI_TOOLS=AI_TOOLS;', ctxObj);

const { aiStudentCtx, aiRunTool, aiToolSchemas, AI_TOOLS } = ctxObj;
ok(typeof aiRunTool === 'function', 'aiRunTool متاحة');

/* ═══ النموذج المزيّف: ينادي بالاسم ووسائط JSON ═══ */
function fakeModel(ctx) {
  return (name, argsJson) => aiRunTool(name, JSON.parse(argsJson || '{}'), ctx);
}

(async () => {
  /* ── المخططات: صالحة وجاهزة للنموذج ── */
  const schemas = aiToolSchemas();
  ok(schemas.length >= 10, 'فيه ١٠ أدوات فأكثر — ' + schemas.length);
  for (const s of schemas) {
    ok(!!s.name && !!s.description, `${s.name}: له اسم ووصف`);
    ok(s.input_schema && s.input_schema.type === 'object',
       `${s.name}: مخططه كائن`);
    ok(Array.isArray(s.input_schema.required), `${s.name}: required مصفوفة`);
    ok(['free', 'pro'].includes(s.tier), `${s.name}: حصته معروفة — ${s.tier}`);
    /* ولا مخطط يقبل معرّف مستخدم */
    const props = Object.keys(s.input_schema.properties || {});
    ok(!props.some(p => /user|uid|student|email/i.test(p)),
       `${s.name}: مخططه ما يطلب هوية — ${props.join(',')}`);
  }

  const PRO = await aiStudentCtx('u-pro');
  const FREE = await aiStudentCtx('u-free');
  const call = fakeModel(PRO), callFree = fakeModel(FREE);

  /* ── السياق يُقرأ من صفوف صاحب السؤال وحده ── */
  ok(PRO.profile && PRO.profile.id === 'u-pro', 'السياق لصاحب السؤال');
  ok(PRO.pro === true, 'صاحبنا مشترك');
  ok(FREE.pro === false, 'والثاني مجاني');
  ok(SB_CALLS.every(c => /u-pro|u-free/.test(c.query)),
     'ولا استعلام خرج عن صاحب السؤال — ' + SB_CALLS.map(c => c.table).join(','));
  ok(SB_CALLS.every(c => c.method === 'GET'), 'أدوات القراءة ما تكتب شيئاً');

  /* ── ١) الخصوصية: ما نقبل هوية من الوسائط ── */
  for (const k of ['user_id', 'userId', 'uid', 'student_id', 'email']) {
    const r = await call('plan_overview', JSON.stringify({ [k]: 'u-other' }));
    ok(!!r.error && /معرّف مستخدم/.test(r.error),
       `رفض الوسيط ${k} — ${JSON.stringify(r).slice(0, 70)}`);
  }
  /* وما ترجع بيانات الطالب الثاني بأي حال */
  const ov = await call('plan_overview', '{}');
  ok(ov.major === 'COSC', 'ملخص الخطة لتخصص صاحب السؤال لا غيره — ' + ov.major);
  ok(JSON.stringify(ov).indexOf('MEEN') < 0, 'ولا أثر لتخصص الطالب الثاني');

  /* ── وسيط غير معروف يُرفض بدل ما يُتجاهل ── */
  const bogus = await call('course_info', '{"code":"MATH 1422","secret":"x"}');
  ok(!!bogus.error && /وسيط غير معروف/.test(bogus.error), 'وسيط غريب يُرفض');

  /* ── وسيط مطلوب ناقص ── */
  const noArg = await call('course_info', '{}');
  ok(!!noArg.error && /ناقص وسيط/.test(noArg.error), 'وسيط مطلوب ناقص يُرفض');

  /* ── أداة غير معروفة ── */
  const nope = await call('drop_database', '{}');
  ok(!!nope.error && /غير معروفة/.test(nope.error), 'أداة غير معروفة تُرفض');

  /* ── ٢) لا اختراع ── */
  const ghost = await call('course_info', '{"code":"ZZZZ 9999"}');
  ok(ghost.known === false, 'مادة غير موجودة: known=false');
  ok(/ما لقيتها/.test(ghost.error || ''), 'وترجع «ما لقيتها» لا تخمين');
  ok(ghost.credits === undefined && ghost.prereqs === undefined,
     'وما تخترع ساعات ولا متطلبات');
  const ghost2 = await call('what_unlocks', '{"code":"ZZZZ 9999"}');
  ok(ghost2.known === false, 'what_unlocks لمادة مجهولة: known=false');
  const ghost3 = await call('course_offering', '{"code":"ZZZZ 9999"}');
  ok(ghost3.known === false, 'course_offering لمادة مجهولة: known=false');

  /* ── ٣) الحصة ── */
  for (const t of ['plan_overview', 'next_term_suggestion', 'retake_list', 'gpa']) {
    const r = await callFree(t, '{}');
    ok(!!r.error && r.tier === 'pro', `${t} ممنوعة على المجاني`);
  }
  for (const t of ['guide', 'academic_calendar', 'registration_calendar']) {
    const r = await callFree(t, '{}');
    ok(!r.error, `${t} متاحة للمجاني`);
  }
  /* المجاني يشوف معلومة المادة العامة بلا حالته الشخصية */
  const ci2 = await callFree('course_info', '{"code":"MATH 1422"}');
  ok(ci2.known === true && ci2.credits > 0, 'المجاني يشوف معلومة المادة العامة');
  ok(ci2.yourStatus === undefined, 'بلا حالته الشخصية');
  const ci3 = await call('course_info', '{"code":"MATH 1422"}');
  ok(!!ci3.yourStatus, 'والمشترك يشوف حالته');

  /* ── صحّة النواتج ── */
  {
    const r = await call('course_info', '{"code":"ALIS 1212"}');
    eq(r.prereqs, ['ALIS 1211'], 'متطلب ALIS 1212');
    ok(r.yourStatus.open === true, 'مفتوحة له — خلّص ALIS 1211 بتقدير A');

    const r2 = await call('course_info', '{"code":"MATH 1422"}');
    ok(r2.yourStatus.done === true && r2.yourStatus.passed === false,
       'MATH 1422: خلّصها لكن ما نجح (F)');
  }
  {
    const r = await call('retake_list', '{}');
    eq(r.count, 2, 'عنده مادتان للإعادة');
    const codes = r.courses.map(c => c.code).sort();
    eq(codes, ['COMM 1311', 'MATH 1422'], 'وهما الراسب والمنسحب');
    eq((r.courses.find(c => c.code === 'MATH 1422') || {}).reason, 'failed', 'سبب MATH 1422');
    eq((r.courses.find(c => c.code === 'COMM 1311') || {}).reason, 'withdrawn', 'سبب COMM 1311');
  }
  {
    const r = await call('gpa', '{}');
    ok(r.gpa !== null && r.gpa > 0, 'المعدل محسوب — ' + r.gpa);
    ok(r.projected === undefined, 'بلا whatIf ما فيه متوقّع');
    const r2 = await call('gpa', '{"whatIf":{"ALIS 1212":"A+"}}');
    ok(!!r2.projected && r2.projected.gpa >= r.gpa, 'تقدير عالٍ يرفع المتوقّع');
    ok(r2.projected.credits > r.gradedCredits, 'وساعات المتوقّع أكثر');
  }
  {
    const r = await call('what_unlocks', '{"code":"GEIT 1412"}');
    ok(r.known === true && r.count === 5, 'GEIT 1412 تفتح ٥ — ' + r.count);
    ok(r.unlocks.every(c => c.code && c.name), 'وترجع أسماءها لا عددها فقط');
  }
  {
    const r = await call('next_term_suggestion', '{}');
    ok(Array.isArray(r.critical), 'المقترح يرجع أساسية');
    ok(r.hours <= 20, 'بسقف ٢٠ ساعة — ' + r.hours);
    ok(r.critical.some(c => c.retake), 'وفيه الإعادة');
  }
  {
    const r = await call('plan_overview', '{}');
    ok(r.totalCredits > 0 && r.doneCredits >= 0, 'الساعات معقولة');
    eq(r.remainingCredits, r.totalCredits - r.doneCredits, 'المتبقي = الكل ناقص المنجز');
    ok(['Freshman', 'Sophomore', 'Junior', 'Senior'].includes(r.level), 'المستوى معروف');
    ok(typeof r.prepInferred === 'boolean', 'حالة التحضيري معلنة كاستنتاج');
  }
  {
    const r = await call('academic_calendar', '{"term":"202710"}');
    ok(Array.isArray(r.events) && r.events.length > 0, 'التقويم يرجع أحداثاً');
    ok(r.events.every(e => e.start && e.kind), 'لكل حدث تاريخ ونوع');
    const bad = await call('academic_calendar', '{"term":"209910"}');
    ok(!!bad.error, 'ترم غير موجود: «ما لقيتها» لا اختراع');
  }
  {
    const r = await call('registration_calendar', '{}');
    ok(Array.isArray(r.rows) && r.rows.length > 0, 'تقويم التسجيل يرجع مستويات');
    ok(r.rows.every(x => x.date && x.ar), 'لكل مستوى تاريخ واسم');
  }
  {
    const r = await callFree('guide', '{"lang":"ar"}');
    ok(!!r.title && Array.isArray(r.sections) && r.sections.length > 0, 'الدليل يرجع أقسامه');
    const en = await callFree('guide', '{"lang":"en"}');
    ok(en.title !== r.title, 'والإنجليزي مختلف عن العربي');
  }
  {
    /* الطرح: الميكانيكال له جدول، وغيره لا */
    const OTHER = await aiStudentCtx('u-other');
    const co = await fakeModel(OTHER)('course_offering', '{"code":"MEEN 2311"}');
    ok(co.known === true, 'مادة ميكانيكال معروفة لطالب ميكانيكال');
    const mine = await call('course_offering', '{"code":"ALIS 1211"}');
    ok(mine.known === true && mine.status === 'ok', 'تخصص بلا جدول طرح: بلا تحذير');
  }

  /* ── ولا أداة تكتب في القاعدة ── */
  ok(SB_CALLS.every(c => c.method === 'GET'),
     'بعد كل الاستدعاءات: ولا كتابة — ' + [...new Set(SB_CALLS.map(c => c.method))].join(','));

  /* ── ولا أداة تسحب من الجامعة ── */
  ok(!/masterschedule|getData/.test(REGION), 'ولا أداة تسحب من موقع الجامعة');

  /* ── ٤) التحضيري: المحفوظة تغلب الاستنتاج ── */
  {
    const ON = await aiStudentCtx('u-prep-on');
    const OFF = await aiStudentCtx('u-prep-off');
    const NUL = await aiStudentCtx('u-prep-null');

    /* الثلاثة عندهم PRPC 0002 منجزة، فالاستنتاج وحده يقول «نعم» لهم كلهم */
    ok(ON.prep === true, 'محفوظة true ⇒ التحضيري شغّال');
    ok(ON.prepInferred === false, 'وprepInferred خاطئة — القيمة محفوظة لا مستنتَجة');

    ok(OFF.prep === false, 'محفوظة false ⇒ مطفأ، رغم إن عنده مادة تحضيري منجزة');
    ok(OFF.prepInferred === false, 'وprepInferred خاطئة كذلك');

    ok(NUL.prep === true, 'بلا قيمة ⇒ نستنتج من المواد المنجزة');
    ok(NUL.prepInferred === true, 'وprepInferred صادقة هنا وحدها');

    /* الأثر الحقيقي: التحضيري يغيّر عدد فصول الخطة */
    ok(ON.plan.sems.length > OFF.plan.sems.length,
       `التحضيري يزيد الفصول — شغّال ${ON.plan.sems.length} · مطفأ ${OFF.plan.sems.length}`);
    ok(NUL.plan.sems.length === ON.plan.sems.length,
       'والمستنتَج «نعم» يعطي نفس فصول المحفوظة «نعم»');

    /* وتظهر في الأداة */
    const povOn = await fakeModel(ON)('plan_overview', '{}');
    eq([povOn.prep, povOn.prepInferred], [true, false], 'plan_overview للمحفوظة');
    const povNul = await fakeModel(NUL)('plan_overview', '{}');
    eq([povNul.prep, povNul.prepInferred], [true, true], 'plan_overview للمستنتَجة');

    /* طالب بلا مواد تحضيري وبلا قيمة ⇒ مستنتَج «لا» */
    DB.profiles['u-fresh'] = { id: 'u-fresh', major: 'COSC', plan_ver: 'new', is_pro: true };
    DB.completed['u-fresh'] = [{ course_code: 'ALIS 1211', grade: 'A' }];
    const FRESH = await aiStudentCtx('u-fresh');
    ok(FRESH.prep === false && FRESH.prepInferred === true,
       'طالب بلا مواد تحضيري وبلا قيمة: مستنتَج «لا»');
  }

  /* ── ٥) أدوات بيانات الطالب ── */
  /* لو الأدوات مو موجودة بعد (كود قديم) نبلّغ فشلاً مرتّباً بدل انهيار */
  if (!AI_TOOLS.my_schedule) {
    for (const t of ['my_schedule', 'my_day', 'my_absences', 'my_appointments'])
      ok(false, `${t} موجودة في السجل`);
  } else {
    /* الجدول */
    const sc = await call('my_schedule', '{}');
    eq(sc.count, 3, 'الجدول الأول فيه ٣ مواد');
    ok(sc.courses.every(c => c.code && c.time), 'لكل مادة كود ووقت');
    ok(JSON.stringify(sc).indexOf('سرّ الطالب الثاني') < 0,
       'ولا أثر لجدول الطالب الثاني');
    ok(JSON.stringify(sc).indexOf('90001') < 0, 'ولا CRN من الثاني');

    const sc2 = await call('my_schedule', '{"slot":2}');
    eq(sc2.count, 1, 'الجدول الثاني فيه مادة وحدة');
    eq(sc2.courses[0].code, 'PHYS 1421', 'وهي مادة الجدول الثاني');

    /* اليوم والفراغات — الأحد فيه محاضرتان بينهما فراغ */
    const d = await call('my_day', '{"day":"U"}');
    eq(d.count, 2, 'الأحد فيه محاضرتان');
    eq(d.lectures.map(x => x.code), ['ALIS 1212', 'MATH 1422'], 'بالترتيب الزمني');
    eq(d.firstAt, '08:00', 'أول محاضرة ٨:٠٠');
    eq(d.lastEndsAt, '10:50', 'وآخرها تنتهي ١٠:٥٠');
    eq(d.gaps.length, 1, 'بينهما فراغ واحد');
    eq(d.gaps[0].minutes, 70, 'طوله ٧٠ دقيقة — من ٨:٥٠ إلى ١٠:٠٠');
    eq([d.gaps[0].from, d.gaps[0].to], ['08:50', '10:00'], 'بحدوده');
    eq(d.onCampusMinutes, 170, 'ومدة بقائه في الحرم ١٧٠ دقيقة');

    const d2 = await call('my_day', '{"day":"M"}');
    eq(d2.count, 1, 'الاثنين محاضرة وحدة');
    eq(d2.gaps.length, 0, 'بلا فراغات');

    const d3 = await call('my_day', '{"day":"S"}');
    eq(d3.count, 0, 'السبت فاضي');
    ok(/ما فيه محاضرات/.test(d3.note || ''), 'ويقولها صراحة');

    const dBad = await call('my_day', '{"day":"Z"}');
    ok(!!dBad.error, 'يوم غير معروف يُرفض');

    /* الغياب */
    const ab = await call('my_absences', '{}');
    eq(ab.count, 3, 'الغياب يغطي مواد الجدول الثلاث');
    const a1 = ab.courses.find(c => c.code === 'ALIS 1212');
    eq([a1.absences, a1.allowed, a1.remaining], [2, 4, 2], 'ALIS 1212: غابَ ٢ من ٤');
    ok(a1.atRisk === false, 'وما وصل الحرمان');
    const a3 = ab.courses.find(c => c.code === 'COMM 1311');
    eq(a3.absences, 0, 'COMM 1311: ولا غياب');
    ok(/إرشادي/.test(ab.note || ''), 'ومعها تنبيه إن الحساب إرشادي');
    ok(JSON.stringify(ab).indexOf('90001') < 0, 'ولا غياب من الطالب الثاني');

    const abOne = await call('my_absences', '{"code":"ALIS 1212"}');
    eq(abOne.count, 1, 'الفلترة بمادة تشتغل');
    const abGhost = await call('my_absences', '{"code":"ZZZZ 9999"}');
    ok(abGhost.known === false, 'مادة مو في جدوله: «ما لقيتها»');

    /* المواعيد */
    const ap = await call('my_appointments', '{"days":400}');
    ok(ap.count >= 2, 'المواعيد القادمة ترجع — ' + ap.count);
    ok(ap.appointments.every(x => x.date >= ap.from), 'كلها في المستقبل');
    ok(!ap.appointments.some(x => x.date === '2000-01-01'), 'والقديم ما يرجع');
    eq(ap.appointments[0].kind, 'assignment', 'أقربها أولاً');
    ok(ap.appointments.every(x => x.code), 'ولكل موعد كود مادته من جدوله');
    ok(JSON.stringify(ap).indexOf('سرّ الطالب الثاني') < 0,
       'ولا موعد من الطالب الثاني');

    const apOne = await call('my_appointments', '{"days":400,"code":"MATH 1422"}');
    ok(apOne.appointments.every(x => x.code === 'MATH 1422'), 'الفلترة بمادة تشتغل');

    /* الحصة: كلها للمشتركين */
    for (const t of ['my_schedule', 'my_day', 'my_absences', 'my_appointments']) {
      const args = t === 'my_day' ? '{"day":"U"}' : '{}';
      const r = await callFree(t, args);
      ok(!!r.error && r.tier === 'pro', `${t} ممنوعة على المجاني`);
    }

    /* الطالب الثاني يشوف صفوفه هو */
    const OTHER = await aiStudentCtx('u-other');
    const osc = await fakeModel(OTHER)('my_schedule', '{}');
    eq(osc.count, 1, 'الطالب الثاني يشوف جدوله هو');
    ok(JSON.stringify(osc).indexOf('ALIS 1212') < 0, 'وما يشوف جدول صاحبنا');
  }

  /* ── ٦) أدوات الكاش — ولا سحبة من الجامعة ── */
  if (!AI_TOOLS.sections) {
    for (const t of ['sections', 'instructor_reviews', 'free_rooms', 'finals', 'schedule_changes'])
      ok(false, `${t} موجودة في السجل`);
  } else {
    /* ٦أ) الكاش بارد: تقول «مو جاهزة» ولا تسحب */
    PULLED = [];
    const cold = await callFree('sections', '{"code":"MATH 1422"}');
    ok(cold.available === false, 'الكاش بارد ⇒ available:false');
    ok(/مو جاهزة/.test(cold.error || ''), 'وترجع رسالة واضحة');
    eq(PULLED, [], 'ولا سحبة من الجامعة — ' + PULLED.join(','));

    const coldRooms = await callFree('free_rooms', '{"day":"U","from":500,"to":600}');
    ok(coldRooms.available === false, 'القاعات والكاش بارد ⇒ غير متاحة');
    const coldFinals = await callFree('finals', '{"code":"MATH 1422"}');
    ok(coldFinals.available === false, 'النهائيات والكاش بارد ⇒ غير متاحة');
    eq(PULLED, [], 'وبعد الثلاثة: ولا سحبة واحدة');

    /* ٦ب) نسخّن الكاش بأيدينا — كما تسخّنه الدورة */
    ctxObj.coursesCache.set('202710|ALL|M1', { at: Date.now(), courses: [
      { crn:'10002', courseCode:'MATH 1422', courseTitle:'Calculus I', section:'02',
        instructor:'د. سارة', courseDate:'UT', courseTiming:'10:00 - 10:50',
        room:'M-COBA - G040', status:'OPEN', seats:5 },
      { crn:'10009', courseCode:'MATH 1422', courseTitle:'Calculus I', section:'09',
        instructor:'د. سارة', courseDate:'MW', courseTiming:'08:00 - 08:50',
        room:'M-COBA - G041', status:'CLOSE', seats:0 },
      { crn:'10001', courseCode:'ALIS 1212', courseTitle:'Islamic Culture II', section:'01',
        instructor:'د. أحمد', courseDate:'UT', courseTiming:'08:00 - 08:50',
        room:'M-COBA - G034', status:'OPEN', seats:12 },
    ] });

    PULLED = [];
    const sec = await callFree('sections', '{"code":"MATH 1422"}');
    eq(sec.found, 2, 'شعبتان لـMATH 1422');
    eq(sec.sections.map(x => x.crn).sort(), ['10002', '10009'], 'بالأرقام الصحيحة');
    ok(sec.cacheAgeMin >= 0, 'ومعها عمر الكاش — ' + sec.cacheAgeMin);
    eq(PULLED, [], 'ولا سحبة رغم إن الكاش دافئ');

    const open = await callFree('sections', '{"code":"MATH 1422","openOnly":true}');
    eq(open.found, 1, 'المفتوحة فقط: وحدة');
    eq(open.sections[0].crn, '10002', 'وهي المفتوحة');

    const byWho = await callFree('sections', '{"instructor":"سارة"}');
    eq(byWho.found, 2, 'البحث بالدكتور يرجع شعبه');

    const ghostSec = await callFree('sections', '{"code":"ZZZZ 9999"}');
    eq(ghostSec.found, 0, 'مادة مجهولة: صفر');
    ok(/ما لقيتها/.test(ghostSec.note || ''), 'وتقولها صراحة لا تخترع');
    ok(!!(await callFree('sections', '{}')).error, 'بلا كود ولا دكتور: يُرفض');

    /* ٦ج) كاش قديم جداً = غير متاح */
    ctxObj.coursesCache.set('202710|ALL|M1',
      { at: Date.now() - 20 * 60 * 60 * 1000, courses: [{ crn:'1', courseCode:'X 1111' }] });
    const stale = await callFree('sections', '{"code":"X 1111"}');
    ok(stale.available === false, 'كاش عمره ٢٠ ساعة ⇒ غير متاح');
    ok(stale.staleMin > 600, 'ويقول كم عمره — ' + stale.staleMin);
    eq(PULLED, [], 'وما سحب ليجدّده');

    /* ٦د) التقييمات — ملخّص مجهول الكاتب */
    const rv = await callFree('instructor_reviews', '{"instructor":"أحمد"}');
    eq(rv.found, 2, 'تقييمان ظاهران لـد. أحمد (المخفي ما رجع)');
    const A = rv.instructors[0];
    eq(A.average, 4, 'المتوسط ٤ — (٥+٣)÷٢');
    eq(A.reviews, 2, 'وعددها ٢');
    ok(A.comments.length === 2, 'ومعها التعليقات');
    ok(!/تعليق مخفي/.test(JSON.stringify(rv)), 'التقييم المخفي ما يرجع إطلاقاً');
    ok(!/u-pro|u-other|u-free|user_id/.test(JSON.stringify(rv)),
       'ولا هوية كاتب — التقييم مجهول');
    ok(/رأيهم لا رأينا/.test(rv.note || ''), 'ومعها إنها ملخّص لا حكم جديد');
    ok(A.topTags.length > 0 && A.topTags[0].tag, 'والوسوم معدودة');
    const rvGhost = await callFree('instructor_reviews', '{"instructor":"لا أحد أبداً"}');
    eq(rvGhost.found, 0, 'دكتور بلا تقييمات: «ما لقيتها»');
    ok(!!(await callFree('instructor_reviews', '{"instructor":"ا"}')).error,
       'اسم قصير جداً يُرفض');

    /* ٦هـ) القاعات الفاضية — من فهرس مبني مسبقاً */
    ctxObj.ROOM_INDEX = { at: Date.now(), rooms: new Map([
      ['M-COBA - G034', { gender:'M', building:'COBA', zone:'M-COBA',
        slots:[{ day:'U', start:480, end:530 }] }],
      ['M-COBA - G099', { gender:'M', building:'COBA', zone:'M-COBA',
        slots:[{ day:'M', start:480, end:530 }] }],
    ]) };
    PULLED = [];
    /* نافذة ٩:٠٠–١٠:٠٠ الأحد: محاضرة G034 خلصت ٨:٥٠، فالقاعتان فاضيتان */
    const fr = await callFree('free_rooms', '{"day":"U","from":540,"to":600}');
    eq(fr.total, 2, 'بعد ٨:٥٠ القاعتان فاضيتان');
    ok(fr.rooms.some(r => r.room === 'M-COBA - G034'),
       'وG034 منها — محاضرتها خلصت، والتقاطع بالدقيقة لا بالساعة');

    /* نافذة ٨:٢٠–٩:٠٠ تتداخل مع محاضرة G034 فتُستبعد */
    const fr2 = await callFree('free_rooms', '{"day":"U","from":500,"to":540}');
    ok(!fr2.rooms.some(r => r.room === 'M-COBA - G034'), 'وأثناء محاضرتها تُستبعد');
    ok(fr2.rooms.some(r => r.room === 'M-COBA - G099'), 'وG099 فاضية — محاضرتها الاثنين');
    eq(PULLED, [], 'ولا سحبة — ما نادينا buildRoomIndex');
    ok(!!(await callFree('free_rooms', '{"day":"Z","from":1,"to":2}')).error, 'يوم غلط يُرفض');
    ok(!!(await callFree('free_rooms', '{"day":"U","from":600,"to":500}')).error,
       'نافذة مقلوبة تُرفض');

    /* ٦و) النهائيات */
    ctxObj.finalsCache.M = { at: Date.now(), exams: [
      { crn:'10002', code:'MATH 1422', title:'Calculus I', section:'02',
        instructor:'د. سارة', building:'COBA', room:'G040',
        day:'Sunday', date:'2099-01-20', hour:'08:00', gender:'M' },
      { crn:'10001', code:'ALIS 1212', title:'Islamic Culture II', section:'01',
        instructor:'د. أحمد', building:'COBA', room:'G034',
        day:'Monday', date:'2099-01-21', hour:'10:00', gender:'M' },
    ] };
    PULLED = [];
    const fin = await callFree('finals', '{"code":"MATH 1422"}');
    eq(fin.count, 1, 'نهائي MATH 1422 موجود');
    eq(fin.exams[0].date, '2099-01-20', 'بتاريخه');
    eq(PULLED, [], 'ولا سحبة — ما نادينا fetchPage');
    const finCrn = await callFree('finals', '{"crn":"10001"}');
    eq(finCrn.count, 1, 'والبحث بالشعبة يشتغل');
    const finGhost = await callFree('finals', '{"code":"ZZZZ 9999"}');
    eq(finGhost.count, 0, 'مادة بلا نهائي: صفر لا اختراع');

    /* mine: نهائيات جدوله — للمشتركين */
    const finMineFree = await callFree('finals', '{"mine":true}');
    ok(finMineFree.tier === 'pro', 'finals mine ممنوعة على المجاني');
    const finMine = await call('finals', '{"mine":true}');
    eq(finMine.scope, 'mine', 'نهائيات جدوله');
    eq(finMine.count, 2, 'مادتان من جدوله لهما نهائي');
    ok(finMine.missing.includes('COMM 1311'), 'والثالثة بلا نهائي معروف — تُذكر صراحة');

    /* ٦ز) تغيّرات الجامعة على جدوله */
    DB.schedule['u-pro'][0].changed_at = '2026-09-10T10:00:00Z';
    DB.schedule['u-pro'][0].change_note = { at: 1, fields: ['room', 'instructor'] };
    DB.schedule['u-pro'][2].missing_since = '2026-09-11T10:00:00Z';
    const ch = await call('schedule_changes', '{}');
    eq(ch.count, 2, 'تغيّران على جدوله');
    const c1 = ch.changes.find(x => x.code === 'ALIS 1212');
    eq(c1.fields, ['room', 'instructor'], 'وش تغيّر بالضبط');
    ok(c1.gone === false, 'وهي ما اختفت');
    const c2 = ch.changes.find(x => x.code === 'COMM 1311');
    ok(c2.gone === true, 'والثانية اختفت من جدول الجامعة');
    ok(JSON.stringify(ch).indexOf('90001') < 0, 'ولا تغيّر من الطالب الثاني');
    ok(!!(await callFree('schedule_changes', '{}')).tier, 'وممنوعة على المجاني');

    /* ٦ح) الخلاصة: ولا أداة سحبت من الجامعة في كل الجولة */
    eq(PULLED, [], 'بعد كل أدوات الكاش: ولا سحبة — ' + PULLED.join(','));
  }

  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('  ✗ انهار: ' + e.message);
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
