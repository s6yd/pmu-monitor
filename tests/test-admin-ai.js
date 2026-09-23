/* بطاقة المساعد في لوحة التحكم — اختبار عرض حقيقي في Chromium.
   يستبدل نداءات /api/admin بردود ثابتة ويقيس ما يظهر ويُرسَل فعلاً.

   أربعة أخطار يمسكها:
   ١) البطاقة تعرض رقماً تحسبه بنفسها بدل ما يرجّعه السيرفر.
   ٢) اسم طالب أو جواب نموذج يُعرض بلا تهريب.
   ٣) زر يرسل حقلاً غلطاً فيسقط الإعداد بصمت.
   ٤) صنف CSS غير موجود، أو انهيار جافاسكربت عند فتح التبويب.

   node tests/test-admin-ai.js [مسار admin.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'admin.html');
const SRC = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const aiState = (over = {}) => Object.assign({
  mode: 'off', modes: ['off', 'admin', 'all'], ready: true, env: 'prod',
  model: 'claude-haiku-4-5', modelEnv: 'claude-haiku-4-5',
  modelCustom: false, modelKnown: true,
  caps: { day: 25, dayFree: 5, term: 200, monthSar: 200 },
  defaults: { day: 25, dayFree: 5, term: 200, monthSar: 200 },
  alerted: '', fails: 0, unlogged: 0,
  warm: { on: true, coolMin: 0, tries: 0, ok: 0, fail: 0, skipped: 0,
          lastMin: null, lastErr: null },
  spend: { monthSar: 12.5, todaySar: 1.25, questions: 431, pct: 6,
           byEnv: { prod: 12.1, dev: 0.4 } }
}, over);

const topState = (over = {}) => Object.assign({
  ym: '2026-09', truncated: false,
  top: [
    { id: 'u1', name: 'نورة', email: 'n@x.com', questions: 90, sar: 4.5,
      last: '2026-09-23', envs: { prod: 4.5 } },
    { id: 'u2', name: '<img src=x onerror=alert(1)>', email: 'x@x.com',
      questions: 40, sar: 2.0, last: '2026-09-20', envs: { prod: 2 } },
  ]
}, over);

function makeServer(st) {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/admin.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(SRC);
    }
    let body = '';
    req.on('data', c => { body += c });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.endsWith('/ai')) {
        if (req.method === 'POST') st.posts.push(JSON.parse(body || '{}'));
        return res.end(JSON.stringify(st.ai));
      }
      if (u.endsWith('/ai-top')) return res.end(JSON.stringify(st.top));
      if (u.endsWith('/ai-ping')) return res.end(JSON.stringify(st.ping));
      if (u.endsWith('/cache-warm')) {
        st.warms.push(req.method);
        return res.end(JSON.stringify(st.warm || { ok: true, term: '202710',
          pulls: [{ gender: 'M1', count: 900 }, { gender: 'F1', count: 800 }],
          aiReady: true }));
      }
      if (u.endsWith('/ai-ask')) {
        st.asks.push(JSON.parse(body || '{}'));
        return res.end(JSON.stringify(st.ask));
      }
      if (u.endsWith('/health')) return res.end(JSON.stringify({ monitorInfo: {} }));
      if (u.endsWith('/monitors')) return res.end(JSON.stringify({ monitors: [] }));
      if (u.endsWith('/users')) return res.end(JSON.stringify({ users: [] }));
      if (u.endsWith('/reviews')) return res.end(JSON.stringify({ reviews: [] }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
}

async function open(browser, st) {
  const server = makeServer(st);
  await new Promise(r => server.listen(0, r));
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.dismiss().catch(() => {}));   /* alert من حقن = فشل */
  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.evaluate(() => { sessionStorage.setItem('jdw_admin', 'x'.repeat(16)) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.renderAi === 'function',
    null, { timeout: 15000 }).catch(() => {});
  return { page, errs, close: () => server.close() };
}

const openAi = async page => {
  await page.click('.tab[data-p="ai"]');
  await page.waitForFunction(() => {
    const b = document.getElementById('aiBody');
    return b && !b.querySelector('.spinner');
  }, null, { timeout: 8000 }).catch(() => {});
};

(async () => {
  const browser = await chromium.launch();

  /* ── ١) التبويب يفتح ويعرض ما يرجّعه السيرفر ── */
  {
    const st = { ai: aiState(), top: topState(), posts: [], asks: [], warms: [],
                 ping: { ok: true, model: 'claude-haiku-4-5', ms: 300 },
                 ask: { ok: true, answer: 'تمام' } };
    const { page, errs, close } = await open(browser, st);
    ok(await page.$('.tab[data-p="ai"]') !== null, 'تبويب المساعد موجود');
    await openAi(page);
    const t = await page.textContent('#aiBody');

    ok(/12\.5/.test(t), 'إنفاق الشهر كما رجّعه السيرفر — لا حساب في اللوحة');
    ok(/1\.25/.test(t), 'وإنفاق اليوم');
    ok(/431/.test(t), 'وعدد الأسئلة');
    ok(/6%/.test(t), 'والنسبة من السقف');
    ok(/claude-haiku-4-5/.test(t), 'واسم النموذج');
    ok(/من Render/.test(t), 'ومصدره');
    ok(/off/.test(t) && /مقفل/.test(t), 'والوضع بالعربي');
    ok(/prod 12\.1/.test(t) && /dev 0\.4/.test(t),
       'والإنفاق مفصول بين البيئتين — فاتورة واحدة وسقف واحد');
    ok(/25/.test(t) && /200/.test(t), 'والسقوف');
    ok(/ما أُرسل/.test(t), 'وحالة تنبيه ٧٥٪');
    /* الأزرار الأربعة */
    for (const fn of ['aiSetMode()', 'aiSetModel()', 'aiSetCaps()',
                      'aiPingBtn()', 'aiWarmBtn()'])
      ok(await page.$(`#aiBody button[onclick="${fn}"]`) !== null, `زر ${fn}`);
    /* أكثر ١٠ طلاب */
    ok(/نورة/.test(t), 'أكثر الطلاب: الاسم');
    ok(/4\.5 ريال/.test(t), 'ومبلغه بالريال');
    ok(/90/.test(t), 'وعدد أسئلته');
    ok(/2026-09-23/.test(t), 'وآخر سؤال');
    /* الحقن: الاسم يُعرض نصاً لا HTML */
    ok(await page.$('#aiBody img') === null,
       '**اسم فيه وسم HTML يُهرَّب** — ما انزرع عنصر');
    ok(/onerror/.test(t), 'ويظهر كنص عادي');
    eq(errs, [], 'ولا خطأ جافاسكربت عند فتح التبويب');
    await page.close(); close();
  }

  /* ── ٢) الحالات الحرجة تبين ── */
  {
    const st = { ai: aiState({ ready: false, mode: 'all', modelKnown: false,
                   modelCustom: true, model: 'نموذج-جديد', alerted: '2026-09',
                   fails: 3, unlogged: 2,
                   spend: { monthSar: 205, todaySar: 9, questions: 9000, pct: 102,
                            byEnv: { prod: 205 } } }),
                 top: topState({ truncated: true }), posts: [], asks: [], warms: [],
                 ping: {}, ask: {} };
    const { page, errs, close } = await open(browser, st);
    await openAi(page);
    const t = await page.textContent('#aiBody');
    ok(/ANTHROPIC_API_KEY ناقص/.test(t), 'المفتاح الناقص يظهر صريحاً');
    ok(/سعره مجهول/.test(t), 'ونموذج مجهول السعر ينبّه');
    ok(/من اللوحة/.test(t), 'ومصدر النموذج يتبدّل');
    ok(/أُرسل لشهر 2026-09/.test(t), 'وتنبيه ٧٥٪ المُرسل');
    ok(/3/.test(t), 'والنداءات الفاشلة');
    ok(/استهلاك ما انكتب/.test(t), 'واستهلاك ما انكتب سطره — فلوس ما انحسبت');
    ok(/مقصوصة عند ١٠٠٠/.test(t), 'وقصّ القائمة عند حد Supabase');
    /* النسبة فوق ١٠٠ تُقصّ في الشريط لا في الرقم */
    ok(/100%/.test(t) && /205/.test(t), 'النسبة تُعرض ١٠٠٪ والمبلغ الحقيقي كما هو');
    const cls = await page.$eval('#aiBody .kpi-num.bad', e => e.className).catch(() => '');
    ok(/bad/.test(cls), 'ولون التحذير عند تجاوز السقف');
    eq(errs, [], 'بلا أخطاء');
    await page.close(); close();
  }

  /* ── ٣) الأزرار ترسل الحقول الصحيحة ── */
  {
    const st = { ai: aiState(), top: topState(), posts: [], asks: [], warms: [],
                 ping: { ok: false, error: 'model: not_found', type: 'not_found_error' },
                 ask: {} };
    const { page, errs, close } = await open(browser, st);
    await openAi(page);
    await page.evaluate(() => { window.prompt = () => 'all' });
    await page.click('#aiBody button[onclick="aiSetMode()"]');
    await page.waitForTimeout(250);
    eq(st.posts[0], { mode: 'all' }, 'تبديل الوضع يرسل mode وحده');

    await page.evaluate(() => { window.prompt = () => 'claude-sonnet-5' });
    await page.click('#aiBody button[onclick="aiSetModel()"]');
    await page.waitForTimeout(250);
    eq(st.posts[1], { model: 'claude-sonnet-5' }, 'وتغيير النموذج يرسل model وحده');

    await page.evaluate(() => {
      let n = 0; const v = ['30', '6', '300', '250'];
      window.prompt = () => v[n++];
    });
    await page.click('#aiBody button[onclick="aiSetCaps()"]');
    await page.waitForTimeout(300);
    eq(st.posts[2], { caps: { day: 30, dayFree: 6, term: 300, monthSar: 250 } },
       'والسقوف أرقاماً لا نصوصاً');

    /* ملء الكاش: فعل إداري بضغطة — أدوات الشعب على dev كاشها بارد */
    await page.click('#aiBody button[onclick="aiWarmBtn()"]');
    await page.waitForTimeout(350);
    eq(st.warms, ['POST'], 'زر ملء الكاش يرسل POST — فعل لا قراءة');

    ok(/900|1700|جاهز/.test(await page.textContent('#toast').catch(() => '')),
       'ويعرض كم شعبة وصلت');
    /* ── مفتاح تسخين الكاش عند سؤال الطالب ── */
    ok(/تسخين الكاش عند السؤال/.test(await page.textContent('#aiBody')),
       'حالة التسخين معروضة في اللوحة');
    ok(/مفعّل/.test(await page.textContent('#aiBody')), 'وتقول إنه مفعّل');
    ok(await page.$('button:has-text("أطفئ التسخين")') !== null,
       '**والزر يعرض الفعل لا الحالة** — «أطفئ» وهو مفعّل');
    /* الصفحة تستعمل confirm — نستبدلها كما تُستبدل prompt في الأعلى،
       لأن معالج الحوارات العام يرفض كل شي (alert من حقن = فشل). */
    await page.evaluate(() => { window.confirm = () => true });
    await page.click('button:has-text("أطفئ التسخين")');
    await page.waitForTimeout(350);
    const wp = st.posts.filter(x => x && 'warm' in x);
    eq(wp.length, 1, 'الضغط يرسل تبديل التسخين مرة');
    eq(wp[0].warm, false, '**وبالعكس** — مفعّل ⇒ نطفيه');

    /* زر الاتصال يعرض خطأ المزوّد كما هو لا «تعذّر» */
    await page.click('#aiBody button[onclick="aiPingBtn()"]');
    await page.waitForTimeout(300);
    const toast = await page.textContent('#toast').catch(() => '');
    ok(/not_found/.test(toast), 'وزر الاتصال يعرض خطأ المزوّد نصاً — ' + toast);
    eq(errs, [], 'بلا أخطاء');
    await page.close(); close();
  }

  /* ── ٤) مربّع التجربة ── */
  {
    const st = { ai: aiState({ mode: 'admin' }), top: topState(), posts: [], asks: [], warms: [],
                 ping: {},
                 ask: { ok: true, answer: 'عندك MATH 1422 الساعة 10',
                        tools: ['my_day'], calls: 2, model: 'claude-haiku-4-5',
                        sar: 0.02, used: { day: 1, dayCap: 25 } } };
    const { page, errs, close } = await open(browser, st);
    await openAi(page);
    ok(await page.$('#aiQ') !== null, 'مربّع السؤال موجود');
    await page.fill('#aiQ', 'وش عندي بكرة؟');
    await page.click('#aiBody button[onclick="aiSend()"]');
    await page.waitForTimeout(400);
    eq(st.asks[0], { q: 'وش عندي بكرة؟' }, 'يرسل السؤال وحده — بلا أي معرّف');
    const log = await page.textContent('#aiChatLog');
    ok(/وش عندي بكرة/.test(log), 'والسؤال يظهر');
    ok(/MATH 1422/.test(log), 'والجواب');
    ok(/my_day/.test(log), 'والأدوات اللي استُعملت');
    ok(/0\.02 ريال/.test(log), 'وتكلفة السؤال');
    eq(await page.inputValue('#aiQ'), '', 'والمربّع يفضى بعد الإرسال');
    /* محادثة جديدة */
    await page.click('#aiBody button[onclick="aiNewChat()"]');
    await page.waitForTimeout(300);
    eq(st.asks[st.asks.length - 1], { reset: true }, 'ومحادثة جديدة ترسل reset');
    ok(/ما بدأت محادثة/.test(await page.textContent('#aiChatLog')), 'والسجل يفضى');
    eq(errs, [], 'بلا أخطاء');
    await page.close(); close();
  }

  /* ── ٥) وضع off يشرح للوحة، وجواب النموذج يُهرَّب ── */
  {
    const st = { ai: aiState({ mode: 'off' }), top: topState({ top: [] }),
                 posts: [], asks: [], warms: [], ping: {},
                 ask: { ok: false, why: 'off', answer: '<b>مقفل</b>' } };
    const { page, errs, close } = await open(browser, st);
    await openAi(page);
    ok(/حوّله إلى admin/.test(await page.textContent('#aiBody')),
       'وضع off يشرح كيف تجرّب');
    ok(/ما فيه استهلاك/.test(await page.textContent('#aiBody')),
       'وقائمة فاضية تشرح نفسها');
    await page.fill('#aiQ', 'سؤال');
    await page.click('#aiBody button[onclick="aiSend()"]');
    await page.waitForTimeout(400);
    ok(await page.$('#aiChatLog b') === null,
       '**جواب النموذج يُهرَّب** — ما انزرع وسم');
    ok(/<b>مقفل<\/b>/.test(await page.textContent('#aiChatLog')),
       'ويظهر نصاً كما هو');
    eq(errs, [], 'بلا أخطاء');
    await page.close(); close();
  }

  /* ── ٦) فحص ثابت ── */
  {
    ok(/id="pageAi"/.test(SRC), 'صفحة المساعد في الـHTML');
    ok(/ai:'pageAi'/.test(SRC), 'ومربوطة في go()');
    ok(/if\(p==='ai'&&!AI\)loadAi\(\)/.test(SRC), 'وتُحمَّل عند فتحها لا مع كل تحديث');
    /* ولا صنف CSS غير معرّف في البطاقة */
    const card = SRC.slice(SRC.indexOf('function renderAi()'),
                           SRC.indexOf('/* ══════════ التخزين ══════════'));
    const used = new Set();
    card.replace(/class="([^"$]+)"/g, (_, c) =>
      c.split(/\s+/).filter(Boolean).forEach(x => used.add(x)));
    const missing = [...used].filter(c =>
      !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '[{,.: ]').test(SRC));
    eq(missing, [], 'كل صنف CSS في البطاقة معرّف فعلاً');
    /* اللوحة ما تحسب سعراً — المعادلة في السيرفر وحده */
    ok(!/3\.75|1000000|cost_micro/.test(card),
       'اللوحة ما تحسب تكلفة — تعرض ما يرجّعه السيرفر');
  }

  await browser.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('انهار: ' + (e && e.stack || e));
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
