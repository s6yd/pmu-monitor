/* الدليل داخل الموقع يغطي الميزات الجديدة — مراجعة المساعد (١٩ نوفمبر ٢٠٢٦، طلب محمد: «ابيك تراجع ال ai … ابي يكون ذكي»).
   أداة الدليل في المساعد تقرأ GUIDE (shared/plans.js)، وما كان فيه شي عن ميزات أكتوبر ونوفمبر: الاستيراد من بانر
   وDegree Works · القاعات الفاضية · Jadwalik AI نفسه · بطاقة «مراقبتك» · تثبيت الموقع على الجوال. فـ«كيف أستورد جدولي؟»
   ما له مصدر — والنموذج يخمّن أو يقول «ما أعرف».

   أخطار يمسكها:
   ١) ميزة موجودة في الموقع وما لها سطر في الدليل (والمساعد ما يعرف يشرحها).
   ٢) الدليل يسمّي زراً باسم غير اسمه في الصفحة (الطالب يدوّر على زر ما يلقاه).
   ٣) رقم في الدليل يخالف السيرفر (فاصل الفحص أيام التسجيل).

   node tests/test-guide-new.js [server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ROOT = path.dirname(SRV);
const SHARED = path.join(ROOT, 'shared', 'plans.js');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const done = () => { out.forEach(l => console.log(l)); console.log(`\nالدليل والميزات الجديدة: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

const src = fs.readFileSync(SRV, 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'pmu-schedule.html'), 'utf8');
delete require.cache[require.resolve(SHARED)];
const PLANS_DATA = require(SHARED);
const G = PLANS_DATA.GUIDE;
const items = L => G[L].sections.flatMap(s => s.items.map(i => Object.assign({ sec: s.name }, i)));
const find = (L, t) => items(L).find(i => i.t === t);
/* نص سطر الدليل بلا وسوم — اللي يقرأه الطالب والمساعد */
const plain = h => String(h || '').replace(/<[^>]+>/g, '');

/* ═══ ١) سطر لكل ميزة — بالعربي والإنجليزي ═══ */
const WANT = [
  ['جدولك من بانر بضغطة', 'Your schedule from Banner'],
  ['خطتك من Degree Works', 'Your plan from Degree Works'],
  ['ثبّته على جوالك', 'Install it on your phone'],
  ['اسأل بدل ما تدوّر', 'Ask instead of searching'],
  ['يجهّز وأنت تأكّد', 'It prepares, you confirm'],
  ['وش يعرف عنك', 'What it knows about you'],
  ['قاعة فاضية', 'A free room'],
  ['«مراقبتك» فوق البحث', '“Your watches” above Search'],
];
for (const [ar, en] of WANT) {
  ok(!!find('ar', ar), `**الدليل فيه «${ar}»**`);
  ok(!!find('en', en), `والإنجليزي «${en}»`);
}
ok(G.ar.sections.some(s => s.name === 'Jadwalik AI') && G.en.sections.some(s => s.name === 'Jadwalik AI'),
   '**قسم Jadwalik AI في الدليل** (باسمه الواحد — علامة تجارية)');
ok(G.ar.sections.length === G.en.sections.length &&
   G.ar.sections.every((s, i) => s.items.length === G.en.sections[i].items.length),
   'العربي والإنجليزي بنفس الأقسام والسطور');

/* ═══ ٢) أسماء الأزرار كما في الصفحة حرفياً ═══ */
const quoted = (L, t) => [...String((find(L, t) || {}).d || '').matchAll(/<b>([^<]+)<\/b>/g)].map(m => m[1]);
const has = s => PAGE.includes(s);
for (const [L, t, btn] of [
  ['ar', 'جدولك من بانر بضغطة', '📥 استورد جدولك من بانر'], ['en', 'Your schedule from Banner', '📥 Import from Banner'],
  ['ar', 'خطتك من Degree Works', '📥 استورد درجاتك من Degree Works'], ['en', 'Your plan from Degree Works', '📥 Import grades from Degree Works'],
  ['ar', 'قاعة فاضية', '🚪 قاعة فاضية'], ['en', 'A free room', '🚪 Free room'],
  ['ar', '«مراقبتك» فوق البحث', 'تراقبها'], ['ar', '«مراقبتك» فوق البحث', 'مفتوحة الحين'], ['ar', '«مراقبتك» فوق البحث', 'الفحص الجاي'],
  ['en', '“Your watches” above Search', 'Open now'], ['en', '“Your watches” above Search', 'Next check'],
]) {
  ok(quoted(L, t).includes(btn) && has(btn), `**«${btn}» في الدليل واسمه في الصفحة نفسه** (${L})`);
}
ok(has(">${ar?'مراقبتك':'Your watches'}") || (has("'مراقبتك'") && has("'Your watches'")), 'وعنوان البطاقة «مراقبتك» / Your watches في الصفحة');
for (const tab of ['📅 جدولي', '📋 خطتي', '🔍 البحث', '📅 Schedule', '📋 My Plan', '🔍 Search'])
  ok(has(`'${tab}`), `والتبويب «${tab}» اسمه في الصفحة`);
ok(/command:\s*'ai'/.test(src) && /\/ai/.test(plain(find('ar', 'اسأل بدل ما تدوّر') && find('ar', 'اسأل بدل ما تدوّر').d)),
   '/ai في الدليل وأمره في قائمة البوت');
ok(/<b dir="ltr">\/ai<\/b>/.test((find('ar', 'اسأل بدل ما تدوّر') || {}).d || ''),
   '«/ai» وسط العربي معزول الاتجاه — بلاه يطلع «ai/»');
ok(/pathname === '\/guide'/.test(src) && /href="\/guide"/.test((find('ar', 'ثبّته على جوالك') || {}).d || ''),
   'رابط «دليل الصور» يودّي لصفحة موجودة (/guide)');

/* ═══ ٣) الأرقام تطابق السيرفر ═══ */
const hot = Number(((/const INTERVAL_HOT = (\d+) \* 60 \* 1000/.exec(src)) || [])[1]);
ok(hot === 2 && /كل دقيقتين أيام التسجيل/.test(plain((find('ar', 'راقب المواد المسكّرة') || {}).d)) &&
   /every 2 minutes on registration days/.test(plain((find('en', 'Monitor closed sections') || {}).d)),
   '**فاصل الفحص أيام التسجيل في الدليل = السيرفر (دقيقتين)**');

/* ═══ ٤) المساعد يقرأها بأداة الدليل ═══ */
{
  const i0 = src.indexOf('/* ═══════════ أدوات المساعد — القراءة'), j0 = src.indexOf('/* ═══ نهاية أدوات المساعد ═══');
  const ci = src.indexOf('const ACAD_CAL = ['), cj = src.indexOf('\n];', ci);
  const ACAD_CAL = new Function(src.slice(ci, cj + 3) + '; return ACAD_CAL;')();
  const ctxObj = { console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error,
    encodeURIComponent, setTimeout, clearTimeout, Map, Set, PLANS_DATA, ACAD_CAL, FREE_BETA: true, SITE_ENV: 'prod',
    riyadhNow: () => new Date('2026-11-19T09:00:00Z'), activeTerm: () => '202710', regTerm: () => '202710',
    nextRegTerm: () => '202720', currentWindow: () => null, sb: () => Promise.resolve([]), hasAccess: () => true,
    coursesCache: new Map(), finalsCache: {}, PRICING: {}, pushoverOn: () => false, usageLog: () => {} };
  vm.createContext(ctxObj);
  let run = null;
  try { vm.runInContext(src.slice(i0, j0) + '\nthis.AI_TOOLS=AI_TOOLS;', ctxObj); run = ctxObj.AI_TOOLS.guide.run }
  catch (e) { ok(false, 'أداة الدليل تشتغل — ' + String(e).slice(0, 120)) }
  if (run) {
    const r = JSON.stringify(run({}, { lang: 'ar' }));
    ok(/استورد جدولك من بانر/.test(r) && /قاعة فاضية/.test(r) && /Jadwalik AI/.test(r) && /Add to Home Screen/.test(r),
       '**«كيف أستورد جدولي؟» · «وين قاعة فاضية؟» · «كيف أثبّته؟»: أداة الدليل ترجّعها للمساعد**');
    ok(/Import from Banner/.test(JSON.stringify(run({}, { lang: 'en' }))), 'وبالإنجليزي كذلك');
  }
}
done();
