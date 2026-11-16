/* النصوص تنعرض صح — دراسة الشكل (١٣ نوفمبر ٢٠٢٦)، البنود ٥ · ٦ · ٨ · ٩ · ١٠. Chromium على ٣٩٠:
   ١) اسم مادة لاتيني ينتهي بعلامة ترقيم ما تنقلب علامته لأول السطر («.Technical and Profe. Commun») — في
      البحث وجدولي واليوم وبطاقة المادة وخطتي. نقيس مكان آخر حرف فعلاً: لازم يجي بعد اللي قبله.
   ٢) «@JadwalikBot» في الصفحات الثابتة: «@» قبل الاسم لا بعده.
   ٣) أرقام الموقع لاتينية: ولا رقم هندي في نصوص الواجهة ولا الدليل ولا تقويم التسجيل ولا المرسوم.
   ٤) العدد واسمه: «محاضرتين» · «3 محاضرات» · «11 محاضرة» · «مادة وحدة · شعبة وحدة» لا «3 محاضرة».
   ٥) اسم المساعد واحد: Jadwalik AI (المدخل وعنوان اللوح).

   node tests/test-text-look.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const DIR = path.dirname(PAGE);
const SHARED = path.join(DIR, 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — طلع ${JSON.stringify(a)} والمتوقع ${JSON.stringify(b)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nالنصوص: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* صفوف بصيغة الجامعة حرفاً بحرف — والعناوين المنتهية بعلامة كما تكتبها الجامعة فعلاً */
const C = (crn, code, title, sec, days, time, ins, room, st) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: st || 'CLOSE', gender: sec[0] === '2' ? 'F' : 'M' });
const COURSES = [
  C('31011', 'COMM 2312', 'Technical and Profe. Commun.', '101', 'UT', '0800 - 0915', 'Lee, Ann', 'M-CORE - G110', 'OPEN'),
  C('31012', 'COMM 2312', 'Technical and Profe. Commun.', '102', 'MW', '1100 - 1215', 'Lee, Ann', 'M-CORE - G111', 'CLOSE'),
  C('31021', 'GEIT 1412', 'Computer Science ||', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034', 'OPEN'),
  C('31031', 'MATH 1311', 'Finite Math. for Stu. of Busi.', '101', 'UT', '1100 - 1215', 'Khan, Imran', 'M-SCI - 101', 'CLOSE'),
  C('31041', 'MATH 2301', 'Calculus III', '101', 'UTR', '1000 - 1050', 'Brown, Mark', 'M-CORE - G101', 'CLOSE'),
];
const SCHED = [COURSES[0], COURSES[2], COURSES[4]];
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

/* داخل الصفحة: آخر حرف من النص (علامة الترقيم) مرسوم بعد الحرف اللي قبله مباشرة؟ */
const TAIL = ([sel, text]) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text) && e.getBoundingClientRect().width > 0);
  if (!el) return { missing: true };
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, node = null;
  while ((n = w.nextNode())) if (n.nodeValue.includes(text)) { node = n; break }
  if (!node) return { missing: true };
  const end = node.nodeValue.indexOf(text) + text.length - 1;
  const box = i => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect() };
  const last = box(end), prev = box(end - 1), first = box(node.nodeValue.indexOf(text));
  const line = Math.abs(last.top - prev.top) < 4;
  return { line, after: last.left >= prev.right - 1.5, gap: +(last.left - prev.right).toFixed(1), firstLeft: +first.left.toFixed(0), lastLeft: +last.left.toFixed(0) };
};
const good = r => r && !r.missing && !r.err && r.line && r.after;

(async () => {
  let chromium = null;
  try { ({ chromium } = require('playwright')) } catch (e) {}
  if (!chromium) { ok(false, 'playwright متوفر'); return done() }
  const plansJs = fs.existsSync(SHARED) ? fs.readFileSync(SHARED) : Buffer.from('');
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (/^\/(about|terms|privacy)$/.test(u)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(DIR, u.slice(1) + '.html'))) }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    const send = j => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
    if (u === '/api/monitor-status') return send(STATUS);
    if (u === '/api/courses') return send({ success: true, count: COURSES.length, courses: COURSES });
    send({});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  const HINDI = /[٠-٩]/;

  const open = async (theme, major) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.clock.install({ time: new Date('2026-11-15T09:50:00+03:00') });      /* أحد */
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(([sch, mj]) => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', JSON.stringify(mj));
      localStorage.setItem('pmu_schedules', JSON.stringify([sch, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(sch));
      localStorage.setItem('pmu_guestbar_off', String(Date.now()));
    } catch (e) {} }, [SCHED, major]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && window.PLANS, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(400);
    return { ctx, pg, errs };
  };

  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open(theme, 'MEEN');
    const seen = [];                                   /* نص كل شاشة — للأرقام */
    const grab = async name => { const s = await run(pg, () => document.body.innerText); seen.push([name, typeof s === 'string' ? s : '']) };

    /* ── البحث ── */
    await run(pg, async () => { switchTab('search'); await doSearch() });
    await pg.waitForFunction(() => document.querySelectorAll('#resultsList .course-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    await pg.waitForTimeout(500);
    let r = await run(pg, TAIL, ['#resultsList .cg-title', 'Technical and Profe. Commun.']);
    ok(good(r), `[${theme}] **البحث: نقطة «Commun.» بعد حرفها** لا أول السطر — ${JSON.stringify(r)}`);
    r = await run(pg, TAIL, ['#resultsList .cg-title', 'Computer Science ||']);
    ok(good(r), `[${theme}] البحث: «Computer Science ||» خطّاها في آخرها — ${JSON.stringify(r)}`);
    let hd = await run(pg, () => ({ c: document.getElementById('visibleCount').textContent, s: document.getElementById('visibleSecs').textContent,
      t: document.querySelector('.results-count').innerText.replace(/\s+/g, ' ').trim() }));
    eq(hd, { c: '4', s: '5', t: '4 مواد · 5 شعب' }, `[${theme}] **عنوان النتائج «4 مواد · 5 شعب»** (كان «4 مادة · 5 شعبة»)`);
    await run(pg, () => { const f = document.getElementById('courseFilter'); f.value = 'GEIT'; f.dispatchEvent(new Event('input', { bubbles: true })) });
    await pg.waitForTimeout(500);
    hd = await run(pg, () => ({ c: document.getElementById('visibleCount').textContent, s: document.getElementById('visibleSecs').textContent,
      t: document.querySelector('.results-count').innerText.replace(/\s+/g, ' ').trim() }));
    eq(hd, { c: '1', s: '1', t: 'مادة وحدة · شعبة وحدة' }, `[${theme}] **ومادة وحدة: «مادة وحدة · شعبة وحدة»** والرقم باقٍ في عنصره لمن يقرأه`);
    await grab('البحث');
    if (shots) await pg.screenshot({ path: path.join(shots, `text-search-${theme}.png`) });
    await run(pg, () => { const f = document.getElementById('courseFilter'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })) });

    /* ── جدولي ── */
    await run(pg, () => { switchTab('sched'); setSchedView('list') });
    await pg.waitForTimeout(500);
    r = await run(pg, TAIL, ['#schedDays .slot-title', 'Technical and Profe. Commun.']);
    ok(good(r), `[${theme}] **جدولي: نقطة «Commun.» بعد حرفها** — ${JSON.stringify(r)}`);
    const cnts = await run(pg, () => [...document.querySelectorAll('#schedDays .day-head .cnt')].map(e => e.textContent.trim()));
    eq(cnts, ['محاضرتين', 'محاضرة وحدة', 'محاضرتين', 'محاضرة وحدة', 'محاضرة وحدة'],
      `[${theme}] **عدد محاضرات كل يوم بصيغته** (كان «2 محاضرة» · «1 محاضرة»)`);
    await grab('جدولي');
    if (shots) await pg.screenshot({ path: path.join(shots, `text-sched-${theme}.png`) });

    /* ── اليوم وبطاقة المادة ── */
    await run(pg, () => switchTab('today'));
    await pg.waitForTimeout(600);
    r = await run(pg, TAIL, ['#pageToday .dc-name', 'Technical and Profe. Commun.']);
    ok(good(r), `[${theme}] **اليوم: نقطة «Commun.» بعد حرفها** — ${JSON.stringify(r)}`);
    await grab('اليوم');
    if (shots) await pg.screenshot({ path: path.join(shots, `text-today-${theme}.png`) });
    await run(pg, () => openCourse('31011'));
    await pg.waitForTimeout(500);
    r = await run(pg, TAIL, ['#csSheet h2', 'Technical and Profe. Commun.']);
    ok(good(r), `[${theme}] **بطاقة المادة: العنوان بنقطته في آخره** — ${JSON.stringify(r)}`);
    await run(pg, () => { if (typeof closeCourse === 'function') closeCourse() });

    /* ── خطتي ── */
    await run(pg, () => { switchTab('plan'); document.querySelectorAll('.sem-block').forEach(b => b.classList.add('open')) });
    await pg.waitForTimeout(600);
    r = await run(pg, TAIL, ['#pagePlan .pc-name', 'Technical & Professional Comm.']);
    ok(good(r), `[${theme}] **خطتي: «Technical & Professional Comm.» بنقطته في آخره** — ${JSON.stringify(r)}`);
    await grab('خطتي');
    if (shots) await pg.screenshot({ path: path.join(shots, `text-plan-${theme}.png`) });
    await run(pg, () => switchTab('set'));
    await pg.waitForTimeout(400);
    await grab('الإعدادات');

    /* ── الأرقام لاتينية ── */
    for (const [name, s] of seen) {
      const m = HINDI.exec(s);
      ok(s.length > 50 && !m, `[${theme}] **${name}: ولا رقم هندي في المرسوم** — ${m ? '«' + s.slice(Math.max(0, m.index - 25), m.index + 12).replace(/\s+/g, ' ') + '»' : s.length + ' حرف'}`);
    }
    if (theme === 'dark') {
      const data = await run(pg, () => { const bad = [];
        const walk = (o, p) => { if (typeof o === 'string') { if (/[٠-٩]/.test(o)) bad.push(p) } else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p + '.' + k) };
        walk(I18N.ar, 'I18N.ar'); walk(I18N.en, 'I18N.en'); walk(GUIDE, 'GUIDE'); walk(REG_CAL, 'REG_CAL');
        return { bad, n: Object.keys(I18N.ar).length, dom: (() => { const c = document.body.cloneNode(true); c.querySelectorAll('script,style').forEach(x => x.remove()); return /[٠-٩]/.test(c.textContent) })() } });
      ok(data && Array.isArray(data.bad) && data.n > 100 && data.bad.length === 0,
        `**نصوص الواجهة والدليل وتقويم التسجيل: ولا رقم هندي** (كانت «ثيرمو ١» · «الساعة ٥ العصر» · «٢٠ تخصص» · «٦٠ – ٨٩ ساعة») — ${JSON.stringify(data && (data.err || data.bad.slice(0, 6)))}`);
      ok(data && data.dom === false, 'ولا في نص الصفحة كله (الظاهر والمخفي)');
      /* والمصدر نفسه: نص داخل دالة ما انرسمت هنا (التحضيري · أقل دفع · التنبيه الطارئ). التعليقات خارج الفحص */
      const src = fs.readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ''));
      const hits = [];
      src.split('\n').forEach((l, i) => { const x = l.replace(/(^|[\s;{}),])\/\/.*$/, '$1').replace('[٠-٩]', '').replace('٠١٢٣٤٥٦٧٨٩', '');
        if (HINDI.test(x)) hits.push(i + 1) });
      eq(hits, [], '**ومصدر الصفحة (بلا التعليقات): ولا رقم هندي** إلا محوّل الأرقام نفسه');

      /* ── العدد واسمه ── */
      const N = await run(pg, () => { const f = k => [0, 1, 2, 3, 10, 11, 100, 103, 134].map(n => nOf(n, k));
        const a = { lec: f('lec'), hr: f('hr'), rev: [1, 2, 7, 14].map(n => nOf(n, 'rev')), day: [1, 2, 3, 12].map(n => nOf(n, 'day')),
          unlock: [1, 2, 3, 11].map(unlockLabel) };
        LANG = 'en'; a.en = [nOf(1, 'rev'), nOf(3, 'rev'), nOf(1, 'lec'), nOf(2, 'hr'), unlockLabel(1), unlockLabel(2)]; LANG = 'ar'; return a });
      eq(N.lec, ['0 محاضرات', 'محاضرة وحدة', 'محاضرتين', '3 محاضرات', '10 محاضرات', '11 محاضرة', '100 محاضرة', '103 محاضرات', '134 محاضرة'],
        '**المحاضرات: واحدة · اثنتان · جمع لين 10 · مفرد من 11 · والمئات على آخر خانتين**');
      eq(N.hr, ['0 ساعات', 'ساعة وحدة', 'ساعتين', '3 ساعات', '10 ساعات', '11 ساعة', '100 ساعة', '103 ساعات', '134 ساعة'], 'والساعات نفس القاعدة');
      eq(N.rev, ['تقييم واحد', 'تقييمين', '7 تقييمات', '14 تقييم'], 'والتقييمات (مذكّر: «واحد»)');
      eq(N.day, ['يوم واحد', 'يومين', '3 أيام', '12 يوم'], 'والأيام');
      eq(N.unlock, ['يفتح مادة وحدة', 'يفتح مادتين', 'يفتح 3 مواد', 'يفتح 11 مادة'], '**«يفتح مادتين»** لا «يفتح 2 مواد»');
      eq(N.en, ['1 review', '3 reviews', '1 class', '2 hrs', 'unlocks 1 course', 'unlocks 2 courses'], 'وبالإنجليزي مفرد وجمع («1 review» لا «1 reviews»)');

      /* ── اسم المساعد ── */
      const ai = await run(pg, () => { const a = t('aiTitle'); LANG = 'en'; const e = t('aiTitle'); LANG = 'ar';
        return { a, e, entry: (document.querySelector('.ai-entry-b') || {}).textContent || null } });
      eq(ai, { a: 'Jadwalik AI', e: 'Jadwalik AI', entry: 'Jadwalik AI' }, '**اسم المساعد واحد: المدخل وعنوان اللوح «Jadwalik AI» باللغتين**');
    }
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS — ${errs[0] || ''}`);
    await ctx.close();
  }

  /* ── خطة فيها أقواس في آخر الاسم ── */
  {
    const { ctx, pg } = await open('dark', 'LAWB');
    await run(pg, () => { switchTab('plan'); document.querySelectorAll('.sem-block').forEach(b => b.classList.add('open')) });
    await pg.waitForTimeout(600);
    const r = await run(pg, TAIL, ['#pagePlan .pc-name', 'Intro to Law (Arabic)']);
    ok(good(r), `**خطة القانون: «Intro to Law (Arabic)» قوسه الأخير في آخره** — ${JSON.stringify(r)}`);
    if (shots) await pg.screenshot({ path: path.join(shots, 'text-plan-law.png') });
    await ctx.close();
  }

  /* ── الصفحات الثابتة: «@» قبل اسم البوت في القسم العربي ── */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    for (const p of ['about', 'terms', 'privacy']) {
      await pg.goto(BASE + p, { waitUntil: 'load' });
      const r = await run(pg, () => { const res = { rtl: 0, bad: 0 };
        document.querySelectorAll('b').forEach(b => { if (b.textContent.trim() !== '@JadwalikBot') return;
          const sec = b.parentElement; if (getComputedStyle(sec).direction !== 'rtl') return;
          for (let e = b; e; e = e.parentElement) if (e.hidden || getComputedStyle(e).display === 'none') { e.hidden = false; e.style.display = 'block' }
          const n = b.firstChild, box = i => { const g = document.createRange(); g.setStart(n, i); g.setEnd(n, i + 1); return g.getBoundingClientRect() };
          const at = box(n.nodeValue.indexOf('@')), j = box(n.nodeValue.indexOf('J'));
          res.rtl++; if (!(at.width > 0 && at.left < j.left)) res.bad++ });
        return res });
      ok(r && r.rtl >= 1 && r.bad === 0, `**/${p}: «@JadwalikBot» بترتيبه** («@» قبل الاسم — كان «JadwalikBot@») — ${JSON.stringify(r)}`);
    }
    await ctx.close();
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { ok(false, 'انهار: ' + (e && e.stack || e)); done() });
