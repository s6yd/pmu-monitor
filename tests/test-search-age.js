/* عمر نتائج البحث — اختبار عرض حقيقي في Chromium.
   قرار محمد (١٢ أكتوبر ٢٠٢٦): عمر البيانات يُقال للطالب **وقت التسجيل وحده، ولو فوق ربع ساعة بلا سحبة
   جديدة**. السيرفر يقرّر (X-Old) والصفحة تعرض:
   ١) X-Old ⇒ سطر «آخر بيانات وصلتنا من موقع الجامعة قبل 40 دقيقة» و«قبل 40 د» جنب الوقت.
   ٢) نسخة قديمة بلا X-Old (تحت ربع ساعة، أو خارج التسجيل) ⇒ ولا كلمة.
   ٣) كاش خارج التسجيل عمره ساعات (عمداً) ⇒ «آخر تحديث» وقت وصول النتائج بلا «قبل 300 د».
   ٤) ٥٠٣ «مزحوم» من السيرفر ⇒ رسالته نفسها لا «تأكد من اتصالك».
   والأرقام لاتينية، وتصوير على ٣٩٠ بالثيمين (SHOT_DIR).

   node tests/test-search-age.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const COURSES = [
  { crn: '30011', courseCode: 'MEEN 3311', courseTitle: 'Thermodynamics', section: '101', courseDate: 'MW',
    courseTiming: '0800 - 0915', instructor: 'Smith, John', room: 'M-CORE - G034', status: 'OPEN', gender: 'M' },
  { crn: '30012', courseCode: 'MEEN 3311', courseTitle: 'Thermodynamics', section: '102', courseDate: 'UT',
    courseTiming: '1000 - 1115', instructor: 'Smith, John', room: 'M-CORE - G035', status: 'CLOSED', gender: 'M' }
];
let MODE = 'old';
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
    if (MODE === 'busy') {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      return res.end(JSON.stringify({ success: false, error: 'البحث مزحوم — جرّب بعد دقيقة' }));
    }
    /* [عمرها بالدقائق، X-Stale، X-Old] — كما يرسلها السيرفر */
    const [mins, stale, old] = {
      old: [40, true, true],            /* وقت التسجيل وفوق ربع ساعة بلا سحبة */
      young: [10, true, false],         /* الجامعة ما ترد بس آخر نسخة تحت ربع ساعة */
      offStale: [420, true, false],     /* خارج التسجيل والجامعة ما ترد */
      offCache: [300, false, false],    /* خارج التسجيل: كاش ست ساعات عمداً */
      fresh: [0.05, false, false]
    }[MODE];
    const h = { 'Content-Type': 'application/json', 'X-Cached': '1', 'X-Age-Ms': String(Math.round(mins * 60000)) };
    if (stale) h['X-Stale'] = '1';
    if (old) h['X-Old'] = '1';
    res.writeHead(200, h);
    return res.end(JSON.stringify({ success: true, count: COURSES.length, courses: COURSES }));
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
const search = page => page.evaluate(async () => {
  try { switchTab('search') } catch (e) {}
  await doSearch();
  const n = document.getElementById('staleNote');
  const b = document.getElementById('initialBox');
  /* وقت الجهاز الحين (والدقيقة اللي قبلها — لو قلبت الدقيقة وسط الفحص) بنفس صيغة الصفحة */
  const fmt = d => new Date(d).toLocaleTimeString('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  return { note: n ? n.textContent : null, shown: !!(n && n.classList.contains('show') && n.offsetParent !== null),
           last: (document.getElementById('lastUpdate') || {}).textContent || '',
           now: [fmt(Date.now()), fmt(Date.now() - 60000)],
           err: b && b.classList.contains('visible') ? b.querySelector('.state-sub').textContent : '' };
});
/* «آخر تحديث» بلا عمر: وقت وصول النتائج (الحين) بأرقام لاتينية، بلا «قبل» */
const plainNow = r => !/قبل/.test(r.last) && !/[٠-٩]/.test(r.last) && r.now.includes(r.last.trim());

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;

  for (const theme of ['dark', 'light']) {
    const { page, errs, ctx } = await openPage(browser, theme);
    MODE = 'old';
    let r = await search(page);
    ok(r.shown && /آخر بيانات وصلتنا من موقع الجامعة قبل 40 دقيقة/.test(r.note),
      `[${theme}] **وقت التسجيل وفوق ربع ساعة بلا سحبة (X-Old): سطر «آخر بيانات وصلتنا من موقع الجامعة قبل 40 دقيقة»** — ${r.note}`);
    ok(/قبل 40 د/.test(r.last) && !/[٠-٩]/.test(r.last), `[${theme}] و«آخر تحديث» وقت البيانات و«قبل 40 د» بأرقام لاتينية — ${r.last}`);
    if (shots) await page.screenshot({ path: path.join(shots, `search-stale-${theme}.png`) });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${over}`);
    MODE = 'young';
    r = await search(page);
    ok(!r.shown && plainNow(r),
      `[${theme}] **نسخة قديمة تحت ربع ساعة (X-Stale بلا X-Old): ولا كلمة للطالب** — ${r.shown ? r.note : r.last}`);
    MODE = 'offStale';
    r = await search(page);
    ok(!r.shown && plainNow(r),
      `[${theme}] **خارج التسجيل والجامعة ما ترد (٧ ساعات): ولا كلمة** — ${r.shown ? r.note : r.last}`);
    MODE = 'offCache';
    r = await search(page);
    ok(!r.shown && plainNow(r),
      `[${theme}] **كاش خارج التسجيل عمره ٥ ساعات (عمداً): «آخر تحديث» وقت وصول النتائج بلا «قبل 300 د»** — ${r.last}`);
    MODE = 'old';
    r = await search(page);
    MODE = 'fresh';
    r = await search(page);
    ok(!r.shown && plainNow(r), `[${theme}] نتيجة طازجة بعد سطر العمر: السطر يختفي — ${r.last}`);
    MODE = 'old';
    await search(page);
    MODE = 'busy';
    r = await search(page);
    ok(/مزحوم/.test(r.err), `[${theme}] **٥٠٣ من السيرفر: رسالته نفسها** («مزحوم — جرّب بعد دقيقة») — ${r.err}`);
    ok(!r.shown, `[${theme}] والخطأ ما يخلّي سطر العمر معلّقاً`);
    ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`عمر البحث: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
