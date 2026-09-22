/* بطاقة الموسم في لوحة التحكم — اختبار عرض حقيقي في Chromium.
   يستبدل نداءات /api/admin بردود ثابتة ويقيس ما يظهر فعلاً.

   node tests/test-admin-season.js [مسار admin.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'admin.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const monitorInfo = (over = {}) => Object.assign({
  activeTerm: '202710', termCustom: false, termEnv: '202710',
  canWatch: true, currentWindow: { from: '2026-08-23', to: '2026-09-10', ar: 'تسجيل الترم الأول' },
  windowCustom: false, hoursFrom: 7, hoursTo: 24, hoursCustom: false,
  riyadhDate: '2026-09-05', paused: false, enabled: true,
  state: { active: true, reason: 'peak', ar: 'مراقبة مكثفة' }
}, over);

function makeServer(state) {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/admin.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(FILE));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u.endsWith('/health')) return res.end(JSON.stringify({
      telegramOk: true, monitorInfo: state.mi, cache: state.cache || [],
      uptimeHours: 1, memMB: 90, memPct: 19
    }));
    if (u.endsWith('/monitors')) return res.end(JSON.stringify({ monitors: state.mons }));
    if (u.endsWith('/stats')) return res.end(JSON.stringify({}));
    if (u.endsWith('/users')) return res.end(JSON.stringify({ users: [] }));
    if (u.endsWith('/reviews')) return res.end(JSON.stringify({ reviews: [] }));
    res.end(JSON.stringify({ ok: true }));
  });
}

async function open(browser, state) {
  const server = makeServer(state);
  await new Promise(r => server.listen(0, r));
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.evaluate(() => { sessionStorage.setItem('jdw_admin', 'x'.repeat(16)) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.renderMons === 'function',
    null, { timeout: 15000 }).catch(() => {});
  return { page, errs, close: () => { server.close() } };
}

(async () => {
  const browser = await chromium.launch();

  /* ── ١) مع وجود مراقبات ── */
  {
    const mons = [{ courseCode: 'MEEN 3311', crn: '30011', status: 'CLOSED',
                    watchers: 4, notified: 1, scope: 'section', watchersList: [] }];
    const c = await open(browser, { mi: monitorInfo(), mons });
    await c.page.evaluate(() => { HEALTH = HEALTH || {} });
    const html = await c.page.evaluate(([mi, ms]) => {
      HEALTH = { monitorInfo: mi }; MONS = ms;
      renderMons();
      return document.getElementById('monsBody').innerHTML;
    }, [monitorInfo(), mons]);
    ok(/الترم النشط/.test(html), 'البطاقة تظهر مع وجود مراقبات');
    ok(/202710/.test(html), 'وتعرض الترم');
    ok(/2026-08-23/.test(html), 'وتعرض النافذة');
    ok(/مفتوح/.test(html), 'وتقول إن الجرس مفتوح');
    ok(/إنهاء الموسم/.test(html), 'وزر إنهاء الموسم موجود');
    ok(c.errs.length === 0, 'بلا أخطاء JS: ' + c.errs.slice(0, 2).join(' | '));
    c.close();
  }

  /* ── ٢) بعد إنهاء الموسم: الجدول فاضٍ ── */
  {
    const c = await open(browser, { mi: monitorInfo(), mons: [] });
    const html = await c.page.evaluate(mi => {
      HEALTH = { monitorInfo: mi }; MONS = [];
      renderMons();
      return document.getElementById('monsBody').innerHTML;
    }, monitorInfo());
    ok(/الترم النشط/.test(html),
       'البطاقة تظهر حتى بلا مراقبات — وهي اللحظة التي تحتاجها فيها');
    ok(/ما في مواد مراقبة/.test(html), 'ورسالة الفراغ باقية');
    ok(/تبديل الترم/.test(html) && /تعديل النافذة/.test(html),
       'وأزرار التحكم شغالة في الحالتين');
    ok(c.errs.length === 0, 'بلا أخطاء JS في الحالة الفارغة');
    c.close();
  }

  /* ── ٣) الجرس مقفول ── */
  {
    const c = await open(browser, { mi: monitorInfo(), mons: [] });
    const html = await c.page.evaluate(mi => {
      HEALTH = { monitorInfo: mi }; MONS = [];
      renderMons();
      return document.getElementById('monsBody').innerHTML;
    }, monitorInfo({ canWatch: false, currentWindow: null, windowCustom: true }));
    ok(/مقفول/.test(html), 'حالة الجرس تنقلب لمقفول');
    ok(/مغلقة/.test(html), 'والنافذة تُعرض مغلقة');
    ok(/يدوية/.test(html), 'ووسم «يدوية» يظهر');
    c.close();
  }

  /* ── ٤) بلا HEALTH: لا انهيار ── */
  {
    const c = await open(browser, { mi: monitorInfo(), mons: [] });
    const html = await c.page.evaluate(() => {
      HEALTH = null; MONS = [];
      renderMons();
      return document.getElementById('monsBody').innerHTML;
    });
    ok(/الترم النشط/.test(html) && !/undefined/.test(html),
       'بلا بيانات: تعرض شُرَط بدل undefined');
    ok(c.errs.length === 0, 'وبلا انهيار');
    c.close();
  }

  /* ── ٤ب) العربي في صفوف القيم ما يتفكّك ── */
  {
    const c = await open(browser, { mi: monitorInfo(), mons: [] });
    const f = await c.page.evaluate(() => {
      HEALTH = { monitorInfo: { activeTerm: '202710', canWatch: false } };
      MONS = []; renderMons();
      const b = document.querySelector('#monsBody .kv b');
      return b ? getComputedStyle(b).fontFamily : '';
    });
    ok(/Plex Sans Arabic/.test(f),
       'خط صفوف القيم فيه العربي قبل الاحتياطي الأحادي — ' + f);
    ok(/JetBrains Mono/.test(f), 'والأرقام تبقى على الخط الأحادي');
    c.close();
  }

  /* ── ٥) مفتاح الكاش ما ينقلب في RTL ── */
  {
    const c = await open(browser, { mi: monitorInfo(), mons: [],
      cache: [{ key: '202710|ALL|ALL', ageMin: 2, fresh: true }] });
    const dir = await c.page.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'ltr'; el.textContent = '202710|ALL|ALL';
      document.body.appendChild(el);
      return getComputedStyle(el).direction;
    });
    ok(dir === 'ltr', 'صنف .ltr معرَّف فعلاً في CSS — جاء ' + dir);
    c.close();
  }

  await browser.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
