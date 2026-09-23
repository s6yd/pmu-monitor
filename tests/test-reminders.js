/* دورة التذكيرات — اختبار سلوكي (CLAUDE.md §٩-أ-٤).
   تشغّل remindersTick الحقيقية في vm بقاعدة وهمية.

   خمسة أخطار يمسكها:
   ١) تذكير يُرسل مرتين — عند إعادة النشر أو تداخل دورتين.
   ٢) تذكير يُرسل قبل وقته.
   ٣) البيئتان تتشاركان القاعدة فيصل للطالب مرتين، أو ترسله نسخة التجربة.
   ٤) يُرسل لمن أطفأ تنبيهاته أو ما ربط تلقرام.
   ٥) الحجز يفشل ومع ذلك نرسل.

   node tests/test-reminders.js [مسار server.js] */
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
const i = L.findIndex(x => x.startsWith('/* ═══ دورة التذكيرات'));
const j = L.findIndex((x, n) => n > i && x.startsWith('const server = http.createServer'));
ok(i >= 0 && j > i, 'منطقة دورة التذكيرات موجودة');
if (i < 0 || j <= i) done();
const REGION = L.slice(i, j).join('\n');

/* wants الحقيقية — الحارس الوحيد لمن يستلم (§١٠) */
const wi = L.findIndex(x => x.startsWith('function wants('));
const wj = L.findIndex((x, n) => n > wi && x.startsWith('/* ═══ المواعيد الأكاديمية'));
ok(wi >= 0 && wj > wi, 'wants الحقيقية موجودة');
const NOTIF_DEF = { on: true, event: true, confirmed: true, absence: true, acad: true };

/* الدورة تقرأ الساعة الحقيقية (new Date())، فالصفوف نسبية لها لا
   لتاريخ ثابت — وإلا صار كل شي «في المستقبل» وما استُحق شي. */
const NOW = Date.now();

/* معرّفات حقيقية: الدورة تفلتر بشكل الـUUID عمداً قبل ما تبنيها في
   `id=in.(…)` — ومعرّف مختلق ما يعدّي، وهذا هو المقصود. */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
let DB, SENT, PATCHES, CLAIM_FAIL;

function reset(rows, profs) {
  DB = { reminders: rows.map(r => Object.assign({}, r)), profiles: profs };
  SENT = []; PATCHES = []; CLAIM_FAIL = false;
}

function makeCtx(env) {
  const ctx = {
    console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date,
    RegExp, Error, encodeURIComponent, Set, setTimeout,
    SB_URL: 'https://x', SITE_ENV: env, NOTIF_DEF,
    OPS: {},
    esc: v => String(v == null ? '' : v),
    notifPrefsOf: p => Object.assign({}, NOTIF_DEF, (p && p.notif_prefs) || {}),
    sendMsg: (chat, text) => { SENT.push({ chat, text }); return Promise.resolve({ ok: true }) },
    sb: (method, table, opt) => {
      const q = (opt && opt.query) || '';
      if (method === 'GET' && table === 'reminders') {
        const e = /env=eq\.([^&]+)/.exec(q);
        const lte = /at=lte\.([^&]+)/.exec(q);
        const until = lte ? Date.parse(decodeURIComponent(lte[1])) : Infinity;
        let rows = DB.reminders.filter(r => r.sent_at == null &&
          Date.parse(r.at) <= until &&
          (!e || r.env === decodeURIComponent(e[1])));
        rows = rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const lm = /limit=(\d+)/.exec(q);
        return Promise.resolve(rows.slice(0, lm ? +lm[1] : 1000).map(r => Object.assign({}, r)));
      }
      if (method === 'GET' && table === 'profiles') {
        const m = /id=in\.\(([^)]*)\)/.exec(q);
        const ids = m ? m[1].split(',') : [];
        return Promise.resolve(DB.profiles.filter(p => ids.includes(p.id))
          .map(p => Object.assign({}, p)));
      }
      if (method === 'PATCH' && table === 'reminders') {
        PATCHES.push(q);
        const id = (/id=eq\.([^&]+)/.exec(q) || [])[1];
        const wantsNull = /sent_at=is\.null/.test(q);
        const row = DB.reminders.find(r => String(r.id) === String(id));
        /* التحديث المشروط: صف مُرسَل أصلاً ما يرجع شيئاً — مثل PostgREST */
        if (!row || (wantsNull && row.sent_at != null) || CLAIM_FAIL)
          return Promise.resolve([]);
        Object.assign(row, opt.body);
        return Promise.resolve(/return=representation/.test((opt && opt.prefer) || '')
          ? [Object.assign({}, row)] : []);
      }
      return Promise.resolve([]);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(L.slice(wi, wj).join('\n'), ctx);
  vm.runInContext(REGION + '\nthis.remindersTick=remindersTick;', ctx);
  return ctx;
}

const P_OK = { id: U1, telegram_chat_id: '111', notif_prefs: null };
const P_OFF = { id: U2, telegram_chat_id: '222', notif_prefs: { on: false } };
const P_NOTG = { id: U3, telegram_chat_id: null, notif_prefs: null };
const at = ms => new Date(NOW + ms).toISOString();

(async () => {
  /* ── ١) الوقت ── */
  reset([
    { id: 1, user_id: U1, env: 'prod', at: at(-60000), body: 'حان وقته', sent_at: null },
    { id: 2, user_id: U1, env: 'prod', at: at(+3600000), body: 'بعدين', sent_at: null },
  ], [P_OK]);
  let c = makeCtx('prod');
  await c.remindersTick();
  eq(SENT.length, 1, 'يُرسل المستحق وحده');
  ok(/حان وقته/.test(SENT[0].text), 'وبنصّه');
  eq(SENT[0].chat, '111', 'ولصاحبه');
  ok(/تذكير/.test(SENT[0].text), 'ومعنون بأنه تذكير');
  ok(/مساعد جدولك/.test(SENT[0].text), 'ويقول من وين جاء');
  eq(DB.reminders[1].sent_at, null, '**واللي ما حان وقته ما انلمس**');

  /* ── ٢) ولا مرة ثانية ── */
  await c.remindersTick();
  eq(SENT.length, 1, '**دورة ثانية ما ترسله مرة ثانية**');

  /* ── ٣) الحجز يسبق الإرسال ── */
  reset([{ id: 1, user_id: U1, env: 'prod', at: at(-1000), body: 'x', sent_at: null }], [P_OK]);
  c = makeCtx('prod');
  CLAIM_FAIL = true;                     /* غيرنا حجزه قبلنا */
  await c.remindersTick();
  eq(SENT.length, 0, '**الحجز فشل ⇒ ما نرسل** — دورتان متوازيتان ما تكرّران');
  ok(PATCHES.length > 0 && /sent_at=is\.null/.test(PATCHES[0]),
     'والحجز تحديث مشروط بـsent_at is null');

  /* ── ٤) البيئتان تتشاركان القاعدة ── */
  reset([
    { id: 1, user_id: U1, env: 'prod', at: at(-1000), body: 'للإنتاج', sent_at: null },
    { id: 2, user_id: U1, env: 'dev', at: at(-1000), body: 'للتجربة', sent_at: null },
  ], [P_OK]);
  c = makeCtx('prod');
  await c.remindersTick();
  eq(SENT.length, 1, 'الإنتاج يرسل صفّه وحده');
  ok(/للإنتاج/.test(SENT[0].text), '**وما يرسل تذكير نسخة التجربة**');
  eq(DB.reminders[1].sent_at, null, 'وصف dev باقٍ لبيئته');
  const devDb = DB;
  reset(devDb.reminders, [P_OK]);
  c = makeCtx('dev');
  await c.remindersTick();
  eq(SENT.length, 1, 'وdev ترسل صفّها');
  ok(/للتجربة/.test(SENT[0].text), 'وهو تذكيرها هي');

  /* ── ٥) من يستلم ── */
  reset([
    { id: 1, user_id: U1, env: 'prod', at: at(-1000), body: 'أ', sent_at: null },
    { id: 2, user_id: U2, env: 'prod', at: at(-1000), body: 'ب', sent_at: null },
    { id: 3, user_id: U3, env: 'prod', at: at(-1000), body: 'ج', sent_at: null },
  ], [P_OK, P_OFF, P_NOTG]);
  c = makeCtx('prod');
  await c.remindersTick();
  eq(SENT.length, 1, 'من أطفأ تنبيهاته أو ما ربط تلقرام ما يستلم');
  eq(SENT[0].chat, '111', 'والمستلم هو المربوط المفعّل');
  ok(DB.reminders.every(r => r.sent_at != null),
     '**ومع ذلك الثلاثة تُعلَّم مُرسَلة** — وإلا حاولنا كل دقيقة للأبد');

  /* ── ٦) الأعطال ── */
  reset([], [P_OK]);
  c = makeCtx('prod');
  await c.remindersTick();
  eq(SENT.length, 0, 'بلا تذكيرات مستحقة ما يصير شي');
  c.sb = () => Promise.reject(new Error('شبكة'));
  let threw = false;
  try { await c.remindersTick() } catch (e) { threw = true }
  ok(!threw, 'وخطأ شبكة ما يرمي — الدورة تكمّل');

  /* ── ٧) فحص ثابت ── */
  ok(/env=eq\./.test(REGION), 'الدورة تفلتر بالبيئة');
  ok(/sent_at=is\.null/.test(REGION), 'وتحجز بتحديث مشروط');
  ok(/wants\(p, 'on'\)/.test(REGION), 'وتستعمل wants — لا فحص تنبيهات ثانٍ');
  /* الفحص على الكود وحده: التعليق يشرح ليش ما نحرسها بـprod، فالبحث
     في النص الخام يمسك الشرح ويظنّه حرساً. */
  const CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/SITE_ENV\s*===\s*'prod'/.test(CODE),
     'وما تُحرس بـprod: التذكير طلب صريح من صاحبه فلازم يُجرَّب على dev');
  ok(/SITE_ENV/.test(CODE), 'لكنها تعرف بيئتها وتفلتر بها');
  ok(/limit=/.test(REGION), 'وبحد صريح — لا تعتمد على قصّ الألف الصامت');

  done();
})().catch(e => { console.log('انهار: ' + (e && e.stack || e)); fail++; done() });
