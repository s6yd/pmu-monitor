/* مشاركة جدول الاختبارات — طلب محمد (١٩ نوفمبر ٢٠٢٦: «ابي تسوي طريقة افضل لطباعة او نشر جدول الاختبارات بحيث
   الطالب يقدر ينشره لقروبه … ويكون افضل شكله ومنها ينشر موقعنا»). Chromium على ٣٩٠:
   ١) بطاقة «اختباراتك النهائية»: **كل اختبار مرة** — المحاضرة والمعمل بنفس CRN صفّان في الجدول، فكان الاختبار يطلع
      مرتين ومعه «اختبارين بنفس الوقت» كاذب، وشعبتان بديلتان لنفس المادة بنفس الموعد مو تعارض. والتعارض الحقيقي بين
      مادتين يبقى. وورقة طباعة الجدول نفس الشي (كانت نسخة ثانية من المطابقة).
   ٢) زر «📤 شارك جدول اختباراتك» يفتح لوحاً فيه الصورة: عرضها ١٠٨٠ ومرسومة فعلاً، بالثيمين، وكل اختبار بلون مادته.
   ٣) الصورة والنص من نفس البيانات: الأيام بالترتيب بأسمائها وتواريخها، «12:00 م»، القاعة، والعنوان مفكوك.
   ٤) المشاركة بملف PNG ونص فيه رابط موقعنا · الحفظ ينزّل PNG · النسخ ينسخ النص · الطباعة صورة فاتحة وحدها.
   ٥) رابط الدعوة في النص لمن عنده كود (والسطر اللي يقوله)، وللزائر رابط الموقع.
   ٦) الإنجليزي بأسمائه، واللوح ما يطلع برّا الشاشة، وأزراره تنضغط.
   ٧) الدليل يسمّي الزر باسمه في الصفحة.

   node tests/test-finals-share.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nمشاركة الاختبارات: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* جدول الطالب بصيغة الجامعة حرفاً بحرف (الوقت بلا نقطتين · الأيام حروف · الدكاترة لاتيني) — بيانات مخترعة */
const C = (crn, code, title, sec, days, time, ins, room) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: 'CLOSE', gender: 'M' });
const SCHED = [
  C('30011', 'MEEN 3311', 'Thermodynamics I', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034'),
  C('30021', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'UT', '0800 - 0915', 'Khan, Imran', 'M-SCI - 101'),
  /* معمل بـCRN خاص — ما له اختبار، ويجتمع مرتين (صفّان) */
  C('30023', 'CHEM 1311', 'Chemistry for Engineers I LAB', '111', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L201'),
  C('30023', 'CHEM 1311', 'Chemistry for Engineers I LAB', '111', 'U', '1300 - 1550', 'Lee, Ann', 'M-SCI - L201'),
  /* المحاضرة والمعمل بنفس CRN — اختبار واحد */
  C('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'MW', '0930 - 1045', 'Brown, Mark', 'M-SCI - 201'),
  C('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'R', '1000 - 1250', 'Lee, Ann', 'M-SCI - L105'),
  /* شعبتان بديلتان لنفس المادة (الجدول مخطِّط) — اختبارهما الموحّد بنفس الموعد */
  C('30091', 'MATH 2301', 'Calculus III', '101', 'UTR', '1000 - 1050', 'Brown, Mark', 'M-CORE - G101'),
  C('30092', 'MATH 2301', 'Calculus III', '102', 'UTR', '1100 - 1150', 'Lee, Ann', 'M-CORE - G102'),
  C('30061', 'UNIV 1311', 'Critical Thinking', '109', 'T', '1400 - 1515', 'Doe, Jane', 'M-CORE - F012'),
];
/* مادة ثانية بنفس موعد الثرمو — تعارض حقيقي */
const SCHED_CLASH = SCHED.concat([C('30101', 'ENGL 1301', 'Technical & Professional Commun.', '101', 'UT', '1100 - 1215', 'Doe, Jane', 'M-CORE - F020')]);

/* جدول الاختبارات بصيغة الجامعة كما يرجّعه السيرفر (cell يفك &amp; و&#39; بس — «&#x27;» تبقى) */
const X = (crn, code, title, sec, bld, room, day, date, hour) => ({ crn, code, title, section: sec, instructor: 'Doe, Jane',
  building: bld, room, day, date, hour, gender: 'M' });
const EXAMS = [
  X('30021', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'M-COE', 'F063', 'Sunday', 'Dec 20, 2026', '3:00PM'),
  X('30011', 'MEEN 3311', 'Thermodynamics I', '101', 'M-CORE', 'F155', 'Sunday', 'Dec 20, 2026', '12:00PM'),
  X('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'M-SCI', 'G012', 'Tuesday', 'Dec 22, 2026', '9:00AM'),
  X('30091', 'MATH 2301', 'Calculus III', '101', 'M-CORE', 'F150', 'Monday', 'Dec 28, 2026', '9:00AM'),
  X('30092', 'MATH 2301', 'Calculus III', '102', 'M-CORE', 'F151', 'Monday', 'Dec 28, 2026', '9:00AM'),
  X('30061', 'UNIV 1311', 'Critical Think&#x27;g', '109', 'M-CCES', 'F053', 'Wednesday', 'Dec 23, 2026', '12:00PM'),
  X('30101', 'ENGL 1301', 'Technical & Professional Commun.', '101', 'M-CORE', 'F160', 'Sunday', 'Dec 20, 2026', '12:00PM'),
  X('39999', 'ACCT 2311', 'Principles of Accounting I', '201', 'F-COBA', 'G101', 'Thursday', 'Dec 24, 2026', '9:00AM'),
];
const STATUS = { active: false, reason: 'offseason', env: 'prod', freeBeta: false, term: '202710', regTerm: '202710',
  nextRegTerm: '202720', canWatch: false, window: null, build: '"x"',
  plans: { termHalalas: 1900, pushoverHalalas: 1500, friendDiscountHalalas: 300, referrerCreditHalalas: 500, freeMonitors: 2, freeSchedules: 1 } };
const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
/* المشاركة والحافظة في الجوال — Chromium على لينكس ما فيه Web Share */
const SHARE_STUB = () => {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: d => !!(d && d.files && d.files.length) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async d => {
    const f = d.files && d.files[0];
    window.__SHARED = { n: (d.files || []).length, type: f && f.type, name: f && f.name, size: f && f.size, text: d.text,
      png: f ? Array.from(new Uint8Array(await f.slice(0, 4).arrayBuffer())) : null };
    if (window.__SHARE_ERR) { const e = new Error('x'); e.name = window.__SHARE_ERR; throw e }
  } });
};
const CLIP_STUB = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__COPIED = t } } });
};

const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255] };
const near = (a, b, d = 14) => Array.isArray(a) && a.length >= 3 && Math.abs(a[0] - b[0]) <= d && Math.abs(a[1] - b[1]) <= d && Math.abs(a[2] - b[2]) <= d;

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
    if (u === '/api/monitor-status') return send(STATUS);
    if (u === '/api/finals') return send({ success: true, exams: EXAMS });
    if (u === '/api/courses') return send({ success: true, count: 0, courses: [] });
    send({});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  const open = async ({ theme = 'dark', sched = SCHED, share = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, acceptDownloads: true });
    if (share) await ctx.addInitScript(SHARE_STUB);
    await ctx.addInitScript(CLIP_STUB);
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(([sch, theme]) => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"'); localStorage.setItem('theme', theme);
      localStorage.setItem('pmu_schedules', JSON.stringify([sch, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(sch));
      localStorage.setItem('pmu_guestbar_off', String(Date.now()));
    } catch (e) {} }, [sched, theme]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(300);
    return { ctx, pg, errs };
  };
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  const tap = (pg, sel) => pg.click(sel, { timeout: 4000 }).then(() => true, () => false);
  const showFinals = async pg => {
    await run(pg, () => switchTab('sched'));
    await tap(pg, '#finBtn');
    await pg.waitForSelector('#finBody .fin-row', { timeout: 6000 }).catch(() => {});
  };
  const CARD = () => ({
    rows: [...document.querySelectorAll('#finBody .fin-row')].map(r => ({
      code: r.querySelector('.fin-code').textContent.trim(), clash: r.classList.contains('clash') })),
    warn: !!document.querySelector('#finBody .fin-warn'),
    missing: ([...document.querySelectorAll('#finBody .fin-note')].find(n => n.querySelector('b')) || { textContent: '' }).textContent,
    share: (document.getElementById('finShareBtn') || {}).textContent || null,
  });
  const PRINT = () => { renderSchedule(); return [...document.querySelectorAll('#printSheet .ps-fin')].map(r => ({
    code: r.querySelector('.ps-fin-code').textContent.trim(), cl: r.classList.contains('cl') })) };
  /* بكسل من الصورة المعروضة (بإحداثيات الصورة الأصلية) */
  const PIX = async (pg, sel, pts) => run(pg, async ([sel, pts]) => {
    const im = document.querySelector(sel);
    if (!im) return null;
    if (!im.complete) await new Promise(r => { im.onload = r; im.onerror = r });
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const px = pts.map(([a, b]) => Array.from(x.getImageData(a, b, 1, 1).data));
    /* تنوّع الألوان في عيّنة — صورة فاضية لون واحد */
    const set = new Set();
    for (let i = 0; i < 400; i++) { const d = x.getImageData((i * 97) % c.width, (i * 211) % c.height, 1, 1).data; set.add(d[0] + ',' + d[1] + ',' + d[2]) }
    return { w: im.naturalWidth, h: im.naturalHeight, px, colors: set.size };
  }, [sel, pts]);

  /* ══ ١) البطاقة وورقة الطباعة: كل اختبار مرة، والتعارض بين مادتين مختلفتين ══ */
  {
    const { ctx, pg, errs } = await open();
    await showFinals(pg);
    const K = await run(pg, CARD);
    const codes = (K.rows || []).map(r => r.code);
    eq(codes, ['MEEN 3311 §101', 'CHEM 1311 §101', 'PHYS 1421 §101', 'UNIV 1311 §109', 'MATH 2301 §101', 'MATH 2301 §102'],
      '**كل اختبار مرة وبترتيبه** — المحاضرة والمعمل بنفس CRN كانا يطلّعان اختبار الفيزياء مرتين');
    ok(K.warn === false && (K.rows || []).every(r => !r.clash),
      '**بلا «اختبارين بنفس الوقت» كاذب**: نسخة الفيزياء الثانية وشعبتا الماث البديلتان مو تعارض — ' + JSON.stringify(K.rows));
    ok((K.missing.match(/CHEM 1311 §111/g) || []).length === 1, '«مواد ما لقيت لها اختبار» تذكر معمل الكيمياء مرة (صفّاه بنفس CRN) — ' + K.missing);
    eq(K.share, '📤 شارك جدول اختباراتك', '**زر «📤 شارك جدول اختباراتك» في البطاقة**');
    const PS = await run(pg, PRINT);
    eq((PS || []).map(r => r.code), ['MEEN 3311 §101', 'CHEM 1311 §101', 'PHYS 1421 §101', 'UNIV 1311 §109', 'MATH 2301 §101', 'MATH 2301 §102'],
      '**وورقة طباعة الجدول نفس الاختبارات** (كانت مطابقة ثانية فيها نفس التكرار)');
    ok(Array.isArray(PS) && PS.every(r => !r.cl), 'وبلا تعارض كاذب في الورقة');
    eq(errs, [], 'بلا أخطاء في الصفحة');
    await ctx.close();
  }
  {
    const { ctx, pg, errs } = await open({ sched: SCHED_CLASH });
    await showFinals(pg);
    const K = await run(pg, CARD);
    ok(K.warn === true, '**والتعارض الحقيقي يبقى**: الثرمو والإنجليزي بنفس اليوم والساعة ⇒ التحذير');
    eq((K.rows || []).filter(r => r.clash).map(r => r.code).sort(), ['ENGL 1301 §101', 'MEEN 3311 §101'], 'والسطران المتعارضان وحدهما بالأحمر');
    const PS = await run(pg, PRINT);
    eq((PS || []).filter(r => r.cl).map(r => r.code).sort(), ['ENGL 1301 §101', 'MEEN 3311 §101'], 'وفي ورقة الطباعة كذلك');
    eq(errs, [], 'بلا أخطاء في الصفحة (التعارض)');
    await ctx.close();
  }

  /* ══ ٢–٥) لوح المشاركة بالثيمين ══ */
  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme });
    await showFinals(pg);
    ok(await tap(pg, '#finShareBtn'), `[${theme}] زر المشاركة ينضغط`);
    await pg.waitForSelector('#fsOv.open #fsImg', { timeout: 8000 }).catch(() => {});
    const P = await PIX(pg, '#fsImg', [[5, 5], [837, 378], [837, 548], [180, 40]]);
    ok(P && P.w === 1080 && P.h > 1200 && P.h < 2200, `[${theme}] **الصورة ١٠٨٠ عرض وطولها يتبع الاختبارات** — ${P && P.w}×${P && P.h}`);
    ok(P && P.colors >= 12, `[${theme}] **ومرسومة فعلاً** (ألوان كثيرة لا خلفية وحدها) — ${P && P.colors}`);
    ok(P && near(P.px[0], theme === 'dark' ? [18, 26, 51] : [255, 255, 255]),
      `[${theme}] **خلفية الصورة بثيم الموقع** — ${JSON.stringify(P && P.px[0])}`);
    /* كل اختبار بلون مادته في «جدولي» — الشريط على طرف البطاقة جنب بلاطة اليوم */
    const cols = await run(pg, () => { const m = courseColors(schedule); return [m['MEEN 3311'], m['CHEM 1311']] });
    ok(P && Array.isArray(cols) && near(P.px[1], hexRgb(cols[0]), 8) && near(P.px[2], hexRgb(cols[1]), 8) && cols[0] !== cols[1],
      `[${theme}] **وكل اختبار بلون مادته في «جدولي»** — ${JSON.stringify(P && [P.px[1], P.px[2]])} · ${JSON.stringify(cols)}`);

    /* البيانات اللي ترسمها الصورة ويكتبها النص */
    const M = await run(pg, () => finShareModel());
    eq(M && M.dir, 'rtl', `[${theme}] الصورة من اليمين بالعربي`);
    eq(M && M.sub, 'خريف 2026/2027 · 6 اختبارات', `[${theme}] تحت العنوان الترم وعدد الاختبارات بصيغته`);
    eq(M && M.days && M.days.map(d => [d.day, d.num, d.month, d.items.length]),
      [['الأحد', '20', 'ديسمبر', 2], ['الثلاثاء', '22', 'ديسمبر', 1], ['الأربعاء', '23', 'ديسمبر', 1], ['الاثنين', '28', 'ديسمبر', 2]],
      `[${theme}] **الأيام بالترتيب بأسمائها وتواريخها** (لا «Dec 20, 2026»)`);
    const it = M && M.days ? M.days.flatMap(d => d.items) : [];
    eq(it.map(e => [e.time, e.code, e.sec, e.where]), [
      ['12:00 م', 'MEEN 3311', '101', 'M-CORE · F155'], ['3:00 م', 'CHEM 1311', '101', 'M-COE · F063'],
      ['9:00 ص', 'PHYS 1421', '101', 'M-SCI · G012'], ['12:00 م', 'UNIV 1311', '109', 'M-CCES · F053'],
      ['9:00 ص', 'MATH 2301', '101', 'M-CORE · F150'], ['9:00 ص', 'MATH 2301', '102', 'M-CORE · F151']],
      `[${theme}] **كل اختبار بوقته «12:00 م» وقاعته — والفيزياء مرة**`);
    eq(it[3] && it[3].title, "Critical Think'g", `[${theme}] العنوان مفكوك («&#x27;» من الجامعة ⇒ «'»)`);
    ok(it[4] && it[5] && it[4].color === it[5].color && it[0].color !== it[1].color, `[${theme}] شعبتا الماث لون واحد (نفس المادة)`);

    /* الثيم من اللوح */
    const other = theme === 'dark' ? 'light' : 'dark';
    ok(await tap(pg, `#fsSheet .fs-theme button:nth-child(${other === 'dark' ? 1 : 2})`), `[${theme}] زر الثيم الثاني ينضغط`);
    await pg.waitForFunction(() => document.getElementById('fsImg'), null, { timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(150);
    const P2 = await PIX(pg, '#fsImg', [[5, 5]]);
    ok(P2 && near(P2.px[0], other === 'dark' ? [18, 26, 51] : [255, 255, 255]), `[${theme}] **وتنقلب الصورة ${other === 'dark' ? 'داكنة' : 'فاتحة'}** — ${JSON.stringify(P2 && P2.px[0])}`);
    await tap(pg, `#fsSheet .fs-theme button:nth-child(${theme === 'dark' ? 1 : 2})`);
    await pg.waitForFunction(() => document.getElementById('fsImg'), null, { timeout: 6000 }).catch(() => {});

    /* النص للنسخ */
    const TX = await run(pg, () => fsText());
    const L = typeof TX === 'string' ? TX.split('\n') : [];
    eq(L[0], '📝 جدول اختباراتي النهائية — خريف 2026/2027 · 6 اختبارات', `[${theme}] أول سطر في النص`);
    eq(L.filter(l => /^\*.*\*$/.test(l)), ['*الأحد 20 ديسمبر*', '*الثلاثاء 22 ديسمبر*', '*الأربعاء 23 ديسمبر*', '*الاثنين 28 ديسمبر*'],
      `[${theme}] **أيام النص بالترتيب وعريضة في واتساب**`);
    ok(L.includes('⏰ 12:00 م — MEEN 3311 (101)') && L.includes('📍 M-CORE · F155') && L.includes('Thermodynamics I'),
      `[${theme}] كل اختبار بوقته ومادته وقاعته — ${JSON.stringify(L.slice(2, 6))}`);
    ok(L.filter(l => /PHYS 1421/.test(l)).length === 1 && !L.some(l => /ACCT 2311/.test(l)), `[${theme}] الفيزياء مرة، ومادة مو في جدوله ما تطلع`);
    eq(L[L.length - 1], 'https://jadwalik.com', `[${theme}] **آخر النص رابط موقعنا** (زائر — بلا كود دعوة)`);
    ok(await tap(pg, '#fsSheet .fs-row .fs-b:nth-child(1)'), `[${theme}] «📋 انسخ نص» ينضغط`);
    await pg.waitForTimeout(150);
    eq(await run(pg, () => window.__COPIED), TX, `[${theme}] **وينسخ النص نفسه**`);

    /* الحفظ (بلا Web Share — الزر الأساسي) */
    const lbl = await run(pg, () => (document.querySelector('#fsSheet .fs-b.pri') || {}).textContent);
    eq(lbl, '⬇️ احفظ الصورة', `[${theme}] بلا مشاركة في الجهاز ⇒ «احفظ الصورة» هو الزر الأساسي`);
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 6000 }).catch(() => null), tap(pg, '#fsSheet .fs-b.pri')]);
    ok(!!dl && dl.suggestedFilename() === 'jadwalik-finals-202710.png', `[${theme}] **ينزّل الصورة** باسمها — ${dl && dl.suggestedFilename()}`);
    if (dl) {
      const p = await dl.path().catch(() => null);
      const b = p ? fs.readFileSync(p) : Buffer.alloc(0);
      ok(b.length > 20000 && b.slice(0, 4).toString('hex') === '89504e47', `[${theme}] والملف PNG حقيقي — ${b.length} بايت`);
    }

    /* الطباعة: صورة فاتحة وحدها على الورقة */
    await pg.waitForFunction(() => FS.printReady, null, { timeout: 8000 }).catch(() => {});
    await run(pg, () => { window.print = () => { const im = document.querySelector('#finPrint img');
      window.__PRINTED = { cls: document.documentElement.classList.contains('fin-printing'), w: im && im.naturalWidth,
        sheet: !!document.querySelector('#fsOv.open') } } });
    ok(await tap(pg, '#fsSheet .fs-row .fs-b:nth-child(2)'), `[${theme}] «🖨️ اطبعها» ينضغط`);
    await pg.waitForFunction(() => window.__PRINTED, null, { timeout: 4000 }).catch(() => {});
    const PR = await run(pg, () => window.__PRINTED);
    ok(PR && PR.cls === true && PR.w === 2160, `[${theme}] **الطباعة من الضغطة نفسها بصورة دقتها ضعف** — ${JSON.stringify(PR)}`);
    const PP = await PIX(pg, '#finPrint img', [[8, 8]]);
    ok(PP && near(PP.px[0], [255, 255, 255]), `[${theme}] **وفاتحة دائماً** (الداكنة تاكل الحبر) — ${JSON.stringify(PP && PP.px[0])}`);
    await pg.emulateMedia({ media: 'print' });
    const vis = await run(pg, () => ({ fin: getComputedStyle(document.getElementById('finPrint')).display,
      sheet: getComputedStyle(document.getElementById('printSheet')).display }));
    await pg.emulateMedia({ media: 'screen' });
    eq(vis, { fin: 'block', sheet: 'none' }, `[${theme}] **على الورقة صورة الاختبارات وحدها** — لا ورقة الجدول`);
    await run(pg, () => window.dispatchEvent(new Event('afterprint')));
    eq(await run(pg, () => [document.documentElement.classList.contains('fin-printing'), document.getElementById('finPrint').innerHTML]),
      [false, ''], `[${theme}] وبعد الطباعة يرجع كل شي (طباعة الجدول ترجع للجدول)`);
    eq(errs, [], `[${theme}] بلا أخطاء في الصفحة`);
    await ctx.close();
  }

  /* ══ ٤) المشاركة في الجوال (Web Share) ══ */
  {
    const { ctx, pg, errs } = await open({ share: true });
    await showFinals(pg);
    await tap(pg, '#finShareBtn');
    await pg.waitForSelector('#fsOv.open #fsImg', { timeout: 8000 }).catch(() => {});
    eq(await run(pg, () => [...document.querySelectorAll('#fsSheet .fs-btns button')].map(b => b.textContent.trim())),
      ['📤 شارك الصورة', '⬇️ احفظها', '📋 انسخ نص', '🖨️ اطبعها'], '**في الجوال «📤 شارك الصورة» أولها**');
    ok(await tap(pg, '#fsShareBtn'), 'زر «شارك الصورة» ينضغط');
    await pg.waitForFunction(() => window.__SHARED, null, { timeout: 4000 }).catch(() => {});
    const S = await run(pg, () => window.__SHARED);
    ok(S && S.n === 1 && S.type === 'image/png' && S.name === 'jadwalik-finals-202710.png' && S.size > 20000 &&
       JSON.stringify(S.png) === '[137,80,78,71]', '**قائمة المشاركة تاخذ ملف PNG** (لواتساب) — ' + JSON.stringify(S && { n: S.n, type: S.type, name: S.name, size: S.size }));
    ok(S && /jadwalik\.com/.test(S.text || '') && /جدول اختباراتي النهائية/.test(S.text || ''), '**ومعه سطر فيه رابط موقعنا** — ' + (S && S.text));
    /* قفل قائمة المشاركة ⇒ ولا شي ثاني */
    await run(pg, () => { window.__SHARED = null; window.__SHARE_ERR = 'AbortError' });
    const ab = await Promise.all([pg.waitForEvent('download', { timeout: 1500 }).catch(() => null), tap(pg, '#fsShareBtn')]);
    ok(!ab[0], 'قفل قائمة المشاركة ما ينزّل شي');
    /* الجهاز رفضها ⇒ نحفظها له */
    await run(pg, () => { window.__SHARE_ERR = 'NotAllowedError' });
    const na = await Promise.all([pg.waitForEvent('download', { timeout: 4000 }).catch(() => null), tap(pg, '#fsShareBtn')]);
    ok(!!na[0], '**الجهاز رفض المشاركة ⇒ تنزل الصورة بدالها**');
    eq(errs, [], 'بلا أخطاء في الصفحة (المشاركة)');
    await ctx.close();
  }

  /* ══ ٥) رابط الدعوة لمن عنده كود ══ */
  {
    const { ctx, pg, errs } = await open({ share: true });
    await showFinals(pg);
    await run(pg, () => { USER = { id: 'u1', email: 's@x.com' }; ACCOUNT = { ok: true, invite: { code: 'ABC234', paidFriends: 0 } }; ACCOUNT_AT = Date.now() });
    await tap(pg, '#finShareBtn');
    await pg.waitForSelector('#fsOv.open #fsImg', { timeout: 8000 }).catch(() => {});
    const N = await run(pg, () => (document.querySelector('#fsSheet .fs-note') || {}).textContent || '');
    ok(/كود دعوتك/.test(N) && /3 ريال/.test(N) && /5 ريال/.test(N), '**سطر يقول إن الرابط فيه كود دعوته** والمبلغين من السيرفر — ' + N);
    const TX = await run(pg, () => fsText());
    ok(typeof TX === 'string' && TX.endsWith('https://jadwalik.com/?ref=ABC234'), '**ونص القروب ينتهي برابط دعوته**');
    await tap(pg, '#fsShareBtn');
    await pg.waitForFunction(() => window.__SHARED, null, { timeout: 4000 }).catch(() => {});
    ok(/\?ref=ABC234/.test(((await run(pg, () => window.__SHARED)) || {}).text || ''), 'وسطر المشاركة كذلك');
    const img = await run(pg, () => finShareModel());
    ok(img && !JSON.stringify(img).includes('ABC234') && !JSON.stringify(img).includes('s@x.com'),
      '**والصورة نفسها بلا كود ولا إيميل** — تنتشر في قروب');
    eq(errs, [], 'بلا أخطاء في الصفحة (الدعوة)');
    await ctx.close();
  }

  /* ══ ٦) الإنجليزي، والمقاس، والأزرار ══ */
  {
    const { ctx, pg, errs } = await open({ share: true });
    await showFinals(pg);
    await run(pg, () => toggleLang());
    await pg.waitForTimeout(200);
    eq(await run(pg, () => (document.getElementById('finShareBtn') || {}).textContent), '📤 Share your exam schedule', 'زر البطاقة بالإنجليزي');
    await tap(pg, '#finShareBtn');
    await pg.waitForSelector('#fsOv.open #fsImg', { timeout: 8000 }).catch(() => {});
    const M = await run(pg, () => finShareModel());
    eq(M && [M.dir, M.title, M.sub], ['ltr', 'My final exams', 'Fall 2026/2027 · 6 exams'], 'الصورة بالإنجليزي من اليسار');
    eq(M && M.days && [M.days[0].day, M.days[0].num, M.days[0].month, M.days[0].items[0].time],
      ['Sunday', '20', 'December', '12:00 PM'], 'اليوم والتاريخ والوقت بالإنجليزي');
    const cols = await run(pg, () => courseColors(schedule)['MEEN 3311']);
    const P = await PIX(pg, '#fsImg', [[242, 378]]);
    ok(P && typeof cols === 'string' && near(P.px[0], hexRgb(cols), 8), '**وبطاقات الاختبارات مقلوبة للإنجليزي** (لون المادة على يسارها) — ' + JSON.stringify(P && P.px[0]));
    eq(await run(pg, () => document.querySelector('#fsSheet h2').textContent), '📤 Share your exam schedule', 'عنوان اللوح بالإنجليزي');
    await run(pg, () => toggleLang());
    await pg.waitForTimeout(200);
    eq(await run(pg, () => document.querySelector('#fsSheet h2').textContent), '📤 شارك جدول اختباراتك', '**وتبديل اللغة واللوح مفتوح يعيد رسمه**');
    await pg.waitForSelector('#fsOv.open #fsImg', { timeout: 8000 }).catch(() => {});
    eq(await run(pg, () => finShareModel().dir), 'rtl', 'والصورة رجعت عربي');
    /* المقاس والأزرار */
    const G = await run(pg, () => {
      const vw = innerWidth, vh = innerHeight, r = e => e.getBoundingClientRect();
      const btns = [...document.querySelectorAll('#fsSheet .fs-btns button')].map(b => ({ t: b.textContent.trim(), ...JSON.parse(JSON.stringify(r(b))) }));
      const chips = [...document.querySelectorAll('#fsSheet .fs-theme button')].map(b => {
        const q = r(b), cx = q.left + q.width / 2;
        return { h: q.height, up: document.elementFromPoint(cx, q.top - 4) === b, down: document.elementFromPoint(cx, q.bottom + 4) === b };
      });
      return { scrollW: document.documentElement.scrollWidth, vw, vh, sheet: JSON.parse(JSON.stringify(r(document.getElementById('fsSheet')))), btns, chips,
        img: JSON.parse(JSON.stringify(r(document.getElementById('fsImg')))) };
    }).then(g => (g && !g.err ? g : null));
    ok(G && G.scrollW <= 390 && G.sheet.left >= 0 && G.sheet.right <= 390.5, '**اللوح داخل الشاشة على ٣٩٠** — ' + JSON.stringify(G ? [G.scrollW, G.sheet.left, G.sheet.right] : null));
    ok(G && G.btns.length === 4 && G.btns.every(b => b.height >= 44 && b.left >= 0 && b.right <= 390.5),
      '**كل زر ٤٤ بكسل على الأقل وداخل الشاشة** — ' + JSON.stringify(G && G.btns.map(b => [b.t, Math.round(b.height), Math.round(b.left), Math.round(b.right)])));
    ok(G && G.btns[0] && G.btns[0].bottom <= G.vh, '**«📤 شارك الصورة» يبان بلا تمرير** على شاشة ٨٤٤ — ' + (G && G.btns[0] && Math.round(G.btns[0].bottom)));
    ok(G && G.img.width > 150 && G.img.bottom <= G.vh, 'والصورة كاملة في المعاينة — ' + JSON.stringify(G && [Math.round(G.img.width), Math.round(G.img.height)]));
    ok(G && G.chips.length === 2 && G.chips.every(c => c.up && c.down), 'زرّا الثيم مساحة ضغطهما أوسع من شكلهما — ' + JSON.stringify(G && G.chips));
    /* الإغلاق */
    ok(await tap(pg, '#fsSheet .guide-close'), '✕ يقفل اللوح');
    eq(await run(pg, () => [!!document.querySelector('#fsOv.open'), document.body.style.overflow, document.getElementById('finPrint').innerHTML]),
      [false, '', ''], 'وبعد الإغلاق: التمرير يرجع، ونسخة الطباعة تنشال');
    eq(errs, [], 'بلا أخطاء في الصفحة (الإنجليزي والمقاس)');
    await ctx.close();
  }

  /* ══ ٧) الدليل والفحص الثابت ══ */
  {
    const src = fs.readFileSync(PAGE, 'utf8');
    let G = null;
    try { delete require.cache[require.resolve(SHARED)]; G = require(SHARED).GUIDE } catch (e) {}
    const item = (L, t) => G && G[L].sections.flatMap(s => s.items).find(i => i.t === t);
    const ar = item('ar', 'انشر اختباراتك لقروبك'), en = item('en', 'Share your exams with your group');
    ok(!!ar && ar.d.includes('<b>📤 شارك جدول اختباراتك</b>') && src.includes("'📤 شارك جدول اختباراتك'"),
      '**الدليل يسمّي الزر باسمه في الصفحة** (العربي)');
    ok(!!en && en.d.includes('<b>📤 Share your exam schedule</b>') && src.includes("'📤 Share your exam schedule'"), 'والإنجليزي');
    ok((src.match(/function finalsMine\(/g) || []).length === 1 && (src.match(/FINALS\.forEach\(e=>\{\s*byCrn\[/g) || []).length === 1,
      '**مطابقة الاختبارات بجدولك في مكان واحد** (finalsMine) — كانت منسوخة في البطاقة والطباعة');
    const body = name => { const i = src.indexOf('function ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)) };
    ok(/finalsMine\(\)/.test(body('renderFinals')) && /finalsMine\(\)/.test(body('buildPrintSheet')), 'البطاقة وورقة الطباعة منها');
    ok(/@media print\{[\s\S]*html\.fin-printing #printSheet\{display:none!important\}[\s\S]*html\.fin-printing #finPrint\{display:block!important\}/.test(src),
      'وطباعة الاختبارات تخفي ورقة الجدول');
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { console.log('  ✗ انهار: ' + (e && e.stack || e)); fail++; done() });
