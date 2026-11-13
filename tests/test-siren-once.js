/* صفارة وحدة للحدث الواحد — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك (الجامعة · القاعدة · تيليغرام · Pushover).
   اللي يراقب المادة كاملة والشعبة نفسها توصله رسالتان على تيليغرام (مقصود)، وكانت معهما صفارتان بنفس اللحظة
   لنفس الشعبة — كل وحدة تعيد نفسها لين يأكّدها لحالها.
   ١) both        — مراقبة المادة + مراقبة الشعبة نفسها: رسالتان على تيليغرام وصفارة وحدة.
   ٢) admin       — نفسها لصاحب الموقع (بلا مفتاح طالب).
   ٣) reopen      — قفلت ثم فتحت في الدورات اللي بعدها مباشرة: صفارة جديدة (بالدورة لا بالوقت — ما نكتم فرصة حقيقية).
   ٤) twoStudents — طالبان على نفس الشعبة: صفارة لكل واحد.
   ٥) failedFirst — الصفارة الأولى ما وصلت: اللي بعدها تصفّر.

   node tests/test-siren-once.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-siren-once';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  let shift = 0;
  const now = Date.now.bind(Date);
  Date.now = () => now() + shift;
  process.on('message', m => { if (m && m.warp) shift += m.warp });
  const https = require('https');
  https.request = (opts, cb) => http.request({ hostname: '127.0.0.1', port: outPort, path: opts.path,
    method: opts.method, headers: Object.assign({}, opts.headers, { 'x-host': opts.hostname }) }, cb);
  Object.assign(process.env, {
    PORT: String(port), ADMIN_TOKEN: ADMIN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false',
    PUSHOVER_TOKEN: 'app-token-for-tests', PUSHOVER_USER: 'owner-key-for-tests'
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
  const st = { DB: o.DB, pmu: o.pmu, TG: [], PO: [], poFail: o.poFail || 0, reqs: 0, nextId: 1000 };
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
      /* Pushover: نموذج urlencoded — نسجّل لمن وبأي أولوية، وهل انقبلت */
      if (host === 'api.pushover.net') {
        const f = new URLSearchParams(body);
        /* العطل للصفارات وحدها (أولوية 2): السيرفر يرسل للإدارة تنبيهات عادية كذلك (إقلاع · إنذارات) */
        const okNow = !(Number(f.get('priority')) === 2 && st.poFail > 0 && st.poFail--);
        st.PO.push({ user: f.get('user'), priority: Number(f.get('priority')), sound: f.get('sound'),
          title: f.get('title'), ok: okNow, at: Date.now() });
        return okNow ? json(200, { status: 1, request: 'r' }) : json(500, { status: 0, errors: ['internal error'] });
      }
      if (host === 'fake.supabase.co') {
        const [p, raw = ''] = req.url.split('?');
        let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
        const t = p.replace('/rest/v1/', '');
        const list = st.DB[t] || (st.DB[t] = []);
        const rep = /return=representation/.test(req.headers.prefer || '');
        let b = null; try { b = body ? JSON.parse(body) : null } catch (e) {}
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

let PORTN = 23500 + (process.pid % 90);
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
  c.warp = ms => c.send({ warp: ms });
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

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
/* التنبيه الطارئ شغّال لكل من ربط مفتاحه (وضع link) */
const base = () => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true, pushoverMode: 'link' } } }] });
let MID = 1;
const user = (DB, n, key, chat) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(chat || 900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: key === undefined ? 'ukey' + n : key, pushover_until: null });
const watch = (DB, n, crn, last) => { const m = { id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', section: '101', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  DB.monitored_courses.push(m); return m };
const courseMon = (DB, n, state) => { const m = { id: MID++, user_id: 'u' + n, scope: 'course',
  course_code: 'MEEN 3311', crn: null, term: '202710', last_status: null, followup_done: true, followup_at: null,
  expires_at: null, sections_state: state, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  DB.monitored_courses.push(m); return m };
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
/* الصفارات: أولوية 2 */
const sirens = (st, user) => st.PO.filter(x => x.priority === 2 && (!user || x.user === user));
const OPENED = () => ({ M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] });

const SCEN = {
  async both(t) {
    const DB = base(); user(DB, 1);
    watch(DB, 1, '30011', 'CLOSE'); courseMon(DB, 1, { 30011: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: OPENED() });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const tg = msgsTo(st, 901);
    t.ok(tg.length === 2 && tg.some(m => /الشعبة اللي تبيها فتحت/.test(m.text)) && tg.some(m => /فتحت شعبة في مادة تراقبها/.test(m.text)),
      'يراقب المادة كاملة والشعبة نفسها: رسالتان على تيليغرام (شعبتك · شعبة في مادتك) — كما كان');
    t.eq(sirens(st, 'ukey1').length, 1,
      '**وصفارة وحدة للحدث الواحد** — كانت صفارتان بنفس اللحظة، كل وحدة تعيد نفسها لين يأكّدها لحالها');
    t.ok(sirens(st)[0] && sirens(st)[0].sound === 'siren' && /MEEN 3311/.test(sirens(st)[0].title), 'والصفارة بصوتها وباسم المادة');
    c.kill('SIGKILL');
  },

  async admin(t) {
    /* صاحب الموقع (محادثته ADMIN_CHAT_ID) بلا مفتاح طالب: صفارته على مفتاح السيرفر */
    const DB = base(); user(DB, 1, null, 5555);
    watch(DB, 1, '30011', 'CLOSE'); courseMon(DB, 1, { 30011: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: OPENED() });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 5555).filter(m => /فتحت/.test(m.text)).length, 2, 'صاحب الموقع: رسالتان على تيليغرام');
    t.eq(sirens(st, 'owner-key-for-tests').length, 1, '**وصفارة وحدة** (كانت اثنتين)');
    c.kill('SIGKILL');
  },

  async reopen(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: OPENED() });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(sirens(st, 'ukey1').length, 1, 'فتحت: صفارة');
    st.pmu.M1 = [row('30011', 'CLOSE')];
    await cycleOf(c);
    st.pmu.M1 = [row('30011', 'OPEN')];
    await cycleOf(c);                                        /* بعد ثوانٍ بس — دورة ثانية = حدث ثاني */
    t.eq([msgsTo(st, 901).length, sirens(st, 'ukey1').length], [2, 2],
      '**قفلت ثم فتحت في الدورة اللي بعدها (ولو بعد ثوانٍ): إشعار وصفارة من جديد** — فرصة حقيقية ما نكتمها');
    c.kill('SIGKILL');
  },

  async twoStudents(t) {
    const DB = base(); user(DB, 1); user(DB, 2);
    watch(DB, 1, '30011', 'CLOSE'); watch(DB, 2, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: OPENED() });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([sirens(st, 'ukey1').length, sirens(st, 'ukey2').length], [1, 1], 'طالبان على نفس الشعبة: صفارة لكل واحد');
    c.kill('SIGKILL');
  },

  async failedFirst(t) {
    const DB = base(); user(DB, 1);
    watch(DB, 1, '30011', 'CLOSE'); courseMon(DB, 1, { 30011: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: OPENED(), poFail: 1 });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const s = sirens(st, 'ukey1');
    t.eq([s.length, s.filter(x => x.ok).length], [2, 1],
      '**الصفارة الأولى ما وصلت (عطل عند Pushover): اللي بعدها انرسلت** — صفارة ما وصلت ما تحجب غيرها');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`صفارة وحدة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
