/* المساعد داخل البوت — اختبار سلوكي (CLAUDE.md §٩-أ-٥).
   يشغّل aiTgRoute الحقيقية في vm.

   أربعة أخطار يمسكها:
   ١) المساعد يبلع الكلام الحر فما عاد أحد يقدر يكلّم الدعم.
   ٢) /stop ينخطف من إيقاف الإشعارات.
   ٣) غير المربوط يسأل فيرجع خطأ غامض.
   ٤) الأفعال تُنفّذ من البوت بلا حراسات الصفحة.

   node tests/test-tg-ai.js [مسار server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

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
    sendMsg: (chat, text) => { SENT.push({ chat, text }); return Promise.resolve({ ok: true }) },
    sb: (m, t, o) => Promise.resolve(
      (t === 'profiles' && LINKED) ? [{ id: 'u-1' }] : []),
    aiChat: (uid, q) => { ASKED.push({ uid, q }); return Promise.resolve(REPLY) },
  };
  vm.createContext(ctx);
  vm.runInContext(REGION + '\nthis.aiTgRoute=aiTgRoute;this.AI_TG_MODE=AI_TG_MODE;', ctx);
  return ctx;
}

(async () => {
  /* ── ١) الكلام الحر يبقى للدعم ── */
  let c = makeCtx();
  eq(await c.aiTgRoute(7, 'عندي مشكلة في الموقع'), false,
     '**كلام حر خارج الوضع ما ياخذه المساعد** — يكمّل للدعم');
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
  eq(await c.aiTgRoute(7, 'سؤال ثانٍ'), false,
     '**وما دخل وضعاً** — سؤال واحد ورجع الكلام للدعم');

  /* ── ٣) /ai بلا سؤال يدخل الوضع ── */
  c = makeCtx();
  eq(await c.aiTgRoute(7, '/ai'), true, '/ai وحده يدخل الوضع');
  eq(ASKED.length, 0, 'وما يسأل النموذج بلا سؤال');
  ok(/مساعد جدولك/.test(SENT[0].text), 'ويشرح');
  ok(/خروج/.test(SENT[0].text), 'ويقول كيف يخرج');
  eq(await c.aiTgRoute(7, 'كم باقي لي؟'), true, 'وبعده الكلام يروح للمساعد');
  eq(ASKED[0].q, 'كم باقي لي؟', 'كما هو');
  ok(/خروج/.test(SENT[1].text), 'ويذكّره بالخروج');
  /* والأوامر تبقى أوامر داخل الوضع */
  eq(await c.aiTgRoute(7, '/stop'), false, '**و/stop يبقى للإشعارات داخل الوضع**');
  eq(await c.aiTgRoute(7, '/status'), false, 'وبقية الأوامر كذلك');
  /* الخروج */
  eq(await c.aiTgRoute(7, '/خروج'), true, 'و/خروج يخرجه');
  ok(/الدعم/.test(SENT[SENT.length - 1].text), 'ويقول إن كلامه يرجع للدعم');
  eq(await c.aiTgRoute(7, 'كلام عادي'), false, '**وبعدها يرجع للدعم فعلاً**');

  /* ── ٤) محادثتان ما تتداخلان ── */
  c = makeCtx();
  await c.aiTgRoute(7, '/ai');
  eq(await c.aiTgRoute(9, 'كلام من ثانٍ'), false,
     'ووضع محادثة ما يفتح وضع غيرها');

  /* ── ٥) غير المربوط ── */
  c = makeCtx(); LINKED = false;
  eq(await c.aiTgRoute(7, '/ai سؤال'), true, 'غير المربوط يتعامل معه');
  eq(ASKED.length, 0, 'وما نسأل النموذج بلا هوية');
  ok(/اربط/.test(SENT[0].text), 'ويقول له يربط حسابه');
  ok(/jadwalik/.test(SENT[0].text), 'ويعطيه الرابط');

  /* ── ٦) الأفعال تُحال للموقع ── */
  c = makeCtx();
  REPLY = { ok: true, answer: 'جهّزت لك', proposal: { action: 'absence' } };
  await c.aiTgRoute(7, '/ai سجّل غياب');
  ok(/تأكيد/.test(SENT[0].text), 'الاقتراح يُحال للتأكيد');
  ok(/jadwalik/.test(SENT[0].text), '**وللموقع — ما ننفّذ من البوت**');

  /* ── ٧) الأعطال ── */
  c = makeCtx();
  c.aiChat = () => Promise.reject(new Error('انهار'));
  let threw = false;
  try { await c.aiTgRoute(7, '/ai سؤال') } catch (e) { threw = true }
  ok(!threw, 'وخطأ في النموذج ما يرمي');
  ok(SENT.length && /خلل/.test(SENT[0].text), 'ويرد برسالة مفهومة');

  /* ── ٨) فحص ثابت ── */
  const CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/'\/stop'/.test(CODE), 'وما يلمس /stop أصلاً');
  ok(/aiChat\(/.test(CODE), 'ويستعمل aiChat نفسها — نفس السقوف والأوضاع');
  ok(!/sb\('POST'|sb\('PATCH'|sb\('DELETE'/.test(CODE),
     '**ولا كتابة واحدة من البوت** — الأفعال حراساتها في الصفحة');
  ok(/telegram_chat_id=eq\./.test(CODE), 'والهوية من الربط لا من الرسالة');

  done();
})().catch(e => { console.log('انهار: ' + (e && e.stack || e)); fail++; done() });
