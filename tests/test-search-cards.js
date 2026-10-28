/* بطاقات البحث — طلب محمد (٢٧ أكتوبر ٢٠٢٦: «يكون تفاعلي اكثر وما تحسه جامد»)، الأفكار ٥–٨ اللي وافق عليها.
   Chromium على ٣٩٠ بالثيمين، والصفحة نفسها تُضغط وتُقرأ:
   ٥) شعب المادة الوحدة تحت بطاقة وحدة («٤ شعب · وحدة مفتوحة») وتنفتح على شعبها — كانت كل شعبة بطاقة طويلة.
      مطوية لو المواد كثيرة، ومفتوحة لو قليلة (بحث بكود أو دكتور)، وضغطة الطالب تنحفظ لين بحث جديد.
   ٦) الشعبة سطر خفيف: الحالة بلون طرفه، وسطر لكل اجتماع، و«+ أضف» و«🔕 راقب» بكلمة، و«📡 راقب كل الشعب» مرة تحت المادة.
   ٧) العدّادات (إجمالي · مفتوح · مغلق) هي الفلتر — وسطر أزرار الفلتر انشال.
   ٨) الإضافة: السطر ينبض بلون الجدول، ورقم «جدولي» ينط ويزيد ١.
   ومعها: **المحاضرة والمعمل بنفس CRN شعبة وحدة** (§٦) — في العدّ والعرض والتعارض والفلتر ورقم «جدولي» ·
   «معمل» من العنوان وحده (كود ينتهي بـL — ENGL · BIOL — كان يطلع معملاً، و«LEC/LAB» محاضرة) ·
   التحديث الصامت في المكان (نفس العنصر، وملخّص المادة والعدّادات معه) · البوت والدليل يشرحان الأزرار الجديدة.

   node tests/test-search-cards.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ROOT = path.dirname(PAGE);
const SHARED = path.join(ROOT, 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nبطاقات البحث: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* بيانات بصيغة الجامعة حرفاً بحرف: الوقت بلا نقطتين، الأيام حروف متلاصقة، الحالة OPEN · CLOSE، الدكاترة لاتيني،
   والجنس من أول خانة في الشعبة (1xx طلاب · 2xx طالبات) */
const C = (crn, code, title, sec, days, time, ins, room, st) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: st, gender: sec[0] === '2' ? 'F' : 'M' });
const DATA = () => [
  /* MEEN 3311: ٤ شعب، وحدة مفتوحة — ومتطلبها ناقص (قفل وحيد على المادة لا على كل شعبة) */
  C('30011', 'MEEN 3311', 'Thermodynamics I', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034', 'OPEN'),
  C('30012', 'MEEN 3311', 'Thermodynamics I', '102', 'UT', '1000 - 1115', 'Abumuhammad, Moinuddeen', 'M-CORE - G035', 'CLOSE'),
  C('30013', 'MEEN 3311', 'Thermodynamics I', '103', 'UTR', '1300 - 1350', 'Smith, John', 'M-CORE - G036', 'CLOSE'),
  C('30014', 'MEEN 3311', 'Thermodynamics I', '201', 'MW', '1000 - 1115', 'Sara, Ali', 'F-CORE - 104', 'CLOSE'),
  /* CHEM 1311: محاضرتان مقفلتان، ومعملان بـCRN خاص (العنوان ينتهي بـ LAB) واحد مفتوح */
  C('30021', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'UT', '0800 - 0915', 'Khan, Imran', 'M-SCI - 101', 'CLOSE'),
  C('30022', 'CHEM 1311', 'Chemistry for Engineers I', '102', 'MW', '1300 - 1415', 'Khan, Imran', 'M-SCI - 102', 'CLOSE'),
  C('30023', 'CHEM 1311', 'Chemistry for Engineers I LAB', '111', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L201', 'OPEN'),
  C('30024', 'CHEM 1311', 'Chemistry for Engineers I LAB', '112', 'W', '0800 - 1050', 'Lee, Ann', 'M-SCI - L201', 'CLOSE'),
  /* PHYS 1421 §101: المحاضرة والمعمل بنفس CRN — صفّان، شعبة وحدة، ودكتور المعمل غير */
  C('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'MW', '0930 - 1045', 'Brown, Mark', 'M-SCI - 201', 'CLOSE'),
  C('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L105', 'CLOSE'),
  C('30032', 'PHYS 1421', 'Physics for Engineers I', '102', 'UT', '1300 - 1415', 'Brown, Mark', 'M-SCI - 202', 'OPEN'),
  /* كود ينتهي بـL مو معمل، والمعمل منه من عنوانه · «LEC/LAB» محاضرة · «Lab» بحروف صغيرة معمل */
  C('30041', 'ENGL 2311', 'Technical Writing', '101', 'R', '1400 - 1515', 'Green, Lucy', 'M-CORE - G201', 'CLOSE'),
  C('30051', 'BIOL 1301', 'General Biology', '101', 'UT', '0800 - 0915', 'Hill, Dana', 'M-SCI - 301', 'OPEN'),
  C('30052', 'BIOL 1301', 'General Biology LAB', '111', 'M', '1300 - 1550', 'Hill, Dana', 'M-SCI - L301', 'CLOSE'),
  C('30061', 'ASSE 3211', 'Learning Out Asse II LEC/LAB', '101', 'T', '0900 - 0950', 'Ford, Tom', 'M-CORE - G301', 'OPEN'),
  C('30071', 'MEEN 3111', 'Thermofluids & Energy Lab', '101', 'W', '1300 - 1550', 'Omar, Hassan', 'M-ENG - L101', 'CLOSE'),
  /* الجامعة ترمّز «'» (§٦) — يطلع للطالب حرفاً لا كياناً */
  C('30081', 'HUMN 2301', 'Critical Think&#x27;g', '101', 'MW', '1100 - 1215', 'Ford, Tom', 'M-CORE - G110', 'OPEN'),
  C('30091', 'MATH 2301', 'Calculus III', '101', 'UTR', '1000 - 1050', 'Brown, Mark', 'M-CORE - G101', 'OPEN'),
  /* مواد زيادة: البحث العام فيه مواد كثيرة (الحركة لأول ١٢ بس، والبطاقات مطوية) */
  ...['MATH 2302', 'MEEN 2311', 'MEEN 3321', 'MEEN 4411', 'EEEN 2301', 'ECON 2301'].map((code, i) =>
    C(String(30101 + i), code, 'Engineering Topic ' + (i + 1), '101', 'UT', '1500 - 1615', 'Smith, John', 'M-CORE - G2' + (10 + i), i % 2 ? 'OPEN' : 'CLOSE')),
];
let COURSES = DATA();
const SCHED = () => [COURSES.find(c => c.crn === '30091'), COURSES.find(c => c.crn === '30041'), COURSES.find(c => c.crn === '30021')];
const DONE = ['MATH 1301', 'MATH 1302', 'ENGL 1311', 'CHEM 1311'];
const SECS = rows => new Set(rows.map(c => c.crn)).size;
const OPEN_SECS = rows => new Set(rows.filter(c => c.status === 'OPEN').map(c => c.crn)).size;

const STATUS = { active: false, reason: 'offseason', env: 'prod', freeBeta: false, term: '202710', regTerm: '202710',
  nextRegTerm: '202720', canWatch: false, window: null, build: '"x"',
  plans: { termHalalas: 1900, pushoverHalalas: 1500, freeMonitors: 2, freeSchedules: 1 } };
const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

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
    const send = j => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
    if (u === '/api/courses') return send({ success: true, count: COURSES.length, courses: COURSES });
    if (u === '/api/monitor-status') return send(STATUS);
    send({});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  /* زائر عنده جدول (٣ شعب) ومواد منجزة، وتخصصه ميكانيكا — والدليل والشريط مقفولان */
  const open = async ({ theme = 'dark', reduce = false } = {}) => {
    COURSES = DATA();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(([sch, done, theme]) => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"'); localStorage.setItem('theme', theme);
      localStorage.setItem('pmu_schedules', JSON.stringify([sch, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(sch));
      localStorage.setItem('pmu_completed', JSON.stringify(done));
      localStorage.setItem('pmu_guestbar_off', String(Date.now()));
    } catch (e) {} }, [SCHED(), DONE, theme]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.doSearch === 'function' && typeof window.switchTab === 'function',
      null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(300);
    return { ctx, pg, errs };
  };
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  /* ضغطة حقيقية بالماوس (Playwright يتأكد إن العنصر ظاهر وما فوقه شي). عنصر ما يوجد (النسخة القديمة) ما يوقف
     الاختبار — الفحوص بعدها تسجّل الفشل */
  const tap = (pg, sel) => pg.click(sel, { timeout: 4000 }).then(() => true, () => false);
  const search = async pg => {
    await run(pg, async () => { switchTab('search'); await doSearch() });
    await pg.waitForFunction(() => document.querySelectorAll('#resultsList .course-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    await pg.waitForTimeout(150);
  };
  const shot = async (pg, name, sel) => {
    if (!shots) return;
    if (sel) { const el = await pg.$(sel); if (el) return el.screenshot({ path: path.join(shots, name) }) }
    await pg.screenshot({ path: path.join(shots, name) });
  };
  /* حالة البطاقات كما يشوفها الطالب */
  const CARDS = () => [...document.querySelectorAll('#resultsList .course-card')].map(g => ({
    code: (g.querySelector('.cg-code') || {}).textContent || null,
    title: (g.querySelector('.cg-title') || {}).textContent || null,
    sums: [...g.querySelectorAll('.cg-sum')].map(x => x.textContent.trim()),
    notes: [...g.querySelectorAll('.cg-note')].map(x => x.textContent.trim()),
    open: g.classList.contains('open'),
    exp: (g.querySelector('.cg-head') || { getAttribute: () => null }).getAttribute('aria-expanded'),
    body: g.querySelector('.cg-body') ? getComputedStyle(g.querySelector('.cg-body')).display : null,
    errTags: g.querySelectorAll('.cg-tags .tag.err').length, rowErr: g.querySelectorAll('.sec-row .tag.err').length,
    rows: [...g.querySelectorAll('.sec-row')].map(r => r.dataset.crn),
    all: g.querySelector('.cg-all') ? { t: g.querySelector('.cg-all').textContent.trim(), on: g.querySelector('.cg-all').classList.contains('on') } : null,
  }));
  const ROW = crn => {
    const r = document.querySelector(`#resultsList .sec-row[data-crn="${crn}"]`);
    if (!r) return null;
    const add = r.querySelector('.sr-btn.add'), bell = r.querySelector('.sr-btn.bell');
    return { cls: r.className, text: r.innerText.replace(/\s+/g, ' ').trim(), when: [...r.querySelectorAll('.sr-when')].map(w => w.innerText.replace(/\s+/g, ' ').trim()),
      lab: !!r.querySelector('.sr-lab'), badge: (r.querySelector('.badge') || {}).textContent,
      edge: getComputedStyle(r).borderInlineStartColor, timeDir: (r.querySelector('.sr-time') || { dir: '' }).dir,
      add: add ? { t: add.textContent.trim(), cls: add.className } : null,
      bell: bell ? { t: bell.textContent.trim(), cls: bell.className, hidden: bell.hidden, shown: getComputedStyle(bell).display !== 'none' } : null,
      warn: (r.querySelector('.tag.warn') || {}).textContent || null, okTag: (r.querySelector('.tag.ok') || {}).textContent || null };
  };
  const card = (cs, code) => cs.find(c => c.code === code) || {};
  /* نفتح أو نطوي مادة بضغطة على رأسها — لو هي أصلاً كذا ما نضغط */
  const setOpen = (pg, code, want) => run(pg, ([code, want]) => {
    const g = document.querySelector(`#resultsList .course-card[data-code="${code}"]`);
    if (g && g.classList.contains('open') !== want) g.querySelector('.cg-head').click();
    return !!g && g.classList.contains('open') === want;
  }, [code, want]);

  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme });
    await search(pg);

    /* ── ٥) بطاقة لكل مادة ── */
    let cs = await run(pg, CARDS);
    const codes = [...new Set(COURSES.map(c => c.courseCode))];
    eq(Array.isArray(cs) ? cs.map(c => c.code) : cs, codes,
      `[${theme}] **بطاقة وحدة لكل مادة** بترتيب الجامعة (كانت كل شعبة بطاقة — ${COURSES.length} بطاقة)`);
    ok(Array.isArray(cs) && cs.every(c => !c.open && c.exp === 'false' && c.body === 'none' && c.rows.length > 0),
      `[${theme}] **${codes.length} مادة ⇒ مطوية**: الشعب تحت كل مادة بس ما تبان لين تضغطها — ${JSON.stringify((cs || [])[0])}`);
    const g0 = card(cs, 'MEEN 3311');
    eq(g0.sums, ['4 شعب · وحدة مفتوحة'], `[${theme}] **ملخّص المادة: «4 شعب · وحدة مفتوحة»** (ونقطة خضراء لو فيها مفتوحة)`);
    eq(g0.title, 'Thermodynamics I', `[${theme}] واسمها تحت كودها`);
    eq(card(cs, 'CHEM 1311').sums, ['شعبتين · كلها مقفلة', 'معملين · واحد مفتوح'],
      `[${theme}] **المعامل (CRN خاص) لحالها**: الطالب يحتاج محاضرة مفتوحة ومعملاً مفتوحاً — «واحد مفتوح» بس ما يكفي`);
    eq(card(cs, 'PHYS 1421').sums, ['شعبتين · وحدة مفتوحة'], `[${theme}] **PHYS 1421 «شعبتين» لا ثلاث** — المحاضرة والمعمل بنفس CRN شعبة وحدة`);
    eq([card(cs, 'ENGL 2311').sums, card(cs, 'ASSE 3211').sums, card(cs, 'MEEN 3111').sums],
      [['شعبة وحدة · مقفلة'], ['شعبة وحدة · مفتوحة'], ['معمل واحد · مقفل']],
      `[${theme}] ENGL «شعبة» (كود ينتهي بـL مو معمل) · LEC/LAB «شعبة» · «Energy Lab» «معمل»`);
    eq(card(cs, 'HUMN 2301').title, "Critical Think'g", `[${theme}] **«&#x27;» من الجامعة يطلع «'»** لا كياناً`);
    eq(card(cs, 'MEEN 3111').title, 'Thermofluids & Energy Lab', `[${theme}] و«&» يطلع «&» لا «&amp;»`);
    ok(g0.errTags === 1 && g0.rowErr === 0, `[${theme}] **المتطلب الناقص مرة على المادة** لا على كل شعبة — ${g0.errTags} · ${g0.rowErr}`);
    eq(card(cs, 'CHEM 1311').notes, ['✓ في جدولك: شعبة 101'], `[${theme}] **وش له فيها يبان والمادة مطوية**: «✓ في جدولك: شعبة 101»`);
    const hd = await run(pg, () => ({ c: document.getElementById('visibleCount').textContent, s: (document.getElementById('visibleSecs') || {}).textContent }));
    eq(hd, { c: String(codes.length), s: String(SECS(COURSES)) }, `[${theme}] **العنوان: «${codes.length} مادة · ${SECS(COURSES)} شعبة»**`);
    const anim = await run(pg, () => [...document.querySelectorAll('#resultsList .course-card')].map(c => [c.classList.contains('in'), c.style.getPropertyValue('--i')]));
    ok(Array.isArray(anim) && anim.length === codes.length && anim.slice(0, 12).every((a, i) => a[0] && a[1] === String(i)) && anim.slice(12).every(a => !a[0]),
      `[${theme}] **البحث الجديد: أول ١٢ مادة تظهر وحدة ورا الثانية، والباقي على طول** — ${JSON.stringify(anim && anim.slice(10, 14))}`);
    await shot(pg, `cards-list-${theme}.png`);

    /* ── الفتح والطي ── */
    await tap(pg, '#resultsList .course-card[data-code="MEEN 3311"] .cg-head');
    await pg.waitForTimeout(80);
    let o = await run(pg, () => { const g = document.querySelector('#resultsList .course-card[data-code="MEEN 3311"]');
      return { open: g.classList.contains('open'), exp: g.querySelector('.cg-head').getAttribute('aria-expanded'),
        body: getComputedStyle(g.querySelector('.cg-body')).display, an: getComputedStyle(g.querySelector('.cg-body')).animationName,
        chev: getComputedStyle(g.querySelector('.cg-chev')).transform,
        rows: [...g.querySelectorAll('.sec-row')].filter(r => r.offsetParent).length } });
    ok(o.open && o.exp === 'true' && o.body === 'flex' && o.rows === 4 && o.an === 'cgIn',
      `[${theme}] **ضغطة على المادة تفتح شعبها الأربع** (بحركة خفيفة، وaria-expanded) — ${JSON.stringify(o)}`);
    await pg.waitForTimeout(350);
    o = await run(pg, () => getComputedStyle(document.querySelector('#resultsList .course-card[data-code="MEEN 3311"] .cg-chev')).transform);
    ok(/^matrix\(-1, /.test(String(o)), `[${theme}] والسهم ينقلب — ${o}`);
    await shot(pg, `cards-open-${theme}.png`, '#resultsList .course-card[data-code="MEEN 3311"]');
    await run(pg, () => renderResults());
    cs = await run(pg, CARDS);
    ok(card(cs, 'MEEN 3311').open && cs.filter(c => c.open).length === 1,
      `[${theme}] **إعادة الرسم (إضافة · مراقبة · فلتر) ما تطويها** — والباقي مطوي كما هو`);
    await run(pg, () => document.querySelector('#resultsList .course-card[data-code="MEEN 3311"] .cg-head').click());
    cs = await run(pg, CARDS);
    ok(!card(cs, 'MEEN 3311').open && card(cs, 'MEEN 3311').exp === 'false', `[${theme}] وضغطة ثانية تطويها`);
    await run(pg, () => document.querySelector('#resultsList .course-card[data-code="MEEN 3311"] .cg-head').click());

    /* ── ٦) سطر الشعبة ── */
    let r = await run(pg, ROW, '30011');
    ok(r && /شعبة 101/.test(r.text) && /طلاب/.test(r.text) && r.badge === 'OPEN' && /CRN 30011/.test(r.text) && /Smith, John/.test(r.text),
      `[${theme}] **السطر: «شعبة 101» · طلاب · OPEN · الدكتور · CRN** — ${r && r.text}`);
    eq(r && r.when, ['اثنين · أربعاء 08:00–09:15 M-CORE - G034'], `[${theme}] **الأيام والوقت والقاعة سطر وحد** («MW» · «0800 - 0915» ⇒ «اثنين · أربعاء 08:00–09:15»)`);
    eq(r && r.timeDir, 'ltr', `[${theme}] والوقت باتجاه لاتيني (ما ينقلب وسط العربي)`);
    const edges = await run(pg, () => { const a = document.querySelector('.sec-row.is-open'), b = document.querySelector('.sec-row.is-close');
      const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const rgb = c => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const x = getComputedStyle(d).color; d.remove(); return x };
      return { o: getComputedStyle(a).borderInlineStartColor, c: getComputedStyle(b).borderInlineStartColor, open: rgb(v('--open')), close: rgb(v('--close')),
        w: getComputedStyle(a).borderInlineStartWidth } });
    ok(edges.o === edges.open && edges.c === edges.close && edges.w === '3px',
      `[${theme}] **الحالة بلون طرف السطر**: أخضر للمفتوحة وأحمر للمقفلة — ${JSON.stringify(edges)}`);
    ok(r && r.add && r.add.t === '🔒 أضف' && /locked/.test(r.add.cls) && r.bell && !r.bell.shown,
      `[${theme}] **«🔒 أضف» لمادة متطلبها ناقص**، والمفتوحة بلا «راقب» — ${JSON.stringify(r && [r.add, r.bell])}`);
    r = await run(pg, ROW, '30012');
    ok(r && r.bell && r.bell.shown && r.bell.t === '🔕 راقب' && !/\bon\b/.test(r.bell.cls),
      `[${theme}] **المقفلة: «🔕 راقب» بكلمة** (كان أيقونة 🔕 لحالها) — ${JSON.stringify(r && r.bell)}`);
    ok(r && r.warn && /MATH 2301 §101/.test(r.warn), `[${theme}] **التعارض على سطره** («يتعارض مع: MATH 2301 §101») — ${r && r.warn}`);
    r = await run(pg, ROW, '30013');
    ok(r && r.okTag && /ما يتعارض/.test(r.okTag), `[${theme}] **والسليمة «✓ ما يتعارض مع جدولك»** (الدليل يوعد فيها) — ${r && r.okTag}`);
    r = await run(pg, ROW, '30014');
    ok(r && /طالبات/.test(r.text) && /شعبة 201/.test(r.text), `[${theme}] شعبة 201 «طالبات» — ${r && r.text}`);

    /* PHYS 1421 §101: صفّان ⇒ سطر وحد باجتماعين ودكتورين، والتعارض من المعمل */
    await run(pg, () => document.querySelector('#resultsList .course-card[data-code="PHYS 1421"] .cg-head').click());
    r = await run(pg, ROW, '30031');
    const n31 = await run(pg, () => document.querySelectorAll('#resultsList .sec-row[data-crn="30031"]').length);
    ok(n31 === 1 && r && r.when.length === 2 && /اثنين · أربعاء 09:30–10:45/.test(r.when[0]) && /خميس 13:00–15:50 M-SCI - L105/.test(r.when[1]),
      `[${theme}] **المحاضرة والمعمل بنفس CRN سطر وحد باجتماعين** (كانا بطاقتين بنفس الـCRN) — ${n31} · ${JSON.stringify(r && r.when)}`);
    ok(r && /Brown, Mark/.test(r.text) && /Lee, Ann/.test(r.text), `[${theme}] ودكتور كل اجتماع — ${r && r.text}`);
    ok(r && r.warn && /ENGL 2311 §101/.test(r.warn),
      `[${theme}] **التعارض من كل اجتماعاتها**: معملها الخميس يتعارض مع ENGL 2311 (كان يُفحص الاجتماع الأول بس) — ${r && r.warn}`);
    ok(r && r.add && /blocked/.test(r.add.cls) && r.add.t === '+ أضف', `[${theme}] و«+ أضف» بلون التحذير — ${JSON.stringify(r && r.add)}`);

    /* «معمل» من العنوان وحده */
    await run(pg, () => ['CHEM 1311', 'ENGL 2311', 'BIOL 1301', 'ASSE 3211', 'MEEN 3111'].forEach(k =>
      document.querySelector(`#resultsList .course-card[data-code="${k}"] .cg-head`).click()));
    const labs = await run(pg, () => Object.fromEntries(['30021', '30023', '30024', '30041', '30051', '30052', '30061', '30071']
      .map(k => [k, !!document.querySelector(`.sec-row[data-crn="${k}"] .sr-lab`)])));
    eq(labs, { 30021: false, 30023: true, 30024: true, 30041: false, 30051: false, 30052: true, 30061: false, 30071: true },
      `[${theme}] **«معمل» على المعامل وحدها** — العنوان ينتهي بـ LAB (و«Lab»)؛ ENGL وBIOL (كود ينتهي بـL) و«LEC/LAB» محاضرات`);
    const isLab = await run(pg, rows => rows.map(c => isLabSection(c)), ['30041', '30051', '30061', '30071', '30023']
      .map(k => COURSES.find(c => c.crn === k)));
    eq(isLab, [false, false, false, true, true], `[${theme}] **isLabSection نفسها** (تحذير «ناقص معمل» في جدولي يستعملها): ENGL · BIOL · LEC/LAB لا، Lab · LAB نعم`);
    r = await run(pg, ROW, '30021');
    ok(r && /in-schedule/.test(r.cls) && r.add && r.add.t === '✓ في جدولك' && /added/.test(r.add.cls) && !r.okTag && !r.warn,
      `[${theme}] **اللي في جدوله: «✓ في جدولك» وسطره بلون الجدول** — ${JSON.stringify(r && r.add)}`);

    /* ── المراقبة: الأزرار من حالة المراقبة نفسها ── */
    const TERM = await run(pg, () => document.getElementById('term').value);
    await run(pg, t => {
      monitored = [{ id: 1, scope: 'section', crn: '30013', course_code: 'MEEN 3311', section: '103', term: t },
                   { id: 2, scope: 'section', crn: '30011', course_code: 'MEEN 3311', section: '101', term: t },
                   { id: 3, scope: 'course', course_code: 'CHEM 1311', term: t }];
      renderResults();
    }, TERM);
    cs = await run(pg, CARDS);
    eq(card(cs, 'MEEN 3311').notes, ['🔔 تراقب: الشعب 101 · 103'], `[${theme}] **«🔔 تراقب: الشعب 101 · 103» على المادة**`);
    r = await run(pg, ROW, '30013');
    ok(r && r.bell && r.bell.shown && r.bell.t === '🔔 تراقبها' && /\bon\b/.test(r.bell.cls), `[${theme}] **المراقَبة «🔔 تراقبها»** — ${JSON.stringify(r && r.bell)}`);
    r = await run(pg, ROW, '30011');
    ok(r && r.bell && r.bell.shown && r.bell.t === '🔔 تراقبها',
      `[${theme}] **مراقَبة وفتحت: الزر يبقى** عشان يوقفها من هنا (كان يختفي مع OPEN) — ${JSON.stringify(r && r.bell)}`);
    const chem = card(cs, 'CHEM 1311');
    ok((chem.notes || []).includes('📡 تراقب كل الشعب') && chem.all && chem.all.on && chem.all.t === '📡 تراقب كل الشعب',
      `[${theme}] **مراقبة كل الشعب: زر وحد تحت المادة** («📡 تراقب كل الشعب») وملاحظة فوق — ${JSON.stringify(chem.all)}`);
    const nAll = await run(pg, () => [document.querySelectorAll('#resultsList .cg-all').length, document.querySelectorAll('#resultsList .course-card').length,
      document.querySelectorAll('#resultsList .sec-row .cg-all, #resultsList .sec-row [onclick*="toggleMonitorAll"]').length]);
    ok(nAll[0] === nAll[1] && nAll[2] === 0, `[${theme}] **📡 مرة لكل مادة** لا على كل شعبة — ${JSON.stringify(nAll)}`);
    eq(card(cs, 'MEEN 3311').all, { t: '📡 راقب كل الشعب', on: false }, `[${theme}] و«📡 راقب كل الشعب» للمادة اللي ما تنراقب`);
    await run(pg, () => { monitored = []; renderResults() });

    /* ── ٧) العدّادات هي الفلتر ── */
    await pg.waitForTimeout(650);
    let st = await run(pg, () => ({ bar: !!document.getElementById('filterBar'),
      tiles: [...document.querySelectorAll('#statsBar .stat-box')].map(b => [b.tagName, b.dataset.f, b.classList.contains('on'), b.getAttribute('aria-pressed')]),
      v: ['statTotal', 'statOpen', 'statClose'].map(cntVal) }));
    eq(st.bar, false, `[${theme}] **سطر أزرار الفلتر انشال** — العدّادات مكانه`);
    eq(st.tiles, [['BUTTON', 'all', true, 'true'], ['BUTTON', 'open', false, 'false'], ['BUTTON', 'close', false, 'false']],
      `[${theme}] **العدّادات أزرار**، و«إجمالي» المختار`);
    eq(st.v, [String(SECS(COURSES)), String(OPEN_SECS(COURSES)), String(SECS(COURSES) - OPEN_SECS(COURSES))],
      `[${theme}] **تعدّ شعباً لا صفوفاً** (${COURSES.length} صف = ${SECS(COURSES)} شعبة — PHYS 1421 §101 صفّان)`);
    await tap(pg, '#statsBar .stat-box[data-f="open"]');
    await pg.waitForTimeout(80);
    st = await run(pg, () => ({ on: [...document.querySelectorAll('#statsBar .stat-box.on')].map(b => b.dataset.f),
      rows: [...document.querySelectorAll('#resultsList .sec-row')].map(r => r.classList.contains('is-open')),
      groups: document.querySelectorAll('#resultsList .course-card').length, secs: (document.getElementById('visibleSecs') || {}).textContent }));
    const openGroups = new Set(COURSES.filter(c => c.status === 'OPEN').map(c => c.courseCode)).size;
    ok((st.on || []).join() === 'open' && (st.rows || []).length === OPEN_SECS(COURSES) && st.rows.every(Boolean) && st.groups === openGroups && st.secs === String(OPEN_SECS(COURSES)),
      `[${theme}] **ضغطة «مفتوح»: المفتوحة بس** (${openGroups} مادة · ${OPEN_SECS(COURSES)} شعبة) — ${JSON.stringify(st)}`);
    cs = await run(pg, CARDS);
    eq([card(cs, 'CHEM 1311').title, card(cs, 'CHEM 1311').sums, card(cs, 'CHEM 1311').rows], ['Chemistry for Engineers I', ['شعبتين · كلها مقفلة', 'معملين · واحد مفتوح'], ['30023']],
      `[${theme}] **والمادة اللي ما فتح منها إلا المعمل: اسمها من محاضرتها وملخّصها كامل** — والمعروض المعمل المفتوح بس`);
    await shot(pg, `cards-filter-open-${theme}.png`);
    await tap(pg, '#statsBar .stat-box[data-f="open"]');
    await pg.waitForTimeout(80);
    st = await run(pg, () => ({ on: [...document.querySelectorAll('#statsBar .stat-box.on')].map(b => b.dataset.f), rows: document.querySelectorAll('#resultsList .sec-row').length }));
    eq(st, { on: ['all'], rows: SECS(COURSES) }, `[${theme}] **وضغطة ثانية عليه ترجّع الكل**`);
    await tap(pg, '#statsBar .stat-box[data-f="close"]');
    await pg.waitForTimeout(80);
    st = await run(pg, () => ({ on: [...document.querySelectorAll('#statsBar .stat-box.on')].map(b => b.dataset.f),
      rows: [...document.querySelectorAll('#resultsList .sec-row')].map(r => r.classList.contains('is-close')) }));
    ok((st.on || []).join() === 'close' && (st.rows || []).length === SECS(COURSES) - OPEN_SECS(COURSES) && st.rows.every(Boolean),
      `[${theme}] **«مغلق»: المقفلة بس** — ${JSON.stringify(st)}`);
    await tap(pg, '#statsBar .stat-box[data-f="all"]');
    st = await run(pg, () => [...document.querySelectorAll('#statsBar .stat-box.on')].map(b => b.dataset.f));
    eq(st, ['all'], `[${theme}] و«إجمالي» يرجّع الكل`);

    /* ── الفلتر النصي: مادة وحدة أو دكتور ⇒ مفتوحة ── */
    await run(pg, () => { const f = document.getElementById('courseFilter'); f.value = 'MEEN 3311'; f.dispatchEvent(new Event('input')) });
    cs = await run(pg, CARDS);
    ok(cs.length === 1 && cs[0].open && (cs[0].rows || []).length === 4, `[${theme}] **بحث بكود المادة: بطاقتها مفتوحة على طول** — ${JSON.stringify(cs.map(c => [c.code, c.open]))}`);
    await run(pg, () => { const f = document.getElementById('courseFilter'); f.value = 'Lee, Ann'; f.dispatchEvent(new Event('input')) });
    cs = await run(pg, CARDS);
    ok(cs.length === 2 && cs.every(c => c.open) && card(cs, 'PHYS 1421').rows.join() === '30031' && card(cs, 'CHEM 1311').rows.join() === '30023,30024',
      `[${theme}] **بحث باسم دكتور: شعبه مفتوحة** — ${JSON.stringify(cs.map(c => [c.code, c.open, c.rows]))}`);
    r = await run(pg, ROW, '30031');
    ok(r && r.when.length === 2, `[${theme}] **ودكتور المعمل يجيب الشعبة باجتماعيها** (كان يجيب صف المعمل بس) — ${JSON.stringify(r && r.when)}`);
    await run(pg, () => { const f = document.getElementById('courseFilter'); f.value = ''; f.dispatchEvent(new Event('input')) });

    /* ── ٨) الإضافة: السطر ينبض، ورقم «جدولي» ينط ويزيد ١ ── */
    let b0 = await run(pg, () => document.getElementById('schedBadge').textContent);
    eq(b0, '3', `[${theme}] رقم «جدولي» = شعب الجدول (٣)`);
    await setOpen(pg, 'PHYS 1421', true);
    await run(pg, () => document.querySelector('.sec-row[data-crn="30032"] .sr-btn.add').click());
    await pg.waitForTimeout(60);
    let ad = await run(pg, () => { const r = document.querySelector('.sec-row[data-crn="30032"]'), b = document.getElementById('schedBadge');
      return { inSch: schedule.some(s => s.crn === '30032'), row: r.className, an: getComputedStyle(r).animationName,
        btn: r.querySelector('.sr-btn.add').textContent.trim(), badge: b.textContent, bump: b.classList.contains('bump'), ban: getComputedStyle(b).animationName,
        open: r.closest('.course-card').classList.contains('open'), note: [...r.closest('.course-card').querySelectorAll('.cg-note')].map(x => x.textContent.trim()) } });
    ok(ad.inSch && /in-schedule/.test(ad.row) && /just-added/.test(ad.row) && ad.an === 'addPop' && ad.btn === '✓ في جدولك',
      `[${theme}] **أضفت: السطر يتلوّن وينبض** و«✓ في جدولك» — ${JSON.stringify(ad)}`);
    ok(ad.badge === '4' && ad.bump && ad.ban === 'bump', `[${theme}] **ورقم «جدولي» ينط ويزيد** (3 ⇒ 4) — ${JSON.stringify([ad.badge, ad.bump, ad.ban])}`);
    ok(ad.open, `[${theme}] والمادة تبقى مفتوحة بعد الإضافة`);
    eq(ad.note, ['✓ في جدولك: شعبة 102'], `[${theme}] وملاحظتها «✓ في جدولك: شعبة 102»`);
    await run(pg, () => document.querySelector('.sec-row[data-crn="30031"] .sr-btn.add').click());
    ad = await run(pg, () => ({ rows: schedule.filter(s => s.crn === '30031').length, badge: document.getElementById('schedBadge').textContent,
      note: [...document.querySelector('#resultsList .course-card[data-code="PHYS 1421"]').querySelectorAll('.cg-note')].map(x => x.textContent.trim()) }));
    eq(ad, { rows: 2, badge: '5', note: ['✓ في جدولك: الشعب 101 · 102'] },
      `[${theme}] **شعبة بصفّين (محاضرة ومعمل بنفس CRN): الجدول ياخذ الاثنين والرقم يزيد ١ لا ٢** (كان يعدّ صفوفاً)`);
    await run(pg, () => document.querySelector('.sec-row[data-crn="30032"] .sr-btn.add').click());
    ad = await run(pg, () => { const b = document.getElementById('schedBadge'); const r = document.querySelector('.sec-row[data-crn="30032"]');
      return { inSch: schedule.some(s => s.crn === '30032'), badge: b.textContent, row: r.className, btn: r.querySelector('.sr-btn.add').textContent.trim() } });
    ok(!ad.inSch && ad.badge === '4' && !/in-schedule|just-added/.test(ad.row) && ad.btn === '+ أضف',
      `[${theme}] **وضغطة على «✓ في جدولك» تشيلها** (4) — ${JSON.stringify(ad)}`);
    const lk = await run(pg, () => { const n = schedule.length; document.querySelector('.sec-row[data-crn="30013"] .sr-btn.add').click();
      return { same: schedule.length === n, toast: (document.getElementById('toast') || {}).textContent || '' } });
    ok(lk.same && /MEEN 2311|ما تقدر|تقدر/.test(lk.toast), `[${theme}] **«🔒 أضف» ما يضيف** ويقول ليش — ${JSON.stringify(lk)}`);

    /* ── التحديث الصامت: في مكانه، والملخّص والعدّادات معه ── */
    ok(await setOpen(pg, 'ENGL 2311', false), `[${theme}] ENGL 2311 مطوية قبل التحديث`);
    await run(pg, () => { window.__row = document.querySelector('.sec-row[data-crn="30012"]'); window.__first = document.querySelector('#resultsList .course-card') });
    const v0 = await run(pg, () => Number(cntVal('statOpen')));
    COURSES = COURSES.map(c => c.crn === '30012' || c.crn === '30041' ? Object.assign({}, c, { status: 'OPEN' }) : c);
    await run(pg, () => quietRefresh());
    await pg.waitForTimeout(60);
    const q = await run(pg, () => { const r = document.querySelector('.sec-row[data-crn="30012"]'), g = r.closest('.course-card');
      const e = document.querySelector('#resultsList .course-card[data-code="ENGL 2311"]');
      return { same: r === window.__row && document.querySelector('#resultsList .course-card') === window.__first,
        cls: r.className, badge: r.querySelector('.badge').textContent, bcls: r.querySelector('.badge').className,
        bell: r.querySelector('.sr-btn.bell').hidden, sums: [...g.querySelectorAll('.cg-sum')].map(x => x.textContent.trim()),
        engl: { open: e.classList.contains('open'), changed: e.classList.contains('just-changed'), sums: [...e.querySelectorAll('.cg-sum')].map(x => x.textContent.trim()) },
        v: Number(cntVal('statOpen')) } });
    ok(q.same && /is-open/.test(q.cls) && !/is-close/.test(q.cls) && /just-changed/.test(q.cls) && q.badge === 'OPEN' && /\bopen\b/.test(q.bcls) && q.bell === true,
      `[${theme}] **شعبة فتحت وهو يقرأ: سطرها نفسه يتحدّث** (بلا إعادة رسم — مكانه ما يضيع) — ${JSON.stringify(q)}`);
    eq(q.sums, ['4 شعب · 2 مفتوحة'], `[${theme}] **وملخّص مادتها يتحدّث** («4 شعب · 2 مفتوحة»)`);
    ok(!!q.engl && !q.engl.open && q.engl.changed && (q.engl.sums || []).join() === 'شعبة وحدة · مفتوحة',
      `[${theme}] **ومادة مطوية: الوميض على بطاقتها وملخّصها** — ${JSON.stringify(q.engl)}`);
    eq(q.v, v0 + 2, `[${theme}] **وعدّاد «مفتوح» يتحدّث** (+2)`);

    /* ── بحث جديد: الطي يرجع للافتراض ── */
    COURSES = DATA();
    await search(pg);
    cs = await run(pg, CARDS);
    ok(cs.length > 1 && cs.every(c => !c.open && c.exp === 'false'), `[${theme}] **بحث جديد: كل المواد مطوية من جديد** (الضغطات القديمة تنمسح) — ${cs.filter(c => c.open).map(c => c.code)}`);

    /* ── البوت والدليل يشرحان الأزرار اللي فعلاً في الصفحة ── */
    await setOpen(pg, 'MEEN 3311', true);
    /* الحالتين: شعبة تنراقب («🔔 تراقبها») وغيرها («🔕 راقب») */
    const btns = await run(pg, t => {
      monitored = [{ id: 9, scope: 'section', crn: '30013', course_code: 'MEEN 3311', section: '103', term: t }];
      renderResults();
      const x = [...document.querySelectorAll('#resultsList .sr-btn, #resultsList .cg-all')].map(b => b.textContent.trim());
      monitored = []; renderResults();
      return x;
    }, TERM);
    const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const wi = SRV.indexOf("text === '/watch'"), watchTxt = wi > 0 ? SRV.slice(wi, SRV.indexOf('aiTgRoute', wi)) : '';
    const quoted = (watchTxt.match(/«([^»]+)»/g) || []).map(x => x.slice(1, -1));
    ok(quoted.length >= 3 && quoted.every(x => btns.includes(x)),
      `[${theme}] **/watch في البوت يسمّي الأزرار بأسمائها في الصفحة** («🔕 راقب» · «🔔 تراقبها» · «📡 راقب كل الشعب») — ${JSON.stringify(quoted)}`);
    ok(!/على أي شعبة منها/.test(watchTxt), `[${theme}] وما يقول «اضغط 📡 على أي شعبة» (صار مرة تحت المادة)`);
    const G = fs.readFileSync(SHARED, 'utf8');
    ok(/اضغط المادة تنفتح شعبها، و<b>\+ أضف<\/b>/.test(G) && btns.includes('+ أضف') && !/اضغط <b>➕<\/b> على أي شعبة/.test(G),
      `[${theme}] **الدليل داخل الموقع: «اضغط المادة تنفتح شعبها، و+ أضف»** (كان «اضغط ➕» والزر ما عاد ➕)`);

    /* ── الإنجليزي ── */
    await run(pg, () => toggleLang());
    cs = await run(pg, CARDS);
    r = await run(pg, ROW, '30012');
    ok((card(cs, 'MEEN 3311').sums || []).join() === '4 sections · 1 open' && (card(cs, 'CHEM 1311').sums || []).join() === '2 sections · all closed,2 labs · 1 open'
      && r && /Sec 102/.test(r.text) && r.add && r.add.t === '🔒 Add' && r.bell && r.bell.t === '🔕 Watch' && /Mon · Wed|Sun · Tue/.test(r.when.join()),
      `[${theme}] **بالإنجليزي** — ${JSON.stringify([card(cs, 'MEEN 3311').sums, card(cs, 'CHEM 1311').sums, r && r.when, r && r.add, r && r.bell])}`);
    const hdEn = await run(pg, () => document.querySelector('.results-count').textContent.replace(/\s+/g, ' ').trim());
    ok(/courses · \d+ sections/.test(hdEn), `[${theme}] والعنوان «… courses · … sections» — ${hdEn}`);
    await run(pg, () => toggleLang());

    /* ── المقاس ── */
    await run(pg, () => { document.querySelectorAll('#resultsList .course-card:not(.open) .cg-head').forEach(h => h.click()) });
    const lay = await run(pg, () => {
      const bad = [];
      document.querySelectorAll('#resultsList .sec-row').forEach(r => {
        const rr = r.getBoundingClientRect();
        r.querySelectorAll('.sr-btn').forEach(b => { if (b.hidden) return; const br = b.getBoundingClientRect();
          if (br.left < rr.left - 0.5 || br.right > rr.right + 0.5 || br.height < 32) bad.push(r.dataset.crn + ':' + Math.round(br.left - rr.left) + '/' + Math.round(br.height)) });
        r.querySelectorAll('.sr-when,.sr-doc,.sr-top').forEach(x => { if (x.scrollWidth > x.clientWidth + 1) bad.push(r.dataset.crn + ':wrap') });
      });
      const f = parseFloat(getComputedStyle(document.querySelector('.sr-btn')).fontSize);
      return { bad, over: document.documentElement.scrollWidth - innerWidth, f };
    });
    ok(!!lay.bad && lay.bad.length === 0 && lay.f >= 12, `[${theme}] **على ٣٩٠: الأزرار داخل سطرها وطولها ٣٢ على الأقل، والنص ما يطلع برا** — ${JSON.stringify(lay)}`);
    ok(lay.over <= 1, `[${theme}] ما فيه تمرير أفقي — ${lay.over}`);
    await shot(pg, `cards-all-open-${theme}.png`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── «تقليل الحركة» ── */
  {
    const { ctx, pg, errs } = await open({ reduce: true });
    await search(pg);
    const an = await run(pg, () => {
      const G = () => document.querySelector('#resultsList .course-card[data-code="PHYS 1421"]');
      G().querySelector('.cg-head').click();
      const bodyAn = getComputedStyle(G().querySelector('.cg-body')).animationName;
      document.querySelector('.sec-row[data-crn="30032"] .sr-btn.add').click();
      const r = document.querySelector('.sec-row[data-crn="30032"]'), b = document.getElementById('schedBadge');
      return { body: bodyAn, row: getComputedStyle(r).animationName, badge: getComputedStyle(b).animationName, n: b.textContent,
        card: getComputedStyle(G()).animationName };
    });
    eq(an, { body: 'none', row: 'none', badge: 'none', n: '4', card: 'none' },
      '**«تقليل الحركة»: الفتح والإضافة والرقم بلا حركة** — والرقم يزيد كالعادة');
    ok(errs.length === 0, '(تقليل الحركة) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { fail++; out.push('  ✗ انهار: ' + (e && e.stack || e)); done() });
