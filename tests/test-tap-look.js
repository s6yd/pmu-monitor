/* الأزرار الصغيرة تنضغط — دراسة الشكل (١٣ نوفمبر ٢٠٢٦)، البندان ٣ · ٤. Chromium على ٣٩٠ بالثيمين:
   ١) ضغطة جنب الزر الصغير (مو عليه بالضبط) توصله: ✓ في الخطة · ✕ في جدولي · اللغة والثيم فوق · «+ أضف» و«راقب» في
      البحث · نجوم التقييم · ✕ لوح المساعد. نسأل المتصفح نفسه «مين تحت هالنقطة؟» (elementFromPoint) على بعد ١٩px من
      مركز الزر — مساحة ضغط ٣٨px على الأقل — والشكل نفسه (مقاس الزر المرسوم ما تغيّر).
      وضغطة فعلية جنب ✕ و✓ تسوي فعلها. بالماوس لا باللمس: كروم يصحّح اللمس للزر القريب بنفسه، فاللمس كان ينجح على
      القديم كذلك وما يقيس مساحة الزر نفسه.
   ٢) المساحة الجديدة ما تسرق ضغطة زر ثاني: كل زر ظاهر في الشاشة، نقاطه الخمس داخله ترجع له لا لزر مكبَّر غيره.
   ٣) زر «؟» (الدليل والمساعد) في الشريط فوق جنب ⚙️، وما فيه شي عائم تحت يغطي زر: ✕ جدولي (يسار) و✓ الخطة (يمين)
      و«+ أضف» (يسار) ينضغطون وهم في آخر الشاشة. كان عائماً يسار تحت فوق «أضف» و✕، واليمين فوق ✓ الخطة.

   node tests/test-tap-look.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const done = () => { out.forEach(l => console.log(l)); console.log(`\nمساحة الضغط: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* صفوف بصيغة الجامعة (الوقت بلا نقطتين · الأيام حروف · OPEN/CLOSE · الدكاترة لاتيني) */
const C = (crn, code, title, sec, days, time, ins, room, st) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: st || 'CLOSE', gender: 'M' });
const SCHED = [
  C('33011', 'MEEN 3311', 'Thermodynamics I', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034', 'OPEN'),
  C('33021', 'MATH 2301', 'Calculus III', '101', 'UTR', '1000 - 1050', 'Brown, Mark', 'M-CORE - G101'),
  C('33031', 'COMM 2312', 'Technical and Profe. Commun.', '101', 'UT', '1300 - 1415', 'Lee, Ann', 'M-CORE - G110'),
];
const COURSES = [...SCHED,
  C('33012', 'MEEN 3311', 'Thermodynamics I', '102', 'UT', '1100 - 1215', 'Smith, John', 'M-CORE - G035', 'OPEN'),
  C('33041', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'UT', '0800 - 0915', 'Khan, Imran', 'M-SCI - 101', 'OPEN')];
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

/* داخل الصفحة: أول زر ظاهر يطابق — مقاسه المرسوم، ومين تحت النقاط حوله (dx: يسار/يمين · dy: فوق/تحت، ٠ = ما نفحصه) */
const HIT = ([sel, dx, dy]) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().width > 0);
  if (!el) return { missing: true };
  if (!el.closest('.topbar')) el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const at = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)) };
  return { w: Math.round(r.width), h: Math.round(r.height),
    hits: [dx[0] ? at(cx - dx[0], cy) : true, dx[1] ? at(cx + dx[1], cy) : true, dy[0] ? at(cx, cy - dy[0]) : true, dy[1] ? at(cx, cy + dy[1]) : true] };
};
const all = h => !!h && !h.missing && !h.err && h.hits.every(Boolean);
/* الزر ينزل لآخر الشاشة (٣٠px فوق حدها — وين كان الزر العائم) ونسأل مين فوق مركزه. الصفحة تطوّل مؤقتاً عشان ينزل */
const AT_BOTTOM = sel => {
  document.body.style.paddingBottom = '900px';
  const el = [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width > 0).pop();   /* الأخير: الأول فوق ما ينزل لآخر الشاشة */
  if (!el) return { missing: true };
  el.scrollIntoView({ block: 'end' }); window.scrollBy(0, 30);
  return new Promise(r => setTimeout(() => {
    const b = el.getBoundingClientRect(), t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const res = { y: Math.round(innerHeight - b.bottom), x: Math.round(b.left), own: !!t && (t === el || el.contains(t)),
      top: t && !(t === el || el.contains(t)) ? (t.className || t.tagName).toString().slice(0, 24) : '' };
    document.body.style.paddingBottom = ''; r(res) }, 1300));
};

/* ٢) كل زر ظاهر: نقاطه الخمس داخله ترجع له، لا لزر مكبَّر غيره (root: الشاشة أو اللوح المفتوح) */
const HIJACK = root => {
  const BIG = '.pc-check,.slot-remove,.lang-btn.sm,.star-btn,.sr-btn,.ai-x';
  const tabs = document.querySelector('.tabs'), top = tabs ? tabs.getBoundingClientRect().bottom : 0;
  const box = root ? document.querySelector(root) : document.body;
  const ctl = [...box.querySelectorAll('button,a[href],input,select,label,[onclick]')].filter(e => {
    const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false;
    if (r.bottom > innerHeight || r.right > innerWidth || r.left < 0 || r.top < 0) return false;
    if (!root && !e.closest('.topbar,.tabs') && r.top < top) return false;          /* تحت الشريط الثابت */
    if (!root && e.closest('.guide-overlay,.ps-overlay')) return false;
    const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  });
  const bad = [];
  for (const c of ctl) {
    const r = c.getBoundingClientRect();
    for (const [fx, fy] of [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]]) {
      const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); if (!t) continue;
      const big = t.closest(BIG);
      if (big && big !== c && !c.contains(big) && !big.contains(c)) {
        bad.push(`${(c.className || c.tagName).toString().slice(0, 24)}«${c.textContent.trim().slice(0, 14)}» ← ${big.className.slice(0, 20)}`); break }
    }
  }
  return { n: ctl.length, bad };
};

(async () => {
  let chromium = null;
  try { ({ chromium } = require('playwright')) } catch (e) {}
  if (!chromium) { ok(false, 'playwright متوفر'); return done() }
  const plansJs = fs.existsSync(SHARED) ? fs.readFileSync(SHARED) : Buffer.from('');
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
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
  const noHijack = async (pg, theme, name, root) => {
    const j = await run(pg, HIJACK, root || null);
    ok(j && Array.isArray(j.bad) && j.n >= 3 && j.bad.length === 0,
      `[${theme}] **${name}: المساحة الجديدة ما تسرق ضغطة زر ثاني** — ${j && (j.err || `${j.n} زر · ${JSON.stringify(j.bad.slice(0, 3))}`)}`);
  };

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(sch => { try { if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"');
      localStorage.setItem('pmu_schedules', JSON.stringify([sch, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(sch));
      localStorage.setItem('pmu_guestbar_off', String(Date.now())) } catch (e) {} }, SCHED);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && window.PLANS, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(400);

    /* ── اللغة والثيم فوق: 30×20 مرسومين، والضغطة جنبهما توصل ── */
    let bt;
    let h = await run(pg, HIT, ['#langBtn', [19, 19], [16, 0]]);
    ok(all(h) && h.w === 30 && h.h === 20, `[${theme}] **زر اللغة: ضغطة جنبه وفوقه توصله** وشكله 30×20 كما كان — ${JSON.stringify(h)}`);
    h = await run(pg, HIT, ['#themeBtn', [19, 19], [0, 16]]);
    ok(all(h) && h.w === 30 && h.h === 20, `[${theme}] **زر الثيم: ضغطة جنبه وتحته توصله** — ${JSON.stringify(h)}`);
    const gap = await run(pg, () => { const a = document.getElementById('langBtn').getBoundingClientRect(), b = document.getElementById('themeBtn').getBoundingClientRect();
      const x = a.left + a.width / 2, who = y => { const t = document.elementFromPoint(x, y); return t ? t.id : '' };
      return [who(a.bottom - 0.5), who(b.top + 0.5)] });
    eq(gap, ['langBtn', 'themeBtn'], `[${theme}] وما يتداخلان: آخر سطر في اللغة لها وأول سطر في الثيم له`);

    /* ── «+ أضف» و«راقب» في البحث (ارتفاعها 32) ── */
    await run(pg, async () => { switchTab('search'); await doSearch() });
    await pg.waitForFunction(() => document.querySelectorAll('#resultsList .sr-btn').length > 0, null, { timeout: 8000 }).catch(() => {});
    await run(pg, () => document.querySelectorAll('#resultsList .course-card:not(.open) .cg-head').forEach(b => resToggle(b)));
    await pg.waitForTimeout(500);
    h = await run(pg, HIT, ['#resultsList .sr-btn.add', [0, 0], [19, 19]]);
    ok(all(h) && h.h === 32, `[${theme}] **«+ أضف»: ضغطة 19px فوقه وتحته توصله** وارتفاعه 32 كما كان — ${JSON.stringify(h)}`);
    h = await run(pg, HIT, ['#resultsList .sr-btn.bell', [0, 0], [19, 19]]);
    ok(all(h) && h.h === 32, `[${theme}] **«راقب»: نفسه** — ${JSON.stringify(h)}`);
    await noHijack(pg, theme, 'البحث');
    bt = await run(pg, AT_BOTTOM, '#resultsList .sr-btn.add');
    ok(bt && bt.own === true && bt.y >= 20 && bt.y <= 40, `[${theme}] **«+ أضف» في آخر الشاشة ينضغط — ما فوقه زر عائم** — ${JSON.stringify(bt)}`);
    await run(pg, () => window.scrollTo(0, 0));
    if (shots) await pg.screenshot({ path: path.join(shots, `tap-search-${theme}.png`) });

    /* ── ✕ في جدولي ── */
    await run(pg, () => { switchTab('sched'); setSchedView('list'); window.scrollTo(0, 0) });
    await pg.waitForTimeout(500);
    await noHijack(pg, theme, 'جدولي');
    h = await run(pg, HIT, ['#schedDays .slot-remove', [19, 19], [19, 19]]);
    ok(all(h) && h.w <= 26, `[${theme}] **✕ في جدولي: ضغطة على 19px منه توصله** (مرسوم ${h && h.w}×${h && h.h}) — ${JSON.stringify(h)}`);
    const before = await run(pg, () => schedule.length);
    const pt = await run(pg, () => { const b = document.querySelector('#schedDays .slot-remove'); b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2 - 17, y: r.top + r.height / 2 + 15 } });
    await pg.mouse.click(pt.x, pt.y);
    await pg.waitForTimeout(400);
    const after = await run(pg, () => schedule.length);
    ok(typeof before === 'number' && after === before - 1, `[${theme}] **وضغطة جنب ✕ (مو عليه) تحذف المادة فعلاً** — ${before} ⇒ ${after}`);

    /* ── ما فيه شي عائم فوق ✕ وهو في آخر الشاشة ── */
    bt = await run(pg, AT_BOTTOM, '#schedDays .slot-remove');
    ok(bt && bt.own === true && bt.y >= 20 && bt.y <= 40, `[${theme}] **✕ في آخر الشاشة ينضغط — ما فوقه زر عائم** — ${JSON.stringify(bt)}`);
    if (shots) await pg.screenshot({ path: path.join(shots, `tap-sched-${theme}.png`) });
    await run(pg, () => window.scrollTo(0, 0));

    /* ── زر «؟» في الشريط فوق جنب ⚙️، ويفتح الدليل ── */
    const hb = await run(pg, () => { const h = document.getElementById('helpBtn'), g = document.getElementById('setBtn');
      if (!h || !g) return { missing: true };
      const a = h.getBoundingClientRect(), b = g.getBoundingClientRect();
      return { inBar: !!h.closest('.topbar'), w: Math.round(a.width), h: Math.round(a.height),
        gap: Math.round(Math.max(b.left - a.right, a.left - b.right)), sameRow: Math.abs(a.top - b.top) < 2, floating: !!document.querySelector('.guide-fab') } });
    ok(hb && hb.inBar && hb.w >= 30 && hb.h >= 43 && hb.gap >= 0 && hb.gap <= 10 && hb.sameRow && hb.floating === false,
      `[${theme}] **زر «؟» في الشريط فوق جنب ⚙️ بنفس مقاسه، وما فيه زر عائم** — ${JSON.stringify(hb)}`);
    if (hb && !hb.missing) await pg.click('#helpBtn', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(500);
    const gOpen = await run(pg, () => document.getElementById('guideOverlay').classList.contains('open'));
    ok(gOpen === true, `[${theme}] **وضغطته تفتح الدليل** (فيه مدخل المساعد) — ${gOpen}`);
    await run(pg, () => closeGuide());
    await pg.waitForTimeout(300);

    /* ── ✓ في الخطة ── */
    await run(pg, () => { switchTab('plan'); document.querySelectorAll('.sem-block').forEach(b => b.classList.add('open')); window.scrollTo(0, 0) });
    await pg.waitForTimeout(600);
    h = await run(pg, HIT, ['#pagePlan .pc:not(.locked) .pc-check', [19, 19], [19, 19]]);
    ok(all(h) && h.w === 22 && h.h === 22, `[${theme}] **✓ في الخطة: ضغطة على 19px منه توصله** وشكله 22×22 كما كان — ${JSON.stringify(h)}`);
    await noHijack(pg, theme, 'خطتي');
    bt = await run(pg, AT_BOTTOM, '#pagePlan .pc:not(.locked) .pc-check');
    ok(bt && bt.own === true && bt.y >= 20 && bt.y <= 40, `[${theme}] **✓ في آخر الشاشة (يمين) ينضغط — ما فوقه زر عائم** — ${JSON.stringify(bt)}`);
    await run(pg, () => window.scrollTo(0, 0));
    const d0 = await run(pg, () => completed.length);
    const p2 = await run(pg, () => { const b = document.querySelector('#pagePlan .pc:not(.locked):not(.done) .pc-check'); b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2 + 16, y: r.top + r.height / 2 - 16 } });
    await pg.mouse.click(p2.x, p2.y);
    await pg.waitForTimeout(500);
    const d1 = await run(pg, () => completed.length);
    ok(typeof d0 === 'number' && d1 === d0 + 1, `[${theme}] **وضغطة جنب ✓ (مو عليه) تعلّم المادة فعلاً** — ${d0} ⇒ ${d1}`);
    if (shots) await pg.screenshot({ path: path.join(shots, `tap-plan-${theme}.png`) });

    /* ── نجوم التقييم (من دالتها نفسها) ── */
    await run(pg, () => { switchTab('docs'); const d = document.createElement('div'); d.className = 'star-pick'; d.id = 'starPick';
      document.getElementById('pageDocs').prepend(d); formStars = 3; renderStarPick() });
    await pg.waitForTimeout(300);
    h = await run(pg, HIT, ['#starPick .star-btn:nth-child(3)', [0, 0], [19, 19]]);
    ok(all(h), `[${theme}] **نجمة التقييم: ضغطة 19px فوقها وتحتها توصلها** — ${JSON.stringify(h)}`);
    const nb = await run(pg, () => [...document.querySelectorAll('#starPick .star-btn')].map(b => { const r = b.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === b }));
    ok(Array.isArray(nb) && nb.length === 5 && nb.every(Boolean), `[${theme}] وكل نجمة مركزها لها (ما تتداخل مع جارتها) — ${JSON.stringify(nb)}`);
    await run(pg, () => { const d = document.getElementById('starPick'); if (d) d.remove() });

    /* ── ✕ لوح المساعد ── */
    await run(pg, () => openAi());
    await pg.waitForTimeout(500);
    h = await run(pg, HIT, ['#aiSheet .ai-head button', [19, 19], [19, 19]]);
    ok(all(h), `[${theme}] **✕ لوح المساعد: ضغطة على 19px منه توصله** (مرسوم ${h && h.w}×${h && h.h}) — ${JSON.stringify(h)}`);
    await noHijack(pg, theme, 'لوح المساعد', '#aiSheet');
    const cl = await run(pg, () => { const b = document.querySelector('#aiSheet .ai-head button'); const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2 - 16, y: r.top + r.height / 2 + 16 } });
    await pg.mouse.click(cl.x, cl.y);
    await pg.waitForTimeout(400);
    const closed = await run(pg, () => !document.getElementById('aiOv').classList.contains('open'));
    ok(closed === true, `[${theme}] **وضغطة جنب ✕ تقفل اللوح**`);

    /* ── بالإنجليزي، وعلى جوال أضيق (٣٦٠): «؟» جنب ⚙️ وما يركب على الشعار ── */
    if (theme === 'dark') {
      await run(pg, () => { LANG = 'en'; applyLang(); window.scrollTo(0, 0) });
      await pg.setViewportSize({ width: 360, height: 780 });
      await pg.waitForTimeout(600);
      const tb = await run(pg, () => { if (!document.getElementById('helpBtn')) return { missing: true };
        const h = document.getElementById('helpBtn').getBoundingClientRect(), g = document.getElementById('setBtn').getBoundingClientRect(),
        l = document.getElementById('brandHome').getBoundingClientRect();
        return { gap: Math.round(Math.max(g.left - h.right, h.left - g.right)), logo: !(h.right <= l.left || h.left >= l.right),
          over: document.documentElement.scrollWidth - innerWidth } });
      ok(tb && tb.gap >= 0 && tb.gap <= 10 && tb.logo === false && tb.over <= 1,
        `وبالإنجليزي وعلى ٣٦٠: «؟» جنب ⚙️، ما يركب على الشعار، وبلا تمرير أفقي — ${JSON.stringify(tb)}`);
    }
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS — ${errs[0] || ''}`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  done();
})().catch(e => { ok(false, 'انهار: ' + (e && e.stack || e)); done() });

function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} — طلع ${JSON.stringify(a)} والمتوقع ${JSON.stringify(b)}`) }
