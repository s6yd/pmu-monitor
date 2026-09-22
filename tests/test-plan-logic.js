/* منطق الخطة المشترك — اختبار.
   الدوال انتقلت من pmu-schedule.html إلى shared/plans.js عشان الصفحة
   والمساعد يحسبان بنفسها. خطران: (١) نسخة ثانية تبقى في الصفحة فتنحرف
   الحسبتان بصمت — نفس ما صار في التقويم قبل توحيده؛ (٢) دالة تعتمد على
   متغيّر عام فما تشتغل في Node. الاثنان مغطّيان هنا.

   node tests/test-plan-logic.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ROOT = path.dirname(SRV);
const SHARED = path.join(ROOT, 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

let L = null;
try { L = require(SHARED) } catch (e) { console.log('  ✗ تعذّر require: ' + e.message) }
ok(!!L, 'shared/plans.js يُقرأ في Node');
if (!L) { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(1) }

/* ═══ ١. الدوال تشتغل في Node بلا أي متغيّر صفحة ═══ */
const MOVED = ['hasAltPlan', 'planKey', 'planOf', 'prepSems', 'semesters', 'ctxOf',
  'allPlanCourses', 'findPlanCourse', 'failGrades', 'isFailed', 'isWithdrawn',
  'isDone', 'isPassed', 'doneCredits', 'level', 'prepGate', 'prepLevelLock',
  'prereqCheck', 'creditsOf', 'unlocksCount', 'unlockedBy', 'isInternship',
  'currentPrepSem', 'retakeList', 'calcGPA', 'calcProjected'];
for (const f of MOVED) ok(typeof L[f] === 'function', `${f} مُصدَّرة ودالة`);

const CONSTS = ['PREP_MATH', 'PREP_MATH_NAME', 'PREP_EXIT', 'PREP_GATE_LANG',
  'PREP_GATE_MATH', 'FAIL_GRADES', 'FAIL_GRADES_C', 'WITHDRAW_GRADES',
  'GRADE_POINTS', 'GRADE_SKIP', 'INTERN_MIN_CREDITS'];
for (const c of CONSTS) ok(L[c] !== undefined, `${c} مُصدَّر`);

/* ═══ ٢. حالات معروفة ═══
   لو المنطق مو منقولاً بعد (كود قديم) نتخطّى الحالات السلوكية ونكمل
   للفحص الثابت — نبلّغ فشلاً مرتّباً لا انهياراً، وrun-all.sh يشوف
   سطر الملخص. */
const HAVE = MOVED.every(f => typeof L[f] === 'function');
if (!HAVE) console.log('  ⚠︎ المنطق غير منقول — تخطّي الحالات السلوكية');

const base = { major: 'COSC', planVer: 'new', prep: false, completed: [], grades: {} };
const C = o => L.ctxOf(Object.assign({}, base, o || {}));

if (HAVE) {

/* المستوى — الحدود بالضبط */
eq(L.level(0), 'Freshman', 'level(0)');
eq(L.level(29), 'Freshman', 'level(29) — تحت الحد');
eq(L.level(30), 'Sophomore', 'level(30) — عند الحد');
eq(L.level(59), 'Sophomore', 'level(59)');
eq(L.level(60), 'Junior', 'level(60) — عند الحد');
eq(L.level(89), 'Junior', 'level(89)');
eq(L.level(90), 'Senior', 'level(90) — عند الحد');
eq(L.level(200), 'Senior', 'level(200)');

/* متطلب سابق: ALIS 1212 يشترط ALIS 1211 */
{
  const empty = C();
  const r0 = L.prereqCheck(empty, 'ALIS 1212');
  ok(r0.known === true, 'ALIS 1212 معروفة في الخطة');
  ok(r0.ok === false, 'ALIS 1212 مقفلة بلا متطلبها');
  eq(r0.missing, ['ALIS 1211'], 'الناقص هو ALIS 1211');

  const done = C({ completed: ['ALIS 1211'], grades: { 'ALIS 1211': 'A' } });
  ok(L.prereqCheck(done, 'ALIS 1212').ok === true, 'تنفتح بعد اجتياز متطلبها');

  /* رسوب في المتطلب لا يفتحها */
  const failed = C({ completed: ['ALIS 1211'], grades: { 'ALIS 1211': 'F' } });
  ok(L.prereqCheck(failed, 'ALIS 1212').ok === false, 'الرسوب في المتطلب لا يفتحها');
  eq(L.prereqCheck(failed, 'ALIS 1212').missing, ['ALIS 1211'], 'ويبقى في الناقص');

  /* انسحاب كذلك */
  const wd = C({ completed: ['ALIS 1211'], grades: { 'ALIS 1211': 'W' } });
  ok(L.prereqCheck(wd, 'ALIS 1212').ok === false, 'الانسحاب من المتطلب لا يفتحها');

  /* D رسوب في الخطة العادية */
  const dGrade = C({ completed: ['ALIS 1211'], grades: { 'ALIS 1211': 'D' } });
  ok(L.isFailed(dGrade, 'ALIS 1211') === true, 'D رسوب');
  ok(L.isPassed(dGrade, 'ALIS 1211') === false, 'وD ما ينجح');
  ok(L.isDone(dGrade, 'ALIS 1211') === true, 'لكنه «خلّصها» للعرض');

  /* D+ نجاح في الخطة العادية */
  const dp = C({ completed: ['ALIS 1211'], grades: { 'ALIS 1211': 'D+' } });
  ok(L.isFailed(dp, 'ALIS 1211') === false, 'D+ نجاح في الخطة العادية');
}

/* مادة مجهولة */
{
  const r = L.prereqCheck(C(), 'ZZZZ 9999');
  eq([r.known, r.ok], [false, true], 'مادة خارج الخطة: غير معروفة وغير مقفلة');
}

/* الساعات المنجزة — تستثني الراسب والمنسحب */
{
  const all = L.allPlanCourses(C());
  const f1 = all.filter(c => c.sem === 'F1');
  const codes = f1.map(c => c.c);
  const sum = f1.reduce((a, c) => a + c.h, 0);

  const allPass = C({ completed: codes, grades: Object.fromEntries(codes.map(c => [c, 'A'])) });
  eq(L.doneCredits(allPass), sum, 'مجموع ساعات الترم الأول كاملاً');

  const g = Object.fromEntries(codes.map(c => [c, 'A']));
  g[codes[0]] = 'F';
  const oneFail = C({ completed: codes, grades: g });
  eq(L.doneCredits(oneFail), sum - f1[0].h, 'الراسب لا يُحتسب في الساعات');

  const g2 = Object.fromEntries(codes.map(c => [c, 'A']));
  g2[codes[0]] = 'W';
  eq(L.doneCredits(C({ completed: codes, grades: g2 })), sum - f1[0].h,
     'المنسحب لا يُحتسب في الساعات');
}

/* كم مادة تفتح */
{
  const empty = C();
  const n = L.unlocksCount(empty, 'GEIT 1412');
  ok(n === 5, 'GEIT 1412 تفتح ٥ مواد — فتحت ' + n);
  eq(L.unlockedBy(empty, 'GEIT 1412').length, n, 'unlockedBy يطابق unlocksCount');
  ok(L.unlockedBy(empty, 'GEIT 1412').every(c => (c.p || []).includes('GEIT 1412')),
     'وكل مادة راجعة فعلاً متطلبها GEIT 1412');

  /* مادة مكتملة لا تُعد ضمن ما ينفتح */
  const opened = L.unlockedBy(empty, 'GEIT 1412')[0].c;
  const after = C({ completed: [opened], grades: { [opened]: 'A' } });
  ok(L.unlocksCount(after, 'GEIT 1412') === n - 1,
     'المادة اللي خلصها الطالب ما تنعد ضمن ما ينفتح');
}

/* ساعات المادة */
{
  const ctx = C();
  const pc = L.findPlanCourse(ctx, 'MATH 1422');
  eq(L.creditsOf(ctx, 'MATH 1422'), pc.h, 'ساعات مادة من الخطة');
  /* خارج الخطة: الرقم الثاني في الكود */
  eq(L.creditsOf(ctx, 'XXXX 1311'), 3, 'خارج الخطة: الرقم الثاني (3)');
  eq(L.creditsOf(ctx, 'XXXX 1411'), 4, 'خارج الخطة: الرقم الثاني (4)');
  eq(L.creditsOf(ctx, 'XXXX 9999'), 3, 'رقم ثانٍ خارج ١–٦ ← ٣ افتراضياً');
}

/* المعدل */
{
  const ctx = C({ completed: ['MATH 1422', 'ALIS 1211'],
                  grades: { 'MATH 1422': 'A+', 'ALIS 1211': 'C' } });
  const h1 = L.creditsOf(ctx, 'MATH 1422'), h2 = L.creditsOf(ctx, 'ALIS 1211');
  const want = (4.00 * h1 + 2.00 * h2) / (h1 + h2);
  const r = L.calcGPA(ctx);
  ok(Math.abs(r.gpa - want) < 1e-9, `المعدل = ${want.toFixed(4)} — جانا ${r.gpa}`);
  eq(r.hrs, h1 + h2, 'ساعات المعدل');
  eq(r.n, 2, 'عدد المواد المحسوبة');

  /* تقدير خارج جدول النقاط لا يُحسب */
  const skip = C({ completed: ['MATH 1422', 'ALIS 1211'],
                   grades: { 'MATH 1422': 'A+', 'ALIS 1211': 'TR' } });
  eq(L.calcGPA(skip).n, 1, 'TR لا تدخل المعدل');

  /* درجة بلا إكمال لا تُحسب */
  const notDone = C({ completed: [], grades: { 'MATH 1422': 'A+' } });
  eq(L.calcGPA(notDone).n, 0, 'درجة لمادة غير مكتملة لا تُحسب');

  /* مادة خارج الخطة لا تُحسب */
  const outside = C({ completed: ['ZZZZ 9999'], grades: { 'ZZZZ 9999': 'A+' } });
  eq(L.calcGPA(outside).n, 0, 'مادة خارج الخطة لا تدخل المعدل');

  /* المعدل الفارغ */
  eq(L.calcGPA(C()).gpa, null, 'بلا درجات: المعدل null');
}

/* «ماذا لو» */
{
  const ctx = C({ completed: ['MATH 1422'], grades: { 'MATH 1422': 'C' } });
  const b = L.calcGPA(ctx);
  const p = L.calcProjected(ctx, { 'ALIS 1211': 'A+' });
  ok(p.gpa > b.gpa, 'تقدير عالٍ لمادة قادمة يرفع المتوقّع');
  eq(p.hrs, b.hrs + L.creditsOf(ctx, 'ALIS 1211'), 'ساعات المتوقّع تزيد بساعات المادة');
  /* تقدير لمادة خلصها فعلاً يُتجاهل */
  const ignored = L.calcProjected(ctx, { 'MATH 1422': 'A+' });
  eq([ignored.gpa, ignored.hrs], [b.gpa, b.hrs], 'تقدير لمادة مكتملة يُتجاهل');
  /* بلا تقديرات = المعدل نفسه */
  eq(L.calcProjected(ctx, {}).gpa, b.gpa, 'بلا تقديرات: المتوقّع = الحالي');
  eq(L.calcProjected(ctx, null).gpa, b.gpa, 'whatIf ناقصة لا تنهار');
}

/* المواد اللي لازم تنعاد */
{
  const ctx = C({ completed: ['MATH 1422', 'ALIS 1211', 'COMM 1311'],
                  grades: { 'MATH 1422': 'F', 'ALIS 1211': 'W', 'COMM 1311': 'A' } });
  const r = L.retakeList(ctx);
  eq(r.map(x => x.c).sort(), ['ALIS 1211', 'MATH 1422'], 'الراسب والمنسحب فقط');
  eq((r.find(x => x.c === 'MATH 1422') || {}).why, 'failed', 'سبب MATH 1422: رسوب');
  eq((r.find(x => x.c === 'ALIS 1211') || {}).why, 'withdrawn', 'سبب ALIS 1211: انسحاب');
  eq(L.retakeList(C()).length, 0, 'طالب جديد: ما عليه إعادة');
}

/* التحضيري */
{
  const off = C({ prep: false });
  eq(L.prepGate(off, 'COMM 1311'), [], 'بلا تحضيري: ما فيه بوابة');
  eq(L.currentPrepSem(off), null, 'بلا تحضيري: ما فيه مستوى حالي');

  const on = C({ prep: true });
  eq(L.prepGate(on, 'COMM 1311'), [L.PREP_EXIT], 'مادة لغة تشترط اختبار الخروج');
  eq(L.prepGate(on, 'MATH 1422'), [L.PREP_MATH.COSC], 'مادة رياضيات تشترط رياضيات التحضيري');
  eq(L.prepGate(on, 'CSCI 1401'), [], 'مادة غير مقيّدة: بلا بوابة');
  eq((L.currentPrepSem(on) || {}).id, 'PP1', 'أول مستوى تحضيري هو PP1');

  /* التحضيري متسلسل */
  const pp1 = L.prepSems('COSC')[0].courses.map(c => c.c);
  const afterPP1 = C({ prep: true, completed: pp1,
                       grades: Object.fromEntries(pp1.map(c => [c, 'A'])) });
  eq((L.currentPrepSem(afterPP1) || {}).id, 'PP2', 'بعد PP1 يصير الحالي PP2');
  const lock = L.prepLevelLock(afterPP1, L.prepSems('COSC')[2].courses[0].c);
  ok(lock && lock.id === 'PP2', 'PP3 مقفل بـPP2 — رجع ' + JSON.stringify(lock));
  ok(L.prepLevelLock(afterPP1, pp1[0]) === null, 'المستوى الأول غير مقفل');
  ok(L.prepLevelLock(C({ prep: false }), 'PRPC 0041') === null,
     'بلا تحضيري: ولا قفل مستوى');

  /* رياضيات التحضيري تتغيّر بالتخصص */
  ok(L.PREP_MATH.COSC !== L.PREP_MATH.BUSI, 'رياضيات التحضيري تختلف بين هندسي وإداري');
  eq(L.prepSems('BUSI')[3].courses.some(c => c.c === L.PREP_MATH.BUSI), true,
     'المستوى المتقدم فيه رياضيات التخصص');
}

/* نسخة الخطة */
{
  ok(L.hasAltPlan('MEEN') === true, 'MEEN لها خطة قديمة');
  ok(L.hasAltPlan('COSC') === false, 'COSC ما لها خطة قديمة');
  eq(L.planKey('MEEN', 'old'), 'MEEN_OLD', 'planKey يختار القديمة');
  eq(L.planKey('MEEN', 'new'), 'MEEN', 'planKey يختار الجديدة');
  eq(L.planKey('COSC', 'old'), 'COSC', 'تخصص بلا بديل يبقى على نفسه');
  const a = L.planOf('MEEN', 'old'), b = L.planOf('MEEN', 'new');
  ok(a !== b, 'نسختا MEEN مختلفتان');
  ok(L.semesters('COSC', 'new', true).length > L.semesters('COSC', 'new', false).length,
     'تفعيل التحضيري يزيد الفصول');
  eq(L.semesters('COSC', 'new', true).slice(0, 4).map(s => s.id),
     ['PP1', 'PP2', 'PP3', 'PP4'], 'التحضيري يجي أولاً');
}

/* التطبيق العملي */
{
  ok(L.isInternship({ c: 'COOP 4399', n: 'Co-op Training' }) === true, 'يعرف التطبيق العملي');
  ok(L.isInternship({ c: 'CSCI 1401', n: 'Programming I' }) === false, 'مادة عادية مو تطبيقاً');
  ok(L.isInternship({}) === false, 'كائن فاضٍ لا ينهار');
}

/* كل تخصص: الدوال تشتغل بلا انهيار */
{
  let bad = 0;
  for (const code of Object.keys(L.PLANS)) {
    for (const ver of ['new', 'old']) {
      for (const prep of [false, true]) {
        try {
          const ctx = L.ctxOf({ major: code, planVer: ver, prep, completed: [], grades: {} });
          const all = L.allPlanCourses(ctx);
          all.forEach(c => { L.prereqCheck(ctx, c.c); L.unlocksCount(ctx, c.c) });
          L.doneCredits(ctx); L.calcGPA(ctx); L.retakeList(ctx);
        } catch (e) { bad++; console.log(`  ✗ ${code}/${ver}/prep=${prep}: ${e.message}`) }
      }
    }
  }
  ok(bad === 0, 'كل تخصص × نسخة × تحضيري يمر بلا انهيار');
}

}  /* نهاية الحالات السلوكية */

/* ═══ ٣. فحص ثابت: ما بقت نسخة ثانية في الصفحة ═══ */
{
  const page = fs.readFileSync(PAGE, 'utf8');
  const shared = fs.readFileSync(SHARED, 'utf8');

  const bodyIn = (src, name) => {
    const m = new RegExp('^function\\s+' + name + '\\s*\\(', 'm').exec(src);
    if (!m) return null;
    let i = src.indexOf('{', m.index), d = 0, n = i;
    for (; n < src.length; n++) {
      if (src[n] === '{') d++;
      else if (src[n] === '}') { d--; if (!d) break }
    }
    return src.slice(m.index, n + 1);
  };

  for (const f of MOVED) {
    ok(new RegExp('^function\\s+' + f + '\\s*\\(', 'm').test(shared),
       `${f} معرّفة في shared/plans.js`);
    /* التعريف مرة واحدة في المشترك */
    const hits = (shared.match(new RegExp('^function\\s+' + f + '\\s*\\(', 'gm')) || []).length;
    ok(hits === 1, `${f} معرّفة مرة واحدة في المشترك — ${hits}`);

    /* في الصفحة: إما غير موجودة، أو مغلّف ينادي PlanLogic — لا تنفيذ ثانٍ.
       الطول مقياس ضعيف، فنفحص بصمات التنفيذ نفسها: مغلّف يفوّض لا يمشي
       على الخطة ولا يقرأ completed/grades ولا يحسب نقاطاً. */
    const b = bodyIn(page, f);
    if (b !== null) {
      ok(/PlanLogic\./.test(b),
         `${f} في الصفحة مغلّف ينادي PlanLogic لا نسخة ثانية`);
      /* نحذف نداءات PlanLogic وترويسة الدالة قبل الفحص، وإلا طابق
         المغلّف اسم نفسه (PlanLogic.allPlanCourses داخل allPlanCourses). */
      const inner = b.replace(/^function\s+\w+\s*\([^)]*\)/, '')
                     .replace(/PlanLogic\.\w+/g, '');
      const marks = [
        [/completed\.includes/, 'يقرأ completed مباشرة'],
        [/\bPLAN\.(flatMap|findIndex|find|forEach|filter)/, 'يمشي على PLAN'],
        [/allPlanCourses\(\)/, 'يجمع مواد الخطة'],
        [/GRADE_POINTS\s*\[/, 'يحسب نقاط المعدل'],
        [/\bgrades\s*\[/, 'يقرأ grades مباشرة'],
        [/\.reduce\(/, 'يجمع بنفسه'],
      ].filter(([re]) => re.test(inner));
      ok(marks.length === 0,
         `${f} في الصفحة يفوّض ولا ينفّذ — لقينا: ${marks.map(m => m[1]).join(' · ')}`);
    }
  }

  /* الثوابت المنقولة: الصفحة تشير للمشترك لا تعيد قيمها */
  for (const c of CONSTS) {
    const def = new RegExp('^const\\s+' + c + '\\s*=\\s*(.*)$', 'm').exec(page);
    if (def) ok(/PlanLogic\./.test(def[1]),
       `${c} في الصفحة يشير للمشترك — «${def[1].slice(0, 50)}»`);
  }

  /* ولا دالة منقولة معرّفة مرتين في الصفحة */
  for (const f of MOVED) {
    const hits = (page.match(new RegExp('^function\\s+' + f + '\\s*\\(', 'gm')) || []).length;
    ok(hits <= 1, `${f} ما تكررت في الصفحة — ${hits}`);
  }

  /* الصفحة تبني السياق مرة واحدة بدالة واحدة */
  ok((page.match(/^function planCtx\(\)/gm) || []).length === 1,
     'planCtx معرّفة مرة واحدة في الصفحة');
}

console.log(`\n${pass} نجحت · ${fail} فشلت`);
process.exit(fail ? 1 : 0);
