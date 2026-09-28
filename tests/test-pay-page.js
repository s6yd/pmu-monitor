/* صفحة الدفع في ورقة الباقات — اختبار سلوكي في Chromium على مقاس جوال.

   أخطار يمسكها:
   ١) زر الدفع يشتغل والسيرفر قال مقفل (الفترة المجانية · dev · بلا مفاتيح).
   ٢) الدفع يبدأ بلا جوال — Paylink يرفضه، فالطالب يطلع بخطأ غامض.
   ٣) الصفحة تودّي الطالب لأي رابط يرجع — لازم صفحة Paylink وحدها.
   ٤) الرجوع من Paylink يُعتبر دفعاً — الصفحة لازم تسأل السيرفر.
   ٥) دفعة معلّقة قديمة تعلّق الطالب بلا مخرج (كمّلها · ألغها).
   ٦) نص خطأ من السيرفر يُعرض HTML.
   ٧) الورقة ما تقول أي ترم تبيع (لقاها محمد: «حتى 9 يونيو» بلا سنة ولا ترم،
      والشراء بعد ما ينقفل التسجيل يروح للترم الجاي)، ولا إن التنبيه الطارئ
      تطبيق ثاني تفعيله بعد الدفع — والمشتري ما يلقى وين يفعّله.

   node tests/test-pay-page.js [pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');
const SRC = fs.readFileSync(FILE, 'utf8');
const SHOTS = process.env.PAY_SHOTS || '';          /* مجلد الصور — للمراجعة البصرية فقط */

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* السيرفر المزيّف: كل اختبار يضبط ردوده */
const ST = { quote: null, checkout: null, pay: [], cancel: null, posts: [], heads: [], pays: 0, ms: null, ai: null };
/* حالة الصفحة كما يرجّعها السيرفر — القسم ٩ يزيد عليها ترم الشراء والتنبيه الطارئ */
const MS = { term: '202710', freeBeta: false, canWatch: false,
  build: '"x"', plans: { termHalalas: 1900, pushoverHalalas: 1000, freeMonitors: 2, freeSchedules: 1,
    termEnd: '2027-06-15T20:59:59.000Z' } };
const msWith = (plans, extra) => Object.assign({}, MS, { plans: Object.assign({}, MS.plans, plans) }, extra || {});
const baseQuote = over => Object.assign({ ok: true, includesTerm: true, pushover: false, base: 1900,
  po: 0, discount: 0, credit: 0, amount: 1900, ref: null, creditAvailable: 0, term: '202720',
  termEnd: '2027-06-15T20:59:59.000Z', late: false, belowMin: false,
  pay: { open: true, why: '', msg: '' }, phone: null }, over || {});

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const json = (o, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) };
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(SRC);
  }
  if (u === '/plans.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
  }
  if (u === '/api/monitor-status') return json(ST.ms || MS);
  if (u.startsWith('/api/me/')) {
    let body = '';
    req.on('data', c => { body += c });
    return req.on('end', () => {
      ST.heads.push(String(req.headers.authorization || ''));
      if (u === '/api/me/quote') return json(ST.quote || baseQuote());
      if (u === '/api/me/checkout') { ST.posts.push(JSON.parse(body || '{}')); return json(ST.checkout) }
      if (u === '/api/me/pay-cancel') { ST.posts.push(JSON.parse(body || '{}')); return json(ST.cancel) }
      if (u === '/api/me/pay') { ST.pays++; return json(ST.pay.length > 1 ? ST.pay.shift() : ST.pay[0]) }
      if (u === '/api/me/account') return json({ ok: true, active: false, credit: { available: 0 }, invite: { code: 'ABC234', paidFriends: 0 } });
      if (u === '/api/me/ai') return json(ST.ai || { ok: true });
      return json({ ok: true });
    });
  }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ courses: [], cached: false, age: 0 }));
});

const sbStub = 'window.supabase={createClient:()=>({' +
  'auth:{getSession:async()=>({data:{session:{access_token:"tok-pay-123456789012345678901234567890",' +
  'user:{id:"u-me",email:"me@x.com",user_metadata:{name:"Me"}}}}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),' +
  'signInWithOAuth:async()=>({}),signOut:async()=>({})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},in(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  /* ملف الطالب: الأساسي، وفوقه ما يضبطه الاختبار في window.__P (تلقرام · الإضافة) */
  'upsert(){return this},single(){return Promise.resolve({data:Object.assign({id:"u-me",major:"COSC"},window.__P||{}),error:null})},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

async function open(browser, scheme, query, prof) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme || 'dark' });
  if (prof) await ctx.addInitScript(p => { window.__P = p }, prof);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => { errs.push('DIALOG:' + d.message()); d.dismiss().catch(() => {}) });
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: sbStub }));
  /* صفحة Paylink المزيّفة: نثبت إن الطالب انودّى لها فعلاً */
  await page.route('https://payment.paylink.sa/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Paylink</h1>' }));
  await page.route('https://evil.example.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>evil</h1>' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/${query || ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.openPlans === 'function', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { page, ctx, errs };
}
const sheet = async (page) => {
  await page.evaluate(() => openPlans());
  await page.waitForTimeout(450);
};
const btn = page => page.evaluate(() => {
  const b = document.getElementById('psPay');
  return b ? { dis: b.disabled, txt: b.textContent.trim() } : null;
});
const phoneShown = page => page.evaluate(() => {
  const b = document.getElementById('psPhoneBox');
  return !!b && !b.hidden && getComputedStyle(b).display !== 'none';
});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }) };

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();

  /* ── ١) السيرفر قال مقفل ⇒ الزر مقفل بسببه ── */
  for (const [why, re] of [['beta', /الفترة المجانية/], ['nokeys', /قريباً/], ['test', /لصاحب الموقع/]]) {
    ST.quote = baseQuote({ pay: { open: false, why, msg: '' } });
    const { page, ctx, errs } = await open(browser);
    await sheet(page);
    const b = await btn(page);
    ok(b && b.dis && re.test(b.txt), `مقفل (${why}): الزر مقفل ويقول ليش — ${JSON.stringify(b)}`);
    eq(await phoneShown(page), false, `مقفل (${why}): ولا حقل جوال`);
    ST.posts = [];
    await page.evaluate(() => payStart());
    eq(ST.posts.length, 0, `مقفل (${why}): ولا طلب دفع ولو نودي بنفسه`);
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٢) مفتوح: الجوال إلزامي، ثم نودّيه لصفحة Paylink ── */
  for (const scheme of ['dark', 'light']) {
    ST.quote = baseQuote(); ST.posts = []; ST.heads = [];
    ST.checkout = { ok: true, url: 'https://payment.paylink.sa/pay/order/7001234', id: 101, amount: 1900 };
    const { page, ctx, errs } = await open(browser, scheme);
    await sheet(page);
    let b = await btn(page);
    ok(b && !b.dis && /19/.test(b.txt) && /ادفع/.test(b.txt), 'الزر يقول كم يدفع — ' + JSON.stringify(b));
    eq(await phoneShown(page), true, 'وحقل الجوال ظاهر');
    const fs16 = await page.evaluate(() => getComputedStyle(document.getElementById('psPhone')).fontSize);
    eq(fs16, '16px', '**حقل الجوال ١٦px** — أصغر منه يزوّم سفاري الآيفون ولا يرجع');
    await shot(page, 'pay-sheet-' + scheme);
    if (scheme === 'dark') {
      await page.click('#psPay');
      await page.waitForTimeout(300);
      eq(ST.posts.length, 0, '**بلا جوال: ما نبدأ** — Paylink يشترطه');
      ok(/جوالك/.test(await page.textContent('#psMsg')), 'ونقول له يكتبه');
      await shot(page, 'pay-phone-missing');
    }
    await page.fill('#psPhone', '0512345678');
    await Promise.all([page.waitForURL(/payment\.paylink\.sa/, { timeout: 5000 }).catch(() => {}), page.click('#psPay')]);
    ok(/^https:\/\/payment\.paylink\.sa\/pay\/order\/7001234/.test(page.url()), '**انودّى لصفحة Paylink** — ' + page.url());
    eq(ST.posts[0], { pushover: false, ref: '', phone: '0512345678' }, 'بطلب فيه الجوال فقط — لا معرّف ولا مبلغ من الصفحة');
    ok(ST.heads.some(h => h === 'Bearer tok-pay-123456789012345678901234567890'), 'وبرمز الجلسة');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٣) رابط مو من Paylink: ما نودّيه ── */
  {
    ST.quote = baseQuote({ phone: '0512345678' });
    ST.checkout = { ok: true, url: 'https://evil.example.com/steal', id: 102 };
    const { page, ctx } = await open(browser);
    await sheet(page);
    eq(await page.inputValue('#psPhone'), '0512345678', 'الجوال المحفوظ يتعبّى تلقائياً');
    await page.click('#psPay');
    await page.waitForTimeout(700);
    ok(!/evil/.test(page.url()), '**رابط غير Paylink: ما نودّي الطالب له** — ' + page.url());
    await ctx.close();
  }

  /* ── ٤) الرصيد يغطي الكل: تفعيل بلا جوال ولا Paylink ── */
  {
    ST.quote = baseQuote({ credit: 1900, amount: 0, creditAvailable: 5000 }); ST.posts = [];
    ST.checkout = { ok: true, activated: true, until: '2027-06-15T20:59:59.000Z', id: 103 };
    const { page, ctx, errs } = await open(browser);
    await sheet(page);
    const b = await btn(page);
    ok(b && !b.dis && /رصيدك/.test(b.txt), 'الزر: فعّل برصيدك — ' + JSON.stringify(b));
    eq(await phoneShown(page), false, 'وبلا حقل جوال');
    await page.click('#psPay');
    await page.waitForTimeout(700);
    const t = await page.textContent('#planSheet');
    ok(/تم الدفع/.test(t) && /2027/.test(t), 'النتيجة: فعّال وحتى متى — ' + t.replace(/\s+/g, ' ').slice(0, 80));
    eq(await page.evaluate(() => !document.getElementById('planSheet').hidden), true,
       '**والنتيجة ما تختفي** (مؤقّت إغلاق الورقة كان يسبقها)');
    await shot(page, 'pay-credit-done');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٥) دفعة معلّقة: كمّلها أو ألغها ── */
  {
    ST.quote = baseQuote({ phone: '0512345678' }); ST.posts = [];
    ST.checkout = { ok: false, why: 'pending', id: 55, url: 'https://payment.paylink.sa/pay/order/55', amount: 1900,
                    error: 'عندك دفعة ما كملت' };
    ST.cancel = { ok: true, id: 55, status: 'failed' };
    const { page, ctx, errs } = await open(browser);
    await sheet(page);
    await page.click('#psPay');
    await page.waitForTimeout(500);
    const href = await page.getAttribute('#psMsg a', 'href');
    eq(href, 'https://payment.paylink.sa/pay/order/55', 'رابط يكمّل منه');
    await shot(page, 'pay-pending-box');
    await page.click('#psMsg button');
    await page.waitForTimeout(600);
    eq(ST.posts[ST.posts.length - 1], { id: 55 }, 'الإلغاء برقم الطلب وحده');
    ok(/انلغت/.test(await page.textContent('#psMsg')), 'ويقول له انلغت ويقدر يبدأ');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٦) نص خطأ السيرفر يُهرَّب ── */
  {
    ST.quote = baseQuote({ phone: '0512345678' });
    ST.checkout = { ok: false, error: '<img src=x onerror=alert(1)>فشل' };
    const { page, ctx, errs } = await open(browser);
    await sheet(page);
    await page.click('#psPay');
    await page.waitForTimeout(500);
    ok(await page.$('#psMsg img') === null, 'خطأ فيه وسم يُهرَّب');
    eq(errs, [], 'ولا نافذة تنبيه');
    await ctx.close();
  }

  /* ── ٧) الرجوع من Paylink: نسأل السيرفر ── */
  for (const scheme of ['dark', 'light']) {
    ST.pay = [{ ok: true, id: 77, status: 'paid', until: '2027-06-15T20:59:59.000Z', amount: 1900 }]; ST.pays = 0;
    const { page, ctx, errs } = await open(browser, scheme, '?pay=77&transactionNo=7001234');
    await page.waitForTimeout(900);
    ok(ST.pays >= 1, '**الرجوع يسأل السيرفر** — ما يعتبره دفعاً بنفسه');
    const t = await page.textContent('#planSheet').catch(() => '');
    ok(/تم الدفع/.test(t), 'مدفوع: «تم الدفع» — ' + String(t).replace(/\s+/g, ' ').slice(0, 60));
    ok(!/pay=/.test(page.url()), 'والرابط تنظّف — تحديث الصفحة ما يعيد السؤال');
    await shot(page, 'pay-return-paid-' + scheme);
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }
  {
    /* معلّق مرتين ثم مدفوع: الصفحة تعيد السؤال قبل ما تقول «ننتظر» */
    ST.pay = [{ ok: true, id: 78, status: 'pending' }, { ok: true, id: 78, status: 'pending' },
              { ok: true, id: 78, status: 'paid', until: '2027-06-15T20:59:59.000Z' }]; ST.pays = 0;
    const { page, ctx } = await open(browser, 'dark', '?pay=78');
    await page.waitForTimeout(6200);
    ok(/تم الدفع/.test(await page.textContent('#planSheet').catch(() => '')),
       '**الإشعار يسبق الطالب بثوانٍ: نعيد السؤال مرتين ثلاث** — ' + ST.pays);
    await ctx.close();
  }
  {
    ST.pay = [{ ok: true, id: 79, status: 'pending' }]; ST.pays = 0;
    const { page, ctx } = await open(browser, 'light', '?pay=79');
    await page.waitForTimeout(6200);
    const t = await page.textContent('#planSheet').catch(() => '');
    ok(/ننتظر تأكيد الدفع/.test(t), 'ما وصل تأكيد: «ننتظر» لا «تم»');
    await shot(page, 'pay-return-pending');
    ST.pay = [{ ok: true, id: 79, status: 'paid', until: '2027-06-15T20:59:59.000Z' }];
    await page.click('#planSheet .ps-pay');
    await page.waitForTimeout(700);
    ok(/تم الدفع/.test(await page.textContent('#planSheet')), 'و«حدّث الحالة» يعيد السؤال');
    await ctx.close();
  }
  {
    ST.pay = [{ ok: true, id: 80, status: 'failed' }];
    const { page, ctx } = await open(browser, 'dark', '?pay=80');
    await page.waitForTimeout(900);
    const t = await page.textContent('#planSheet').catch(() => '');
    ok(/ما تم الدفع/.test(t) && /جرّب مرة ثانية/.test(t), 'ما تم: يقولها ومعها «جرّب مرة ثانية»');
    await shot(page, 'pay-return-failed');
    await ctx.close();
  }

  /* ── ٨) ‎?plans=1‎ يفتح الورقة مباشرة ── وقت الفترة المجانية ما فيه زر «الباقات» */
  {
    ST.quote = baseQuote({ pay: { open: true, why: '', msg: '' } });
    const { page, ctx, errs } = await open(browser, 'dark', '?plans=1');
    await page.waitForTimeout(700);
    eq(await page.evaluate(() => { const e = document.getElementById('planSheet'); return !!e && !e.hidden }), true,
       '**‎?plans=1‎ يفتح ورقة الباقات** — مدخل تجربة الدفع وقت الفترة المجانية');
    const b = await btn(page);
    ok(b && !b.dis && /ادفع/.test(b.txt), 'وزر الدفع حسب ما قاله السيرفر');
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }

  /* ── ٩) الورقة تقول وش تبيع — لقاها محمد: «حتى 9 يونيو» بلا سنة ولا ترم، والتنبيه
     الطارئ ما يقول إنه تطبيق ثاني ولا إن تفعيله بعد الدفع. ومن اشتراه يلقى وين يفعّله ── */
  const PO = { mode: 'addon', url: 'https://pushover.net/subscribe/Jadwalik-test' };
  const text = async page => ((await page.textContent('#planSheet').catch(() => '')) || '').replace(/\s+/g, ' ');
  for (const scheme of ['dark', 'light']) {
    ST.quote = baseQuote(); ST.ms = msWith({ pushoverOffered: true, termCode: '202720' }, { pushover: PO });
    const { page, ctx, errs } = await open(browser, scheme);
    await sheet(page);
    const t = await text(page);
    ok(/من اليوم حتى 15 يونيو 2027/.test(t), `**التاريخ بالسنة ومن اليوم** (${scheme}) — ` + t.slice(0, 180));
    /* قطع الاتجاه (عربي + أرقام) يقسم الصندوق قطعاً على نفس السطر — نقيس السطور لا القطع */
    eq(await page.evaluate(() => { const r = document.querySelector('#psEnd span');
         return !!r && new Set([...r.getClientRects()].map(x => Math.round(x.top))).size === 1 }), true,
       'والتاريخ ما ينقسم سطرين');
    ok(/يشمل تسجيل ربيع 2026\/2027/.test(t), '**وأي ترم يشمل تسجيله**');
    ok(/Jadwalik AI كامل/.test(t), 'والمساعد من ميزات الاشتراك');
    ok(/عبر تطبيق Pushover/.test(t) && /خطوات تفعيله توصلك بعد الدفع/.test(t),
       '**التنبيه الطارئ: تطبيق Pushover، وخطوات تفعيله بعد الدفع**');
    await page.evaluate(() => { const c = document.getElementById('psPo'); c.checked = true; c.onchange() });
    await page.waitForTimeout(300);
    await shot(page, 'plans-details-' + scheme);
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }
  {
    /* ترم السعر هو اللي ينباع — لو حالة الصفحة قديمة يغلب */
    ST.quote = baseQuote({ term: '202730', termEnd: '2027-08-20T20:59:59.000Z' });
    ST.ms = msWith({ termCode: '202720' });
    const { page, ctx } = await open(browser);
    await sheet(page);
    const t = await text(page);
    ok(/يشمل تسجيل صيف 2026\/2027/.test(t) && /حتى 20 أغسطس 2027/.test(t), 'ترم السعر يغلب حالة الصفحة — ' + t.slice(0, 180));
    await ctx.close();
  }
  {
    /* المساعد مطفأ: ما نعد به */
    ST.quote = baseQuote(); ST.ms = null; ST.ai = { on: false, why: 'off' };
    const { page, ctx } = await open(browser);
    await sheet(page);
    ok(!/Jadwalik AI/.test(await text(page)), 'المساعد مطفأ: الورقة ما تذكره');
    ST.ai = null;
    await ctx.close();
  }
  const until = '2027-06-15T20:59:59.000Z';
  const buyer = { telegram_chat_id: '6010', pushover_until: until };
  for (const scheme of ['dark', 'light']) {
    /* دفع مع التنبيه الطارئ: زر التفعيل يودّيه للبطاقة */
    ST.ms = msWith({ pushoverOffered: true, termCode: '202720' }, { pushover: PO });
    ST.pay = [{ ok: true, id: 79, status: 'paid', until, amount: 2900, pushover: true }];
    const { page, ctx, errs } = await open(browser, scheme, '?pay=79', buyer);
    await page.waitForTimeout(900);
    const t = await text(page);
    ok(/فعّل التنبيه الطارئ الحين/.test(t), `**بعد الدفع: زر «فعّل التنبيه الطارئ»** (${scheme}) — ` + t.slice(0, 160));
    ok(/إيصالك وصلك على تلقرام/.test(t), 'ويقول وين الإيصال');
    await shot(page, 'pay-return-pushover-' + scheme);
    await page.click('text=فعّل التنبيه الطارئ الحين');
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => document.getElementById('pageSet').classList.contains('active')), '**والزر يفتح الإعدادات**');
    ok(/تفعيل/.test(await page.textContent('#poRow')), '**على بطاقة التفعيل نفسها**');
    await page.waitForTimeout(700);
    eq(await page.evaluate(() => document.getElementById('guideOverlay').classList.contains('open')), false,
       '**ودليل أول زيارة ما يغطّيها** — كان يفتح فوقها في جهاز جديد');
    await shot(page, 'pay-pushover-card-' + scheme);
    eq(errs, [], 'بلا أخطاء');
    await ctx.close();
  }
  {
    /* بلا الإضافة: ما فيه زر ولا وعد */
    ST.ms = null; ST.pay = [{ ok: true, id: 80, status: 'paid', until, amount: 1900, pushover: false }];
    const { page, ctx } = await open(browser, 'dark', '?pay=80');
    await page.waitForTimeout(900);
    const t = await text(page);
    ok(/تم الدفع/.test(t) && !/فعّل التنبيه الطارئ/.test(t), 'بلا الإضافة: ما فيه زر تفعيل');
    ok(!/إيصالك/.test(t), 'وبلا تلقرام مربوط: ما نقول «وصلك على تلقرام»');
    await ctx.close();
  }
  {
    /* رابط الإيصال ‎?pushover=1‎ */
    ST.ms = msWith({ pushoverOffered: true }, { pushover: PO });
    const { page, ctx, errs } = await open(browser, 'dark', '?pushover=1', buyer);
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => document.getElementById('pageSet').classList.contains('active')),
       '**رابط الإيصال يفتح الإعدادات على بطاقة التفعيل**');
    ok(/تفعيل/.test(await page.textContent('#poRow')), 'والبطاقة ظاهرة فيها «تفعيل»');
    eq(await page.evaluate(() => document.getElementById('guideOverlay').classList.contains('open')), false,
       'ودليل أول زيارة ما يغطّيها');
    ok(!/pushover=1/.test(page.url()), 'والرابط تنظّف');
    eq(errs, [], 'بلا أخطاء');
    ST.ms = null;
    await ctx.close();
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
