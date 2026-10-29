/* «خطتي» تتحرّك — طلب محمد (٢٧ أكتوبر ٢٠٢٦: «يكون تفاعلي اكثر وما تحسه جامد»)، الفكرة ٩ اللي وافق عليها:
   Chromium على ٣٩٠ بالثيمين، والصفحة نفسها تُضغط وتُقرأ:
   ١) دائرة تقدّم كبيرة بدل الشريط الرفيع: تمتلي لنسبة الساعات، وتبويب مخفي يمتلي أول ما يبان.
   ٢) كل ترم يمتلي مع موادك (طبقة بقدر اللي خلّصته، من بداية السطر) — ويمتلي من نسبته قبل لا من صفر.
   ٣) علّمت مادة: ✓ تنط والسطر ينبض.
   ٤) خلّصت ترماً: «🎉 خلّصت …» وقصاصات من بطاقته — ومرة الخطة كلها «🎓». الإلغاء ما يحتفل.
   ٥) «تقليل الحركة» يطفيها كلها (والرسالة تبقى).
   ٦) زر إخفاء المعدل (👁️) كان فوق «ساعات محسوبة».

   node tests/test-plan-look.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nخطتي: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

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
const DONE = ['PHYS 1421', 'MATH 1422'];      /* مادتان من الترم الأول بس */
const RING_C = 326.73;

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

  /* زائر تخصصه ميكانيكا وخلّص مادتين من الترم الأول — الصفحة تفتح على تبويب غير «خطتي» */
  const open = async ({ theme = 'dark', reduce = false, done = DONE } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(([done, theme]) => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"'); localStorage.setItem('theme', theme);
      localStorage.setItem('pmu_completed', JSON.stringify(done));
      localStorage.setItem('pmu_guestbar_off', String(Date.now()));
    } catch (e) {} }, [done, theme]);
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && window.PLANS_OK === true, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(300);
    return { ctx, pg, errs };
  };
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));
  const tap = (pg, sel) => pg.click(sel, { timeout: 4000 }).then(() => true, () => false);
  const shot = async (pg, name) => { if (shots) await pg.screenshot({ path: path.join(shots, name) }) };
  /* قيم تتغيّر مع الوقت (rAF) — نحكم على الحركة من القيم، لا من لحظة بعينها */
  const sample = (pg, fn, ms) => pg.evaluate(([src, ms]) => new Promise(res => {
    const f = eval('(' + src + ')'), vals = [], t0 = performance.now();
    const step = () => { try { vals.push(f()) } catch (e) { vals.push(null) } if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(vals) };
    requestAnimationFrame(step);
  }), [fn.toString(), ms]).catch(e => ({ err: String(e).slice(0, 160) }));
  const RING = () => { const c = document.getElementById('progRing'); return c ? parseFloat(getComputedStyle(c).strokeDashoffset) : null };
  /* نسبة امتلاء رأس الترم (الطبقة ::before — scaleX) */
  const SEMP = id => { const h = document.querySelector(`#sem-${id} .sem-head`); if (!h) return null;
    const m = /matrix\(([^,]+)/.exec(getComputedStyle(h, '::before').transform); return m ? +(+m[1]).toFixed(3) : null };
  /* كسر (٠–١) يتحرّك من a لـb: أول قراءة لسا قريبة من a، وآخرها b، وبينها قيمة بالطريق */
  const movedF = (vals, a, b) => Array.isArray(vals) && vals.length > 3 && (vals[0] - a) / (b - a) < 0.5
    && Math.abs(vals[vals.length - 1] - b) < 0.01 && vals.some(v => v != null && (v - a) / (b - a) > 0.05 && (v - a) / (b - a) < 0.95);
  const moved = (vals, a, b) => Array.isArray(vals) && vals.length > 3 && Math.abs(vals[0] - a) < 2 && Math.abs(vals[vals.length - 1] - b) < 1
    && vals.some(v => v != null && Math.abs(v - a) > 2 && Math.abs(v - b) > 1);

  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme });
    const P = await run(pg, () => ({ total: TOTAL_CR, cr: doneCredits(), sems: PLAN.map(s => ({ id: s.id, n: s.courses.length, codes: s.courses.map(c => c.c) })),
      name0: t('sem')[PLAN[0].id] || PLAN[0].label }));

    /* ── ١) دائرة التقدّم ── */
    let r = await run(pg, () => ({ ring: !!document.querySelector('.progress-card .prog-ring svg #progRing'),
      pctIn: !!document.querySelector('.prog-ring #progPct'), bar: !!document.querySelector('.progress-card .prog-bar, #progFill'),
      pend: (document.getElementById('progRing') || { dataset: {} }).dataset.cnt || null, off: (() => { const c = document.getElementById('progRing'); return c ? parseFloat(getComputedStyle(c).strokeDashoffset) : null })() }));
    ok(r.ring && r.pctIn && !r.bar, `[${theme}] **دائرة تقدّم بدل الشريط الرفيع** (والنسبة في وسطها) — ${JSON.stringify(r)}`);
    ok(r.pend === 'ring' && Math.abs(r.off - RING_C) < 1, `[${theme}] **والتبويب مخفي: الدائرة تنتظر فاضية** (ترتسم أول ما يبان) — ${JSON.stringify(r)}`);
    const target = RING_C * (1 - P.cr / P.total);
    await run(pg, () => switchTab('plan'));
    let vals = await sample(pg, RING, 1300);
    ok(moved(vals, RING_C, target), `[${theme}] **فتحت «خطتي»: الدائرة تمتلي من فاضية لنسبة ساعاتك** (${P.cr} من ${P.total}) — ${JSON.stringify(Array.isArray(vals) ? [vals[0], vals[Math.floor(vals.length / 2)], vals[vals.length - 1]] : vals)}`);
    r = await run(pg, () => { const c = document.getElementById('progRing'); const s = getComputedStyle(c);
      return { tp: s.transitionProperty, td: s.transitionDuration, f: c.dataset.f, zero: c.classList.contains('zero'), pct: cntVal('progPct') } });
    ok(/stroke-dashoffset/.test(r.tp) && r.td === '0.9s' && Math.abs(r.f - P.cr / P.total) < 1e-9 && !r.zero,
      `[${theme}] والانتقال ٠٫٩ث، والنسبة النهائية في data-f من أول لحظة — ${JSON.stringify(r)}`);
    eq([r.pct, await run(pg, () => document.getElementById('progPct').textContent)], [String(Math.round(P.cr / P.total * 100)), Math.round(P.cr / P.total * 100) + '%'],
      `[${theme}] والرقم في الوسط «${Math.round(P.cr / P.total * 100)}%»`);
    await shot(pg, `plan-ring-${theme}.png`);

    /* ── ٢) كل ترم يمتلي ── */
    const sp = await run(pg, () => [...document.querySelectorAll('#planSemesters .sem-block')].map(b => ({ id: b.id.slice(4),
      p: b.querySelector('.sem-head').style.getPropertyValue('--p'), done: b.classList.contains('done') })));
    const exp = await run(pg, () => PLAN.map(s => { const d = s.courses.filter(c => isDone(c.c)).length; return { id: s.id, p: String(+(d / s.courses.length).toFixed(4)), done: d === s.courses.length } }));
    eq(sp, exp, `[${theme}] **كل ترم نسبته من مواده المنجزة** (الترم الأول ${exp && exp[0] && exp[0].p})`);
    await pg.waitForTimeout(700);
    const s0 = await run(pg, SEMP, P.sems[0].id);
    ok(Math.abs(s0 - (+exp[0].p)) < 0.01, `[${theme}] **ورأس الترم يمتلي بقدرها** (scaleX ${s0}) — طبقة خضراء من بداية السطر`);
    const org = await run(pg, id => { const h = document.querySelector(`#sem-${id} .sem-head`); return { o: getComputedStyle(h, '::before').transformOrigin, w: h.getBoundingClientRect().width } }, P.sems[0].id);
    ok(org && Math.abs(parseFloat(org.o) - org.w) < 2, `[${theme}] **من اليمين (بداية السطر بالعربي)** — ${JSON.stringify(org)}`);
    await shot(pg, `plan-sem-${theme}.png`);

    /* ── ٣) علّمت مادة: ✓ تنط والترم يمتلي من نسبته قبل ── */
    const code = P.sems[0].codes.find(c => !DONE.includes(c));
    const p0 = await run(pg, SEMP, P.sems[0].id), ring0 = await run(pg, RING);
    await run(pg, id => { const b = document.getElementById('sem-' + id); if (!b.classList.contains('open')) b.classList.add('open') }, P.sems[0].id);
    const sel = `#sem-${P.sems[0].id} .pc-check[onclick="toggleDone('${code}')"]`;
    ok(await tap(pg, sel), `[${theme}] زر ✓ للمادة ${code} موجود وينضغط`);
    vals = await sample(pg, `() => (${SEMP.toString()})('${P.sems[0].id}')`, 900);
    const p1 = +(P.sems[0].codes.filter(c => DONE.includes(c) || c === code).length / P.sems[0].n).toFixed(3);
    ok(movedF(vals, p0, p1), `[${theme}] **علّمتها: الترم يمتلي من ${p0} لـ${p1}** (كان يرتسم من جديد بلا حركة) — ${JSON.stringify(Array.isArray(vals) ? [vals[0], vals[vals.length - 1]] : vals)}`);
    r = await run(pg, c => { const b = document.querySelector(`.pc-check[onclick="toggleDone('${c}')"]`), row = b && b.closest('.pc');
      return { row: row && row.className, chk: b && getComputedStyle(b).animationName, ran: row && getComputedStyle(row).animationName, inDone: completed.includes(c) } }, code);
    ok(r.inDone && /\bdone\b/.test(r.row) && /just-done/.test(r.row) && r.chk === 'chkPop' && r.ran === 'pcDone',
      `[${theme}] **و✓ تنط والسطر ينبض أخضر** — ${JSON.stringify(r)}`);
    const ring1 = await run(pg, RING);
    ok(ring1 < ring0 - 0.5, `[${theme}] والدائرة تزيد مع الساعات — ${ring0} ⇒ ${ring1}`);
    await run(pg, () => renderPlan());
    r = await run(pg, () => document.querySelectorAll('.pc.just-done').length);
    eq(r, 0, `[${theme}] **إعادة الرسم (لغة · درجة) ما تعيد النطّة**`);
    await tap(pg, sel);
    r = await run(pg, c => ({ inDone: completed.includes(c), jd: document.querySelectorAll('.pc.just-done').length, toast: document.getElementById('toast').textContent }), code);
    ok(!r.inDone && r.jd === 0 && !/🎉/.test(r.toast), `[${theme}] **وإلغاء العلامة: بلا نطّة ولا احتفال** — ${JSON.stringify(r)}`);

    /* ── ٤) خلّصت ترماً ── */
    await run(pg, () => { document.querySelectorAll('.confetti').forEach(x => x.remove()); document.getElementById('toast').textContent = '' });
    await run(pg, id => markSem(id), P.sems[0].id);
    await pg.waitForTimeout(60);
    r = await run(pg, () => { const c = document.querySelector('body > .confetti'); return { toast: document.getElementById('toast').textContent,
      show: document.getElementById('toast').classList.contains('show'), n: c ? c.children.length : 0, pos: c ? getComputedStyle(c).position : null,
      an: c && c.firstElementChild ? getComputedStyle(c.firstElementChild).animationName : null, jd: document.querySelectorAll('.pc.just-done').length } });
    ok(r.show && r.toast === `🎉 خلّصت ${P.name0}!`, `[${theme}] **خلّصت الترم: «🎉 خلّصت ${P.name0}!»** — ${JSON.stringify(r.toast)}`);
    ok(r.n === 18 && r.pos === 'fixed' && r.an === 'conf', `[${theme}] **وقصاصات ملوّنة من بطاقته** (في body) — ${JSON.stringify(r)}`);
    ok(r.jd === P.sems[0].n - DONE.length, `[${theme}] و«✓✓» تنط على اللي انعلّمت الحين بس (${P.sems[0].n - DONE.length}) — ${r.jd}`);
    await pg.waitForTimeout(1500);
    r = await run(pg, () => document.querySelectorAll('.confetti').length);
    eq(r, 0, `[${theme}] والقصاصات تنشال بعد ثانية ونص`);
    await shot(pg, `plan-sem-done-${theme}.png`);
    r = await run(pg, id => document.getElementById('sem-' + id).classList.contains('done'), P.sems[0].id);
    eq(r, true, `[${theme}] والترم المكتمل عليه «done»`);
    /* آخر مادة بالضغط على ✓ تحتفل كذلك */
    await tap(pg, sel); await run(pg, () => { document.querySelectorAll('.confetti').forEach(x => x.remove()); document.getElementById('toast').textContent = '' });
    await tap(pg, sel);
    r = await run(pg, () => ({ toast: document.getElementById('toast').textContent, n: document.querySelectorAll('body > .confetti').length }));
    ok(r.toast === `🎉 خلّصت ${P.name0}!` && r.n === 1, `[${theme}] **وآخر مادة بـ✓ تحتفل كذلك** — ${JSON.stringify(r)}`);
    await run(pg, () => { document.querySelectorAll('.confetti').forEach(x => x.remove()); document.getElementById('toast').textContent = '' });
    await run(pg, id => markSem(id), P.sems[0].id);
    r = await run(pg, () => ({ toast: document.getElementById('toast').textContent, n: document.querySelectorAll('.confetti').length }));
    ok(!/🎉|🎓/.test(r.toast) && r.n === 0, `[${theme}] **«✓✕» (تلغي الترم): بلا احتفال** — ${JSON.stringify(r)}`);
    /* الخطة كلها */
    await run(pg, () => { PLAN.forEach(s => { if (!s.courses.every(c => isDone(c.c))) markSem(s.id) }) });
    r = await run(pg, () => document.getElementById('toast').textContent);
    eq(r, '🎓 خلّصت خطتك كلها — مبروك!', `[${theme}] **وآخر ترم في الخطة: «🎓 خلّصت خطتك كلها»**`);

    /* ── ٦) زر إخفاء المعدل ما يغطي «ساعات محسوبة» ── */
    for (const lang of ['ar', 'en']) {
      if (lang === 'en') await run(pg, () => toggleLang());
      await pg.waitForTimeout(100);
      const g = await run(pg, () => { const e = document.getElementById('gpaEye').getBoundingClientRect(), l = document.querySelector('.gpa-right .gpa-label').getBoundingClientRect();
        const r = document.createRange(); r.selectNodeContents(document.querySelector('.gpa-right .gpa-label')); const tx = r.getBoundingClientRect();
        return { hit: !(e.right <= tx.left || tx.right <= e.left || e.bottom <= tx.top || tx.bottom <= e.top), e: [Math.round(e.left), Math.round(e.right)], tx: [Math.round(tx.left), Math.round(tx.right)] } });
      ok(g && g.hit === false, `[${theme}·${lang}] **زر 👁️ ما يغطي «ساعات محسوبة»** (كان فوقها) — ${JSON.stringify(g)}`);
    }
    const org2 = await run(pg, id => { const h = document.querySelector(`#sem-${id} .sem-head`); return parseFloat(getComputedStyle(h, '::before').transformOrigin) }, P.sems[1].id);
    ok(Math.abs(org2) < 1, `[${theme}] وبالإنجليزي الترم يمتلي من اليسار — ${org2}`);
    await run(pg, () => toggleLang());

    const over = await run(pg, () => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${over}`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ما خلّص شي: الدائرة فاضية بلا نقطة ── */
  {
    const { ctx, pg, errs } = await open({ done: [] });
    await run(pg, () => switchTab('plan'));
    await pg.waitForTimeout(300);
    const r = await run(pg, () => { const c = document.getElementById('progRing'); return { zero: c.classList.contains('zero'), op: getComputedStyle(c).opacity, pct: document.getElementById('progPct').textContent } });
    eq(r, { zero: true, op: '0', pct: '0%' }, '**صفر ساعات: الحلقة مخفية** (الطرف المدوّر كان بيطلع نقطة)');
    ok(errs.length === 0, '(صفر) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── ٥) «تقليل الحركة» ── */
  {
    const { ctx, pg, errs } = await open({ reduce: true });
    const P = await run(pg, () => ({ total: TOTAL_CR, cr: doneCredits(), id: PLAN[0].id, name0: t('sem')[PLAN[0].id] || PLAN[0].label }));
    await run(pg, () => switchTab('plan'));
    const r0 = await run(pg, () => { const c = document.getElementById('progRing'); const s = getComputedStyle(c); return { off: parseFloat(s.strokeDashoffset), td: s.transitionDuration } });
    ok(Math.abs(r0.off - RING_C * (1 - P.cr / P.total)) < 1 && /^0s/.test(r0.td), `**«تقليل الحركة»: الدائرة بنسبتها على طول بلا انتقال** — ${JSON.stringify(r0)}`);
    await run(pg, id => markSem(id), P.id);
    await pg.waitForTimeout(60);
    const r = await run(pg, id => ({ toast: document.getElementById('toast').textContent, conf: document.querySelectorAll('.confetti').length,
      an: (() => { const x = document.querySelector('.pc.just-done .pc-check'); return x ? getComputedStyle(x).animationName : 'x' })(),
      sem: getComputedStyle(document.querySelector(`#sem-${id} .sem-head`), '::before').transitionDuration }), P.id);
    eq(r, { toast: `🎉 خلّصت ${P.name0}!`, conf: 0, an: 'none', sem: '0s' }, '**والاحتفال رسالة بلا قصاصات، و✓ بلا نطّة، والترم بلا انتقال**');
    ok(errs.length === 0, '(تقليل الحركة) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  done();
})().catch(e => { fail++; out.push('  ✗ انهار: ' + (e && e.stack || e)); done() });
