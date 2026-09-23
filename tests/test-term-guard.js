/* دفعة ٢ — الترم النشط والتحكم اليدوي.
   يشغّل server.js فعلاً ويعترض https: المسارات والحفظ والدورة كلها حقيقية.

   node tests/test-term-guard.js [مسار server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
/* المنفذ يتغيّر مع كل تشغيل: منفذ ثابت يبقى محجوزاً بعد انتهاء
   العملية (TIME_WAIT أو بقايا جلسة)، فيفشل التشغيل التالي بـEADDRINUSE
   والاختبار يطلع أحمر بلا علاقة بالكود. النطاق ١٠٠ لكل ملف فما يتصادمان. */
const PORT = 47100 + (process.pid % 100);
const TOKEN = 'admin-token-for-tests';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const DB = { monitored_courses: [], profiles: [], app_events: [], app_state: [] };
const PMU = [];                     /* كل سحبة من موقع الجامعة */
let nextId = 1;

DB.profiles.push({ id: 'u1', telegram_chat_id: '901', notif_prefs: null, is_pro: true });
[['202710', 'MEEN 3311'], ['202710', 'MEEN 3312'], ['202720', 'MEEN 4311'],
 ['202630', 'MEEN 2311']].forEach(([term, code]) => {
  DB.monitored_courses.push({ id: nextId++, user_id: 'u1', scope: 'section',
    course_code: code, crn: '3' + nextId, term, last_status: 'CLOSED',
    created_at: new Date(Date.now() - 864e5).toISOString() });
});

const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { return req }, setTimeout() { return req },
    write(d) { chunks.push(d) },
    end() {
      const body = chunks.join('');
      let out = '[]', code = 200;
      if (host === 'api.telegram.org') out = JSON.stringify({ ok: true, result: {} });
      else if (host.includes('pmu.edu.sa')) {
        PMU.push({ path: opts.path, body });
        out = '<html><table></table></html>';
      } else out = JSON.stringify(supabase(opts.method, opts.path, body));
      const res = new Readable({ read() { this.push(out); this.push(null) } });
      res.statusCode = code; res.headers = {};
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
    if (/merge-duplicates/.test(qs) || table === 'app_state') {
      const i = rows.findIndex(r => r.key === b.key);
      if (i >= 0) { rows[i] = b; return [] }
    }
    const row = Object.assign({ id: nextId++ }, b);
    rows.push(row);
    return /return=representation/.test(qs) ? [row] : [];
  }
  if (method === 'DELETE') {
    const m = /id=in\.\(([^)]*)\)/.exec(qs);
    const ids = m ? new Set(m[1].split(',')) : new Set();
    DB[table] = rows.filter(r => !ids.has(String(r.id)));
    return [];
  }
  if (method === 'PATCH') return [];
  let out = rows.slice();
  const key = /key=eq\.([^&]+)/.exec(qs);
  if (key) out = out.filter(r => r.key === key[1]);
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
const realLog = console.log; console.log = () => {};
require(SRV);
console.log = realLog;

function call(pathname, method, payload, token) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method,
      headers: Object.assign({ 'X-Admin-Token': token === undefined ? TOKEN : token },
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
const adm = (act, method, payload) => call('/api/admin/' + act, method || 'GET', payload);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(400);

  /* ── ١) الترم يُبدَّل من اللوحة ── */
  {
    let r = await adm('term-set');
    ok(r.body.term === '202710', 'الترم الابتدائي من Render');
    ok(r.body.custom === false, 'وما هو يدوي');

    r = await adm('term-set', 'POST', { term: '20272' });
    ok(r.code === 400, 'ترم بخمس خانات مرفوض');
    r = await adm('term-set', 'POST', { term: '202715' });
    ok(r.code === 400, 'لاحقة غير 10/20/30 مرفوضة');

    r = await adm('term-set', 'POST', { term: '202720' });
    ok(r.body.term === '202720' && r.body.custom === true, 'التبديل نجح وصار يدوياً');

    const st = await call('/api/monitor-status', 'GET');
    ok(st.body.term === '202720', 'والواجهة تشوف الترم الجديد');

    /* محفوظ في القاعدة فما يضيع مع النشر */
    const saved = DB.app_state.find(r2 => r2.key === 'runtime');
    ok(saved && saved.value.toggles.termOverride === '202720',
       'الترم محفوظ في app_state');

    await adm('term-set', 'POST', { reset: true });
    ok((await adm('term-set')).body.term === '202710', 'الرجوع لقيمة Render يشتغل');
  }

  /* ── ٢) النافذة والجرس ── */
  {
    let r = await adm('monitor-window', 'POST', { from: '2020-01-01', to: '2020-01-02' });
    ok(r.code === 200, 'ضبط نافذة منتهية');
    let st = await call('/api/monitor-status', 'GET');
    ok(st.body.canWatch === false, 'نافذة منتهية ⇒ الجرس مقفول');

    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    await adm('monitor-window', 'POST', { from: today, to: today });
    st = await call('/api/monitor-status', 'GET');
    ok(st.body.canWatch === true, 'نافذة اليوم ⇒ الجرس مفتوح');
    ok(st.body.window && st.body.window.from === today, 'والنافذة الحالية تظهر للواجهة');

    /* الإيقاف اليدوي يغلب النافذة */
    await adm('monitor-toggle', 'POST', { on: false });
    st = await call('/api/monitor-status', 'GET');
    ok(st.body.canWatch === false, 'الإيقاف اليدوي يقفل الجرس رغم النافذة');
    await adm('monitor-toggle', 'POST', { on: true });

    const saved = DB.app_state.find(r2 => r2.key === 'runtime');
    ok(saved && saved.value.toggles.windowOverride &&
       saved.value.toggles.windowOverride.from === today, 'النافذة محفوظة');

    r = await adm('monitor-window', 'POST', { from: '2027-01-08', to: '2027-01-02' });
    ok(r.code === 400, 'نهاية قبل البداية مرفوضة');
    r = await adm('monitor-window', 'POST', { from: '08-01-2027', to: '2027-01-20' });
    ok(r.code === 400, 'صيغة تاريخ غلط مرفوضة');
  }

  /* ── ٣) الدورة تسحب الترم النشط وحده ── */
  {
    PMU.length = 0;
    const before = DB.monitored_courses.length;
    const r = await adm('run-cycle', 'POST', {});
    ok(r.code === 200 || r.code === 404, 'نداء الدورة رجع رداً');
    await wait(4000);
    const terms = PMU.map(x => (/TermList=(\d+)/.exec(x.body || '') || [])[1]).filter(Boolean);
    const uniq = [...new Set(terms)];
    ok(uniq.length <= 1, 'سحبة واحدة لا ثلاث — الترمات المسحوبة: ' + JSON.stringify(uniq));
    if (uniq.length) ok(uniq[0] === '202710', 'والمسحوب هو الترم النشط: ' + uniq[0]);
    else ok(true, 'ما انسحب شيء (الدورة خارج ساعاتها)');
    ok(DB.monitored_courses.length === before,
       'صفوف الترمات الأخرى ما انحذفت — الحذف قرار من اللوحة');
  }

  /* ── ٤) مستوى الكاش يتبع نافذة اللوحة ── */
  {
    /* نافذة أقفلناها من اللوحة قبل شهرين: يجب أن نخرج من كل المستويات */
    await adm('monitor-window', 'POST', { from: '2026-07-01', to: '2026-07-02' });
    let h = (await adm('health')).body;
    ok(h.ttl.tier === 'off',
       'نافذة قديمة ⇒ المستوى off — جاء ' + h.ttl.tier);
    ok(!/ضمن \d+ أيام/.test(h.ttl.ar),
       'ولا يقول «ضمن ٧ أيام من نافذة»: ' + h.ttl.ar);

    /* نافذة انتهت أمس: داخل مهلة الأسبوع، فالمستوى near */
    const y = new Date(Date.now() + 3 * 3600e3 - 864e5).toISOString().slice(0, 10);
    await adm('monitor-window', 'POST', { from: y, to: y });
    h = (await adm('health')).body;
    ok(h.ttl.tier === 'near', 'نافذة أمس ⇒ near — جاء ' + h.ttl.tier);
    ok(h.ttl.ar.includes(y), 'والسبب يذكر النافذة اليدوية لا تقويم الكود');

    await adm('monitor-window', 'POST', { reset: true });
  }

  /* ── ٥) اللوحة تعرض الحالة ── */
  {
    const mi = (await adm('health')).body.monitorInfo || {};
    ok(mi.activeTerm === '202710', 'اللوحة تعرض الترم النشط');
    ok('termCustom' in mi && 'canWatch' in mi && 'currentWindow' in mi,
       'وحقول التحكم كلها تحت monitorInfo');
    ok(mi.termEnv === '202710', 'وقيمة Render معروضة للمقارنة');
  }

  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('انهار الاختبار: ' + e.stack); process.exit(1) });
