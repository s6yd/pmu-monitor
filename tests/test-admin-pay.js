/* بطاقة «بوابة الدفع» في اللوحة — اختبار عرض حقيقي في Chromium.
   محمد يتأكد منها قبل الإطلاق من جواله: المفاتيح · الإشعار · مين يدفع ·
   الطلبات، وزر يثبت الاتصال بـPaylink. اللوحة تعرض ما يقوله السيرفر وبس.

   node tests/test-admin-pay.js [مسار admin.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'admin.html');
const SHOT = process.env.PAY_SHOTS || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const ST = { pay: null, ping: null, pings: 0 };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/admin.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u.endsWith('/pay')) return res.end(JSON.stringify(ST.pay));
  if (u.endsWith('/pay-ping')) { ST.pings++; return res.end(JSON.stringify(ST.ping)) }
  res.end(JSON.stringify({ ok: true }));
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.evaluate(() => sessionStorage.setItem('jdw_admin', 'x'.repeat(16)));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadPay === 'function', null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => typeof loadPay === 'function' && typeof payCardHTML === 'function'),
     'دوال البطاقة موجودة');

  const card = async d => {
    ST.pay = d;
    return page.evaluate(async () => {
      let el = document.getElementById('payCard');
      if (!el) { el = document.createElement('div'); el.id = 'payCard'; document.body.prepend(el) }
      await loadPay(true);
      return el.textContent.replace(/\s+/g, ' ');
    });
  };

  /* ── ١) بلا مفاتيح ── */
  let t = await card({ ok: true, env: 'prod', live: true, host: 'restapi.paylink.sa', gateway: 'paylink',
    ready: false, idSet: false, secretSet: false, testIdInProd: false, hookSet: false, freeBeta: true,
    openTo: 'none', counts: { pending: 0, paid: 0, failed: 0 }, paidHalalas: 0, recent: [] });
  ok(/ناقصة/.test(t) && /PAYLINK_API_ID/.test(t), 'بلا مفاتيح: يقول وش الناقص باسم المتغيّر — ' + t.slice(0, 120));
  ok(/ولا أحد/.test(t), 'ومين يدفع: ولا أحد');

  /* ── ٢) مفتاح التجربة العام في الإنتاج ── */
  t = await card(Object.assign({}, ST.pay, { idSet: true, secretSet: true, testIdInProd: true }));
  ok(/مفتاح التجربة العام/.test(t), 'مفتاح التجربة في الإنتاج: يسمّيه');

  /* ── ٣) جاهز قبل الإطلاق ── */
  t = await card({ ok: true, env: 'prod', live: true, host: 'restapi.paylink.sa', gateway: 'paylink',
    ready: true, idSet: true, secretSet: true, testIdInProd: false, hookSet: false, freeBeta: true,
    openTo: 'owner', counts: { pending: 1, paid: 2, failed: 1 }, paidHalalas: 3800,
    recent: [{ id: 101, term: '202720', status: 'paid', amount: 1900, credit: 0, gateway: 'paylink', note: null },
             { id: 102, term: '202720', status: 'failed', amount: 500, credit: 1400, gateway: 'paylink',
               note: '<img src=x onerror=alert(1)>انتهت المهلة' }] });
  ok(/جاهزة/.test(t), 'جاهز: المفاتيح جاهزة');
  ok(/PAYLINK_WEBHOOK_KEY/.test(t), 'والإشعار بلا مفتاح يسمّي المتغيّر');
  ok(/أنت فقط — الفترة المجانية/.test(t), '**قبل الإطلاق: أنت فقط** — واضح ليش');
  ok(/معلّقة 1 · مدفوعة 2 · فاشلة 1/.test(t), 'العدّادات');
  ok(/38 ريال/.test(t), 'والمحصّل بالريال — ' + t);
  ok(/رصيد 14/.test(t), 'والرصيد المصروف في الطلب');
  ok(await page.$('#payCard img') === null, '**ملاحظة فيها وسم تُهرَّب**');
  ok(/restapi\.paylink\.sa/.test(t), 'واسم الخادم');

  /* ── ٤) زر جرّب الاتصال ── */
  ST.ping = { ok: true, ms: 312, host: 'restapi.paylink.sa' };
  /* الضغط من الصفحة نفسها: البطاقة مرسومة في جسم الصفحة خارج التبويبات */
  const press = () => page.evaluate(() => document.querySelector('#payCard button').click());
  await press();
  await page.waitForTimeout(400);
  ok(ST.pings === 1, 'الزر نادى pay-ping مرة');
  const toastTxt = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok(/شغّال/.test(toastTxt) && /312/.test(toastTxt), 'والنتيجة ظاهرة — ' + toastTxt);
  ST.ping = { ok: false, error: 'Paylink auth: 401 Invalid credentials' };
  await page.waitForTimeout(3500);
  await press();
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok(/401/.test(t2), 'والفشل يوصل بنص Paylink — ' + t2);

  ok(errs.length === 0, 'بلا أخطاء JS — ' + errs.slice(0, 2).join(' | '));
  if (SHOT) {
    /* صورة البطاقة وحدها على مقاس الجوال */
    await page.evaluate(() => {
      const el = document.getElementById('payCard');
      document.body.innerHTML = ''; el.style.padding = '16px'; el.style.background = 'var(--bg)';
      document.body.appendChild(el); document.body.style.display = 'block';
    });
    await page.screenshot({ path: path.join(SHOT, 'admin-pay-card.png'), fullPage: true });
  }
  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('انهار: ' + (e && e.stack || e));
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
