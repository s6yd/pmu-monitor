/* بوابة Pushover وتدفّق الاشتراك — اختبار سلوكي في Chromium.
   يقيس: من يشوف الزر، وشكل رابط التوجيه، والتحقق من الرمز عند الرجوع.

   node tests/test-pushover-gate.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');
const SUB = 'https://pushover.net/subscribe/Jadwalik-f504h08fhlasdfj';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(FILE));
  }
  /* /calendar.js صار يُطلب من الصفحة — ما نرد عليه بـJSON فيُنفَّذ كسكربت */
  /* الصفحة صارت تحمّل الخطط من /plans.js — نخدم الملف الحقيقي.
     تغيير بنية لا تسهيل: قبله كان المحاكي يرد 404 على كل .js، فالصفحة
     تفقد PLANS وتبويب خطتي يعرض رسالة العطل بدل الخطة. */
  if (req.url.split('?')[0] === '/plans.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
  }
  if (req.url.split('?')[0].endsWith('.js')) { res.writeHead(404); return res.end('') }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ courses: [], cached: false, age: 0 }));
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.__upd=null;window.supabase={createClient:()=>({' +
          'auth:{getSession:async()=>({data:{session:null}}),' +
          'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
          'from:()=>({select(){return this},eq(){return this},order(){return this},' +
          'limit(){return this},insert(){return this},delete(){return this},' +
          'update(v){window.__upd=v;return {eq:async()=>({data:[v],error:null})}},' +
          'then:(f)=>f({data:[],error:null})}),' +
          'channel:()=>({on(){return this},subscribe(){return this}}),' +
          'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};'
  }));

  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.poVisible === 'function',
    null, { timeout: 15000 }).catch(() => {});

  const ready = await page.evaluate(() => typeof poVisible === 'function');
  ok(ready, 'دوال Pushover موجودة');
  if (!ready) { console.log('SETUP FAILED', errs.slice(0, 3)); await browser.close(); server.close(); process.exit(1) }

  /* الوسيط الثاني: هل عنده إضافة التنبيه الطارئ؟ (كان: هل هو مشترك —
     لكن التنبيه الطارئ إضافة بسعرها لا جزء من اشتراك الترم) */
  const vis = (conf, addon) => page.evaluate(([c, a]) => {
    MON_STATE = { pushover: c };
    window.isPro = () => true;                 /* مشترك في الترم دائماً هنا */
    PROFILE = a ? { pushover_until: new Date(Date.now() + 864e5).toISOString() } : {};
    return poVisible();
  }, [conf, addon]);

  /* ── ١) البوابة ── */
  ok((await vis(null, true)) === false, 'مطفأة: ما يشوفها أحد');
  ok((await vis({ mode: 'off', url: SUB }, true)) === false, 'off: مخفيّة');
  ok((await vis({ mode: 'all', url: SUB }, false)) === true, 'all: للجميع');
  ok((await vis({ mode: 'addon', url: SUB }, true)) === true, 'addon: لمن اشترى الإضافة');
  ok((await vis({ mode: 'addon', url: SUB }, false)) === false,
     'addon: مشترك الترم بلا الإضافة ما تنفتح له');
  ok((await vis({ mode: 'all', url: '' }, true)) === false,
     'بلا رابط اشتراك: مخفية مهما كان الوضع');

  /* ── ٢) link لا يظهر إلا لمن فُتح له ── */
  {
    await page.evaluate(() => { try { localStorage.removeItem('jdw_po_unlock') } catch (e) {} });
    ok((await vis({ mode: 'link', url: SUB }, true)) === false,
       'link: مخفية قبل الفتح');
    const after = await page.evaluate(([c]) => {
      history.replaceState({}, '', '/?pushover=1');
      poCheckUnlock();
      MON_STATE = { pushover: c };
      return { vis: poVisible(), url: location.search };
    }, [{ mode: 'link', url: SUB }]);
    ok(after.vis === true, 'link: ظهرت بعد ‎?pushover=1‎');
    ok(!/pushover=1/.test(after.url), 'والمعامل انمسح من الرابط');
    const again = await page.evaluate(([c]) => {
      MON_STATE = { pushover: c }; return poVisible();
    }, [{ mode: 'link', url: SUB }]);
    ok(again === true, 'وتبقى مفتوحة بعدها على نفس الجهاز');
  }

  /* ── ٣) رابط التوجيه ── */
  {
    /* ندع التوجيه يحصل فعلاً ونلتقطه على الشبكة — أصدق من محاكاة location */
    let dest = '';
    await page.route('https://pushover.net/**', r => {
      dest = r.request().url();
      return r.abort();
    });
    await page.evaluate(([c]) => {
      MON_STATE = { pushover: c };
      try { localStorage.removeItem('jdw_po_nonce') } catch (e) {}
      poStart();
    }, [{ mode: 'all', url: SUB }]);
    for (let i = 0; i < 40 && !dest; i++) await page.waitForTimeout(100);
    await page.unroute('https://pushover.net/**');

    /* نرجع للصفحة لنقرأ ما خُزّن — التخزين يبقى على نفس الأصل */
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof poVisible === 'function',
      null, { timeout: 15000 }).catch(() => {});
    const nonce = await page.evaluate(() => {
      try { return localStorage.getItem('jdw_po_nonce') || '' } catch (e) { return '' }
    });

    ok(dest.startsWith(SUB + '?'), 'التوجيه لرابط الاشتراك — ' + dest.slice(0, 70));
    ok(/[?&]success=/.test(dest) && /[?&]failure=/.test(dest),
       'ومعه success و failure');
    ok(nonce.length >= 24, 'ورمز عشوائي محفوظ محلياً — طوله ' + nonce.length);
    const sp = new URL(dest || SUB).searchParams;
    const succ = sp.get('success') || '';
    ok(succ.includes('rand=' + nonce), 'والرمز داخل رابط النجاح');
    ok(succ.startsWith('http://127.0.0.1'), 'ورابط النجاح على نفس الأصل');
    ok((sp.get('failure') || '').startsWith('http://127.0.0.1'),
       'ورابط الرفض كذلك');
  }

  /* ── ٤) الرجوع: الرمز الصحيح يحفظ المفتاح ── */
  {
    const r = await page.evaluate(async () => {
      window.__upd = null;
      USER = { id: 'u1' }; PROFILE = {};
      window.showToast = (m) => { window.__toast = m };
      window.renderSettings = () => {};
      localStorage.setItem('jdw_po_nonce', 'abc123');
      history.replaceState({}, '', '/?rand=abc123&pushover_user_key=KEY123');
      await poHandleReturn();
      return { upd: window.__upd, search: location.search,
               nonce: localStorage.getItem('jdw_po_nonce'), toast: window.__toast };
    });
    ok(r.upd && r.upd.pushover_key === 'KEY123', 'المفتاح انحفظ');
    ok(!/pushover_user_key|rand=/.test(r.search), 'والرابط انتظّف');
    ok(r.nonce === null, 'والرمز انمسح — يُستعمل مرة واحدة');
  }

  /* ── ٥) رمز خاطئ: لا نحفظ شيئاً ── */
  {
    const r = await page.evaluate(async () => {
      window.__upd = null; USER = { id: 'u1' }; PROFILE = {};
      window.showToast = (m) => { window.__toast = m };
      localStorage.setItem('jdw_po_nonce', 'mine');
      history.replaceState({}, '', '/?rand=attacker&pushover_user_key=EVIL');
      await poHandleReturn();
      return { upd: window.__upd, toast: window.__toast };
    });
    ok(r.upd === null, 'رمز غير مطابق: المفتاح ما انحفظ');
    ok(/ما هو من عندك|originate/.test(String(r.toast)), 'وقيل للطالب إن الرابط مشبوه');
  }
  {
    const r = await page.evaluate(async () => {
      window.__upd = null; USER = { id: 'u1' }; PROFILE = {};
      window.showToast = () => {};
      try { localStorage.removeItem('jdw_po_nonce') } catch (e) {}
      history.replaceState({}, '', '/?rand=x&pushover_user_key=EVIL');
      await poHandleReturn();
      return window.__upd;
    });
    ok(r === null, 'بلا رمز محفوظ أصلاً: ما انحفظ شيء');
  }

  /* ── ٦) إلغاء الاشتراك يمسح المفتاح ── */
  {
    const r = await page.evaluate(async () => {
      window.__upd = null; USER = { id: 'u1' }; PROFILE = { pushover_key: 'OLD' };
      window.showToast = () => {}; window.renderSettings = () => {};
      localStorage.setItem('jdw_po_nonce', 'n2');
      history.replaceState({}, '',
        '/?rand=n2&pushover_user_key=&pushover_unsubscribed=1&pushover_unsubscribed_user_key=OLD');
      await poHandleReturn();
      return { upd: window.__upd, prof: PROFILE.pushover_key };
    });
    ok(r.upd && r.upd.pushover_key === null, 'الإلغاء يكتب null');
    ok(r.prof === null, 'والملف المحلي انحدّث');
  }

  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
