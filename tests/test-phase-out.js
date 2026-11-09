/* مواد تنتهي من الخطة القديمة — اختبار (إعلان التسجيل، ٩ نوفمبر ٢٠٢٦).
   «Phase-Out of ALIS Courses Under the Old Degree Plan» (Registrar Office — صوّره محمد):
     ALIS 1211 · ALIS 1212 — آخر طرح ربيع 2026/2027 (202720)
     ALIS 2211 · ALIS 2212 — آخر طرح خريف 2027/2028 (202810)
   وبعده ما تُطرح أبداً، والإعلان يقول «سجّلها قبلها، وراجع مرشدك».

   كان الموقع ما يعرف عنها شي: جدول الطرح للميكانيكال والكيميكال وحدهما، فطالب حاسب أو إدارة يشوف
   ALIS 1212 «عادية» في مقترح الربيع وهو آخر طرح لها؛ والمادة اللي انتهى طرحها تنقال «ترجع» أو تُقترح؛
   وتوقّع التخرج يدور ٣٠ ترماً فاضياً ويقول «ما قدرنا نكمل».

   node tests/test-phase-out.js [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ROOT = path.dirname(PAGE);
const SHARED = path.join(ROOT, 'shared', 'plans.js');
const PORT = 20600 + (process.pid % 100);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

/* ═══ ١. البيانات والمنطق (shared/plans.js) ═══ */
let L = null;
try { L = require(SHARED) } catch (e) { console.log('  ✗ تعذّر require: ' + e.message) }
ok(!!L, 'shared/plans.js يُقرأ');
if (!L) done();

const ALIS = ['ALIS 1211', 'ALIS 1212', 'ALIS 2211', 'ALIS 2212'];
eq(L.LAST_OFFER, { 'ALIS 1211': '202720', 'ALIS 1212': '202720', 'ALIS 2211': '202810', 'ALIS 2212': '202810' },
   '**آخر طرح لكل مادة كما في الإعلان**');

/* الإعلان «للخطة القديمة»: الخطتان الجديدتان (الميكانيكال والكيميكال) بلا ALIS — وباقي الخطط فيها */
{
  const has = k => L.PLANS[k].sems.some(s => s.courses.some(c => ALIS.includes(c.c)));
  eq(Object.keys(L.PLANS).filter(k => !has(k)).sort(), ['CHEN', 'MEEN'],
     'الخطط الوحيدة بلا ALIS: الجديدتان — فالقاعدة تمسك الخطط القديمة وحدها');
}

const g = a => Object.fromEntries(a.map(c => [c, 'A']));
const C = o => L.ctxOf(Object.assign({ major: 'COSC', planVer: 'new', prep: false, completed: [], grades: {},
  term: '202720' }, o));
const W = (o, c) => L.offerWarn(C(o), c);

/* أنواع التحذير بترم التخطيط */
{
  eq(W({ term: '202710' }, 'ALIS 1211'), { kind: 'ends', last: '202720' }, 'خريف 2026/2027: ALIS 1211 تُطرح لين الربيع');
  eq(W({}, 'ALIS 1211'), { kind: 'last', n: 0, next: null, end: true, last: '202720' },
     '**ربيع 2026/2027: آخر طرح لـALIS 1211 — بلا رجعة (next فاضي)**');
  eq(W({}, 'ALIS 2211'), { kind: 'ends', last: '202810' }, 'وALIS 2211 تُطرح لين خريف 2027/2028');
  eq(W({ term: '202730' }, 'ALIS 1212'), { kind: 'gone', last: '202720', next: null }, 'الصيف بعد آخر طرح: انتهت');
  eq(W({ term: '202810' }, 'ALIS 2212'), { kind: 'last', n: 0, next: null, end: true, last: '202810' },
     'خريف 2027/2028: آخر طرح لـALIS 2212');
  eq(W({ term: '202820' }, 'ALIS 2211'), { kind: 'gone', last: '202810', next: null }, 'وبعده انتهت');
  eq(W({ completed: ['ALIS 1211'], grades: g(['ALIS 1211']) }, 'ALIS 1211'), null, 'الناجح فيها بلا تحذير');
  ok(W({ completed: ['ALIS 1211'], grades: { 'ALIS 1211': 'F' } }, 'ALIS 1211') !== null, 'والراسب فيها يهمّه');
  eq(L.offerWarn(Object.assign(C({}), { term: '' }), 'ALIS 1211'), null, 'سياق بلا ترم: بلا تحذير (ما نخمّن)');
  eq(W({}, 'GEIT 1411'), null, 'مادة حاسب عادية: ولا شي تغيّر');
  eq(L.offerWarn(C({ major: 'BUSI' }), 'ALIS 1212'), { kind: 'last', n: 0, next: null, end: true, last: '202720' },
     'لكل التخصصات — لا الميكانيكال والكيميكال وحدهما');
  eq([L.notOfferedIn('202720', 'ALIS 1211'), L.notOfferedIn('202810', 'ALIS 1211'), L.nextOffered(C({}), 'ALIS 1211')],
     [false, true, null], 'ما تُطرح بعد آخر ترم، وما ترجع أبداً (nextOffered فاضي)');
}

/* المقترح (offeredOnly — مقترح «خطتي» والمحاكاة) */
{
  const S = o => L.suggestNext(Object.assign(C(o), { offeredOnly: true }));
  const s1 = S({ completed: ['ALIS 1211'], grades: g(['ALIS 1211']) });
  eq(s1.crit[0] && [s1.crit[0].c, s1.crit[0].lastChance], ['ALIS 1212', 1],
     '**الربيع: ALIS 1212 أول المقترح — آخر طرح لها**');
  const s2 = S({ term: '202810' });
  eq(s2.gone, ['ALIS 1211', 'ALIS 1212'], '**خريف 2027/2028: اللي انتهى طرحها لحالها (gone)**');
  ok(!(s2.notOffered || []).some(c => ALIS.includes(c)), 'لا في «ما تُطرح هالترم — ترجع …»');
  ok(!s2.crit.concat(s2.opt).some(c => ALIS.includes(c.c)), 'ولا في المقترح');
  const s3 = L.suggestNext(C({ term: '202810' }));
  ok(s3.crit.concat(s3.opt).some(c => c.c === 'ALIS 1211') && (s3.gone || []).length === 0,
     'وsuggestNext الافتراضي (بلا offeredOnly) ما تغيّر');
  const s4 = L.suggestNext(Object.assign(L.ctxOf({ major: 'MEEN', planVer: 'old', term: '202810' }), { offeredOnly: true }));
  ok((s4.gone || []).includes('ALIS 1211') && !s4.notOffered.includes('ALIS 1211'),
     'والميكانيكال القديمة (لها جدول طرح) كذلك: انتهت لا «ما تُطرح هالترم»');
}

/* توقّع التخرج */
{
  const two = C({ term: '202810', completed: ['ALIS 1211', 'ALIS 1212'], grades: g(['ALIS 1211', 'ALIS 1212']) });
  const gp = L.gradPlan(two, {});
  const first = gp.terms[0] || { courses: [] };
  ok(first.term === '202810' && first.courses.some(c => c.code === 'ALIS 2211' && c.lastChance),
     'خريف 2027/2028: ALIS 2211 في أول ترم — آخر طرح لها');
  eq((gp.phasedOut || []).map(x => x.code), ['ALIS 2212'],
     '**ALIS 2212 متطلبها ALIS 2211 بنفس الترم الأخير: ما يلحق عليها — تُذكر phasedOut**');
  ok(!gp.stuck && !gp.truncated, 'والحساب ما يقف ولا يدور ٣٠ ترماً');
  eq(gp.remaining, ['ALIS 2212'], 'والباقي هي وحدها');
  const three = C({ completed: ['ALIS 1211', 'ALIS 1212', 'ALIS 2211'], grades: g(['ALIS 1211', 'ALIS 1212', 'ALIS 2211']) });
  const g3 = L.gradPlan(three, {});
  const at = g3.terms.findIndex(t => t.courses.some(c => c.code === 'ALIS 2212'));
  ok(at >= 0 && Number(g3.terms[at].term) <= 202810, 'من خلّص الثلاث: ALIS 2212 تنحط قبل آخر طرح لها');
  eq(g3.phasedOut, [], 'وما فيه شي انتهى عليه');
  eq(L.gradPlan(L.ctxOf({ major: 'MEEN', planVer: 'new', term: '202720' }), {}).phasedOut, [],
     'والخطة الجديدة بلا ALIS: ولا شي');
}

/* ═══ ٢. الصفحة في متصفح حقيقي ═══ */
let chromium = null;
try { ({ chromium } = require('playwright')) } catch (e) {}
ok(!!chromium, 'playwright متوفر');
if (!chromium) done();

const pageHtml = fs.readFileSync(PAGE, 'utf8');
const plansJs = fs.readFileSync(SHARED);
let NEXT = '202720';                 /* ترم التسجيل الجاي اللي يرجّعه السيرفر (planTermCode) */
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('window.ACAD_CAL=[];') }
  if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  if (u.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(u === '/api/monitor-status'
      ? { term: '202710', nextRegTerm: NEXT, canWatch: false, build: '"x"' }
      : { success: true, courses: [], cached: false, age: 0 }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pageHtml);
});
const STUB = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),'
  + 'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>{const o={select(){return o},'
  + 'eq(){return o},order(){return o},limit(){return o},then(f){return Promise.resolve({data:[],error:null}).then(f)}};'
  + 'return o}})};';

(async () => {
  await new Promise((r, j) => { server.once('error', j); server.listen(PORT, '127.0.0.1', r) });
  const browser = await chromium.launch();
  const ERRS = [];
  const open = async (local, opt) => {
    const scheme = (opt && opt.scheme) || 'dark';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => ERRS.push(String(e).slice(0, 160)));
    await pg.addInitScript(v => {
      try { for (const k in v) localStorage.setItem(k, JSON.stringify(v[k])) } catch (e) {}
    }, Object.assign({ pmu_seen_guide: true, pmu_seen_welcome: true, pmu_theme: scheme }, local));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.switchTab === 'function' && window.PLANS_OK === true,
      null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(700);
    await pg.evaluate(() => switchTab('plan'));
    await pg.waitForTimeout(700);
    return { pg, ctx };
  };
  const read = pg => pg.evaluate(() => {
    const T = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    const sugRows = [...document.querySelectorAll('#sugList .sug-item')].map(T);
    const offs = {};
    document.querySelectorAll('#planSemesters .pc-off').forEach(e => {
      /* المادة صاحبة السطر: بطاقتها (.pc) وكودها (.pc-code) */
      const card = e.closest('.pc'), code = card && card.querySelector('.pc-code');
      const m = code ? /([A-Z]{4} \d{4})/.exec(code.textContent) : null;
      if (m) offs[m[1]] = e.className.replace('pc-off', '').trim() + '|' + T(e);
    });
    /* innerText: سطور الإعلان كتل — textContent يلصقها ببعض */
    const N = document.querySelector('#sugList .sug-note.phase');
    return { note: N ? N.innerText.replace(/\s+/g, ' ').trim() : '', sugRows, offs };
  });

  /* ── أ) ربيع 2026/2027: خلّص ALIS 1211 وباقي الثلاث ── */
  {
    NEXT = '202720';
    const { pg, ctx } = await open({ pmu_major: 'COSC', pmu_completed: ['ALIS 1211'], pmu_grades: { 'ALIS 1211': 'A' } });
    const r = await read(pg);
    const row = r.sugRows.find(x => x.includes('ALIS 1212')) || '';
    ok(/آخر طرح لها/.test(row), '**مقترح الربيع: ALIS 1212 بشارة «آخر طرح لها»** — ' + row.slice(0, 80));
    ok(r.sugRows.findIndex(x => x.includes('ALIS 1212')) === 0, 'وأول المقترح');
    ok(/الجامعة أعلنت: مواد ALIS تنتهي من الخطة القديمة/.test(r.note), 'سطر الإعلان في المقترح — ' + r.note.slice(0, 60));
    ok(/آخر طرح ربيع 2026\/2027: ALIS 1212/.test(r.note), '«آخر طرح ربيع 2026/2027: ALIS 1212» — ' + r.note.slice(0, 160));
    ok(/آخر طرح خريف 2027\/2028: ALIS 2211 · ALIS 2212/.test(r.note), '«آخر طرح خريف 2027/2028: ALIS 2211 · ALIS 2212»');
    ok(!/ALIS 1211/.test(r.note), 'وALIS 1211 (ناجح فيها) ما تنذكر');
    ok(/راجع مرشدك/.test(r.note), 'و«راجع مرشدك» مثل الإعلان');
    ok(/^last\|⚠️ آخر فرصة: ربيع 2026\/2027 — آخر طرح لها، وبعده ما تنطرح أبداً/.test(r.offs['ALIS 1212'] || ''),
       'بطاقة ALIS 1212: «آخر فرصة … وبعده ما تنطرح أبداً» — ' + (r.offs['ALIS 1212'] || ''));
    ok(/^ends\|⏳ آخر طرح لها خريف 2027\/2028/.test(r.offs['ALIS 2211'] || ''),
       'بطاقة ALIS 2211: «آخر طرح لها خريف 2027/2028» — ' + (r.offs['ALIS 2211'] || ''));
    ok(!r.offs['ALIS 1211'], 'وبطاقة ALIS 1211 (ناجح فيها) بلا سطر');
    await ctx.close();
  }

  /* ── ب) خريف 2027/2028: ما خلّص شي منها ── */
  {
    NEXT = '202810';
    const { pg, ctx } = await open({ pmu_major: 'COSC' });
    const r = await read(pg);
    ok(/انتهى طرحها: ALIS 1211 · ALIS 1212/.test(r.note), '**«انتهى طرحها: ALIS 1211 · ALIS 1212»** — ' + r.note.slice(0, 200));
    ok(/^gone\|⛔ انتهى طرحها — آخر طرح كان ربيع 2026\/2027\. راجع مرشدك/.test(r.offs['ALIS 1211'] || ''),
       'بطاقة ALIS 1211: «انتهى طرحها … راجع مرشدك» — ' + (r.offs['ALIS 1211'] || ''));
    ok(!r.sugRows.some(x => /ALIS 121/.test(x)), 'وما تنقترح');
    ok(!/ترجع/.test(await pg.evaluate(() => (document.querySelector('#sugList .sug-note.off') || {}).textContent || '')),
       'ولا «ترجع …» عنها');
    await ctx.close();
  }

  /* ── ج) خلّص الأربع · والخطة الجديدة: ولا سطر ── */
  {
    NEXT = '202720';
    const { pg, ctx } = await open({ pmu_major: 'COSC', pmu_completed: ALIS, pmu_grades: g(ALIS) });
    const r = await read(pg);
    eq([r.note, Object.keys(r.offs).filter(k => ALIS.includes(k))], ['', []], 'خلّص الأربع: بلا إعلان ولا سطور');
    await ctx.close();
    const m = await open({ pmu_major: 'MEEN' });
    eq((await read(m.pg)).note, '', 'الميكانيكال (الخطة الجديدة): بلا إعلان');
    await m.ctx.close();
  }

  /* ── د) الإنجليزي والجوال بالثيمين ── */
  for (const scheme of ['dark', 'light']) {
    NEXT = '202720';
    const { pg, ctx } = await open({ pmu_major: 'COSC', pmu_completed: ['ALIS 1211'], pmu_grades: { 'ALIS 1211': 'A' } }, { scheme });
    const fit = await pg.evaluate(() => {
      const n = document.querySelector('#sugList .sug-note.phase');
      if (!n) return { ok: false };
      const r = n.getBoundingClientRect();
      return { ok: r.right <= innerWidth + 1 && r.left >= -1, pageW: document.documentElement.scrollWidth, vw: innerWidth };
    });
    ok(fit.ok && fit.pageW <= fit.vw, `${scheme}: الإعلان داخل الشاشة على ٣٩٠ وبلا تمرير أفقي`);
    await pg.evaluate(() => toggleLang());
    await pg.waitForTimeout(300);
    const en = await read(pg);
    ok(/phasing ALIS courses out of the old plan/.test(en.note) && /Last offered Spring 2026\/2027: ALIS 1212/.test(en.note),
       `${scheme}: بالإنجليزي — ` + en.note.slice(0, 120));
    await ctx.close();
  }

  eq(ERRS, [], 'بلا أخطاء JS في الصفحة');
  await browser.close();
  server.close();
  done();
})().catch(e => {
  console.log('  ✗ انهار: ' + (e && e.message || e));
  fail++;
  done();
});
