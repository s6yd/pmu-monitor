/* إعلان فوق الموقع — الصفحة واللوحة في Chromium على ٣٩٠ (طلب محمد ٢٠ نوفمبر ٢٠٢٦: «ودي نحط اعلان صغير فوق في موقعنا عن
   انه المشكلة مو من عندنا» — صيانة بانر عند الجامعة وقّفت موقع جدولهم).
   الصفحة (بالثيمين):
   ١) الإعلان من حالة الموقع يطلع سطراً فوق الشريط العلوي (ما يغطيه)، نصّه **مهرّب** (من الإدارة)، وبلا تمرير أفقي.
   ٢) ✕ يقفله لهالإعلان بس: يبقى مقفول بعد التحميل، وإعلان جديد (رقم ثاني) يطلع.
   ٣) الإنجليزي: نصّه، وبلاه العربي.   ٤) ينشال لحاله في وقته والصفحة مفتوحة.   ٥) ما يطلع في الطباعة.
   ٦) البحث وموقع الجامعة واقف (reason من السيرفر): «موقع جدول الجامعة ما يرد» و«المشكلة من الجامعة» — لا «خطأ في الاتصال»
      و«PMU token timeout».
   اللوحة («النظام»):
   ٧) البطاقة تقول إنه طالع ولين متى، ونصّه، و«شيله».   ٨) النشر يرسل النص والوقت (ISO من وقت الجوال)، وبلا نص ما يرسل.
   ٩) اللي تكتبه يبقى مع إعادة الرسم، والتحديث التلقائي ما يمسحه وأنت تكتب.
   SHOT_DIR للصور.   node tests/test-notice-page.js [pmu-schedule.html] [admin.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');
const ADMIN = process.argv[3] || path.join(path.dirname(PAGE), 'admin.html');
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const wait = ms => new Promise(r => setTimeout(r, ms));
/* ضغطة وكتابة بمهلة قصيرة — عنصر ناقص فشل يُحسب، لا انهيار */
const click = (pg, sel) => pg.click(sel, { timeout: 3000 }).then(() => true, () => false);
const fill = (pg, sel, v) => pg.fill(sel, v, { timeout: 3000 }).then(() => true, () => false);
const refresh = pg => pg.evaluate(async () => { MON_STATE = await (await fetch('/api/monitor-status')).json();
  if (typeof renderNotice === 'function') renderNotice() });

const AR = '⚠️ أنظمة الجامعة (بانر وموقع جدول المواد) متوقفة للصيانة لين الأربعاء 25 نوفمبر الساعة 8 الصبح — المشكلة من الجامعة <b>مو منّا</b>.';
const EN = 'University systems are down for maintenance until Wed 25 Nov, 8 AM.';
const ST = { notice: null, courses: 'down' };
const status = () => ({ active: false, reason: 'offseason', env: 'prod', freeBeta: true, term: '202710', regTerm: '202710',
  nextRegTerm: '202720', canWatch: false, window: null, build: '"x"', notice: ST.notice,
  plans: { termHalalas: 1900, pushoverHalalas: 1500, freeMonitors: 2, freeSchedules: 1 } });
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
  if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(SHARED)) }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  res.setHeader('Content-Type', 'application/json');
  if (u === '/api/monitor-status') { res.writeHead(200); return res.end(JSON.stringify(status())) }
  if (u === '/api/courses') {
    if (ST.courses === 'down') { res.writeHead(500); return res.end(JSON.stringify({ success: false, reason: 'pmu-down',
      error: 'موقع جدول الجامعة ما يرد الحين — المشكلة من الجامعة مو من جدولك. جرّب بعد شوي.' })) }
    res.writeHead(500); return res.end(JSON.stringify({ success: false }));
  }
  res.writeHead(200); res.end('{}');
});

const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

async function openPage(browser, theme, ctx) {
  ctx = ctx || await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('pmu_seen_guide', 'true') } catch (e) {} }, theme);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.doSearch === 'function' && window.MON_STATE !== undefined, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !!MON_STATE, null, { timeout: 5000 }).catch(() => {});
  await wait(200);
  return { page, errs, ctx };
}
const bar = page => page.evaluate(() => {
  const b = document.getElementById('noticeBar'), tb = document.querySelector('.topbar');
  if (!b) return { missing: true, shown: false, text: '', bold: false, below: -1, xHit: false, xw: 0, xh: 0, over: 0 };
  const r = b.getBoundingClientRect(), t = tb.getBoundingClientRect(), x = b.querySelector('.nb-x');
  const xr = x && x.getBoundingClientRect();
  const hit = xr ? document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2) : null;
  return { shown: !b.hidden && r.height > 0, text: (b.querySelector('.nb-t') || {}).textContent || '',
    bold: !!b.querySelector('.nb-t b'), h: Math.round(r.height), below: Math.round(t.top - r.bottom),
    xHit: !!(x && hit && (hit === x || x.contains(hit))), xw: xr ? Math.round(xr.width) : 0, xh: xr ? Math.round(xr.height) : 0,
    over: document.documentElement.scrollWidth - innerWidth };
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const until = () => new Date(Date.now() + 3 * 864e5).toISOString();

  for (const theme of ['dark', 'light']) {
    /* ١ */
    ST.notice = { ar: AR, en: EN, until: until(), v: 1001 };
    let { page, errs, ctx } = await openPage(browser, theme);
    let b = await bar(page);
    ok(b.shown && b.text === AR, `[${theme}] **الإعلان من حالة الموقع يطلع فوق** — ${JSON.stringify(b)}`);
    ok(!b.bold && b.text.includes('<b>'), `[${theme}] نصّه مهرّب (من الإدارة — الوسوم نص لا HTML)`);
    ok(b.below >= 0, `[${theme}] فوق الشريط العلوي وما يغطيه — ${b.below}`);
    ok(b.over <= 1, `[${theme}] بلا تمرير أفقي على ٣٩٠ — ${b.over}`);
    ok(b.xHit && b.xw >= 30 && b.xh >= 30, `[${theme}] ✕ ينضغط (${b.xw}×${b.xh})`);
    if (shots) await page.screenshot({ path: path.join(shots, `notice-${theme}.png`) });
    /* ٣ */
    await page.evaluate(() => toggleLang());
    b = await bar(page);
    ok(b.shown && b.text === EN, `[${theme}] الإنجليزي: نصّه — ${b.text}`);
    if (shots && theme === 'dark') await page.screenshot({ path: path.join(shots, `notice-en-${theme}.png`) });
    ST.notice = { ar: AR, en: '', until: until(), v: 1001 };
    await refresh(page);
    b = await bar(page);
    ok(b.shown && b.text === AR, `[${theme}] وبلا إنجليزي: العربي — ${b.text.slice(0, 30)}`);
    await page.evaluate(() => toggleLang());
    /* ٥ */
    await page.emulateMedia({ media: 'print' });
    const pr = await page.evaluate(() => { const b = document.getElementById('noticeBar'); return b ? getComputedStyle(b).display : 'missing' });
    ok(pr === 'none', `[${theme}] ما يطلع في الطباعة — ${pr}`);
    await page.emulateMedia({ media: 'screen' });
    /* ٢ */
    await click(page, '#noticeBar .nb-x');
    b = await bar(page);
    ok(!b.shown, `[${theme}] **✕ يقفله**`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!MON_STATE, null, { timeout: 5000 }).catch(() => {});
    await wait(200);
    b = await bar(page);
    ok(!b.shown, `[${theme}] ويبقى مقفول بعد التحميل (لهالإعلان)`);
    ST.notice = { ar: 'إعلان ثاني', en: '', until: until(), v: 2002 };
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!MON_STATE, null, { timeout: 5000 }).catch(() => {});
    await wait(200);
    b = await bar(page);
    ok(b.shown && b.text === 'إعلان ثاني', `[${theme}] **وإعلان جديد يطلع** — ${JSON.stringify(b.text)}`);
    /* ٤ */
    ST.notice = { ar: 'ينتهي بعد شوي', en: '', until: new Date(Date.now() + 1500).toISOString(), v: 3003 };
    await refresh(page);
    const b1 = await bar(page);
    await wait(2600);
    const b2 = await bar(page);
    ok(b1.shown && !b2.shown, `[${theme}] **ينشال لحاله في وقته والصفحة مفتوحة** — ${b1.shown}→${b2.shown}`);
    ST.notice = null;
    await refresh(page);
    ok(!(await bar(page)).shown, `[${theme}] بلا إعلان: ما فيه شريط`);

    /* ٦ */
    ST.courses = 'down';
    const box = () => page.evaluate(async () => { try { switchTab('search') } catch (e) {} await doSearch();
      const b = document.getElementById('initialBox');
      return { icon: b.querySelector('.state-icon').textContent, t: b.querySelector('.state-title').textContent,
        s: b.querySelector('.state-sub').textContent } });
    let e = await box();
    ok(e.t === 'موقع جدول الجامعة ما يرد' && /المشكلة من الجامعة/.test(e.s) && !/PMU/.test(e.s) && e.icon === '🏛️',
      `[${theme}] **البحث وموقع الجامعة واقف: «موقع جدول الجامعة ما يرد» و«المشكلة من الجامعة»** — ${JSON.stringify(e)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `search-down-${theme}.png`) });
    await page.evaluate(() => toggleLang());
    e = await box();
    ok(e.t === 'University schedule site is down' && /university side/.test(e.s), `[${theme}] وبالإنجليزي — ${JSON.stringify(e)}`);
    await page.evaluate(() => toggleLang());
    ST.courses = 'other';
    e = await box();
    ok(e.t === 'خطأ في الاتصال', `[${theme}] وخطأ ثاني بلا سبب: «خطأ في الاتصال» كما كان — ${e.t}`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ═══ اللوحة ═══ */
  const A = { health: 0, posts: [], live: true };
  const NOW = Date.now();
  const adm = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/admin.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(ADMIN)) }
    let body = ''; req.setEncoding('utf8'); req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.endsWith('/health')) { A.health++;
        return res.end(JSON.stringify({ env: 'prod', telegramOk: true, warnings: [], cache: [], uptimeHours: 1, cycles: [], lastCycle: {},
          siteNotice: { ar: 'إعلان <i>شغّال</i>', en: '', until: new Date(NOW + 2 * 864e5).toISOString(), v: 5 },
          siteNoticeLive: A.live })) }
      if (u.endsWith('/site-notice')) { A.posts.push(JSON.parse(body || '{}')); return res.end(JSON.stringify({ live: true })) }
      if (u.endsWith('/monitors')) return res.end(JSON.stringify({ monitors: [] }));
      if (u.endsWith('/users')) return res.end(JSON.stringify({ users: [] }));
      if (u.endsWith('/reviews')) return res.end(JSON.stringify({ reviews: [] }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise(r => adm.listen(0, r));
  const ap = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const aerrs = [];
  ap.on('pageerror', e => aerrs.push(String(e)));
  ap.on('dialog', d => d.accept());
  await ap.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ap.goto(`http://127.0.0.1:${adm.address().port}/`, { waitUntil: 'load' });
  await ap.evaluate(() => { sessionStorage.setItem('jdw_admin', 'x'.repeat(16)) });
  await ap.reload({ waitUntil: 'load' });
  await ap.waitForFunction(() => typeof window.renderSys === 'function' && !!HEALTH, null, { timeout: 15000 }).catch(() => {});
  const card = () => ap.evaluate(() => { go('sys'); renderSys(); const c = document.getElementById('ntCard');
    return c ? { text: c.innerText, italic: !!c.querySelector('.maint-msg i'), off: !!c.querySelector('button[onclick="noticeOff()"]') } : null });
  let cd = await card();
  ok(cd && /الإعلان طالع فوق الموقع/.test(cd.text) && /لين/.test(cd.text) && cd.text.includes('إعلان <i>شغّال</i>') && !cd.italic && cd.off,
    '**اللوحة: البطاقة تقول إنه طالع ولين متى، ونصّه (مهرّب)، و«شيله»** — ' + (cd && cd.text.slice(0, 140)));
  if (shots && cd) { await ap.evaluate(() => document.getElementById('ntCard').scrollIntoView()); await ap.screenshot({ path: path.join(shots, 'notice-admin.png') }) }
  /* ٨ */
  await fill(ap, '#ntAr', '');
  await click(ap, '#ntCard .nt-form button');
  await wait(200);
  ok(A.posts.length === 0, 'بلا نص: ما يرسل شي');
  await fill(ap, '#ntAr', 'أنظمة الجامعة متوقفة');
  await fill(ap, '#ntEn', 'University systems are down');
  await fill(ap, '#ntUntil', '2026-11-25T08:00');
  const iso = await ap.evaluate(() => new Date('2026-11-25T08:00').toISOString());
  await click(ap, '#ntCard .nt-form button');
  await wait(400);
  const p = A.posts[A.posts.length - 1] || {};
  ok(p.ar === 'أنظمة الجامعة متوقفة' && p.en === 'University systems are down' && p.until === iso,
    '**«انشر» يرسل النص والوقت (ISO من وقت الجوال)** — ' + JSON.stringify(p));
  /* ٧ — شيله */
  await ap.evaluate(() => { go('sys'); renderSys() });
  await click(ap, '#ntCard button[onclick="noticeOff()"]');
  await wait(300);
  ok(JSON.stringify(A.posts[A.posts.length - 1]) === '{"on":false}', '«شيله» يرسل on:false — ' + JSON.stringify(A.posts[A.posts.length - 1]));
  /* ٩ */
  await fill(ap, '#ntAr', 'مسودّة ما انتشرت');
  const kept = await ap.evaluate(() => { document.activeElement && document.activeElement.blur(); renderSys();
    const e = document.getElementById('ntAr'); return e ? e.value : null });
  ok(kept === 'مسودّة ما انتشرت', '**اللي تكتبه يبقى مع إعادة الرسم** — ' + kept);
  const n0 = A.health;
  await ap.evaluate(() => { AUTO = true; const e = document.getElementById('ntAr') || document.querySelector('#sysBody input');
    if (e) e.focus(); autoTick() });
  await wait(400);
  const n1 = A.health;
  await ap.evaluate(() => { document.activeElement.blur(); autoTick() });
  await wait(600);
  const n2 = A.health;
  await ap.evaluate(() => { AUTO = false });
  ok(n1 === n0 && n2 > n1, `**التحديث التلقائي ينتظرك وأنت تكتب** (ويرجع بعدها) — ${n0}→${n1}→${n2}`);
  ok(aerrs.length === 0, 'اللوحة بلا أخطاء JS: ' + aerrs.slice(0, 2).join(' | '));

  await browser.close();
  server.close(); adm.close();
  console.log(`إعلان فوق الموقع (الصفحة واللوحة): ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
