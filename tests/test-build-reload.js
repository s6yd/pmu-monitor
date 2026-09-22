/* تحديث النسخة المثبَّتة — اختبار سلوكي في Chromium.
   نبدّل بصمة البناء على السيرفر ونقيس: هل أعادت الصفحة تحميل نفسها؟

   node tests/test-build-reload.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

let BUILD = '"aaa111"';
let loads = 0;

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    loads++;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  /* /calendar.js صار يُطلب من الصفحة — ما نرد عليه بـJSON فيُنفَّذ كسكربت */
  if (req.url.split('?')[0].endsWith('.js')) { res.writeHead(404); return res.end('') }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u === '/api/monitor-status')
    return res.end(JSON.stringify({ build: BUILD, term: '202710', canWatch: false }));
  res.end(JSON.stringify({ courses: [], cached: false, age: 0 }));
});

const SB = 'window.supabase={createClient:()=>({auth:{' +
  'getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB }));

  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.checkBuildNow === 'function',
    null, { timeout: 15000 }).catch(() => {});

  const ready = await page.evaluate(() => typeof checkBuildNow === 'function');
  ok(ready, 'دوال فحص النسخة موجودة');
  if (!ready) { console.log('SETUP FAILED', errs.slice(0, 3)); await browser.close(); server.close(); process.exit(1) }

  await page.evaluate(() => { try { localStorage.removeItem('pmu_build_reload') } catch (e) {} });

  /* ── ١) نفس البصمة: ما يعيد التحميل ── */
  {
    await page.evaluate(() => { BUILD_SEEN = null; BUILD_NAG = false });
    const before = loads;
    await page.evaluate(() => checkBuildNow());   /* يثبّت البصمة أول مرة */
    await page.evaluate(() => checkBuildNow());
    await page.waitForTimeout(1200);
    ok(loads === before, 'بصمة ثابتة: بلا إعادة تحميل — تحميلات ' + (loads - before));
  }

  /* ── ٢) بصمة جديدة: يعيد التحميل من نفسه ── */
  {
    const before = loads;
    BUILD = '"bbb222"';
    await page.evaluate(() => checkBuildNow());
    await page.waitForTimeout(2500);
    ok(loads > before, 'بصمة جديدة: الصفحة أعادت تحميل نفسها');
    const stamp = await page.evaluate(() => {
      try { return Number(JSON.parse(localStorage.getItem('pmu_build_reload'))) } catch (e) { return 0 }
    });
    ok(stamp > 0, 'وسُجّل وقت الإعادة — حزام ضد الحلقة');
  }

  /* ── ٣) لا حلقة: بصمة ثالثة بعد إعادة قريبة ما تعيد التحميل ── */
  {
    await page.waitForFunction(() => typeof checkBuildNow === 'function',
      null, { timeout: 15000 });
    const before = loads;
    BUILD = '"ccc333"';
    await page.evaluate(() => { BUILD_SEEN = '"bbb222"'; BUILD_NAG = false });
    await page.evaluate(() => checkBuildNow());
    await page.waitForTimeout(2000);
    ok(loads === before,
       'إعادة ثانية خلال دقيقتين ممنوعة — تحميلات زائدة ' + (loads - before));
  }

  /* ── ٤) كتابة معلّقة تمنع الإعادة ── */
  {
    await page.evaluate(() => { try { localStorage.removeItem('pmu_build_reload') } catch (e) {} });
    const before = loads;
    const r = await page.evaluate(() => {
      BUILD_SEEN = '"old"'; BUILD_NAG = false;
      _saveQ.schedule = { running: Promise.resolve(), pending: null };
      const did = checkBuild({ build: '"new"' });
      delete _saveQ.schedule;
      return did;
    });
    await page.waitForTimeout(1200);
    ok(r === false && loads === before,
       'كتابة معلّقة: ما أعاد التحميل حتى لا يضيع تعديل الطالب');
  }

  /* ── ٥) أول فحص يثبّت البصمة ولا يعيد التحميل ── */
  {
    await page.evaluate(() => { try { localStorage.removeItem('pmu_build_reload') } catch (e) {} });
    const before = loads;
    const r = await page.evaluate(() => {
      BUILD_SEEN = null; BUILD_NAG = false;
      return checkBuild({ build: '"first"' });
    });
    await page.waitForTimeout(800);
    ok(r === false && loads === before, 'أول بصمة تُحفظ فقط — بلا إعادة');
  }

  /* ── ٦) رد بلا بصمة: لا انهيار ── */
  {
    const r = await page.evaluate(() => checkBuild({ term: '202710' }));
    ok(r === false, 'رد بلا build: يتجاهله بهدوء');
  }

  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
