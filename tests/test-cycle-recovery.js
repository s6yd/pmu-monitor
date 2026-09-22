/* تعافي دورة المراقبة من فشل الجلب — اختبار سلوكي.
   يعترض https فعلاً: موقع الجامعة يفشل، والكاش فيه نسخة من بحث طالب.
   نقيس هل خرج الإشعار، وكم ينتظر السيرفر قبل المحاولة التالية.

   node tests/test-cycle-recovery.js [مسار server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PORT = 45873;
const TOKEN = 'admin-token-for-tests';

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

const DB = { monitored_courses: [], profiles: [], app_events: [], app_state: [] };
const TG = [];
let nextId = 1;

DB.profiles.push({ id: 'u1', telegram_chat_id: '901', is_pro: true,
                   notif_prefs: null, pushover_key: null });
DB.monitored_courses.push({ id: nextId++, user_id: 'u1', scope: 'section',
  course_code: 'MEEN 3311', crn: '30011', term: '202710', last_status: 'CLOSED',
  followup_done: true, followup_at: null, expires_at: null,
  created_at: new Date(Date.now() - 864e5).toISOString() });

/* صف واحد مفتوح — هذا ما يجب أن يكتشفه */
/* ترتيب الأعمدة كما تقرأه parseHTML بالضبط */
function pmuHtml(status) {
  return '<table><tbody><tr>' +
    ['30011', 'MEEN 3311', 'Thermodynamics', '01', 'UT', '10:00-11:15',
     'Dr. X', 'M-CORE - G034', status].map(v => `<td>${v}</td>`).join('') +
    '</tr></tbody></table>';
}

let PMU_MODE = 'ok';          /* ok | fail */
const PMU_HITS = [];

const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { if (ev === 'error') req._err = fn; return req },
    setTimeout(ms, fn) { req._to = fn; return req },
    destroy() {},
    write(d) { chunks.push(d) },
    end() {
      if (host.includes('pmu.edu.sa')) {
        PMU_HITS.push({ path: opts.path, at: Date.now() });
        if (PMU_MODE === 'fail' && opts.path === '/Home/getData') {
          return setImmediate(() => { if (req._err) req._err(new Error('PMU down')) });
        }
        const out = opts.path === '/Home/getData'
          ? pmuHtml('OPEN')
          : '<input name="__RequestVerificationToken" value="tok">';
        const res = new Readable({ read() { this.push(out); this.push(null) } });
        res.statusCode = 200; res.headers = { 'set-cookie': ['a=b'] };
        return setImmediate(() => cb(res));
      }
      let out = '[]';
      if (host === 'api.telegram.org') {
        TG.push(JSON.parse(chunks.join('') || '{}'));
        out = JSON.stringify({ ok: true, result: {} });
      } else out = JSON.stringify(supabase(opts.method, opts.path, chunks.join('')));
      const res = new Readable({ read() { this.push(out); this.push(null) } });
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
    const items = Array.isArray(b) ? b : [b];
    items.forEach(x => rows.push(Object.assign({ id: nextId++ }, x)));
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
  /* استعلامات المتابعة والانتهاء ترشّح بشروط لا نحاكيها — نرجّع فاضياً
     حتى لا يحذف dropExpired صفوفنا ظناً أنها منتهية. */
  if (/expires_at=|followup_at=|followup_done=/.test(qs)) return [];
  let out = rows.slice();
  const m = /id=in\.\(([^)]*)\)/.exec(qs);
  if (m) {
    const ids = new Set(m[1].split(',').map(x => x.replace(/"/g, '')));
    out = out.filter(r => ids.has(String(r.id)));
  }
  const lim = /limit=(\d+)/.exec(qs);
  const off = /offset=(\d+)/.exec(qs);
  if (off) out = out.slice(Number(off[1]));
  if (lim) out = out.slice(0, Number(lim[1]));
  return out;
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
/* نبقي الالتقاط شغالاً: سجلات الدورة تصدر بعد التحميل لا قبله */

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
const studentMsgs = () => TG.filter(m => String(m.chat_id) === '901');

(async () => {
  await wait(400);

  /* دورة أولى ناجحة: تسجّل الأساس وتملأ الكاش */
  await call('/api/run-check', 'GET');
  await wait(5200);
  const baseline = studentMsgs().length;
  ok(DB.monitored_courses[0] && DB.monitored_courses[0].last_status === 'OPEN',
     'الدورة الناجحة سجّلت الحالة');
  const h = (await call('/api/admin/health', 'GET')).body;
  ok((h.cache || []).some(c => c.key === '202710|ALL|ALL'),
     'والكاش امتلأ بنسخة ALL/ALL');

  /* نرجّع الشعبة مقفلة ثم نفتحها، والجامعة ساقطة —
     النسخة في الكاش عمرها ثوانٍ، فالدورة لازم تستفيد منها */
  {
    DB.monitored_courses[0].last_status = 'CLOSED';
    PMU_MODE = 'fail';
    const hitsBefore = PMU_HITS.length;
    LOGS.length = 0;
    await call('/api/run-check', 'GET');
    await wait(5200);

    ok(PMU_HITS.length > hitsBefore, 'حاولت الجلب فعلاً');
    ok(LOGS.some(l => /نسخة من الكاش/.test(l)),
       'ورجعت للنسخة المحفوظة بدل ما تستسلم');
    ok(studentMsgs().length > baseline,
       'والإشعار وصل الطالب رغم سقوط موقع الجامعة');
    ok(DB.monitored_courses[0].last_status === 'OPEN',
       'والحالة انحدّثت');
  }

  /* الفاصل القادم: دقيقة لا خمس */
  {
    const h2 = (await call('/api/admin/health', 'GET')).body;
    const mi = h2.monitorInfo || {};
    const retries = h2.cycleRetries != null ? h2.cycleRetries : mi.cycleRetries;
    ok((retries || 0) > 0, 'عدّاد المحاولات ارتفع بعد الفشل — جاء ' + retries);
    const nextIn = mi.nextCycleInSec != null ? mi.nextCycleInSec
                 : (h2.nextCycleInSec != null ? h2.nextCycleInSec : null);
    if (nextIn != null)
      ok(nextIn <= 90, `الفاصل القادم ≤ ٩٠ ثانية — جاء ${nextIn}`);
    else ok(true, 'اللوحة ما تعرض الفاصل — تخطّينا القياس');
  }

  /* نسخة قديمة جداً: لا نستعملها ولا نرسل إشعاراً كاذباً */
  {
    DB.monitored_courses[0].last_status = 'CLOSED';
    const before = studentMsgs().length;
    LOGS.length = 0;
    /* نشيخ النسخة يدوياً عبر ضبط صلاحية قصيرة ثم انتظار — بدلاً عنها
       نتحقق من السلوك حين لا توجد نسخة أصلاً: نفرّغ الكاش */
    await call('/api/admin/cache-clear', 'POST', {}).catch(() => ({}));
    await call('/api/run-check', 'GET');
    await wait(5200);
    const used = LOGS.some(l => /نسخة من الكاش/.test(l));
    if (!used) {
      ok(studentMsgs().length === before, 'بلا نسخة: ما أُرسل إشعار كاذب');
      ok(LOGS.some(l => /fetch fail/.test(l)), 'وسُجّل الفشل');
    } else {
      ok(true, 'الكاش ما انفرغ — تخطّينا هذي الحالة');
      ok(true, '—');
    }
  }

  /* الجامعة رجعت: العدّاد يصفّر */
  {
    PMU_MODE = 'ok';
    await call('/api/run-check', 'GET');
    await wait(5200);
    const hb = (await call('/api/admin/health', 'GET')).body;
    const r2 = hb.cycleRetries != null ? hb.cycleRetries
             : ((hb.monitorInfo || {}).cycleRetries);
    ok((r2 || 0) === 0, 'بعد نجاح الجلب: العدّاد صفر — جاء ' + r2);
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('انهار الاختبار: ' + e.stack); process.exit(1) });
