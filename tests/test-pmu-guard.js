/* حدود ما يوصل موقع الجامعة — اختبار سلوكي على السيرفر الحقيقي.
   موقع الجامعة مصدرنا الوحيد، وأي ضغط زائد عليه يعرّضنا للحجب. فما يوصله إلا:
   ١) الفحص اليدوي (`/api/run-check`) **برمز اللوحة**، ومن نسخة المراقبة وحدها —
      القاعدة مشتركة مع dev، فدورة منه تكتب حالات الإنتاج وترسل لطلابه.
   ٢) بحث **بقيم قوائم الصفحة وحدها** (ترم · كلية · جنس) — كل تركيبة جديدة سحبة.
   ٣) سحب البحث **بسقف بالدقيقة**: فوقه آخر نسخة عندنا (X-Stale)، وبلاها «زحمة»
      ٥٠٣ — لا سحب. ودورة المراقبة خارج السقف.

   node tests/test-pmu-guard.js [server.js]
   (يشغّل نفسه لـdev وللسقف كعمليات مستقلة — البيئة والعدّادات تُقرأ عند الإقلاع) */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Readable } = require('stream');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=prod').slice(7);

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${MODE}] ` + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ═══ موقع الجامعة المزيّف — صفحة الرمز ثم الجدول، بترتيب أعمدة parseHTML ═══ */
const PMU = [];                                   /* كل طلب وصل الجامعة */
const ROWS = {
  M1: [['30011', 'MEEN 3311', 'Thermodynamics', '101', 'UT', '0930 - 1045', 'Smith, John', 'M-CORE - G034', 'OPEN']],
  F1: [['40011', 'MEEN 3311', 'Thermodynamics', '201', 'UT', '0930 - 1045', 'Lee, Sara', 'F-CORE - 101', 'CLOSED']]
};
const table = g => '<table><tbody>' + (g === 'F1' ? ROWS.F1 : g === 'M1' ? ROWS.M1 : ROWS.M1.concat(ROWS.F1))
  .map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
const fetches = () => PMU.filter(x => x.path === '/Home/getData');

/* ═══ القاعدة المزيّفة ═══ */
const DB = { monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  /* نبدأ والمراقبة موقوفة من اللوحة: ما تشتغل دورة مجدولة لو انشغّل الاختبار وقت نافذة —
     الفحص اليدوي يبقى شغّالاً (قرارك أنت) */
  app_state: [{ key: MODE === 'dev' ? 'runtime-dev' : 'runtime', value: { toggles: { monitorPaused: true } } }] };
let nextId = 1;
function filt(rows, qs) {
  let r = rows.slice();
  for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=(eq|neq|lt|lte|gt|gte|in|is|not\.is)\.([^&]*)/g)) {
    const [, col, op, v] = m;
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    r = r.filter(x => {
      const a = x[col];
      if (op === 'eq') return a != null && String(a) === v;
      if (op === 'neq') return a == null || String(a) !== v;
      if (op === 'is') return v === 'null' ? a == null : String(a) === v;
      if (op === 'not.is') return v === 'null' ? a != null : String(a) !== v;
      if (op === 'in') return new Set(v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, ''))).has(String(a));
      if (a == null) return false;
      const A = Date.parse(a), V = Date.parse(v);
      const c = Number.isFinite(A) && Number.isFinite(V) ? A - V : (String(a) < v ? -1 : String(a) > v ? 1 : 0);
      return op === 'lt' ? c < 0 : op === 'lte' ? c <= 0 : op === 'gt' ? c > 0 : c >= 0;
    });
  }
  return r;
}
function supabase(method, urlPath, body) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') return [];
    (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: nextId++ }, x)));
    return [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(list, qs);
    hit.forEach(x => Object.assign(x, b));
    return hit.map(x => Object.assign({}, x));
  }
  if (method === 'DELETE') {
    const hit = filt(list, qs);
    DB[table] = list.filter(x => !hit.includes(x));
    return hit;
  }
  let r = filt(list, qs);
  const off = /(?:^|&)offset=(\d+)/.exec(qs), lim = /(?:^|&)limit=(\d+)/.exec(qs);
  if (off) r = r.slice(Number(off[1]));
  return r.slice(0, lim ? Number(lim[1]) : 1000).map(x => Object.assign({}, x));   /* PostgREST يقصّ عند ١٠٠٠ */
}

const TG = [];
const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { if (ev === 'error') req._err = fn; return req },
    setTimeout() { return req }, destroy() {},
    write(d) { chunks.push(d) },
    end() {
      const raw = chunks.join('');
      let res;
      if (host === 'masterschedule.pmu.edu.sa') {
        const q = new URLSearchParams(raw);
        PMU.push({ path: opts.path, term: q.get('TermList'), college: q.get('CollegeList'), gender: q.get('GenderList') });
        const body = opts.path === '/Home/getData' ? table(q.get('GenderList'))
          : '<input name="__RequestVerificationToken" type="hidden" value="tok">';
        res = [200, body, { 'set-cookie': ['a=b; path=/'] }];
      } else if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(raw) } catch (e) {}
        if (/sendMessage$/.test(opts.path)) TG.push({ chat: String(b.chat_id), text: String(b.text || '') });
        res = [200, { ok: true, result: { message_id: 1 } }];
      } else if (host.endsWith('supabase.co'))
        res = [200, supabase(opts.method, opts.path, raw)];
      else res = [200, { status: 1 }];
      const [code, b, headers] = res;
      const text = typeof b === 'string' ? b : JSON.stringify(b);
      const r = new Readable({ read() { this.push(text); this.push(null) } });
      r.statusCode = code; r.headers = headers || {};
      setImmediate(() => cb(r));
    }
  };
  return req;
};

const BASES = { prod: 22200, dev: 24400, cap: 24500 };
const PORT = BASES[MODE] + (process.pid % 100), ADMIN = 'admin-token-for-pmu-guard';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: ADMIN, SITE_ENV: MODE === 'dev' ? 'dev' : 'prod', ACTIVE_TERM: '202710',
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(p, { token, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({}, token ? { 'X-Admin-Token': token } : {},
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let o = ''; res.setEncoding('utf8'); res.on('data', c => o += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(o) } catch (e) {}
        resolve({ code: res.statusCode, j, headers: res.headers }) });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const search = (term, college, gender) => call('/api/courses?' + [term != null ? 'term=' + term : '',
  college != null ? 'college=' + college : '', gender != null ? 'gender=' + gender : ''].filter(Boolean).join('&'));
const student = () => TG.filter(m => m.chat === '901');
const admin = re => TG.filter(m => m.chat === '5555' && re.test(m.text));

/* طالب يراقب شعبة مقفلة عندنا ومفتوحة في الجامعة — دورة واحدة تكفي لإشعاره */
function watcher() {
  DB.profiles.push({ id: 'u1', telegram_chat_id: '901', is_pro: false, subscription_expires_at: null,
    pushover_key: null, pushover_until: null });
  DB.monitored_courses.push({ id: nextId++, user_id: 'u1', scope: 'section', course_code: 'MEEN 3311', crn: '30011',
    term: '202710', last_status: 'CLOSED', followup_done: true, followup_at: null, expires_at: null,
    sections_state: null, created_at: new Date(Date.now() - 864e5).toISOString() });
}
/* قيم قوائم البحث في الصفحة نفسها */
function pageOptions(id) {
  const html = fs.readFileSync(path.join(path.dirname(SRV), 'pmu-schedule.html'), 'utf8');
  const m = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return m ? [...m[1].matchAll(/<option value="([^"]*)"/g)].map(x => x[1]) : [];
}

async function prod() {
  watcher();
  await wait(500);                                  /* استعادة الحالة */

  /* ── ١) الفحص اليدوي برمز اللوحة ── */
  let r = await call('/api/run-check');
  eq([r.code, r.j && r.j.started], [401, false], '**الفحص اليدوي بلا رمز اللوحة: مرفوض (٤٠١)**');
  r = await call('/api/run-check', { token: 'wrong-token-xxxxxxxx' });
  eq(r.code, 401, 'وبرمز غلط: مرفوض');
  await wait(4500);
  eq([PMU.length, student().length], [0, 0], '**وما وصل الجامعة ولا طلب، ولا راح للطالب شي**');
  r = await call('/api/run-check', { token: ADMIN });
  eq([r.code, r.j && r.j.started], [200, true], 'برمز اللوحة: بدأت الدورة');
  await wait(4500);
  ok(fetches().length >= 2, 'سحبت الجدول من الجامعة (طلاب وطالبات) — ' + fetches().length);
  ok(student().length === 1 && /الشعبة اللي تبيها فتحت/.test(student()[0].text), 'والطالب وصله إشعار الفتحة');

  /* ── ٢) البحث بقيم قوائم الصفحة وحدها ── */
  let n0 = PMU.length;
  for (const [t, c, g, why] of [
    ['209910', 'ALL', 'ALL', 'ترم مخترع'],
    ['202310', 'ALL', 'ALL', 'ترم قديم خارج المدى'],
    ['202910', 'ALL', 'ALL', 'ترم بعيد خارج المدى'],
    ['202740', 'ALL', 'ALL', 'رمز ترم مو 10/20/30'],
    ['2027100', 'ALL', 'ALL', 'رقم أطول'],
    ['abc', 'ALL', 'ALL', 'نص'],
    ['', 'ALL', 'ALL', 'ترم فاضي'],
    ['202710', 'XX', 'ALL', 'كلية مو في القائمة'],
    ['202710', 'ALL%3BX', 'ALL', 'كلية فيها رموز'],
    ['202710', 'ALL', 'M2', 'جنس مو في القائمة']]) {
    r = await search(t, c, g);
    eq([r.code, r.j && r.j.success], [400, false], `${why} ⇒ ٤٠٠`);
  }
  eq(PMU.length - n0, 0, '**والمرفوض ما وصل الجامعة ولا طلب**');

  /* كل خيار في قوائم الصفحة مقبول — لو انضاف ترم أو كلية للصفحة بلا السيرفر، يطيح هنا */
  const terms = pageOptions('term'), colleges = pageOptions('college'), genders = pageOptions('gender');
  ok(terms.length >= 6 && colleges.length >= 9 && genders.length === 3,
     `قرينا قوائم الصفحة — ${terms.length} ترمات · ${colleges.length} كليات · ${genders.length} أجناس`);
  const bad = [];
  for (const t of terms) { r = await search(t, 'ALL', 'ALL'); if (r.code !== 200 || !r.j.success) bad.push('term ' + t) }
  for (const c of colleges) { r = await search('202710', c, 'ALL'); if (r.code !== 200 || !r.j.success) bad.push('college ' + c) }
  for (const g of genders) { r = await search('202710', 'ALL', g); if (r.code !== 200 || !r.j.success) bad.push('gender ' + g) }
  eq(bad, [], '**كل ترم وكلية وجنس في قوائم الصفحة: البحث يشتغل**');
  r = await search('202710', 'ALL', 'M1');
  ok(r.code === 200 && r.j.count === 1 && r.j.courses[0].crn === '30011', 'والنتيجة من الجامعة كما هي');

  /* بلا ترم: ترم الدراسة (كان 202630 ثابتاً — يطلع من المدى مع الوقت) */
  n0 = fetches().length;
  r = await search(null, 'EN', 'F1');
  const last = fetches().slice(n0);
  eq([r.code, last.length && last[0].term], [200, '202710'], 'بحث بلا ترم: ترم الدراسة');
}

async function dev() {
  watcher();
  await wait(500);
  let r = await call('/api/run-check', { token: ADMIN });
  eq([r.code, r.j && r.j.started], [403, false],
     '**dev: الفحص اليدوي مرفوض حتى برمز اللوحة** — القاعدة مشتركة مع الإنتاج');
  ok(/معطّلة/.test((r.j && r.j.error) || ''), 'ويقول ليش');
  r = await call('/api/run-check');
  eq(r.code, 401, 'وبلا رمز: ٤٠١');
  await wait(4500);
  eq([PMU.length, student().length, DB.monitored_courses[0].last_status], [0, 0, 'CLOSED'],
     '**dev ما سحب من الجامعة، ولا أرسل لطالب، ولا لمس حالة الإنتاج**');
}

async function cap() {
  watcher();
  await wait(500);
  /* صلاحية الكاش دقيقة (أقل ما تسمح به اللوحة) — عشان نلقى نسخة منتهية */
  await call('/api/admin/cache-ttl', { token: ADMIN, method: 'POST', body: { min: 1 } });
  let r = await search('202710', 'ALL', 'ALL');
  eq(r.code, 200, 'بحث أول: انسحب');
  await wait(61500);                                /* انتهت صلاحيته، والسقف رجع فاضي */

  /* ٢٠ تركيبة صحيحة جديدة في نفس الدقيقة = السقف */
  const combos = [];
  for (const t of ['202610', '202620', '202630', '202720', '202730'])
    for (const c of ['EN', 'IT', 'BA', 'CS']) combos.push([t, c, 'M1']);
  const n0 = fetches().length;
  let okN = 0;
  for (const [t, c, g] of combos.slice(0, 20)) { r = await search(t, c, g); if (r.code === 200) okN++ }
  eq([okN, fetches().length - n0], [20, 20], '٢٠ تركيبة جديدة في دقيقة: كلها انسحبت');

  /* ٢١: تركيبة جديدة فوق السقف — «زحمة» بلا سحب */
  const n1 = PMU.length;
  r = await search('202620', 'SH', 'F1');
  eq([r.code, r.j && r.j.success, r.headers['retry-after']], [503, false, '60'],
     '**فوق السقف وبلا نسخة: ٥٠٣ «جرّب بعد دقيقة»**');
  ok(/مزحوم/.test((r.j && r.j.error) || ''), 'برسالة مفهومة');
  /* والمنتهية: آخر نسخة عندنا بدل سحب جديد */
  r = await search('202710', 'ALL', 'ALL');
  eq([r.code, r.j && r.j.success, r.headers['x-stale']], [200, true, '1'],
     '**فوق السقف وعندنا نسخة منتهية: نخدمها (X-Stale) بدل ما نسحب**');
  for (let i = 0; i < 5; i++) await search('202620', 'MT', 'F1');
  eq(PMU.length - n1, 0, '**وكل هذا ما وصل الجامعة ولا طلب**');
  eq(admin(/البحث وصل سقف السحب من الجامعة/).length, 1, 'ونبّهناك مرة وحدة — مو مع كل طلب');
  eq(admin(/البحث ما يشتغل/).length, 0, 'والسقف مو «عطل في البحث» — ما يوصلك إنذار عطل');

  /* دورة المراقبة خارج السقف */
  const n2 = fetches().length;
  r = await call('/api/run-check', { token: ADMIN });
  await wait(4500);
  ok(r.code === 200 && fetches().length - n2 >= 2, '**دورة المراقبة تسحب حتى والبحث عند سقفه**');
  ok(student().length === 1, 'وإشعار الفتحة وصل');
}

function child(mode) {
  return new Promise(resolve => {
    const c = fork(__filename, [SRV, '--mode=' + mode], { silent: true });
    let o = '';
    c.stdout.on('data', d => o += d);
    c.on('exit', () => resolve([mode, o]));
  });
}

(async () => {
  const kids = MODE === 'prod' ? Promise.all([child('dev'), child('cap')]) : null;
  try {
    await wait(300);
    if (MODE === 'prod') await prod(); else if (MODE === 'dev') await dev(); else await cap();
  } catch (e) {
    fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e));
  }
  if (kids) for (const [mode, o] of await kids) {
    const m = /(\d+) نجحت · (\d+) فشلت/.exec(o);
    if (m) { pass += +m[1]; fail += +m[2] } else { fail++; out.push(`  ✗ [${mode}] ما رجع نتيجة`) }
    for (const l of o.split('\n')) if (/✗/.test(l)) out.push(l);
  }
  console.log = realLog;
  if (out.length) console.log(out.join('\n'));
  console.log(`حدود الجامعة: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
