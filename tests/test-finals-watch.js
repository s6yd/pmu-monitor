/* تنبيه تغيّر الاختبارات النهائية — طلب محمد (١٩ نوفمبر ٢٠٢٦: «لو صار فيه تغيير في موعد او مكان اختبار موجود في جدول
   الطالب هل يجيه تنبيه؟» — ما كان يجيه، و«اي ابدأ فيه»). تشغّل منطقة السيرفر الحقيقية في vm بجامعة وقاعدة وتيليغرام
   وهمية، والساعة تمرّرها للدورة.

   أخطار يمسكها:
   ١) موعد أو قاعة اختبار تتغيّر وصاحب المادة ما يدري (ما كان فيه شي يقارن أصلاً).
   ٢) رسالة كاذبة: أول جدول للترم · جدول ناقص أو فاضي أو شكله تغيّر · CRN رجع لمادة ثانية · فرق رجع خلال ربع ساعة ·
      ترم دراسة جديد · صف الطالب بمادة أو شعبة غير.
   ٣) رسالتان لنفس الطالب: نسختان وقت النشر · نفس الطالب بحسابين على محادثة وحدة · مادتان تغيّرتا معاً.
   ٤) رسالة تضيع: نشر وسط الإرسال (الجديدة تكمّل الباقين بلا تكرار) · القاعدة ما انقرأت.
   ٥) عاصفة تروح للكل بلا سؤال، أو زر غير المشرف يقرّرها.
   ٦) سحب زايد من الجامعة — قرار محمد: نقارن مع كل تجديد للكاش (لما يفتح طالب البطاقة)، وما نسحب بأنفسنا إلا لو الكاش
      أقدم من يوم، وسحبة التأكيد بعد ربع ساعة لما يبان فرق. وسحبتنا فشلت ⇒ ساعة قبل ما نعيد. ونسخة التجربة ما تسحب.

   node tests/test-finals-watch.js [مسار server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const done = () => { out.forEach(l => console.log(l)); console.log(`\nتنبيه تغيّر الاختبارات: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

const src = fs.readFileSync(SRV, 'utf8');
const L = src.split('\n');
const i0 = L.findIndex(x => x.startsWith('/* ═══ تنبيه تغيّر الاختبارات النهائية ═══'));
const i1 = L.findIndex((x, n) => n > i0 && x.startsWith('/* ═══ نهاية تنبيه الاختبارات ═══'));
ok(i0 >= 0 && i1 > i0, '**منطقة تنبيه تغيّر الاختبارات موجودة في السيرفر**');

/* ═══ فحص ثابت: الدورة مسجّلة، وزرّا العاصفة لهما معالج، وسحبة الفحص طازجة ═══ */
ok(/setInterval\(\(\) => \{ finalsWatchTick\(\)\.catch\(\(\) => \{\}\) \}, FIN_TICK_MS\)/.test(src), 'الدورة مسجّلة كل ٥ دقائق');
ok(/data\.match\(\/\^fin:\(ok\|no\):\(\[0-9a-f\]\{8\}\)\$\/\)/.test(src) && /finStormDecide\(cq, ack, chatId/.test(src),
   'زرّا العاصفة («✅ أرسل للطلاب» · «🚫 لا») لهما معالج في البوت');
ok(/async function getOne\(g, maxAge\)/.test(src) && /async function getFinals\(opt\)/.test(src),
   'getFinals تقبل عمراً أقصى للكاش (الفحص يبي سحبة طازجة لا نسخة عمرها ٦ ساعات)');
ok(/تغيّر في اختباراتك/.test((/function msgKind[\s\S]*?\n}\n/.exec(src) || [''])[0]), 'سجل الرسائل يصنّفها «تغيّر اختبار»');
if (i0 < 0 || i1 <= i0) done();
const REGION = L.slice(i0, i1 + 1).join('\n');

/* getOne/getFinals الحقيقيتان — العمر الأقصى وحالة كل جنس */
const g0 = L.findIndex(x => x.startsWith('async function getOne('));
const g1 = L.findIndex((x, n) => n > g0 && x.startsWith('async function getFinals('));
let g2 = g1 >= 0 ? L.findIndex((x, n) => n > g1 && x === '}') : -1;

/* ═══ بيانات بصيغة الجامعة حرفاً بحرف (مخترعة) ═══ */
const X = (crn, code, title, sec, bld, room, day, date, hour, g = 'M') => ({ crn, code, title, section: sec,
  instructor: 'Doe, Jane', building: bld, room, day, date, hour, gender: g });
const CODES = ['MEEN', 'CHEN', 'ELEN', 'CIVE', 'COSC', 'MATH', 'PHYS', 'CHEM', 'ENGL', 'UNIV'];
function table() {
  const M = [], F = [];
  for (let k = 0; k < 30; k++)
    M.push(X(String(31000 + k), `${CODES[k % 10]} ${2300 + k}`, `Course ${k}`, '101', 'M-CORE', `F${100 + k}`,
      'Monday', 'Dec 21, 2026', k % 2 ? '9:00AM' : '3:00PM'));
  for (let k = 0; k < 20; k++)
    F.push(X(String(32000 + k), `${CODES[k % 10]} ${2300 + k}`, `Course ${k}`, '201', 'F-CORE', `G${100 + k}`,
      'Tuesday', 'Dec 22, 2026', '12:00PM', 'F'));
  /* اختبارات طلابنا */
  M.push(X('30011', 'MEEN 3311', 'Thermo & Fluids', '101', 'M-CORE', 'F155', 'Sunday', 'Dec 20, 2026', '12:00PM'));
  M.push(X('30021', 'CHEM 1311', 'Chemistry for Engineers I', '101', 'M-COE', 'F063', 'Sunday', 'Dec 20, 2026', '3:00PM'));
  M.push(X('30041', 'PHYS 1421', 'Physics for Engineers I', '101', 'M-SCI', 'G012', 'Tuesday', 'Dec 22, 2026', '9:00AM'));
  M.push(X('30091', 'MATH 2301', 'Calculus III', '101', 'M-CORE', 'F150', 'Monday', 'Dec 28, 2026', '9:00AM'));
  M.push(X('30092', 'MATH 2301', 'Calculus III', '102', 'M-CORE', 'F151', 'Monday', 'Dec 28, 2026', '9:00AM'));
  F.push(X('30061', 'UNIV 1311', 'Critical Think&#x27;g', '209', 'F-CCES', 'F053', 'Wednesday', 'Dec 23, 2026', '12:00PM', 'F'));
  return { M, F };
}
const U = n => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const U1 = U(1), U2 = U(2), U3 = U(3), U4 = U(4), U5 = U(5), U6 = U(6), U7 = U(7);
const S = (user_id, crn, course_code, section, term = '202710') => ({ user_id, crn, course_code, section, term });
const SCHED = [
  S(U1, '30011', 'MEEN 3311', '101'), S(U1, '30021', 'CHEM 1311', '101'),      /* المادتان (جدولان مختلفان — الصفوف بلا رقم جدول هنا) */
  S(U1, '30041', 'PHYS 1421', '101'),
  S(U2, '30011', 'MEEN 3311', '101'),
  S(U3, '30011', 'ELEN 2210', '101'),                                          /* CRN رجع لمادة ثانية عند الطالب — ما يوصله */
  S(U4, '30011', 'MEEN 3311', '101'),                                          /* بلا تيليغرام */
  S(U5, '30011', 'MEEN 3311', '101', '202620'),                                /* جدول ترم قديم */
  S(U6, '30011', 'MEEN 3311', '101'), S(U7, '30011', 'MEEN 3311', '101'),      /* حسابان على محادثة وحدة */
  S(U2, '30091', 'MATH 2301', '101'), S(U2, '30092', 'MATH 2301', '102'),      /* شعبتان بديلتان لنفس المادة */
];
const PROFS = [
  { id: U1, telegram_chat_id: 101 }, { id: U2, telegram_chat_id: 102 }, { id: U3, telegram_chat_id: 103 },
  { id: U4, telegram_chat_id: null }, { id: U5, telegram_chat_id: 105 }, { id: U6, telegram_chat_id: 106 },
  { id: U7, telegram_chat_id: 106 },
];

/* ═══ القاعدة المشتركة ═══ */
let DB;
const resetDB = () => { DB = { state: {}, claims: new Set(), sched: SCHED.map(r => Object.assign({}, r)), profs: PROFS,
  stateFail: false, profFail: false } };
const inList = (q, col) => { const m = new RegExp(col + '=in\\.\\(([^)]*)\\)').exec(q); return m ? m[1].split(',') : null };
const eqv = (q, col) => { const m = new RegExp(col + '=eq\\.([^&]*)').exec(q); return m ? decodeURIComponent(m[1]) : null };

function makeServer(feed, opts = {}) {
  /* كاش الجامعة بساعة الاختبار: getFinals الحقيقية تسحب لو النسخة أقدم من maxAge (افتراضه ٦ ساعات — الصفحة) */
  const S = { feed, sent: [], pulls: 0, ackd: [], term: opts.term || '202710', onSend: null, clock: 0, cache: { M: null, F: null } };
  const ctx = {
    console: { log() {} }, Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error, Set, Map,
    encodeURIComponent, decodeURIComponent, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), crypto,
    SITE_ENV: 'prod', FINALS_ON: true, SB_URL: 'https://x', SB_SERVICE_KEY: 'k', SHUTTING_DOWN: false,
    ADMIN_CHAT_ID: '999',
    activeTerm: () => S.term,
    isUuid: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    esc: v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    btn: (label, data) => ({ text: label, callback_data: data }), kb: rows => ({ inline_keyboard: rows }),
    getFinals: async opt => {
      const maxAge = opt && opt.maxAge != null ? opt.maxAge : 6 * H;
      const f = S.feed(), byG = {};
      for (const g of ['M', 'F']) {
        const c = S.cache[g];
        if (c && S.clock - c.at < maxAge) { byG[g] = Object.assign({ ok: true }, c); continue }
        S.pulls++;
        if (!f[g].ok) { byG[g] = { ok: false, at: S.clock, exams: c ? c.exams : [] }; continue }
        S.cache[g] = { at: S.clock, exams: f[g].exams };
        byG[g] = Object.assign({ ok: true }, S.cache[g]);
      }
      S.maxAge = maxAge;
      return { at: S.clock, exams: [].concat(byG.M.exams, byG.F.exams), byG };
    },
    sendMsg: async (chat, text, markup) => {
      S.sent.push({ chat: String(chat), text, markup });
      if (S.onSend) S.onSend(S.sent.length);
      return { ok: true };
    },
    sb: async (method, table, opt) => {
      const q = (opt && opt.query) || '';
      if (table === 'app_state') {
        if (DB.stateFail) return { code: '500', message: 'down' };
        if (method === 'GET') { const k = eqv(q, 'key'); return k in DB.state ? [{ value: JSON.parse(DB.state[k]) }] : [] }
        DB.state[opt.body.key] = JSON.stringify(opt.body.value); return null;
      }
      if (table === 'notif_approvals' && method === 'POST') {
        const b = opt.body, k = b.send_date + '|' + b.kind + '|' + b.ref;
        if (DB.claims.has(k)) return { code: '23505', message: 'duplicate key' };
        DB.claims.add(k); return null;
      }
      if (table === 'profiles' && method === 'GET') {
        if (DB.profFail) return { code: '500', message: 'down' };
        const ids = inList(q, 'id') || [];
        return DB.profs.filter(p => ids.includes(p.id)).map(p => ({ id: p.id, telegram_chat_id: p.telegram_chat_id }));
      }
      return [];
    },
    sbAll: async (table, opt) => {
      const q = (opt && opt.query) || '';
      if (table !== 'user_schedule') return [];
      const term = eqv(q, 'term'), crns = inList(q, 'crn'), users = inList(q, 'user_id');
      return DB.sched.filter(r => r.term === term && (!crns || crns.includes(r.crn)) && (!users || users.includes(r.user_id)))
        .map(r => ({ user_id: r.user_id, crn: r.crn, section: r.section, course_code: r.course_code }));
    },
  };
  /* escP الحقيقية: pmuPlain ثم esc */
  const p0 = L.findIndex(x => x.startsWith('const PMU_NAMED'));
  const p1 = L.findIndex((x, n) => n > p0 && x.startsWith('const escP'));
  vm.createContext(ctx);
  vm.runInContext(L.slice(p0, p1 + 1).join('\n'), ctx);
  vm.runInContext(REGION, ctx);
  S.ctx = ctx;
  S.tick = async now => { S.clock = now; await vm.runInContext(`finalsWatchTick(${now})`, ctx) };
  /* طالب فتح «اختباراتك النهائية» (أو المساعد) — الكاش يتجدّد لو أقدم من ٦ ساعات */
  S.page = async now => { S.clock = now; await ctx.getFinals() };
  S.W = () => vm.runInContext('FIN_WATCH', ctx);
  S.decide = (chat, yes, id) => vm.runInContext(
    `finStormDecide({}, t => { __ACK.push(t || '') }, ${JSON.stringify(chat)}, ${yes}, ${JSON.stringify(id)})`,
    Object.assign(ctx, { __ACK: S.ackd }));
  return S;
}
const live = () => { const t = table(); return { M: { ok: true, exams: t.M }, F: { ok: true, exams: t.F } } };
const snapOf = () => JSON.parse(DB.state['finals-watch'] || 'null');
const H = 3600e3, MIN = 60e3;
const T0 = Date.parse('2026-12-01T06:00:00Z');
const edit = (feed, crn, f) => () => { const x = feed(); for (const g of ['M', 'F']) for (const e of x[g].exams || []) if (e.crn === crn) f(e); return x };
const stu = S => S.sent.filter(m => m.chat !== '999');
/* تجديد الكاش (طالب فتح البطاقة) ثم الدورة بعده بدقيقة */
const refresh = async (S, t) => { await S.page(t); await S.tick(t + MIN) };

(async () => {
  /* ══ getFinals: عمر أقصى للكاش، وحالة كل جنس ══ */
  if (g0 >= 0 && g1 > g0 && g2 > g1) {
    const calls = [];
    const gctx = { Date, Promise, Object, Array, String, FINALS_TTL: 6 * H, FINALS_PAGES: { M: '/m', F: '/f' },
      finalsCache: { M: null, F: null }, FAIL: null,
      fetchPage: async p => { calls.push(p); if (gctx.FAIL === p) throw new Error('timeout'); return p },
      parseFinals: p => [{ crn: '1', page: p }] };
    vm.createContext(gctx);
    vm.runInContext(L.slice(g0, g2 + 1).join('\n'), gctx);
    const r1 = await vm.runInContext('getFinals()', gctx);
    gctx.finalsCache.M.at -= 30 * MIN; gctx.finalsCache.F.at -= 30 * MIN;
    await vm.runInContext('getFinals()', gctx);
    ok(calls.length === 2, 'getFinals بلا عمر: الكاش ٦ ساعات كما كان (الصفحة والمساعد) — ' + calls.length);
    await vm.runInContext('getFinals({ maxAge: 24 * 3600 * 1000 })', gctx);
    ok(calls.length === 2, 'وبعمر يوم: نسخة عمرها نص ساعة تكفي — ما نسحب');
    gctx.FAIL = '/f';
    const r3 = await vm.runInContext('getFinals({ maxAge: 10 * 60 * 1000 })', gctx);
    ok(calls.length === 4, '**وبعمر ١٠ دقائق تسحب من جديد** (سحبة التأكيد) — ' + calls.length);
    ok(r3.byG && r3.byG.M.ok === true && r3.byG.M.exams.length === 1 && r3.byG.F.ok === false,
       '**وتقول حالة كل جنس**: الطلاب وصل، والطالبات فشل (لا «فاضي» مثل جدول ما نُشر) — ' + JSON.stringify(r3.byG && { M: r3.byG.M.ok, F: r3.byG.F.ok }));
    ok(r1.exams.length === 2 && r3.exams.length === 2, 'والمجموع للصفحة كما كان (الفاشل يرجع نسخته المحفوظة لا لا شي)');
  } else ok(false, 'getOne/getFinals موجودتان');

  /* ══ ١) نسخة التجربة ما تسحب، والمفتاح المطفي ما يسحب ══ */
  resetDB();
  {
    const S = makeServer(live);
    S.ctx.SITE_ENV = 'dev';
    await S.tick(T0);
    S.ctx.SITE_ENV = 'prod'; S.ctx.FINALS_ON = false;
    await S.tick(T0 + MIN);
    eq([S.pulls, S.sent.length], [0, 0], '**نسخة التجربة ما تسحب ولا ترسل** (القاعدة مشتركة)، ولا المفتاح المطفي من اللوحة');
  }

  /* ══ ٢) أول جدول مرجع · ونقارن مع كل تجديد للكاش · ونسحب بأنفسنا بعد يوم بلا تجديد ══ */
  resetDB();
  let feed = live;
  const S = makeServer(() => feed());
  await S.tick(T0);
  const s0 = snapOf();
  ok(S.pulls === 2 && s0 && s0.term === '202710' && Object.keys(s0.M).length === 35 && Object.keys(s0.F).length === 21,
     '**أول جدول ينحفظ مرجعاً** (الكاش فاضي بعد الإقلاع ⇒ سحبة) — ' + JSON.stringify(s0 && [S.pulls, s0.term, Object.keys(s0.M).length, Object.keys(s0.F).length]));
  eq(S.sent.length, 0, '**وبلا رسائل** — ما فيه شي «تغيّر» عن أول جدول');
  eq(S.maxAge, 24 * H, 'والدورة تقبل الكاش لين يوم');
  await S.tick(T0 + 30 * MIN); await S.tick(T0 + 5 * H); await S.tick(T0 + 20 * H);
  eq([S.pulls, S.W().stat.checks], [2, 1], '**ولا سحبة زايدة لين يوم** — ولا مقارنة لنفس النسخة');
  await refresh(S, T0 + 7 * H);
  eq([S.pulls, S.W().stat.checks, S.sent.length], [4, 2, 0], '**طالب فتح البطاقة بعد ٦ ساعات ⇒ الكاش تجدّد ⇒ قارنّاه** (بلا سحبة منّا) — وما تغيّر شي');
  await S.tick(T0 + 7 * H + 23 * H);
  eq(S.pulls, 4, 'وبعدها ٢٣ ساعة بلا تجديد: ما نسحب');
  const tDay = T0 + 7 * H + 24 * H + 5 * MIN;
  await S.tick(tDay);
  eq([S.pulls, S.W().stat.checks], [6, 3], '**ما فتحها أحد يوماً ⇒ نسحب بأنفسنا ونقارن**');

  /* ══ ٣) تغيّر القاعة والموعد ⇒ ننتظر ربع ساعة ونتأكد ثم نرسل ══ */
  feed = edit(edit(live, '30011', e => { e.building = 'M-SCI'; e.room = 'G012' }), '30021', e => { e.date = 'Dec 22, 2026'; e.day = 'Tuesday'; e.hour = '9:00AM' });
  const T1 = tDay + 6 * H + MIN;
  await refresh(S, T1);
  eq(S.sent.length, 0, '**أول ما يبان الفرق ما نرسل** — ننتظر سحبة ثانية');
  ok(S.W().pending && S.W().pending.changes.length === 2, 'الفرقان تحت التأكيد — ' + JSON.stringify(S.W().pending && S.W().pending.changes.map(c => c.crn)));
  eq(snapOf().M['30011'].slice(3, 5), ['M-CORE', 'F155'], 'والنسخة المحفوظة باقية على القديم لين يتأكد');
  const pBefore = S.pulls;
  await S.tick(T1 + 6 * MIN);
  eq([S.pulls, S.sent.length], [pBefore, 0], 'بعد ٥ دقائق: ولا سحبة ولا رسالة');
  await S.tick(T1 + 16 * MIN);
  eq([S.pulls - pBefore, S.maxAge], [2, 10 * MIN], '**بعد ربع ساعة: سحبة التأكيد** (الوحيدة الزايدة)');
  const toStu = stu(S);
  eq(toStu.map(m => m.chat).sort(), ['101', '102', '106'],
     '**نفس الفرق ⇒ يوصل لكل اللي عندهم المادة بنفس الشعبة**: لا CRN رجع لمادة ثانية عنده، ولا بلا تيليغرام، ولا جدول ترم قديم، وحسابان على محادثة = رسالة');
  const m1 = (toStu.find(m => m.chat === '101') || {}).text || '';
  ok(/تغيّر في اختباراتك النهائية/.test(m1) && /MEEN 3311 §101/.test(m1) && /CHEM 1311 §101/.test(m1),
     '**رسالة وحدة فيها المادتان** للي تغيّرت مادتان في جدوله');
  ok(/المكان\n   كان: <s>M-CORE · F155<\/s>\n   صار: <b>M-SCI · G012<\/b>/.test(m1), '**المكان: كان وصار** — ' + m1.slice(0, 300));
  ok(/الموعد\n   كان: <s>الأحد 20 ديسمبر · 3:00 م<\/s>\n   صار: <b>الثلاثاء 22 ديسمبر · 9:00 ص<\/b>/.test(m1), '**الموعد: كان وصار** باليوم والتاريخ والساعة بالعربي');
  ok(/Thermo &amp; Fluids/.test(m1) && !/Thermo & Fluids/.test(m1), 'و«&» في اسم المادة مهرّبة (تيليغرام يرفض الرسالة كلها بلاها)');
  ok(/شارك الجديد/.test(m1) && /jadwalik\.com/.test(m1), 'وتذكّره يشارك الجديد لقروبه لو نشر القديم');
  ok(!/الموعد/.test((toStu.find(m => m.chat === '102') || {}).text || ''), 'واللي تغيّرت قاعته بس ما يجيه سطر «الموعد»');
  const adm = S.sent.filter(m => m.chat === '999');
  ok(adm.length === 1 && /عندهم المادة في جدولهم: 5 · وصلتهم الرسالة على تيليغرام: 3/.test(adm[0].text), '**ومحمد يوصله سطر**: كم طالب عنده المادة وكم وصلته — ' + (adm[0] && adm[0].text));
  const s1 = snapOf();
  eq([s1.M['30011'].slice(3, 5), s1.M['30021'].slice(1, 3)], [['M-SCI', 'G012'], ['Dec 22, 2026', '9:00AM']], 'والنسخة صارت الجديدة');
  ok(S.W().pending === null, 'وما بقى شي تحت التأكيد');
  const n1 = S.sent.length;
  await refresh(S, T1 + 7 * H);
  eq(S.sent.length, n1, '**التجديد اللي بعده ما يعيد** نفس التنبيه');

  /* ══ ٤) فرق رجع خلال ربع ساعة ⇒ ولا رسالة ══ */
  const base4 = feed;
  feed = edit(base4, '30041', e => { e.room = 'G099' });
  const T2 = T1 + 14 * H;
  await refresh(S, T2);
  feed = base4;
  await S.tick(T2 + 17 * MIN);
  eq(S.sent.length, n1, '**فرق رجع قبل التأكيد ⇒ ولا رسالة** (صفحة الجامعة تعثّرت)');
  eq(snapOf().M['30041'][4], 'G012', 'والنسخة على قيمتها');
  ok(S.W().stat.flapped >= 1, 'وينعدّ «رجع»');

  /* ══ ٥) جدول ما نثق فيه: فاضي · ناقص · شكله تغيّر · سحبتنا فشلت ══ */
  const T3 = T2 + 7 * H;
  feed = () => { const x = edit(base4, '30011', e => { e.room = 'G100' })(); x.F = { ok: true, exams: [] }; return x };
  await refresh(S, T3);
  ok(S.W().stat.skipped.some(w => /F: فاضي/.test(w)), 'جدول الطالبات رجع فاضي ⇒ ما نقارنه — ' + JSON.stringify(S.W().stat.skipped));
  eq(Object.keys(snapOf().F).length, 21, '**ونسخة الطالبات ما تنمسح** (الفاضي ما ينحفظ)');
  ok(S.W().pending && S.W().pending.changes.map(c => c.crn).join() === '30011', 'وجدول الطلاب يكمّل عادي');
  await S.tick(T3 + 17 * MIN);
  const n2 = S.sent.length;
  ok(n2 > n1, 'وتغيير الطلاب وصل');
  const base5 = edit(base4, '30011', e => { e.room = 'G100' });
  const T4 = T3 + 7 * H;
  feed = () => { const x = base5(); x.M.exams.forEach(e => { e.hour = e.room }); return x };
  await refresh(S, T4);
  ok(S.W().stat.skipped.some(w => /M: شكل/.test(w)) && S.W().pending === null, '**عمود انزاح** (الوقت فيه قاعات) ⇒ ما نصدّقه');
  feed = () => { const x = base5(); x.M.exams = x.M.exams.slice(0, 10); return x };
  await refresh(S, T4 + 7 * H);
  ok(S.W().stat.skipped.some(w => /M: ناقص/.test(w)) && S.W().pending === null, '**جدول ناقص** (١٠ من ٣٥) ⇒ ما نصدّقه');
  feed = () => { const x = base5(); x.M = { ok: false, exams: [] }; return x };
  const T5 = T4 + 7 * H + 24 * H + MIN;
  const q0 = S.pulls;
  await S.tick(T5);
  ok(S.W().stat.skipped.some(w => /M: ما وصل/.test(w)) && S.pulls - q0 === 2, '**سحبتنا فشلت** (بعد يوم بلا تجديد) ⇒ «ما وصل» — ' + JSON.stringify(S.W().stat.skipped));
  await S.tick(T5 + 5 * MIN); await S.tick(T5 + 30 * MIN);
  eq(S.pulls - q0, 2, '**وما نعيد السحب كل ٥ دقائق** على جامعة متعثّرة');
  await S.tick(T5 + 61 * MIN);
  eq(S.pulls - q0, 3, 'وبعد ساعة نحاول ثانية');
  eq(S.sent.length, n2, 'وولا رسالة من كل هذا');

  /* ══ ٦) CRN رجع لمادة ثانية في الجامعة ⇒ ما هو «تغيّر» ══ */
  feed = edit(base5, '30041', e => { e.code = 'BIOL 1411'; e.title = 'Biology'; e.date = 'Dec 29, 2026' });
  await refresh(S, T5 + 3 * H);
  ok(S.W().pending === null && snapOf().M['30041'][0] === 'BIOL 1411|101', '**CRN صار لمادة ثانية ⇒ مادة جديدة لا تغيّر** (الجامعة تعيد الأرقام)');
  eq(S.sent.length, n2, 'وبلا رسالة');

  /* ══ ٧) صار بنفس وقت اختبار ثاني له — مادة ثانية لا شعبة بديلة ══ */
  resetDB();
  {
    let f = live;
    const S2 = makeServer(() => f());
    await S2.tick(T0);
    f = edit(live, '30041', e => { e.date = 'Dec 20, 2026'; e.day = 'Sunday'; e.hour = '12:00PM' });   /* وقت الثرمو */
    await refresh(S2, T0 + 7 * H);
    await S2.tick(T0 + 7 * H + 17 * MIN);
    const m = (S2.sent.find(x => x.chat === '101') || {}).text || '';
    ok(/⚠️ <b>صار بنفس وقت اختبار MEEN 3311<\/b>/.test(m), '**ينبّهه لو صار بنفس وقت اختبار ثاني له** — ' + m.slice(-260));
    f = edit(f, '30092', e => { e.room = 'F199' });
    await refresh(S2, T0 + 14 * H);
    await S2.tick(T0 + 14 * H + 17 * MIN);
    const m2 = (S2.sent.filter(x => x.chat === '102').pop() || {}).text || '';
    ok(/MATH 2301 §102/.test(m2) && !/بنفس وقت/.test(m2), 'وشعبتان بديلتان لنفس المادة بنفس الموعد مو «بنفس وقت» — ' + m2.slice(0, 200));
  }

  /* ══ ٨) نسختان وقت النشر ⇒ كل طالب رسالة وحدة ══ */
  resetDB();
  {
    let f = live;
    const A = makeServer(() => f()), B = makeServer(() => f());
    await A.tick(T0); await B.tick(T0 + MIN);
    f = edit(live, '30011', e => { e.room = 'G300' });
    await refresh(A, T0 + 7 * H); await refresh(B, T0 + 7 * H);
    await Promise.all([A.tick(T0 + 7 * H + 17 * MIN), B.tick(T0 + 7 * H + 17 * MIN)]);
    eq(stu(A).concat(stu(B)).map(m => m.chat).sort(), ['101', '102', '106'], '**نسختان شغّالتان معاً ⇒ كل طالب رسالة وحدة** (الحجز في القاعدة)');
  }

  /* ══ ٩) نشر وسط الإرسال ⇒ الجديدة تكمّل الباقين بلا تكرار ══ */
  resetDB();
  {
    let f = live;
    const A = makeServer(() => f());
    await A.tick(T0);
    f = edit(live, '30011', e => { e.room = 'G400' });
    await refresh(A, T0 + 7 * H);
    A.onSend = n => { if (n === 1) A.ctx.SHUTTING_DOWN = true };
    await A.tick(T0 + 7 * H + 17 * MIN);
    eq(A.sent.length, 1, 'النشر بدأ بعد أول رسالة ⇒ النسخة القديمة توقف');
    eq(snapOf().M['30011'][4], 'F155', '**والنسخة ما تنحفظ** — فالجديدة تلقى نفس الفرق');
    const B = makeServer(() => f());
    await B.tick(T0 + 8 * H);
    await B.tick(T0 + 8 * H + 16 * MIN);
    eq(stu(A).concat(stu(B)).map(m => m.chat).sort(), ['101', '102', '106'], '**والجديدة تكمّل الباقين — وما تعيد على اللي وصله**');
    eq(snapOf().M['30011'][4], 'G400', 'وبعدها النسخة الجديدة');
  }

  /* ══ ١٠) القاعدة ما ردّت وقت الإرسال ⇒ نعيد بعد ربع ساعة ══ */
  resetDB();
  {
    let f = live;
    const A = makeServer(() => f());
    await A.tick(T0);
    f = edit(live, '30011', e => { e.room = 'G500' });
    await refresh(A, T0 + 7 * H);
    DB.profFail = true;
    await A.tick(T0 + 7 * H + 17 * MIN);
    ok(A.sent.length === 0 && snapOf().M['30011'][4] === 'F155' && A.W().pending && A.W().pending.tries === 1,
       '**القاعدة ما ردّت وقت الإرسال ⇒ النسخة باقية والتنبيه تحت التأكيد** (ما ضاع)');
    DB.profFail = false;
    await A.tick(T0 + 7 * H + 33 * MIN);
    eq(stu(A).map(m => m.chat).sort(), ['101', '102', '106'], '**وبعد ربع ساعة يوصل** — ما ينتظر تجديد الكاش الجاي');
  }

  /* ══ ١١) عاصفة ⇒ ما نرسل لأحد قبل محمد ══ */
  for (const yes of [true, false]) {
    resetDB();
    let f = live;
    const A = makeServer(() => f());
    await A.tick(T0);
    f = () => { const x = live(); x.M.exams.forEach(e => { if (e.crn !== '30041') e.date = 'Jan 3, 2027' }); return x };
    await refresh(A, T0 + 7 * H);
    await A.tick(T0 + 7 * H + 17 * MIN);
    const ask = A.sent.find(m => m.chat === '999' && m.markup);
    const tag = `[${yes ? 'نعم' : 'لا'}]`;
    eq(stu(A).length, 0, `${tag} **عاصفة (٣٤ من ٣٥ اختبار) ⇒ ولا رسالة لطالب**`);
    const cb = ask && ask.markup.inline_keyboard[0].map(b => b.callback_data);
    ok(!!ask && /تغيّر كثير مرة وحدة/.test(ask.text) && cb && /^fin:ok:[0-9a-f]{8}$/.test(cb[0]) && /^fin:no:[0-9a-f]{8}$/.test(cb[1]),
       `${tag} **ومحمد يجيه سؤال بزرّين** — ${ask && ask.text.slice(0, 80)}`);
    const id = cb && cb[0].split(':')[2];
    await A.decide('555', true, id);
    eq(stu(A).length, 0, `${tag} **ضغطة من محادثة غير محمد ما تسوي شي**`);
    await A.decide('999', yes, id);
    eq(stu(A).map(m => m.chat).sort(), yes ? ['101', '102', '106'] : [], yes ? '**«✅ أرسل للطلاب» ⇒ يوصلهم**' : '**«🚫 لا» ⇒ ولا رسالة**');
    eq(snapOf().M['30011'][1], 'Jan 3, 2027', `${tag} وفي الحالتين الجدول الجديد يصير المرجع`);
    await A.decide('999', true, id);
    eq(stu(A).length, yes ? 3 : 0, `${tag} وضغطة ثانية على نفس الزر ما تعيد`);
    await refresh(A, T0 + 14 * H);
    eq(stu(A).length, yes ? 3 : 0, `${tag} والتجديد اللي بعده ما يسأل ولا يرسل ثانية`);
  }

  /* ══ ١٢) ترم دراسة جديد ⇒ مرجع جديد بلا رسائل ══ */
  resetDB();
  {
    let f = live;
    const A = makeServer(() => f());
    await A.tick(T0);
    f = edit(live, '30011', e => { e.room = 'G600' });
    A.term = '202720';
    await refresh(A, T0 + 7 * H);
    ok(A.W().pending === null && snapOf().term === '202720' && A.sent.length === 0, '**ترم دراسة جديد ⇒ مرجع جديد بلا رسائل**');
  }

  /* ══ ١٣) القاعدة ما انقرأت عند الإقلاع ⇒ ما نبدأ بمرجع فاضي ══ */
  resetDB();
  {
    let f = live;
    const A = makeServer(() => f());
    await A.tick(T0);
    DB.stateFail = true;
    const B = makeServer(() => f());
    f = edit(live, '30011', e => { e.room = 'G700' });
    await B.tick(T0 + 2 * H);
    ok(B.pulls === 0 && B.W().loaded === false && B.W().stat.lastErr, '**النسخة المحفوظة ما انقرأت ⇒ ما نسحب ولا نعتبر الجدول «أول جدول»** (وإلا ضاع التغيير)');
    DB.stateFail = false;
    await B.tick(T0 + 2 * H + 5 * MIN);
    ok(B.W().pending && B.W().pending.changes[0].crn === '30011', 'وأول ما ترد القاعدة يلقى الفرق');
  }

  done();
})().catch(e => { out.push('  ✗ انهار: ' + (e && e.stack || e)); fail++; done() });
