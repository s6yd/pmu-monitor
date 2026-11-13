/* «راقب كل الشعب» لشعب جنس صاحبها — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك.
   الصف ما يحفظ هل صاحبه طالب أو طالبة، فكان يوصله «فتحت شعبة» عن شعب الجنس الثاني (ما يقدر يسجّل فيها)،
   وشعبة جنسه ممكن تنخفي ورا سقف الثلاث. نعرف جنسه من أرقام شعبه (1xx طلاب · 2xx طالبات):
   ١) male · female — جنسه معروف من جدوله: شعبة الجنس الثاني ما توصله، وشعبته توصل وتقول لمن نراقب.
   ٢) cap           — أربع شعب طلاب وشعبة طالبات فتحت معاً لطالبة: يوصلها إشعار شعبتها (كانت تنخفي في «+ شعبة ثانية»).
   ٣) unknown · oneRow · mixed — ما نعرف (بلا جدول · شعبة وحدة · مخلّط): للجنسين كما كان، والرسالة تسمّي جنس الشعبة.
   ٤) fromMonitors  — بلا جدول لكن مراقباته لشعب طلاب: طالب.
   ٥) schedFail     — قراءة الجدول فشلت: ما نفلتر (ما يضيع إشعار)، والدورة الجاية تعرفه.
   ٦) section       — مراقبة شعبة بعينها ما تتفلتر (هو اللي اختارها).

   node tests/test-course-gender.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-course-gender';
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
    if (op === 'neq') return a != null && String(a) !== v;          /* NULL ما يطابق neq — مثل SQL */
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
  const st = { DB: o.DB, pmu: o.pmu, TG: [], fault: o.fault || (() => null), reads: 0, reqs: 0, nextId: 1000 };
  st.server = http.createServer((req, res) => {
    st.reqs++;
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? st.pmu.F1 : g === 'M1' ? st.pmu.M1 : st.pmu.M1.concat(st.pmu.F1)));
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
        let b = null; try { b = body ? JSON.parse(body) : null } catch (e) {}
        const q = { t, method: req.method, qs, body: b };
        /* قراءة جدول الطالب لمعرفة جنسه (بلا ترم: كل جداوله) */
        if (t === 'user_schedule' && req.method === 'GET' && /user_id=in\./.test(qs) && !/term=/.test(qs)) st.reads++;
        if (st.fault(q) === 'err') return json(503, { code: 'PGRST000', message: 'Could not connect to the database' });
        if (req.method === 'POST') {
          if (t === 'app_state') (Array.isArray(b) ? b : [b]).forEach(x => {
            const i = list.findIndex(y => y.key === x.key);
            if (i >= 0) list[i] = Object.assign({}, list[i], x); else list.push(x);
          });
          else (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: st.nextId++ }, x)));
          return json(201, []);
        }
        if (req.method === 'PATCH') {
          const hit = filt(list, qs);
          hit.forEach(x => Object.assign(x, b || {}));
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

let PORTN = 23400 + (process.pid % 90);
function instance(st) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child', String(st.port), String(port)], { silent: true });
  const get = p => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'X-Admin-Token': ADMIN } }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve(j) });
    });
    r.on('error', () => resolve(null)); r.end();
  });
  c.health = () => get('/api/admin/health').then(j => j || {});
  c.run = () => get('/api/run-check');
  c.st = st;
  return c;
}
const ready = async c => { for (let i = 0; i < 150; i++) { if ((await c.health()).booted) return true; await wait(100) } return false };
const settle = async st => { let n = -1; for (const t0 = Date.now(); Date.now() - t0 < 8000 && st.reqs !== n;) { n = st.reqs; await wait(300) } };
const cycleOf = async c => {
  const t0 = Date.now();
  for (;;) {
    const r = await c.run();
    if (!r || r.gen === undefined) { await wait(5000); return }
    while (Date.now() - t0 < 90000 && (((await c.health()).lastCycle || {}).gen || 0) < r.gen) await wait(100);
    if (r.ran || Date.now() - t0 >= 90000) break;
  }
  await settle(c.st);
};

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف: شعب الطلاب 1xx (قاعات M-) وشعب الطالبات 2xx (قاعات F-) ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
const base = () => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] });
let MID = 1, SID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
/* مواد في جدول الطالب (مادة ثانية غير المراقَبة) — أرقام شعبها تدل على جنسه */
const sched = (DB, n, ...secs) => secs.forEach((sec, i) => DB.user_schedule.push({ id: SID++, user_id: 'u' + n,
  crn: String(70000 + SID), course_code: 'MATH 1422', course_title: 'Calculus II', section: sec, course_date: 'MW',
  course_timing: '1100 - 1215', instructor: 'Khan, Omar', room: (/^2/.test(sec) ? 'F' : 'M') + '-CORE - 20' + i,
  term: '202710', slot: 1 }));
const watch = (DB, n, crn, last, sec) => { const m = { id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'PHYS 1422', section: sec || '101', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  DB.monitored_courses.push(m); return m };
const courseMon = (DB, n, state) => { const m = { id: MID++, user_id: 'u' + n, scope: 'course',
  course_code: 'MEEN 3311', crn: null, term: '202710', last_status: null, followup_done: true, followup_at: null,
  expires_at: null, sections_state: state, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  DB.monitored_courses.push(m); return m };
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const about = (st, crn, chat) => msgsTo(st, chat || 901).filter(m => m.text.includes(crn));
/* كل الشعب مقفلة في حالة المادة — ثم نفتح اللي نبي */
const ALL_CLOSED = { 30011: 'CLOSE', 40011: 'CLOSE' };

const SCEN = {
  async male(t) {
    const DB = base(); user(DB, 1); sched(DB, 1, '101', '103'); const m = courseMon(DB, 1, Object.assign({}, ALL_CLOSED));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 0,
      '**طالب (شعب جدوله 1xx) يراقب المادة كاملة وفتحت شعبة طالبات: ما وصله شي** — كان يوصله «فتحت شعبة» عن شعبة ما يقدر يسجّل فيها');
    t.eq(m.sections_state['40011'], 'OPEN', 'وحالة المادة انكتبت للجنسين كما هي');
    st.pmu.M1 = [row('30011', 'OPEN')];
    await cycleOf(c);
    const mine = about(st, '30011');
    t.ok(mine.length === 1 && /فتحت شعبة في مادة تراقبها/.test(mine[0].text), 'وشعبة الطلاب لما فتحت: وصله إشعارها');
    t.ok(mine[0] && /شعبة 101 · طلاب/.test(mine[0].text) && /كاملة \(شعب الطلاب\)/.test(mine[0].text),
      'والرسالة تقول جنس الشعبة ولمن نراقب — ' + (mine[0] && mine[0].text.replace(/\n/g, ' | ')));
    t.ok(mine[0] && !/للطلاب والطالبات/.test(mine[0].text), 'وبلا سطر «نراقبها للجنسين» (جنسه معروف)');
    c.kill('SIGKILL');
  },

  async female(t) {
    const DB = base(); user(DB, 1); sched(DB, 1, '201', '204', '202'); courseMon(DB, 1, Object.assign({}, ALL_CLOSED));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 0, '**طالبة تراقب المادة كاملة وفتحت شعبة طلاب: ما وصلها شي**');
    st.pmu.F1 = [frow('40011', 'OPEN')];
    await cycleOf(c);
    const mine = about(st, '40011');
    t.ok(mine.length === 1 && /شعبة 201 · طالبات/.test(mine[0].text) && /كاملة \(شعب الطالبات\)/.test(mine[0].text),
      'وشعبة الطالبات لما فتحت: وصلها، والرسالة تقول «شعب الطالبات» — ' + (mine[0] && mine[0].text.replace(/\n/g, ' | ')));
    c.kill('SIGKILL');
  },

  async cap(t) {
    /* أربع شعب طلاب وشعبة طالبات فتحت في نفس الدورة — وصاحبة المراقبة طالبة */
    const DB = base(); user(DB, 1); sched(DB, 1, '201', '203');
    courseMon(DB, 1, { 30011: 'CLOSE', 30012: 'CLOSE', 30013: 'CLOSE', 30014: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: {
      M1: [row('30011', 'OPEN', '101'), row('30012', 'OPEN', '102'), row('30013', 'OPEN', '103'), row('30014', 'OPEN', '104')],
      F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const all = msgsTo(st, 901);
    t.eq(about(st, '40011').length, 1,
      '**خمس شعب فتحت معاً وشعبتها الخامسة: وصلها إشعار شعبتها** — كانت تنخفي ورا سقف الثلاث في «+ شعبة ثانية»');
    t.eq(all.length, 1, 'وإشعار واحد — بلا شعب الطلاب الأربع');
    t.ok(all[0] && !/شعبة ثانية تغيّرت/.test(all[0].text), 'وبلا «+ شعبة ثانية» (الباقي مو لها)');
    c.kill('SIGKILL');
  },

  async unknown(t) {
    const DB = base(); user(DB, 1); courseMon(DB, 1, Object.assign({}, ALL_CLOSED));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const m1 = about(st, '30011'), f1 = about(st, '40011');
    t.eq([m1.length, f1.length], [1, 1], 'ما نعرف جنسه (بلا جدول ولا مراقبات شعب): الشعبتان توصلان — كما كان');
    t.ok(m1[0] && /شعبة 101 · طلاب/.test(m1[0].text) && f1[0] && /شعبة 201 · طالبات/.test(f1[0].text),
      '**وكل رسالة تسمّي جنس شعبتها** (كانت بلا أي تمييز)');
    t.ok(f1[0] && /للطلاب والطالبات/.test(f1[0].text) && /جدولي/.test(f1[0].text) && !/\(شعب ال/.test(f1[0].text),
      'ومعها كيف نكتفي بشعبه: يضيف مواده في «جدولي» — ' + (f1[0] && f1[0].text.replace(/\n/g, ' | ')));
    c.kill('SIGKILL');
  },

  async oneRow(t) {
    const DB = base(); user(DB, 1); sched(DB, 1, '101'); courseMon(DB, 1, Object.assign({}, ALL_CLOSED));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(about(st, '40011').length, 1, '**شعبة وحدة في جدوله ما تكفي دليلاً: ما نفلتر** (فلترة غلط = إشعار يضيع)');
    c.kill('SIGKILL');
  },

  async mixed(t) {
    const DB = base(); user(DB, 1); sched(DB, 1, '101', '102', '201'); courseMon(DB, 1, Object.assign({}, ALL_CLOSED));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(about(st, '40011').length, 1, '**جدوله مخلّط (1xx و2xx): ما نعرف — ما نفلتر**');
    c.kill('SIGKILL');
  },

  async fromMonitors(t) {
    /* بلا جدول، لكن يراقب شعبتين بعينهما من شعب الطلاب */
    const DB = base(); user(DB, 1); watch(DB, 1, '50011', 'CLOSE', '101'); watch(DB, 1, '50012', 'CLOSE', '105');
    courseMon(DB, 1, Object.assign({}, ALL_CLOSED));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 0, '**بلا جدول ومراقباته لشعب طلاب: طالب — شعبة الطالبات ما توصله**');
    c.kill('SIGKILL');
  },

  async schedFail(t) {
    const DB = base(); user(DB, 1); sched(DB, 1, '101', '103');
    courseMon(DB, 1, { 30011: 'CLOSE', 40011: 'CLOSE', 40012: 'CLOSE' });
    let left = 1;
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'OPEN'), frow('40012', 'CLOSE', '202')] },
      fault: q => (q.t === 'user_schedule' && q.method === 'GET' && !/term=/.test(q.qs) && left-- > 0) ? 'err' : null });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(about(st, '40011').length, 1, '**قراءة جدوله فشلت: ما فلترنا — الإشعار وصل** (ما نضيّع إشعاراً على عطل)');
    st.pmu.F1 = [frow('40011', 'OPEN'), frow('40012', 'OPEN', '202')];
    await cycleOf(c);
    t.eq(about(st, '40012').length, 0, '**والدورة الجاية قرأته وعرفت إنه طالب** (الفشل ما انحفظ «ما نعرف»)');
    c.kill('SIGKILL');
  },

  async cached(t) {
    /* جنسه انعرف: ما نقرأ جدوله مع كل دورة */
    const DB = base(); user(DB, 1); sched(DB, 1, '101', '103');
    courseMon(DB, 1, { 30011: 'CLOSE', 30012: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN'), row('30012', 'CLOSE', '102')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    st.pmu.M1 = [row('30011', 'OPEN'), row('30012', 'OPEN', '102')];
    await cycleOf(c);
    t.eq([about(st, '30011').length, about(st, '30012').length], [1, 1], 'دورتان وفي كل وحدة فتحت شعبة طلاب: إشعاران');
    t.eq(st.reads, 1, 'وجدوله انقرأ مرة وحدة (جنسه محفوظ في الذاكرة)');
    c.kill('SIGKILL');
  },

  async section(t) {
    /* مراقبة شعبة بعينها ما تتفلتر: هو اللي اختارها — حتى لو شعب جدوله من الجنس الثاني */
    const DB = base(); user(DB, 1); sched(DB, 1, '101', '103');
    const m = watch(DB, 1, '40011', 'CLOSE', '201'); m.course_code = 'MEEN 3311';
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const got = about(st, '40011');
    t.ok(got.length === 1 && /الشعبة اللي تبيها فتحت/.test(got[0].text), 'مراقبة شعبة بعينها: إشعارها يوصل مهما كان جنسها');
    t.ok(got[0] && !/· طالبات|شعب ال/.test(got[0].text), 'وبلا وسم الجنس (رسالة الشعبة كما كانت)');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`كل الشعب بالجنس: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
