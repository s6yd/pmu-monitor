/* المساعد داخل البوت — اختبار سلوكي (CLAUDE.md §٩-أ-٥).
   يشغّل aiTgRoute الحقيقية في vm.

   ستة أخطار يمسكها:
   ١) المساعد يبلع الكلام الحر فما عاد أحد يقدر يكلّم الدعم.
   ٢) /stop ينخطف من إيقاف الإشعارات.
   ٣) غير المربوط يسأل فيرجع خطأ غامض.
   ٤) الأفعال تُنفّذ من البوت بلا حراسات الصفحة.
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

  /* زر «🚪 خروج» يخرجه — الطالب ضغط زراً مكتوب فيه خروج */
  eq(await c.aiTgRoute(7, '🚪 خروج'), true, '**وزر «🚪 خروج» يخرجه فعلاً**');
  const bye = SENT[SENT.length - 1] || {};
  ok(bye.markup && bye.markup.remove_keyboard === true,
     '**واللوحة تُشال عند الخروج** — ما تبقى تكذب عليه');
  eq(await c.aiTgRoute(7, 'كلام عادي'), false, 'وكلامه يرجع للدعم');

  /* و«خروج» وحدها داخل الوضع كذلك — لكن ما تُخطف خارجه */
  c = makeCtx();
  eq(await c.aiTgRoute(7, 'خروج'), false,
     '**«خروج» خارج الوضع تبقى للدعم** — ما نخطف كلمة عادية');
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
  /* لكن كلمة «خروج» المكتوبة بلا زر تبقى للدعم */
  c = makeCtx();
  eq(await c.aiTgRoute(7, 'خروج'), false, 'وكلمة «خروج» وحدها تبقى للدعم');

  /* ── ١٠) الاختصارات: سؤال جاهز بلا وضع ── */
  for (const [cmd, q] of [['/today', 'اليوم'], ['/rooms', 'قاعة'], ['/plan', 'أتخرج']]) {
    c = makeCtx();
    eq(await c.aiTgRoute(7, cmd), true, `${cmd} يتعامل معه`);
    eq(ASKED.length, 1, `${cmd} يسأل النموذج مرة`);
    ok(new RegExp(q).test((ASKED[0] || {}).q || ''),
       `${cmd} بسؤال معناه «${q}» — ${(ASKED[0] || {}).q}`);
    ok(!(SENT[0] || {}).markup, `${cmd} ما يرفع لوحة — سؤال واحد لا وضع`);
    eq(await c.aiTgRoute(7, 'كلام بعده'), false,
       `**${cmd} ما يدخل وضعاً** — الكلام يرجع للدعم`);
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

  /* ── ٨) فحص ثابت ── */
  const CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/'\/stop'/.test(CODE), 'وما يلمس /stop أصلاً');
  ok(/aiChat\(/.test(CODE), 'ويستعمل aiChat نفسها — نفس السقوف والأوضاع');
  ok(!/sb\('POST'|sb\('PATCH'|sb\('DELETE'/.test(CODE),
     '**ولا كتابة واحدة من البوت** — الأفعال حراساتها في الصفحة');
  ok(/telegram_chat_id=eq\./.test(CODE), 'والهوية من الربط لا من الرسالة');

  done();
})().catch(e => { console.log('انهار: ' + (e && e.stack || e)); fail++; done() });
