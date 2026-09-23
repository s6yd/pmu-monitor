/* باني الجداول — اختبار (CLAUDE.md §٩-أ-٥).
   الدالة صافية، فنقتطعها من server.js ونشغّلها معزولة مع دوال
   التعارض الحقيقية — لا نسخة مزيّفة منها: النسخة المزيّفة من schedTime
   هي اللي خبّت خطأ «my_day فاضي» شهوراً.

   الصفوف هنا **من القاعدة الحقيقية** (ترم 202710): نفس الأكواد
   والعناوين وأرقام الشعب والأوقات. بيانات اختبار أسهل من الحقيقة
   تمرّ وتترك الخطأ للإنتاج.

   خمسة أخطار يمسكها:
   ١) توليفة فيها تعارض — أسوأ ما يقدر يطلع من باني جداول.
   ٢) مادة لها معمل يرجع جدولها بلا معمل، فيسجّل ناقصاً.
   ٣) شعبة طالبات تدخل جدول طالب (أو العكس).
   ٤) «ما فيه حل» بدل جدول فيه تنازل صغير مُعلَن.
   ٥) نتيجة تختلف بين نداءين بنفس المدخل.

   node tests/test-sched-builder.js [server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

const src = fs.readFileSync(SRV, 'utf8');
const L = src.split('\n');
const i = L.findIndex(x => x.startsWith('function schedDays('));
const j = L.findIndex(x => x.startsWith('/* ═══ نهاية باني الجداول ═══'));
ok(i >= 0, 'دوال التعارض موجودة في السيرفر');
ok(j > i, 'منطقة باني الجداول موجودة بعلامة نهايتها');
if (i < 0 || j <= i) done();

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(L.slice(i, j + 1).join('\n')
  + '\nthis.buildSchedules=buildSchedules; this.schedClash=schedClash;', ctx);
const { buildSchedules, schedClash } = ctx;
ok(typeof buildSchedules === 'function', 'buildSchedules متاحة');
if (typeof buildSchedules !== 'function') done();

/* ═══ صفوف الجامعة كما ترجع فعلاً ═══
   الوقت بلا نقطتين، والأيام حروف ملتصقة، والمعمل عنوانه ينتهي بـLAB،
   و1xx طلاب و2xx طالبات. */
const S = (crn, code, title, section, d, t, room, ins, g, st) => ({
  crn, courseCode: code, courseTitle: title, section, courseDate: d,
  courseTiming: t, room, instructor: ins, gender: g, status: st || 'OPEN' });

const ROWS = [
  /* CHEM 1421 — طلاب */
  S('11156', 'CHEM 1421', 'Chemistry for Engineers I', '101', 'UTR', '1200 - 1250', 'M-CORE - F155', 'A', 'M'),
  S('11157', 'CHEM 1421', 'Chemistry for Engineers I', '102', 'MW', '1100 - 1215', 'M-CCES - F051', 'A', 'M'),
  S('11158', 'CHEM 1421', 'Chemistry for Engineers I', '103', 'U', '1700 - 1950', 'M-CORE - G049', 'A', 'M'),
  S('11163', 'CHEM 1421', 'Chemistry for Engineers I LAB', '112', 'T', '1300 - 1550', 'M-CORE - G039', 'A', 'M'),
  S('11165', 'CHEM 1421', 'Chemistry for Engineers I LAB', '114', 'U', '1300 - 1550', 'M-CORE - G039', 'A', 'M'),
  /* CHEM 1421 — طالبات */
  S('10041', 'CHEM 1421', 'Chemistry for Engineers I', '201', 'MW', '0930 - 1045', 'F-CORE - F053', 'N', 'F'),
  S('10055', 'CHEM 1421', 'Chemistry for Engineers I LAB', '211', 'U', '1400 - 1650', 'F-CORE - G023', 'N', 'F'),
  /* PHYS 1421 — طلاب، ومعملاه كلاهما يوم الأربعاء */
  S('11181', 'PHYS 1421', 'Physics for Engineers I', '102', 'UTR', '1400 - 1450', 'M-COBA - G026', 'S', 'M'),
  S('11185', 'PHYS 1421', 'Physics for Engineers I', '106', 'MW', '1600 - 1715', 'M-CORE - G051', 'S', 'M'),
  S('11192', 'PHYS 1421', 'Physics for Engineers I LAB', '116', 'W', '1300 - 1550', 'M-CORE - G041', 'S', 'M'),
  S('11194', 'PHYS 1421', 'Physics for Engineers I LAB', '118', 'W', '0800 - 1050', 'M-CORE - G041', 'S', 'M'),
  /* MATH 1422 — شعبة واحدة بصفّين (نفس الـCRN)، وشعبة مقفلة */
  S('11123', 'MATH 1422', 'Calculus I', '102', 'MW', '1100 - 1250', 'M-CORE - S1', 'R', 'M'),
  S('11123', 'MATH 1422', 'Calculus I', '102', 'R', '1100 - 1150', 'M-CORE - S1', 'R', 'M'),
  S('11129', 'MATH 1422', 'Calculus I', '108', 'UT', '0800 - 0915', 'M-CORE - S2', 'R', 'M', 'CLOSE'),
  S('11130', 'MATH 1422', 'Calculus I', '109', 'UT', '1000 - 1115', 'M-CORE - S3', 'O', 'M'),
];

const codesOf = o => o.picks.map(p => p.code + '/' + p.section).sort();
const rowsOf = (res, o) => o.picks.reduce((a, p) =>
  a.concat(ROWS.filter(r => String(r.crn) === p.crn)), []);

/* ══════ ١) ولا توليفة فيها تعارض ══════ */
{
  const r = buildSchedules(ROWS, { codes: ['CHEM 1421', 'PHYS 1421', 'MATH 1422'], gender: 'M' });
  ok(r.ok, 'ركّب جدولاً');
  ok(r.options.length === 3, 'ورجّع ثلاثة خيارات — ' + r.options.length);
  r.options.forEach(o => {
    const rs = rowsOf(r, o);
    let clash = null;
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++)
      if (schedClash(rs[a], rs[b])) clash = rs[a].crn + '×' + rs[b].crn;
    ok(!clash, `الخيار ${o.rank}: **بلا تعارض** — ${clash || ''}`);
  });
  /* الخيارات مختلفة فعلاً لا نسخ */
  const keys = r.options.map(o => o.crns.slice().sort().join(','));
  eq(new Set(keys).size, keys.length, 'والخيارات الثلاثة مختلفة');
  /* مرتّبة بالأفضل أولاً */
  ok(r.options[0].score <= r.options[1].score
    && r.options[1].score <= r.options[2].score, 'ومرتّبة بالنقاط تصاعدياً');
}

/* ══════ ٢) المعمل يدخل مع مادته ══════ */
{
  const r = buildSchedules(ROWS, { codes: ['CHEM 1421'], gender: 'M' });
  eq(r.slots.map(s => s.part), ['lecture', 'lab'], 'مادة لها معمل = خانتان');
  r.options.forEach(o => {
    eq(o.picks.length, 2, `الخيار ${o.rank}: شعبتان — محاضرة ومعمل`);
    ok(o.picks.some(p => p.part === 'lab'), `الخيار ${o.rank}: **فيه معمل**`);
    ok(o.picks.some(p => p.part === 'lecture'), `الخيار ${o.rank}: وفيه محاضرة`);
  });
  const no = buildSchedules(ROWS, { codes: ['CHEM 1421'], gender: 'M', labs: false });
  eq(no.slots.map(s => s.part), ['lecture'], 'و«بدون معامل» يرجّع المحاضرة وحدها');
  ok(no.options.every(o => o.picks.length === 1), 'وشعبة واحدة في كل خيار');
}

/* ══════ ٣) شعبة واحدة بصفّين = اختيار واحد ══════ */
{
  const r = buildSchedules(ROWS, { codes: ['MATH 1422'], gender: 'M' });
  const one = r.options.find(o => o.crns[0] === '11123');
  ok(!!one, 'الشعبة ذات الصفّين موجودة في الخيارات');
  if (one) {
    eq(one.picks.length, 1, '**وتُحسب اختياراً واحداً** — CRN واحد');
    eq(one.picks[0].meets.length, 2, 'وجلستاها كلتاهما في النتيجة');
    eq(one.days, ['M', 'W', 'R'], 'وأيامها من الجلستين معاً');
  }
  /* والمقفلة ما تدخل افتراضياً */
  ok(r.options.every(o => !o.crns.includes('11129')), 'والمقفلة ما تدخل افتراضياً');
  const cl = buildSchedules(ROWS, { codes: ['MATH 1422'], gender: 'M', openOnly: false });
  const got = cl.options.find(o => o.crns.includes('11129'));
  ok(!!got, 'وتدخل لو طلبها صراحةً');
  if (got) eq(got.closedSections, 1, 'وتُعدّ مقفلة في النتيجة');
  ok(!got || got.rank === cl.options.length, 'وتجي آخر الترتيب');
}

/* ══════ ٤) الجنس: ولا شعبة من الجهة الثانية ══════ */
{
  const m = buildSchedules(ROWS, { codes: ['CHEM 1421'], gender: 'M' });
  ok(m.options.every(o => o.picks.every(p => p.gender === 'M')),
    '**طالب: ولا شعبة طالبات في أي خيار**');
  const f = buildSchedules(ROWS, { codes: ['CHEM 1421'], gender: 'F' });
  ok(f.ok && f.options.every(o => o.picks.every(p => p.gender === 'F')),
    '**طالبة: ولا شعبة طلاب في أي خيار**');
  eq(f.options[0].crns.slice().sort(), ['10041', '10055'], 'وشعبها هي');
  /* بلا جنس معروف: ما نفلتر، لكن ما نخلط شعبتين لنفس الخانة */
  const n = buildSchedules(ROWS, { codes: ['CHEM 1421'] });
  ok(n.ok, 'وبلا جنس معروف يبني من الكل');
  ok(n.options.every(o => o.picks.length === 2), 'وبمحاضرة ومعمل لا أكثر');
}

/* ══════ ٥) التفضيلات: تُشدَّد أولاً وتُرخى ثانياً ══════ */
{
  /* الخميس يمكن تفاديه في CHEM وحدها */
  const r = buildSchedules(ROWS, { codes: ['CHEM 1421'], gender: 'M', avoidDays: ['R'] });
  ok(r.ok && !r.relaxed, 'يوم يمكن تفاديه: تفاديناه بلا تنازل');
  ok(r.options.every(o => !o.days.includes('R')), '**ولا خيار فيه الخميس**');

  /* الأربعاء مستحيل: معملا الفيزياء كلاهما فيه */
  const w = buildSchedules(ROWS, { codes: ['PHYS 1421'], gender: 'M', avoidDays: ['W'] });
  ok(w.ok, 'يوم مستحيل: رجّع جدولاً بدل «ما فيه حل»');
  ok(w.relaxed, '**وقال إنه تنازل**');
  ok(w.options.every(o => o.violations.includes('day:W')),
    'وسمّى التنازل بالاسم — day:W');

  /* ساعة: لا شي قبل ١٠ ولا بعد ٤ */
  const t = buildSchedules(ROWS, { codes: ['CHEM 1421'], gender: 'M',
    noEarlier: 600, noLater: 960 });
  ok(t.ok && !t.relaxed, 'وقت ممكن: بلا تنازل');
  ok(t.options.every(o => o.firstStart >= '10:00' && o.lastEnd <= '16:00'),
    '**ولا محاضرة خارج الساعتين**');
  const t2 = buildSchedules(ROWS, { codes: ['PHYS 1421'], gender: 'M',
    labs: false, noLater: 600 });
  ok(t2.ok && t2.relaxed && t2.options[0].violations.includes('late'),
    'ووقت مستحيل: يتنازل ويقول late');
}

/* ══════ ٦) المثبّت: يبني حول ما عنده ══════ */
{
  /* MW 1600-1700 يصادم PHYS 106 فما يبقى إلا 102 */
  const keep = [{ courseCode: 'ZZZ 1111', courseDate: 'MW', courseTiming: '1600 - 1700' }];
  const r = buildSchedules(ROWS, { codes: ['PHYS 1421'], gender: 'M', labs: false, keep });
  eq(r.kept, 1, 'المثبّت محسوب');
  ok(r.options.every(o => !o.crns.includes('11185')),
    '**والشعبة اللي تصادمه مستبعدة**');
  ok(r.options.some(o => o.crns.includes('11181')), 'والباقية موجودة');
  /* مادة طلبها الطالب تُشال من المثبّت — يبدّلها لا يزيدها */
  const same = [{ courseCode: 'PHYS 1421', courseDate: 'UTR', courseTiming: '1400 - 1450' }];
  const r2 = buildSchedules(ROWS, { codes: ['PHYS 1421'], gender: 'M', labs: false, keep: same });
  eq(r2.kept, 0, 'ومادة طلبها ما تُثبَّت ضد نفسها');
  ok(r2.options.some(o => o.crns.includes('11181')), 'فشعبتها تبقى مرشحة');
}

/* ══════ ٧) بلا حل: نقول ليش ══════ */
{
  const two = [
    S('1', 'AAA 1111', 'A', '101', 'MW', '0900 - 0950', 'r', 'x', 'M'),
    S('2', 'BBB 2222', 'B', '101', 'MW', '0900 - 0950', 'r', 'x', 'M'),
  ];
  const r = buildSchedules(two, { codes: ['AAA 1111', 'BBB 2222'], gender: 'M' });
  ok(!r.ok && !r.options.length, 'تعارض تام ⇒ ما فيه خيار');
  eq(r.conflicts, [{ a: 'AAA 1111', b: 'BBB 2222' }], '**ونسمّي المادتين المتصادمتين**');
}

/* ══════ ٨) مادة ما لها شعب: نقولها ونكمّل ══════ */
{
  const r = buildSchedules(ROWS, { codes: ['CHEM 1421', 'XXXX 9999'], gender: 'M' });
  ok(r.ok && r.options.length, 'يكمّل بالباقي');
  eq(r.missing.map(m => m.code), ['XXXX 9999'], 'ويسمّي الناقصة');
  ok(/شعب/.test(r.missing[0].reason || ''), 'ويقول ليش — ' + r.missing[0].reason);
  /* مادة كل شعبها للجهة الثانية */
  const f = buildSchedules(ROWS, { codes: ['PHYS 1421'], gender: 'F' });
  ok(!f.ok, 'ومادة ما فيها شعب لجنسه ما تُبنى');
  ok(f.missing.some(m => /جنسه/.test(m.reason || '')), 'ويقول السبب — جنسه');
}

/* ══════ ٩) نفس المدخل ⇒ نفس المخرج ══════ */
{
  const o = { codes: ['CHEM 1421', 'PHYS 1421', 'MATH 1422'], gender: 'M' };
  eq(JSON.stringify(buildSchedules(ROWS, o)),
     JSON.stringify(buildSchedules(ROWS, o)), '**النتيجة ثابتة بين نداءين**');
  /* وترتيب الصفوف في الكاش ما يغيّرها */
  const rev = ROWS.slice().reverse();
  eq(buildSchedules(rev, o).options[0].crns.slice().sort(),
     buildSchedules(ROWS, o).options[0].crns.slice().sort(),
     'وترتيب صفوف الكاش ما يغيّر الأفضل');
}

/* ══════ ١٠) الأفضل فعلاً هو الأول ══════ */
{
  /* مادتان: توليفة بيومين وتوليفات بثلاثة. الأقل أيام تفوز. */
  const rows = [
    S('a1', 'AAA 1111', 'A', '101', 'MW', '0800 - 0850', 'r', 'x', 'M'),
    S('a2', 'AAA 1111', 'A', '102', 'UT', '0800 - 0850', 'r', 'x', 'M'),
    S('b1', 'BBB 2222', 'B', '101', 'MW', '0900 - 0950', 'r', 'x', 'M'),
    S('b2', 'BBB 2222', 'B', '102', 'R', '0900 - 0950', 'r', 'x', 'M'),
  ];
  const r = buildSchedules(rows, { codes: ['AAA 1111', 'BBB 2222'], gender: 'M' });
  eq(r.options[0].crns.slice().sort(), ['a1', 'b1'], '**الأقل أياماً أولاً**');
  eq(r.options[0].days, ['M', 'W'], 'ويومان فقط');
  eq(r.options[0].gapMin, 20, 'والفراغ بينهما محسوب — عشر دقائق × يومين');
  /* ومن يبغى أقل فراغ يتغيّر عليه الترتيب لا النتيجة */
  const g = buildSchedules(rows, { codes: ['AAA 1111', 'BBB 2222'], gender: 'M', prefer: 'gaps' });
  ok(g.ok, 'وتفضيل الفراغ يشتغل');
  ok(g.options.every(o => o.picks.length === 2), 'وبمادتين في كل خيار');
}

/* ══════ ١١) LEC/LAB شعبة واحدة لا خانتان ══════ */
{
  const rows = [
    S('c1', 'ASSE 3211', 'Learning Outcome Assessment II', '101', 'U', '0900 - 0950', 'r', 'x', 'M'),
    S('c2', 'ASSE 3211', 'Learning Out Asse II LEC/LAB', '102', 'T', '0900 - 0950', 'r', 'x', 'M'),
  ];
  const r = buildSchedules(rows, { codes: ['ASSE 3211'], gender: 'M' });
  eq(r.slots.map(s => s.part), ['lecture'],
     '**"LEC/LAB" محاضرة لا معمل** — تُسجَّل مرة واحدة');
  ok(r.options.every(o => o.picks.length === 1), 'وخيار من شعبة واحدة');
}

/* ══════ ١٢) صفوف بلا وقت: ما تكسر وما تتعارض ══════ */
{
  const rows = [
    S('t1', 'ONLN 1111', 'Online', '101', '', 'TBA', '', 'x', 'M'),
    S('t2', 'AAA 1111', 'A', '101', 'MW', '0900 - 0950', 'r', 'x', 'M'),
  ];
  const r = buildSchedules(rows, { codes: ['ONLN 1111', 'AAA 1111'], gender: 'M' });
  ok(r.ok, 'مادة بلا وقت ما تكسر البناء');
  eq(r.options[0].picks.length, 2, 'وتدخل الجدول');
  eq(r.options[0].days, ['M', 'W'], 'وما تضيف يوماً');
}

/* ══════ ١٣) الحجم: يرجع ولا يعلّق ══════ */
{
  const big = [];
  for (let c = 0; c < 7; c++) {
    for (let s = 0; s < 12; s++) {
      const day = ['U', 'M', 'T', 'W', 'R'][s % 5];
      const h = 8 + (s % 10);
      big.push(S(`${c}-${s}`, `CRS ${1000 + c}`, 'Course ' + c, '10' + s,
        day, `${String(h).padStart(2, '0')}00 - ${String(h).padStart(2, '0')}50`,
        'r', 'x', 'M'));
    }
  }
  const t0 = Date.now();
  const r = buildSchedules(big, { codes: big.map(x => x.courseCode), gender: 'M' });
  const ms = Date.now() - t0;
  ok(r.ok && r.options.length === 3, 'سبع مواد × ١٢ شعبة: رجّع ثلاثة خيارات');
  ok(ms < 3000, 'وفي أقل من ثلاث ثوانٍ — ' + ms + 'ms');
  r.options.forEach(o => {
    const rs = o.picks.reduce((a, p) => a.concat(big.filter(x => x.crn === p.crn)), []);
    let bad = false;
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++)
      if (schedClash(rs[a], rs[b])) bad = true;
    ok(!bad, `الخيار ${o.rank} من السبع مواد بلا تعارض`);
  });
}

/* ══════ ١٤) بلا مواد: ما نخترع ══════ */
{
  const r = buildSchedules(ROWS, { codes: [], gender: 'M' });
  ok(!r.ok && !r.options.length, 'بلا مواد ما نبني شيئاً');
  ok(!!r.error, 'ونقول ليش');
}

done();
