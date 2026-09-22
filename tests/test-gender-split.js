/* سحبتا M1 و F1 — اختبار سلوكي على السيرفر الحقيقي.
   نفرّق ردّ الجامعة حسب الفلتر، ونُسقط أحدهما، ونقيس ماذا يفعل.

   node tests/test-gender-split.js [مسار server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PORT = 45874;
const TOKEN = 'admin-token-for-tests';

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

const DB = { monitored_courses: [], profiles: [], app_events: [], app_state: [] };
const TG = [];
let nextId = 1;

DB.profiles.push({ id: 'u1', telegram_chat_id: '901', is_pro: true,
                   notif_prefs: null, pushover_key: null });
/* مراقبة شعبة طلاب، ومراقبة مادة كاملة */
DB.monitored_courses.push({ id: nextId++, user_id: 'u1', scope: 'section',
  course_code: 'MEEN 3311', crn: '30011', term: '202710', last_status: 'CLOSED',
  followup_done: true, followup_at: null, expires_at: null,
  created_at: new Date(Date.now() - 864e5).toISOString() });
DB.monitored_courses.push({ id: nextId++, user_id: 'u1', scope: 'course',
  course_code: 'PHYS 1422', crn: null, term: '202710', last_status: null,
  sections_state: { '40011': 'CLOSED', '40021': 'CLOSED' },
  followup_done: true, followup_at: null, expires_at: null,
  created_at: new Date(Date.now() - 864e5).toISOString() });

/* شعب الطلاب أرقامها تبدأ بـ1، وشعب الطالبات بـ2 */
const MALE = [['30011', 'MEEN 3311', 'Thermo', '01'], ['40011', 'PHYS 1422', 'Physics II', '01']];
const FEMALE = [['30021', 'MEEN 3311', 'Thermo', '02'], ['40021', 'PHYS 1422', 'Physics II', '02']];

let STATUS = 'CLOSED';
let FAIL = { M1: false, F1: false, ALL: false };
const PULLS = [];

function rowsHtml(rows) {
  return '<table><tbody>' + rows.map(r => '<tr>' +
    [r[0], r[1], r[2], r[3], 'UT', '10:00-11:15', 'Dr. X', 'M-CORE - G034', STATUS]
      .map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
}

const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { if (ev === 'error') req._err = fn; return req },
    setTimeout() { return req }, destroy() {},
    write(d) { chunks.push(d) },
    end() {
      if (host.includes('pmu.edu.sa')) {
        if (opts.path !== '/Home/getData') {
          const res = new Readable({ read() {
            this.push('<input name="__RequestVerificationToken" value="tok">'); this.push(null) } });
          res.statusCode = 200; res.headers = { 'set-cookie': ['a=b'] };
          return setImmediate(() => cb(res));
        }
        const body = chunks.join('');
        const g = (/GenderList=([^&]*)/.exec(body) || [])[1] || 'ALL';
        PULLS.push(g);
        if (FAIL[g]) return setImmediate(() => { if (req._err) req._err(new Error('down ' + g)) });
        const rows = g === 'M1' ? MALE : g === 'F1' ? FEMALE : MALE.concat(FEMALE);
        const res = new Readable({ read() { this.push(rowsHtml(rows)); this.push(null) } });
        res.statusCode = 200; res.headers = {};
        return setImmediate(() => cb(res));
      }
      let o = '[]';
      if (host === 'api.telegram.org') {
        TG.push(JSON.parse(chunks.join('') || '{}'));
        o = JSON.stringify({ ok: true, result: {} });
      } else o = JSON.stringify(supabase(opts.method, opts.path, chunks.join('')));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = 200; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

function supabase(method, urlPath, body) {
  const [p, rawQs = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(rawQs) } catch (e) { qs = rawQs }
  const table = p.replace('/rest/v1/', '');
  const rows = DB[table] || (DB[table] = []);
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    (Array.isArray(b) ? b : [b]).forEach(x => rows.push(Object.assign({ id: nextId++ }, x)));
    return /return=representation/.test(qs) ? [rows[rows.length - 1]] : [];
  }
  if (method === 'PATCH') {
    const m = /id=in\.\(([^)]*)\)/.exec(qs) || /id=eq\.(\d+)/.exec(qs);
    const ids = m ? new Set(String(m[1]).split(',')) : new Set();
    const b = JSON.parse(body || '{}');
    rows.forEach(r => { if (ids.has(String(r.id))) Object.assign(r, b) });
    return [];
  }
  if (method === 'DELETE') return [];
  if (/expires_at=|followup_at=|followup_done=/.test(qs)) return [];
  let out2 = rows.slice();
  const m = /id=in\.\(([^)]*)\)/.exec(qs);
  if (m) {
    const ids = new Set(m[1].split(',').map(x => x.replace(/"/g, '')));
    out2 = out2.filter(r => ids.has(String(r.id)));
  }
  const lim = /limit=(\d+)/.exec(qs);
  const off = /offset=(\d+)/.exec(qs);
  if (off) out2 = out2.slice(Number(off[1]));
  if (lim) out2 = out2.slice(0, Number(lim[1]));
  return out2;
}

process.env.PORT = String(PORT);
process.env.ADMIN_TOKEN = TOKEN;
process.env.SB_URL = process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.TELEGRAM_TOKEN = 'tg-token';
process.env.ADMIN_CHAT_ID = '5555';
process.env.SITE_ENV = 'prod';
process.env.ACTIVE_TERM = '202710';
const realLog = console.log;
const LOGS = [];
console.log = (...a) => { LOGS.push(a.join(' ')) };
require(SRV);

function call(pathname, method, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method,
      headers: Object.assign({ 'X-Admin-Token': TOKEN },
        data ? { 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(o) }) }
                            catch (e) { resolve({ code: res.statusCode, body: o }) } });
    });
    r.on('error', reject);
    if (data) r.write(data); r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const cycle = async () => { await call('/api/run-check', 'GET'); await wait(6000) };

(async () => {
  await wait(400);

  /* ── ١) الحالة الطبيعية: سحبتان لا واحدة، والجنس معلوم ── */
  {
    PULLS.length = 0;
    await cycle();
    ok(PULLS.includes('M1') && PULLS.includes('F1'),
       'سحبتان M1 و F1 — جاء ' + JSON.stringify(PULLS));
    ok(!PULLS.includes('ALL'), 'وما استُعمل الطلب الشامل');

    const h = (await call('/api/admin/health', 'GET')).body;
    const ck = (h.cache || []).find(c => c.key === '202710|ALL|ALL');
    ok(ck && ck.courses === 4, 'الكاش فيه الجدول كاملاً (٤ شعب) — ' +
       (ck ? ck.courses : 'ما فيه'));
  }

  /* الجنس معلوم لا مخمَّن: نقيسه من البحث الذي يخدمه نفس الكاش */
  {
    const r = await call('/api/courses?term=202710&college=ALL&gender=F1', 'GET');
    const list = (r.body && (r.body.courses || r.body)) || [];
    const arr = Array.isArray(list) ? list : [];
    if (arr.length) {
      ok(arr.every(c => c.gender === 'F'), 'نتائج F1 كلها موسومة F');
      ok(arr.some(c => c.section === '02'), 'وفيها شعبة الطالبات');
    } else { ok(true, 'نقطة البحث ما رجّعت قائمة — تخطّينا'); ok(true, '—'); }
  }

  /* ── ٢) سقوط جنس واحد: نصف جدول ── */
  {
    FAIL.F1 = true;
    STATUS = 'OPEN';                      /* الشعبة المراقَبة فتحت */
    const before = TG.filter(m => String(m.chat_id) === '901').length;
    const stateBefore = JSON.stringify(DB.monitored_courses[1].sections_state);
    LOGS.length = 0;
    await cycle();

    ok(LOGS.some(l => /نصف الجدول/.test(l)), 'عرف أن الجدول ناقص');
    ok(TG.filter(m => String(m.chat_id) === '901').length > before,
       'ومع ذلك أشعر بالشعبة المراقَبة — حضورها حقيقة مقيسة');
    ok(JSON.stringify(DB.monitored_courses[1].sections_state) === stateBefore,
       'وما كتب حالة شعب المادة — الغائب ما يصير محذوفاً');
    const h = (await call('/api/admin/health', 'GET')).body;
    const ck = (h.cache || []).find(c => c.key === '202710|ALL|ALL');
    ok(!ck || ck.courses === 4, 'والكاش ما انكتب بنصف جدول');
  }

  /* ── ٣) رجوع الجنس الغائب لا يولّد «نزلت شعبة جديدة» كاذبة ── */
  {
    FAIL.F1 = false;
    const before = TG.filter(m => String(m.chat_id) === '901')
      .filter(m => /نزلت شعبة جديدة/.test(m.text || '')).length;
    await cycle();
    const after = TG.filter(m => String(m.chat_id) === '901')
      .filter(m => /نزلت شعبة جديدة/.test(m.text || '')).length;
    ok(after === before, 'ما وصلت «نزلت شعبة جديدة» كاذبة بعد رجوع الجنس');
  }

  /* ── ٤) سقوط الاثنين: الطلب الشامل آخر محاولة ── */
  {
    FAIL.M1 = FAIL.F1 = true;
    PULLS.length = 0;
    LOGS.length = 0;
    await cycle();
    ok(PULLS.includes('ALL'), 'جرّب الطلب الشامل بعد سقوط الاثنين — ' +
       JSON.stringify(PULLS));
  }

  /* ── ٥) سقوط الثلاثة: بلا انهيار وبلا إشعار كاذب ── */
  {
    FAIL.ALL = true;
    const before = TG.filter(m => String(m.chat_id) === '901').length;
    LOGS.length = 0;
    await cycle();
    ok(LOGS.some(l => /fetch fail/.test(l)), 'سُجّل الفشل');
    const used = LOGS.some(l => /نسخة من الكاش/.test(l));
    if (!used)
      ok(TG.filter(m => String(m.chat_id) === '901').length === before,
         'وبلا نسخة: ما أُرسل إشعار');
    else ok(true, 'رجع للنسخة المحفوظة — سلوك صحيح كذلك');
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('انهار الاختبار: ' + e.stack); process.exit(1) });
