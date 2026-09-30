/* الصفحات النظامية والتذييل — اختبار.

   نظام التجارة الإلكترونية ولائحته: وسيلة التواصل ظاهرة، والضغط على زر الدفع يُبرم العقد
   (بروابط الشروط والاسترجاع). والجهة: **رقم السجل التجاري وحده، بلا اسم المؤسسة** —
   قرار محمد (٣٠ سبتمبر ٢٠٢٦): النصوص تقول «جدولك — سجل تجاري …»، والتذييلات بلا سطر سجل.
   والصفحات تحيل لبعضها بأقسام (‎/terms#refund‎) — قسم يتغيّر اسمه ينكسر رابطه بصمت.

   أخطار يمسكها:
   ١) رابط لقسم ما هو موجود (‎/terms#payment‎ من ورقة الباقات أو من «عن جدولك»).
   ٢) ‎#en-…‎ ما يفتح النسخة الإنجليزية — الرابط الإنجليزي من الورقة يوصل للعربي.
   ٣) اسم المؤسسة يرجع لصفحة أو للإيصال، أو رقم السجل يختفي من «عن جدولك».
   ٤) تاريخ «آخر تحديث» العربي والإنجليزي مختلفان — تحدّث واحد ونُسي الثاني.
   ٥) وصف الموقع علناً بـ«مشروع فردي» (قاعدة ثابتة في CLAUDE.md §١).

   node tests/test-legal.js [مجلد المستودع] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8') } catch (e) { return '' } };
const SHOTS = process.env.LEGAL_SHOTS || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const PAGES = { terms: read('terms.html'), privacy: read('privacy.html'), about: read('about.html') };
const HOME = read('pmu-schedule.html');
const GUIDE = read('jadwalik-guide.html');
/* اسم المؤسسة بأي صيغة — ما يظهر في أي مكان (قرار محمد) */
const CO = /مؤسسة محمد|اسامه المسبح|المسبح لتقنية المعلومات|AlMusabbeh|Establishment for Information Technology/;
const CR = '7055288521';

/* ═══ ١) الأقسام اللي تحيل لها الروابط موجودة ═══ */
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
for (const id of ['payment', 'refund', 'en-payment', 'en-refund'])
  ok(ids(PAGES.terms).has(id), `الشروط فيها القسم #${id}`);
for (const id of ['pricing', 'en-pricing'])
  ok(ids(PAGES.about).has(id), `«عن جدولك» فيها القسم #${id}`);

/* كل رابط لقسم في صفحاتنا يوصل لقسم موجود — يُستخرج لا يُكتب بيدنا */
const TARGET = { '/terms': 'terms', '/privacy': 'privacy', '/about': 'about' };
const SOURCES = Object.assign({ 'pmu-schedule.html': HOME, 'jadwalik-guide.html': GUIDE },
  ...Object.keys(PAGES).map(k => ({ [k + '.html']: PAGES[k] })));
let anchors = 0;
for (const [src, html] of Object.entries(SOURCES)) {
  for (const m of html.matchAll(/href="(\/(?:terms|privacy|about))(?:\.html)?#([^"]+)"/g)) {
    anchors++;
    ok(ids(PAGES[TARGET[m[1]]]).has(m[2]), `${src}: الرابط ${m[1]}#${m[2]} يوصل لقسم موجود`);
  }
}
ok(anchors > 0, 'فيه روابط أقسام نفحصها');

/* ورقة الباقات: سطر الموافقة بروابط الشروط والاسترجاع — باللغتين */
for (const h of ['/terms#payment', '/terms#refund', '/terms#en-payment', '/terms#en-refund'])
  ok(HOME.includes(`href="${h}"`), `**سطر الموافقة تحت زر الدفع** فيه ${h}`);

/* ═══ ٣) رقم السجل وحده — بلا اسم المؤسسة (قرار محمد) ═══ */
const foot = html => { const i = html.lastIndexOf('class="foot"'); return i < 0 ? '' : html.slice(i) };
for (const [k, html] of Object.entries(Object.assign({ guide: GUIDE, home: HOME, server: read('server.js') }, PAGES))) {
  const m = CO.exec(html);
  ok(!m, `**${k}: بلا اسم المؤسسة** — «${m ? m[0] : ''}»`);
}
ok(/<b>جدولك<\/b> — سجل تجاري رقم 7055288521/.test(PAGES.about) && /<b>Jadwalik<\/b> — commercial registration no\. 7055288521/.test(PAGES.about),
   '**«عن جدولك» فيها رقم السجل باللغتين**');
for (const [k, html] of Object.entries(PAGES)) {
  ok(!foot(html).includes(CR), `تذييل ${k}: بلا سطر سجل`);
  ok(foot(html).includes('href="/about"') || k === 'about', `تذييل ${k}: رابط «عن جدولك» (فيها رقم السجل)`);
}
/* والنصوص اللي كانت تسمّي المؤسسة صارت «جدولك» ومعها الرقم */
ok(PAGES.terms.includes('كلمة «نحن» في هذي الشروط تعني جدولك') && PAGES.terms.includes('"we" means Jadwalik'),
   'الشروط: «نحن» تعني جدولك');
ok(/جهة التحكم\) هي <b>جدولك<\/b>، سجل تجاري رقم 7055288521/.test(PAGES.privacy) &&
   /\(the controller\) is <b>Jadwalik<\/b>, Commercial Registration No\. 7055288521/.test(PAGES.privacy),
   'الخصوصية: جهة التحكم «جدولك» برقم سجلها');

/* ═══ ٤) تاريخ «آخر تحديث» نفسه بالعربي والإنجليزي ═══ */
const MON_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MON_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const latin = s => s.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660));
function updated(html) {
  const a = /آخر تحديث:\s*([٠-٩\d]+)\s+(\S+)\s+([٠-٩\d]{4})/.exec(html);
  const e = /Last updated:\s*(\d+)\s+(\w+)\s+(\d{4})/.exec(html);
  return {
    ar: a && [+latin(a[3]), MON_AR.indexOf(a[2]) + 1, +latin(a[1])],
    en: e && [+e[3], MON_EN.indexOf(e[2]) + 1, +e[1]]
  };
}
for (const k of ['terms', 'privacy']) {
  const u = updated(PAGES[k]);
  ok(u.ar && u.ar[1] > 0, `${k}: «آخر تحديث» بالعربي مقروء — ${JSON.stringify(u.ar)}`);
  eq(u.en, u.ar, `**${k}: تاريخ «آخر تحديث» نفسه باللغتين**`);
}

/* ═══ ٥) لا «مشروع فردي» ولا «مشروع طالب» علناً (CLAUDE.md §١) ═══ */
const SOLO = /مشروع فردي|مشروع طالب|عمل شخص واحد|individual project|student project|one-person/i;
for (const [k, html] of Object.entries(Object.assign({ guide: GUIDE }, PAGES))) {
  const m = SOLO.exec(html);
  ok(!m, `${k}: ما يوصف الموقع بـ«${m ? m[0] : ''}»`);
}

/* ═══ ٦) الأسعار في الصفحات = أسعار الكود الافتراضية ═══
   الأسعار نص ثابت في ‎/about#pricing‎ و‎/terms#payment‎، والسعر الفعلي من اللوحة.
   الافتراضي في الكود لازم يطابق الصفحات — وتعديل اللوحة يلزمه تعديل الصفحتين (CLAUDE.md §٣). */
const vm = require('vm');
const SRV = read('server.js');
const PA = SRV.indexOf('/* ═══ الاشتراك: الأسعار والرصيد ═══'), PB = SRV.indexOf('/* ═══ نهاية كتلة الاشتراك ═══ */');
let D = null;
try {
  const c = vm.createContext({ termEndISO: () => null });
  vm.runInContext(SRV.slice(PA, PB) + '\n;this.D=PRICING_DEFAULT;', c);
  D = c.D;
} catch (e) { }
ok(!!D, 'الأسعار الافتراضية تُقرأ من كتلة الاشتراك');
const arNum = s => +latin(s);
const sar = h => h / 100;
function pagePrices(html) {
  const t = /اشتراك الترم<\/b><\/td><td>([٠-٩]+) ريال للترم/.exec(html);
  const p = /التنبيه الطارئ<\/b><br>إضافة اختيارية<\/td><td>\+([٠-٩]+) ريال للترم/.exec(html);
  const te = /Term subscription<\/b><\/td><td>SAR (\d+) per term/.exec(html);
  const pe = /Emergency alert<\/b><br>optional add-on<\/td><td>\+ SAR (\d+) per term/.exec(html);
  return { term: t && arNum(t[1]), po: p && arNum(p[1]), termEn: te && +te[1], poEn: pe && +pe[1] };
}
for (const k of ['about', 'terms']) {
  const pp = pagePrices(PAGES[k]);
  eq(pp, D && { term: sar(D.termHalalas), po: sar(D.pushoverHalalas), termEn: sar(D.termHalalas), poEn: sar(D.pushoverHalalas) },
     `**${k}: أسعار الجدول (عربي وإنجليزي) = أسعار الكود**`);
}
/* أقل دفع نقدي في الشروط = الافتراضي في الكود */
{
  const a = /على أن تدفع <b>([٠-٩]+) ريال على الأقل<\/b>/.exec(PAGES.terms);
  const e = /you pay <b>at least SAR (\d+)<\/b> on every order/.exec(PAGES.terms);
  eq([a && arNum(a[1]), e && +e[1]], D && [sar(D.minCashHalalas), sar(D.minCashHalalas)],
     '**الشروط: أقل دفع نقدي (عربي وإنجليزي) = أقل دفع في الكود**');
}
/* قرار محمد (٣٠ سبتمبر ٢٠٢٦): التنبيه الطارئ ١٥ ريال بدل ١٠ */
eq(D && D.pushoverHalalas, 1500, '**التنبيه الطارئ ١٥ ريال** (قرار محمد)');

/* ═══ ٧) رخصة Pushover علينا — قرار محمد ═══
   الجولة الثانية من النصوص كانت تقول «شراء على حسابك · غير مشمول في السعر»، ومحمد قرّر:
   نشتري الرخصة للطالب (وعد الإيصال: «راسلنا هنا ونتكفّل فيه»). فما تقول صفحة غير كذا. */
const PO_PAYS = /تدفعه لـ ?Pushover|لمرة واحدة على حسابك|غير مشمول في سعر الإضافة|شراء تطبيق Pushover|pay to Pushover|purchase that you pay|not included in the add-on price|buying the Pushover app/i;
for (const [k, html] of Object.entries(Object.assign({ guide: GUIDE, home: HOME }, PAGES))) {
  const m = PO_PAYS.exec(html);
  ok(!m, `${k}: ما يقول إن الطالب يشتري Pushover بنفسه — «${m ? m[0] : ''}»`);
}

/* ═══ ٨) الجولة الثانية من الشروط موجودة ═══ */
ok(/<h3>الاعتراض عند البنك<\/h3>/.test(PAGES.terms) && /<h3>Bank disputes<\/h3>/.test(PAGES.terms),
   'الشروط: قسم «الاعتراض عند البنك» باللغتين');
ok(/بشرط ما تكون استخدمت أي ميزة مدفوعة/.test(PAGES.terms) && /provided you have not used any paid feature/.test(PAGES.terms),
   'الشروط: الاسترجاع خلال ٧ أيام بشرط ما استخدم ميزة مدفوعة');

/* الدليل: الجزء ٨ (المساعد) */
ok(/<span class="num">24<\/span><span class="step-t">اسأل Jadwalik AI<\/span>/.test(GUIDE), 'الدليل فيه الخطوة ٢٤: اسأل Jadwalik AI');

/* ═══ ٢ + ٣) في المتصفح: ‎#en-‎ يفتح الإنجليزي · وتذييل الصفحة الرئيسية ═══ */
const sbStub = 'window.supabase={createClient:()=>({' +
  'auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),' +
  'signInWithOAuth:async()=>({}),signOut:async()=>({})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},in(){return this},' +
  'limit(){return this},then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const send = (type, body) => { res.writeHead(200, { 'Content-Type': type }); res.end(body) };
  if (u === '/' || u === '/index.html') return send('text/html; charset=utf-8', HOME);
  const pg = { '/terms': 'terms', '/privacy': 'privacy', '/about': 'about' }[u.replace(/\.html$/, '')];
  if (pg) return send('text/html; charset=utf-8', PAGES[pg]);
  if (u === '/plans.js') return send('application/javascript', read('shared/plans.js'));
  if (u === '/api/monitor-status') return send('application/json', JSON.stringify({ term: '202710', freeBeta: true, build: '"x"' }));
  if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
  send('application/json', JSON.stringify({ courses: [], cached: false, age: 0 }));
});

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')) } catch (e) {
    ok(false, 'Playwright مو مثبّت — npm i --no-save playwright@1.56.0'); return done();
  }
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  async function open(url, scheme) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme || 'dark' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: sbStub }));
    await page.goto(base + url, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    return { page, ctx, errs };
  }
  const shown = (page, sel) => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.height > 0 && getComputedStyle(el).display !== 'none' && r.top < innerHeight && r.bottom > 0;
  }, sel);

  /* ‎#en-…‎: النسخة الإنجليزية على القسم نفسه — والعربي بلا هاش */
  for (const [url, sec] of [['/terms#en-refund', '#en-refund'], ['/terms#en-payment', '#en-payment'],
                            ['/about#en-pricing', '#en-pricing']]) {
    const { page, ctx, errs } = await open(url);
    eq(await page.evaluate(() => document.documentElement.lang), 'en', `${url}: الصفحة صارت إنجليزي`);
    eq(await shown(page, '[lang-block="ar"]'), false, `${url}: والعربي مخفي`);
    eq(await shown(page, sec), true, `**${url}: القسم ظاهر في الشاشة**`);
    eq(errs, [], `${url}: بلا أخطاء`);
    await ctx.close();
  }
  for (const [url, sec] of [['/terms#refund', '#refund'], ['/about#pricing', '#pricing']]) {
    const { page, ctx } = await open(url);
    eq(await page.evaluate(() => document.documentElement.lang), 'ar', `${url}: عربي`);
    eq(await shown(page, sec), true, `${url}: القسم ظاهر في الشاشة`);
    await ctx.close();
  }

  /* الصفحة الرئيسية: تذييل بالروابط والجهة — من أول شاشة يفتحها الزائر (البحث) */
  for (const scheme of ['dark', 'light']) {
    const { page, ctx, errs } = await open('/', scheme);
    await page.waitForFunction(() => typeof window.switchTab === 'function', null, { timeout: 15000 }).catch(() => {});
    const f = await page.evaluate(() => {
      const el = document.querySelector('.legal-foot');
      if (!el) return null;
      el.scrollIntoView();
      const r = el.getBoundingClientRect();
      return { vis: r.height > 0 && getComputedStyle(el).display !== 'none',
               links: [...el.querySelectorAll('a')].map(a => a.getAttribute('href')),
               text: el.textContent.replace(/\s+/g, ' '), w: Math.round(r.width),
               tab: document.querySelector('.page.active') && document.querySelector('.page.active').id };
    });
    /* أول شاشة يشوفها الزائر تتغيّر مع الموسم (defaultTab: البحث وقت التسجيل،
       «اليوم» بعده) — فالتذييل عام تحت كل الشاشات، ونفحصه في أول شاشة كائنة ما كانت */
    ok(f && f.vis, `**الصفحة الرئيسية فيها تذييل ظاهر من أول شاشة** (${scheme}) — ${JSON.stringify(f && { vis: f.vis, tab: f.tab })}`);
    eq(f && f.links, ['/about', '/terms', '/privacy', 'mailto:jadwalik@gmail.com'],
       'روابطه: عن جدولك · الشروط والأحكام · سياسة الخصوصية · البريد');
    ok(f && !f.text.includes(CR) && !CO.test(f.text), '**بلا سطر مؤسسة ولا سجل** (رقم السجل في «عن جدولك») — ' + (f && f.text));
    ok(f && f.w <= 390, 'ما يطلع عن عرض الجوال');
    /* ولا نقطة فاصلة معلّقة آخر السطر: كل نقطة ظاهرة على سطر الرابط اللي بعدها */
    eq(await page.evaluate(() => [...document.querySelectorAll('.legal-foot > span')]
         .filter(d => d.getBoundingClientRect().width > 0)
         .filter(d => { const n = d.nextElementSibling;
           return !n || Math.round(n.getBoundingClientRect().top) !== Math.round(d.getBoundingClientRect().top) })
         .length), 0, 'ولا نقطة فاصلة معلّقة آخر سطر (البريد ينزل سطر لحاله في الجوال)');
    /* ما يغطّيه زر الدليل العائم — آخر سطر فيه */
    const hit = await page.evaluate(() => {
      const el = document.querySelector('.legal-note');
      if (!el) return 'بلا سطر';
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return at && (at === el || el.contains(at)) ? 'ok' : (at ? at.className || at.tagName : 'لا شي');
    });
    eq(hit, 'ok', 'آخر سطر فيه ما يغطّيه شي');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `legal-foot-${scheme}.png`) });
    /* والإنجليزي: الروابط بأسمائها الإنجليزية، وبلا سطر سجل كذلك */
    await page.evaluate(() => { LANG = 'en'; applyLang() });
    const en = await page.evaluate(() => document.querySelector('.legal-foot').textContent.replace(/\s+/g, ' '));
    ok(/About/.test(en) && /Terms of Service/.test(en) && !en.includes(CR), 'بالإنجليزي: الروابط وبلا سجل — ' + en);
    if (SHOTS && scheme === 'dark') await page.screenshot({ path: path.join(SHOTS, 'legal-foot-en.png') });
    await page.evaluate(() => { LANG = 'ar'; applyLang() });
    /* وفي باقي الشاشات كذلك — كان في الإعدادات وحدها */
    for (const tab of ['search', 'plan', 'set']) {
      await page.evaluate(t => switchTab(t), tab);
      eq(await page.evaluate(() => { const el = document.querySelector('.legal-foot');
           return !!el && el.getBoundingClientRect().height > 0 }), true, `والتذييل ظاهر في «${tab}» كذلك`);
    }
    eq(errs, [], `بلا أخطاء (${scheme})`);
    await ctx.close();
  }

  await browser.close();
  server.close();
  done();
})().catch(e => {
  console.log('انهار: ' + (e && e.stack || e));
  fail++;
  done();
});

function done() {
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}
