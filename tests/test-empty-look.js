/* الجدول الفاضي وقوائم الإعدادات — دراسة الشكل (١٣ نوفمبر ٢٠٢٦)، البندان ٧ · ١١. Chromium على ٣٩٠ بالثيمين:
   ١) جدول فاضي: أزرار «أرقام CRN» · «اطبع» · «امسح الكل» ما تبان (ما لها شي تسويه)، ورقم التعارض «0» بلون
      الأرقام العادي لا بلون التحذير. ومع أول مادة ترجع الأزرار، ومع تعارض يتلوّن الرقم.
   ٢) الإعدادات: اسم الجامعة والتخصص المختار ينقرآن كاملين — كانا بعمودين فينقصّان.

   node tests/test-empty-look.js [مسار pmu-schedule.html] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const done = () => { out.forEach(l => console.log(l)); console.log(`\nالجدول الفاضي والإعدادات: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

const C = (crn, code, title, sec, days, time, ins, room, st) => ({ crn, courseCode: code, courseTitle: title, section: sec,
  courseDate: days, courseTiming: time, instructor: ins, room, status: st || 'CLOSE', gender: 'M' });
const A = C('32011', 'MEEN 3311', 'Thermodynamics I', '101', 'MW', '0800 - 0915', 'Smith, John', 'M-CORE - G034', 'OPEN');
const B = C('32021', 'MATH 2301', 'Calculus III', '101', 'MW', '0830 - 0945', 'Brown, Mark', 'M-CORE - G101');   /* يتعارض مع A */
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

/* حالة رأس «جدولي» كما يشوفها الطالب */
const HEAD = () => {
  const vis = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
  const btn = t => [...document.querySelectorAll('#pageSched button')].find(b => b.textContent.includes(t));
  return { crn: vis(btn('CRN')), print: vis(btn('اطبع')), clear: vis(btn('امسح الكل')),
    clashColor: getComputedStyle(document.getElementById('sumClashes')).color,
    numColor: getComputedStyle(document.getElementById('sumCourses')).color,
    emptyBox: vis(document.getElementById('schedEmpty')) };
};
/* النص المختار في القائمة يدخل في عرضها؟ */
const FIT = id => { const s = document.getElementById(id), cs = getComputedStyle(s);
  const cv = document.createElement('canvas').getContext('2d'); cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = s.options[s.selectedIndex].textContent.trim();
  const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return { text, need: Math.ceil(cv.measureText(text).width), room: Math.floor(room) } };

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
    send({});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 160) }));

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await pg.addInitScript(() => { try { localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"');
      localStorage.setItem('pmu_guestbar_off', String(Date.now())) } catch (e) {} });
    await pg.goto(BASE, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && window.PLANS, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(400);

    /* ── جدول فاضي ── */
    await run(pg, () => switchTab('sched'));
    await pg.waitForTimeout(500);
    let h = await run(pg, HEAD);
    ok(h.emptyBox === true, `[${theme}] الجدول فاضي ورسالته ظاهرة — ${JSON.stringify(h)}`);
    ok(h.crn === false && h.print === false && h.clear === false,
      `[${theme}] **جدول فاضي: «أرقام CRN» و«اطبع» و«امسح الكل» ما تبان** — ${JSON.stringify([h.crn, h.print, h.clear])}`);
    ok(h.clashColor === h.numColor, `[${theme}] **«0 تعارض» بلون الأرقام العادي** لا بلون التحذير — ${h.clashColor} · ${h.numColor}`);
    if (shots) await pg.screenshot({ path: path.join(shots, `empty-sched-${theme}.png`) });

    /* ── مادة وحدة: الأزرار ترجع ── */
    await run(pg, a => { schedule.push(a); renderSchedule() }, A);
    await pg.waitForTimeout(400);
    h = await run(pg, HEAD);
    ok(h.crn === true && h.print === true && h.clear === true && h.emptyBox === false,
      `[${theme}] **ومع أول مادة ترجع الأزرار الثلاثة** — ${JSON.stringify(h)}`);
    ok(h.clashColor === h.numColor, `[${theme}] وبلا تعارض الرقم باقٍ عادي`);

    /* ── تعارض: الرقم يتلوّن ── */
    await run(pg, b => { schedule.push(b); renderSchedule() }, B);
    await pg.waitForTimeout(700);
    h = await run(pg, HEAD);
    const n = await run(pg, () => document.getElementById('sumClashes').dataset.v || document.getElementById('sumClashes').textContent);
    ok(String(n) === '1' && h.clashColor !== h.numColor, `[${theme}] **ومع تعارض الرقم بلون التحذير** — ${n} · ${h.clashColor}`);

    /* ── يفضى ثانية ── */
    await run(pg, () => { schedule.length = 0; renderSchedule() });
    await pg.waitForTimeout(400);
    h = await run(pg, HEAD);
    ok(h.crn === false && h.clear === false && h.clashColor === h.numColor, `[${theme}] ولما يفضى ترجع تختفي والرقم عادي — ${JSON.stringify(h)}`);

    /* ── الإعدادات ── */
    await run(pg, () => switchTab('set'));
    await pg.waitForTimeout(500);
    for (const id of ['uniSelect', 'majorSelect']) {
      const f = await run(pg, FIT, id);
      ok(f && f.need > 40 && f.need <= f.room, `[${theme}] **الإعدادات: «${f && f.text}» ينقرأ كامل** — يحتاج ${f && f.need}px والمتاح ${f && f.room}px`);
    }
    /* كل التخصصات: الاسم العربي (قبل «—») يدخل كامل، واللي يدخل بإنجليزيه كذلك هو الأغلب (٣ من ٢٠ أطول من السطر:
       ذيلها الإنجليزي ينقصّ بنقط) */
    const all = await run(pg, () => { const s = document.getElementById('majorSelect'), cs = getComputedStyle(s);
      const cv = document.createElement('canvas').getContext('2d'); cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = Math.floor(s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      const o = [...s.options].filter(x => x.value).map(x => x.textContent.trim());
      return { n: o.length, room, arOver: o.filter(x => cv.measureText(x.split(' — ')[0]).width > room).length,
        full: o.filter(x => cv.measureText(x).width <= room).length, clip: cs.textOverflow } });
    ok(all && all.n >= 20 && all.arOver === 0 && all.full >= all.n - 3 && all.clip === 'ellipsis',
      `[${theme}] **كل تخصص اسمه العربي يبان كامل، والأطول ينقصّ ذيله بنقط** — ${JSON.stringify(all)}`);
    if (shots) { await run(pg, () => { const c = document.querySelector('.uni-card'); if (c) c.scrollIntoView({ block: 'center' }) });
      await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(shots, `empty-set-${theme}.png`) }) }
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS — ${errs[0] || ''}`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  done();
})().catch(e => { ok(false, 'انهار: ' + (e && e.stack || e)); done() });
