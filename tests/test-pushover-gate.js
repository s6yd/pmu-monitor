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

  /* ── ٣) «تفعيل»: الرابط من السيرفر (تذكرة #50 — توقّع تغيّر عمداً) ──
     كان رمزاً عشوائياً في تخزين هالمتصفح ورابط رجوع للصفحة نفسها، فالرجوع لازم يوصل نفس المتصفح وهو
     مسجّل — والتطبيق على الشاشة الرئيسية ومتصفح تلقرام الداخلي يرجعون لغيره فينرفض أو ينرمي بصمت.
     صار السيرفر يعطي الرابط (‎/api/me/pushover-start‎) ورجوعه لسيرفرنا برمز موقَّع لصاحب الجلسة —
     وشكل الرابط والرمز يثبتهما test-pushover-link على السيرفر نفسه */
  {
    /* ندع التوجيه يحصل فعلاً ونلتقطه على الشبكة — أصدق من محاكاة location.
       نردّ عليه بصفحة فاضية لا abort: القطع يفتح صفحة خطأ (chrome-error) توصل متأخرة تحت الحمل وتقاطع
       الرجوع تحت («interrupted by another navigation») — طاحت كذا في run-all مرتين. وننتظر ما وصل
       قبل ما نرجع */
    let dest = '';
    await page.route('https://pushover.net/**', r => {
      dest = r.request().url();
      return r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>pushover</body></html>' });
    });
    const RET = SUB + '?success=' + encodeURIComponent('http://127.0.0.1/api/pushover-return?t=T') + '&failure=x';
    await page.evaluate(([c, u]) => {
      MON_STATE = { pushover: c };
      USER = { id: 'u1' };
      try { localStorage.removeItem('jdw_po_nonce'); localStorage.removeItem('__mf') } catch (e) {}
      /* التخزين يبقى على نفس الأصل بعد ما نرجع — فنسجّل النداء فيه */
      window.meFetch = async (p, m) => { localStorage.setItem('__mf', p + '|' + m); return { ok: true, url: u } };
      poStart();
    }, [{ mode: 'all', url: SUB }, RET]);
    for (let i = 0; i < 40 && !dest; i++) await page.waitForTimeout(100);
    await page.waitForURL(u => String(u).startsWith('https://pushover.net/'), { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('load').catch(() => {});
    await page.unroute('https://pushover.net/**');

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof poVisible === 'function',
      null, { timeout: 15000 }).catch(() => {});
    const st = await page.evaluate(() => {
      try { return { mf: localStorage.getItem('__mf') || '', nonce: localStorage.getItem('jdw_po_nonce') } }
      catch (e) { return {} }
    });
    ok(st.mf === '/api/me/pushover-start|POST', '**«تفعيل» يطلب الرابط من السيرفر** (/api/me/pushover-start) — ' + st.mf);
    ok(dest === RET, '**والتوجيه للرابط اللي رجّعه السيرفر نفسه** — ' + dest.slice(0, 60));
    ok(st.nonce === null, 'وما ينحفظ رمز في تخزين المتصفح — الرجوع ما يعتمد عليه');
  }
  /* الكود القديم يوجّه لـPushover فعلاً هنا: نلقّط التوجيه ونرجع، فيطلع ✗ لا انهيار */
  const home = async () => {
    await page.waitForTimeout(400);                 /* التوجيه ممكن ما ثبت لسا */
    await page.waitForLoadState('load').catch(() => {});
    if (page.url().startsWith(`http://127.0.0.1:${port}`)) return;
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof poVisible === 'function', null, { timeout: 15000 }).catch(() => {});
  };
  await page.route('https://pushover.net/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  /* زائر يضغط «تفعيل»: ندخّله أول، وعلامة ترجّعه للبطاقة بعد الدخول — لا توجيه لـPushover */
  {
    const r = await page.evaluate(async ([c]) => {
      MON_STATE = { pushover: c }; USER = null;
      window.__gsi = 0; window.googleSignIn = () => { window.__gsi++ };
      window.meFetch = async () => { window.__mfGuest = 1; return { ok: true, url: 'https://pushover.net/x' } };
      try { localStorage.removeItem('jdw_po_after_login') } catch (e) {}
      await poStart();
      return { gsi: window.__gsi, mf: !!window.__mfGuest, mark: !!localStorage.getItem('jdw_po_after_login'), href: location.href };
    }, [{ mode: 'all', url: SUB }]).catch(() => ({ gsi: 0, href: 'وجّه لـPushover' }));
    await home();
    ok(r.gsi === 1 && !r.mf && r.mark && r.href.startsWith('http://127.0.0.1'),
       '**زائر يضغط «تفعيل»: يدخّله بقوقل ويحفظ علامة يرجع بها للبطاقة** — كان يروح لـPushover ويرجع وينرمي مفتاحه بصمت');
  }
  /* رابط من السيرفر مو لـPushover · المساعد مطفأ: ما نوجّه */
  {
    const r = await page.evaluate(async ([c]) => {
      MON_STATE = { pushover: c }; USER = { id: 'u1' };
      window.showToast = (m) => { window.__toast = m };
      window.meFetch = async () => ({ ok: true, url: 'https://evil.example/subscribe' });
      await poStart();
      const a = { toast: window.__toast, href: location.href };
      window.meFetch = async () => ({ ok: false, why: 'off' });
      await poStart();
      return { a, b: { toast: window.__toast, href: location.href } };
    }, [{ mode: 'all', url: SUB }]).catch(() => ({ a: { href: 'وجّه لـPushover' }, b: {} }));
    await home();
    await page.unroute('https://pushover.net/**');
    ok(/ما ضبطت/.test(r.a.toast || '') && r.a.href.startsWith('http://127.0.0.1'),
       'رابط مو لـpushover.net: ما نوجّه له — «ما ضبطت»');
    ok(/مو متاح/.test(r.b.toast || ''), 'والتنبيه الطارئ مطفأ في السيرفر: «مو متاح الحين»');
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

  /* ── ٧) الرجوع القديم بلا دخول: كان ينرمي بصمت — الحين يقول له ── */
  {
    const r = await page.evaluate(async () => {
      window.__upd = null; USER = null; PROFILE = {};
      window.__toast = ''; window.showToast = (m) => { window.__toast = m };
      localStorage.setItem('jdw_po_nonce', 'n3');
      history.replaceState({}, '', '/?rand=n3&pushover_user_key=KEY456');
      await poHandleReturn();
      return { upd: window.__upd, toast: window.__toast };
    });
    ok(r.upd === null && /سجّل دخولك/.test(r.toast), '**رجع من Pushover وهو مو مسجّل: «سجّل دخولك وجرّب ثانية»** — كان صمتاً');
  }

  /* ── ٨) نتيجة الربط من السيرفر (‎?pushover=…‎) وزائر رابط الإيصال القديم — عند التحميل ── */
  const fresh = async q => {
    const p2 = await browser.newPage();
    await p2.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p2.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
        'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
        'from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},' +
        'then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),' +
        'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    p2.on('pageerror', e => errs.push(String(e)));
    await p2.addInitScript(() => { try { localStorage.setItem('pmu_seen_guide', 'true');
      localStorage.setItem('pmu_seen_welcome', 'true') } catch (e) {} });
    await p2.goto(`http://127.0.0.1:${port}/${q}`, { waitUntil: 'load' });
    await p2.waitForTimeout(1500);
    const v = await p2.evaluate(() => ({ toast: (document.getElementById('toast') || {}).textContent || '',
      search: location.search, auth: !!document.getElementById('authBack'),
      why: (document.getElementById('authWhy') || {}).textContent || '',
      mark: (() => { try { return !!localStorage.getItem('jdw_po_after_login') } catch (e) { return false } })() }));
    await p2.close();
    return v;
  };
  {
    const on = await fresh('?pushover=on');
    ok(/التنبيه الطارئ شغّال/.test(on.toast) && !/pushover=/.test(on.search),
       '**رجع من Pushover عبر السيرفر: «🔔 التنبيه الطارئ شغّال» — ولو في متصفح مو مسجّل فيه**، والرابط تنظّف');
    const ex = await fresh('?pushover=expired');
    ok(/انتهى/.test(ex.toast) && /الإعدادات/.test(ex.toast), 'ورابط منتهي: «انتهى — فعّله من الإعدادات»');
    const g = await fresh('?pushover=1');
    ok(g.auth && /عشان تفعّل التنبيه الطارئ/.test(g.why) && /بنفس حساب قوقل اللي دفعت منه/.test(g.why) && /Safari/.test(g.why) && g.mark,
       '**زائر جا من رابط الإيصال القديم: نافذة الدخول وفيها «عشان تفعّل التنبيه الطارئ: سجّل دخولك بنفس الحساب اللي دفعت منه» (و«افتح في Safari»)، وعلامة ترجّعه للبطاقة** — كانت صفحة عادية بلا شي — ' + g.why.slice(0, 60));
  }

  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
