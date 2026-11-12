/* موعد الدورة ما يعلق على حالة قديمة — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك (الجامعة · القاعدة · تيليغرام).
   **الدورات هنا من جدولة السيرفر نفسها** — ولا نداء لـ/api/run-check إلا لبدء الدورة العالقة في stuck.
   ١) resume — موقوفة من اللوحة (فموعدها صار ٧ الصبح بكرة) ثم «▶️ شغّل المراقبة» ⇒ دورة خلال ثوانٍ.
               كانت اللوحة وتيليغرام يقولان «رجعت تشتغل» والموعد القديم يبقى: ولا دورة لين بكرة.
   ٢) hours  — خارج ساعات العمل ثم تغيّرت الساعات من اللوحة ⇒ دورة خلال ثوانٍ (كان موعد «بداية الدوام» القديم يبقى).
   ٣) window — خارج النوافذ ثم نافذة يدوية من اللوحة ⇒ دورة خلال ثوانٍ (كانت تنتظر الفحص الساعي).
   ٤) clock  — الحالة صارت «نشطة» بلا ضغطة أحد والموعد محسوب قبلها ⇒ الحارس يعيد الجدولة.
   ٥) stuck  — دورة علقت أكثر من ٨ دقائق ⇒ الحارس يبدأ غيرها وينذر. كان فكّ القفل ما يصير إلا لو أحد نادى دورة،
               والجدولة نفسها تنتظر العالقة — فما ينادي أحد.
   ٦) pause  — الإيقاف نفسه: ولا دورة بعده، وضغطات ورا بعض = دورة وحدة، وما بين دورتين أقل من دقيقة.

   node tests/test-cycle-resume.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-cycle-resume';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
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
  const st = { DB: o.DB, pmu: Object.assign({ hits: [] }, o.pmu), TG: [], stall: false, nextId: 1000 };
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
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? P.F1 : g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
      }
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body) } catch (e) {}
        if (!/sendMessage$/.test(req.url)) return json(200, { ok: true, result: true });
        st.TG.push({ chat: String(b.chat_id), text: String(b.text || ''), at: Date.now() });
        return json(200, { ok: true, result: { message_id: 1 } });
      }
      if (host === 'fake.supabase.co') {
        /* القاعدة ساكتة تماماً: الطلب يعلق لين حد المدة عند السيرفر */
        if (st.stall) return;
        const [p, raw = ''] = req.url.split('?');
        let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
        const t = p.replace('/rest/v1/', '');
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

let PORTN = 23100 + (process.pid % 90);
function instance(st, extra) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child'].concat(extra || [], [String(st.port), String(port)]), { silent: true });
  const call = (p, method, payload) => new Promise(resolve => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET',
      headers: Object.assign({ 'X-Admin-Token': ADMIN }, data ? { 'Content-Type': 'application/json' } : {}) }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, j }) });
    });
    r.on('error', () => resolve({ status: 0, j: null }));
    if (data) r.write(data);
    r.end();
  });
  c.adm = (act, payload) => call('/api/admin/' + act, payload ? 'POST' : 'GET', payload);
  c.health = () => call('/api/admin/health').then(r => r.j || {});
  c.mi = async () => (await c.health()).monitorInfo || {};
  /* رقم آخر دورة خلصت (٠ = ولا وحدة) */
  c.gen = async () => ((await c.health()).lastCycle || {}).gen || 0;
  c.run = () => call('/api/run-check').then(r => r.j);
  c.warp = ms => c.send({ warp: ms });
  c.st = st;
  return c;
}
const ready = async c => {
  for (let i = 0; i < 150; i++) { if ((await c.health()).booted) return true; await wait(100) }
  return false;
};
/* ننتظر الشرط (غير متزامن) أو المهلة */
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(250) } return !!(await fn()) };

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
const base = toggles => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: toggles ? [{ key: 'runtime', value: { toggles } }] : [] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last, term) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', section: '101', crn, term, last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const opened = st => msgsTo(st, 901).filter(m => /فتحت/.test(m.text));
const adminSays = (st, re) => msgsTo(st, 5555).filter(m => re.test(m.text)).length;
const posts = st => st.pmu.hits.filter(h => h.method === 'POST').length;
/* الإنذار نفسه — «رجع طبيعي: دورة المراقبة علقت» بعده رسالة ثانية */
const STUCK = /🔴 <b>دورة المراقبة علقت/;

/* ١٠ الصبح بالرياض، داخل نافذة تسجيل الثاني وبعد أيام التسجيل نفسها (فاصلها ٥ دقائق) — وترمها 202720 */
const IN_WINDOW = '2027-01-19T07:00:00Z', WIN_TERM = '202720';
/* الجدولة عند الإقلاع: أول موعد بعد ٢٠–٦٠ ثانية، وبعده الموعد المحسوب على الحالة */
const BOOT_MS = 75000;
/* من تغيّر الحالة لنهاية الدورة: الحارس (ربع دقيقة) + مهلة البدء + الدورة نفسها */
const SOON_MS = 45000;

const SCEN = {
  async resume(t) {
    const DB = base({ monitorPaused: true }); user(DB, 1); watch(DB, 1, '30011', 'CLOSE', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    /* موقوفة: أول موعد يمر بلا دورة، والموعد اللي بعده محسوب على «موقوفة» — بعيد */
    t.ok(await until(async () => ((await c.mi()).nextCycleInSec || 0) > 3600, BOOT_MS),
      'موقوفة من اللوحة: الموعد الجاي صار بعيداً (بداية دوام بكرة)');
    t.eq([await c.gen(), posts(st), opened(st).length], [0, 0, 0], 'وهي موقوفة: ولا دورة ولا سحبة ولا إشعار');

    const r = await c.adm('monitor-toggle', { on: true });
    t.ok(r.status === 200 && r.j && r.j.on === true, 'ضغطة «▶️ شغّل المراقبة» انقبلت');
    const mi = await c.mi();
    t.ok(mi.nextCycleInSec != null && mi.nextCycleInSec <= 60,
      `**والموعد الجاي صار خلال دقيقة على طول** (كان يبقى ٧ الصبح بكرة) — ${mi.nextCycleInSec} ثانية`);
    t.ok(await until(() => opened(st).length === 1, SOON_MS),
      '**«شغّل المراقبة» بعد الإيقاف: دورة اشتغلت لحالها والطالب وصله «فتحت»** — كانت ولا دورة لين بكرة');
    t.ok(await until(async () => (await c.gen()) >= 1, 15000), 'والدورة خلصت وانسجّلت');
    const after = await c.mi();
    t.ok(after.nextCycleInSec > 60 && after.nextCycleInSec <= 6.25 * 60 + 5,
      `وبعدها الجدولة على فاصلها العادي (٥ دقائق ±٢٥٪) — ${after.nextCycleInSec} ثانية`);
    t.eq(adminSays(st, /المراقبة رجعت تشتغل/), 1, 'ورسالة «المراقبة رجعت تشتغل» وصلت الإدارة مرة');
    c.kill('SIGKILL');
  },

  async hours(t) {
    /* الساعات من اللوحة ١٢–٢٤ والساعة ١٠: خارج ساعات العمل */
    const DB = base({ hoursOverride: { from: 12, to: 24 } }); user(DB, 1); watch(DB, 1, '30011', 'CLOSE', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    t.ok(await until(async () => ((await c.mi()).nextCycleInSec || 0) > 3600, BOOT_MS),
      'خارج ساعات العمل: الموعد الجاي بداية الدوام (بعد ساعتين)');
    t.eq([await c.gen(), opened(st).length], [0, 0], 'وخارج الساعات: ولا دورة');

    const r = await c.adm('monitor-hours', { reset: true });
    t.ok(r.status === 200 && r.j && r.j.state && r.j.state.active === true, 'رجّعنا الساعات للافتراضي: الحالة «نشطة»');
    const mi = await c.mi();
    t.ok(mi.nextCycleInSec != null && mi.nextCycleInSec <= 60,
      `**والموعد الجاي خلال دقيقة** (كان يبقى موعد بداية الدوام القديم) — ${mi.nextCycleInSec} ثانية`);
    t.ok(await until(() => opened(st).length === 1, SOON_MS),
      '**تغيير ساعات العمل من اللوحة: دورة اشتغلت لحالها والطالب وصله «فتحت»**');
    c.kill('SIGKILL');
  },

  async window(t) {
    /* ١ مارس ٢٠٢٧: خارج كل النوافذ — والمراقبة تفحص مرة بالساعة هل بدأت نافذة */
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSE', '202710');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st, ['--at=2027-03-01T07:00:00Z']); await ready(c);
    t.ok(await until(async () => ((await c.mi()).nextCycleInSec || 0) > 1800, BOOT_MS),
      'خارج النوافذ: الموعد الجاي فحص ساعي');
    t.eq([await c.gen(), opened(st).length], [0, 0], 'وخارج النوافذ: ولا دورة');

    const r = await c.adm('monitor-window', { from: '2027-03-01', to: '2027-03-02', ar: 'نافذة تجربة' });
    t.ok(r.status === 200 && r.j && r.j.state && r.j.state.active === true, 'نافذة يدوية من اللوحة: الحالة «نشطة»');
    const mi = await c.mi();
    t.ok(mi.nextCycleInSec != null && mi.nextCycleInSec <= 60,
      `**والموعد الجاي خلال دقيقة** (كان ينتظر الفحص الساعي) — ${mi.nextCycleInSec} ثانية`);
    t.ok(await until(() => opened(st).length === 1, SOON_MS),
      '**نافذة يدوية من اللوحة: دورة اشتغلت لحالها والطالب وصله «فتحت»**');
    c.kill('SIGKILL');
  },

  async clock(t) {
    /* ٦:٥٠ الصبح داخل النافذة: خارج ساعات العمل، والموعد محسوب لبدايتها. ثم الساعة تصير ٧:٠٥ بلا ما يضغط أحد شي
       (في الإنتاج: حالة انقرأت متأخرة، أو أي طريق يغيّر الحالة بلا إعادة جدولة) */
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSE', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st, ['--at=2027-01-19T03:50:00Z']); await ready(c);
    t.ok(await until(async () => ((await c.mi()).nextCycleInSec || 0) > 180, BOOT_MS),
      '٦:٥٠ الصبح: الموعد الجاي بداية ساعات العمل');
    t.eq([await c.gen(), opened(st).length], [0, 0], 'وقبل ساعات العمل: ولا دورة');
    c.warp(15 * 60 * 1000);
    t.ok(await until(() => opened(st).length === 1, SOON_MS),
      '**الحالة صارت «نشطة» والموعد محسوب قبلها: الحارس أعاد الجدولة والطالب وصله «فتحت»** — كان ينتظر الموعد القديم');
    c.kill('SIGKILL');
  },

  async stuck(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSE', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    /* أول دورة مجدولة تخلص — فالموعد اللي بعدها بعد دقائق (ما يتدخّل في اللي تحت) */
    t.ok(await until(async () => (await c.gen()) >= 1, BOOT_MS + 15000), 'أول دورة مجدولة خلصت');
    const g0 = await c.gen();
    t.ok((await c.mi()).nextCycleInSec > 120, 'والموعد الجاي بعد دقائق');

    st.pmu.M1 = [row('30011', 'OPEN')];
    st.stall = true;                              /* القاعدة ساكتة: أول سؤال في الدورة يعلق */
    const r = await c.run();
    t.ok(r && r.ran === true, 'بدأت دورة — وعلقت على القاعدة');
    await wait(1500);
    st.stall = false;                             /* العالق يبقى عالقاً، والجديد يُرد عليه */
    c.warp(9 * 60 * 1000);                        /* مرّت ٩ دقائق والدورة لسا ما خلصت */
    const t0 = Date.now();
    t.ok(await until(() => adminSays(st, STUCK) === 1, 17000),
      '**دورة عالقة من ٩ دقائق: الحارس فكّ قفلها وأنذر «دورة المراقبة علقت»** — كان ما ينادي أحد دورة فما ينفك');
    t.ok(await until(() => opened(st).length === 1, 12000), '**والدورة الجديدة نبّهت الطالب**');
    t.ok(Date.now() - t0 < 19000, `قبل ما تصحى العالقة (حد القاعدة ٢٠ ثانية) — ${((Date.now() - t0) / 1000).toFixed(1)} ث`);
    await until(async () => (await c.gen()) > g0, 10000);
    await wait(24000);                            /* العالقة تصحى بعد حد القاعدة: ما ترسل ثانية */
    t.eq(opened(st).length, 1, '**والعالقة لما صحت ما أرسلت ثانية** — إشعار واحد');
    t.eq(adminSays(st, STUCK), 1, 'وإنذار «علقت» مرة وحدة');
    t.eq(adminSays(st, /رجع طبيعي: دورة المراقبة علقت/), 1, 'وبعد الدورة السليمة: «رجع طبيعي»');
    c.kill('SIGKILL');
  },

  async pause(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSE', WIN_TERM);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    t.ok(await until(async () => (await c.gen()) >= 1, BOOT_MS + 15000), 'شغّالة: أول دورة مجدولة خلصت لحالها');
    const g1 = await c.gen(), p1 = posts(st);

    await c.adm('monitor-toggle', { on: false });
    const off = await c.mi();
    t.ok(off.nextCycleInSec > 3600, `«⏸️ أوقف المراقبة»: الموعد الجاي بعيد على طول — ${off.nextCycleInSec} ثانية`);
    await wait(20000);
    t.eq([await c.gen(), posts(st)], [g1, p1], 'وموقوفة: ولا دورة ولا سحبة من الجامعة');

    /* ضغطات ورا بعض: شغّل · أوقف · شغّل */
    await c.adm('monitor-toggle', { on: true });
    await c.adm('monitor-toggle', { on: false });
    await c.adm('monitor-toggle', { on: true });
    t.ok(await until(async () => (await c.gen()) === g1 + 1, SOON_MS), 'ثلاث ضغطات تنتهي بـ«شغّل»: دورة اشتغلت');
    await wait(4000);
    t.eq(await c.gen(), g1 + 1, '**ودورة وحدة** — لا دورة لكل ضغطة');

    /* أوقف وشغّل مباشرة بعد دورة: ما بين دورتين أقل من دقيقة (ما نطرق الجامعة مع كل ضغطة) */
    await c.adm('monitor-toggle', { on: false });
    await c.adm('monitor-toggle', { on: true });
    const again = await c.mi();
    t.ok(again.nextCycleInSec >= 25 && again.nextCycleInSec <= 60,
      `**تشغيل بعد دورة بثوانٍ: الدورة الجاية بعد دقيقة من السابقة، لا فوراً** — ${again.nextCycleInSec} ثانية`);
    await wait(12000);
    t.eq(await c.gen(), g1 + 1, 'وخلال ربع دقيقة ما بدأت دورة ثانية');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`موعد الدورة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
