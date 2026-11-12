/* إشعار «فتحت» ما يضيع لو القاعدة تعثّرت لحظة — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك.
   كانت الدورة تسجّل الشعبة «مفتوحة» (الحجز) ثم تقرأ ملفات الطلاب وترسل: تعثّر بينهما ⇒ الشعبة «مفتوحة» في
   القاعدة والإشعار ما راح، والدورة الجاية تلقاها «مفتوحة» فما ترسل — ضاع للأبد.
   ١) profErr        — قراءة ملفات الطلاب ترد خطأ (٥٠٣) ⇒ ما ينكتب شي والإشعار يتأجّل للدورة الجاية، وإنذار للإدارة.
   ٢) profBlip       — تعثّرت مرة ورجعت ⇒ المحاولة الثانية تكفي والإشعار يوصل في نفس الدورة.
   ٣) profCut        — انقطاع (لا رد خطأ) ⇒ نفس الشي: يتأجّل ولا يضيع.
   ٤) courseProf     — مراقبة المادة كاملة: حالتها ما تنكتب بلا إشعار.
   ٥) writeCut       — كتابة حالة شعبة ثانية (قفلت) انقطعت ⇒ ما توقف الدورة، وإشعار الأولى يوصل.
   ٦) claimCut       — الحجز انكتب ورده ضاع ⇒ نتأكد من القاعدة ونرسل (كان «ما انحجز» فيضيع).
   ٧) courseClaimCut — نفسها للمادة كاملة.
   ٨) plain          — دورة عادية: إشعار واحد وبلا إنذار.

   node tests/test-alert-db.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-alert-db';
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

/* عطل القاعدة لكل سيناريو: fault(q) ترجّع
     'err'      — رد خطأ PostgREST (كائن لا مصفوفة)
     'cut'      — انقطاع قبل ما ينكتب شي
     'applyCut' — انكتب ثم انقطع الرد (الأخطر: السيرفر ما يدري إنه انكتب)
   q = { t: الجدول, method, qs, body } */
function makeOutside(o) {
  const st = { DB: o.DB, pmu: o.pmu, TG: [], fault: o.fault || (() => null), seen: [], reqs: 0, nextId: 1000 };
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
        const f = st.fault(q);
        if (f) st.seen.push(f + ' ' + req.method + ' ' + t);
        if (f === 'err') return json(503, { code: 'PGRST000', message: 'Could not connect to the database' });
        if (f === 'cut') return req.socket.destroy();
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
          if (f === 'applyCut') return req.socket.destroy();
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

let PORTN = 23200 + (process.pid % 90);
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
/* «الخارج» هدأ: ولا طلب جديد ٣٠٠ م.ث — الإنذارات تنرسل بلا await */
const settle = async st => { let n = -1; for (const t0 = Date.now(); Date.now() - t0 < 8000 && st.reqs !== n;) { n = st.reqs; await wait(300) } };
/* دورة كاملة: نطلبها ونستنى لين تخلص فعلاً (lastCycle.gen في الصحة) ثم يهدأ «الخارج» */
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
const base = () => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last) => { const m = { id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', section: '101', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  DB.monitored_courses.push(m); return m };
const courseMon = (DB, n, state) => { const m = { id: MID++, user_id: 'u' + n, scope: 'course',
  course_code: 'MEEN 3311', crn: null, term: '202710', last_status: null, followup_done: true, followup_at: null,
  expires_at: null, sections_state: state, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  DB.monitored_courses.push(m); return m };
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const opened = (st, chat) => msgsTo(st, chat || 901).filter(m => /فتحت/.test(m.text));
const adminSays = (st, re) => msgsTo(st, 5555).filter(m => re.test(m.text)).length;
const DEFER = /🔴 <b>القاعدة تعثّرت وقت الإرسال/, BACK = /رجع طبيعي: القاعدة تعثّرت وقت الإرسال/;

/* أي طلب هذا؟ */
const isProfiles = q => q.t === 'profiles' && q.method === 'GET' && /pushover_key/.test(q.qs);
const isClaim = q => q.t === 'monitored_courses' && q.method === 'PATCH' && /or=\(last_status\.is\.null/.test(q.qs);
const isCourseClaim = q => q.t === 'monitored_courses' && q.method === 'PATCH' && /notified_at=/.test(q.qs) &&
  q.body && q.body.sections_state && q.body.notified_at;
/* كتابة الحالة بالجملة (قفلت · تصحيح الأساس): بلا شرط */
const isStatusWrite = q => q.t === 'monitored_courses' && q.method === 'PATCH' && !/or=|last_status=eq|notified_at=/.test(q.qs) &&
  q.body && 'last_status' in q.body;
/* أول n طلبات من هالنوع تتعطّل */
const first = (n, is, how) => { let left = n; return q => (is(q) && left-- > 0) ? how : null };

const PMU = () => ({ M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] });

const SCEN = {
  async profErr(t) {
    const DB = base(); user(DB, 1); const m = watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: PMU(), fault: first(2, isProfiles, 'err') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(opened(st).length, 0, 'القاعدة ردّت بخطأ على ملفات الطلاب (محاولتين): ما وصل شي هالدورة');
    t.eq(m.last_status, 'CLOSE', '**وما انكتبت الشعبة «مفتوحة»** — كانت تنكتب قبل قراءة الملفات، فالدورة الجاية ما تشوف فرقاً');
    t.eq(adminSays(st, DEFER), 1, 'والإدارة وصلها «القاعدة تعثّرت وقت الإرسال — إشعارات تأجّلت»');
    await cycleOf(c);
    t.eq(opened(st).length, 1, '**والدورة الجاية أرسلت «فتحت»** — كان الإشعار يضيع للأبد');
    t.eq(m.last_status, 'OPEN', 'وبعد الإرسال الشعبة «مفتوحة» في القاعدة');
    t.eq(adminSays(st, BACK), 1, 'و«رجع طبيعي» للإدارة');
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async profBlip(t) {
    const DB = base(); user(DB, 1); const m = watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: PMU(), fault: first(1, isProfiles, 'err') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([opened(st).length, m.last_status], [1, 'OPEN'],
      '**القاعدة تعثّرت مرة ورجعت: المحاولة الثانية كفت والإشعار وصل في نفس الدورة** — كان يضيع');
    t.eq(adminSays(st, DEFER), 0, 'وبلا إنذار (ما تأجّل شي)');
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async profCut(t) {
    const DB = base(); user(DB, 1); const m = watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: PMU(), fault: first(2, isProfiles, 'cut') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([opened(st).length, m.last_status], [0, 'CLOSE'], 'الاتصال انقطع وقت قراءة الملفات: ما وصل شي وما انكتب شي');
    await cycleOf(c);
    t.eq(opened(st).length, 1, '**والدورة الجاية أرسلت** — كان الانقطاع يرمي الدورة كلها والمحجوز يبقى «مفتوحة» بلا إشعار');
    c.kill('SIGKILL');
  },

  async courseProf(t) {
    const DB = base(); user(DB, 1); const m = courseMon(DB, 1, { 30011: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: PMU(), fault: first(2, isProfiles, 'err') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([opened(st).length, m.sections_state['30011'], m.notified_at], [0, 'CLOSE', null],
      '**المادة كاملة والقاعدة تعثّرت: حالتها ما انكتبت بلا إشعار** — كانت تنكتب «مفتوحة» فما يطلع فرق بعدها');
    await cycleOf(c);
    t.eq([opened(st).length, m.sections_state['30011']], [1, 'OPEN'], '**والدورة الجاية أرسلت «فتحت شعبة في مادة تراقبها»**');
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async writeCut(t) {
    /* طالبان: شعبة الأول فتحت (إشعار)، وشعبة الثاني قفلت (كتابة حالة بلا إشعار) — وكتابة الثانية انقطعت */
    const DB = base(); user(DB, 1); user(DB, 2);
    const a = watch(DB, 1, '30011', 'CLOSE'), b = watch(DB, 2, '30012', 'OPEN');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN'), row('30012', 'CLOSE', '102')], F1: [frow('40011', 'CLOSE')] },
      fault: first(1, isStatusWrite, 'cut') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.ok(st.seen.some(x => /cut PATCH monitored_courses/.test(x)), 'كتابة حالة الشعبة اللي قفلت انقطعت فعلاً');
    t.eq(opened(st).length, 1,
      '**كتابة حالة شعبة ثانية انقطعت: إشعار الأولى وصل** — كان الانقطاع يرمي الدورة والمحجوز يبقى «مفتوحة» بلا إشعار');
    t.eq(a.last_status, 'OPEN', 'والأولى «مفتوحة» في القاعدة');
    await cycleOf(c);
    t.eq(b.last_status, 'CLOSE', 'والدورة الجاية كتبت حالة الثانية (الفرق باقٍ فانكتب)');
    t.eq([opened(st).length, opened(st, 902).length], [1, 0], 'وبلا تكرار ولا إشعار للي قفلت شعبته');
    c.kill('SIGKILL');
  },

  async claimCut(t) {
    const DB = base(); user(DB, 1); const m = watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: PMU(), fault: first(1, isClaim, 'applyCut') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(m.last_status, 'OPEN', 'الحجز انكتب في القاعدة ورده ضاع');
    t.eq(opened(st).length, 1,
      '**الحجز انكتب ورده ضاع: تأكدنا من القاعدة وأرسلنا** — كان «ما انحجز» فما نرسل، والشعبة «مفتوحة» فما ترجع');
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async courseClaimCut(t) {
    const DB = base(); user(DB, 1); const m = courseMon(DB, 1, { 30011: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: PMU(), fault: first(1, isCourseClaim, 'applyCut') });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(m.sections_state['30011'], 'OPEN', 'حجز المادة كاملة انكتب ورده ضاع');
    t.eq(opened(st).length, 1, '**المادة كاملة: الحجز انكتب ورده ضاع ⇒ تأكدنا وأرسلنا** — كانت الحالة الجديدة تبقى بلا إشعار');
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async plain(t) {
    const DB = base(); user(DB, 1); user(DB, 2);
    const a = watch(DB, 1, '30011', 'CLOSE'); courseMon(DB, 2, { 30011: 'CLOSE', 40011: 'CLOSE' });
    const st = await makeOutside({ DB, pmu: PMU() });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([opened(st).length, opened(st, 902).length, a.last_status], [1, 1, 'OPEN'], 'دورة عادية: إشعار لكل واحد');
    t.eq([adminSays(st, DEFER), st.seen.length], [0, 0], 'وبلا إنذار ولا عطل');
    await cycleOf(c);
    t.eq([opened(st).length, opened(st, 902).length], [1, 1], 'ومرة وحدة');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`الإشعار والقاعدة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
