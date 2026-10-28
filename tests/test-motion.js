/* الحركة في الموقع — طلب محمد (٢٧ أكتوبر ٢٠٢٦): «يكون تفاعلي اكثر وما تحسه جامد».
   Chromium على ٣٩٠ بالثيمين، والصفحة نفسها تُضغط وتُقرأ:
   ١) التنقّل بين التبويبات ينساب (pageIn)، والخط تحت التبويب **ينزلق** لمكان التبويب الجديد — ويختفي في الإعدادات.
   ٢) الضغطة لها إحساس: الزر وهو مضغوط يصغر (scale .97)، والنجمة تكبر كما كانت (القاعدة الأقوى تغلب).
   ٣) التحميل هياكل بطاقات تلمع بدل الدائرة، والنتائج الجديدة تظهر وحدة ورا الثانية — وإعادة الرسم ما تعيدها.
   ٤) الأرقام تعدّ: عدّادات البحث · ملخّص جدولي · ساعات الخطة ونسبتها · المعدل — والقيمة النهائية في data-v من
      أول لحظة (cntVal: ورقة الطباعة تقرأ التعارضات منها)، وتبويب مخفي يعدّ من صفر أول ما يبان.
   ٥) «تقليل الحركة» في الجوال يطفيها كلها (الأرقام نهائية على طول).
   ٦) شريط الزائر سطر رفيع، و✕ يقفله أسبوعاً (ويرجع بعده).
   ٧) زر «؟» العائم يتنحّى وقت التمرير ويرجع أول ما توقف.

   node tests/test-motion.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* بيانات بصيغة الجامعة: الوقت بلا نقطتين، والحالة OPEN · CLOSE */
const C = (crn, code, title, sec, days, time, ins, room, st) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: st, gender: sec[0] === '2' ? 'F' : 'M' });
const COURSES = [];
for (let i = 0; i < 18; i++)
  COURSES.push(C(String(30100 + i), i % 2 ? 'MATH 2301' : 'MEEN 3311', i % 2 ? 'Calculus III' : 'Thermodynamics I',
    String(101 + i), i % 3 ? 'UT' : 'MW', ['0800 - 0915', '1000 - 1115', '1300 - 1415'][i % 3],
    'Smith, John', 'M-CORE - G0' + (30 + i), i % 4 ? 'CLOSE' : 'OPEN'));
const SCHED = [COURSES[0], COURSES[1], COURSES[4], COURSES[5]];          /* ٤ شعب: اثنتان منها وقت واحد ⇒ تعارض */
const DONE = ['MATH 1301', 'MATH 1302', 'PHYS 1421', 'ENGL 1311', 'CHEM 1311'];

let DELAY = 0;
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
    if (u === '/api/courses') return setTimeout(() => send({ success: true, count: COURSES.length, courses: COURSES }), DELAY);
    if (u === '/api/monitor-status') return send(STATUS);
    send({});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  /* زائر عنده جدول ومواد منجزة (فيظهر شريط الزائر) — local: مفاتيح إضافية في التخزين قبل الفتح */
  const open = async ({ theme = 'dark', reduce = false, local = {} } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(([sch, done, extra]) => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"');
      localStorage.setItem('pmu_schedules', JSON.stringify([sch, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(sch));
      localStorage.setItem('pmu_completed', JSON.stringify(done));
      localStorage.setItem('pmu_grades', JSON.stringify({ 'MATH 1301': 'A', 'MATH 1302': 'B+', 'PHYS 1421': 'B' }));
      Object.entries(extra || {}).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) {} }, [SCHED, DONE, local]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && typeof MON_STATE !== 'undefined' && !!MON_STATE,
      null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(300);
    return { ctx, pg, errs };
  };
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 140) }));
  /* يسجّل كل قيمة يمر بها الرقم (MutationObserver) — والقيمة النهائية (data-v) وقت أول تغيير، وcntVal وقتها.
     بلا قراءة في لحظة بعينها: تحت حمل run-all القراءة ممكن تتأخر لين يخلص العدّ */
  const REC = sels => { window.__R = {}; sels.forEach(sel => {
    const el = document.querySelector(sel); if (!el) return;
    const r = window.__R[sel] = { vals: [], v0: null, cv: null };
    new MutationObserver(() => {
      const n = el.matches('.cnt,[data-v]') ? el : (el.querySelector('.cnt') || el);
      r.vals.push(n.textContent);
      if (r.v0 === null) { r.v0 = n.dataset.v || null; r.cv = n.id ? cntVal(n.id) : null }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }) };
  const GOT = () => window.__R;
  const counted = (r, fin) => !!r && r.vals.length >= 3 && r.vals[r.vals.length - 1] === fin
    && r.vals.slice(0, -1).some(x => x !== fin) && new Set(r.vals).size >= 3;
  const shot = async (pg, name) => { if (shots) await pg.screenshot({ path: path.join(shots, name) }) };
  const IND = () => {
    const bar = document.querySelector('.tabs'), ind = document.getElementById('tabInd');
    const a = bar && bar.querySelector('.tab.active');
    if (!bar || !ind) return { ind: false };
    const ir = ind.getBoundingClientRect(), ar = a ? a.getBoundingClientRect() : null;
    return { ind: true, on: bar.classList.contains('ind-on'), op: getComputedStyle(ind).opacity,
      dx: ar ? Math.round(Math.abs((ir.left + ir.width / 2) - (ar.left + ar.width / 2))) : null,
      w: Math.round(ir.width), oldLine: a ? getComputedStyle(a, '::after').display : null };
  };

  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme });

    /* ── ١) التبويبات ── */
    let v = await run(pg, IND);
    ok(v.ind && v.on && v.dx !== null && v.dx <= 2,
      `[${theme}] **خط التبويب تحت التبويب الفعّال** (#tabInd) — ${JSON.stringify(v)}`);
    ok(v.oldLine === 'none', `[${theme}] والخط القديم تحت كل تبويب مطفأ لما يشتغل المنزلق — ${v.oldLine}`);
    await run(pg, () => switchTab('plan'));
    const an = await run(pg, () => getComputedStyle(document.getElementById('pagePlan')).animationName);
    eq(an, 'pageIn', `[${theme}] **التبويب الجديد ينساب** (animation pageIn — كان يتبدّل فجأة)`);
    await pg.waitForTimeout(450);
    v = await run(pg, IND);
    ok(v.on && v.dx <= 2, `[${theme}] **والخط انزلق لـ«خطتي»** — ${JSON.stringify(v)}`);
    const tr = await run(pg, () => { const i = document.getElementById('tabInd'); const c = getComputedStyle(i);
      return { p: c.transitionProperty, d: c.transitionDuration, still: document.querySelector('.tabs').classList.contains('ind-still') } });
    ok(/transform/.test(tr.p) && /0\.32s/.test(tr.d) && !tr.still, `[${theme}] **ينزلق (transition ٠٫٣٢ث) لا يقفز** — ${JSON.stringify(tr)}`);
    await run(pg, () => switchTab('docs')); await pg.waitForTimeout(450);
    v = await run(pg, IND);
    ok(v.on && v.dx <= 2, `[${theme}] ولـ«دكاترة» — ${JSON.stringify(v)}`);
    await run(pg, () => switchTab('set')); await pg.waitForTimeout(300);
    v = await run(pg, IND);
    ok(v.ind && !v.on && v.op === '0', `[${theme}] **الإعدادات (من الترس) بلا تبويب فعّال: الخط يختفي** — ${JSON.stringify(v)}`);
    await run(pg, () => switchTab('search')); await pg.waitForTimeout(450);

    /* ── ٢) الضغطة ── */
    const bs = await pg.$('#btnSearch');
    const bb = bs && await bs.boundingBox();
    if (bb) {
      await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await pg.mouse.down();
      await pg.waitForTimeout(220);
      const tf = await run(pg, () => getComputedStyle(document.getElementById('btnSearch')).transform);
      await pg.mouse.move(5, 5);      /* نرفع الإصبع بعيد عن الزر: ضغطة بلا نقرة (وإلا ينطلق بحث قبل وقته) */
      await pg.mouse.up();
      ok(/^matrix\(0\.97/.test(String(tf)), `[${theme}] **الزر وهو مضغوط يصغر شوي** (scale .97 — كان ولا شي) — ${tf}`);
    } else ok(false, `[${theme}] زر البحث موجود`);
    const star = await run(pg, () => {
      const r = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch (e) { return [] } })
        .find(x => x.selectorText === '.star-btn:active');
      return r ? r.style.transform : null;
    });
    eq(star, 'scale(1.18)', `[${theme}] والنجمة في التقييم تكبر كما كانت (قاعدتها أقوى من العامة)`);

    /* ── ٣) التحميل والنتائج ── */
    DELAY = 1500;
    await run(pg, REC, ['#statTotal', '#statOpen']);
    await run(pg, () => { doSearch() });
    await pg.waitForTimeout(400);
    const sk = await run(pg, () => {
      const b = document.getElementById('loadingBox');
      return { vis: !!b && b.classList.contains('visible'), cards: b ? b.querySelectorAll('.sk-card').length : 0,
        spin: !!(b && b.querySelector('.spinner')), sub: ((document.getElementById('loadingSub') || {}).textContent || '').trim(),
        anim: b && b.querySelector('.sk') ? getComputedStyle(b.querySelector('.sk')).animationName : null };
    });
    ok(sk.vis && sk.cards === 3 && !sk.spin && sk.anim === 'skShine',
      `[${theme}] **وقت البحث: ثلاث بطاقات هيكل تلمع بدل الدائرة** — ${JSON.stringify(sk)}`);
    eq(sk.sub, 'يجيب البيانات من موقع PMU', `[${theme}] ومعها سطر «يجيب البيانات من موقع PMU»`);
    await shot(pg, `motion-loading-${theme}.png`);
    await pg.waitForFunction(() => document.querySelectorAll('#resultsList .course-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    const cards = await run(pg, () => [...document.querySelectorAll('#resultsList .course-card')].map(c =>
      ({ in: c.classList.contains('in'), i: c.style.getPropertyValue('--i'), an: getComputedStyle(c).animationName })));
    /* بطاقة لكل مادة (test-search-cards): الـ١٨ شعبة في مادتين ⇒ بطاقتان — وحدّ الـ١٢ هناك بمواد أكثر */
    ok(cards.length === 2 && cards.every((c, i) => c.in && c.i === String(i) && c.an === 'cardIn'),
      `[${theme}] **النتائج تظهر وحدة ورا الثانية** (بتأخير متدرّج) — ${JSON.stringify(cards)}`);
    await pg.waitForTimeout(700);
    let R1 = await run(pg, GOT);
    ok(counted(R1['#statTotal'], '18'), `[${theme}] **عدّاد «إجمالي» يعدّ لـ18** (كان يطلع مرة وحدة) — ${JSON.stringify((R1['#statTotal'] || {}).vals)}`);
    eq((R1['#statTotal'] || {}).v0, '18', `[${theme}] **والقيمة النهائية في data-v من أول لحظة**`);
    const c2 = await run(pg, () => ['statTotal', 'statOpen', 'statClose'].map(id => document.getElementById(id).textContent));
    eq(c2, ['18', '5', '13'], `[${theme}] ويوصل: إجمالي 18 · مفتوح 5 · مغلق 13`);
    await shot(pg, `motion-results-${theme}.png`);
    await run(pg, () => renderResults());
    const again = await run(pg, () => document.querySelectorAll('#resultsList .course-card.in').length);
    eq(again, 0, `[${theme}] **إعادة الرسم (فلتر · إضافة · مراقبة) ما تعيد الحركة**`);
    DELAY = 0;

    /* ── ٤) جدولي والخطة والمعدل — في صفحة جديدة: أول زيارة للتبويب (فوق زرنا «خطتي»، والعدّ لأول ما يبان أو لما
       يتغيّر الرقم) ── */
    const P4 = await open({ theme });
    {
    const pg = P4.pg;
    await run(pg, REC, ['#sumCourses', '#sumHours', '#sumClashes']);
    await run(pg, () => switchTab('sched'));
    await pg.waitForTimeout(800);
    R1 = await run(pg, GOT);
    const s2 = await run(pg, () => ['sumCourses', 'sumHours', 'sumClashes'].map(id => document.getElementById(id).textContent));
    ok(counted(R1['#sumCourses'], '4'), `[${theme}] **جدولي: «مادة» تعدّ من صفر أول ما يبان التبويب** (انكتبت وهو مخفي) — ${JSON.stringify((R1['#sumCourses'] || {}).vals)}`);
    eq(s2[0], '4', `[${theme}] ويوصل 4 مواد`);
    ok(Number(s2[2]) >= 1 && (R1['#sumClashes'] || {}).cv === s2[2],
      `[${theme}] **وسط العدّ، ورقة الطباعة تقرأ التعارضات النهائية** (cntVal لا النص) — ${JSON.stringify(R1['#sumClashes'])}`);
    await run(pg, REC, ['#progDone', '#progPct', '#gpaVal']);
    await run(pg, () => switchTab('plan'));
    await pg.waitForTimeout(800);
    R1 = await run(pg, GOT);
    const p1 = await run(pg, () => { const n = document.querySelector('#progDone .cnt'), pc = document.getElementById('progPct');
      return { v: n && n.dataset.v, tail: ((document.querySelector('#progDone small') || {}).textContent || ''),
        pv: pc.dataset.v, gv: (document.querySelector('#gpaVal .cnt') || { dataset: {} }).dataset.v } });
    const p2 = await run(pg, () => ({ n: (document.querySelector('#progDone .cnt') || {}).textContent,
      pc: document.getElementById('progPct').textContent, g: (document.querySelector('#gpaVal .cnt') || {}).textContent,
      gs: (document.querySelector('#gpaVal small') || {}).textContent }));
    ok(p1.v && counted(R1['#progDone'], p1.v) && / \/ \d+ /.test(p1.tail),
      `[${theme}] **ساعات الخطة تعدّ** (وذيلها «/ 139 ساعة» ثابت) — ${JSON.stringify([p1, (R1['#progDone'] || {}).vals])}`);
    ok(counted(R1['#progPct'], p1.pv + '%'), `[${theme}] **والنسبة تعدّ** — ${JSON.stringify((R1['#progPct'] || {}).vals)}`);
    ok(counted(R1['#gpaVal'], Number(p1.gv).toFixed(2)), `[${theme}] **والمعدل يعدّ** — ${JSON.stringify((R1['#gpaVal'] || {}).vals)}`);
    ok(p2.n === p1.v && p2.pc === p1.pv + '%', `[${theme}] وتوصل: ${p2.n} ساعة · ${p2.pc}`);
    ok(/^\d\.\d\d$/.test(String(p2.g)) && p2.g === Number(p1.gv).toFixed(2) && p2.gs === ' / 4.00',
      `[${theme}] **والمعدل يعدّ لـ${p2.g}** بخانتين (/ 4.00 جنبه) — ${JSON.stringify(p2)}`);
    await shot(pg, `motion-plan-${theme}.png`);
    ok(P4.errs.length === 0, `[${theme}] (جدولي والخطة) بلا أخطاء JS: ` + P4.errs.slice(0, 2).join(' | '));
    }
    await P4.ctx.close();

    /* ── ٦) شريط الزائر ── */
    let gb = await run(pg, () => { const b = document.getElementById('tgBar'); const r = b.getBoundingClientRect();
      return { shown: !b.hidden && r.height > 0, slim: b.classList.contains('slim'), h: Math.round(r.height),
        x: !!b.querySelector('.tgb-x'), t: b.textContent.replace(/\s+/g, ' ').trim() } });
    ok(gb.shown && gb.slim && gb.h <= 46 && gb.x,
      `[${theme}] **شريط الزائر سطر رفيع بزر ✕** (كان صندوقاً بسطرين فوق كل تبويب) — ${JSON.stringify(gb)}`);
    await shot(pg, `motion-guestbar-${theme}.png`);
    await pg.click('#tgBar .tgb-x', { timeout: 3000 }).catch(() => {});
    gb = await run(pg, () => ({ hidden: document.getElementById('tgBar').hidden, ls: localStorage.getItem('pmu_guestbar_off') }));
    ok(gb.hidden && Number(gb.ls) > 0, `[${theme}] **✕ يقفله** — ${JSON.stringify(gb)}`);
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForFunction(() => typeof AUTH_READY !== 'undefined' && AUTH_READY, null, { timeout: 8000 }).catch(() => {});
    await pg.waitForTimeout(200);
    gb = await run(pg, () => document.getElementById('tgBar').hidden);
    eq(gb, true, `[${theme}] وبعد إعادة التحميل يبقى مقفول`);
    await run(pg, () => localStorage.setItem('pmu_guestbar_off', String(Date.now() - 8 * 864e5)));
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForFunction(() => typeof AUTH_READY !== 'undefined' && AUTH_READY, null, { timeout: 8000 }).catch(() => {});
    await pg.waitForTimeout(200);
    gb = await run(pg, () => !document.getElementById('tgBar').hidden);
    eq(gb, true, `[${theme}] **وبعد أسبوع يرجع يذكّره** (شغله ممكن يضيع) — **وأول ما تنعرف الجلسة** (كان ينتظر ٤ ثوانٍ وينزل فجأة)`);

    /* ── ٧) الزر العائم ── */
    await run(pg, () => { switchTab('search'); doSearch() });
    await pg.waitForFunction(() => document.querySelectorAll('#resultsList .course-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    await pg.waitForTimeout(500);
    await pg.mouse.move(200, 500);
    await pg.mouse.wheel(0, 600);
    await pg.waitForTimeout(250);
    const f1 = await run(pg, () => { const f = document.querySelector('.guide-fab'); return { away: f.classList.contains('away'), pe: getComputedStyle(f).pointerEvents } });
    ok(f1.away && f1.pe === 'none', `[${theme}] **وقت التمرير زر «؟» يتنحّى** (كان يغطي «أضف» و«راقب») — ${JSON.stringify(f1)}`);
    await pg.waitForTimeout(1300);
    const f2 = await run(pg, () => document.querySelector('.guide-fab').classList.contains('away'));
    eq(f2, false, `[${theme}] ويرجع أول ما توقف`);

    const over = await run(pg, () => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${over}`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٥) «تقليل الحركة» ── */
  {
    const { ctx, pg, errs } = await open({ reduce: true });
    await run(pg, () => switchTab('plan'));
    const an = await run(pg, () => getComputedStyle(document.getElementById('pagePlan')).animationName);
    eq(an, 'none', '**«تقليل الحركة» في الجوال: التبويب يتبدّل بلا حركة**');
    const p = await run(pg, () => { const n = document.querySelector('#progDone .cnt'); return n ? [n.textContent, n.dataset.v] : null });
    ok(Array.isArray(p) && p[0] === p[1], `**والأرقام نهائية على طول** — ${JSON.stringify(p)}`);
    await run(pg, () => { switchTab('search'); doSearch() });
    await pg.waitForFunction(() => document.querySelectorAll('#resultsList .course-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    const r = await run(pg, () => ({ t: document.getElementById('statTotal').textContent,
      an: getComputedStyle(document.querySelector('#resultsList .course-card')).animationName }));
    eq(r, { t: '18', an: 'none' }, 'والنتائج بلا ظهور متدرّج');
    ok(errs.length === 0, '(تقليل الحركة) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { fail++; out.push('  ✗ انهار: ' + (e && e.stack || e)); done() });

function done() {
  if (out.length) console.log(out.join('\n'));
  console.log(`الحركة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}
