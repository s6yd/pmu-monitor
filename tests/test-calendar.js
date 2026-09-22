/* التقويم الموحّد — اختبار شامل.
   ١) التقويم يطابق التقويم الرسمي للجامعة
   ٢) النوافذ تنتهي بآخر يوم إضافة، وكل واحدة بترمها
   ٣) حد الغياب في السيرفر = حد الغياب في الصفحة، لكل ترم
   ٤) في أبريل: ترم التسجيل (الصيفي) غير ترم الدراسة (الثاني)
   ٥) /calendar.js يُخدم ويُقرأ

   node tests/test-calendar.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { spawnSync } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));

/* ═══ وضع الابن: سيرفر حقيقي بتاريخ ثابت ═══ */
if (process.argv[2] === '--child') {
  const [, , , srv, iso, active] = process.argv;
  const FIXED = Date.parse(iso);
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])) }
    static now() { return FIXED }
  };
  process.env.PORT = '45877';
  process.env.SITE_ENV = 'prod';
  process.env.ACTIVE_TERM = active;
  process.env.ADMIN_TOKEN = 'x'.repeat(20);
  const log = console.log; console.log = () => {};
  require(srv);
  setTimeout(() => {
    const get = p => new Promise(r => http.get({ host: '127.0.0.1', port: 45877, path: p },
      res => { let o = ''; res.on('data', c => o += c); res.on('end', () => r({ code: res.statusCode, body: o, etag: res.headers.etag })) }));
    Promise.all([get('/api/monitor-status'), get('/calendar.js')]).then(([st, cal]) => {
      log(JSON.stringify({ st: JSON.parse(st.body), cal: { code: cal.code, body: cal.body, etag: cal.etag } }));
      process.exit(0);
    });
  }, 600);
  return;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const source = fs.readFileSync(SRV, 'utf8');
const L = source.split('\n');
const from = L.findIndex(x => x.startsWith('const NOTIF_HOUR = 17;'));
const to = L.findIndex(x => x.startsWith('function tg('));
const REGION = L.slice(from, to).join('\n');

const ctx = { console: { log() {} }, riyadhNow: () => new Date('2026-10-01T09:00:00Z'),
  Date, Set, Map, Object, Array, String, Number, Math, JSON, Promise };
vm.createContext(ctx);
vm.runInContext(REGION + '\nthis.ACAD_CAL = ACAD_CAL; this.absAllowedFor = absAllowedFor;' +
  'this.termBoundsSrv = termBoundsSrv;', ctx);
const CAL = ctx.ACAD_CAL;

/* النوافذ في منطقة أخرى من الملف */
const wm = /const MONITOR_WINDOWS = (\[[\s\S]*?\n\]);/.exec(source);
const WINDOWS = wm ? vm.runInNewContext('(' + wm[1] + ')') : [];

/* ── ١) مطابقة التقويم الرسمي ── */
{
  const has = (s, e, t) => CAL.some(x => x.s === s && (x.e || undefined) === e && x.t === t);
  const OFFICIAL = [
    ['2026-08-23', '2026-08-27', 'reg', 'الأول: التسجيل'],
    ['2026-08-30', undefined, 'start', 'الأول: بداية الدراسة'],
    ['2026-08-30', '2026-09-03', 'add', 'الأول: الحذف والإضافة يبدأ ٣٠ أغسطس لا ٢٨'],
    ['2026-11-05', undefined, 'warn', 'الأول: W'],
    ['2026-12-17', undefined, 'warn', 'الأول: WP/WF'],
    ['2026-12-20', '2026-12-30', 'exam', 'الأول: النهائيات'],
    ['2027-01-10', '2027-01-14', 'reg', 'الثاني: التسجيل'],
    ['2027-01-17', undefined, 'start', 'الثاني: بداية الدراسة'],
    ['2027-01-17', '2027-01-21', 'add', 'الثاني: الحذف والإضافة'],
    ['2027-02-28', '2027-03-13', 'off', 'الثاني: عيد الفطر'],
    ['2027-04-08', undefined, 'warn', 'الثاني: W'],
    ['2027-04-11', '2027-04-15', 'reg', 'المبكر للصيفي'],
    ['2027-05-11', '2027-05-22', 'off', 'الثاني: عيد الأضحى'],
    ['2027-05-27', undefined, 'warn', 'الثاني: WP/WF'],
    ['2027-05-30', '2027-06-09', 'exam', 'الثاني: النهائيات'],
    ['2027-06-15', '2027-06-19', 'reg', 'الصيفي: التأكيد'],
    ['2027-06-20', undefined, 'start', 'الصيفي: بداية الدراسة'],
    ['2027-06-20', '2027-06-22', 'add', 'الصيفي: الحذف والإضافة'],
    ['2027-08-15', '2027-08-17', 'exam', 'الصيفي: النهائيات']
  ];
  for (const [s, e, t, name] of OFFICIAL) ok(has(s, e, t), 'التقويم الرسمي — ' + name);
  ok(!CAL.some(x => x.s === '2026-08-28'), 'لا أثر لتاريخ ٢٨ أغسطس الخاطئ');
  ok(CAL.every(x => /^\d{6}$/.test(x.term || '')), 'كل حدث يحمل ترمه');
  ok(CAL.every(x => x.ar && x.en), 'كل حدث بالعربي والإنجليزي');
}

/* ── ٢) النوافذ ── */
{
  const W = Object.fromEntries(WINDOWS.map(w => [w.from, w]));
  ok(WINDOWS.length === 4, 'أربع نوافذ — ' + WINDOWS.length);
  ok(W['2026-08-23'] && W['2026-08-23'].to === '2026-09-03', 'الأول ينتهي ٣ سبتمبر (آخر إضافة) لا ١٠');
  ok(W['2027-01-10'] && W['2027-01-10'].to === '2027-01-21', 'الثاني ١٠ ← ٢١ يناير');
  ok(W['2027-04-11'] && W['2027-04-11'].to === '2027-04-15', 'المبكر للصيفي ١١ ← ١٥ أبريل');
  ok(W['2027-06-15'] && W['2027-06-15'].to === '2027-06-22', 'الصيفي ١٥ ← ٢٢ يونيو');
  ok(W['2027-04-11'] && W['2027-04-11'].term === '202730', 'نافذة أبريل ترمها الصيفي');
  ok(WINDOWS.every(w => /^\d{6}$/.test(w.term || '')), 'كل نافذة بترمها');
  /* النافذة داخل التقويم: تبدأ مع التسجيل وتنتهي مع آخر إضافة لنفس الترم */
  /* التسجيل المبكر للصيفي ما له إضافة في أبريل — ينتهي بنهاية التسجيل نفسه */
  for (const w of WINDOWS) {
    const reg = CAL.find(x => x.t === 'reg' && x.s === w.from);
    const endsAt = CAL.find(x => x.term === w.term && x.e === w.to &&
                                 (x.t === 'add' || x.t === 'reg'));
    ok(reg && endsAt, `نافذة ${w.from} مربوطة ببداية ونهاية من التقويم`);
  }
}

/* ── ٣) حد الغياب حسب الترم ── */
const SRV_ABS = {};
{
  for (const [d, name] of [['2026-10-01', 'الأول'], ['2027-02-15', 'الثاني'], ['2027-07-01', 'الصيفي']]) {
    SRV_ABS[d] = ctx.absAllowedFor('UT', d);
    ok(SRV_ABS[d] > 0, `حد غياب في ${name}: ${SRV_ABS[d]}`);
  }
  ok(SRV_ABS['2026-10-01'] !== SRV_ABS['2027-07-01'],
     'الصيفي حدّه غير الأول — كان يُحسب على الأول دائماً');
  ok(ctx.absAllowedFor('UT', '2027-01-05') === 0, 'إجازة منتصف السنة: لا حد غياب لترم منقضٍ');
  const b = ctx.termBoundsSrv('2027-02-15');
  ok(b && b.start === '2027-01-17' && b.end === '2027-05-30', 'حدود الثاني صحيحة');
}

/* ── ٤) أبريل: سيرفر حقيقي بتاريخ ثابت ── */
{
  const r = spawnSync(process.execPath, [__filename, '--child', SRV, '2027-04-12T09:00:00Z', '202720'],
                      { encoding: 'utf8', timeout: 20000 });
  let out = null;
  try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch (e) {}
  ok(!!out, 'السيرفر اشتغل بتاريخ ١٢ أبريل');
  if (out) {
    ok(out.st.term === '202720', 'ترم الدراسة: الثاني — ' + out.st.term);
    ok(out.st.regTerm === '202730', 'ترم التسجيل: الصيفي — ' + out.st.regTerm);
    ok(out.st.canWatch === true, 'الجرس مفتوح في نافذة أبريل');
    ok(out.cal.code === 200, '/calendar.js يرد ٢٠٠');
    ok(/^window\.ACAD_CAL=\[/.test(out.cal.body), 'ويعرّف window.ACAD_CAL');
    ok(/^"[0-9a-f]{16}"$/.test(out.cal.etag || ''), 'وله بصمة');
    const served = vm.runInNewContext(out.cal.body.replace(/^window\./, 'this.') + ';this.ACAD_CAL');
    ok(JSON.stringify(served) === JSON.stringify(CAL), 'المخدوم مطابق للتقويم في السيرفر حرفياً');
  }
  const r2 = spawnSync(process.execPath, [__filename, '--child', SRV, '2027-05-01T09:00:00Z', '202720'],
                       { encoding: 'utf8', timeout: 20000 });
  let out2 = null;
  try { out2 = JSON.parse((r2.stdout || '').trim().split('\n').pop()) } catch (e) {}
  ok(out2 && out2.st.regTerm === '202720' && out2.st.canWatch === false,
     'بعد نافذة أبريل: ترم التسجيل يرجع لترم الدراسة والجرس مقفول');
}

/* ── ٥) الصفحة: نفس الحد، وترم التسجيل في البحث والجرس ── */
(async () => {
  const { chromium } = require('playwright');
  const calJs = 'window.ACAD_CAL=' + JSON.stringify(CAL) + ';';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(calJs) }
    /* الصفحة صارت تحمّل الخطط من /plans.js — نخدم الملف الحقيقي.
       تغيير بنية لا تسهيل: بدونه يرجع الرد الافتراضي JSON، والصفحة
       تنفّذه كسكربت فينفجر SyntaxError. */
    if (u === '/plans.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ courses: [], term: '202720', canWatch: false }));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();

  const openAt = async iso => {
    const p = await browser.newPage();
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    await p.addInitScript(t => {
      const F = Date.parse(t), R = Date;
      window.Date = class extends R { constructor(...a) { super(...(a.length ? a : [F])) } static now() { return F } };
    }, iso);
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof allowedAbs === 'function', null, { timeout: 15000 });
    return p;
  };

  for (const [d, name] of [['2026-10-01', 'الأول'], ['2027-02-15', 'الثاني'], ['2027-07-01', 'الصيفي']]) {
    const p = await openAt(d + 'T09:00:00Z');
    const v = await p.evaluate(() => allowedAbs('UT'));
    ok(v === SRV_ABS[d], `${name}: الصفحة ${v} = السيرفر ${SRV_ABS[d]}`);
    await p.close();
  }

  const p = await openAt('2027-04-12T09:00:00Z');
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  const r = await p.evaluate(() => {
    MON_STATE = { term: '202720', regTerm: '202730', canWatch: true }; LANG = 'ar';
    syncTermSelect();
    const sel = document.getElementById('term');
    const def = sel.value, hint1 = document.getElementById('termHint').textContent;
    sel.value = '202720'; termHint();
    const hint2 = document.getElementById('termHint').textContent;
    return { def, hint1, hint2, gSummer: watchGate('202730').ok, gSpring: watchGate('202720').ok,
             inSched: serverTerm(), cal: window.ACAD_CAL.length };
  });
  ok(r.cal === CAL.length, 'الصفحة قرأت التقويم من /calendar.js');
  ok(r.def === '202730', 'أبريل: البحث يفتح على الصيفي — ' + r.def);
  ok(/المفتوح للتسجيل/.test(r.hint1), 'والبطاقة على الصيفي: مفتوح للتسجيل');
  ok(/الترم الحالي/.test(r.hint2), 'والثاني: «الترم الحالي»');
  ok(r.gSummer === true, 'الجرس يقبل الصيفي');
  ok(r.gSpring === false, 'ويرفض الثاني — ما فيه تسجيل له الآن');
  ok(r.inSched === '202720', '«في جدولك» يبقى على ترم الدراسة');
  const kept = await p.evaluate(() => {
    const sel = document.getElementById('term');
    sel.value = '202620'; sel.dispatchEvent(new Event('change'));
    syncTermSelect();
    return sel.value;
  });
  ok(kept === '202620', 'اختيار الطالب يُحترم ولا يرجّعه السيرفر');
  await p.close();

  /* بلا /calendar.js: الصفحة ما تنهار */
  {
    const q = await browser.newPage();
    const e2 = [];
    q.on('pageerror', e => e2.push(String(e)));
    await q.route('**/calendar.js', r => r.fulfill({ status: 503, body: '' }));
    await q.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await q.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    await q.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await q.waitForTimeout(800);
    const len = await q.evaluate(() => Array.isArray(window.ACAD_CAL) ? window.ACAD_CAL.length : -1);
    ok(len === 0, 'تعذّر التقويم: قائمة فاضية بدل undefined');
    ok(e2.length === 0, 'والصفحة بلا أخطاء — ' + e2.slice(0, 1).join(''));
    await q.close();
  }

  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('انهار الاختبار: ' + e.stack); process.exit(1) });
