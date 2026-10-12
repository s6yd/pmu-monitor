/* إشارات الجامعة — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك (الجامعة · القاعدة · تيليغرام).
   كان كل فشل «موقع الجامعة ما يستجيب»، وجدول ما نفهمه يُصدَّق:
   ١) shift   — عمود جديد في جدول الجامعة يزيح الحالة ⇒ ما نكتب حالة منه، وإنذار «يرد بشكل ما نفهمه»،
                وبعد ما يرجع ما يطلع للطالب «فتحت» عن شعبة كانت مفتوحة أصلاً.
   ٢) attrs   — وسوم بخصائص (<tr class=…>) ⇒ الجدول ينقرأ والطالب يوصله (كان «رد بلا صفوف»).
   ٣) maint   — صفحة صيانة بلا رمز ⇒ إنذار «ما نفهمه» بعنوانها، لا «ما يستجيب».
   ٤) down    — انقطاع ⇒ «ما يستجيب» كما كان.
   ٥) block   — 403 ⇒ نوقف **كل** السحب (الدورة والبحث) ونخبر الإدارة؛ والبحث بلا نسخة ٥٠٣ بمهلة.
   ٦) slow    — 429 مع Retry-After ⇒ ننتظر المدة اللي طلبوها بالضبط ثم نرجع ونخبر إنها رجعت.
   ٧) short   — جدول ناقص (الجامعة قصّته) ⇒ الشعبة بعينها تنراقب، و«نزلت شعبة جديدة» ما تطلع كاذبة.
   ٨) accept  — نزول حقيقي يثبت ست سحبات ⇒ نعتمده ومراقبة المادة كاملة ترجع تشتغل.
   ٩) search  — البحث بجدول أعمدته تغيّرت ما يرجّع حالات غلط.

   node tests/test-pmu-signals.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-pmu-signals';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const https = require('https');
  https.request = (opts, cb) => http.request({ hostname: '127.0.0.1', port: outPort, path: opts.path,
    method: opts.method, headers: Object.assign({}, opts.headers, { 'x-host': opts.hostname }) }, cb);
  Object.assign(process.env, {
    PORT: String(port), ADMIN_TOKEN: ADMIN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false'
  });
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

/* جدول الجامعة بأشكاله: المعروف · وسوم بخصائص · عمود «المقاعد» قبل الحالة */
function table(rows, mode) {
  if (mode === 'attrs')
    return '<table class="table table-striped"><tbody>' + rows.map((r, i) =>
      `<tr class="${i % 2 ? 'even' : 'odd'}" role="row">` + r.map(v => `<td class="text-center">${v}</td>`).join('') +
      '</tr>').join('') + '</tbody></table>';
  if (mode === 'shift') rows = rows.map(r => r.slice(0, 8).concat(['12'], r.slice(8)));
  return '<table><tbody>' + rows.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}

function makeOutside(o) {
  const st = { DB: o.DB, pmu: Object.assign({ mode: 'ok', hits: [] }, o.pmu), TG: [], nextId: 1000 };
  st.server = http.createServer((req, res) => {
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        const P = st.pmu;
        P.hits.push({ method: req.method, url: req.url, at: Date.now() });
        if (P.mode === 'down') return req.socket.destroy();
        if (P.mode === '403') { res.writeHead(403, { 'Content-Type': 'text/html' }); return res.end('<html><head><title>403 - Forbidden</title></head></html>') }
        if (P.mode === '429') {
          res.writeHead(429, Object.assign({ 'Content-Type': 'text/plain' }, P.retryAfter ? { 'Retry-After': String(P.retryAfter) } : {}));
          return res.end('Too Many Requests');
        }
        if (req.url === '/') {
          if (P.mode === 'maint') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<html><head><title>Site Under Maintenance</title></head><body>Back soon</body></html>');
          }
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? P.F1 : g === 'M1' ? P.M1 : P.M1.concat(P.F1), P.mode));
      }
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body) } catch (e) {}
        if (!/sendMessage$/.test(req.url)) return json(200, { ok: true, result: true });
        st.TG.push({ chat: String(b.chat_id), text: String(b.text || ''), at: Date.now() });
        return json(200, { ok: true, result: { message_id: 1 } });
      }
      if (host === 'fake.supabase.co') {
        const [p, raw = ''] = req.url.split('?');
        let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
        const t = p.replace('/rest/v1/', '');
        const list = st.DB[t] || (st.DB[t] = []);
        const rep = /return=representation/.test(req.headers.prefer || '');
        if (req.method === 'POST') {
          if (t !== 'app_state') { const b = JSON.parse(body || '{}');
            (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: st.nextId++ }, x))) }
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

let PORTN = 49700 + (process.pid % 40);
function instance(st) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child', String(st.port), String(port)], { silent: true });
  const get = (p, h) => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: h || {} }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', () => resolve({ status: 0, headers: {}, body: '' })); r.end();
  });
  c.check = () => get('/api/run-check', { 'X-Admin-Token': ADMIN }).then(r => r.status);
  c.search = (g = 'M1') => get(`/api/courses?term=202710&college=ALL&gender=${g}`);
  /* تحذيرات اللوحة (تبويب الصحة) — نصوصها */
  c.warnings = () => get('/api/admin/health', { 'X-Admin-Token': ADMIN }).then(r => {
    try { return (JSON.parse(r.body).warnings || []).map(w => w.ar).join(' | ') } catch (e) { return '' }
  });
  return c;
}
const ready = async c => { for (let i = 0; i < 50; i++) { if (await c.check() === 200) return true; await wait(200) } return false };
/* دورة كاملة: سحبتان من الجامعة بينهما ١٫٥ ثانية، ثم المعالجة والإرسال */
const cycleOf = async (c, ms = 5000) => { await c.check(); await wait(ms) };

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
const F1 = () => [frow('40011', 'CLOSED')];
const base = () => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const courseMon = (DB, n, state) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'course',
  course_code: 'MEEN 3311', crn: null, term: '202710', last_status: null, followup_done: true, followup_at: null,
  expires_at: null, sections_state: state, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const adminSays = (st, re) => msgsTo(st, 5555).some(m => re.test(m.text));
const statusOf = (DB, crn) => (DB.monitored_courses.find(m => m.crn === crn) || {}).last_status;

const SCEN = {
  async shift(t) {
    const DB = base(); user(DB, 1); user(DB, 2);
    watch(DB, 1, '30011', 'OPEN');          /* مفتوحة من قبل — ما يستاهل «فتحت» */
    watch(DB, 2, '30012', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'shift',
      M1: [row('30011', 'OPEN'), row('30012', 'CLOSED', '102')], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([statusOf(DB, '30011'), statusOf(DB, '30012')], ['OPEN', 'CLOSED'],
      '**عمود جديد في جدول الجامعة يزيح الحالة: ما كتبنا حالة منه** (كانت تنكتب «12» حالةً)');
    t.ok(adminSays(st, /يرد بشكل ما نفهمه/) && adminSays(st, /الأعمدة تغيّرت/),
      'والإدارة يوصلها «يرد بشكل ما نفهمه — الأعمدة تغيّرت» (كان ولا إنذار)');
    t.ok(!adminSays(st, /ما يستجيب/), 'لا «ما يستجيب» — الموقع يرد');
    t.ok(/يرد بشكل ما نفهمه/.test(await c.warnings()), 'واللوحة تقول «يرد بشكل ما نفهمه» لا «فشلت» وبس');
    st.pmu.mode = 'ok';
    st.pmu.M1 = [row('30011', 'OPEN'), row('30012', 'OPEN', '102')];
    await cycleOf(c);
    t.eq([msgsTo(st, 901).length, msgsTo(st, 902).length], [0, 1],
      '**رجع الشكل: «فتحت» للي فتحت فعلاً بس — والمفتوحة من قبل ما طلع لصاحبها إشعار كاذب**');
    c.kill('SIGKILL');
  },
  async attrs(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'attrs', M1: [row('30011', 'OPEN')], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, '**صفوف الجامعة بخصائص (<tr class=…>): انقرأت والطالب وصله «فتحت»** (كانت «رد بلا صفوف»)');
    t.ok(!adminSays(st, /ما يستجيب|ما نفهمه/), 'وبلا إنذار عطل');
    c.kill('SIGKILL');
  },
  async maint(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'maint', M1: [row('30011', 'OPEN')], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 7000);
    t.ok(adminSays(st, /يرد بشكل ما نفهمه/) && adminSays(st, /Site Under Maintenance/),
      '**صفحة صيانة: الإنذار يقول «يرد بشكل ما نفهمه» وعنوانها** (كان «ما يستجيب»)');
    t.ok(!adminSays(st, /ما يستجيب/), 'لا «ما يستجيب»');
    c.kill('SIGKILL');
  },
  async down(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'down', M1: [row('30011', 'OPEN')], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 7000);
    t.ok(adminSays(st, /ما يستجيب/) && !adminSays(st, /ما نفهمه|يرفض/), 'انقطاع: «ما يستجيب» كما كان');
    c.kill('SIGKILL');
  },
  async block(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: '403', M1: [row('30011', 'OPEN')], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const first = st.pmu.hits.length;
    t.eq(first, 1, '403: طلب واحد ووقفنا — ما كمّلنا الطالبات ولا الطلب الشامل على باب يرفضنا');
    t.ok(adminSays(st, /يرفض طلباتنا \(403\)/), 'والإدارة يوصلها «موقع الجامعة يرفض طلباتنا (403)»');
    await cycleOf(c, 1500); await cycleOf(c, 1500);
    const s = await c.search('M1'), s2 = await c.search('F1');
    t.eq(st.pmu.hits.length, first,
      '**بعد الرفض: لا الدورة ولا البحث يطرقون موقعهم** (كان كل دورة وكل بحث طلب جديد)');
    t.ok(s.status === 503 && s2.status === 503 && Number(s.headers['retry-after']) >= 60,
      'والبحث بلا نسخة: ٥٠٣ بمهلة (Retry-After)');
    t.ok(!adminSays(st, /البحث ما يشتغل/), 'وبلا إنذار «البحث ما يشتغل» فوق إنذار الرفض');
    t.ok(/يرفض طلباتنا \(403\)/.test(await c.warnings()), 'واللوحة تقول «موقع الجامعة يرفض طلباتنا (403)»');
    c.kill('SIGKILL');
  },
  async slow(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: '429', retryAfter: 4, M1: [row('30011', 'OPEN')], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 1500);
    t.ok(adminSays(st, /يرفض طلباتنا \(429\)/) && adminSays(st, /المدة اللي طلبوها/),
      '429 مع Retry-After: الإدارة تعرف إننا ننتظر المدة اللي طلبوها');
    const n = st.pmu.hits.length;
    await cycleOf(c, 1000);
    t.eq(st.pmu.hits.length, n, '**داخل المدة: ولا طلب** (كان نطرق فوراً)');
    st.pmu.mode = 'ok';
    await wait(2500);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, 'بعد المدة: رجعنا نسحب، والطالب وصله «فتحت»');
    t.ok(adminSays(st, /رجع طبيعي: موقع الجامعة يرفض طلباتنا/), 'والإدارة يوصلها «رجع طبيعي»');
    c.kill('SIGKILL');
  },
  async short(t) {
    const DB = base(); user(DB, 1); user(DB, 2);
    courseMon(DB, 1, null);                 /* أول دورة تسجّل حالة الشعب بلا إشعار */
    watch(DB, 2, '30003', 'CLOSED');
    const M1 = [], F = [];
    for (let i = 1; i <= 20; i++) M1.push(row(String(30000 + i), 'CLOSED', String(100 + i)));
    for (let i = 1; i <= 20; i++) F.push(frow(String(40000 + i), 'CLOSED', String(200 + i)));
    const st = await makeOutside({ DB, pmu: { M1, F1: F } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    /* الجامعة قصّت جدول الطلاب: ٥ من ٢٠ — وفيها الشعبة اللي فتحت */
    st.pmu.M1 = M1.slice(0, 5).map(r => r[0] === '30003' ? row('30003', 'OPEN', '103') : r);
    await cycleOf(c);
    t.eq(msgsTo(st, 902).length, 1, 'جدول ناقص: الشعبة بعينها (موجودة فيه) وصل صاحبها «فتحت»');
    t.ok(adminSays(st, /جدول الجامعة وصل ناقص/), 'والإدارة يوصلها «جدول الجامعة وصل ناقص»');
    t.ok(/وصل ناقص/.test(await c.warnings()), 'واللوحة كذلك');
    st.pmu.M1 = M1.map(r => r[0] === '30003' ? row('30003', 'OPEN', '103') : r);
    await cycleOf(c);
    const m = msgsTo(st, 901);
    t.ok(!m.some(x => /نزلت شعبة جديدة/.test(x.text)),
      '**رجع كامل: ولا «نزلت شعبة جديدة» كاذبة** (كانت الـ١٥ الغايبة ترجع «جديدة»)');
    t.eq(m.length, 1, 'ومراقب المادة كاملة وصله «فتحت» عن الشعبة اللي فتحت فعلاً، مرة وحدة');
    c.kill('SIGKILL');
  },
  async accept(t) {
    const DB = base(); user(DB, 1); courseMon(DB, 1, null);
    const M1 = [], F = [];
    for (let i = 1; i <= 20; i++) M1.push(row(String(30000 + i), 'CLOSED', String(100 + i)));
    for (let i = 1; i <= 20; i++) F.push(frow(String(40000 + i), 'CLOSED', String(200 + i)));
    const st = await makeOutside({ DB, pmu: { M1, F1: F } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    st.pmu.M1 = M1.slice(0, 10);            /* الجامعة شالت نص شعب الطلاب فعلاً */
    for (let i = 0; i < 6; i++) await cycleOf(c, 4500);
    st.pmu.M1 = M1.slice(0, 10).concat([row('30099', 'OPEN', '199')]);
    await cycleOf(c);
    t.ok(msgsTo(st, 901).some(x => /نزلت شعبة جديدة ومفتوحة/.test(x.text)),
      'نزول حقيقي ثبت ست سحبات: اعتمدناه، ومراقبة المادة كاملة رجعت — شعبة جديدة وصلت');
    c.kill('SIGKILL');
  },
  async search(t) {
    const DB = base();
    const M1 = [];
    for (let i = 1; i <= 60; i++) M1.push(row(String(30000 + i), i % 2 ? 'OPEN' : 'CLOSED', String(100 + i)));
    const st = await makeOutside({ DB, pmu: { mode: 'shift', M1, F1: F1() } });
    const c = instance(st); await ready(c);
    const s = await c.search('M1');
    let courses = [];
    try { courses = JSON.parse(s.body).courses || [] } catch (e) {}
    t.ok(!courses.some(x => x.status === '12'),
      '**البحث بجدول أعمدته تغيّرت: ما رجّع حالات غلط للطالب** (كانت «12» مكان OPEN/CLOSED)');
    st.pmu.mode = 'ok';
    const s2 = await c.search('M1');
    let ok = []; try { ok = JSON.parse(s2.body).courses || [] } catch (e) {}
    t.eq([s2.status, ok.length, ok.filter(x => x.status === 'OPEN').length], [200, 60, 30], 'ورجع الشكل: البحث طبيعي');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`إشارات الجامعة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
