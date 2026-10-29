/* «الدكاترة» — طلب محمد (٢٧ أكتوبر ٢٠٢٦: «يكون تفاعلي اكثر وما تحسه جامد»)، الفكرة ١١ اللي وافق عليها:
   «نجوم وأشرطة للتقييم بدل النص». Chromium على ٣٩٠ بالثيمين:
   ١) النجوم بكسورها (4.2 = أربع وخُمس الخامسة) — كانت تتقرّب لأقرب نجمة (4.6 تطلع خمس). وفي القائمة أكبر.
   ٢) صفحة الدكتور: الرقم الكبير يعدّ، وأشرطة توزيع التقييم تكبر ورا بعض — لما تفتحها بس (إعادة الرسم لا).
   ٣) الصفات («يشرح زين» …) أشرطة بعددها بدل كلمات متساوية.
   ٤) التواريخ ميلادية بأرقام لاتينية (CLAUDE.md «الصفحة»): تاريخ التقييم · «تقييماتي» · تقويم التسجيل ·
      ورقة الطباعة — كانت ar-SA: **هجري** بأرقام هندية (١٠ يناير = «٢ شعبان» · «٩/٥/١٤٤٨ هـ»).
   ٥) «تقليل الحركة» يطفيها.

   node tests/test-doc-look.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nالدكاترة: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* أسماء الدكاترة لاتينية كما في القاعدة (٩٠ اسم صفر منها عربي — §٦)، والتعليقات من الطلاب عربية */
const R = (id, name, rating, tags, day, uid) => ({ id, instructor_name: name, rating, course_code: 'MEEN 3311', comment: 'شرحه واضح',
  tags, created_at: `2026-10-${day}T10:00:00Z`, hidden: false, agree: 1, disagree: 0, user_id: uid || ('u' + id) });
const REVIEWS = [
  R(1, 'Smith, John', 5, ['clear', 'helpful'], '20'), R(2, 'Smith, John', 4, ['clear'], '21'), R(3, 'Smith, John', 4, ['clear', 'fair'], '22'),
  R(4, 'Smith, John', 5, ['clear', 'helpful'], '23'), R(5, 'Smith, John', 4, [], '24'), R(6, 'Smith, John', 3, [], '25', 'me'),
  R(7, 'Abumuhammad, Moinuddeen', 3, ['hard_exam'], '26'),
];
const SMITH = { n: 6, avg: 25 / 6 };                 /* 4.1667 ⇒ «4.2» وأربع نجوم وسدس */
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
const AR_DIGITS = /[٠-٩]/;

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
    send({ ok: true });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  const open = async ({ theme = 'dark', reduce = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(theme => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"'); localStorage.setItem('theme', theme);
      localStorage.setItem('pmu_guestbar_off', String(Date.now()));
    } catch (e) {} }, theme);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(300);
    /* التقييمات والدكاترة كما تجي من القاعدة */
    await pg.evaluate(rv => { reviews = rv; instructors = ['Smith, John', 'Abumuhammad, Moinuddeen', 'Lee, Ann']; docsLoaded = true }, REVIEWS).catch(() => {});
    return { ctx, pg, errs };
  };
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  const shot = async (pg, name) => { if (shots) await pg.screenshot({ path: path.join(shots, name) }) };
  /* نسبة امتلاء النجوم كما انرسمت: عرض الذهبية من الكل */
  const FILL = sel => [...document.querySelectorAll(sel)].map(s => { const on = s.querySelector('.st-on');
    return on ? +(on.getBoundingClientRect().width / s.getBoundingClientRect().width).toFixed(3) : null });

  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme });
    await run(pg, () => { switchTab('docs'); renderDocs() });
    await pg.waitForTimeout(150);

    /* ── ١) القائمة: نجوم بكسورها وأكبر ── */
    let r = await run(pg, () => [...document.querySelectorAll('#docsList .doc-row')].map(d => ({ n: d.querySelector('.doc-name').textContent,
      num: (d.querySelector('.doc-num') || {}).textContent || null, fs: d.querySelector('.doc-stars') ? parseFloat(getComputedStyle(d.querySelector('.doc-stars')).fontSize) : null })));
    const smith = (r || []).find(x => x.n === 'Smith, John') || {};
    ok(smith.num === '4.2' && smith.fs >= 12, `[${theme}] **القائمة: «4.2» ونجومه أكبر** (كانت ٩px) — ${JSON.stringify(smith)}`);
    let f = await run(pg, FILL, '#docsList .doc-stars .stars');
    ok(Array.isArray(f) && f.length === 2 && Math.abs(f[0] - SMITH.avg / 5) < 0.02 && Math.abs(f[1] - 3 / 5) < 0.02,
      `[${theme}] **النجوم بكسورها**: 4.17 تمتلي ${(SMITH.avg / 5 * 100).toFixed(1)}٪ (كانت تتقرّب لأربع) — ${JSON.stringify(f)}`);
    const dir = await run(pg, () => { const on = document.querySelector('#docsList .stars .st-on'); const s = getComputedStyle(on); return { r: s.right, l: s.left } });
    eq(dir && dir.r, '0px', `[${theme}] **وتمتلي من اليمين (بداية السطر بالعربي)**`);
    await shot(pg, `docs-list-${theme}.png`);

    /* ── ٢) صفحة الدكتور: الرقم يعدّ والأشرطة تكبر ورا بعض ── */
    await run(pg, () => { window.__V = []; new MutationObserver(() => { const e = document.getElementById('docScore'); if (e) window.__V.push(e.textContent) })
      .observe(document.getElementById('docDetail'), { childList: true, characterData: true, subtree: true }) });
    await run(pg, () => openDoc('Smith, John'));
    await pg.waitForTimeout(80);
    r = await run(pg, () => { const h = document.querySelector('#docDetail .doc-hero'), b = [...document.querySelectorAll('#docDetail .bar-fill')];
      return { anim: h && h.classList.contains('anim'), an: b.map(x => getComputedStyle(x).animationName), dl: b.map(x => getComputedStyle(x).animationDelay),
        w: b.map(x => x.style.width), org: b[0] ? getComputedStyle(b[0]).transformOrigin : null, bw: b[0] ? b[0].getBoundingClientRect().width : 0 } });
    ok(r.anim && r.an.every(a => a === 'barGrow') && r.dl.join() === '0s,0.06s,0.12s,0.18s,0.24s',
      `[${theme}] **أشرطة التوزيع تكبر ورا بعض لما تفتح الدكتور** — ${JSON.stringify({ an: r.an, dl: r.dl })}`);
    eq(r.w.map(x => Math.round(parseFloat(x))), [33, 50, 17, 0, 0], `[${theme}] وعرضها من توزيع تقييماته (5★: 2 من 6 · 4★: 3 · 3★: 1)`);
    await pg.waitForTimeout(900);
    const vals = await run(pg, () => window.__V);
    const sc = await run(pg, () => { const e = document.getElementById('docScore'); return { t: e.textContent, v: e.dataset.v } });
    ok(Array.isArray(vals) && vals.length >= 3 && vals[vals.length - 1] === '4.2' && vals.some(x => x !== '4.2' && x !== '0.0') && sc.v === '4.2',
      `[${theme}] **الرقم الكبير يعدّ لـ4.2** (والنهائي في data-v) — ${JSON.stringify([vals && vals.slice(0, 2), vals && vals.slice(-1), sc])}`);
    f = await run(pg, FILL, '#docDetail .hero-stars .stars');
    ok(Array.isArray(f) && Math.abs(f[0] - SMITH.avg / 5) < 0.02, `[${theme}] **ونجوم صفحته بكسورها** — ${JSON.stringify(f)}`);

    /* ── ٣) الصفات أشرطة بعددها ── */
    r = await run(pg, () => ({ cloud: document.querySelectorAll('#docDetail .tag-cloud, #docDetail .tag-chip').length,
      rows: [...document.querySelectorAll('#docDetail .tag-bars .tb-row')].map(x => ({ l: x.querySelector('.tb-l').textContent, n: x.querySelector('b').textContent,
        w: x.querySelector('.tb-track i').style.width, an: getComputedStyle(x.querySelector('.tb-track i')).animationName })) }));
    eq(r.rows && r.rows.map(x => [x.l, x.n, x.w]), [['يشرح زين', '4', '100%'], ['متعاون', '2', '50%'], ['تصحيحه عادل', '1', '25%']],
      `[${theme}] **الصفات أشرطة بعددها**: الأكثر شريط كامل والباقي بنسبته`);
    ok(r.cloud === 0 && r.rows.every(x => x.an === 'barGrow'), `[${theme}] بدل الكلمات المتساوية (tag-cloud)، وتكبر كذلك — ${JSON.stringify(r.cloud)}`);
    await shot(pg, `doc-detail-${theme}.png`);

    /* ── إعادة الرسم ما تعيد الحركة ── */
    await run(pg, () => { window.__V = []; renderDocDetail() });
    await pg.waitForTimeout(300);
    r = await run(pg, () => ({ anim: document.querySelector('#docDetail .doc-hero').classList.contains('anim'),
      an: getComputedStyle(document.querySelector('#docDetail .bar-fill')).animationName, t: document.getElementById('docScore').textContent,
      v: window.__V.every(x => x === '4.2') }));
    eq(r, { anim: false, an: 'none', t: '4.2', v: true }, `[${theme}] **إعادة الرسم (تفاعل · تقييمك · لغة) ما تعيد العدّ ولا الأشرطة** (الرقم 4.2 من أول لحظة)`);

    /* ── ٤) التواريخ ميلادية بأرقام لاتينية ── */
    r = await run(pg, () => [...document.querySelectorAll('#docDetail .rev-date')].map(x => x.textContent).filter(x => x !== 'طالب'));
    ok(Array.isArray(r) && r.length === 6 && r.every(x => !/[٠-٩]/.test(x) && /^\d{1,2} \S+ 2026$/.test(x.trim())),
      `[${theme}] **تاريخ التقييم «20 أكتوبر 2026»** (كان هجري: «٩/٥/١٤٤٨ هـ») — ${JSON.stringify(r && r.slice(0, 2))}`);
    r = await run(pg, () => { USER = { id: 'me', email: 'x@y.z' }; renderMyReviews(); const s = document.querySelector('#myRevList .my-rev-sub'); const t = s ? s.textContent : ''; USER = null; return t });
    ok(/2026/.test(r) && !AR_DIGITS.test(r), `[${theme}] **و«تقييماتي» كذلك** — ${r}`);
    r = await run(pg, () => calFmt('2027-01-10'));
    eq(r, '10 يناير', `[${theme}] **وتقويم التسجيل في «جدولي»** (calFmt — كان هجري: «٢ شعبان»)`);
    /* ورقة الطباعة تنبني لجدول فيه مواد */
    r = await run(pg, () => { schedule.push({ crn: '30011', courseCode: 'MEEN 3311', courseTitle: 'Thermodynamics I', section: '101', courseDate: 'MW',
      courseTiming: '0800 - 0915', instructor: 'Smith, John', room: 'M-CORE - G034', status: 'CLOSE', gender: 'M' });
      buildPrintSheet(new Set()); const f = document.querySelector('#printSheet .ps-foot span:last-child'); const t = f ? f.textContent : ''; schedule.pop(); buildPrintSheet(new Set()); return t });
    ok(/\d{4}/.test(r) && !AR_DIGITS.test(r), `[${theme}] **وورقة الطباعة** (بالسنة) — ${r}`);

    /* ── الإنجليزي ── */
    await run(pg, () => toggleLang());
    await run(pg, () => renderDocDetail());
    r = await run(pg, () => ({ d: (document.querySelector('#docDetail .rev-date:last-child') || {}).textContent, l: getComputedStyle(document.querySelector('#docDetail .stars .st-on')).left,
      t: (document.querySelector('#docDetail .tb-l') || {}).textContent }));
    ok(/^\d{1,2} Oct 2026$/.test(r.d) && r.l === '0px' && r.t === 'Explains well', `[${theme}] **بالإنجليزي: «20 Oct 2026»، والنجوم من اليسار** — ${JSON.stringify(r)}`);
    await run(pg, () => toggleLang());

    const over = await run(pg, () => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${over}`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٥) «تقليل الحركة» ── */
  {
    const { ctx, pg, errs } = await open({ reduce: true });
    await run(pg, () => openDoc('Smith, John'));
    await pg.waitForTimeout(60);
    const r = await run(pg, () => ({ an: getComputedStyle(document.querySelector('#docDetail .bar-fill')).animationName,
      tb: getComputedStyle(document.querySelector('#docDetail .tb-track i')).animationName, t: document.getElementById('docScore').textContent }));
    eq(r, { an: 'none', tb: 'none', t: '4.2' }, '**«تقليل الحركة»: الأشرطة بطولها والرقم نهائي على طول**');
    ok(errs.length === 0, '(تقليل الحركة) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { fail++; out.push('  ✗ انهار: ' + (e && e.stack || e)); done() });
