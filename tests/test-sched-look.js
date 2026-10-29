/* «جدولي» ملوّن — طلب محمد (٢٧ أكتوبر ٢٠٢٦: «يكون تفاعلي اكثر وما تحسه جامد»)، الفكرة ١٠ اللي وافق عليها:
   «الأسبوع شبكة ملوّنة، كل مادة بلون، وتضغط عليها تطلع تفاصيلها من تحت». Chromium على ٣٩٠ بالثيمين:
   ١) كل مادة بلونها في الشبكة والقائمة — المحاضرة والمعمل لون واحد، والمواد ألوان مختلفة، والتعارض يغلبه.
   ٢) ضغطة على مادة في الشبكة تفتح بطاقتها من تحت (openCourse — نفس بطاقة «اليوم») على الاجتماع المضغوط
      (المحاضرة غير المعمل)، و✕ يقفلها. اللوحة العائمة القديمة انشالت.
   ٣) القائمة أو الشبكة — اختيار الطالب ينحفظ.
   ٤) دليل الموقع يقول «تطلع لك بطاقتها من تحت» لا «تختفي بأي لمسة».
   ٥) رقم «جدولي» فوق و«مادة» في الملخّص = عدد المواد (كانا شعباً وصفوفاً — رقمين مختلفين لنفس الجدول).
   ٦) وكل رقم ثاني كذلك: زر «جدول 1» وورقة الطباعة و«امسح الكل» مواد، و«🔢 أرقام CRN» والنسخ وورقة الطباعة كل CRN مرة.

   node tests/test-sched-look.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nجدولي: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* صفوف بصيغة الجامعة حرفاً بحرف (الوقت بلا نقطتين · الأيام حروف · الدكاترة لاتيني) */
const C = (crn, code, title, sec, days, time, ins, room) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: 'CLOSE', gender: sec[0] === '2' ? 'F' : 'M' });
const SCHED = [
  C('30011', 'MEEN 3311', 'Thermodynamics I', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034'),
  C('30021', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'UT', '0800 - 0915', 'Khan, Imran', 'M-SCI - 101'),
  C('30023', 'CHEM 1311', 'Chemistry for Engineers I LAB', '111', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L201'),
  /* المحاضرة والمعمل بنفس CRN — ومعمله يتعارض مع معمل الكيمياء */
  C('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'MW', '0930 - 1045', 'Brown, Mark', 'M-SCI - 201'),
  C('30031', 'PHYS 1421', 'Physics for Engineers I', '101', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L105'),
  C('30091', 'MATH 2301', 'Calculus III', '101', 'UTR', '1000 - 1050', 'Brown, Mark', 'M-CORE - G101'),
];
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
    if (u === '/api/monitor-status') return send(STATUS);
    if (u === '/api/courses') return send({ success: true, count: 0, courses: [] });
    send({});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  const open = async ({ theme = 'dark', ctx = null } = {}) => {
    ctx = ctx || await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
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
    } catch (e) {} }, [SCHED, theme]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(300);
    return { ctx, pg, errs };
  };
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  const tap = (pg, sel) => pg.click(sel, { timeout: 4000 }).then(() => true, () => false);
  const shot = async (pg, name) => { if (shots) await pg.screenshot({ path: path.join(shots, name) }) };
  /* لون كل عنصر: --cc (لون مادته) وحدّه كما انرسم — بصيغة rgb وحدة */
  const COLORS = sel => {
    const rgb = c => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const x = getComputedStyle(d).color; d.remove(); return x };
    const warn = rgb(getComputedStyle(document.documentElement).getPropertyValue('--warn').trim());
    return { warn, items: [...document.querySelectorAll(sel)].map(e => { const cs = getComputedStyle(e), cc = e.style.getPropertyValue('--cc').trim();
      return { crn: e.dataset.crn || (e.querySelector('[data-code]') || {}).dataset && e.querySelector('[data-code]').dataset.code, cc: cc ? rgb(cc) : null,
        edge: sel.includes('gr-item') ? cs.borderInlineStartColor : cs.borderRightColor, clash: e.classList.contains('clash'),
        bg: e.style.getPropertyValue('--cc-bg').trim() } }) };
  };

  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme });
    await run(pg, () => switchTab('sched'));
    /* ── الأرقام متّفقة: ٤ مواد = ٥ شعب (معمل الكيمياء بـCRN خاص) = ٦ صفوف (الفيزياء محاضرة ومعمل بنفس CRN) ── */
    const nums = await run(pg, () => ({ badge: document.getElementById('schedBadge').textContent, sum: cntVal('sumCourses') }));
    eq(nums, { badge: '4', sum: '4' }, `[${theme}] **رقم «جدولي» فوق و«مادة» في الملخّص: ٤ مواد** (كانا ٥ شعب و٦ صفوف — رقمين مختلفين لنفس الجدول)`);
    ok(await tap(pg, '#svGrid'), `[${theme}] زر «شبكة» ينضغط`);
    await pg.waitForTimeout(200);

    /* ── ١) كل مادة بلونها ── */
    const G = await run(pg, COLORS, '#schedGrid .gr-item');
    const by = crn => (G.items || []).filter(x => x.crn === crn);
    ok(G.items && G.items.length === 11, `[${theme}] الشبكة فيها كل الاجتماعات بأيامها (١١) — ${G.items && G.items.length}`);
    const cc = k => (by(k)[0] || {}).cc;
    ok(!!cc('30011') && cc('30021') === cc('30023') && new Set([cc('30011'), cc('30021'), cc('30031'), cc('30091')]).size === 4,
      `[${theme}] **كل مادة بلونها**: أربع مواد ⇒ أربعة ألوان، ومحاضرة الكيمياء ومعملها لون واحد — ${JSON.stringify([cc('30011'), cc('30021'), cc('30023'), cc('30031'), cc('30091')])}`);
    ok((G.items || []).filter(x => !x.clash).every(x => x.edge === x.cc) && (G.items || []).filter(x => !x.clash).length === 7,
      `[${theme}] **وحدّ كل مادة بلونها** (كانت كلها أزرق) — ${JSON.stringify((G.items || []).filter(x => !x.clash).map(x => [x.crn, x.edge]))}`);
    ok(by('30023').every(x => x.clash && x.edge === G.warn) && by('30031').every(x => x.clash && x.edge === G.warn),
      `[${theme}] **والتعارض يغلب اللون** (معمل الكيمياء والفيزياء بلون التحذير) — ${JSON.stringify(by('30031').map(x => x.edge))} · ${G.warn}`);
    ok((G.items || []).every(x => /^rgba\(\d+,\d+,\d+,\.17\)$/.test(x.bg)), `[${theme}] وخلفيتها من لونها نفسه (شفافة) — ${(G.items || [])[0] && G.items[0].bg}`);
    /* **ولا لون مادة يشبه لون التعارض**: كان الكهرماني في الألوان — نفس --warn — فمادة سليمة تطلع «متعارضة» */
    const hues = await run(pg, () => COURSE_HUES.map(h => { const d = document.createElement('i'); d.style.color = h; document.body.appendChild(d); const x = getComputedStyle(d).color; d.remove(); return x }));
    const near = (a, b) => { const p = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number); const [x, y] = [p(a), p(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 90 };
    /* لون التعارض بالثيمين (--warn) — هو اللي له معنى في «جدولي» */
    const asRgb = await run(pg, cs => cs.map(c => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const x = getComputedStyle(d).color; d.remove(); return x }), ['#f59e0b', '#b0700a']);
    ok(Array.isArray(hues) && hues.length >= 8 && hues.every(h => asRgb.every(w => !near(h, w))),
      `[${theme}] **ولا لون مادة قريب من لون التعارض (الكهرماني)** — ${JSON.stringify(hues)}`);
    await shot(pg, `sched-grid-${theme}.png`);

    /* ── ٢) ضغطة ⇒ بطاقتها من تحت ── */
    ok(await tap(pg, '#schedGrid .gr-item[data-crn="30011"]'), `[${theme}] مادة في الشبكة تنضغط`);
    await pg.waitForTimeout(250);
    let r = await run(pg, () => { const ov = document.getElementById('csOv'), sh = document.getElementById('csSheet');
      return { open: ov.classList.contains('open'), h: (sh.querySelector('h2') || {}).textContent, lead: (sh.querySelector('.guide-lead') || {}).textContent,
        txt: sh.textContent.replace(/\s+/g, ' '), peek: !!document.getElementById('gridPeek'), body: document.body.style.overflow } });
    ok(r.open && r.h === 'Thermodynamics I' && r.lead === 'MEEN 3311 §101' && /08:00–09:15/.test(r.txt) && /30011/.test(r.txt),
      `[${theme}] **الضغطة تفتح بطاقة المادة من تحت** (اسمها · شعبتها · وقتها · CRN) — ${JSON.stringify({ open: r.open, h: r.h, lead: r.lead })}`);
    ok(!r.peek && r.body === 'hidden', `[${theme}] **بدل اللوحة العائمة القديمة** (اختفت)، والصفحة ما تنزلق تحتها — ${JSON.stringify({ peek: r.peek, body: r.body })}`);
    await shot(pg, `sched-sheet-${theme}.png`);
    ok(await tap(pg, '#csSheet .guide-close'), `[${theme}] زر ✕ في البطاقة`);
    await pg.waitForTimeout(150);
    r = await run(pg, () => ({ open: document.getElementById('csOv').classList.contains('open'), body: document.body.style.overflow }));
    eq(r, { open: false, body: '' }, `[${theme}] **و✕ يقفلها** والصفحة ترجع تنزلق`);
    /* معمل الفيزياء (الخميس ١٣:٠٠) — بنفس CRN المحاضرة: البطاقة على الاجتماع المضغوط */
    ok(await tap(pg, '#schedGrid .gr-item[data-crn="30031"][data-start="780"]'), `[${theme}] معمل الفيزياء في الشبكة ينضغط`);
    await pg.waitForTimeout(250);
    r = await run(pg, () => document.getElementById('csSheet').textContent.replace(/\s+/g, ' '));
    ok(/13:00–15:50/.test(r) && /M-SCI - L105/.test(r), `[${theme}] **المعمل يفتح على وقت المعمل وقاعته** لا المحاضرة — ${String(r).slice(0, 120)}`);
    await run(pg, () => closeCourse());

    /* ── القائمة بنفس الألوان ── */
    ok(await tap(pg, '#svList'), `[${theme}] زر «قائمة» ينضغط`);
    const L = await run(pg, COLORS, '#schedDays .slot');
    const lc = code => (L.items || []).filter(x => x.crn === code);
    ok(lc('MEEN 3311').length > 0 && lc('MEEN 3311').every(x => x.edge === cc('30011')) && lc('MATH 2301').every(x => x.edge === cc('30091')),
      `[${theme}] **القائمة بنفس ألوان الشبكة** — ${JSON.stringify((L.items || []).map(x => [x.crn, x.edge]))}`);
    ok(lc('PHYS 1421').length > 0 && lc('PHYS 1421').every(x => x.edge === L.warn), `[${theme}] **والتعارض بالقائمة بلون التحذير كما كان**`);
    await shot(pg, `sched-list-${theme}.png`);

    const over = await run(pg, () => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي للصفحة (الشبكة تتمرّر داخلها) — ${over}`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٣) الاختيار ينحفظ ── */
  {
    const { ctx, pg, errs } = await open();
    await run(pg, () => switchTab('sched'));
    await tap(pg, '#svGrid');
    const pg2 = (await open({ ctx })).pg;
    await run(pg2, () => switchTab('sched'));
    await pg2.waitForTimeout(150);
    let r = await run(pg2, () => ({ on: document.getElementById('svGrid').classList.contains('on'),
      grid: getComputedStyle(document.getElementById('schedGrid')).display !== 'none' && document.querySelectorAll('#schedGrid .gr-item').length > 0,
      list: getComputedStyle(document.getElementById('schedDays')).display }));
    eq(r, { on: true, grid: true, list: 'none' }, '**اخترت «شبكة» ورجعت للموقع: تفتح على الشبكة** (كانت ترجع «قائمة» دائماً)');
    await tap(pg2, '#svList');
    const pg3 = (await open({ ctx })).pg;
    await run(pg3, () => switchTab('sched'));
    r = await run(pg3, () => ({ on: document.getElementById('svList').classList.contains('on'), list: getComputedStyle(document.getElementById('schedDays')).display !== 'none' }));
    eq(r, { on: true, list: true }, 'ورجعت «قائمة» ⇒ تفتح قائمة');
    ok(errs.length === 0, '(الحفظ) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٥) كل رقم وقائمة في «جدولي» من المواد والـCRN لا من الصفوف ──
     المحاضرة والمعمل بنفس CRN صفّان (الفيزياء 30031): زر «جدول 1» كان «6 مواد» والملخّص «4»، ورقم الفيزياء
     يتكرر في «🔢 أرقام CRN» وفي «انسخ الأرقام كلها» وفي ورقة الطباعة — يلصقه الطالب في بانر مرتين. */
  {
    const { ctx, pg, errs } = await open();
    await run(pg, () => switchTab('sched'));
    let r = await run(pg, () => [...document.querySelectorAll('#slotBar .slot-pick .slot-c')].map(x => x.textContent.trim()));
    eq(r, ['4 مواد', 'فاضي', 'فاضي'], '**زر «جدول 1» يقول «4 مواد» مثل الملخّص** (كان «6 مواد» — يعدّ صفوفاً)');
    ok(await tap(pg, '#crnBtn'), 'زر «🔢 أرقام CRN» ينضغط');
    r = await run(pg, () => ({ nums: [...document.querySelectorAll('#crnPanel .crn-row .crn-num')].map(x => x.textContent),
      all: (document.querySelector('#crnPanel .crn-all') || {}).textContent }));
    eq(r, { nums: ['30011', '30021', '30023', '30031', '30091'], all: '📋 انسخ الأرقام كلها (5)' },
      '**«🔢 أرقام CRN»: كل رقم مرة** — المحاضرة والمعمل بنفس CRN سطر واحد (كان رقم الفيزياء مرتين، و«كلها (6)»)');
    r = await run(pg, () => { window.copyText = (txt, msg) => { window.__cp = [txt, msg] }; copyAllCrn(); return window.__cp });
    eq(r, ['30011\n30021\n30023\n30031\n30091', 'انتسخت 5 أرقام'], '**«انسخ الأرقام كلها» ينسخ كل رقم مرة** — هذا اللي يلصقه في بانر');
    /* الترتيب يشتغل على الأرقام نفسها: الفيزياء فوق */
    r = await run(pg, () => { moveCrn('30031', -1); moveCrn('30031', -1); return [...document.querySelectorAll('#crnPanel .crn-row .crn-num')].map(x => x.textContent) });
    eq(r, ['30011', '30031', '30021', '30023', '30091'], 'وترتيب الأرقام (▲) يشتغل عليها');
    r = await run(pg, () => { window.copyText = (txt, msg) => { window.__cp = [txt, msg] }; copyAllCrn(); return window.__cp[0] });
    eq(r, '30011\n30031\n30021\n30023\n30091', 'والنسخ بالترتيب اللي رتّبه');
    /* ورقة الطباعة */
    r = await run(pg, () => ({ stat: (document.querySelector('#printSheet .ps-stat b') || {}).textContent,
      crns: [...document.querySelectorAll('#printSheet .ps-crn-i b')].map(x => x.textContent) }));
    eq(r, { stat: '4', crns: ['30011', '30021', '30023', '30031', '30091'] },
      '**ورقة الطباعة: «4» مواد وكل رقم تسجيل مرة** (كانت «6» ورقم الفيزياء مرتين)');
    /* «امسح الكل» يسأل عن المواد */
    r = await run(pg, () => { window.confirm = m => { window.__cf = m; return false }; clearSchedule(); return { m: window.__cf, n: schedule.length } });
    eq(r, { m: 'تمسح 4 مواد من "جدول 1"؟ ما فيه تراجع.', n: 6 }, '**«امسح الكل» يقول «تمسح 4 مواد»** (كان «تمسح 6 مادة»)، و«لا» ما يمسح شي');
    /* بالإنجليزي */
    await run(pg, () => toggleLang());
    r = await run(pg, () => { window.confirm = m => { window.__cf = m; return false }; clearSchedule();
      return { chip: document.querySelector('#slotBar .slot-pick .slot-c').textContent.trim(), m: window.__cf } });
    eq(r, { chip: '4 crs', m: 'Delete 4 courses from "Plan 1"? This cannot be undone.' }, 'وبالإنجليزي كذلك');
    ok(errs.length === 0, '(الأرقام) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٤) دليل الموقع يشرح الضغطة الجديدة ── */
  {
    const G = fs.readFileSync(SHARED, 'utf8');
    ok(/اضغط أي مادة تطلع لك بطاقتها من تحت/.test(G) && /كل مادة بلونها/.test(G) && !/وتختفي بأي لمسة/.test(G),
      '**دليل الموقع: «كل مادة بلونها … اضغط أي مادة تطلع لك بطاقتها من تحت»** (كان «تختفي بأي لمسة»)');
    ok(/its card slides up/.test(G) && !/disappears at any touch/.test(G), 'وبالإنجليزي');
    /* و«دليل الصور» (/guide — نص محمد، عدّلناه بموافقته ٢٩ أكتوبر) الخطوة ٢٢ */
    const PG = fs.readFileSync(path.join(path.dirname(PAGE), 'jadwalik-guide.html'), 'utf8');
    ok(/اضغط المادة تطلع لك بطاقتها من تحت/.test(PG) && !/وتختفي بأي لمسة/.test(PG),
      '**دليل الصور، الخطوة ٢٢: «اضغط المادة تطلع لك بطاقتها من تحت»** (كان «وتختفي بأي لمسة»)');
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { fail++; out.push('  ✗ انهار: ' + (e && e.stack || e)); done() });
