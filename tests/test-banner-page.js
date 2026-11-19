/* البحث من بانر في الصفحة — قرار محمد (١٩ نوفمبر ٢٠٢٦). السيرفر يخدم البحث من بانر وقت عطل موقع الجدول **موسوماً**
   (X-Source: banner)، والصفحة:
   ١) سطر فوق النتائج: من بانر وليش «+ أضف» مقفولة — ومع بحث بكلية «كل الكليات» (X-Banner-Colleges).
   ٢) «+ أضف» مقفولة (صياغة بانر — القاعة مثلاً — ممكن تفرق، فتنحفظ في جدوله وتطلع «تغيّر في جدولك» كاذبة)،
      والضغطة تقول ليش وما تضيف، و«راقب» شغّالة، والحذف من جدوله شغّال.
   ٣) بحث من الموقع بعدها: كل شي يرجع.
   ٤) التحديث الصامت من بانر: الحالات بس (القاعة والدكتور بصياغته ما تدخل صفوف نقدر نضيفها)، والموقع رجع والنتائج
      من بانر: السطر يقول «اضغط ابحث».
   ٥) الاستيراد: بيانات بانر ما تنضاف (نفس «ما وصلت بيانات الجامعة»).   ٦) الدكاترة: ما تنحفظ قائمتهم من بانر.
   بالثيمين على ٣٩٠ (SHOT_DIR للصور).

   node tests/test-banner-page.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

/* صفوف بشكل رد السيرفر — نفس bannerRows (الجنس من رقم الشعبة). مادة برّا الخطط: الإضافة العادية بلا حارس متطلب */
const ROWS = room => [
  { crn: '30011', courseCode: 'ARTH 1100', courseTitle: 'Art History', section: '101', courseDate: 'MW',
    courseTiming: '0800 - 0915', instructor: 'Smith, John', room: room || 'M-CORE - G034', status: 'OPEN', gender: 'M' },
  { crn: '30012', courseCode: 'ARTH 1100', courseTitle: 'Art History', section: '102', courseDate: 'UT',
    courseTiming: '1000 - 1115', instructor: 'Smith, John', room: room || 'M-CORE - G035', status: 'CLOSE', gender: 'M' }
];
let MODE = 'banner';
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  if (u === '/plans.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
  }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  if (u === '/api/courses') {
    const h = { 'Content-Type': 'application/json', 'X-Cached': '1', 'X-Age-Ms': '30000' };
    let rows = ROWS();
    if (MODE === 'banner' || MODE === 'bannerCol') h['X-Source'] = 'banner';
    if (MODE === 'bannerCol') h['X-Banner-Colleges'] = 'all';
    /* التحديث الصامت من بانر: 30012 فتحت، والقاعة بصياغة بانر */
    if (MODE === 'bannerFlip') { h['X-Source'] = 'banner'; rows = ROWS('M-CORE - 999'); rows[1].status = 'OPEN';
      rows.forEach(r => { r.instructor = 'SMITH, JOHN' }) }
    res.writeHead(200, h);
    return res.end(JSON.stringify({ success: true, count: rows.length, courses: rows }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({}));
});

const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

async function openPage(browser, theme) {
  const port = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('guideSeen', '1') } catch (e) {} }, theme);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.doSearch === 'function', null, { timeout: 15000 }).catch(() => {});
  return { page, errs, ctx };
}
/* بحث كامل وقراءة: السطر · زر «+ أضف» و«راقب» لكل شعبة */
const search = page => page.evaluate(async () => {
  try { switchTab('search') } catch (e) {}
  await doSearch();
  const n = document.getElementById('staleNote');
  const btn = (crn, cls) => { const r = document.querySelector(`.sec-row[data-crn="${crn}"]`); const b = r && r.querySelector('.sr-btn.' + cls);
    return b ? { cls: b.className, dis: b.getAttribute('aria-disabled'), txt: b.textContent.trim(), shown: !b.hidden } : null };
  return { note: n ? n.textContent : '', shown: !!(n && n.classList.contains('show') && n.offsetParent !== null),
           add: btn('30011', 'add'), bell: btn('30012', 'bell') };
});
const toastText = page => page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : '' });

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;

  for (const theme of ['dark', 'light']) {
    const { page, errs, ctx } = await openPage(browser, theme);
    /* ١ · ٢ — من بانر */
    MODE = 'banner';
    let r = await search(page);
    ok(r.shown && /من بانر/.test(r.note) && /الإضافة لجدولك ترجع/.test(r.note),
      `[${theme}] **النتائج من بانر: سطر يقول من وين وليش «+ أضف» مقفولة** — ${r.note}`);
    ok(r.add && /banner-off/.test(r.add.cls) && r.add.dis === 'true',
      `[${theme}] **«+ أضف» مقفولة على نتائج بانر** — ${JSON.stringify(r.add)}`);
    ok(r.bell && r.bell.shown && /راقب/.test(r.bell.txt), `[${theme}] و«🔕 راقب» شغّالة للمقفلة — ${JSON.stringify(r.bell)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `banner-search-${theme}.png`) });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${over}`);
    const add = await page.evaluate(() => { const n0 = schedule.length; toggleCourse('30011'); return [n0, schedule.length] });
    ok(add[0] === add[1], `[${theme}] **الضغطة ما تضيف لجدوله** — ${add}`);
    ok(/الإضافة لجدولك ترجع لما يرجع موقع جدول الجامعة/.test(await toastText(page)), `[${theme}] وتقول له ليش`);
    MODE = 'bannerCol';
    r = await search(page);
    ok(/كل الكليات/.test(r.note), `[${theme}] بحث بكلية من بانر: «بانر ما يفرز بالكلية، فهذي مواد كل الكليات» — ${r.note}`);

    /* ٣ — من الموقع: كل شي يرجع */
    MODE = 'normal';
    r = await search(page);
    ok(!r.shown && r.add && !/banner-off/.test(r.add.cls), `[${theme}] **بحث من الموقع: السطر يختفي و«+ أضف» ترجع** — ${JSON.stringify(r.add)}`);
    const add2 = await page.evaluate(() => { const n0 = schedule.length; toggleCourse('30011'); return [n0, schedule.length] });
    ok(add2[1] === add2[0] + 1, `[${theme}] والإضافة تشتغل — ${add2}`);
    /* الحذف من جدوله شغّال حتى والنتائج من بانر */
    MODE = 'banner';
    await search(page);
    const rm = await page.evaluate(() => { const n0 = schedule.length; toggleCourse('30011'); return [n0, schedule.length] });
    ok(rm[1] === rm[0] - 1, `[${theme}] والنتائج من بانر: الحذف من جدوله شغّال — ${rm}`);

    /* ٤ — التحديث الصامت */
    MODE = 'normal';
    await search(page);
    MODE = 'bannerFlip';
    const q = await page.evaluate(async () => { await quietRefresh(); const c = allCourses.find(x => x.crn === '30012');
      return { st: c.status, room: c.room, inst: c.instructor } });
    ok(q.st === 'OPEN' && q.room === 'M-CORE - G035' && q.inst === 'Smith, John',
      `[${theme}] **التحديث الصامت من بانر: الحالة بس — القاعة والدكتور بصياغة الموقع** — ${JSON.stringify(q)}`);
    MODE = 'banner';
    await search(page);
    MODE = 'normal';
    const back = await page.evaluate(async () => { await quietRefresh(); return document.getElementById('staleNote').textContent });
    ok(/رجع/.test(back) && /ابحث/.test(back), `[${theme}] الموقع رجع والنتائج من بانر: «اضغط ابحث» — ${back}`);

    /* ٥ — الاستيراد */
    MODE = 'banner';
    const im = await page.evaluate(async () => { const n0 = schedule.length;
      await imMatch([{ crn: '30012', code: 'ARTH 1100', section: '102' }], '202710');
      return { bad: IM.bad, msg: IM.msg, found: IM.found.length, n: [n0, schedule.length] } });
    ok(im.bad && /ما يرد الحين/.test(im.msg) && !im.found && im.n[0] === im.n[1],
      `[${theme}] **الاستيراد: بيانات بانر ما تنضاف** (نفس «ما وصلت بيانات الجامعة») — ${JSON.stringify(im)}`);

    /* ٦ — الدكاترة */
    const docs = await page.evaluate(async () => { docsLoaded = false; await loadInstructors(true); return docsLoaded });
    ok(docs === false, `[${theme}] الدكاترة: قائمتهم ما تنحفظ من بانر (تنسحب من الموقع لما يرجع)`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`البحث من بانر في الصفحة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
