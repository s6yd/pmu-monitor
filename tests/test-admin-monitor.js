/* بطاقة المراقبة في تبويب «النظام» — اختبار عرض حقيقي في Chromium.
   يستبدل نداءات /api/admin بردود ثابتة ويقيس ما يظهر فعلاً:
   مصدر الجدول (بانر احتياط) · رفض الجامعة · عطل طويل · النبض الخارجي · فاصل يوم التسجيل ·
   احتياط بانر وزرّيه · سطر تجميد النشر في النافذة.

   node tests/test-admin-monitor.js [مسار admin.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'admin.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const NOW = Date.now();
const monitorInfo = (over = {}) => Object.assign({
  state: { active: true, reason: 'peak', ar: 'مراقبة مكثفة', hot: true }, paused: false, enabled: true,
  hoursFrom: 7, hoursTo: 24, hoursCustom: false, windowCustom: false, activeTerm: '202710', regTerm: '202720',
  riyadhHour: 10, riyadhTime: '10:00', riyadhDate: '2027-01-11',
  window: { from: '2027-01-10', to: '2027-01-21', term: '202720', ar: 'تسجيل الترم الثاني' },
  nextWindow: null, intervalMin: 5, intervalHotMin: 2, hotToday: true, jitterPct: 25,
  intervalMinLow: 3.75, intervalMinHigh: 6.25, idleOff: true, nextCycleInSec: 90,
  downCycles: 5, backoffMin: 15, source: 'banner',
  banner: { on: true, last: { at: NOW - 120000, ok: true, sections: 1140, total: 1140, rows: 1180, ms: 4200 }, blockedUntil: null },
  heartbeat: { verdict: 'fail', lastAgoSec: 40 }
}, over);

function makeServer(state) {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/admin.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(FILE));
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.endsWith('/health')) return res.end(JSON.stringify({
        telegramOk: true, monitorInfo: state.mi, pmuBlock: state.block || null, cache: [], warnings: [],
        uptimeHours: 1, memMB: 90, memPct: 19, cycles: [], lastCycle: {}
      }));
      if (u.endsWith('/banner-ping')) { state.pings = (state.pings || 0) + 1;
        return res.end(JSON.stringify({ ok: true, term: '202720', total: 1140, ms: 900,
          sample: { crn: '11298', courseCode: 'ACCT 2311', section: '203', status: 'OPEN', courseDate: 'MW', courseTiming: '0800 - 0915' } })) }
      if (u.endsWith('/banner-toggle')) { state.toggles = (state.toggles || []).concat([JSON.parse(body || '{}')]);
        return res.end(JSON.stringify({ on: false })) }
      if (u.endsWith('/monitors')) return res.end(JSON.stringify({ monitors: [] }));
      if (u.endsWith('/users')) return res.end(JSON.stringify({ users: [] }));
      if (u.endsWith('/reviews')) return res.end(JSON.stringify({ reviews: [] }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
}

async function open(browser, state) {
  const server = makeServer(state);
  await new Promise(r => server.listen(0, r));
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.evaluate(() => { sessionStorage.setItem('jdw_admin', 'x'.repeat(16)) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.renderSys === 'function', null, { timeout: 15000 }).catch(() => {});
  return { page, errs, close: () => { server.close() } };
}
/* ضغطة بمهلة قصيرة — زر ناقص فشل يُحسب، لا انهيار */
const click = (page, sel) => page.click(sel, { timeout: 3000 }).then(() => true, () => false);
const sysText = page => page.evaluate(() => { go('sys'); renderSys(); return document.getElementById('sysBody').innerText });

(async () => {
  const browser = await chromium.launch();

  /* ── ١) بانر احتياط · عطل طويل · النبض فاشل · يوم تسجيل · نافذة ── */
  {
    const st = { mi: monitorInfo() };
    const c = await open(browser, st);
    await c.page.waitForFunction(() => window.HEALTH, null, { timeout: 15000 }).catch(() => {});
    const txt = await sysText(c.page);
    ok(/مصدر الجدول/.test(txt) && /بانر \(احتياط\)/.test(txt), '**مصدر الجدول: «🛟 بانر (احتياط)»**');
    ok(/5 دورات بلا جدول/.test(txt) && /15 دقيقة/.test(txt), 'عطل طويل: كم دورة والفاصل اللي صار');
    ok(/النبض الخارجي/.test(txt) && /فشل/.test(txt), 'النبض الخارجي يقول «فشل»');
    ok(/كل 2 دقائق اليوم/.test(txt) && /يوم تسجيل/.test(txt), 'الفاصل: دقيقتان اليوم (يوم تسجيل)');
    ok(/احتياط بانر/.test(txt) && /1140 شعبة/.test(txt), 'بطاقة احتياط بانر وآخر محاولة (١١٤٠ شعبة)');
    ok(/لا تدمج dev ← main/.test(txt), '**النافذة شغّالة: سطر تجميد النشر**');
    /* «جرّب بانر» */
    ok(await click(c.page, 'text=🛟 جرّب بانر'), 'زر «🛟 جرّب بانر» موجود');
    await c.page.waitForFunction(() => /بانر شغّال/.test((document.getElementById('bannerLast') || {}).textContent || ''),
      null, { timeout: 5000 }).catch(() => {});
    const last = await c.page.evaluate(() => (document.getElementById('bannerLast') || {}).textContent || '');
    ok(st.pings === 1 && /بانر شغّال/.test(last) && /1140/.test(last) && /ACCT 2311/.test(last),
      '**«🛟 جرّب بانر»: نداء واحد والنتيجة تبان مكانها** — ' + last);
    /* أطفه — بتأكيد */
    ok(await click(c.page, 'text=أطفه'), 'زر «أطفه» موجود');
    await c.page.waitForTimeout(500);
    ok(JSON.stringify(st.toggles) === JSON.stringify([{ on: false }]), 'زر «أطفه» يرسل on:false بعد التأكيد');
    /* ما فيه خط عرض زائد على الجوال */
    const over = await c.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, 'على عرض الجوال (٣٩٠) ما فيه تمرير أفقي — ' + over);
    ok(c.errs.length === 0, 'بلا أخطاء JS: ' + c.errs.slice(0, 2).join(' | '));
    c.close();
  }

  /* ── ٢) الجامعة رافضتنا · المصدر الأساسي · النبض مو مضبوط · خارج النوافذ ── */
  {
    const st = { mi: monitorInfo({ source: 'pmu', downCycles: 0, backoffMin: 0, heartbeat: null, hotToday: false,
        window: null, nextWindow: { from: '2027-04-11', to: '2027-04-15', ar: 'التسجيل المبكر للصيفي' },
        state: { active: false, reason: 'offseason', ar: 'خارج' },
        banner: { on: false, last: { at: NOW - 60000, ok: false, err: 'Banner results 500' }, blockedUntil: null } }),
      block: { until: Date.parse('2027-01-11T08:15:00Z'), status: 403, n: 1 } };
    const c = await open(browser, st);
    await c.page.waitForFunction(() => window.HEALTH, null, { timeout: 15000 }).catch(() => {});
    const txt = await sysText(c.page);
    ok(/رافضة طلباتنا \(403\)/.test(txt) && /11:15/.test(txt), '**الجامعة رافضتنا: (403) ولين متى بتوقيت الرياض**');
    ok(/موقع الجدول \(masterschedule\)/.test(txt), 'المصدر الأساسي');
    ok(/مو مضبوط/.test(txt) && /HEALTHCHECK_URL/.test(txt), 'النبض مو مضبوط: يقول وش المتغيّر');
    ok(!/عطل طويل/.test(txt), 'بلا عطل طويل: ما يطلع سطره');
    ok(/مطفأ/.test(txt) && /ما اشتغل: Banner results 500/.test(txt) && /شغّله/.test(txt), 'بانر مطفأ: آخر محاولة فشلت وزر «شغّله»');
    ok(!/لا تدمج dev/.test(txt), 'خارج النوافذ: بلا سطر التجميد');
    ok(c.errs.length === 0, 'بلا أخطاء JS: ' + c.errs.slice(0, 2).join(' | '));
    c.close();
  }

  await browser.close();
  console.log(`لوحة المراقبة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
