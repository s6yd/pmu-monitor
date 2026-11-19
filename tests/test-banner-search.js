/* البحث من بانر وقت عطل موقع الجدول — قرار محمد (١٩ نوفمبر ٢٠٢٦: «في مشكلة في موقع الكورس اوفرينق من الجامعة
   بس ليش ما راح جاب من البديل الي هو البانر» ثم «بحث البانر شغال»). كان بانر للمراقبة وحدها، فالبحث وقت العطل بلا
   نسخة = «فشل» للكل. اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك (الجدول · بانر · القاعدة · تيليغرام):
   ١) fallback — الجدول متعطّل وما عندنا نسخة ⇒ بانر **موسوماً** (X-Source)، والجنس من رقم الشعبة، وبحث بكلية = كل
                 الكليات (X-Banner-Colleges)، وسحبة وحدة لكل البحوث، وما يدخل كاش البحث ولا ينحفظ، والإدارة تعرف.
   ٢) breaker  — الدقيقة بعد العطل: البحث ما ينتظر موقع الجدول (٢٠ ثانية مع كل بحث)، وبعدها يجرّبه ولو رجع منه.
   ٣) stale    — خارج التسجيل وعندنا نسخة: النسخة (لا بانر).
   ٤) window   — وقت التسجيل: نسخة تحت ربع ساعة تكفي، وفوقها بانر (الحالات تتقلب).
   ٥) block    — الجدول رفضنا (403): ما نلتف عليه من بانر.
   ٦) bdown    — الاثنين متعطّلين: ٥٠٠ والإدارة تعرف إن بانر فشل، وما نطرق بانر ثانية قبل خمس دقائق.
   ٧) toggle   — مفتاح بانر مطفأ: ولا طلب.   ٨) oldterm — ترم قديم: ولا طلب لبانر.
   ٩) cycle    — الدورة راقبت من بانر: البحث يخدم من نسختها بلا سحبة ثانية.

   node tests/test-banner-search.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-banner-search';
const OFF = '2026-11-19T07:00:00Z';          /* خارج التسجيل */
const WIN = '2027-01-11T08:00:00Z';          /* تسجيل الترم الثاني (١١ الصبح بالرياض) */
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
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

/* ═══ قاعدة PostgREST-ية (نفس محاكي test-banner-backup) ═══ */
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

/* شعبة بانر بشكل searchResults في Banner 9 (نفس test-banner-backup) */
function bsec(crn, seq, seats) {
  const female = /^2/.test(seq);
  return { id: Number(crn), term: '202710', courseReferenceNumber: crn, partOfTerm: '1', courseNumber: '3311',
    subject: 'MEEN', subjectDescription: 'Mechanical Engineering', sequenceNumber: seq,
    campusDescription: female ? 'Female Campus' : 'Male Campus', scheduleTypeDescription: 'Lecture',
    courseTitle: 'Thermodynamics', maximumEnrollment: 30, enrollment: 30 - seats, seatsAvailable: seats,
    openSection: seats > 0, faculty: [{ displayName: 'Smith, John', primaryIndicator: true }],
    meetingsFaculty: [{ meetingTime: { beginTime: '0800', endTime: '0915', building: female ? 'F-CORE' : 'M-CORE',
      room: 'G034', monday: true, wednesday: true, tuesday: false, thursday: false, friday: false, saturday: false,
      sunday: false } }] };
}
const BAN = () => [bsec('30011', '101', 2), bsec('30012', '102', 0), bsec('40011', '201', 3)];
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'MW', '0800 - 0915',
  'Smith, John', 'M-CORE - G034', st];

function makeOutside(o) {
  const st = { DB: o.DB, pmu: Object.assign({ hits: [], mode: 'ok', M1: [], F1: [] }, o.pmu),
    ban: Object.assign({ hits: [], mode: 'ok', data: [], sessions: new Map() }, o.ban), TG: [], nextId: 1000 };
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
        if (P.mode === '403') { res.writeHead(403, { 'Content-Type': 'text/html' }); return res.end('Forbidden') }
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? P.F1 : g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
      }
      if (host === 'banreg.pmu.edu.sa') {
        const B = st.ban, u = new URL('http://x' + req.url);
        B.hits.push({ method: req.method, path: u.pathname });
        if (B.mode === 'down') return req.socket.destroy();
        const sidOf = () => (/JSESSIONID=([^;]+)/.exec(req.headers.cookie || '') || [])[1];
        if (u.pathname.endsWith('/term/termSelection')) {
          const id = 'J' + Math.random().toString(36).slice(2);
          B.sessions.set(id, null);
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': [`JSESSIONID=${id}; Path=/StudentRegistrationSsb; HttpOnly`] });
          return res.end('<html><title>Select a Term</title></html>');
        }
        if (u.pathname.endsWith('/term/search') && req.method === 'POST') {
          const id = sidOf(), term = new URLSearchParams(body).get('term');
          if (!id || !B.sessions.has(id)) return json(400, { regAllowed: false });
          B.sessions.set(id, term);
          return json(200, { fwdURL: '/StudentRegistrationSsb/ssb/classSearch/classSearch' });
        }
        if (u.pathname.endsWith('/searchResults/searchResults')) {
          const id = sidOf(), q = u.searchParams;
          if (!id || B.sessions.get(id) !== q.get('txt_term')) return json(200, { success: false, totalCount: 0, data: null });
          const off = Number(q.get('pageOffset') || 0), size = Number(q.get('pageMaxSize') || 10);
          return json(200, { success: true, totalCount: B.data.length, data: B.data.slice(off, off + size) });
        }
        res.writeHead(404); return res.end();
      }
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body) } catch (e) {}
        if (/sendMessage$/.test(req.url)) st.TG.push({ chat: String(b.chat_id), text: String(b.text || '') });
        return json(200, { ok: true, result: { message_id: 1 } });
      }
      if (host === 'fake.supabase.co') {
        const [p, raw = ''] = req.url.split('?');
        let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
        const t = p.replace('/rest/v1/', '');
        const list = st.DB[t] || (st.DB[t] = []);
        const rep = /return=representation/.test(req.headers.prefer || '');
        if (req.method === 'POST') {
          const b = JSON.parse(body || '{}');
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
        const lim = /(?:^|&)limit=(\d+)/.exec(qs);
        return json(200, filt(list, qs).slice(0, lim ? Number(lim[1]) : 1000));
      }
      json(200, { status: 1 });
    });
  });
  return new Promise(r => st.server.listen(0, '127.0.0.1', () => { st.port = st.server.address().port; r(st) }));
}

let PORTN = 20400 + (process.pid % 40) * 2;
function instance(st, at) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child', '--at=' + (at || OFF), String(st.port), String(port)], { silent: true });
  const call = (p, method, h, body) => new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET',
      headers: Object.assign({}, h || {}, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, j }) });
    });
    r.on('error', () => resolve({ status: 0, headers: {}, j: null })); if (data) r.write(data); r.end();
  });
  const A = { 'X-Admin-Token': ADMIN };
  c.health = () => call('/api/admin/health', 'GET', A).then(r => r.j || {});
  c.run = () => call('/api/run-check', 'GET', A).then(r => r.j);
  c.toggle = on => call('/api/admin/banner-toggle', 'POST', A, { on });
  c.search = (g, col, term) => call(`/api/courses?term=${term || '202710'}&college=${col || 'ALL'}&gender=${g || 'ALL'}`);
  c.warp = ms => c.send({ warp: ms });
  c.st = st;
  c.stop = () => new Promise(r => { c.on('exit', r); c.kill('SIGKILL') });
  return c;
}
const ready = async c => {
  for (let i = 0; i < 150; i++) {
    const h = await c.health();
    if (h.booted || (h.uptimeHours !== undefined && !('booted' in h))) return true;
    await wait(100);
  }
  return false;
};
const settle = async st => { let n = -1; for (const t0 = Date.now(); Date.now() - t0 < 8000 && st.reqs !== n;) { n = st.reqs; await wait(300) } };
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

const base = state => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: Object.assign({ monitorPaused: true }, state || {}) } }] });
const crns = s => ((s.j && s.j.courses) || []).map(x => x.crn).sort();
const sessions = st => st.ban.hits.filter(h => /termSelection$/.test(h.path)).length;
const adminSays = (st, re) => st.TG.filter(m => m.chat === '5555' && re.test(m.text)).length;

const SCEN = {
  async fallback(t) {
    const st = await makeOutside({ DB: base(), pmu: { mode: 'down' }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    let s = await c.search('ALL');
    t.eq([s.status, s.headers['x-source'], crns(s)], [200, 'banner', ['30011', '30012', '40011']],
      '**موقع الجدول متعطّل وما عندنا نسخة: البحث من بانر موسوماً** (كان ٥٠٠ «فشل» للكل)');
    const by = Object.fromEntries(((s.j && s.j.courses) || []).map(x => [x.crn, x]));
    t.ok(by['30011'] && by['30011'].status === 'OPEN' && by['30012'].status === 'CLOSE' &&
      by['30011'].courseCode === 'MEEN 3311' && by['30011'].courseTiming === '0800 - 0915',
      'بشكل صفوف الجدول (الحالة OPEN/CLOSE · الكود · الوقت)');
    s = await c.search('M1');
    t.eq([s.headers['x-source'], crns(s)], ['banner', ['30011', '30012']], 'الطلاب: شعب 1xx (الجنس من رقم الشعبة)');
    s = await c.search('F1');
    t.eq(crns(s), ['40011'], 'الطالبات: شعب 2xx');
    s = await c.search('ALL', 'EN');
    t.eq([s.status, s.headers['x-banner-colleges'], crns(s).length], [200, 'all', 3],
      'بحث بكلية: بانر ما يعطي الكلية — كل الكليات ومعها X-Banner-Colleges (الصفحة تقولها)');
    t.eq(sessions(st), 1, '**أربع بحوث = سحبة وحدة من بانر** (نسخة لكل ترم)');
    await settle(st);
    const h = await c.health();
    t.ok(!(h.cache || []).length, '**وبانر ما دخل كاش البحث** (اللي يغذّي المزامنة والنسخة المحفوظة والمساعد) — ' +
      (h.cache || []).map(x => x.key).join(','));
    t.ok(h.searchBanner >= 4, 'اللوحة تعدّ البحوث اللي خدمها بانر — ' + h.searchBanner);
    t.ok(!(st.DB.app_state || []).some(x => /^snapshot/.test(x.key)), 'ولا ينحفظ «آخر جدول» منه');
    t.ok(adminSays(st, /البحث يخدم من بانر/) === 1, 'والإدارة تعرف: «🛟 البحث يخدم من بانر»');
    await c.stop(); st.server.close();
  },

  async breaker(t) {
    const st = await makeOutside({ DB: base(), pmu: { mode: 'down', M1: [row('30011', 'OPEN')], F1: [] }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    await c.search('ALL');
    const n = st.pmu.hits.length;
    let s = await c.search('ALL');
    t.eq([s.headers['x-source'], st.pmu.hits.length - n], ['banner', 0],
      '**الدقيقة بعد العطل: البحث ما ينتظر موقع الجدول** (كان ٢٠ ثانية للرمز مع كل بحث) — على طول من الاحتياط');
    st.pmu.mode = 'ok';
    c.warp(61 * 1000); await wait(200);
    s = await c.search('ALL');
    t.eq([s.status, s.headers['x-source'] || '', crns(s)], [200, '', ['30011']], '**بعد الدقيقة يجرّبه — ورجع: من الموقع**');
    await c.stop(); st.server.close();
  },

  async stale(t) {
    const st = await makeOutside({ DB: base(), pmu: { M1: [row('30011', 'OPEN')], F1: [] }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    await c.search('ALL');
    st.pmu.mode = 'down';
    c.warp(7 * 3600 * 1000); await wait(200);             /* صلاحية الكاش خارج التسجيل ست ساعات */
    const s = await c.search('ALL');
    t.eq([s.status, s.headers['x-stale'], s.headers['x-source'] || '', crns(s), st.ban.hits.length],
      [200, '1', '', ['30011'], 0], '**خارج التسجيل وعندنا نسخة: النسخة — لا بانر**');
    await c.stop(); st.server.close();
  },

  async window(t) {
    const st = await makeOutside({ DB: base(), pmu: { M1: [row('30011', 'OPEN')], F1: [] }, ban: { data: BAN() } });
    const c = instance(st, WIN); await ready(c);
    await c.search('ALL');
    st.pmu.mode = 'down';
    c.warp(10 * 60 * 1000); await wait(200);
    let s = await c.search('ALL');
    t.eq([s.headers['x-stale'], s.headers['x-source'] || '', st.ban.hits.length], ['1', '', 0],
      'وقت التسجيل ونسختنا عمرها ١٠ دقائق: النسخة تكفي');
    c.warp(6 * 60 * 1000); await wait(200);
    s = await c.search('ALL');
    t.eq([s.status, s.headers['x-source'], crns(s)], [200, 'banner', ['30011', '30012', '40011']],
      '**وقت التسجيل ونسختنا فوق ربع ساعة: من بانر** (الحالات تتقلب — والنسخة تقول «مفتوحة» عن شعبة انقفلت)');
    await c.stop(); st.server.close();
  },

  async block(t) {
    const st = await makeOutside({ DB: base(), pmu: { mode: '403' }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    const s = await c.search('ALL');
    t.eq([s.status, st.ban.hits.length], [503, 0], '**الجدول رفضنا (403): ما نلتف عليه من بانر** — ولا طلب');
    await c.stop(); st.server.close();
  },

  async bdown(t) {
    const st = await makeOutside({ DB: base(), pmu: { mode: 'down' }, ban: { mode: 'down', data: BAN() } });
    const c = instance(st); await ready(c);
    let s = await c.search('ALL');
    t.eq(s.status, 500, 'الاثنين متعطّلين وما عندنا نسخة: ٥٠٠');
    await settle(st);
    t.ok(adminSays(st, /وبانر ما اشتغل/) === 1, 'والإدارة تعرف إن بانر فشل كذلك');
    const n = st.ban.hits.length;
    c.warp(2 * 60 * 1000); await wait(200);
    s = await c.search('ALL');
    t.eq([s.status, st.ban.hits.length - n], [500, 0], '**وما نطرق بانر ثانية قبل خمس دقائق**');
    st.ban.mode = 'ok';
    c.warp(4 * 60 * 1000); await wait(200);
    s = await c.search('ALL');
    t.eq([s.status, s.headers['x-source']], [200, 'banner'], 'وبعدها يجرّبه — ورجع');
    await c.stop(); st.server.close();
  },

  async toggle(t) {
    const st = await makeOutside({ DB: base({ bannerOn: false }), pmu: { mode: 'down' }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    const s = await c.search('ALL');
    t.eq([s.status, st.ban.hits.length], [500, 0], 'مفتاح بانر مطفأ من اللوحة: ولا طلب');
    await c.stop(); st.server.close();
  },

  async oldterm(t) {
    const st = await makeOutside({ DB: base(), pmu: { mode: 'down' }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    const s = await c.search('ALL', 'ALL', '202610');
    t.eq([s.status, st.ban.hits.length], [500, 0], 'ترم قديم (202610): ما نسحب من بانر لترمات ما تهم');
    await c.stop(); st.server.close();
  },

  async cycle(t) {
    const DB = base({ monitorPaused: false });
    DB.profiles.push({ id: 'u1', telegram_chat_id: '901', is_pro: true, subscription_expires_at: null,
      pushover_key: null, pushover_until: null });
    DB.monitored_courses.push({ id: 1, user_id: 'u1', scope: 'section', course_code: 'MEEN 3311', section: '102',
      crn: '30012', term: '202710', last_status: 'CLOSE', followup_done: true, followup_at: null, expires_at: null,
      sections_state: null, notified_at: null, created_at: new Date(Date.parse(OFF) - 864e5).toISOString() });
    const st = await makeOutside({ DB, pmu: { mode: 'down' }, ban: { data: BAN() } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 6000);
    const n = sessions(st);
    t.ok(n >= 1, 'الدورة راقبت من بانر (الجدول متعطّل)');
    const s = await c.search('ALL');
    t.eq([s.status, s.headers['x-source'], crns(s), sessions(st) - n], [200, 'banner', ['30011', '30012', '40011'], 0],
      '**البحث يخدم من نسخة الدورة — بلا سحبة ثانية من بانر**');
    await c.stop(); st.server.close();
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`البحث من بانر: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
