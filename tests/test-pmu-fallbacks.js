/* الاحتياطات — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك (الجامعة · القاعدة · تيليغرام · النبض).
   ١) db      — قراءة المراقبات من القاعدة فشلت ⇒ إنذار «القاعدة ما ترد» (كانت ترجع بصمت: ولا مراقبة).
   ٢) backoff — الجامعة ما ترد دورات ورا بعض ⇒ الفاصل يتضاعف لين ربع ساعة، وأول جدول يرجّعه.
   ٣) windows — آخر نافذة مراقبة انتهت وما فيه جاية ⇒ إنذار «نوافذ المراقبة ناقصة».
   ٤) gone    — شعبة مراقَبة اختفت من جدول الجامعة ثلاث مرات ⇒ رسالة وحدة لصاحبها (والنصف ما ينحسب)،
                وما تتكرر بعد نشر جديد (goneRestart).
   ٥) beat    — HEALTHCHECK_URL: نبض «سليم» بعد الدورة، و«/fail» لو آخر دورة سليمة قبل ربع ساعة.
   ٦) static  — كل فترة تسجيل وأول إضافة في التقويم تغطيها نافذة مراقبة (تعديل واحد بلا الثاني يمسكه).
   ٧) snap    — الإنتاج يحفظ آخر جدول كامل، ونسخة جديدة (dev هنا) والجامعة متعطّلة تخدم البحث منه بعمره.

   node tests/test-pmu-fallbacks.js [server.js] */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-pmu-fallbacks';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
  const hc = process.argv.find(a => a.startsWith('--hc='));
  const env = process.argv.find(a => a.startsWith('--env='));
  /* ساعة السيرفر: على يوم بعينه، وتتقدّم برسالة من الأب ({warp: ms}) */
  let shift = at ? Date.parse(at.slice(5)) - Date.now() : 0;
  const now = Date.now.bind(Date);
  Date.now = () => now() + shift;
  process.on('message', m => { if (m && m.warp) shift += m.warp });
  const https = require('https');
  https.request = (opts, cb) => http.request({ hostname: '127.0.0.1', port: outPort, path: opts.path,
    method: opts.method, headers: Object.assign({}, opts.headers, { 'x-host': opts.hostname }) }, cb);
  Object.assign(process.env, {
    PORT: String(port), ADMIN_TOKEN: ADMIN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false'
  }, hc ? { HEALTHCHECK_URL: hc.slice(5) } : {}, env ? { SITE_ENV: env.slice(6) } : {});
  console.log = () => {};
  require(SRV);
  return;
}

let pass = 0, fail = 0;
const out = [];
const T = name => ({
  ok: (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${name}] ` + m) } },
  eq(a, b, m) { this.ok(JSON.stringify(a) === JSON.stringify(b), `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`) }
});

/* ═══ قاعدة PostgREST-ية (نفس محاكي test-alert-delivery) ═══ */
function filt(rows, qs) {
  let r = rows.slice();
  const test = (x, col, op, v) => {
    const a = x[col];
    if (op === 'eq') return a != null && String(a) === v;
    if (op === 'neq') return a != null && String(a) !== v;
    if (op === 'is') return v === 'null' ? a == null : String(a) === v;
    if (op === 'not.is') return v === 'null' ? a != null : String(a) !== v;
    if (op === 'in') return new Set(v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, ''))).has(String(a));
    if (a == null) return false;
    const A = Date.parse(a), V = Date.parse(v);
    const c = Number.isFinite(A) && Number.isFinite(V) ? A - V : (String(a) < v ? -1 : String(a) > v ? 1 : 0);
    return op === 'lt' ? c < 0 : op === 'lte' ? c <= 0 : op === 'gt' ? c > 0 : c >= 0;
  };
  for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=(eq|neq|lt|lte|gt|gte|in|is|not\.is)\.([^&]*)/g)) {
    const [, col, op, v] = m;
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    r = r.filter(x => test(x, col, op, v));
  }
  const or = /(?:^|&)or=\(([^)]*)\)/.exec(qs);
  if (or) {
    const conds = or[1].split(',').map(c => /^([a-z_]+)\.(eq|neq|is|lt|gt)\.(.*)$/.exec(c)).filter(Boolean);
    r = r.filter(x => conds.some(([, col, op, v]) => test(x, col, op, v)));
  }
  return r;
}
const table = rows => '<table><tbody>' + rows.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
  '</tbody></table>';

function makeOutside(o) {
  const st = { DB: o.DB, pmu: Object.assign({ hits: [], mode: 'ok' }, o.pmu), TG: [], HC: [], dbFail: false, nextId: 1000 };
  st.server = http.createServer((req, res) => {
    st.reqs = (st.reqs || 0) + 1;
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        const P = st.pmu;
        P.hits.push({ method: req.method, url: req.url });
        if (P.mode === 'down') return req.socket.destroy();
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        if (P.failG && P.failG === g) { res.writeHead(500, { 'Content-Type': 'text/html' }); return res.end('Server Error') }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? P.F1 : g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
      }
      if (host === 'hc-ping.com') { st.HC.push(req.url); res.writeHead(200); return res.end('OK') }
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body) } catch (e) {}
        if (!/sendMessage$/.test(req.url)) return json(200, { ok: true, result: true });
        st.TG.push({ chat: String(b.chat_id), text: String(b.text || ''), markup: b.reply_markup || null, at: Date.now() });
        return json(200, { ok: true, result: { message_id: 1 } });
      }
      if (host === 'fake.supabase.co') {
        const [p, raw = ''] = req.url.split('?');
        let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
        const t = p.replace('/rest/v1/', '');
        /* القاعدة متعطّلة: PostgREST يرجّع كائن خطأ لا مصفوفة */
        if (st.dbFail && t === 'monitored_courses' && req.method === 'GET')
          return json(503, { code: 'PGRST000', message: 'Could not connect to the database' });
        const list = st.DB[t] || (st.DB[t] = []);
        const rep = /return=representation/.test(req.headers.prefer || '');
        if (req.method === 'POST') {
          const b = JSON.parse(body || '{}');
          /* حالة السيرفر: upsert بالمفتاح مثل merge-duplicates */
          if (t === 'app_state') (Array.isArray(b) ? b : [b]).forEach(x => {
            const i = list.findIndex(y => y.key === x.key);
            if (i >= 0) list[i] = Object.assign({}, list[i], x); else list.push(x);
          });
          else (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: st.nextId++ }, x)));
          return json(201, []);
        }
        if (req.method === 'PATCH') {
          const b = JSON.parse(body || '{}'), hit = filt(list, qs);
          hit.forEach(x => Object.assign(x, b));
          return json(200, rep ? hit.map(x => Object.assign({}, x)) : []);
        }
        if (req.method === 'DELETE') { const hit = filt(list, qs); st.DB[t] = list.filter(x => !hit.includes(x)); return json(200, []) }
        let r = filt(list, qs);
        const off = /(?:^|&)offset=(\d+)/.exec(qs), lim = /(?:^|&)limit=(\d+)/.exec(qs);
        if (off) r = r.slice(Number(off[1]));
        return json(200, r.slice(0, lim ? Number(lim[1]) : 1000));
      }
      json(200, { status: 1 });
    });
  });
  return new Promise(r => st.server.listen(0, '127.0.0.1', () => { st.port = st.server.address().port; r(st) }));
}

let PORTN = 24900 + (process.pid % 40);
function instance(st, extra) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child'].concat(extra || [], [String(st.port), String(port)]), { silent: true });
  const get = (p, h) => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: h || {} }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', () => resolve({ status: 0, body: '' })); r.end();
  });
  c.check = () => get('/api/run-check', { 'X-Admin-Token': ADMIN }).then(r => r.status);
  c.health = () => get('/api/admin/health', { 'X-Admin-Token': ADMIN }).then(r => { try { return JSON.parse(r.body) } catch (e) { return {} } });
  c.warp = ms => c.send({ warp: ms });
  c.run = () => get('/api/run-check', { 'X-Admin-Token': ADMIN }).then(r => { try { return JSON.parse(r.body) } catch (e) { return null } });
  c.st = st;
  c.search = g => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: `/api/courses?term=202710&college=ALL&gender=${g || 'M1'}`, method: 'GET' }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, j }) });
    });
    r.on('error', () => resolve({ status: 0, headers: {}, j: null })); r.end();
  });
  c.up = async () => { for (let i = 0; i < 50; i++) { if ((await get('/api/monitor-status')).status === 200) return true; await wait(200) } return false };
  return c;
}
/* جاهز = الإقلاع خلص (الاستعادة) — بلا ما نطلب دورة. كانت ready تطلب الدورة الأولى نفسها، فطلب الدورة اللي
   بعدها يلقاها شغّالة ويتخطّى والوقت الثابت يغطّي — وتحت الحمل ما يغطّي (طاحت في run-all بلا علاقة بالكود) */
const ready = async c => {
  for (let i = 0; i < 150; i++) {
    const h = await c.health();
    if (h.booted || (h.uptimeHours !== undefined && !('booted' in h))) return true;   /* نسخة قبل booted: ترد وبس */
    await wait(100);
  }
  return false;
};
/* «الخارج» هدأ: ولا طلب جديد ٣٠٠ م.ث — الإنذارات تنرسل بلا await، فتوصل بعد ما تنسجّل الدورة */
const settle = async st => { let n = -1; for (const t0 = Date.now(); Date.now() - t0 < 8000 && st.reqs !== n;) { n = st.reqs; await wait(300) } };
/* دورة كاملة: نطلبها ونستنى لين **تخلص فعلاً** (lastCycle.gen في الصحة) ثم يهدأ «الخارج» — لا وقت ثابت يسبقها
   تحت الحمل. والطلب والسابقة شغّالة يتخطّى (ran:false): نستنى السابقة ونطلب ثانية. نسخة قبل gen: وقت ثابت كما كان */
const cycleOf = async (c, ms = 5000) => {
  const t0 = Date.now();
  for (;;) {
    const r = await c.run();
    if (!r || r.gen === undefined) { await wait(ms); return }
    while (Date.now() - t0 < 60000 && (((await c.health()).lastCycle || {}).gen || 0) < r.gen) await wait(100);
    if (r.ran || Date.now() - t0 >= 60000) break;
  }
  await settle(c.st);
};

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
const base = paused => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: paused === false ? [] : [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last, term) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', section: '199', crn, term: term || '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const adminSays = (st, re) => msgsTo(st, 5555).filter(m => re.test(m.text)).length;
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(200) } return fn() };

/* ١٠ الصبح بالرياض، داخل نافذة تسجيل الثاني وبعد أيام التسجيل نفسها (فاصلها ٥ دقائق) — وترمها 202720 */
const IN_WINDOW = '2027-01-19T07:00:00Z', WIN_TERM = '202720';

const SCEN = {
  async db(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED')], F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st); await ready(c);
    st.dbFail = true;
    await cycleOf(c, 2500);
    t.ok(adminSays(st, /القاعدة ما ترد/) === 1,
      '**قراءة المراقبات من القاعدة فشلت: الإدارة يوصلها «القاعدة ما ترد — المراقبة واقفة»** (كانت ترجع بصمت)');
    t.eq(st.pmu.hits.length, 0, 'وما سحبنا من الجامعة على الفاضي');
    st.dbFail = false;
    await cycleOf(c);
    t.ok(adminSays(st, /رجع طبيعي: القاعدة ما ترد/) === 1, 'ورجعت: «رجع طبيعي»');
    c.kill('SIGKILL');
  },
  async backoff(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { mode: 'down', M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    const mi = async () => ((await c.health()).monitorInfo || {});
    for (let i = 0; i < 4; i++) await cycleOf(c, 3500);
    let m = await mi();
    t.eq([m.downCycles, m.backoffMin], [4, 10], 'الجامعة ما ترد ٤ دورات: بعد المحاولات السريعة الفاصل ضعف (١٠ دقائق)');
    await cycleOf(c, 3500);
    m = await mi();
    t.eq(m.backoffMin, 15, '**وبعدها ربع ساعة سقفاً** (كان يرجع لفاصله ويطرق موقعاً متعثّراً للأبد)');
    st.pmu.mode = 'ok';
    await cycleOf(c);
    m = await mi();
    t.eq([m.downCycles, m.backoffMin], [0, 0], 'أول جدول يوصل: الفاصل طبيعي');
    t.eq(msgsTo(st, 901).length, 1, 'والطالب وصله «فتحت»');
    c.kill('SIGKILL');
  },
  async windows(t) {
    /* بعد آخر نافذة في الكود (٢٢ يونيو ٢٠٢٧) — التسجيل الجاي بلا نافذة */
    const st = await makeOutside({ DB: base(), pmu: { M1: [], F1: [] } });
    const c = instance(st, ['--at=2027-07-01T07:00:00Z']);
    await until(() => adminSays(st, /نوافذ المراقبة ناقصة/), 8000);
    t.ok(adminSays(st, /نوافذ المراقبة ناقصة/) === 1 && adminSays(st, /ما فيه وحدة جاية/) === 1,
      '**آخر نافذة انتهت وما فيه جاية: الإدارة يوصلها «نوافذ المراقبة ناقصة»** (كان التسجيل الجاي يمر بلا مراقبة)');
    c.kill('SIGKILL');
    /* واليوم (نوافذ ٢٠٢٧ موجودة) ما فيه إنذار */
    const st2 = await makeOutside({ DB: base(), pmu: { M1: [], F1: [] } });
    const c2 = instance(st2); await ready(c2);
    await wait(3000);
    t.eq(adminSays(st2, /نوافذ المراقبة/), 0, 'والنوافذ مضبوطة: ولا إنذار');
    c2.kill('SIGKILL');
  },
  async gone(t) {
    const DB = base(); user(DB, 1); user(DB, 2);
    watch(DB, 1, '30099', 'CLOSED');        /* انلغت — ما تطلع في جدول الجامعة */
    watch(DB, 2, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED')], F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c); await cycleOf(c);
    st.pmu.failG = 'F1';                     /* نصف جدول: ما ينحسب */
    await cycleOf(c, 6000);
    t.eq(msgsTo(st, 901).length, 0, 'مرتين بجدول كامل ومرة بنصف جدول: لسّا ما قلنا له');
    st.pmu.failG = null;
    await cycleOf(c);
    const m = msgsTo(st, 901);
    t.ok(m.length === 1 && /اختفت من جدول الجامعة/.test(m[0].text) && /30099/.test(m[0].text),
      '**ثالث جدول كامل بلاها: صاحبها وصلته «الشعبة اللي تراقبها اختفت»** (كان ينتظر للأبد)');
    t.ok(m[0] && JSON.stringify(m[0].markup || {}).includes('stop:'), 'ومعها زر «أوقف مراقبة هذي الشعبة»');
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, 'ومرة وحدة — الدورة اللي بعدها ما كررت');
    t.eq(msgsTo(st, 902).length, 0, 'وصاحب الشعبة الموجودة ما وصله شي');
    c.kill('SIGKILL');
  },
  async goneRestart(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30098', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED')], F1: [frow('40011', 'CLOSED')] } });
    const a = instance(st); await ready(a);
    for (let i = 0; i < 3; i++) await cycleOf(a);
    t.eq(msgsTo(st, 901).length, 1, 'اختفت ثلاث مرات: رسالة وحدة');
    a.kill('SIGTERM');                         /* نشر جديد: الحالة تنحفظ عند الإغلاق */
    await new Promise(r => a.on('exit', r));
    const b = instance(st); await ready(b);
    for (let i = 0; i < 3; i++) await cycleOf(b);
    t.eq(msgsTo(st, 901).length, 1, '**بعد النشر الجديد: ما تكررت** (اللي انقال له محفوظ مع الحالة)');
    b.kill('SIGKILL');
  },
  async beat(t) {
    /* المراقبة غير موقوفة هنا: الموقوفة من اللوحة قرار صاحب الموقع، والنبض فيها «سليم» */
    const DB = base(false); user(DB, 1); watch(DB, 1, '30011', 'CLOSED', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED')], F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st, ['--at=' + IN_WINDOW, '--hc=https://hc-ping.com/abc123']); await ready(c);
    await cycleOf(c);
    t.ok(st.HC.includes('/abc123'), '**HEALTHCHECK_URL: بعد دورة سليمة نبض «سليم»** (كان ما فيه نبض: وقوف السيرفر كله ما يدري عنه أحد)');
    t.ok(!st.HC.some(u => /fail/.test(u)), 'وبلا «/fail»');
    st.pmu.mode = 'down';
    c.warp(16 * 60 * 1000);                  /* ربع ساعة بلا دورة سليمة */
    await wait(300);
    await cycleOf(c, 4000);
    t.ok(st.HC.includes('/abc123/fail'), '**ربع ساعة بلا دورة سليمة والمراقبة المفروض شغّالة: «/fail»**');
    c.kill('SIGKILL');
  },
  async snap(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED'), row('30012', 'OPEN', '102')],
      F1: [frow('40011', 'CLOSED')] } });
    const a = instance(st); await ready(a);
    await cycleOf(a);
    const saved = (DB.app_state || []).find(x => x.key === 'snapshot-202710');
    t.ok(saved && saved.value && saved.value.M1.length === 2 && saved.value.F1.length === 1,
      'الإنتاج حفظ آخر جدول كامل (صف snapshot-202710 — مصفوفات بلا أسماء حقول مكررة)');
    a.kill('SIGKILL');
    st.pmu.mode = 'down';                     /* الجامعة متعطّلة وقت الإقلاع الجديد */
    const b = instance(st, ['--env=dev']); await b.up();
    await wait(1500);
    const s = await b.search('M1');
    const crns = ((s.j && s.j.courses) || []).map(x => x.crn).sort();
    t.eq([s.status, crns], [200, ['30011', '30012']],
      '**نسخة جديدة والجامعة متعطّلة: البحث يخدم آخر جدول محفوظ** — كان «فشل» للكل لين ترجع');
    t.ok(Number(s.headers['x-age-ms']) >= 1000, 'وبعمره الحقيقي (X-Age-Ms من وقت الحفظ) — ' + s.headers['x-age-ms']);
    t.eq(st.DB.app_state.filter(x => /^snapshot-/.test(x.key)).length, 1, 'وdev ما يكتب نسخته');
    b.kill('SIGKILL');
  },
  async static(t) {
    /* من الكود نفسه: التقويم والنوافذ */
    const src = fs.readFileSync(SRV, 'utf8');
    const grab = name => {
      const i = src.indexOf(`const ${name} = [`);
      if (i < 0) return null;
      const j = src.indexOf('\n];', i);
      return eval(src.slice(src.indexOf('[', i), j + 2));
    };
    const CAL = grab('ACAD_CAL'), WIN = grab('MONITOR_WINDOWS');
    t.ok(Array.isArray(CAL) && Array.isArray(WIN) && CAL.length > 10 && WIN.length > 0, 'قرأنا التقويم والنوافذ من السيرفر');
    const covered = (s, e) => WIN.some(w => w.from <= s && w.to >= e);
    const regs = (CAL || []).filter(x => x.t === 'reg');
    const bad = regs.filter(x => !covered(x.s, x.e || x.s)).map(x => `${x.term} ${x.s}`);
    t.eq(bad, [], '**كل فترة تسجيل في التقويم تغطيها نافذة مراقبة**');
    const seen = new Set(), adds = [];
    for (const x of CAL || []) if (x.t === 'add' && !seen.has(x.term)) { seen.add(x.term); adds.push(x) }
    t.eq(adds.filter(x => !covered(x.s, x.e || x.s)).map(x => `${x.term} ${x.s}`), [],
      '**وأول فترة إضافة لكل ترم كذلك** (النافذة لآخر يوم إضافة)');
    t.eq((WIN || []).filter(w => !regs.some(r => r.term === w.term && r.s === w.from)).map(w => w.from), [],
      'وكل نافذة تبدأ مع بداية تسجيل ترمها في التقويم');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`الاحتياطات: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
