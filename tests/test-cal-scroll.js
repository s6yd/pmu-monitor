/* «مواعيد تهمك» كلها بالتمرير — طلب محمد (٢٥ نوفمبر ٢٠٢٦: «لا تحد الطالب في المواعيد القادمة الخمسة فقط حلوه الفكرة بس
   خلي بعد انه تقدر تسوي سكرول للمواعيد القادمة والي فاتت»). كانت البطاقة أقرب خمسة مواعيد جاية وبس، واللي فات يختفي.
   Chromium على ٣٩٠ بالثيمين بساعة مثبّتة (25 نوفمبر 2026):
   ١) كل مواعيد التقويم في القائمة: اللي فاتت فوق خط «اليوم» والجاية تحته، بترتيب تاريخها.
   ٢) القائمة تفتح على «اليوم» (الخط أول سطر ظاهر، وأقرب موعد جاي تحته) — والصفحة نفسها ما تتحرّك.
   ٣) تمرير لفوق = أول موعد في السنة · لتحت = آخر موعد. والقائمة بطولها المحدود (تمرير داخلها) وتحتها سطر يقول كيف.
   ٤) انرسمت وتبويبها مخفي: أول ما يفتح «جدولي» تنفتح على «اليوم».
   ٥) اللي فاتت: «قبل 15 يوم» · «أمس»، وبلون ثانوي لا بشفافية (تنقرأ). والجاية بعددها الصحيح («بعد 6 أيام»). والإنجليزي.
   SHOT_DIR للصور.   node tests/test-cal-scroll.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(SRV), 'shared', 'plans.js');
const source = fs.readFileSync(SRV, 'utf8');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const done = () => { out.forEach(l => console.log(l)); console.log(`\nمواعيد تهمك بالتمرير: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

const ci = source.indexOf('const ACAD_CAL = ['), cj = source.indexOf('\n];', ci);
const CAL = new Function(source.slice(ci, cj + 3) + '; return ACAD_CAL;')();
const TODAY = '2026-11-25';
const endOf = e => e.e || e.s;
const PAST = CAL.filter(e => endOf(e) < TODAY), NEXT = CAL.filter(e => endOf(e) >= TODAY);
const byStart = (a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : (endOf(a) < endOf(b) ? -1 : 1));
const FIRST = CAL.slice().sort(byStart)[0], LAST = CAL.slice().sort(byStart).pop();

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')) } catch (e) { ok(false, 'Playwright مو مثبّت'); return done() }
  const calJs = 'window.ACAD_CAL=' + JSON.stringify(CAL) + ';';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(calJs) }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(SHARED)) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ term: '202710', regTerm: '202710', nextRegTerm: '202720', canWatch: false, env: 'prod' }));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
  const open = async theme => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const p = await ctx.newPage();
    p.errs = [];
    p.on('pageerror', e => p.errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await p.addInitScript(th => {
      const F = Date.parse('2026-11-25T06:00:00Z'), R = Date;      /* 9 الصبح بالرياض */
      window.Date = class extends R { constructor(...a) { super(...(a.length ? a : [F])) } static now() { return F } };
      try { localStorage.setItem('theme', th); localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"') } catch (e) {}
    }, theme);
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof renderCalendar === 'function' && Array.isArray(window.ACAD_CAL) && ACAD_CAL.length > 0, null, { timeout: 15000 }).catch(() => {});
    p.ctx = ctx;
    return p;
  };
  /* القائمة كما تنعرض: كل سطر بموقعه داخل الصندوق المرئي */
  const read = p => p.evaluate(() => {
    const list = document.getElementById('calList') || document.getElementById('calBody');
    const L = list.getBoundingClientRect();
    const items = [...list.children].map(el => { const r = el.getBoundingClientRect();
      return { now: el.classList.contains('cal-now'), past: el.classList.contains('past'), row: el.classList.contains('cal-row'),
        name: (el.querySelector('.cal-name') || el).textContent.trim(), badge: (el.querySelector('.cal-badge') || {}).textContent || '',
        color: el.querySelector('.cal-name') ? getComputedStyle(el.querySelector('.cal-name')).color : '',
        op: el.querySelector('.cal-name') ? getComputedStyle(el.querySelector('.cal-name')).opacity : '',
        top: Math.round(r.top - L.top), bottom: Math.round(r.bottom - L.top) } });
    const t2 = (() => { const d = document.createElement('i'); d.style.color = 'var(--text2)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c })();
    return { items, h: Math.round(L.height), sh: list.scrollHeight, st: Math.round(list.scrollTop), id: list.id,
      notes: [...document.querySelectorAll('#calBody .fin-note')].map(n => n.textContent), y: Math.round(scrollY), t2,
      over: document.documentElement.scrollWidth - innerWidth };
  });
  const shots = process.env.SHOT_DIR;

  for (const theme of ['dark', 'light']) {
    const p = await open(theme);
    /* ٤) انرسمت والتبويب مخفي، وبعدين فتح «جدولي» */
    await p.evaluate(() => { switchTab('search'); renderCalendar(); switchTab('sched') });
    await p.waitForTimeout(250);
    await p.evaluate(() => { const c = document.getElementById('calCard'); if (c) scrollTo(0, c.getBoundingClientRect().top + scrollY - 120) });
    await p.waitForTimeout(150);
    let r = await read(p);
    const rows = r.items.filter(i => i.row), nowI = r.items.findIndex(i => i.now);
    ok(rows.length === CAL.length, `[${theme}] **كل مواعيد التقويم في القائمة (${CAL.length}) لا أقرب خمسة** — ${rows.length}`);
    ok(nowI >= 0 && r.items.slice(0, nowI).every(i => i.past) && r.items.slice(nowI + 1).every(i => !i.past) &&
      r.items.slice(0, nowI).length === PAST.length,
      `[${theme}] **اللي فاتت (${PAST.length}) فوق خط «اليوم» والجاية تحته** — ${nowI}`);
    ok(r.items[nowI] && /اليوم/.test(r.items[nowI].name), `[${theme}] والخط اسمه «اليوم»`);
    ok(r.id === 'calList' && r.sh > r.h + 50 && r.h <= 320, `[${theme}] **القائمة بطول محدود والتمرير داخلها** — ${r.h} من ${r.sh}`);
    const nw = r.items[nowI] || {}, firstNext = r.items[nowI + 1] || {};
    ok(nw.top >= -2 && nw.top <= 6, `[${theme}] **تنفتح على «اليوم»: الخط أول سطر ظاهر** (حتى لو انرسمت وتبويبها مخفي) — ${nw.top}`);
    ok(firstNext.top >= 0 && firstNext.bottom <= r.h && /القسط الثالث/.test(firstNext.name),
      `[${theme}] وتحته أقرب موعد جاي (القسط الثالث) ظاهر — ${firstNext.name} ${firstNext.top}…${firstNext.bottom}`);
    const lastPast = r.items[nowI - 1] || {};
    ok(lastPast.bottom <= 1, `[${theme}] واللي فاتت فوق — مخفية لين يمرّر — ${lastPast.bottom}`);
    ok(r.notes.some(n => /مرّر القائمة/.test(n)), `[${theme}] وتحتها سطر يقول كيف — ${r.notes.join(' | ')}`);
    ok(r.over <= 1, `[${theme}] بلا تمرير أفقي على ٣٩٠ — ${r.over}`);
    if (shots) await p.screenshot({ path: path.join(shots, `calscroll-${theme}.png`) });

    /* ٥) الشارات واللون */
    const pastByName = n => r.items.find(i => i.past && i.name.includes(n)) || {};
    ok(/قبل 15 يوم/.test(pastByName('القسط الثاني').badge), `[${theme}] **اللي فاتت «قبل …»: القسط الثاني «قبل 15 يوم»** — ${pastByName('القسط الثاني').badge}`);
    ok(pastByName('منتصف الترم').badge === 'أمس', `[${theme}] وإجازة منتصف الترم (خلصت 24 نوفمبر) «أمس» — ${pastByName('منتصف الترم').badge}`);
    ok(/بعد 6 أيام/.test(firstNext.badge), `[${theme}] **والجاية بعددها الصحيح: «بعد 6 أيام»** (كانت «بعد 6 يوم») — ${firstNext.badge}`);
    const pp = r.items.filter(i => i.past);
    ok(pp.length && pp.every(i => i.color === r.t2 && i.op === '1'), `[${theme}] **اللي فاتت بلون ثانوي لا بشفافية** (تنقرأ) — ${pp[0] && pp[0].color} ${pp[0] && pp[0].op}`);

    /* ٣) تمرير لفوق ولتحت · والصفحة ما تحرّكت */
    const y0 = r.y;
    await p.evaluate(() => { const l = document.getElementById('calList'); if (l) l.scrollTop = 0 });
    r = await read(p);
    const top0 = r.items.find(i => i.row) || {};
    ok(top0.name === FIRST.ar && top0.top >= 0 && top0.top < 10, `[${theme}] **تمرير لفوق: أول موعد في السنة (${FIRST.ar})** — ${top0.name}`);
    if (shots && theme === 'dark') await p.screenshot({ path: path.join(shots, `calscroll-past-${theme}.png`) });
    await p.evaluate(() => { const l = document.getElementById('calList'); if (l) l.scrollTop = l.scrollHeight });
    r = await read(p);
    const endRow = r.items.filter(i => i.row).pop() || {};
    ok(endRow.name === LAST.ar && endRow.bottom <= r.h + 1, `[${theme}] **ولتحت: آخر موعد (${LAST.ar})** — ${endRow.name}`);
    ok(r.y === y0, `[${theme}] والصفحة نفسها ما تحرّكت مع تمرير القائمة — ${y0}→${r.y}`);

    /* الإنجليزي */
    if (theme === 'dark') {
      await p.evaluate(() => toggleLang());
      await p.waitForTimeout(100);
      r = await read(p);
      const en = r.items.filter(i => i.row);
      const nI = r.items.findIndex(i => i.now);
      ok(r.items[nI] && /Today/.test(r.items[nI].name) && en.some(i => /15 days ago/.test(i.badge)) && en.some(i => i.badge === 'Yesterday') &&
        /in 6 days/.test((r.items[nI + 1] || {}).badge || ''),
        '**بالإنجليزي: «Today» · «15 days ago» · «Yesterday» · «in 6 days»** — ' + JSON.stringify([(r.items[nI] || {}).name, (r.items[nI + 1] || {}).badge]));
      ok(r.items[nI] && r.items[nI].top >= -2 && r.items[nI].top <= 6, 'وتنفتح على «Today» بعد تبديل اللغة — ' + (r.items[nI] || {}).top);
    }
    ok(p.errs.length === 0, `[${theme}] بلا أخطاء JS: ` + p.errs.slice(0, 2).join(' | '));
    await p.ctx.close();
  }
  await browser.close(); server.close();
  done();
})().catch(e => { ok(false, 'انهار: ' + (e && e.stack || e)); done() });
