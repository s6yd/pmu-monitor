/* بطاقة «بوابة الدفع» في اللوحة — اختبار عرض حقيقي في Chromium.
   **EdfaPay وحدها — قرار محمد** (كانت Paylink؛ حالات مفتاح إشعارها انشالت مع البوابة).
   محمد يتأكد منها قبل الإطلاق من جواله: الخادم · المفتاح · سرّ الإشعار ورابطه ·
   آخر إشعار وليش انرفض · مين يدفع · الطلبات، وزر يثبت الاتصال. اللوحة تعرض ما
   يقوله السيرفر وبس، والسرّ ما يوصلها (طوله بس).

   node tests/test-admin-pay.js [مسار admin.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'admin.html');
const SHOT = process.env.PAY_SHOTS || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const ST = { pay: null, ping: null, pings: 0, lic: null, licNext: null, licCalls: [] };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/admin.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u.endsWith('/pay')) return res.end(JSON.stringify(ST.pay));
  if (u.endsWith('/pay-ping')) { ST.pings++; return res.end(JSON.stringify(ST.ping)) }
  if (u.endsWith('/po-lic')) return res.end(JSON.stringify(ST.lic));
  if (u.endsWith('/po-lic-retry') || u.endsWith('/po-lic-done')) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => raw += c);
    req.on('end', () => {
      ST.licCalls.push({ act: u.split('/').pop(), body: JSON.parse(raw || '{}') });
      res.end(JSON.stringify(ST.licNext));
    });
    return;
  }
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
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  const base = { ok: true, env: 'prod', live: true, host: 'app-api.edfapay.com', hostBad: false, gateway: 'edfapay',
    ready: true, keySet: true, hookSet: true, hookLen: 29, hookHidden: 0, hookLast: null, freeBeta: true,
    openTo: 'owner', counts: { pending: 0, paid: 0, failed: 0 }, paidHalalas: 0, recent: [] };
  const D = o => Object.assign({}, base, o);
  const last = o => D({ hookLast: Object.assign({ at: ago(3), ok: false, why: 'bad', sigLen: 64, bytes: 420,
    want: 29, okAt: null }, o) });

  /* ── ١) بلا مفتاح ولا سرّ ── */
  let t = await card(D({ ready: false, keySet: false, hookSet: false, hookLen: 0, openTo: 'none' }));
  ok(/EdfaPay/.test(t) && !/Paylink/.test(t), '**البطاقة لـEdfaPay وحدها** — ' + t.slice(0, 80));
  ok(/ناقص/.test(t) && /EDFAPAY_API_KEY/.test(t), 'بلا مفتاح: يسمّي المتغيّر — ' + t.slice(0, 200));
  ok(/EDFAPAY_WEBHOOK_SECRET/.test(t), 'وبلا سرّ: يسمّيه');
  ok(/ولا أحد/.test(t), 'ومين يدفع: ولا أحد');
  ok(await page.evaluate(() => document.querySelector('#payCard').textContent
     .includes(location.origin + '/api/edfapay/webhook')), '**رابط الإشعار على نطاق اللوحة نفسها** (الإنتاج أو dev)');

  /* ── ٢) خادم من EDFAPAY_HOST ما نعرفه ── */
  t = await card(D({ live: false, host: 'demo-api.edfapay.com', hostBad: true }));
  ok(/التجربة/.test(t) && /demo-api\.edfapay\.com/.test(t), 'نسخة التجربة وخادمها');
  ok(/EDFAPAY_HOST/.test(t) && /تجاهلناه/.test(t), '**EDFAPAY_HOST غريب: يقول تجاهلناه**');

  /* ── ٣) جاهز قبل الإطلاق ── */
  t = await card(D({ counts: { pending: 1, paid: 2, failed: 1 }, paidHalalas: 3800,
    recent: [{ id: 101, term: '202720', status: 'paid', amount: 1900, credit: 0, gateway: 'edfapay', note: null },
             { id: 102, term: '202720', status: 'failed', amount: 1000, credit: 900, gateway: 'edfapay',
               note: '<img src=x onerror=alert(1)>انتهت المهلة' }] }));
  ok(/المفتاح\s*مضبوط/.test(t), 'جاهز: المفتاح مضبوط');
  ok(/سرّ الإشعار\s*مضبوط · 29 حرف/.test(t), 'والسرّ مضبوط وطوله');
  ok(/أنت فقط — الفترة المجانية/.test(t), '**قبل الإطلاق: أنت فقط** — واضح ليش');
  ok(/معلّقة 1 · مدفوعة 2 · فاشلة 1/.test(t), 'العدّادات');
  ok(/المحصّل عبر EdfaPay\s*38 ريال/.test(t), 'والمحصّل بالريال — ' + t);
  ok(/رصيد 9/.test(t), 'والرصيد المصروف في الطلب');
  ok(await page.$('#payCard img') === null, '**ملاحظة فيها وسم تُهرَّب**');
  ok(/app-api\.edfapay\.com/.test(t), 'واسم الخادم');

  /* ── ٣ب) الاسترجاع (الشروط §٤): استخدم ميزة مدفوعة بعد الدفع؟ — من سجل الاستخدام ──
     كانت البطاقة ما تقول شي: محمد يقرر الاسترجاع وهو ما يدري هل الطالب استخدم */
  const inDays = n => new Date(Date.now() + n * 864e5).toISOString();
  const paidRow = (id, usage) => ({ id, term: '202720', status: 'paid', amount: 1900, credit: 0,
    gateway: 'edfapay', note: null, at: ago(60), paidAt: ago(60), usage });
  const useHTML = async id => page.evaluate(i => {
    const items = [...document.querySelectorAll('#payCard .pay-item')];
    const it = items.find(x => x.textContent.includes('#' + i + ' '));
    const u = it && it.querySelector('.pay-use');
    return u ? u.textContent.replace(/\s+/g, ' ').trim() : null;
  }, id);
  t = await card(D({ usageLog: 'ok', recent: [
    paidRow(201, { until: inDays(6), used: [] }),
    paidRow(202, { until: inDays(5), used: [
      { kind: 'monitor', at: ago(50), n: 3, detail: null },
      { kind: 'schedule', at: ago(40), n: 2, detail: null },
      { kind: 'ai', at: ago(30), n: null, detail: 'my_day' },
      { kind: 'pushover', at: ago(20), n: null, detail: null },
      { kind: 'pushover_test', at: ago(10), n: null, detail: null }] }),
    paidRow(203, { until: inDays(-1), used: [{ kind: 'monitor_course', at: ago(9000), n: null, detail: null }] }),
    paidRow(204, { until: inDays(3), used: [{ kind: 'pushover_test', at: ago(5), n: null, detail: null }] }),
    { id: 205, term: '202720', status: 'pending', amount: 1900, credit: 0, gateway: 'edfapay', note: null, at: ago(2), usage: null }] }));
  let u = await useHTML(201);
  ok(/✅ ما انسجّل له استخدام لميزة مدفوعة/.test(u || '') && /الاسترجاع متاح حتى/.test(u || ''),
     '**مدفوع بلا استخدام: يقولها ومتى تنتهي مدة الاسترجاع** — ' + u);
  u = await useHTML(202);
  ok(/⚠️ استخدم ميزة مدفوعة/.test(u || '') && /مراقبة 3 شعب/.test(u || '') && /الجدول 2/.test(u || '') &&
     /Jadwalik AI \(my_day\)/.test(u || '') && /وصله تنبيه طارئ/.test(u || ''),
     '**استخدم: كل ميزة باسمها** — ' + u);
  ok(/وصله تنبيه تجربة منك/.test(u || '') && !/تنبيه تجربة منك[^·]*استخدم/.test(u || ''),
     'وتنبيه التجربة منك يُذكر وحده');
  u = await useHTML(203);
  ok(/مراقبة كل شعب مادة/.test(u || '') && /انتهت مدة الاسترجاع/.test(u || ''),
     'مدة الاسترجاع خلصت: يقولها — ' + u);
  u = await useHTML(204);
  ok(/✅ ما انسجّل له استخدام/.test(u || '') && /وصله تنبيه تجربة منك/.test(u || ''),
     '**تنبيه التجربة وحده ما يُعتبر استخدام الطالب** — ' + u);
  eq(await useHTML(205), null, 'والمعلّق بلا سطر استخدام');
  ok(!/سجل الاستخدام ما يشتغل/.test(t), 'والسجل شغّال: بلا تنبيه');
  t = await card(D({ usageLog: 'ok', recent: [paidRow(206, { until: inDays(6), used: [
    { kind: 'ai', at: ago(3), n: null, detail: '<img src=x onerror=alert(1)>' },
    { kind: '<img src=y>', at: ago(2), n: null, detail: null }] })] }));
  ok(await page.$('#payCard img') === null, '**اسم أداة أو ميزة فيه وسم يُهرَّب**');
  t = await card(D({ usageLog: 'missing', recent: [Object.assign(paidRow(207, null))] }));
  ok(/سجل الاستخدام ما يشتغل/.test(t) && /SQL/.test(t),
     '**السجل ما يشتغل (الـSQL ما انشغّل): تنبيه — لا «ما استخدم»**');
  eq(await useHTML(207), null, 'وما يطلع «ما انسجّل له استخدام» لطلب ما نقدر نحكم عليه');
  if (SHOT) {
    await card(D({ usageLog: 'ok', counts: { pending: 0, paid: 2, failed: 0 }, paidHalalas: 3800, recent: [
      paidRow(202, { until: inDays(5), used: [
        { kind: 'monitor', at: ago(50), n: 3, detail: null },
        { kind: 'ai', at: ago(30), n: null, detail: 'my_day' },
        { kind: 'pushover', at: ago(20), n: null, detail: null }] }),
      paidRow(201, { until: inDays(6), used: [{ kind: 'pushover_test', at: ago(10), n: null, detail: null }] })] }));
    await page.evaluate(() => {
      const el = document.getElementById('payCard');
      document.body.innerHTML = ''; el.style.padding = '16px'; el.style.background = 'var(--bg)';
      document.body.appendChild(el); document.body.style.display = 'block';
    });
    await page.screenshot({ path: path.join(SHOT, 'admin-pay-usage.png'), fullPage: true });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadPay === 'function', null, { timeout: 15000 }).catch(() => {});
    await card(D({}));                    /* الأقسام التالية تضغط أزرار البطاقة */
  }

  /* ── ٤) زر جرّب الاتصال ── */
  ST.ping = { ok: true, ms: 312, host: 'app-api.edfapay.com' };
  const press = () => page.evaluate(() => document.querySelector('#payCard button[onclick^="payPing"]').click());
  await press();
  await page.waitForTimeout(400);
  ok(ST.pings === 1, 'الزر نادى pay-ping مرة');
  const toastTxt = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok(/EdfaPay شغّال/.test(toastTxt) && /312/.test(toastTxt), 'والنتيجة ظاهرة — ' + toastTxt);
  ST.ping = { ok: false, error: 'EdfaPay رفض المفتاح (401) — حط مفتاح حسابك الحقيقي (Test Mode مطفأ في لوحتهم)' };
  await page.waitForTimeout(3500);
  await press();
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok(/401/.test(t2) && /Test Mode/.test(t2), 'والفشل يوصل بنص السيرفر — ' + t2);

  /* ── ٥) آخر إشعار: ليش انرفض ووش يصلّح ── */
  t = await card(D({}));
  ok(/ما وصل شي من آخر تشغيل/.test(t) && /لوحة EdfaPay/.test(t), 'ما وصل شي: يقول جرّبه من لوحتهم');

  t = await card(last({ ok: true, why: 'ok', at: ago(0), json: true, status: 'Approved', type: 'Purchase', order: 'JDW-77' }));
  ok(/✅ مقبول · الآن/.test(t) && /Approved/.test(t) && /Purchase/.test(t) && /JDW-77/.test(t),
     '**مقبول: الحالة والنوع ورقم طلبنا** — ' + t.slice(0, 400));
  t = await card(last({ ok: true, why: 'ok', json: true, status: 'Success', type: 'Purchase', order: 'other' }));
  ok(/مو من طلباتنا/.test(t), 'رقم طلب مو من طلباتنا: يقول إنه تجربة');
  t = await card(last({ ok: true, why: 'ok', json: false }));
  ok(/مو JSON/.test(t), 'موقَّع وجسمه مو JSON: يقولها');

  t = await card(last({ why: 'nosig', sigLen: 0 }));
  ok(/❌ مرفوض · قبل 3 د/.test(t) && /بلا توقيع/.test(t) && /Webhook Secret/.test(t),
     '**بلا توقيع: يقول اكتب السرّ في خانة Webhook Secret عندهم** — ' + t.slice(0, 400));
  t = await card(last({ why: 'bad' }));
  ok(/التوقيع ما طابق/.test(t) && /عندنا 29 حرف/.test(t), '**توقيع غلط: السرّان مختلفان، بطول سرّنا**');
  t = await card(Object.assign(last({ why: 'nosecret', want: 0 }), { hookSet: false, hookLen: 0 }));
  ok(/EDFAPAY_WEBHOOK_SECRET/.test(t) && /ناقص في Render/.test(t), 'بلا سرّ في Render: يسمّي المتغيّر');
  t = await card(last({ why: 'bad', okAt: ago(120) }));
  ok(/آخر إشعار مقبول: قبل 2 س/.test(t), '**رفض بعد قبول: يذكر آخر مقبول**');
  t = await card(last({ ok: true, why: 'ok', json: true, status: '<img src=x onerror=alert(1)>', order: '<img src=y>' }));
  ok(await page.$('#payCard img') === null, '**قيم فيها وسم تُهرَّب**');

  ok(await page.evaluate(() => !!document.querySelector('#payCard button[onclick*="loadPay"]')),
     'زر «تحديث» يقرأ آخر إشعار بلا ما تعيد فتح اللوحة');
  await page.evaluate(() => document.querySelector('#payCard button[onclick^="payCopy"]').click());
  await page.waitForTimeout(300);
  const tc = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok(/انسخ الرابط|\/api\/edfapay\/webhook/.test(tc), 'زر «انسخ» ينسخ رابط الإشعار — ' + tc);

  /* ── ٧) رخص Pushover — تنضاف تلقائياً (طلب محمد «بدون تدخل مني») ──
     البطاقة تعرض ما يقوله السيرفر: الوضع · الرصيد · المستحقون · آخر الطلاب. ولما توقف
     (رفضوها · ما ندري) زرّان على الطالب نفسه — ولا شي يُحسب هنا */
  const U1 = '00000000-0000-4000-8000-000000000001', U2 = '00000000-0000-4000-8000-000000000002';
  const LB = { ok: true, live: true, on: true, table: 'ok', credits: 8, creditsError: null, state: 'on',
    waiting: 1, refundDays: 7, low: 2, rows: [
      { user: U2, email: 's2@example.com', status: 'assigned', source: 'comp', kind: null, credits: 8,
        error: null, at: ago(30), doneAt: ago(29) },
      { user: U1, email: 's1@example.com', status: 'assigned', source: 'paid', kind: null, credits: 9,
        error: null, at: ago(90), doneAt: ago(89) }] };
  const L = o => Object.assign({}, LB, o);
  const lic = async d => {
    ST.lic = d;
    return page.evaluate(async () => {
      let el = document.getElementById('poLicCard');
      if (!el) { el = document.createElement('div'); el.id = 'poLicCard'; document.body.prepend(el) }
      await loadPoLic(true);
      return el.textContent.replace(/\s+/g, ' ');
    });
  };
  ok(await page.evaluate(() => typeof loadPoLic === 'function' && typeof poLicCardHTML === 'function'),
     'دوال بطاقة الرخص موجودة');
  const SRC = fs.readFileSync(FILE, 'utf8');
  ok(/<div id="poLicCard">\$\{poLicCardHTML\(\)\}<\/div>/.test(SRC) && /\n  loadPay\(\);\n  loadPoLic\(\);/.test(SRC),
     '**البطاقة في تبويب «النظام» تحت بطاقة الدفع**، وتُحمَّل معها');
  t = await lic(L());
  ok(/رخص Pushover/.test(t) && /شغّالة/.test(t) && /8 رخصة/.test(t), 'شغّالة والرصيد من Pushover — ' + t.slice(0, 120));
  ok(/مستحقون ينتظرون الحين ?1/.test(t), 'وكم واحد ينتظر — ' + t.slice(0, 200));
  ok(/بعد 7 أيام من الدفع/.test(t) && /والهدية فوراً/.test(t) && /Purchase License Credits/.test(t),
     'وتقول متى تنضاف ومن وين تشتري الرصيد');
  ok(/s2@example\.com · هدية/.test(t) && /✅ انضافت/.test(t), 'والطلاب: إيميله · هدية · انضافت');
  ok(await page.$$eval('#poLicCard button[onclick*="\'retry\'"], #poLicCard button[onclick*="\'done\'"]', b => b.length) === 0,
     'شغّالة: بلا «أعد» ولا «تمّت»');

  /* موقوفة: الطالب المتوقف وسببه وزرّاه */
  const STOP = L({ state: 'stopped', waiting: 2, rows: [
    { user: U1, email: 's1@example.com', status: 'failed', source: 'paid', kind: 'rejected', credits: null,
      error: 'user: is invalid <img src=x onerror=alert(1)>', at: ago(5), doneAt: ago(5) }].concat(LB.rows.slice(0, 1)) });
  t = await lic(STOP);
  ok(/موقوفة — تحتاج نظرك/.test(t) && /Pushover رفضها/.test(t) && /user: is invalid/.test(t),
     '**موقوفة: مين وليش — بنصّهم**');
  ok(await page.$('#poLicCard img') === null, '**نص خطأ فيه وسم يُهرَّب**');
  ok(/Pushover ينصح ما نعيد لحالنا/.test(t), 'وتقول ليش وقّفنا ووش يسوي كل زر');
  ST.licNext = L(); ST.licCalls.length = 0;
  await page.evaluate(() => document.querySelector('#poLicCard button[onclick*="\'retry\'"]').click());
  await page.waitForTimeout(300);
  eq(ST.licCalls, [{ act: 'po-lic-retry', body: { userId: U1 } }], '«🔁 أعد»: يطلبها لهالطالب بالذات');
  t = await page.evaluate(() => document.getElementById('poLicCard').textContent.replace(/\s+/g, ' '));
  ok(/شغّالة/.test(t), 'والبطاقة ترسم رد السيرفر');
  await lic(STOP);
  ST.licCalls.length = 0;
  page.once('dialog', dg => dg.dismiss());
  await page.evaluate(() => document.querySelector('#poLicCard button[onclick*="\'done\'"]').click());
  await page.waitForTimeout(250);
  eq(ST.licCalls.length, 0, '«✔️ تمّت» يسأل قبل — ورفضت: ما صار شي');
  page.once('dialog', dg => dg.accept());
  await page.evaluate(() => document.querySelector('#poLicCard button[onclick*="\'done\'"]').click());
  await page.waitForTimeout(300);
  eq(ST.licCalls, [{ act: 'po-lic-done', body: { userId: U1 } }], 'ووافقت: «تمّت» لهالطالب');

  /* رخصة ثانية لطالب أخذها (غيّر حسابه أو جواله): بتأكيد — تنصرف رخصة */
  await lic(L());
  ST.licCalls.length = 0;
  page.once('dialog', dg => dg.dismiss());
  await page.evaluate(() => document.querySelector('#poLicCard button[onclick*="\'again\'"]').click());
  await page.waitForTimeout(250);
  eq(ST.licCalls.length, 0, '«رخصة ثانية» بتأكيد — ورفضت: ما انصرف شي');
  page.once('dialog', dg => dg.accept());
  await page.evaluate(() => document.querySelector('#poLicCard button[onclick*="\'again\'"]').click());
  await page.waitForTimeout(300);
  eq(ST.licCalls, [{ act: 'po-lic-retry', body: { userId: U2 } }], 'ووافقت: تنطلب له من جديد');
  ST.licCalls.length = 0;
  await page.evaluate(() => document.querySelector('#poLicCard button[onclick*="\'go\'"]').click());
  await page.waitForTimeout(300);
  eq(ST.licCalls, [{ act: 'po-lic-retry', body: {} }], '«▶️ كمّل الحين» بلا طالب — بعد ما تشتري');

  /* خلص الرصيد · الجدول ناقص · ما قرينا الرصيد · dev */
  t = await lic(L({ state: 'credits', credits: 0, rows: [] }));
  ok(/خلص الرصيد — تكمل لحالها بعد ما تشتري/.test(t) && /0 رخصة/.test(t), 'خلص الرصيد: تكمل لحالها بعد الشراء');
  t = await lic(L({ state: 'missing', table: 'missing', waiting: null, rows: [] }));
  ok(/الجدول ناقص — نفّذ أمر SQL «رخص Pushover»/.test(t) && !/ينتظرون/.test(t), 'الجدول ناقص: «نفّذ الـSQL»');
  t = await lic(L({ credits: null, creditsError: 'token: application token is invalid' }));
  ok(/ما قدرنا نقرأه — token: application token is invalid/.test(t), 'الرصيد ما انقرأ: يقول ليش');
  t = await lic(L({ live: false, state: 'dev', rows: STOP.rows }));
  ok(/من الإنتاج وحده/.test(t) && await page.$$eval('#poLicCard button[data-u]', b => b.length) === 0,
     'dev: «من الإنتاج وحده» وبلا أزرار');

  ok(errs.length === 0, 'بلا أخطاء JS — ' + errs.slice(0, 2).join(' | '));
  if (SHOT) {
    await lic(STOP);
    await page.evaluate(() => {
      const el = document.getElementById('poLicCard');
      document.body.innerHTML = ''; el.style.padding = '16px'; el.style.background = 'var(--bg)';
      document.body.appendChild(el); document.body.style.display = 'block';
    });
    await page.screenshot({ path: path.join(SHOT, 'admin-polic-stopped.png'), fullPage: true });
    await lic(L());
    await page.screenshot({ path: path.join(SHOT, 'admin-polic-on.png'), fullPage: true });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadPay === 'function', null, { timeout: 15000 }).catch(() => {});

    /* صورة البطاقة وحدها على مقاس الجوال — واللوحة ثيم واحد (داكن) */
    await card(last({ why: 'nosig', sigLen: 0, okAt: ago(90) }));
    await page.evaluate(() => {
      const el = document.getElementById('payCard');
      document.body.innerHTML = ''; el.style.padding = '16px'; el.style.background = 'var(--bg)';
      document.body.appendChild(el); document.body.style.display = 'block';
    });
    await page.screenshot({ path: path.join(SHOT, 'admin-pay-card.png'), fullPage: true });
    await card(last({ ok: true, why: 'ok', at: ago(0), json: true, status: 'Approved', type: 'Purchase', order: 'JDW-77' }));
    await page.screenshot({ path: path.join(SHOT, 'admin-pay-card-ok.png'), fullPage: true });
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
