/* المساعد داخل البوت — اختبار سلوكي (CLAUDE.md §٩-أ-٥).
   يشغّل aiTgRoute الحقيقية في vm.

   ستة أخطار يمسكها:
   ١) المساعد يبلع الكلام الحر فما عاد أحد يقدر يكلّم الفريق.
      (والكلام الحر نفسه — المساعد ولا الفريق؟ — في test-tg-ask.js)
   ٢) /stop ينخطف من إيقاف الإشعارات.
   ٣) غير المربوط يسأل فيرجع خطأ غامض — أو يوصل لأدوات تحتاج حسابه.
   ٤) الأفعال تُنفّذ من البوت بلا حراسات الصفحة (التذكير وحده بفحوص السيرفر)،
      أو تُحال للموقع على شي ما هو موجود فيه.
   ٥) أمر في قائمة البوت ما له معالج — الطالب يضغطه فما يصير شي.
   ٦) الطالب داخل وضع المساعد وما يدري، فيكتب للدعم وهو يظن العكس.

   node tests/test-tg-ai.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };
/* نص أزرار اللوحة كلها في سطر واحد — للفحص */
const kbText = m => ((m && m.keyboard) || [])
  .reduce((a, row) => a.concat(row.map(b => b.text)), []).join(' | ');
const kbHas = (m, w) => kbText(m).includes(w);

const src = fs.readFileSync(SRV, 'utf8');
const L = src.split('\n');
const i = L.findIndex(x => x.startsWith('/* ═══ المساعد داخل البوت'));
const j = L.findIndex((x, n) => n > i && x.startsWith('/* ═══ دورة التذكيرات'));
ok(i >= 0 && j > i, 'منطقة المساعد في البوت موجودة');
if (i < 0 || j <= i) done();
const REGION = L.slice(i, j).join('\n');

let SENT, ASKED, LINKED, REPLY;
function makeCtx() {
  SENT = []; ASKED = []; LINKED = true;
  REPLY = { ok: true, answer: 'جوابك', proposal: null };
  const ctx = {
    console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date,
    RegExp, Error, encodeURIComponent, Map, Set,
    esc: v => String(v == null ? '' : v),
    sendMsg: (chat, text, markup) => { SENT.push({ chat, text, markup });
      return Promise.resolve({ ok: true }) },
    sb: (m, t, o) => Promise.resolve(
      (t === 'profiles' && LINKED) ? [{ id: 'u-1' }] : []),
    /* o: خيارات المدخل — زائر تلقرام يمرّر أدواته وحدّه */
    aiChat: (uid, q, o) => { ASKED.push({ uid, q, o }); return Promise.resolve(REPLY) },
    btn: (label, data) => ({ text: label, callback_data: data }),
    kb: rows => ({ inline_keyboard: rows }),
  };
  vm.createContext(ctx);
  /* try: على كود قديم بلا AI_TG_PROP نبلّغ فشلاً مرتّباً بدل انهيار */
  vm.runInContext(REGION + '\nthis.aiTgRoute=aiTgRoute;this.AI_TG_MODE=AI_TG_MODE;'
    + 'try{this.AI_TG_PROP=AI_TG_PROP}catch(e){this.AI_TG_PROP=new Map()}', ctx);
  return ctx;
}
/* أزرار الفعل (inline) في رسالة — للفحص */
const acts = m => (((m && m.markup) || {}).inline_keyboard || [])
  .reduce((a, row) => a.concat(row), []);

(async () => {
  /* ── ١) الكلام الحر ما ياخذه المساعد بلا اختيار ── */
  let c = makeCtx();
  eq(await c.aiTgRoute(7, 'عندي مشكلة في الموقع'), false,
     '**كلام حر خارج الوضع ما ياخذه المساعد** — يكمّل لفرع الكلام الحر (الطالب يختار)');
  eq(ASKED.length, 0, 'وما سأل النموذج');
  eq(SENT.length, 0, 'وما رد');
  eq(await c.aiTgRoute(7, '/stop'), false,
     '**/stop ما ينخطف** — هو لإيقاف الإشعارات');
  eq(await c.aiTgRoute(7, '/status'), false, 'ولا بقية الأوامر');

  /* ── ٢) /ai بسؤال ── */
  c = makeCtx();
  eq(await c.aiTgRoute(7, '/ai وش عندي بكرة؟'), true, '/ai بسؤال يتعامل معه');
  eq(ASKED.length, 1, 'وسأل النموذج مرة');
  eq(ASKED[0].q, 'وش عندي بكرة؟', 'بالسؤال بلا الأمر');
  eq(ASKED[0].uid, 'u-1', 'وبهوية صاحب المحادثة من حسابه المربوط');
  ok(/جوابك/.test(SENT[0].text), 'ورد بالجواب');
  /* **قاعدة تغيّرت عمداً — من تجربة محمد على dev:**
     المساعد يسأل أسئلة متابعة («تبي أبني لك جدول بهالمواد؟»)، وكان
     `/ai بسؤال` يجاوب مرة وحدة بلا وضع — فردّ محمد الطبيعي راح للدعم
     **كتذكرة #74**. صار الجواب الناجح يدخله الوضع، والخروج زر ظاهر. */
  ok(!!SENT[0].markup, '**والجواب يرفع اللوحة** — الوضع يبان');
  eq(await c.aiTgRoute(7, 'سؤال ثانٍ'), true,
     '**وردّه بعده يروح للمساعد لا للدعم** — المساعد سأله سؤالاً');
  eq(ASKED[1] && ASKED[1].q, 'سؤال ثانٍ', 'بنصّه كما هو');

  /* ── ٣) /ai بلا سؤال يدخل الوضع ── */
  c = makeCtx();
  eq(await c.aiTgRoute(7, '/ai'), true, '/ai وحده يدخل الوضع');
  eq(ASKED.length, 0, 'وما يسأل النموذج بلا سؤال');
  ok(/مساعد جدولك/.test(SENT[0].text), 'ويشرح');
  ok(/خروج/.test(SENT[0].text), 'ويقول كيف يخرج');
  eq(await c.aiTgRoute(7, 'كم باقي لي؟'), true, 'وبعده الكلام يروح للمساعد');
  eq(ASKED[0].q, 'كم باقي لي؟', 'كما هو');
  /* **قاعدة تغيّرت عمداً:** كان كل رد يعيد سطر «/خروج للخروج».
     صار الخروج **زراً ظاهراً دائماً** في لوحة الأزرار، فالسطر المكرر
     شيلناه — التذكير أقوى لا أضعف: باقٍ تحت الشاشة لا في نص يمرّ. */
  ok(!!SENT[1].markup, '**والجواب يحمل لوحة الأزرار** — الوضع يبان');
  ok(kbHas(SENT[1].markup, 'خروج'), 'وفيها زر خروج');
  /* والأوامر تبقى أوامر داخل الوضع */
  eq(await c.aiTgRoute(7, '/stop'), false, '**و/stop يبقى للإشعارات داخل الوضع**');
  eq(await c.aiTgRoute(7, '/status'), false, 'وبقية الأوامر كذلك');
  /* الخروج */
  eq(await c.aiTgRoute(7, '/خروج'), true, 'و/خروج يخرجه');
  /* **قاعدة تغيّرت عمداً — قرار محمد:** كانت رسالة الخروج تقول «كلامك
     بعد كذا يوصل الدعم»، لأن الكلام الحر كله كان تذكرة. صار الكلام الحر
     الجديد يسأل الطالب: المساعد ولا الفريق (test-tg-ask.js) — فالوعد
     صار كذباً. تقول إنه خرج وكيف يرجع، والسؤال يجيه مع رسالته الجاية. */
  const byeTxt = SENT[SENT.length - 1].text;
  ok(/خرجت/.test(byeTxt) && /\/ai/.test(byeTxt), 'ويقول إنه خرج وكيف يرجع');
  ok(!/يوصل الدعم/.test(byeTxt), '**وما يوعده إن كلامه يوصل الدعم مباشرة** — صار يُسأل');
  eq(await c.aiTgRoute(7, 'كلام عادي'), false, '**وبعدها ما ياخذ المساعد كلامه فعلاً**');

  /* ── ٤) محادثتان ما تتداخلان ── */
  c = makeCtx();
  await c.aiTgRoute(7, '/ai');
  eq(await c.aiTgRoute(9, 'كلام من ثانٍ'), false,
     'ووضع محادثة ما يفتح وضع غيرها');

  /* ── ٥) غير المربوط ──
     **قاعدة تغيّرت عمداً — قرار محمد:** كان يرد «اربط حسابك» وبس ولا
     يسأل المساعد. صار المساعد يساعده **في استعمال الموقع وحده** (أداة
     الدليل)، وأي شي ثاني «اربط حسابك». فالنموذج يُسأل — كزائر، بأدوات
     الدليل وحدها وحدّه اليومي بمحادثته. */
  c = makeCtx(); LINKED = false;
  eq(await c.aiTgRoute(7, '/ai سؤال'), true, 'غير المربوط يتعامل معه');
  eq(ASKED.length, 1, 'ويسأل المساعد كزائر');
  eq((ASKED[0] || {}).uid, null, '**بلا هوية** — ما نخترع له حساباً');
  const go = (ASKED[0] || {}).o || {};
  eq(go.tgGuest, true, 'زائر تلقرام');
  eq([...(go.tools || [])], ['guide'], '**أدواته الدليل وحده** — استعمال الموقع لا غيره');
  eq(go.ip, 'tg:7', 'وحدّه اليومي بمحادثته — تلقرام ما يعطينا عنوان شبكته');
  ok(/اربط/.test(SENT[0].text), 'ويقول له يربط حسابه عشان جدوله وخطته');
  ok(/jadwalik/.test(SENT[0].text), 'ويعطيه الرابط');
  /* سأل عن شي يحتاج حسابه: خطوات الربط كاملة لا صياغة النموذج وحدها */
  c = makeCtx(); LINKED = false;
  REPLY = { ok: true, answer: 'لازم تربط حسابك', proposal: null, signIn: true };
  await c.aiTgRoute(7, '/ai وش عندي بكرة؟');
  ok(/1️⃣[\s\S]*2️⃣[\s\S]*3️⃣/.test((SENT[0] || {}).text || ''),
     '**وصل حدّ الزائر: خطوات الربط مرقّمة**');
  /* سقفا الزوار بصياغة تلقرام: «من شبكتك» ما تنطبق هنا */
  for (const why of ['day', 'guests']) {
    c = makeCtx(); LINKED = false;
    REPLY = { ok: false, why, answer: 'خلصت أسئلة الزوار من شبكتك لهذا اليوم. سجّل دخولك بقوقل', proposal: null };
    await c.aiTgRoute(7, '/ai سؤال');
    const tx = (SENT[0] || {}).text || '';
    ok(!/شبكتك/.test(tx) && /اربط/.test(tx), `سقف الزوار (${why}) بصياغة تلقرام — ${tx.slice(0, 40)}`);
  }
  REPLY = { ok: true, answer: 'جوابك', proposal: null };

  /* ── ٦) الأفعال ──
     **قاعدة تغيّرت عمداً:** كانت كلها «افتح jadwalik.com واضغط تأكيد» —
     والموقع ما يعرض اقتراحات تلقرام أصلاً، فطريق مسدود. صار التذكير
     وتذكرة الدعم يتأكدان من البوت (زر)، وباقيها إحالة صادقة. */
  c = makeCtx();
  REPLY = { ok: true, answer: 'جهّزت لك', proposal: { action: 'absence' } };
  await c.aiTgRoute(7, '/ai سجّل غياب');
  ok(/تأكيد/.test(SENT[0].text), 'الاقتراح يُحال للتأكيد');
  ok(/jadwalik/.test(SENT[0].text), '**الغياب للموقع — حراساته في دوال الصفحة**');
  ok(/اطلبه هناك/.test(SENT[0].text),
     '**والإحالة صادقة: يطلبه من المساعد هناك** — لا «اضغط تأكيد» على شي ما هو موجود');
  eq(acts(SENT[0]).length, 0, 'وبلا أزرار فعل في البوت');
  /* التذكير: زر تثبيت في البوت نفسه */
  c = makeCtx();
  REPLY = { ok: true, answer: 'جهّزت لك التذكير', proposal: { action: 'reminder',
    at: '2099-01-01T06:00:00.000Z', atLocal: '2099-01-01 09:00', body: 'أذاكر', crn: null, env: 'prod' } };
  await c.aiTgRoute(7, '/ai ذكّرني بكرة ٩ أذاكر');
  const ra = acts(SENT[0]);
  ok(ra.some(b => /ثبّت/.test(b.text) && /^act:ok:\d+$/.test(b.callback_data)),
     '**التذكير: زر «✅ ثبّت» في البوت** — ' + JSON.stringify(ra.map(b => b.text)));
  ok(ra.some(b => /^act:no:\d+$/.test(b.callback_data)), 'وزر «لا»');
  ok(!/افتح المساعد في jadwalik/.test(SENT[0].text), 'وما يحيله للموقع');
  const pid = ((ra[0] || {}).callback_data || '').split(':')[2];
  const saved = c.AI_TG_PROP.get(pid) || {};
  eq([saved.chat, saved.uid, (saved.p || {}).action], ['7', 'u-1', 'reminder'],
     'الاقتراح محفوظ بمحادثته وصاحبه — الزر يحمل رقمه بس');
  /* تذكرة الدعم: زر يرسلها للفريق */
  c = makeCtx();
  REPLY = { ok: true, answer: 'جهّزت لك الرسالة', proposal: { action: 'support',
    text: 'الموقع يعلّق', category: 'bug', context: { major: 'COSC' } } };
  await c.aiTgRoute(7, '/ai في مشكلة');
  ok(acts(SENT[0]).some(b => /فريق جدولك/.test(b.text) && /^act:ok:/.test(b.callback_data)),
     '**تذكرة الدعم: زر «أرسلها لفريق جدولك» في البوت**');

  /* ── ٧) الأعطال ── */
  c = makeCtx();
  c.aiChat = () => Promise.reject(new Error('انهار'));
  let threw = false;
  try { await c.aiTgRoute(7, '/ai سؤال') } catch (e) { threw = true }
  ok(!threw, 'وخطأ في النموذج ما يرمي');
  ok(SENT.length && /خلل/.test(SENT[0].text), 'ويرد برسالة مفهومة');


  /* ── ٩) لوحة الأزرار: الوضع يبان ── */
  c = makeCtx();
  await c.aiTgRoute(7, '/ai');
  const intro = SENT[0];
  ok(!!intro.markup && Array.isArray(intro.markup.keyboard),
     '**الدخول يرفع لوحة أزرار** — الطالب يشوف إنه داخل المساعد');
  const KB = intro.markup || {};
  ok(KB.resize_keyboard === true, 'وبحجم مناسب للجوال');
  ok(KB.is_persistent === true, 'وتبقى ظاهرة');
  ok(kbHas(KB, 'خروج'), 'وفيها زر خروج — ' + kbText(KB));
  ok(kbText(KB).length > 20, 'وفيها أمثلة تعلّمه وش يسأل — ' + kbText(KB));
  /* الأمثلة في اللوحة أسئلة حقيقية لا أوامر */
  ok(!/^\//.test(kbText(KB)), 'والأمثلة أسئلة لا أوامر');
  /* ملاحظة محمد: الأمثلة أبواب مختلفة لا كلها عن الجدول، ومنها التذكير —
     والطالب يعرف إنه يسأل أي شي، والأزرار أمثلة بس */
  ok(/ذكّرني/.test(kbText(KB)), '**وفيها مثال تذكير** — مو كلها عن الجدول — ' + kbText(KB));
  ok(/أي شي/.test(KB.input_field_placeholder || ''),
     '**والحقل يقول «اسألني أي شي»** — ' + KB.input_field_placeholder);
  ok(/أي شي/.test(intro.text) && /أمثلة/.test(intro.text), 'والمقدمة تقول إن الأزرار أمثلة');
  ok(/عبّيته/.test(intro.text), '**والمقدمة تقول إن جدوله وخطته من اللي عبّاه**');

  /* زر «🚪 خروج» يخرجه — الطالب ضغط زراً مكتوب فيه خروج */
  eq(await c.aiTgRoute(7, '🚪 خروج'), true, '**وزر «🚪 خروج» يخرجه فعلاً**');
  const bye = SENT[SENT.length - 1] || {};
  ok(bye.markup && bye.markup.remove_keyboard === true,
     '**واللوحة تُشال عند الخروج** — ما تبقى تكذب عليه');
  eq(await c.aiTgRoute(7, 'كلام عادي'), false, 'وكلامه ما يروح للمساعد');

  /* و«خروج» وحدها داخل الوضع كذلك — لكن ما تُخطف خارجه */
  c = makeCtx();
  eq(await c.aiTgRoute(7, 'خروج'), false,
     '**«خروج» خارج الوضع تبقى كلاماً حراً** — ما نخطف كلمة عادية');
  await c.aiTgRoute(7, '/ai');
  eq(await c.aiTgRoute(7, 'خروج'), true, 'وداخل الوضع تخرجه');

  /* ── ٩ب) لوحة باقية بعد انتهاء الوضع ── */
  c = makeCtx();
  await c.aiTgRoute(7, '/ai');
  const btn = kbText((SENT[0] || {}).markup || {}).split(' | ')[0] || 'وش عندي بكرة؟';
  c.AI_TG_MODE.clear();                                       /* الوضع انتهى */
  eq(await c.aiTgRoute(7, btn), true,
     '**ضغطة زر بعد انتهاء الوضع ترجع للمساعد** — لا تفتح تذكرة دعم');
  eq(ASKED.length, 1, 'ويُسأل النموذج');
  eq((ASKED[0] || {}).q, btn, 'بنص الزر');
  /* وزر الخروج بعد انتهاء الوضع يشيل اللوحة بدل ما يفتح تذكرة */
  c = makeCtx();
  await c.aiTgRoute(7, '/ai');
  c.AI_TG_MODE.clear();
  eq(await c.aiTgRoute(7, '🚪 خروج'), true,
     '**وزر الخروج بعد انتهائه يشيل اللوحة** — لا تذكرة اسمها «خروج»');
  ok(((SENT[SENT.length - 1] || {}).markup || {}).remove_keyboard === true, 'واللوحة تُشال');
  /* لكن كلمة «خروج» المكتوبة بلا زر تبقى كلاماً حراً */
  c = makeCtx();
  eq(await c.aiTgRoute(7, 'خروج'), false, 'وكلمة «خروج» وحدها تبقى كلاماً حراً');

  /* ── ٩ج) أول دخول بلا مقدمة (زر المساعد أو /ai بسؤال): سطر التوضيح مرة ── */
  c = makeCtx();
  await c.aiTgRoute(7, '/ai وش عندي بكرة؟');
  const h1 = (SENT[0] || {}).text || '';
  ok(/💡/.test(h1) && /أي شي/.test(h1) && /أمثلة/.test(h1),
     '**أول جواب يقول «اسألني أي شي» والأزرار أمثلة** — ما شاف المقدمة');
  ok(/عبّيته/.test(h1), '**ويقول إن جدوله وخطته من اللي عبّاه**');
  await c.aiTgRoute(7, 'وبعده؟');
  ok(!/💡/.test((SENT[1] || {}).text || ''), 'والجواب الثاني بلا تكرار');
  /* أزرار لوحة الزائر، والمثال القديم من اللوحة اللي قبل: للمساعد لا للدعم */
  for (const b of ['كيف أراقب شعبة؟', 'وش أنزل الترم الجاي؟']) {
    c = makeCtx();
    eq(await c.aiTgRoute(7, b), true, `زر «${b}» بعد انتهاء الوضع يرجع للمساعد`);
  }
  /* /ai لغير المربوط: مقدمته عن استعمال الموقع وخطوات الربط، ولوحته منها */
  c = makeCtx(); LINKED = false;
  await c.aiTgRoute(7, '/ai');
  const gi = SENT[0] || {};
  ok(/استعمال الموقع/.test(gi.text || '') && /1️⃣/.test(gi.text || ''),
     'مقدمة غير المربوط: استعمال الموقع + خطوات الربط');
  ok(/أراقب/.test(kbText(gi.markup || {})), 'ولوحته أمثلة عن استعمال الموقع');
  ok(!/ذكّرني|أتخرج/.test(kbText(gi.markup || {})), 'لا أمثلة يحتاج لها حساباً');

  /* ── ١٠) الاختصارات: سؤال جاهز بلا وضع ── */
  for (const [cmd, q] of [['/today', 'اليوم'], ['/rooms', 'قاعة'], ['/plan', 'أتخرج']]) {
    c = makeCtx();
    eq(await c.aiTgRoute(7, cmd), true, `${cmd} يتعامل معه`);
    eq(ASKED.length, 1, `${cmd} يسأل النموذج مرة`);
    ok(new RegExp(q).test((ASKED[0] || {}).q || ''),
       `${cmd} بسؤال معناه «${q}» — ${(ASKED[0] || {}).q}`);
    ok(!!(SENT[0] || {}).markup, `${cmd} يرفع اللوحة — الوضع يبان`);
    eq(await c.aiTgRoute(7, 'كلام بعده'), true,
       `**${cmd} يخلّي ردّه يروح للمساعد** — سأله فيرد عليه`);
  }

  /* ── ١٠ب) المساعد مقفل: الأمر ما يودّي لطريق مسدود ── */
  for (const why of ['off', 'admin', 'nokey']) {
    c = makeCtx();
    REPLY = { ok: false, why, answer: 'المساعد مقفل حالياً', proposal: null };
    await c.aiTgRoute(7, '/today');
    ok(/jadwalik/.test((SENT[0] || {}).text || ''),
       `**وضع ${why}: يدلّه على الموقع** — الأمر في القائمة وعده بشي`);
  }
  /* ولما يشتغل عادي ما نحشر الرابط في كل رد */
  c = makeCtx();
  await c.aiTgRoute(7, '/today');
  ok(!/jadwalik/.test((SENT[0] || {}).text || ''), 'والجواب الناجح بلا رابط زائد');

  /* ── ١٠ج) الحدّ: ما ندخله وضعاً على جواب ما صار ── */
  for (const why of ['off', 'admin', 'nokey']) {
    c = makeCtx();
    REPLY = { ok: false, why, answer: 'المساعد مقفل حالياً', proposal: null };
    await c.aiTgRoute(7, '/ai سؤال');
    ok(!(SENT[0] || {}).markup, `وضع ${why}: ولا لوحة — ما فيه وضع`);
    eq(await c.aiTgRoute(7, 'كلام بعده'), false,
       `**وضع ${why}: الكلام ما ينحبس في المساعد** — ما نحبسه في وضع ما يجاوب`);
  }
  /* والسقف اليومي كذلك */
  c = makeCtx();
  REPLY = { ok: false, why: 'day', answer: 'خلّصت أسئلة اليوم', proposal: null };
  await c.aiTgRoute(7, '/ai سؤال');
  eq(await c.aiTgRoute(7, 'كلام بعده'), false,
     '**والسقف كذلك** — الكلام ما ينحبس في المساعد');
  /* غير المربوط: **قاعدة تغيّرت عمداً — قرار محمد.** كان ما يدخل وضعاً
     لأنه ما يُجاوَب أصلاً. صار يُجاوَب عن استعمال الموقع، فجوابه الناجح
     يدخله الوضع مثل غيره — ولوحته أمثلة من استعمال الموقع لا جدوله. */
  c = makeCtx(); LINKED = false;
  await c.aiTgRoute(7, '/ai سؤال');
  ok(/أراقب/.test(kbText((SENT[0] || {}).markup || {})), 'غير المربوط: لوحته لوحة الزائر');
  eq(await c.aiTgRoute(7, 'كلام بعده'), true,
     'وجوابه الناجح يدخله الوضع — سؤاله الجاي للمساعد');

  /* ── ١١) قائمة أوامر البوت ── */
  {
    const a = L.findIndex(x => x.startsWith('/* ═══ قائمة أوامر البوت'));
    const b = L.findIndex((x, n) => n > a && x.startsWith('/* بلا await: فكّ الربط'));
    ok(a >= 0 && b > a, 'منطقة قائمة الأوامر موجودة');
    if (a >= 0 && b > a) {
      const CALLS = [];
      const mk = env => {
        const cx = { console: { log() {} }, Promise, JSON, Object, Array, String,
          Number, Math, Date, RegExp, Error,
          TELEGRAM_TOKEN: 'tok', SITE_ENV: env,
          tg: (method, payload) => { CALLS.push({ method, payload });
            return Promise.resolve({ ok: true }) } };
        vm.createContext(cx);
        vm.runInContext(L.slice(a, b).join('\n')
          + '\nthis.BOT_COMMANDS=BOT_COMMANDS; this.tgSetCommands=tgSetCommands;'
          + 'this.botCommandsBad=botCommandsBad;', cx);
        return cx;
      };

      const P = mk('prod');
      const C = P.BOT_COMMANDS;
      ok(Array.isArray(C) && C.length >= 7, 'القائمة فيها سبعة أوامر فأكثر — ' + C.length);
      ok(C.length <= 100, 'وما تتجاوز حد تيليغرام');
      /* شرط تيليغرام: [a-z0-9_] وحروف صغيرة، ووصف ≤ ٢٥٦ */
      eq(P.botCommandsBad(C), [], '**وكل اسم يطابق شرط تيليغرام** — وإلا رُفضت كلها');
      ok(C.every(x => /[؀-ۿ]/.test(x.description)),
         'وكل وصف بالعربي — الطالب يقرأه لا يفكّه');
      eq([...new Set(C.map(x => x.command))].length, C.length, 'ولا أمر مكرر');

      /* **الأهم: القائمة تعلّم** — فيها الميزات لا الربط والإيقاف وبس */
      const names = C.map(x => x.command);
      for (const must of ['ai', 'watch', 'rooms', 'today', 'plan', 'help'])
        ok(names.includes(must), `القائمة فيها /${must}`);

      /* **ولا أمر في القائمة بلا معالج** — يضغطه الطالب فما يصير شي */
      const listBlock = L.slice(a, b).join('\n');
      const rest = src.split(listBlock).join('');
      for (const n of names)
        ok(rest.includes(`'/${n}'`) || rest.includes(`/${n} `) || rest.includes(`'/${n} `),
           `**/${n} له معالج في البوت**`);

      /* الضبط من الإنتاج وحده */
      CALLS.length = 0;
      await P.tgSetCommands();
      eq(CALLS.map(x => x.method), ['setMyCommands'], 'الإنتاج يضبط القائمة');
      eq(CALLS[0].payload.commands.length, C.length, 'بكل الأوامر');
      ok(CALLS[0].payload.scope && CALLS[0].payload.scope.type === 'all_private_chats',
         'وللمحادثات الخاصة');
      CALLS.length = 0;
      const D = mk('dev');
      await D.tgSetCommands();
      eq(CALLS, [], '**وdev ما يلمسها** — البوت واحد والقائمة له لا للخدمة');

      /* اسم مخالف يُرفض قبل الإرسال لا بعده */
      ok(P.botCommandsBad([{ command: 'AI', description: 'x' }]).length,
         'اسم بحروف كبيرة يُرفض');
      ok(P.botCommandsBad([{ command: 'my-cmd', description: 'x' }]).length,
         'واسم فيه شرطة يُرفض');
      ok(P.botCommandsBad([{ command: 'ok', description: '' }]).length,
         'ووصف فاضي يُرفض');
      ok(P.botCommandsBad([{ command: 'ok', description: 'x'.repeat(257) }]).length,
         'ووصف أطول من ٢٥٦ يُرفض');
    }
  }

  /* ── ١٢) /help و/watch: نصوص ثابتة تعلّم بلا نموذج ولا قاعدة ── */
  {
    const hi = src.indexOf('الدليل والمراقبة — يعلّمان لا يردّان فقط');
    ok(hi > 0, 'كتلة /help و/watch موجودة');
    /* الكتلة تنتهي عند نداء المساعد — بعده فرع الدعم وفيه sb() */
    const he = src.indexOf('if (await aiTgRoute(chatId, text)) return;', hi);
    ok(he > hi, 'ونهايتها معروفة');
    const blk = src.slice(hi, he);
    ok(/text === '\/help'/.test(blk), '/help له معالج');
    ok(/text === '\/watch'/.test(blk), '/watch له معالج');
    ok(!/aiChat|sb\(/.test(blk), '**وما ينادي نموذجاً ولا قاعدة** — يشتغلان للجميع بلا كلفة');
    ok(/jadwalik\.com/.test(blk), 'ويوديانه للموقع');
    ok(/1️⃣[\s\S]*2️⃣[\s\S]*3️⃣/.test(blk), 'وشرح المراقبة خطوات مرقّمة');

    /* **ولا يشرح زراً ما هو موجود.** أول صياغة كتبناها قالت «اضغط ➕»
       والصحيح 🔕 — و➕ زر إضافة للجدول لا مراقبة. طالب يتبع شرحاً غلطاً
       يظن إن الموقع خربان. فنقرأ الصفحة نفسها ونطابق. */
    const PG = fs.readFileSync(PAGE, 'utf8');
    const wi = PG.indexOf('toggleMonitorCourse(');
    const wblk = PG.slice(Math.max(0, wi - 400), wi + 400);
    const watchBlk = blk.slice(blk.indexOf('/watch'));
    for (const ic of (watchBlk.match(/[🔕🔔📡➕✓]/gu) || [])) {
      const where = ic === '📡' ? PG.slice(PG.indexOf('toggleMonitorAll('), PG.indexOf('toggleMonitorAll(') + 400)
        : wblk;
      ok(where.includes(ic) || PG.includes(`>${ic}<`) || PG.includes(`'${ic}'`)
         || PG.includes(`?'🔔':'🔕'`) && '🔔🔕'.includes(ic),
         `**الزر ${ic} اللي يشرحه /watch موجود فعلاً في الصفحة**`);
    }
    ok(!/➕/.test(watchBlk), 'و➕ ما تُذكر — هي زر الإضافة للجدول لا المراقبة');
    ok(/CLOSE|مقفل/.test(watchBlk), 'ويقول إن المراقبة للمقفلة');
    /* **ولحظة الربط هي أنسب وقت للتعريف**: الطالب داخل الحين.
       رسالتا /start لازم تذكران المساعد والدليل لا الإيقاف وبس. */
    for (const mark of ['✅ <b>حسابك مربوط</b>', '✅ <b>تم الربط بنجاح!</b>']) {
      const si = src.indexOf('`' + mark);
      ok(si > 0, 'رسالة الربط موجودة — ' + mark);
      const sblk = src.slice(si, si + 900);
      ok(sblk.includes('/ai'), `${mark}: تعرّفه بالمساعد`);
      ok(sblk.includes('/help') || sblk.includes('/watch'),
         `${mark}: وتدلّه على بقية الأوامر`);
    }

    /* الأمر غير المعروف يعرض نفس الأوامر */
    /* بعلامتها لا بنصها: «أمر غير معروف» ترد كذلك في msgKind أعلى الملف */
    const ui = src.indexOf('`❓ <b>أمر غير معروف</b>');
    ok(ui > 0, 'رد الأمر غير المعروف موجود');
    const ublk = src.slice(ui, ui + 900);
    for (const n of ['ai', 'today', 'rooms', 'plan', 'watch', 'help'])
      ok(ublk.includes('/' + n), `الأمر غير المعروف يذكر /${n}`);
  }

  /* ── ٧ب) جواب طويل: تيليغرام يرفض الرسالة فوق ٤٠٩٦ حرفاً **كلها** ──
     خطة تخرج كاملة بترماتها ممكن تتعداها — والطالب كان ما يوصله شي */
  c = makeCtx();
  REPLY = { ok: true, proposal: null,
    answer: Array.from({ length: 300 }, (_, k) => '- سطر رقم ' + k + ' في خطة طويلة').join('\n') };
  await c.aiTgRoute(7, '/ai رتّب لي خطتي');
  ok(SENT.length >= 2 && SENT.every(m => m.text.length <= 4096),
     '**الجواب الطويل ينقسم رسائل تحت حد تيليغرام** — ' + SENT.map(m => m.text.length));
  ok(SENT.slice(0, -1).every(m => !m.markup) && !!(SENT[SENT.length - 1] || {}).markup,
     'ولوحة الوضع مع آخر قطعة');
  const whole = SENT.map(m => m.text).join('\n');
  ok(whole.includes('سطر رقم 0 ') && whole.includes('سطر رقم 299 '), 'وما ضاع منه سطر');

  /* ── ٨) فحص ثابت ── */
  const CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/'\/stop'/.test(CODE), 'وما يلمس /stop أصلاً');
  ok(/aiChat\(/.test(CODE), 'ويستعمل aiChat نفسها — نفس السقوف والأوضاع');
  /* **قاعدة تغيّرت عمداً:** كانت «ولا كتابة من البوت». صار التذكير يتثبّت
     من البوت (فحوصه كلها في السيرفر — aiRemindCheck)، وهو الكتابة الوحيدة:
     باقي الأفعال حراساتها في دوال الصفحة، وتذكرة الدعم تمر بـtgToTeam. */
  eq((CODE.match(/sb\('(POST|PATCH|DELETE)',\s*'\w+'/g) || []), ["sb('POST', 'reminders'"],
     '**كتابة وحدة من البوت: التذكير** — وباقي الأفعال حراساتها في الصفحة');
  ok(/aiRemindCheck\(/.test(CODE), 'والتثبيت يعيد فحوص الاقتراح نفسها — لا فحص ثانٍ');
  ok(/telegram_chat_id=eq\./.test(CODE), 'والهوية من الربط لا من الرسالة');

  done();
})().catch(e => { console.log('انهار: ' + (e && e.stack || e)); fail++; done() });
