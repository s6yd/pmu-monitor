/* سحبة أخف وأسرع من الجامعة — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك.
   ١) session — رمز التحقق والكوكي محفوظان: الدورة ما تفتح صفحتهم الرئيسية كل مرة، والبحث بعد
                الدورة من كاشها (الدورة كانت تعبّي ALL|ALL وحده، والبحث بالجنس يسحب من جديد).
   ٢) expired — الرمز المحفوظ انتهى عندهم ⇒ رمز جديد ومرة ثانية، والطالب يوصله إشعاره.
   ٣) gzip    — نطلب الرد مضغوطاً ونفكّه — والطالب يوصله إشعاره.
   ٤) hot     — أيام التسجيل وأول يوم إضافة: الفاصل دقيقتان (من التقويم)، وباقي النافذة خمس.

   node tests/test-pmu-speed.js [server.js] */
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-pmu-speed';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
  if (at) {                                   /* ساعة السيرفر على يوم بعينه */
    const shift = Date.parse(at.slice(5)) - Date.now();
    const now = Date.now.bind(Date);
    Date.now = () => now() + shift;
  }
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
const table = rows => '<table><tbody>' + rows.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
  '</tbody></table>';

function makeOutside(o) {
  const st = { DB: o.DB, pmu: Object.assign({ hits: [], token: 'tok1', gzip: false }, o.pmu), TG: [], nextId: 1000 };
  st.server = http.createServer((req, res) => {
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        const P = st.pmu;
        const q = new URLSearchParams(body);
        const hit = { method: req.method, url: req.url, ae: String(req.headers['accept-encoding'] || ''),
                      token: q.get('__RequestVerificationToken'), g: q.get('GenderList') };
        P.hits.push(hit);
        /* يرد مضغوطاً لو انطلب منه — مثل أي IIS/nginx */
        const send = (code, type, text, extra) => {
          const h = Object.assign({ 'Content-Type': type }, extra || {});
          if (P.gzip && /\bgzip\b/.test(hit.ae)) {
            h['Content-Encoding'] = 'gzip';
            res.writeHead(code, h); return res.end(zlib.gzipSync(Buffer.from(text, 'utf8')));
          }
          res.writeHead(code, h); res.end(text);
        };
        if (req.url === '/')
          return send(200, 'text/html', `<input name="__RequestVerificationToken" type="hidden" value="${P.token}">`,
            { 'Set-Cookie': [`s=${P.token}; path=/`] });
        /* رمز ما يطابق آخر رمز أصدروه = ASP.NET يرفضه بـ٥٠٠ */
        if (hit.token !== P.token || !String(req.headers.cookie || '').includes('s=' + P.token))
          return send(500, 'text/html', '<html><head><title>Runtime Error</title></head><body>Server Error</body></html>');
        return send(200, 'text/html', table(hit.g === 'F1' ? P.F1 : hit.g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
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

let PORTN = 49800 + (process.pid % 40);
function instance(st, extra) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child'].concat(extra || [], [String(st.port), String(port)]), { silent: true });
  const get = (p, h) => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: h || {} }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', () => resolve({ status: 0, headers: {}, body: '' })); r.end();
  });
  c.check = () => get('/api/run-check', { 'X-Admin-Token': ADMIN }).then(r => r.status);
  c.search = (g = 'M1') => get(`/api/courses?term=202710&college=ALL&gender=${g}`);
  c.status = () => get('/api/monitor-status').then(r => { try { return JSON.parse(r.body) } catch (e) { return {} } });
  return c;
}
const ready = async c => { for (let i = 0; i < 50; i++) { if (await c.check() === 200) return true; await wait(200) } return false };
const cycleOf = async (c, ms = 5000) => { await c.check(); await wait(ms) };

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
const watch = (DB, n, crn, last) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const gets = st => st.pmu.hits.filter(h => h.method === 'GET').length;
const posts = st => st.pmu.hits.filter(h => h.method === 'POST').length;

const SCEN = {
  async session(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED'), row('30012', 'OPEN', '102')],
      F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const p1 = posts(st);
    const sm = await c.search('M1'), sf = await c.search('F1');
    t.eq([sm.status, sf.status, posts(st) - p1], [200, 200, 0],
      '**بحث الطالب بعد الدورة (طلاب · طالبات): من كاشها — ولا طلب للجامعة** (كان كل بحث سحبة جديدة)');
    let n = 0; try { n = JSON.parse(sm.body).courses.length } catch (e) {}
    t.eq(n, 2, 'والنتيجة جدول الطلاب كاملاً');
    st.pmu.M1 = [row('30011', 'OPEN'), row('30012', 'OPEN', '102')];
    await cycleOf(c); await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, 'الشعبة فتحت والطالب وصله «فتحت»');
    t.eq(gets(st), 1, '**ثلاث دورات وبحثان: صفحة الرمز مرة وحدة** (كانت قبل كل سحبة — ٨ مرات)');
    c.kill('SIGKILL');
  },
  async expired(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSED')], F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    st.pmu.token = 'tok2';                       /* انتهت جلستنا عندهم */
    st.pmu.M1 = [row('30011', 'OPEN')];
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, '**الرمز المحفوظ انتهى عندهم: أخذنا رمزاً جديداً والطالب وصله «فتحت»**');
    t.eq(gets(st), 2, 'صفحة الرمز مرة ثانية بس (لما انرفض المحفوظ)');
    t.ok(!msgsTo(st, 5555).some(m => /ما يستجيب|ما نفهمه/.test(m.text)), 'وبلا إنذار عطل');
    c.kill('SIGKILL');
  },
  async gzip(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const M1 = [row('30011', 'OPEN')];
    for (let i = 2; i <= 400; i++) M1.push(row(String(31000 + i), i % 3 ? 'CLOSED' : 'OPEN', String(100 + (i % 90))));
    const st = await makeOutside({ DB, pmu: { gzip: true, M1, F1: [frow('40011', 'CLOSED')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const pp = st.pmu.hits.filter(h => h.method === 'POST');
    t.ok(pp.length >= 2 && pp.every(h => /\bgzip\b/.test(h.ae)), '**نطلب جدول الجامعة مضغوطاً** (عُشر الحجم)');
    t.eq(msgsTo(st, 901).length, 1, 'وفكّيناه صح: الطالب وصله «فتحت»');
    const s = await c.search('M1');
    let n = 0; try { n = JSON.parse(s.body).courses.length } catch (e) {}
    t.eq(n, 400, 'والبحث يقرأ الجدول كاملاً (٤٠٠ شعبة)');
    c.kill('SIGKILL');
  },
  async hot(t) {
    /* ١١ يناير ٢٠٢٧ ١٠ الصبح بالرياض: فترة تسجيل الترم الثاني (١٠–١٤ يناير) */
    const at = iso => ['--at=' + iso];
    const days = [['2027-01-11T07:00:00Z', 2, 'يوم تسجيل'], ['2027-01-17T07:00:00Z', 2, 'أول يوم إضافة'],
                  ['2027-01-19T07:00:00Z', 5, 'باقي النافذة']];
    for (const [iso, want, what] of days) {
      const st = await makeOutside({ DB: base(false), pmu: { M1: [], F1: [] } });
      const c = instance(st, at(iso));
      let s = {};
      for (let i = 0; i < 50 && !s.intervalMin; i++) { s = await c.status(); if (!s.intervalMin) await wait(200) }
      t.eq(s.intervalMin, want, `${what} (${iso.slice(0, 10)}): الفاصل ${want} دقائق`);
      c.kill('SIGKILL');
    }
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`سرعة السحب: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
