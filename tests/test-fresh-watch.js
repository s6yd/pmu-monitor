/* مراقبة جديدة ما يضيع أول إشعار لها — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك.
   كانت أول دقيقتين من عمر المراقبة «تصحيح أساس» صامتاً: شعبة تفتح فيها تنكتب «مفتوحة» بلا إشعار وصاحبها ينتظر
   للأبد. والحكم صار بمقارنة وقت بيانات الدورة بوقت إنشاء المراقبة، لا بعمرها:
   ١) young          — مراقبة عمرها نصف دقيقة وشعبتها فتحت ⇒ إشعار (كان صمتاً).
   ٢) brandNew       — مراقبة انضافت والسحبة تبدأ بنفس اللحظة ⇒ ما نحكم (لا كتابة ولا إشعار)، والدورة الجاية ترسل.
   ٣) cacheOlder     — الجامعة ما ترد والدورة على نسخة أقدم من ضغطة الطالب ⇒ ما تطلع «فتحت» كاذبة من نسخة قديمة.
   ٤) courseBase     — «راقب كل الشعب» بأساس من الصفحة (اللي شافه الطالب): شعبة فتحت بعد ضغطته ⇒ إشعار، وبلا «نزلت
                       شعبة جديدة» عن شعب مو في قائمته.
   ٥) courseBaseOpen — شعبة كانت مفتوحة في قائمته أصلاً ⇒ ولا إشعار.
   ٦) courseBaseNew  — أساس من الصفحة ومراقبة أحدث من البيانات ⇒ ننتظر الدورة الجاية.
   ٧) courseNoBase   — بلا أساس (صفحة قديمة): أول دورة تسجيل وبس — كما كان.
   ٨) old            — مراقبة قديمة: كما كانت.

   node tests/test-fresh-watch.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-fresh-watch';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  /* ساعة السيرفر تتقدّم برسالة من الأب ({warp: ms}) */
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
  const st = { DB: o.DB, pmu: Object.assign({ mode: 'ok' }, o.pmu), TG: [], reqs: 0, nextId: 1000 };
  st.server = http.createServer((req, res) => {
    st.reqs++;
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        if (st.pmu.mode === 'down') return req.socket.destroy();
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? st.pmu.F1 : g === 'M1' ? st.pmu.M1 : st.pmu.M1.concat(st.pmu.F1)));
      }
      /* احتياط بانر ما له مكان هنا: الجامعة «ما ترد» = نسخة الكاش */
      if (host === 'banreg.pmu.edu.sa') return req.socket.destroy();
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

let PORTN = 23300 + (process.pid % 90);
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
  c.shift = 0;
  c.warp = ms => { c.shift += ms; c.send({ warp: ms }) };
  /* ساعة السيرفر الحين (created_at في الصفوف بها — القاعدة والسيرفر بنفس الساعة في الإنتاج) */
  c.now = () => Date.now() + c.shift;
  c.st = st;
  return c;
}
const ready = async c => { for (let i = 0; i < 150; i++) { if ((await c.health()).booted) return true; await wait(100) } return false };
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
/* made: وقت إنشاء المراقبة (م.ث) — الافتراضي قبل يوم */
const watch = (DB, n, crn, last, made) => { const m = { id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', section: '101', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null,
  created_at: new Date(made == null ? Date.now() - 864e5 : made).toISOString() };
  DB.monitored_courses.push(m); return m };
const courseMon = (DB, n, state, made) => { const m = { id: MID++, user_id: 'u' + n, scope: 'course',
  course_code: 'MEEN 3311', crn: null, term: '202710', last_status: null, followup_done: true, followup_at: null,
  expires_at: null, sections_state: state, notified_at: null,
  created_at: new Date(made == null ? Date.now() - 864e5 : made).toISOString() };
  DB.monitored_courses.push(m); return m };
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
const opened = (st, chat) => msgsTo(st, chat || 901).filter(m => /فتحت/.test(m.text));
const fresh = (st, chat) => msgsTo(st, chat || 901).filter(m => /نزلت شعبة/.test(m.text));

const SCEN = {
  async young(t) {
    const DB = base(); user(DB, 1); const m = watch(DB, 1, '30011', 'CLOSE', Date.now() - 30000);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(opened(st).length, 1,
      '**مراقبة عمرها نصف دقيقة وشعبتها فتحت: وصل «فتحت»** — كانت تنكتب «مفتوحة» بصمت (تصحيح أساس) وصاحبها ينتظر للأبد');
    t.eq(m.last_status, 'OPEN', 'والحالة انكتبت');
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async brandNew(t) {
    const DB = base(); user(DB, 1);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    const m = watch(DB, 1, '30011', 'CLOSE', Date.now());      /* انضافت الحين — والسحبة تبدأ بنفس اللحظة */
    await cycleOf(c);
    t.eq([opened(st).length, m.last_status], [0, 'CLOSE'],
      '**مراقبة انضافت والسحبة تبدأ بنفس اللحظة: ما حكمنا — لا إشعار ولا كتابة** (كانت تنكتب «مفتوحة» بصمت فما يرجع الفرق)');
    await wait(5500);
    await cycleOf(c);
    t.eq([opened(st).length, m.last_status], [1, 'OPEN'], '**والدورة الجاية (بيانات بعد ضغطته) أرسلت «فتحت»**');
    c.kill('SIGKILL');
  },

  async cacheOlder(t) {
    /* طالب قديم على شعبة ثانية — عشان الدورة الأولى تسحب وتعبّي نسخة الذاكرة */
    const DB = base(); user(DB, 1); user(DB, 2); watch(DB, 1, '30012', 'CLOSE');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN'), row('30012', 'CLOSE', '102')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);                                           /* نسخة الذاكرة: 30011 مفتوحة */
    /* بعدها بثوانٍ قفلت 30011؛ طالب شافها مقفلة وضغط «راقب». ثم الجامعة ما ترد، والدورة على نسخة الذاكرة
       (عمرها دقيقتان وربع — أقدم من ضغطته، وضغطته قبل دقيقتين: برّا مهلة «تصحيح الأساس» القديمة) */
    st.pmu.mode = 'down';
    c.warp(135000); await wait(300);
    const m = watch(DB, 2, '30011', 'CLOSE', c.now() - 122000);
    await cycleOf(c);
    t.eq([opened(st, 902).length, m.last_status], [0, 'CLOSE'],
      '**الجامعة ما ترد والدورة على نسخة أقدم من ضغطة الطالب: ما طلعت «فتحت» كاذبة** — كانت تطلع بعد دقيقتين من عمر المراقبة');
    st.pmu.mode = 'ok';
    st.pmu.M1 = [row('30011', 'CLOSE'), row('30012', 'CLOSE', '102')];
    await cycleOf(c);
    t.eq([opened(st, 902).length, m.last_status], [0, 'CLOSE'], 'رجعت الجامعة والشعبة مقفلة فعلاً: ولا إشعار');
    st.pmu.M1 = [row('30011', 'OPEN'), row('30012', 'CLOSE', '102')];
    await cycleOf(c);
    t.eq(opened(st, 902).length, 1, 'وأول ما تفتح فعلاً: «فتحت»');
    c.kill('SIGKILL');
  },

  async courseBase(t) {
    /* قائمة الطالب كانت بشعب الطلاب وحدها (٣٠٠١١ مقفلة)، وضغط «راقب كل الشعب» قبل ثلث دقيقة — ثم فتحت */
    const DB = base(); user(DB, 1);
    const m = courseMon(DB, 1, { _page: 1, 30011: 'CLOSE' }, Date.now() - 20000);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE'), frow('40012', 'OPEN', '202')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const all = msgsTo(st, 901);
    t.ok(opened(st).length === 1 && /فتحت شعبة في مادة تراقبها/.test(opened(st)[0].text) && /30011/.test(opened(st)[0].text),
      '**«راقب كل الشعب» وشعبة فتحت بعد ضغطته: وصل «فتحت شعبة في مادة تراقبها»** — كانت أول دورة تسجيل وبس');
    t.eq([all.length, fresh(st).length], [1, 0],
      '**وبلا «نزلت شعبة جديدة» عن شعب مو في قائمته** (أساس الصفحة ناقص بطبعه — جنس أو كلية)');
    t.eq(m.sections_state, { 30011: 'OPEN', 40011: 'CLOSE', 40012: 'OPEN' }, 'والحالة انكتبت كاملة وبلا علامة الصفحة');
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },

  async courseBaseOpen(t) {
    const DB = base(); user(DB, 1);
    const m = courseMon(DB, 1, { _page: 1, 30011: 'OPEN' }, Date.now() - 20000);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 0, '**شعبة كانت مفتوحة في قائمته أصلاً: ولا إشعار** (ولا «نزلت شعبة» عن اللي مو في قائمته)');
    t.eq(m.sections_state, { 30011: 'OPEN', 40011: 'CLOSE' }, 'والحالة انكتبت كاملة وبلا علامة الصفحة');
    st.pmu.M1 = [row('30011', 'CLOSE')];
    await cycleOf(c);
    st.pmu.M1 = [row('30011', 'OPEN')];
    await cycleOf(c);
    t.eq(opened(st).length, 1, 'وبعدها المقارنة العادية: قفلت ثم فتحت = إشعار');
    c.kill('SIGKILL');
  },

  async courseBaseNew(t) {
    const DB = base(); user(DB, 1);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    const m = courseMon(DB, 1, { _page: 1, 30011: 'CLOSE' }, Date.now());
    await cycleOf(c);
    t.eq([msgsTo(st, 901).length, m.sections_state._page], [0, 1],
      'أساس من الصفحة والمراقبة انضافت مع بداية السحبة: ما حكمنا — لا إشعار ولا كتابة');
    await wait(5500);
    await cycleOf(c);
    t.eq([opened(st).length, m.sections_state._page], [1, undefined], '**والدورة الجاية أرسلت «فتحت» وكتبت الحالة**');
    c.kill('SIGKILL');
  },

  async courseNoBase(t) {
    const DB = base(); user(DB, 1);
    const m = courseMon(DB, 1, null, Date.now() - 20000);
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([msgsTo(st, 901).length, m.sections_state], [0, { 30011: 'OPEN', 40011: 'CLOSE' }],
      'بلا أساس (صفحة قديمة): أول دورة تسجيل وبس — كما كان');
    c.kill('SIGKILL');
  },

  async old(t) {
    const DB = base(); user(DB, 1); const m = watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq(opened(st).length, 0, 'مراقبة قديمة والشعبة مقفلة: ولا شي');
    st.pmu.M1 = [row('30011', 'OPEN')];
    await cycleOf(c);
    t.eq([opened(st).length, m.last_status], [1, 'OPEN'], 'فتحت: إشعار — كما كان');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`المراقبة الجديدة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
