/* احتياط المراقبة من بانر — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك.
   بانر هنا يحاكي بحث Browse Classes العام (Banner 9 SSB): جلسة · ترم · نتائج JSON مقسّمة صفحات.
   ١) backup  — موقع الجدول ما يرد ⇒ نراقب من بانر، والطالب يوصله «فتحت»، والإدارة تعرف — وبيانات بانر
                ما تدخل كاش البحث.
   ٢) pages   — ١١٤٠ شعبة على ثلاث صفحات، والمحاضرة والمعمل بنفس CRN صفّان.
   ٣) settle  — رجوع الجدول بعد بانر: دورة تسجّل بلا «فتحت» (الجدول ممكن يتأخر)، وبعدها طبيعي.
      course  — المادة كاملة عند الذهاب لبانر: «فتحت» توصل، و«نزلت شعبة» ما تطلع من التبديل نفسه.
   ٤) block   — موقع الجدول رفضنا (403) ⇒ ما نلتف عليه من بانر: ولا طلب لبانر.
   ٥) bfail   — الاثنين متعطّلين ⇒ إنذار «احتياط بانر ما اشتغل».
   ٦) ping    — «جرّب بانر» من اللوحة: صفحة صغيرة وحدة، والصفوف بشكل الجدول، ومرة بالدقيقة.
   ٧) toggle  — مفتاح بانر من اللوحة مطفأ ⇒ ولا طلب.

   node tests/test-banner-backup.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-banner-backup';
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
const table = rows => '<table><tbody>' + rows.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
  '</tbody></table>';

/* شعبة بانر بشكل searchResults في Banner 9 (الحقول اللي يستعملها السيرفر وجيرانها) */
function bsec(crn, seq, seats, opt) {
  const o = Object.assign({ subject: 'MEEN', num: '3311', title: 'Thermodynamics', days: 'MW', begin: '0800', end: '0915',
    inst: 'Smith, John', max: 30, meets: null }, opt || {});
  const female = /^2/.test(seq);
  const mt = (days, begin, end, sched) => ({ category: '01', courseReferenceNumber: crn, faculty: [], term: '202710',
    meetingTime: { beginTime: begin, endTime: end, building: female ? 'F-CORE' : 'M-CORE', buildingDescription: 'Core',
      campus: female ? 'F' : 'M', campusDescription: female ? 'Female Campus' : 'Male Campus', category: '01',
      courseReferenceNumber: crn, creditHourSession: 3, endDate: '12/30/2026', startDate: '08/30/2026', hoursWeek: 2.5,
      meetingScheduleType: sched || 'LEC', meetingType: 'CLAS', meetingTypeDescription: 'Class', room: 'G034', term: '202710',
      monday: days.includes('M'), tuesday: days.includes('T'),
      wednesday: days.includes('W'), thursday: days.includes('R'), friday: days.includes('F'),
      saturday: days.includes('S'), sunday: days.includes('U') } });
  return { id: Number(crn), term: '202710', termDesc: 'Fall Semester 2026/2027 (View Only)', courseReferenceNumber: crn,
    partOfTerm: '1', courseNumber: o.num, subject: o.subject, subjectDescription: 'Mechanical Engineering',
    sequenceNumber: seq, campusDescription: female ? 'Female Campus' : 'Male Campus', scheduleTypeDescription: 'Lecture',
    courseTitle: o.title, creditHours: null, maximumEnrollment: o.max, enrollment: o.max - seats, seatsAvailable: seats,
    waitCapacity: 0, waitCount: 0, waitAvailable: 0, openSection: seats > 0, subjectCourse: o.subject + o.num,
    faculty: [{ bannerId: '9', courseReferenceNumber: crn, displayName: o.inst, primaryIndicator: true, term: '202710' }],
    meetingsFaculty: o.meets ? o.meets.map(([d, b, e, s]) => mt(d, b, e, s)) : [mt(o.days, o.begin, o.end)] };
}

function makeOutside(o) {
  const st = { DB: o.DB, pmu: Object.assign({ hits: [], mode: 'ok', M1: [], F1: [] }, o.pmu),
    ban: Object.assign({ hits: [], mode: 'ok', data: [], sessions: new Map() }, o.ban), TG: [], nextId: 1000 };
  st.server = http.createServer((req, res) => {
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j, h) => { if (res.destroyed) return; res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, h || {})); res.end(JSON.stringify(j)) };
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
        B.hits.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams) });
        if (B.mode === 'down') return req.socket.destroy();
        if (B.mode === '500') { res.writeHead(500, { 'Content-Type': 'text/html' }); return res.end('<title>Error</title>') }
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
          /* مثل بانر: بلا ترم مختار للجلسة ما فيه نتائج */
          if (!id || B.sessions.get(id) !== q.get('txt_term'))
            return json(200, { success: false, totalCount: 0, data: null });
          const off = Number(q.get('pageOffset') || 0), size = Number(q.get('pageMaxSize') || 10);
          return json(200, { success: true, totalCount: B.data.length, data: B.data.slice(off, off + size),
            pageOffset: off, pageMaxSize: size, sectionsFetchedCount: B.data.length });
        }
        res.writeHead(404); return res.end();
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

let PORTN = 48900 + (process.pid % 40);
function instance(st) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child', String(st.port), String(port)], { silent: true });
  const call = (p, method, h, body) => new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET',
      headers: Object.assign({}, h || {}, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, j, body: b }) });
    });
    r.on('error', () => resolve({ status: 0, j: null, body: '' })); if (data) r.write(data); r.end();
  });
  const A = { 'X-Admin-Token': ADMIN };
  c.check = () => call('/api/run-check', 'GET', A).then(r => r.status);
  c.health = () => call('/api/admin/health', 'GET', A).then(r => r.j || {});
  c.ping = () => call('/api/admin/banner-ping', 'POST', A, {});
  c.toggle = on => call('/api/admin/banner-toggle', 'POST', A, { on });
  c.search = g => call(`/api/courses?term=202710&college=ALL&gender=${g || 'M1'}`);
  return c;
}
const ready = async c => { for (let i = 0; i < 50; i++) { if (await c.check() === 200) return true; await wait(200) } return false };
const cycleOf = async (c, ms = 5000) => { await c.check(); await wait(ms) };

/* ═══ البيانات ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'MW', '0800 - 0915',
  'Smith, John', 'M-CORE - G034', st];
const base = state => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: Object.assign({ monitorPaused: true }, state || {}) } }] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', section: '101', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const adminSays = (st, re) => msgsTo(st, 5555).filter(m => re.test(m.text)).length;
const results = st => st.ban.hits.filter(h => /searchResults$/.test(h.path));

const SCEN = {
  async backup(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'down' },
      ban: { data: [bsec('30011', '101', 2), bsec('30012', '102', 0), bsec('40011', '201', 0)] } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 6000);
    const m = msgsTo(st, 901);
    t.eq(m.length, 1, '**موقع الجدول ما يرد: راقبنا من بانر والطالب وصله «فتحت»** (كانت المراقبة واقفة)');
    t.ok(m[0] && /30011/.test(m[0].text) && /MEEN 3311/.test(m[0].text), 'والرسالة فيها الشعبة بشكلها المعروف');
    t.ok(adminSays(st, /ما يستجيب/) === 1 && adminSays(st, /مستمرة من صفحة بحث بانر/) === 1,
      'والإدارة تعرف: «ما يستجيب» ومعها «المراقبة مستمرة من بانر»');
    const s = await c.search('M1');
    t.ok(s.status !== 200 || !(s.j && s.j.courses && s.j.courses.length),
      '**وبيانات بانر ما دخلت كاش البحث** (صياغتها ممكن تفرق — تنحفظ في جدول طالب فتطلع «تغيّر جدولك» كاذبة)');
    const h = await c.health();
    t.eq([h.monitorInfo && h.monitorInfo.source, (h.warnings || []).some(w => /بانر/.test(w.ar))], ['banner', true],
      'واللوحة: المصدر «بانر» وتحذير «المراقبة من بانر (احتياط)»');
    c.kill('SIGKILL');
  },
  async pages(t) {
    const data = [];
    for (let i = 0; i < 1140; i++) data.push(bsec(String(31000 + i), String(100 + (i % 90)), i === 1100 ? 3 : 0));
    /* محاضرة ومعمل بنفس CRN */
    data.push(bsec('39999', '105', 0, { meets: [['UT', '1000', '1115', 'LEC'], ['R', '1300', '1550', 'LAB']] }));
    const DB = base(); user(DB, 1); watch(DB, 1, '32100', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'down' }, ban: { data } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 9000);
    const r = results(st);
    t.eq(r.map(x => [x.q.pageOffset, x.q.pageMaxSize]), [['0', '500'], ['500', '500'], ['1000', '500']],
      '١١٤١ شعبة: ثلاث صفحات من ٥٠٠');
    t.eq(msgsTo(st, 901).length, 1, '**شعبة في الصفحة الثالثة فتحت: وصل صاحبها** (الصفحات كلها انقرأت)');
    const h = await c.health();
    const last = (h.monitorInfo && h.monitorInfo.banner && h.monitorInfo.banner.last) || {};
    t.eq([last.ok, last.sections, last.rows], [true, 1141, 1142], 'واللوحة: ١١٤١ شعبة · ١١٤٢ صف (المعمل صف ثانٍ بنفس CRN)');
    c.kill('SIGKILL');
  },
  async settle(t) {
    /* آخر دورة كانت من بانر، والجدول رجع — ومنه 30012 «مفتوحة» قديمة (بانر شافها مقفلة) */
    const DB = base({ monSource: 'banner' }); user(DB, 1); user(DB, 2);
    watch(DB, 1, '30012', 'CLOSED'); watch(DB, 2, '30013', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { M1: [row('30012', 'OPEN', '102'), row('30013', 'CLOSED', '103')],
      F1: [['40011', 'MEEN 3311', 'Thermodynamics', '201', 'MW', '0800 - 0915', 'Lee, Sara', 'F-CORE - 101', 'CLOSED']] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 0, '**رجوع الجدول بعد بانر: أول دورة تسجّل بلا «فتحت»** (مفتوحة قديمة منه ما تطلع كاذبة)');
    t.eq(DB.monitored_courses[0].last_status, 'OPEN', 'والحالة انكتبت');
    st.pmu.M1 = [row('30012', 'OPEN', '102'), row('30013', 'OPEN', '103')];
    await cycleOf(c);
    t.eq([msgsTo(st, 901).length, msgsTo(st, 902).length], [0, 1], 'وبعدها طبيعي: اللي فتحت فعلاً وصل صاحبها');
    c.kill('SIGKILL');
  },
  async course(t) {
    const DB = base(); user(DB, 1);
    DB.monitored_courses.push({ id: MID++, user_id: 'u1', scope: 'course', course_code: 'MEEN 3311', crn: null,
      term: '202710', last_status: null, followup_done: true, followup_at: null, expires_at: null,
      sections_state: { 30011: 'CLOSED', 30012: 'CLOSED', 40011: 'CLOSED' }, notified_at: null,
      created_at: new Date(Date.now() - 864e5).toISOString() });
    /* بانر: 30012 فيها مقاعد، و30019 شعبة ملغاة يعرضها بانر والجدول يخفيها */
    const st = await makeOutside({ DB, pmu: { mode: 'down' }, ban: { data: [bsec('30011', '101', 0),
      bsec('30012', '102', 4), bsec('30019', '109', 0), bsec('40011', '201', 0)] } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 6000);
    let m = msgsTo(st, 901);
    t.ok(m.length === 1 && /30012/.test(m[0].text) && /فتحت شعبة في مادة تراقبها/.test(m[0].text),
      'المادة كاملة من بانر: «فتحت» للي فيها مقاعد');
    t.ok(!m.some(x => /نزلت شعبة/.test(x.text)), '**ولا «نزلت شعبة جديدة» من التبديل نفسه** (ملغاة يعرضها بانر)');
    st.ban.data.push(bsec('30020', '110', 0));
    await cycleOf(c, 6000);
    m = msgsTo(st, 901);
    t.ok(m.some(x => /نزلت شعبة جديدة/.test(x.text) && /30020/.test(x.text)), 'وبعدها الجديد فعلاً يوصل');
    c.kill('SIGKILL');
  },
  async block(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: '403' }, ban: { data: [bsec('30011', '101', 2)] } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 3000);
    t.eq(st.ban.hits.length, 0, '**موقع الجدول رفضنا (403): ما نلتف عليه من بانر — ولا طلب**');
    t.eq(msgsTo(st, 901).length, 0, 'وما وصل الطالب شي من بانر');
    c.kill('SIGKILL');
  },
  async bfail(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'down' }, ban: { mode: '500' } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 6000);
    t.ok(adminSays(st, /احتياط بانر ما اشتغل/) === 1, '**الاثنين متعطّلين: الإدارة يوصلها «احتياط بانر ما اشتغل»**');
    t.ok(adminSays(st, /المراقبة والبحث بيتأثرون/) === 1, 'و«ما يستجيب» بنصّها الأصلي (المراقبة واقفة فعلاً)');
    c.kill('SIGKILL');
  },
  async ping(t) {
    const st = await makeOutside({ DB: base(), ban: { data: [bsec('11298', '203', 1, { subject: 'ACCT', num: '2311',
      title: 'Fundamentals of Accounting', inst: 'Abdul Qader, Sireen Ahmed' })].concat(
      Array.from({ length: 30 }, (_, i) => bsec(String(12000 + i), '101', 0))) } });
    const c = instance(st); await ready(c);
    const r = await c.ping();
    t.eq([r.status, r.j && r.j.ok, r.j && r.j.total], [200, true, 31], '«جرّب بانر» من اللوحة: شغّال، وعدد الشعب من بانر');
    t.eq(r.j && r.j.sample, { crn: '11298', courseCode: 'ACCT 2311', section: '203', status: 'OPEN',
      courseDate: 'MW', courseTiming: '0800 - 0915' }, '**والصف بشكل جدول الجامعة** (الكود · الأيام · الوقت · الحالة من المقاعد)');
    t.eq(results(st).map(x => x.q.pageMaxSize), ['10'], 'صفحة صغيرة وحدة (عشر شعب) — تجربة لا سحبة');
    const r2 = await c.ping();
    t.eq(r2.status, 429, 'ومرة بالدقيقة على الأكثر');
    c.kill('SIGKILL');
  },
  async toggle(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, pmu: { mode: 'down' }, ban: { data: [bsec('30011', '101', 2)] } });
    const c = instance(st); await ready(c);
    const r = await c.toggle(false);
    t.eq(r.j, { on: false }, 'مفتاح بانر من اللوحة');
    const n = st.ban.hits.length;
    await cycleOf(c, 6000);
    t.eq([st.ban.hits.length - n, msgsTo(st, 901).length], [0, 0], '**مطفأ: ولا طلب لبانر**');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`احتياط بانر: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
