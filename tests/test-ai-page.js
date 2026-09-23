/* مساعد جدولك في الصفحة — اختبار سلوكي في Chromium على مقاس جوال.

   خمسة أخطار يمسكها:
   ١) الزر يظهر لمن ما يستحقه (الوضع off أو admin لغير صاحبه).
   ٢) الصفحة ترسل معرّف الطالب في جسم الطلب بدل ما تعتمد على جلسته.
   ٣) جواب النموذج يُعرض HTML — وهو نص قد يجي فيه أي شي.
   ٤) رسالة السقف تُخترع في الصفحة بدل ما تجي من السيرفر.
   ٥) تبديل اللغة يترك اللوح بنصوص اللغة القديمة (عناصره من JS بلا data-i18n).

   node tests/test-ai-page.js [مسار pmu-schedule.html] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'pmu-schedule.html');
const SRC = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = c => { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(c || (fail ? 1 : 0)) };

/* الحالة اللي يرجّعها السيرفر المزيّف — كل اختبار يضبطها */
const ST = { status: { on: true, why: '', msg: '', pro: true,
                       used: { day: 2, dayCap: 25, term: 9, termCap: 200 } },
             answer: { ok: true, answer: 'عندك محاضرتين بكرة', tools: ['my_day'],
                       used: { day: 3, dayCap: 25, term: 10, termCap: 200 } },
             code: 200, posts: [], heads: [], gets: 0 };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(SRC);
  }
  if (u === '/plans.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
  }
  if (u === '/api/me/ai') {
    let body = '';
    req.on('data', c => { body += c });
    return req.on('end', () => {
      ST.heads.push(String(req.headers.authorization || ''));
      if (req.method === 'POST') {
        let j = null; try { j = JSON.parse(body || '{}') } catch (e) {}
        ST.posts.push(j);
        res.writeHead(ST.code, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(j && j.reset ? { ok: true, reset: true } : ST.answer));
      }
      ST.gets++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ST.status));
    });
  }
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ courses: [], cached: false, age: 0 }));
});

const sbStub = signedIn => 'window.supabase={createClient:()=>({' +
  'auth:{getSession:async()=>({data:{session:' + (signedIn
    ? '{access_token:"tok-abc-123456789012345678901234567890",' +
      'user:{id:"u-me",email:"me@x.com"}}' : 'null') + '}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),' +
  'signInWithOAuth:async()=>({}),signOut:async()=>({})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'upsert(){return this},update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

async function open(browser, signedIn) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => { errs.push('DIALOG:' + d.message()); d.dismiss().catch(() => {}) });
  await page.route('**/fonts.googleapis.com/**',
    r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: sbStub(signedIn) }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.aiProbe === 'function',
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { page, errs };
}
/* مدخلان بدل الزر العائم: أعلى لوح المساعدة، وصفحة اليوم */
const fabOn = page => page.evaluate(() => {
  const e = document.getElementById('aiEntry');
  return !!e && !e.hidden;
});
const askBarOn = page => page.evaluate(() =>
  !!document.querySelector('#todayBody .ai-ask'));
const openSheet = async page => {
  await page.evaluate(() => openAi());
  await page.waitForTimeout(350);
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();

  /* ── ١) من يشوف الزر ── */
  {
    const { page, errs } = await open(browser, false);
    ok(typeof await page.evaluate(() => typeof aiProbe) === 'string', 'الدوال موجودة');
    eq(await fabOn(page), false, 'بلا دخول: مدخل المساعدة مخفي');
    eq(await askBarOn(page), false, 'وشريط صفحة اليوم كذلك');
    ok(await page.$('#aiFab') === null, 'وما فيه زر عائم — انتقل للمكانين');
    eq(ST.gets, 0, 'وبلا دخول ما نسأل السيرفر أصلاً');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }
  for (const why of ['off', 'admin', 'nokey']) {
    ST.status = { on: false, why, msg: 'مقفل' };
    const { page, errs } = await open(browser, true);
    eq(await fabOn(page), false, `الوضع ${why}: مدخل المساعدة مخفي`);
    eq(await askBarOn(page), false, `الوضع ${why}: وشريط اليوم مخفي`);
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }
  {
    ST.status = { on: true, why: '', used: { day: 2, dayCap: 25 } };
    const { page, errs } = await open(browser, true);
    eq(await fabOn(page), true, 'الوضع all: مدخل المساعدة يظهر للمسجّل');
    eq(await askBarOn(page), true, 'وشريط اليوم كذلك');
    /* الاسم علامة تجارية — يبقى Jadwalik AI في اللغتين */
    ok(/Jadwalik AI/.test(await page.textContent('#aiEntry')), 'باسم Jadwalik AI');
    ok(/Jadwalik AI/.test(await page.textContent('#todayBody .ai-ask')),
       'ونفس الاسم في شريط اليوم');
    /* الشريط فوق مبدّل اليوم/الأسبوع */
    const order = await page.evaluate(() => {
      const b = document.getElementById('todayBody');
      const a = b.querySelector('.ai-ask'), v = b.querySelector('.vw-switch');
      if (!a || !v) return 'ناقص';
      return (a.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING)
        ? 'فوق' : 'تحت';
    });
    eq(order, 'فوق', 'والشريط فوق زرّي اليوم/الأسبوع');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── ٢) السقف: الرسالة من السيرفر لا من الصفحة ── */
  {
    ST.status = { on: false, why: 'day', msg: 'خلصت أسئلتك لهذا اليوم (25). ترجع لي بكرة.',
                  used: { day: 25, dayCap: 25 } };
    const { page, errs } = await open(browser, true);
    eq(await fabOn(page), true, 'عند السقف: المدخل يظهر — الطالب يستاهل يعرف ليش');
    eq(await askBarOn(page), true, 'وشريط اليوم كذلك');
    await openSheet(page);
    const log = await page.textContent('#aiLog');
    ok(/خلصت أسئلتك لهذا اليوم/.test(log), 'ونص السيرفر هو المعروض حرفياً');
    ok(/\(25\)/.test(log), 'بالرقم اللي أرسله');
    ok(await page.$('#aiLog .ai-b.warn') !== null, 'بشكل تحذير');
    ok(await page.$('#aiLog .ai-ex') === null, 'وبلا أمثلة يضغطها ويصطدم بالسقف');
    ok(/0/.test(await page.textContent('.ai-foot')), 'والباقي صفر في التذييل');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── ٣) سؤال وجواب ── */
  {
    ST.status = { on: true, why: '', used: { day: 2, dayCap: 25 } };
    ST.answer = { ok: true, answer: 'عندك محاضرتين بكرة', tools: ['my_day'],
                  used: { day: 3, dayCap: 25 } };
    ST.code = 200; ST.posts = []; ST.heads = [];
    const { page, errs } = await open(browser, true);
    await openSheet(page);
    ok(await page.$('#aiQ') !== null, 'مربّع السؤال موجود');
    ok(/اسألني/.test(await page.textContent('#aiLog')), 'وترحيب قبل أول سؤال');
    const ex = await page.$$('#aiLog .ai-ex button');
    ok(ex.length === 3, 'وثلاثة أمثلة جاهزة — ' + ex.length);

    await page.fill('#aiQ', 'وش عندي بكرة؟');
    await page.click('#aiSendBtn');
    await page.waitForTimeout(450);

    /* **الهوية من الجلسة لا من الجسم** */
    eq(ST.posts[0], { q: 'وش عندي بكرة؟' }, 'الجسم فيه السؤال وحده');
    eq(Object.keys(ST.posts[0]), ['q'], 'ولا حقل ثانٍ — ولا معرّف ولا بريد');
    ok(/^Bearer tok-abc/.test(ST.heads[ST.heads.length - 1]),
       'والهوية في ترويسة الجلسة');
    ok(!/u-me|me@x\.com/.test(JSON.stringify(ST.posts)),
       '**ولا مرة أرسلت الصفحة معرّف الطالب أو بريده**');

    const log = await page.textContent('#aiLog');
    ok(/وش عندي بكرة/.test(log), 'السؤال يظهر');
    ok(/عندك محاضرتين بكرة/.test(log), 'والجواب');
    ok(/my_day/.test(log), 'والأدوات اللي استُعملت');
    eq(await page.inputValue('#aiQ'), '', 'والمربّع يفضى');
    ok(/22/.test(await page.textContent('.ai-foot')), 'والباقي تحدّث من رد السيرفر');
    ok(await page.$('.ai-foot span[dir="ltr"]') !== null,
       'والرقم داخل dir=ltr — وإلا انقلب في سياق عربي');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── ٤) جواب النموذج نص لا HTML ── */
  {
    ST.answer = { ok: true, answer: '<img src=x onerror=alert(1)> و <b>غامق</b>',
                  tools: [] };
    ST.posts = [];
    const { page, errs } = await open(browser, true);
    await openSheet(page);
    await page.fill('#aiQ', 'جرّب');
    await page.click('#aiSendBtn');
    await page.waitForTimeout(450);
    ok(await page.$('#aiLog img') === null, '**وسم في الجواب ما انزرع عنصراً**');
    ok(await page.$('#aiLog b') === null, 'ولا وسم تنسيق');
    ok(/<img src=x onerror=alert\(1\)>/.test(await page.textContent('#aiLog')),
       'ويظهر نصاً كما هو');
    eq(errs, [], 'ولا نافذة تنبيه ولا خطأ');
    await page.close();
  }

  /* ── ٥) الأعطال والتصفير ── */
  {
    ST.answer = {}; ST.code = 500; ST.posts = [];
    const { page, errs } = await open(browser, true);
    await openSheet(page);
    await page.fill('#aiQ', 'سؤال');
    await page.click('#aiSendBtn');
    await page.waitForTimeout(450);
    const log = await page.textContent('#aiLog');
    ok(/جرّب بعد شوي/.test(log), 'خطأ ٥٠٠ يرجّع رسالة هادئة — ' + log.slice(-40));
    ok(!/undefined|null/.test(log), 'بلا undefined');
    ok(await page.$('#aiLog .ai-b.warn') !== null, 'بشكل تحذير');
    ok(!await page.evaluate(() => document.getElementById('aiSendBtn').disabled),
       'وزر الإرسال يرجع شغّالاً بعد الفشل');

    ST.code = 200; ST.answer = { ok: true, answer: 'تمام', tools: [] };
    await page.evaluate(() => aiNew());
    await page.waitForTimeout(350);
    eq(ST.posts[ST.posts.length - 1], { reset: true }, 'محادثة جديدة ترسل reset');
    ok(/اسألني/.test(await page.textContent('#aiLog')), 'والسجل يرجع للترحيب');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── ٦) تبديل اللغة واللوح مفتوح ── */
  {
    ST.status = { on: true, why: '', used: { day: 0, dayCap: 25 } };
    const { page, errs } = await open(browser, true);
    await openSheet(page);
    ok(/مساعد جدولك/.test(await page.textContent('#aiSheet')), 'العنوان بالعربي');
    await page.evaluate(() => { LANG = 'en'; applyLang() });
    await page.waitForTimeout(250);
    const sheet = await page.textContent('#aiSheet');
    ok(/Jadwalik Assistant/.test(sheet), 'وبعد التبديل يصير إنجليزياً');
    ok(/Send/.test(sheet) && /New chat/.test(sheet), 'وأزراره كذلك');
    ok(/replies in Arabic/.test(sheet), 'ويقول إنه يرد بالعربي — الأمثلة عربية عمداً');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── الجمل تتبدّل: الطالب ما يعرف وش يقدر يسأل ── */
  {
    ST.status = { on: true, why: '', used: { day: 0, dayCap: 25 } };
    const { page, errs } = await open(browser, true);
    const hint = () => page.textContent('#aiHint');
    const first = await hint();
    ok(!!first && first.length > 3, 'الشريط فيه جملة مقترحة — ' + first);
    /* تتبدّل خلال دورتين على الأكثر */
    let changed = false;
    for (let i = 0; i < 12 && !changed; i++) {
      await page.waitForTimeout(800);
      if (await hint() !== first) changed = true;
    }
    ok(changed, 'والجملة تتبدّل لغيرها');
    /* والضغط يفتح لوح المساعد — نقفل الدليل أولاً، يفتح تلقائياً
       بعد ٩٠٠ م.ث أول زيارة ويعترض الضغط */
    await page.evaluate(() => closeGuide());
    await page.waitForTimeout(150);
    await page.click('#todayBody .ai-ask');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() =>
      document.getElementById('aiOv').classList.contains('open')), true,
      'والضغط على الشريط يفتح المساعد');
    /* ومن لوح المساعدة كذلك */
    await page.evaluate(() => closeAi());
    await page.evaluate(() => openGuide());
    await page.waitForTimeout(150);
    await page.click('#aiEntry');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() =>
      document.getElementById('aiOv').classList.contains('open')), true,
      'ومن مدخل لوح المساعدة كذلك');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── ٧) لوحان ما يفتحان معاً ── */
  {
    /* الدليل يفتح تلقائياً بعد ٩٠٠ م.ث أول زيارة، وعنصره بعد عنصرنا في
       الصفحة — فبنفس z-index يغطّي المساعد لو فتحا معاً. */
    ST.status = { on: true, why: '', used: { day: 0, dayCap: 25 } };
    const { page, errs } = await open(browser, true);
    /* الاتجاه الأول: المساعد يفتح والدليل مفتوح ⇒ الدليل يُقفل */
    await page.evaluate(() => openGuide());
    await page.waitForTimeout(150);
    eq(await page.evaluate(() =>
      document.getElementById('guideOverlay').classList.contains('open')), true,
      'الدليل مفتوح');
    await openSheet(page);
    eq(await page.evaluate(() =>
      document.getElementById('guideOverlay').classList.contains('open')), false,
      'فتح المساعد يقفل الدليل — ما نترك لوحين فوق بعض');
    eq(await page.evaluate(() => document.body.style.overflow), 'hidden',
      'وتمرير الخلفية مقفول مثل الدليل');
    await page.evaluate(() => closeAi());
    await page.waitForTimeout(100);
    eq(await page.evaluate(() => document.body.style.overflow), '',
      'ويرجع بعد الإغلاق');

    /* الاتجاه الثاني: الفتح التلقائي ما يقتحم المساعد */
    await openSheet(page);
    await page.evaluate(() => { save('pmu_seen_guide', false); maybeShowGuide() });
    await page.waitForTimeout(1200);
    eq(await page.evaluate(() =>
      document.getElementById('guideOverlay').classList.contains('open')), false,
      'والفتح التلقائي للدليل ما يقتحم المساعد وهو مفتوح');
    eq(await page.evaluate(() =>
      document.getElementById('aiOv').classList.contains('open')), true,
      'والمساعد باقٍ مفتوحاً');
    eq(errs, [], 'بلا أخطاء');
    await page.close();
  }

  /* ── الأفعال: ما ينفّذ شي إلا بضغط الطالب ── */
  {
    ST.status = { on: true, why: '', used: { day: 0, dayCap: 25 } };
    ST.answer = { ok: true, answer: 'جهّزت لك التسجيل', tools: ['propose_absence'],
      proposal: { action: 'absence', crn: '10001', date: '2026-09-20',
                  code: 'ALIS 1212', title: 'Islamic Culture II' } };
    const { page, errs } = await open(browser, true);
    /* ننادي دالة التنفيذ الحقيقية ونسجّل ما وصلها بدل ما نكتب في القاعدة */
    await page.evaluate(() => {
      window.__ran = [];
      window.markAbsent = (crn, date) => { window.__ran.push(['absence', crn, date]);
        return Promise.resolve(true) };
      window.addEvDirect = (crn, k, d, n) => { window.__ran.push(['event', crn, k, d, n]);
        return Promise.resolve(true) };
    });
    await openSheet(page);
    await page.fill('#aiQ', 'سجّل لي غياب');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);

    ok(await page.$('#aiLog .ai-act') !== null, 'بطاقة التأكيد ظهرت');
    const card = await page.textContent('#aiLog .ai-act');
    ok(/ALIS 1212/.test(card), 'وفيها اسم المادة — ' + card.trim().slice(0, 50));
    ok(/2026-09-20/.test(card), 'وتاريخها');
    eq(await page.evaluate(() => window.__ran.length), 0,
       '**وما انفّذ شي قبل الضغط**');

    await page.click('#aiLog .ai-act-go');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__ran), [['absence', '10001', '2026-09-20']],
       'والضغط ينفّذ بدالة الصفحة نفسها — بشعبتها وتاريخها');
    ok(/تم/.test(await page.textContent('#aiLog .ai-act')), 'والبطاقة تصير «تم»');
    ok(await page.$('#aiLog .ai-act-go') === null, 'وما يبقى زر يُضغط مرتين');

    /* «لا شكراً» ما ينفّذ */
    ST.answer.proposal = { action: 'event', crn: '10002', kind: 'quiz',
      date: '2099-03-01', note: 'الفصل الرابع', code: 'MATH 1422' };
    await page.fill('#aiQ', 'ضف كويز');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    const cards = await page.$$('#aiLog .ai-act');
    ok(cards.length >= 1, 'بطاقة ثانية');
    ok(/الفصل الرابع/.test(await page.textContent('#aiLog')), 'وفيها الملاحظة');
    await page.click('#aiLog .ai-act-no');
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => window.__ran.length), 1,
       '**و«لا شكراً» ما ينفّذ شيئاً**');

    /* فعل ما نعرفه ما يرسم بطاقة أصلاً */
    ST.answer.proposal = { action: 'delete_everything', crn: '1' };
    await page.fill('#aiQ', 'احذف كل شي');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    eq(await page.evaluate(() =>
      document.querySelectorAll('#aiLog .ai-act').length), 2,
      '**فعل ما نعرفه ما يصير بطاقة** — الصفحة تعرف أفعالها لا النموذج');
    eq(await page.evaluate(() => window.__ran.length), 1, 'وما انفّذ');

    /* إضافة شعبة: الجلستان تنضافان معاً */
    await page.evaluate(() => {
      window.addSessionsDirect = ss => { window.__ran.push(['add', ss.length,
        ss[0] && ss[0].crn]); return true };
      window.__watched = [];
      window.isMonitored = crn => window.__watched.indexOf(crn) > -1;
      window.toggleMonitorCourse = (crn, row) => {
        window.__ran.push(['watch', crn, row && row.courseCode]);
        window.__watched.push(crn);
        return Promise.resolve();
      };
    });
    ST.answer.proposal = { action: 'add_section', crn: '30001', code: 'PHYS 1421',
      section: '05', title: 'Physics I', sessions: [{ crn: '30001' }, { crn: '30001' }] };
    await page.fill('#aiQ', 'ضف الشعبة');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    /* البطاقات السابقة صارت «تم» وباقية في السجل — نقرأ الأخيرة */
    const lastCard = async () => {
      const all = await page.$$('#aiLog .ai-act');
      return all.length ? all[all.length - 1].textContent() : '';
    };
    ok(/PHYS 1421/.test(await lastCard()), 'بطاقة إضافة الشعبة');
    ok(/30001/.test(await lastCard()), 'وفيها رقمها');
    await page.click('#aiLog .ai-act-go');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__ran[window.__ran.length - 1]),
       ['add', 2, '30001'],
       '**والجلستان تمرّان معاً** — المحاضرة والمعمل وحدة واحدة');

    /* مراقبة: تمرّ لدالة الموقع نفسها بصف الشعبة */
    ST.answer.proposal = { action: 'watch', crn: '30001', code: 'PHYS 1421',
      section: '05', title: 'Physics I', status: 'CLOSE' };
    await page.fill('#aiQ', 'راقبها');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    await page.click('#aiLog .ai-act-go');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__ran[window.__ran.length - 1]),
       ['watch', '30001', 'PHYS 1421'],
       'والمراقبة تمرّ لدالة الموقع نفسها بصف الشعبة — بحدودها كما هي');
    ok(/تم/.test(await lastCard()), 'والبطاقة تصير «تم»');

    /* التذكير: يحتاج تلقرام مربوطاً، والبيئة تجي من السيرفر */
    await page.evaluate(() => {
      window.__tg = false;
      window.tgLinked = () => window.__tg;
      window.addReminderDirect = (at, body, crn, env) => {
        if (!window.__tg) return Promise.resolve(false);
        window.__ran.push(['reminder', at, body, env]);
        return Promise.resolve(true);
      };
    });
    ST.answer.proposal = { action: 'reminder', at: '2099-03-01T16:00:00.000Z',
      atLocal: '2099-03-01 19:00', body: 'ذاكر للكويز', env: 'dev' };
    await page.fill('#aiQ', 'ذكّرني');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    ok(/ذاكر للكويز/.test(await lastCard()), 'بطاقة التذكير بنصّه');
    ok(/19:00/.test(await lastCard()), 'وبوقته بتوقيت الرياض لا UTC');
    await page.click('#aiLog .ai-act-go');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__ran.length), 3,
       '**بلا تلقرام ما ينجدول شي**');
    /* نربط تلقرام ونعيد */
    await page.evaluate(() => { window.__tg = true });
    await page.fill('#aiQ', 'ذكّرني');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    await page.click('#aiLog .ai-act-go');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__ran[window.__ran.length - 1]),
       ['reminder', '2099-03-01T16:00:00.000Z', 'ذاكر للكويز', 'dev'],
       'وبالربط ينجدول — **والبيئة من السيرفر لا من المتصفح**');

    /* والنص المحقون في الملاحظة يُهرَّب */
    ST.answer.proposal = { action: 'event', crn: '10002', kind: 'quiz',
      date: '2099-03-01', note: '<img src=x onerror=alert(1)>', code: 'MATH 1422' };
    await page.fill('#aiQ', 'ضف');
    await page.evaluate(() => aiSend());
    await page.waitForTimeout(450);
    ok(await page.$('#aiLog img') === null, 'وملاحظة فيها وسم تُهرَّب');
    eq(errs, [], 'ولا خطأ ولا نافذة تنبيه');
    await page.close();
  }

  /* ── ٨) فحص ثابت ── */
  {
    ok(/id="aiEntry"/.test(SRC) && /id="aiOv"/.test(SRC), 'العناصر في الصفحة');
    ok(/\.ai-entry\{/.test(SRC) && /\.ai-ask\{/.test(SRC), 'وتنسيقهما معرّف');
    ok(!/ai-fab/.test(SRC), 'ولا أثر للزر العائم القديم — لا HTML ولا CSS');
    /* الأفعال: الصفحة تعرف أفعالها، وتنفّذها بدوالها الموجودة */
    ok(/const AI_ACTS=\{/.test(SRC), 'قائمة الأفعال المعروفة موجودة');
    ok(/run:p=>markAbsent\(/.test(SRC) && /run:p=>addEvDirect\(/.test(SRC),
       'وتنفّذ بدوال الصفحة نفسها — لا نقطة كتابة جديدة');
    ok(!/\/api\/me\/ai-do|\/api\/me\/act/.test(SRC),
       'ولا نقطة تنفيذ جديدة في السيرفر — ما وسّعنا سطح الكتابة');
    /* ولا صنف CSS مستعمل بلا تعريف */
    const js = SRC.slice(SRC.indexOf('const aiShown ='),
                         SRC.indexOf('/* ═══ رصيد تقييم الدكاترة ═══'));
    const used = new Set();
    js.replace(/class="([a-z][a-z0-9 \-]*)"/g, (_, c) =>
      c.split(/\s+/).filter(Boolean).forEach(x => used.add(x)));
    const missing = [...used].filter(c =>
      !new RegExp('\\.' + c.replace(/-/g, '\\-') + '[{,.: ]').test(SRC));
    eq(missing, [], 'كل صنف CSS في اللوح معرّف فعلاً');
    /* كل نص معروض مهرَّب */
    ok(!/innerHTML\s*=\s*[^;]*\+\s*(m\.text|r\.answer|st\.msg)\b/.test(js),
       'ولا نص يدخل innerHTML بلا تهريب');
    ok((js.match(/escapeHtml\(/g) || []).length >= 8,
       'وescapeHtml مستعملة في كل موضع عرض');
    /* الصفحة ما ترسل هوية */
    ok(!/meFetch\('\/api\/me\/ai','POST',\{[^}]*user/i.test(SRC),
       'وما ترسل معرّفاً في جسم الطلب');
    /* مفتاح اللغة موجود في الكتلتين */
    for (const k of ['aiTitle', 'aiSend', 'aiNew', 'aiErr', 'aiHello'])
      eq((SRC.match(new RegExp(k + ':', 'g')) || []).length, 2,
         `${k} معرّف في العربي والإنجليزي`);
    /* ولا دالة معرّفة مرتين */
    for (const f of ['aiProbe', 'openAi', 'closeAi', 'renderAiSheet', 'renderAiLog',
                     'aiSend', 'aiNew', 'aiAsk'])
      eq((SRC.match(new RegExp('function ' + f + '\\s*\\(', 'g')) || []).length, 1,
         `${f} معرّفة مرة واحدة`);
  }

  await browser.close(); server.close();
  done();
})().catch(e => {
  console.log('انهار: ' + (e && e.stack || e));
  fail++; try { server.close() } catch (x) {}
  done(1);
});
