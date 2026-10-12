/* الإشعار ما يضيع ولا يتكرر — اختبار سلوكي بنسخ سيرفر حقيقية وقاعدة مشتركة.
   كانت الدورة تكتب «صارت مفتوحة» قبل الإرسال وما ترجع: رسالة رفضها تيليغرام مرة =
   إشعار ضاع للأبد. ونسختان شغّالتان معاً (وقت النشر) كل وحدة ترسل. هنا كل نسخة سيرفر
   عملية مستقلة، و«الخارج» (الجامعة · القاعدة · تيليغرام) خادم واحد مشترك في الأب:
   ١) amp     — «&» في اسم المادة: تيليغرام يرفض HTML غلط ⇒ نهرّب، والرسالة توصل.
   ٢) retry   — تيليغرام رفض مرة ⇒ الدورة الجاية تعيدها، ومرة وحدة.
   ٣) burst   — ثلاث شعب فتحت لنفس الطالب ⇒ ورا بعض، و«استنى» (429) نستناه.
   ٤) twin    — نسختان بنفس اللحظة ⇒ إشعار واحد (الحجز المشروط).
   ٥) sigterm — نشر وسط الإرسال ⇒ ننتظر الدورة تكمل، وكل الطلاب يوصلهم.
   ٦) giveup  — رسالة يرفضها تيليغرام دائماً ⇒ ثلاث محاولات وبس.
   ٧) twinCourse · courseRetry — نفس الحجز والإعادة لمراقبة المادة كاملة (حالتها JSON).
   ٨) longDeploy — نشر وسط إرسال طويل (٢٠٠ طالب) ⇒ الباقي يرجع محجوزاً والنسخة الجديدة ترسله.

   node tests/test-alert-delivery.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-alert-delivery';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(200) } return fn() }

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

/* ═══ «الخارج» لكل سيناريو: قاعدة PostgREST-ية + الجامعة + تيليغرام صارم مثل الحقيقي ═══ */
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
  /* or=(a.op.v,b.op.v) — صف يطابق أي شرط */
  const or = /(?:^|&)or=\(([^)]*)\)/.exec(qs);
  if (or) {
    const conds = or[1].split(',').map(c => /^([a-z_]+)\.(eq|neq|is|lt|gt)\.(.*)$/.exec(c)).filter(Boolean);
    r = r.filter(x => conds.some(([, col, op, v]) => test(x, col, op, v)));
  }
  return r;
}
const html = s => s.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('');
function makeOutside(o) {
  const st = { DB: o.DB, ROWS: o.ROWS, TG: [], tries: {}, last: {}, tg: o.tg || {}, nextId: 1000 };
  const tgHtmlOk = t => {
    const s = String(t).replace(/<\/?(b|i|u|s|code|pre)>/g, '').replace(/<a href="[^"]*">|<\/a>/g, '');
    return !/[<>]/.test(s) && !/&(?!(amp|lt|gt|quot|#\d+);)/.test(s);
  };
  st.server = http.createServer((req, res) => {
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
        return res.end('<table><tbody>' + html(g === 'F1' ? st.ROWS.F1 : st.ROWS.M1) + '</tbody></table>');
      }
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body) } catch (e) {}
        if (!/sendMessage$/.test(req.url)) return json(200, { ok: true, result: true });
        const chat = String(b.chat_id), now = Date.now();
        st.tries[chat] = (st.tries[chat] || 0) + 1;
        const cfg = st.tg;
        if (!tgHtmlOk(b.text)) return json(400, { ok: false, error_code: 400,
          description: "Bad Request: can't parse entities: unsupported start tag" });
        if (cfg.always400 === chat) return json(400, { ok: false, error_code: 400, description: 'Bad Request: message is too long' });
        if (cfg.failOnce === chat) { cfg.failOnce = null;
          return json(502, { ok: false, error_code: 502, description: 'Bad Gateway' }) }
        if (cfg.perChat && st.last[chat] && now - st.last[chat] < 1000)
          return json(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1',
            parameters: { retry_after: 1 } });
        st.last[chat] = now;
        st.TG.push({ chat, text: String(b.text || ''), at: now });
        if (cfg.delay) return setTimeout(() => json(200, { ok: true, result: { message_id: 1 } }), cfg.delay);
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

let PORTN = 49600 + (process.pid % 40);
function instance(st) {
  const port = PORTN++;
  /* الملف أول وسيط: النسخة تحمّل السيرفر اللي نختبره لا الحالي (إثبات الفشل على القديم) */
  const c = fork(__filename, [SRV, '--child', String(st.port), String(port)], { silent: true });
  c.exited = new Promise(r => c.on('exit', r));
  c.check = () => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/run-check', method: 'GET',
      headers: { 'X-Admin-Token': ADMIN } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) });
    r.on('error', () => resolve(0)); r.end();
  });
  return c;
}
const ready = async c => { for (let i = 0; i < 50; i++) { if (await c.check() === 200) return true; await wait(200) } return false };

/* ═══ البيانات ═══ */
const row = (crn, st, title, inst) => [crn, 'MEEN 3311', title || 'Thermodynamics', '101', 'UT', '0930 - 1045',
  inst || 'Smith, John', 'M-CORE - G034', st];
/* شعبة طالبات: بلاها «سحبة الطالبات فاضية» = نصف جدول، ومقارنة المادة كاملة تتخطّى */
const F1 = () => [['40011', 'MEEN 3311', 'Thermodynamics', '201', 'UT', '0930 - 1045', 'Lee, Sara', 'F-CORE - 101', 'CLOSED']];
const base = () => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const courseMon = (DB, n, state) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'course',
  course_code: 'MEEN 3311', crn: null, term: '202710', last_status: null, followup_done: true, followup_at: null,
  expires_at: null, sections_state: state, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const msgsTo = (st, chat) => st.TG.filter(m => m.chat === String(chat));
/* دورة كاملة: سحبتان من الجامعة بينهما ١٫٥ ثانية، ثم المعالجة والإرسال */
const cycleOf = async (c, ms = 5000) => { await c.check(); await wait(ms) };

const SCEN = {
  async amp(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN', 'Research & Design', "O'Neil & Sons")], F1: F1() } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const m = msgsTo(st, 901);
    t.eq(m.length, 1, '**اسم مادة فيه «&»: الرسالة وصلت** (كان تيليغرام يرفضها كلها)');
    t.ok(m[0] && m[0].text.includes('Research &amp; Design') && m[0].text.includes("O'Neil &amp; Sons"),
      'ونص الجامعة مهرّب');
    c.kill('SIGKILL');
  },
  async retry(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN')], F1: F1() }, tg: { failOnce: '901' } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    t.eq([msgsTo(st, 901).length, DB.monitored_courses[0].last_status], [0, 'CLOSED'],
      'تيليغرام رفض: ما وصل — والحجز رجع (CLOSED) عشان تعيده الدورة الجاية');
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, '**الدورة الجاية أعادتها ووصلت** — كانت تضيع للأبد');
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, 'ومرة وحدة — الدورة اللي بعدها ما كررت');
    c.kill('SIGKILL');
  },
  async burst(t) {
    const DB = base(); user(DB, 1);
    courseMon(DB, 1, { 30011: 'CLOSED', 30012: 'CLOSED', 30013: 'CLOSED', 40011: 'CLOSED' });
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN'), row('30012', 'OPEN'), row('30013', 'OPEN')], F1: F1() },
      tg: { perChat: true } });
    const c = instance(st); await ready(c);
    await cycleOf(c, 9000);
    const crns = msgsTo(st, 901).map(m => (/CRN: <code>(\d+)/.exec(m.text) || [])[1]).sort();
    t.eq(crns, ['30011', '30012', '30013'],
      '**ثلاث شعب فتحت لنفس الطالب: الثلاث وصلت** — ورا بعض، و«استنى» من تيليغرام نستناه');
    c.kill('SIGKILL');
  },
  async twin(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN')], F1: F1() } });
    const a = instance(st), b = instance(st);
    await Promise.all([ready(a), ready(b)]);
    await Promise.all([a.check(), b.check()]);
    await wait(6000);
    t.eq(msgsTo(st, 901).length, 1, '**نسختان شغّالتان بنفس اللحظة (وقت النشر): إشعار واحد** — كان اثنين');
    a.kill('SIGKILL'); b.kill('SIGKILL');
  },
  async sigterm(t) {
    const DB = base(), M1 = [];
    for (let n = 1; n <= 25; n++) { user(DB, n); watch(DB, n, String(30100 + n), 'CLOSED'); M1.push(row(String(30100 + n), 'OPEN')) }
    const st = await makeOutside({ DB, ROWS: { M1, F1: F1() }, tg: { delay: 1500 } });
    const c = instance(st); await ready(c);
    await c.check();
    await until(() => st.TG.length > 0, 15000);
    c.kill('SIGTERM');                                     /* نشر جديد وسط الإرسال */
    const t0 = Date.now();
    const exited = await Promise.race([c.exited.then(() => true), wait(35000).then(() => false)]);
    t.ok(exited && Date.now() - t0 < 30000, 'النسخة القديمة طلعت خلال مهلة Render (٣٠ ثانية)');
    const students = new Set(st.TG.filter(m => /الشعبة اللي تبيها فتحت/.test(m.text)).map(m => m.chat));
    t.eq(students.size, 25, '**نشر وسط الإرسال: الـ٢٥ طالب كلهم وصلهم** — كانت تطلع فوراً ويضيع الباقين');
    if (!exited) c.kill('SIGKILL');
  },
  async twinCourse(t) {
    const DB = base(); user(DB, 1); courseMon(DB, 1, { 30011: 'CLOSED', 40011: 'CLOSED' });
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN')], F1: F1() } });
    const a = instance(st), b = instance(st);
    await Promise.all([ready(a), ready(b)]);
    await Promise.all([a.check(), b.check()]);
    await wait(6000);
    t.eq(msgsTo(st, 901).length, 1, '**مراقبة المادة كاملة ونسختان بنفس اللحظة: إشعار واحد** — كان اثنين');
    a.kill('SIGKILL'); b.kill('SIGKILL');
  },
  async courseRetry(t) {
    const DB = base(); user(DB, 1); courseMon(DB, 1, { 30011: 'CLOSED', 40011: 'CLOSED' });
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN')], F1: F1() }, tg: { failOnce: '901' } });
    const c = instance(st); await ready(c);
    await cycleOf(c);
    const m = DB.monitored_courses[0];
    t.eq([msgsTo(st, 901).length, m.sections_state && m.sections_state['30011'], m.notified_at], [0, 'CLOSED', null],
      'المادة كاملة: تيليغرام رفض ⇒ الشعبة رجعت مقفلة في حالة المادة، و«آخر إشعار» ما تغيّر');
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, '**المادة كاملة: الدورة الجاية أعادتها ووصلت** — كانت تضيع للأبد');
    await cycleOf(c);
    t.eq(msgsTo(st, 901).length, 1, 'ومرة وحدة');
    c.kill('SIGKILL');
  },
  async longDeploy(t) {
    const DB = base(), M1 = [], N = 200;
    for (let n = 1; n <= N; n++) { user(DB, n); watch(DB, n, String(31000 + n), 'CLOSED'); M1.push(row(String(31000 + n), 'OPEN')) }
    const st = await makeOutside({ DB, ROWS: { M1, F1: F1() }, tg: { delay: 2000 } });
    const a = instance(st); await ready(a);
    await a.check();
    await until(() => st.TG.length > 0, 15000);
    a.kill('SIGTERM');                                     /* نشر جديد وسط إرسال ياخذ ~٣٠ ثانية */
    const t0 = Date.now();
    const exited = await Promise.race([a.exited.then(() => true), wait(35000).then(() => false)]);
    t.ok(exited && Date.now() - t0 < 30000, 'إرسال طويل: النسخة القديمة طلعت خلال مهلة Render (٣٠ ثانية)');
    if (!exited) a.kill('SIGKILL');
    const before = st.TG.length;
    t.ok(before < N, `الإرسال انقطع فعلاً قبل ما يكمل (${before} من ${N}) — وإلا الاختبار ما يقيس شي`);
    const b = instance(st); await ready(b);               /* النسخة الجديدة */
    await b.check();
    await until(() => st.TG.length >= N, 40000);
    await wait(3000);
    const chats = st.TG.filter(m => /الشعبة اللي تبيها فتحت/.test(m.text)).map(m => m.chat);
    t.eq([new Set(chats).size, chats.length], [N, N],
      '**نشر وسط إرسال طويل: الـ٢٠٠ كلهم وصلهم، وكل واحد مرة** — كان الباقي محجوزاً «مفتوحة» فما يوصله شي');
    b.kill('SIGKILL');
  },
  async giveup(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSED');
    const st = await makeOutside({ DB, ROWS: { M1: [row('30011', 'OPEN')], F1: F1() }, tg: { always400: '901' } });
    const c = instance(st); await ready(c);
    for (let i = 0; i < 4; i++) await cycleOf(c);
    t.eq(st.tries['901'] || 0, 3, '**رسالة يرفضها تيليغرام دائماً: ثلاث محاولات ثم نوقف** — لا مرة وتضيع، ولا كل دورة للأبد');
    t.eq(DB.monitored_courses[0].last_status, 'OPEN', 'وبعدها الحالة تبقى (ما نرجع نحاول)');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`الإشعار: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
