/* النص الثانوي ينقرأ — دراسة الشكل (١٣ نوفمبر ٢٠٢٦): أكثر من ثلث نص الموقع (القاعة · اسم الدكتور · أسماء
   التبويبات غير المختارة · العناوين الصغيرة · التواريخ) كان بلون --text3 وتباينه ٢٫٤–٣٫١ بالثيمين، والحد
   المتعارف عليه للنص العادي ٤٫٥. Chromium على ٣٩٠ بالثيمين، ويقيس اللون **كما انرسم** فوق خلفيته الفعلية:
   ١) اللون نفسه (--text3) ٤٫٥ على الأقل فوق الخلفية وفوق البطاقة — ويبقى أهدأ من --text2، و--text2 أهدأ من --text.
   ٢) كل نص مرسوم به في البحث وجدولي (قائمة وشبكة) واليوم وخطتي والإعدادات ٤٫٥ على الأقل
      (إلا اللي بهّتناه عمداً بالشفافية: محاضرة خلصت · خانة مقفلة).
   ٣) عناصر بعينها يقرأها الطالب كل يوم: اسم التبويب غير المختار · القاعة والدكتور في جدولي · القاعة في نتائج
      البحث · عنوان البطاقة · تلميح الحقل · ساعات الشبكة وسطورها الصغيرة · جملة «موقع مستقل» تحت.
   ٤) ونسبة النص الضعيف في الشاشات نزلت (كانت ٢٦–٥٩٪ من حروف الشاشة).

   node tests/test-contrast.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const done = () => { out.forEach(l => console.log(l)); console.log(`\nالتباين: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* صفوف بصيغة الجامعة حرفاً بحرف (الوقت بلا نقطتين · الأيام حروف · OPEN/CLOSE · الدكاترة لاتيني) */
const C = (crn, code, title, sec, days, time, ins, room, st) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: st || 'CLOSE', gender: sec[0] === '2' ? 'F' : 'M' });
const COURSES = [
  C('30011', 'MEEN 3311', 'Thermodynamics I', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034', 'OPEN'),
  C('30012', 'MEEN 3311', 'Thermodynamics I', '102', 'UT', '1100 - 1215', 'Smith, John', 'M-CORE - G035', 'CLOSE'),
  C('30021', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'UT', '0800 - 0915', 'Khan, Imran', 'M-SCI - 101', 'CLOSE'),
  C('30023', 'CHEM 1311', 'Chemistry for Engineers I LAB', '111', 'R', '1300 - 1550', 'Lee, Ann', 'M-SCI - L201', 'OPEN'),
];
const SCHED = [COURSES[0], COURSES[2], COURSES[3],
  C('30091', 'MATH 2301', 'Calculus III', '101', 'UTR', '1000 - 1050', 'Brown, Mark', 'M-CORE - G101')];
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

/* ═══ القياس داخل الصفحة: لون النص كما انرسم فوق خلفيته الفعلية (الخلفيات الشفافة تتركّب فوق بعض) ═══ */
const MEASURE = named => {
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) };
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1] };
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
  const probe = (prop, v) => { const d = document.createElement('i'); d.style[prop] = `var(${v})`; document.body.appendChild(d);
    const x = getComputedStyle(d)[prop]; d.remove(); return x };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  const bgOf = el => { const chain = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { chain.push(c); if (c[3] >= 0.999) break } }
    let bg = pageBg; for (let i = chain.length - 1; i >= 0; i--) bg = over(chain[i], bg); return bg };
  const dim = el => { let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity || '1'); return op };
  const visible = el => { try { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false } catch (e) {}
    const r = el.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5 };
  const T3 = probe('color', '--text3'), T2 = probe('color', '--text2'), T1 = probe('color', '--text');
  const BG = parse(probe('backgroundColor', '--bg')), CARD = parse(probe('backgroundColor', '--card'));
  const roots = [...document.querySelectorAll('.topbar, .tabs, .page.active, .legal-foot')];
  const SYMBOLS = /^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}️‍.,:;!?()\-–—·•|/\\+×✕✓▾▸◂▴▼▲←→↑↓‹›⌄%#*'"«»]*$/u;
  const t3 = []; let chars = 0, low = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const txt = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!txt || SYMBOLS.test(txt)) continue;
    const el = n.parentElement; if (!el || !roots.some(r => r.contains(el)) || !visible(el)) continue;
    const cs = getComputedStyle(el), col = parse(cs.color); if (!col) continue;
    const op = dim(el), bg = bgOf(el), r = ratio(over([col[0], col[1], col[2], col[3] * op], bg), bg);
    const fs = parseFloat(cs.fontSize), large = fs >= 24 || (fs >= 18.66 && (parseInt(cs.fontWeight) || 400) >= 700);
    chars += txt.length; if (r < (large ? 3 : 4.5)) low += txt.length;
    if (cs.color === T3 && op > 0.99) t3.push({ t: txt.slice(0, 28), r: +r.toFixed(2), c: (el.className || el.tagName).toString().slice(0, 30) });
  }
  const one = sel => { const el = [...document.querySelectorAll(sel)].find(e => roots.some(r => r.contains(e)) && visible(e) && e.textContent.trim());
    if (!el) return null; const col = parse(getComputedStyle(el).color), bg = bgOf(el), op = dim(el);
    return +ratio(over([col[0], col[1], col[2], col[3] * op], bg), bg).toFixed(2) };
  const P = c => parse(c);
  return { tok: { t3bg: +ratio(P(T3), BG).toFixed(2), t3card: +ratio(P(T3), CARD).toFixed(2),
                  t2card: +ratio(P(T2), CARD).toFixed(2), t1card: +ratio(P(T1), CARD).toFixed(2) },
    t3, worst: t3.slice().sort((a, b) => a.r - b.r).slice(0, 4), share: chars ? +(low / chars * 100).toFixed(1) : 0, chars,
    named: Object.fromEntries((named || []).map(s => [s, one(s)])) };
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
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 200) }));

  /* كل شاشة: كيف نوصلها، وعناصر بعينها لازم تنقرأ فيها */
  const ALWAYS = ['.tabs .tab:not(.active) .tl', '.legal-foot .legal-note'];
  const VIEWS = [
    ['البحث', async pg => { await run(pg, async () => { switchTab('search'); await doSearch() });
        await pg.waitForFunction(() => document.querySelectorAll('#resultsList .sec-row').length > 0, null, { timeout: 8000 }).catch(() => {}) },
      /* الباقي هنا مو نص ثانوي: ألوان الحالة (أخضر/أصفر/أحمر) فوق خلفياتها الملوّنة في الفاتح، والأبيض على الأزرق في الغامق */
      ['.search-card .sc-title', '.field-help', '.sr-room', '.sr-crn'], 18],
    ['جدولي — قائمة', async pg => { await run(pg, () => { switchTab('sched'); setSchedView('list') }) },
      ['.slot-sub', '.sum-label', '.day-head .cnt'], 12],
    ['جدولي — شبكة', async pg => { await run(pg, () => { switchTab('sched'); setSchedView('grid') }) },
      ['.gr-item i', '.gr-item u', '.gr-hcol span'], 12],
    ['اليوم', async pg => { await run(pg, () => switchTab('today')) }, [], null],
    ['خطتي', async pg => { await run(pg, () => { switchTab('plan'); const b = document.querySelector('.sem-block'); if (b) b.classList.add('open') }) },
      ['.sem-chip:not(.done)', '.pc-code span'], 12],
    ['الإعدادات', async pg => { await run(pg, () => switchTab('set')) }, ['.set-card .sc-title'], 12],
  ];

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    /* أحد ٩:٥٠ الصبح: محاضرة خلصت (باهتة عمداً) ومحاضرة جاية */
    await pg.clock.install({ time: new Date('2026-11-15T09:50:00+03:00') });
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(sch => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"');
      localStorage.setItem('pmu_schedules', JSON.stringify([sch, [], []])); localStorage.setItem('pmu_schedule', JSON.stringify(sch));
      localStorage.setItem('pmu_completed', JSON.stringify(['MATH 1422', 'PHYS 1421', 'COMM 1321']));
      localStorage.setItem('pmu_guestbar_off', String(Date.now()));
    } catch (e) {} }, SCHED);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(400);
    ok(await run(pg, th => document.documentElement.classList.contains('light') === (th === 'light'), theme) === true, `[${theme}] الثيم المطلوب هو المرسوم`);

    /* ── ١) اللون نفسه ── */
    const tk = (await run(pg, MEASURE, [])).tok || {};
    ok(tk.t3bg >= 4.5 && tk.t3card >= 4.5,
      `[${theme}] **--text3 ينقرأ: ٤٫٥ على الأقل فوق الخلفية والبطاقة** (كان ٢٫٤–٣٫١) — الخلفية ${tk.t3bg} · البطاقة ${tk.t3card}`);
    ok(tk.t3card < tk.t2card - 0.5 && tk.t2card < tk.t1card - 1,
      `[${theme}] ويبقى أهدأ من --text2، و--text2 أهدأ من --text (الترتيب ما ينمسح) — ${tk.t3card} < ${tk.t2card} < ${tk.t1card}`);

    let chars = 0, lowChars = 0;
    for (const [name, go, named, cap] of VIEWS) {
      await go(pg);
      await pg.waitForTimeout(700);
      const m = await run(pg, MEASURE, ALWAYS.concat(named));
      if (shots) await pg.screenshot({ path: path.join(shots, `contrast-${theme}-${VIEWS.findIndex(v => v[0] === name)}.png`) });
      ok(m && !m.err && m.t3 && m.t3.length >= 3, `[${theme}] ${name}: فيها نص باللون الثالثي نقيسه — ${m && (m.err || (m.t3 || []).length)}`);
      if (!m || m.err || !m.t3) continue;
      /* ── ٢) كل نص مرسوم به ── */
      const bad = m.t3.filter(x => x.r < 4.5);
      ok(bad.length === 0, `[${theme}] **${name}: كل نص باللون الثالثي ٤٫٥ على الأقل** — ${bad.length} من ${m.t3.length} تحت الحد، أضعفها ${JSON.stringify(m.worst.slice(0, 2))}`);
      /* ── ٣) عناصر بعينها ── */
      for (const sel of ALWAYS.concat(named)) {
        const r = m.named[sel];
        ok(r != null && r >= 4.5, `[${theme}] ${name}: «${sel}» ينقرأ (٤٫٥ على الأقل) — ${r == null ? 'ما لقيناه' : r}`);
      }
      /* ── ٤) نسبة النص الضعيف في الشاشة ── */
      if (cap != null) ok(m.share <= cap, `[${theme}] **${name}: النص الضعيف ${cap}٪ من الحروف على الأكثر** (كان ٢٦–٥٩٪) — ${m.share}٪`);
      chars += m.chars; lowChars += m.chars * m.share / 100;
      if (process.env.SHOW) console.log(`  · [${theme}] ${name}: ضعيف ${m.share}٪ من ${m.chars} حرف · ثالثي ${m.t3.length} نص، أضعفه ${m.worst[0] && m.worst[0].r}`);
    }
    const total = chars ? +(lowChars / chars * 100).toFixed(1) : 100;
    ok(total <= 10, `[${theme}] **وفي الشاشات كلها: النص الضعيف ١٠٪ على الأكثر** (كان فوق الثلث) — ${total}٪`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS — ${errs[0] || ''}`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  done();
})().catch(e => { ok(false, 'انهار: ' + (e && e.stack || e)); done() });
