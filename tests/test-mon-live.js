/* بطاقة «مراقبتك» فوق البحث — طلب محمد (٢٧ أكتوبر ٢٠٢٦): «يطلع زي عدادات وحالة مراقبة المواد لكل طالب
   لحاله… ويقدر منه يلغي المراقبة على طول ويعلمه حالة اشعارات بوش اوفر… ويحسس الطالب ان الاداة شغاله
   تراقبله… اهم شي ما تكون بمكان مزعج».

   أ) السيرفر (نسخ حقيقية و«خارج» مشترك — نفس محاكي test-pmu-speed):
      lastCheck = آخر فحص حقيقي للشعب (لا وقت الإقلاع، وفشل الجامعة ما يقدّمه) · nextCheck = موعد الدورة
      الجاية لو المراقبة تدور (ومن أول دقيقة بعد الإقلاع) · checking وقت الدورة · now ساعة السيرفر.
   ب) الصفحة (Chromium على ٣٩٠): تبان وقت التسجيل وحده ولمن عنده مراقبة في ترم التسجيل · مطوية افتراضياً
      بالعدّاد والحالة · تنفتح على موادها · الإيقاف بضغطتين يحذف الصف · تيليغرام والتنبيه الطارئ بحالتهما ·
      الحالات (نايمة · متأخرة · نسخة تجربة · موقوفة) · العدّ التنازلي يمشي · ‎?monpreview=1‎ معاينة موسومة
      ما تلمس الحساب · بالثيمين وبلا تمرير أفقي.

   node tests/test-mon-live.js [server.js] [pmu-schedule.html] */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(PAGE), 'shared', 'plans.js');
const ADMIN = 'admin-token-for-mon-live';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
  if (at) {                                   /* ساعة السيرفر على يوم بعينه */
    const shift = Date.parse(at.slice(5)) - Date.now();
    const now = Date.now.bind(Date);
    Date.now = () => now() + shift;
  }
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

/* ═══ قاعدة PostgREST-ية (نفس محاكي test-pmu-speed) ═══ */
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
  const st = { DB: o.DB, pmu: Object.assign({ hits: [], token: 'tok1', down: false, delay: 0 }, o.pmu), TG: [], nextId: 1000 };
  st.server = http.createServer((req, res) => {
    st.reqs = (st.reqs || 0) + 1;
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        const P = st.pmu;
        const q = new URLSearchParams(body);
        const hit = { method: req.method, url: req.url, g: q.get('GenderList'), token: q.get('__RequestVerificationToken') };
        P.hits.push(hit);
        const send = (code, type, text, extra) => {
          if (res.destroyed) return;
          res.writeHead(code, Object.assign({ 'Content-Type': type }, extra || {})); res.end(text);
        };
        if (req.url === '/')
          return send(200, 'text/html', `<input name="__RequestVerificationToken" type="hidden" value="${P.token}">`,
            { 'Set-Cookie': [`s=${P.token}; path=/`] });
        /* متعطّل: ٥٠٣ لكل جدول (عطل عندهم — لا رفض) */
        if (P.down) return send(503, 'text/html', '<html><body>Service Unavailable</body></html>');
        const reply = () => send(200, 'text/html', table(hit.g === 'F1' ? P.F1 : hit.g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
        return P.delay ? setTimeout(reply, P.delay) : reply();
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
      json(404, { error: 'unknown host' });
    });
  });
  return new Promise(r => st.server.listen(0, '127.0.0.1', () => { st.port = st.server.address().port; r(st) }));
}

let PORTN = 20100 + (process.pid % 40);
function instance(st, extra) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child'].concat(extra || [], [String(st.port), String(port)]), { silent: true });
  const get = (p, h) => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: h || {} }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', () => resolve({ status: 0, headers: {}, body: '' })); r.end();
  });
  c.run = () => get('/api/run-check', { 'X-Admin-Token': ADMIN }).then(r => { try { return JSON.parse(r.body) } catch (e) { return null } });
  c.health = () => get('/api/admin/health', { 'X-Admin-Token': ADMIN }).then(r => { try { return JSON.parse(r.body) } catch (e) { return {} } });
  c.status = () => get('/api/monitor-status').then(r => { try { return JSON.parse(r.body) } catch (e) { return {} } });
  c.st = st;
  return c;
}
/* جاهز = الإقلاع خلص — بلا ما نطلب دورة (نفس test-pmu-speed) */
const ready = async c => {
  for (let i = 0; i < 150; i++) {
    const h = await c.health();
    if (h.booted || (h.uptimeHours !== undefined && !('booted' in h))) return true;
    await wait(100);
  }
  return false;
};
const settle = async st => { let n = -1; for (const t0 = Date.now(); Date.now() - t0 < 8000 && st.reqs !== n;) { n = st.reqs; await wait(300) } };
/* دورة كاملة: نطلبها ونستنى لين تخلص فعلاً (lastCycle.gen في الصحة) — لا وقت ثابت */
const cycleOf = async c => {
  const t0 = Date.now();
  for (;;) {
    const r = await c.run();
    if (!r || r.gen === undefined) { await wait(5000); return }
    while (Date.now() - t0 < 60000 && (((await c.health()).lastCycle || {}).gen || 0) < r.gen) await wait(100);
    if (r.ran || Date.now() - t0 >= 60000) break;
  }
  await settle(c.st);
};

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
const base = paused => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: paused === false ? [] : [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] });
let MID = 1;
const user = (DB, n) => DB.profiles.push({ id: 'u' + n, telegram_chat_id: String(900 + n), is_pro: true,
  subscription_expires_at: null, pushover_key: null, pushover_until: null });
const watch = (DB, n, crn, last) => DB.monitored_courses.push({ id: MID++, user_id: 'u' + n, scope: 'section',
  course_code: 'MEEN 3311', crn, term: '202710', last_status: last, followup_done: true, followup_at: null,
  expires_at: null, sections_state: null, notified_at: null, created_at: new Date(Date.now() - 864e5).toISOString() });
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v));

const SCEN = {
  /* ١) آخر فحص: صفر لين أول فحص حقيقي، ووقت الفحص بعده، والجامعة متعطّلة ما تقدّمه */
  async lastCheck(t) {
    const DB = base(); user(DB, 1); watch(DB, 1, '30011', 'CLOSE');
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'CLOSE')] } });
    const c = instance(st); await ready(c);
    let s = await c.status();
    t.ok('lastCheck' in s, '**/api/monitor-status فيه lastCheck** (البطاقة تقول «آخر فحص قبل X د»)');
    t.eq(s.lastCheck, null, 'قبل أول فحص: null — لا وقت الإقلاع (ما نقول «فحصنا» وحنا ما فحصنا)');
    t.ok(iso(s.now), `**وساعة السيرفر (now)** — البطاقة تصحّح بها ساعة الجوال — ${s.now}`);
    const t0 = Date.now();
    await cycleOf(c);
    s = await c.status();
    const at = Date.parse(s.lastCheck);
    t.ok(iso(s.lastCheck) && at >= t0 - 1000 && at <= Date.now() + 1000,
      `**بعد الدورة: lastCheck = وقت الفحص** — ${s.lastCheck}`);
    /* الجامعة تعطّلت: الدورة تشتغل (وتقارن بنسخة الكاش الحديثة) — بس ما فحصت الجامعة، فـlastCheck ما يتقدّم */
    st.pmu.down = true;
    await wait(1200);
    await cycleOf(c);
    const s2 = await c.status();
    t.eq(s2.lastCheck, s.lastCheck, '**الجامعة متعطّلة: lastCheck ما يتقدّم** (الدورة دارت بلا جدول جديد — ما ندّعي فحصاً)');
    /* رجعت: يتقدّم */
    st.pmu.down = false;
    await wait(1200);
    await cycleOf(c);
    const s3 = await c.status();
    t.ok(Date.parse(s3.lastCheck) > Date.parse(s.lastCheck), `ورجعت الجامعة: يتقدّم — ${s.lastCheck} ⇒ ${s3.lastCheck}`);
    /* موقوفة من اللوحة: ما فيه «الفحص الجاي» ولا «نفحص الحين» */
    t.eq([s3.nextCheck, s3.checking], [null, false], 'المراقبة موقوفة: nextCheck null · checking false');
    c.kill('SIGKILL');
  },

  /* ٢) وقت التسجيل (١١ يناير ٢٠٢٧ ١٠ الصبح): الفحص الجاي معروف من أول دقيقة، و«نفحص الحين» وقت الدورة */
  async nextCheck(t) {
    const DB = base(false); user(DB, 1); watch(DB, 1, '30011', 'CLOSE');
    DB.monitored_courses[0].term = '202720';
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'CLOSE')] } });
    const AT = '2027-01-11T07:00:00Z';
    const c = instance(st, ['--at=' + AT]); await ready(c);
    let s = await c.status();
    const now = Date.parse(s.now), nx = Date.parse(s.nextCheck);
    t.ok(iso(s.now) && Math.abs(now - Date.parse(AT)) < 60000, `ساعة السيرفر على يوم التسجيل — ${s.now}`);
    t.ok(s.active === true && s.reason === 'peak', `المراقبة تدور (peak) — ${s.reason}`);
    t.ok(iso(s.nextCheck) && nx > now && nx - now <= 61000,
      `**الفحص الجاي معروف من أول دقيقة بعد الإقلاع** (أول دورة بعد ٢٠–٦٠ ثانية) — بعد ${Math.round((nx - now) / 1000)} ث`);
    t.eq(s.checking, false, 'ولا دورة شغّالة الحين');
    /* دورة طويلة (الجامعة بطيئة): checking وقتها */
    st.pmu.delay = 2500;
    await c.run();
    await wait(600);
    s = await c.status();
    t.eq(s.checking, true, '**وقت الدورة: checking = true** (البطاقة تقول «نفحص الحين…»)');
    for (let i = 0; i < 100 && (await c.status()).checking; i++) await wait(100);
    s = await c.status();
    t.eq(s.checking, false, 'وبعدها false');
    t.ok(iso(s.lastCheck) && Math.abs(Date.parse(s.lastCheck) - Date.parse(s.now)) < 15000,
      `وlastCheck وقت الفحص (بساعة السيرفر) — ${s.lastCheck}`);
    c.kill('SIGKILL');
  }
};

async function serverPart() {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
}

/* ═══ ب) الصفحة ═══ */
const ago = ms => new Date(Date.now() - ms).toISOString();
/* حالة السيرفر وقت التسجيل (يناير): ترم التسجيل الربيع، وترم الدراسة الخريف */
const WIN = o => Object.assign({
  active: true, reason: 'peak', env: 'prod', freeBeta: false,
  term: '202710', regTerm: '202720', nextRegTerm: '202720', canWatch: true,
  window: { from: '2027-01-10', to: '2027-01-21', term: '202720', ar: 'تسجيل الترم الثاني' },
  intervalMin: 5, activeHours: [7, 24], build: '"x"',
  plans: { termHalalas: 1900, pushoverHalalas: 1500, freeMonitors: 2, freeSchedules: 1, pushoverOffered: true },
  pushover: { mode: 'addon', url: 'https://pushover.net/subscribe/jadwalik-x' },
  lastCheck: ago(60e3), nextCheck: new Date(Date.now() + 200e3).toISOString(), checking: false,
  now: new Date().toISOString()
}, o || {});
const OFF = o => WIN(Object.assign({ active: false, reason: 'offseason', canWatch: false, window: null,
  regTerm: '202710', nextCheck: null, lastCheck: null }, o || {}));
const PROF = o => Object.assign({ id: 'u1', email: 'm@x.com', major: 'MEEN', plan_ver: 'new', prep: false,
  telegram_chat_id: '901', telegram_link_code: 'ABC123', is_pro: true, subscription_expires_at: null,
  pushover_key: null, pushover_until: null }, o || {});
/* مراقبات الطالب بصيغة monitored_courses — وواحدة من ترم قديم ما تنعدّ. الحالة بصيغة الجامعة: OPEN · CLOSE (لا CLOSED) */
const MONS = () => [
  { id: 11, user_id: 'u1', scope: 'section', course_code: 'MEEN 3311', section: '101', crn: '30011', term: '202720',
    last_status: 'OPEN', notified_at: ago(4 * 60e3), created_at: ago(2 * 864e5) },
  { id: 12, user_id: 'u1', scope: 'section', course_code: 'MATH 2301', section: '102', crn: '30012', term: '202720',
    last_status: 'CLOSE', notified_at: null, created_at: ago(5 * 36e5) },
  { id: 13, user_id: 'u1', scope: 'course', course_code: 'PHYS 1422', section: null, crn: null, term: '202720',
    last_status: null, sections_state: { 30101: 'CLOSE', 30102: 'CLOSE' }, notified_at: null, created_at: ago(864e5) },
  { id: 9, user_id: 'u1', scope: 'section', course_code: 'CHEM 1311', section: '101', crn: '20009', term: '202710',
    last_status: 'CLOSE', notified_at: null, created_at: ago(60 * 864e5) }
];
/* Supabase: ملفه في __ROW، ومراقباته في __MON، وكل حذف منها في __DELS. __MON_ERR = القراءة تفشل */
const SUPA_USER = (prof, mons) => `
window.__ROW=${JSON.stringify(prof)}; window.__MON=${JSON.stringify(mons)}; window.__DELS=[]; window.__MON_ERR=false;
function q(t){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o}, in(){return o},
  gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:t==='profiles'?window.__ROW:null,error:null}) },
  update(v){ if(t==='profiles')Object.assign(window.__ROW,v); return {eq:async()=>({data:[],error:null})} },
  insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return { eq:async(c,v)=>{ if(t==='monitored_courses'){ window.__DELS.push(v);
      window.__MON=window.__MON.filter(m=>m[c]!==v) } return {data:[],error:null} },
    in:async()=>({data:[],error:null}) } },
  then(f,r){
    if(t==='monitored_courses'&&window.__MON_ERR)return Promise.resolve({data:null,error:{message:'net'}}).then(f,r);
    const rows=t==='profiles'?[window.__ROW]:t==='monitored_courses'?window.__MON.map(m=>Object.assign({},m)):[];
    return Promise.resolve({data:rows,error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:{user:{id:'u1',email:'m@x.com'},access_token:'tok'}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
  from:t=>q(t),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;
const SUPA_GUEST = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),' +
  'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},' +
  'from:()=>({select(){return this},eq(){return this},order(){return this},' +
  'limit(){return this},insert(){return this},delete(){return this},' +
  'update(){return {eq:async()=>({data:[],error:null})}},' +
  'then:(f)=>f({data:[],error:null})}),' +
  'channel:()=>({on(){return this},subscribe(){return this}}),' +
  'storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';

/* البطاقة كما يشوفها الطالب */
const SNAP = () => {
  const b = document.getElementById('monLive');
  const tx = s => { const e = b && b.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '' };
  const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    exists: !!b, shown: !!b && !b.hidden && r.height > 0,
    first: !!b && !!b.nextElementSibling && b.nextElementSibling.classList.contains('search-card'),
    cls: b ? b.className : '', pill: tx('.ml-pill'), sub: tx('#mlSub'), title: tx('.ml-title'),
    count: tx('#mlCount .ml-num'), open: tx('#mlOpen .ml-num'), hot: !!(b && b.querySelector('#mlOpen.hot')),
    time: tx('#mlTime'), lbl: tx('#mlClockLbl'), spin: !!(b && b.querySelector('#mlRing.spin')),
    dash: b && b.querySelector('#mlFg') ? parseFloat(b.querySelector('#mlFg').style.strokeDashoffset) : null,
    chips: b ? [...b.querySelectorAll('.ml-ch')].map(c => ({ t: c.textContent.replace(/\s+/g, ' ').trim(), c: c.className })) : [],
    more: tx('#mlMore'), demo: tx('.ml-demo span'),
    rows: b ? [...b.querySelectorAll('.ml-row')].map(x => ({ id: Number(x.dataset.id), cls: x.className,
      code: (x.querySelector('.ml-code') || {}).textContent.replace(/\s+/g, ' ').trim(),
      st: (x.querySelector('.ml-st') || {}).textContent.replace(/\s+/g, ' ').trim(),
      meta: ((x.querySelector('.ml-meta') || {}).textContent || '').trim(),
      stop: (x.querySelector('.ml-stop') || {}).textContent.trim() })) : [],
    dels: window.__DELS || null, toast: (document.getElementById('toast') || {}).textContent || '',
    over: document.documentElement.scrollWidth - innerWidth,
    h: Math.round(r.height), w: Math.round(r.width)
  };
};
const secs = s => { const m = /^(\d+):(\d\d)$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN };

async function pagePart() {
  const t = T('page');
  let chromium = null;
  try { ({ chromium } = require('playwright')) } catch (e) {}
  if (!chromium) { t.ok(false, 'playwright متوفر'); return }
  const plansJs = fs.existsSync(SHARED) ? fs.readFileSync(SHARED) : Buffer.from('');
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(PAGE));
    }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(plansJs) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(u === '/api/courses' ? JSON.stringify({ courses: [], cached: false, age: 0 }) : '{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const shots = process.env.SHOT_DIR;
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  /* status: دالة ترجّع حالة السيرفر لكل طلب (وتنعدّ الطلبات) · user: [ملفه، مراقباته] أو null للزائر */
  const open = async ({ theme = 'dark', status, user = [PROF(), MONS()], query = '', seen } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const pg = await ctx.newPage();
    const errs = [], hits = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/api/monitor-status', r => { hits.push(Date.now());
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status()) }) });
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
      body: user ? SUPA_USER(user[0], user[1]) : SUPA_GUEST }));
    await pg.addInitScript(o => { try {
      if (localStorage.getItem('pmu_seen_guide')) return;
      localStorage.setItem('pmu_seen_guide', 'true'); localStorage.setItem('pmu_major', '"MEEN"');
      if (o) localStorage.setItem('pmu_monlive_open', o);
    } catch (e) {} }, seen || null);
    await pg.goto(BASE + query, { waitUntil: 'load' });
    /* جاهزة: حالة السيرفر وصلت، والمسجّل قرأ ملفه ومراقباته */
    await pg.waitForFunction(u => typeof window.renderMonLive === 'function' && typeof MON_STATE !== 'undefined' && !!MON_STATE
      && (!u || (typeof PROFILE !== 'undefined' && !!PROFILE && typeof monitored !== 'undefined' && monitored.length > 0)),
      !!user, { timeout: 15000 }).catch(() => {});
    /* تبويب البحث: خارج أيام التسجيل الحقيقية (الاختبار يشتغل أي يوم) الصفحة تبدأ على «اليوم» */
    await pg.evaluate(() => { try { switchTab('search') } catch (e) {} });
    await pg.waitForTimeout(300);
    return { ctx, pg, errs, hits };
  };
  const snap = pg => pg.evaluate(SNAP);
  /* ضغطة وتنفيذ ما يرميان: على صفحة قديمة بلا البطاقة يفشل الفحص ويكمل الباقي — ما ينهار الاختبار كله */
  const tap = (pg, sel) => pg.click(sel, { timeout: 3000 }).then(() => true, () => false);
  const run = (pg, fn, arg) => pg.evaluate(fn, arg).catch(e => ({ err: String(e).slice(0, 120) }));
  const shot = async (pg, name) => { if (shots) await pg.screenshot({ path: path.join(shots, name) }) };

  /* ── (أ) وقت التسجيل، مسجّل ومراقب — بالثيمين ── */
  for (const theme of ['dark', 'light']) {
    const { ctx, pg, errs } = await open({ theme, status: () => WIN() });
    let v = await snap(pg);
    t.ok(v.exists, `[${theme}] **عنصر البطاقة موجود في تبويب البحث** (#monLive)`);
    t.ok(v.shown && v.first, `[${theme}] **وقت التسجيل: البطاقة طالعة فوق بطاقة البحث** — ${JSON.stringify({ shown: v.shown, first: v.first })}`);
    t.ok(/\blive\b/.test(v.cls) && v.pill === 'شغّالة', `[${theme}] الحالة «شغّالة» — ${v.pill} · ${v.cls}`);
    t.ok(/نفحص لك كل 5 دقائق/.test(v.sub) && /آخر فحص قبل 1 د/.test(v.sub),
      `[${theme}] **السطر: «نفحص لك كل 5 دقائق · آخر فحص قبل 1 د»** — «${v.sub}»`);
    t.ok(/MEEN 3311 §101 مفتوحة الحين — روح سجّلها/.test(v.sub), `[${theme}] **والمفتوحة الحين تبان في السطر وهي مطوية** — «${v.sub}»`);
    t.eq([v.count, v.open, v.hot], ['3', '1', true],
      `[${theme}] **العدّادات: تراقب 3 (القديمة من ترم ثاني ما تنعدّ) · مفتوحة الحين 1**`);
    const s1 = secs(v.time);
    t.ok(s1 >= 190 && s1 <= 200 && v.lbl === 'الفحص الجاي', `[${theme}] **العدّ للفحص الجاي** (~3:20) — ${v.time} · ${v.lbl}`);
    t.ok(v.dash > 35 && v.dash < 48, `[${theme}] والدائرة ماشية ثلثها (مضى دقيقة وثلثين من خمس) — ${v.dash}`);
    t.eq(v.rows.length, 0, `[${theme}] **مطوية افتراضياً** (ما تزاحم البحث)`);
    t.ok(v.h <= 230, `[${theme}] ومطوية قصيرة — ${v.h}px`);
    t.eq(v.chips.map(c => c.t), ['✈️ تيليغرام ✓', '🚨 فعّل التنبيه الطارئ'],
      `[${theme}] **قنوات التنبيه: تيليغرام مربوط · التنبيه الطارئ مشتراه وما فعّله**`);
    t.ok(/\bok\b/.test((v.chips[0] || {}).c || '') && /\bneed\b/.test((v.chips[1] || {}).c || ''), `[${theme}] بألوانها (أخضر · يحتاج)`);
    t.eq(v.over <= 1, true, `[${theme}] على ٣٩٠ ما فيه تمرير أفقي — ${v.over}`);
    await shot(pg, `mon-live-${theme}.png`);
    await pg.waitForTimeout(2100);
    v = await snap(pg);
    t.ok(secs(v.time) <= s1 - 1, `[${theme}] **العدّ يمشي كل ثانية** — ${s1} ⇒ ${secs(v.time)}`);
    /* تنفتح */
    await tap(pg, '#mlMore');
    v = await snap(pg);
    t.eq(v.rows.map(r => r.code), ['MEEN 3311§101', 'MATH 2301§102', 'PHYS 1422كل الشعب'],
      `[${theme}] **تنفتح على موادها: المفتوحة أول، ثم المقفلة، ثم «كل الشعب»** (ومادة الترم القديم ما تبان)`);
    t.ok(/مفتوحة الحين — روح سجّلها/.test((v.rows[0] || {}).st) && /مقفلة — ننتظرها تفتح/.test((v.rows[1] || {}).st)
      && /أي شعبة تفتح أو تنزل/.test((v.rows[2] || {}).st), `[${theme}] بحالة كل وحدة — ${JSON.stringify(v.rows.map(r => r.st))}`);
    t.eq(v.rows.map(r => r.meta), ['نبّهناك قبل 4 د', 'تراقبها من 5 س', 'تراقبها من يوم'],
      `[${theme}] **ومتى نبّهناه أو من متى يراقبها**`);
    t.eq(v.more, 'إخفاء ▴', `[${theme}] وزر «إخفاء»`);
    t.ok(v.over <= 1, `[${theme}] مفتوحة على ٣٩٠ بلا تمرير أفقي — ${v.over}`);
    await shot(pg, `mon-live-open-${theme}.png`);
    t.eq(await pg.evaluate(() => localStorage.getItem('pmu_monlive_open')), '1', `[${theme}] وتتذكّر إنها مفتوحة`);
    if (theme === 'dark') {
      /* الإيقاف بضغطتين */
      await tap(pg, '.ml-row[data-id="12"] .ml-stop');
      v = await snap(pg);
      t.ok((v.rows.find(r => r.id === 12) || {}).stop === 'متأكد؟' && v.dels.length === 0,
        `**أول ضغطة على «إيقاف»: «متأكد؟» وما انحذف شي** — ${JSON.stringify(v.dels)}`);
      /* renderSettings تصير مع كل حدث (حساب · ربط · رجوع للتطبيق) — والبطاقة ترسم معها */
      const same = await run(pg, () => { const b = document.querySelector('.ml-row[data-id="12"] .ml-stop');
        renderSettings(); const b2 = document.querySelector('.ml-row[data-id="12"] .ml-stop');
        return !!b && b2 === b && b2.textContent === 'متأكد؟' });
      t.ok(same === true, `**رسم جديد بلا تغيير في البيانات ما يبدّل الأزرار تحت الإصبع ولا يضيّع «متأكد؟»** — ${JSON.stringify(same)}`);
      await tap(pg, '.ml-row[data-id="12"] .ml-stop');
      await pg.waitForTimeout(300);
      v = await snap(pg);
      t.eq(v.dels, [12], '**الثانية: المراقبة انحذفت من الحساب** (removeMonitor نفسها)');
      t.ok(!v.rows.some(r => r.id === 12) && v.count === '2', `واختفت من البطاقة والعدّاد صار 2 — ${v.count}`);
      t.ok(/وقفنا مراقبة MATH 2301/.test(v.toast), `ورسالة «وقفنا مراقبة MATH 2301» — ${v.toast}`);
      t.ok((await run(pg, () => !monitored.some(m => m.id === 12))) === true, 'وانشالت من قائمة المراقبات في الصفحة (الأجراس والإعدادات)');
      /* «متأكد؟» تنتهي بعد ثلاث ثوانٍ ونص */
      await tap(pg, '.ml-row[data-id="13"] .ml-stop');
      await pg.waitForTimeout(3900);
      v = await snap(pg);
      t.ok((v.rows.find(r => r.id === 13) || {}).stop === 'إيقاف' && v.dels.length === 1,
        `**«متأكد؟» تنتهي لحالها — ضغطة وحدة ما توقف شي** — ${JSON.stringify(v.dels)}`);
      /* الضغط على المادة يبحث عنها */
      await tap(pg, '.ml-row[data-id="11"] .ml-code');
      await pg.waitForTimeout(300);
      t.eq(await pg.evaluate(() => (document.getElementById('courseFilter') || {}).value), 'MEEN 3311',
        'الضغط على المادة يبحث عن شعبها');
    }
    t.ok(errs.length === 0, `[${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (ب) بعد موعد الفحص: تسأل السيرفر بنفسها وتتحدّث — وساعة الجوال متأخرة دقيقتين ── */
  {
    let phase = 1, P2 = null;
    const status = () => phase === 1
      ? WIN({ lastCheck: ago(4.5 * 60e3), nextCheck: new Date(Date.now() + 4000).toISOString() })
      : (P2 = P2 || { at: Date.now() + 120e3 }, WIN({ lastCheck: new Date(P2.at - 2000).toISOString(),
          nextCheck: new Date(P2.at + 300e3).toISOString(), now: new Date(Date.now() + 120e3).toISOString() }));
    const { ctx, pg, errs, hits } = await open({ status });
    let v = await snap(pg);
    t.ok(secs(v.time) <= 4, `(ب) العدّ قريب من الصفر — ${v.time}`);
    const n0 = hits.length;
    phase = 2;
    /* الدورة فتحت MATH 2301 */
    await run(pg, () => { window.__MON.find(m => m.id === 12).last_status = 'OPEN' });
    await pg.waitForFunction(() => { const e = document.querySelector('#mlOpen .ml-num'); return e && e.textContent === '2' },
      null, { timeout: 15000 }).catch(() => {});
    v = await snap(pg);
    t.ok(hits.length > n0, `**بعد موعد الفحص سألت السيرفر بنفسها** — ${n0} ⇒ ${hits.length}`);
    t.eq([v.open, v.hot], ['2', true], '**وقرأت المراقبات من جديد: «مفتوحة الحين» صارت 2** (الدورة فتحت MATH 2301)');
    t.ok(/2 من شعبك مفتوحة الحين/.test(v.sub) && /آخر فحص الحين/.test(v.sub), `والسطر: «2 من شعبك مفتوحة الحين» و«آخر فحص الحين» — «${v.sub}»`);
    const s = secs(v.time);
    t.ok(s >= 285 && s <= 300, `**العدّ بساعة السيرفر لا ساعة الجوال** (السيرفر قدّام دقيقتين: ~5:00 لا ~7:00) — ${v.time}`);
    /* قراءة تفشل (شبكة) ما تمسح البطاقة */
    await run(pg, async () => { window.__MON_ERR = true; MONLIVE.at = 0; await monLiveRefresh() });
    v = await snap(pg);
    t.ok(v.shown && v.count === '3', `**قراءة المراقبات فشلت: البطاقة باقية بموادها** (كانت القائمة تنمسح) — ${v.count}`);
    t.ok(errs.length === 0, '(ب) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (ج) الحالات — من السيرفر (monLiveRefresh نفسها) — بالثيمين ── */
  for (const theme of ['dark', 'light']) {
    let cur = WIN();
    const { ctx, pg, errs } = await open({ theme, status: () => cur, seen: '1' });
    const as = async (st, prof) => {
      cur = st;
      await run(pg, async p => { if (p) Object.assign(PROFILE, p);
        for (let i = 0; i < 60 && MONLIVE.busy; i++) await new Promise(r => setTimeout(r, 50));
        MONLIVE.at = 0; await monLiveRefresh(); return null }, prof || null);
      return snap(pg);
    };
    let v = await as(WIN({ reason: 'hours', active: false, nextCheck: null }));
    t.ok(v.pill === 'ترتاح بالليل' && /نرجع نفحص الساعة 7:00 الصبح/.test(v.sub) && v.time === '7:00' && v.lbl === 'نرجع نفحص'
      && /\bidle\b/.test(v.cls), `**بعد منتصف الليل: «ترتاح بالليل — نرجع نفحص الساعة 7:00 الصبح»** — ${v.pill} · «${v.sub}» · ${v.time}`);
    await shot(pg, `mon-live-sleep-${theme}.png`);
    v = await as(WIN({ lastCheck: ago(20 * 60e3), nextCheck: new Date(Date.now() + 50e3).toISOString() }));
    t.ok(v.pill === 'الفحص متأخر' && /آخر فحص ناجح قبل 20 د — نعيد المحاولة/.test(v.sub) && /\bwarn\b/.test(v.cls),
      `**ما فحصنا من ٢٠ دقيقة: «الفحص متأخر» بصدق** — ${v.pill} · «${v.sub}»`);
    await shot(pg, `mon-live-stale-${theme}.png`);
    v = await as(WIN({ checking: true }));
    t.ok(v.lbl === 'نفحص الحين' && v.spin, `**الدورة شغّالة: «نفحص الحين» والدائرة تدور** — ${v.lbl}`);
    v = await as(WIN({ env: 'dev', reason: 'disabled', active: false, canWatch: false, nextCheck: null, lastCheck: null }));
    t.ok(v.pill === 'نسخة تجربة' && /المراقبة الحقيقية في jadwalik.com/.test(v.sub), `نسخة dev: «نسخة تجربة» — ${v.pill} · «${v.sub}»`);
    v = await as(WIN({ reason: 'paused', active: false, canWatch: false, nextCheck: null }));
    t.ok(v.pill === 'موقوفة مؤقتاً' && /مراقباتك محفوظة/.test(v.sub), `موقوفة من اللوحة: «موقوفة مؤقتاً» — ${v.pill}`);
    v = await as(WIN({ lastCheck: null }));
    t.ok(/أول فحص خلال دقيقة/.test(v.sub), `بعد نشر (ما فحصنا بعد): «أول فحص خلال دقيقة» — «${v.sub}»`);
    v = await as(WIN(), { telegram_chat_id: null });
    t.ok(v.pill === 'ما يوصلك تنبيه' && /تيليغرام مو مربوط/.test(v.sub) && (v.chips[0] || {}).t === '✈️ اربط تيليغرام'
      && /\bneed\b/.test((v.chips[0] || {}).c), `**تيليغرام مو مربوط: «ما يوصلك تنبيه» وزر «اربط تيليغرام»** — ${v.pill} · ${JSON.stringify(v.chips)}`);
    await shot(pg, `mon-live-notg-${theme}.png`);
    t.ok(v.over <= 1, `[${theme}] الحالات على ٣٩٠ بلا تمرير أفقي — ${v.over}`);
    v = await as(WIN(), { telegram_chat_id: '901', pushover_key: 'u' + 'x'.repeat(29) });
    t.eq((v.chips[1] || {}).t, '🚨 التنبيه الطارئ ✓', '**التنبيه الطارئ مفعّل: «التنبيه الطارئ ✓»**');
    v = await as(WIN({ pushover: null }));
    t.eq(v.chips.length, 1, 'والتنبيه الطارئ مطفأ من اللوحة: ما نعرضه أبداً');
    t.eq(await run(pg, () => [monClosed('CLOSE'), monClosed('CLOSED'), monClosed('OPEN'), monClosed(null)]),
      [true, true, false, false], '**المقفلة: CLOSE (صيغة الجامعة) — وCLOSED القديمة من احتياط بانر كذلك**');
    await run(pg, () => { LANG = 'en'; renderMonLive() });
    v = await snap(pg);
    t.ok(/^Your watches/.test(v.title) && v.pill === 'Live' && /Checking every 5 min/.test(v.sub),
      `بالإنجليزي — ${v.title} · «${v.sub}»`);
    t.ok(errs.length === 0, `(ج) [${theme}] بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (د) المجاني فوق حدّه: المتوقفة تبان بسببها، والتنبيه الطارئ «أضفه» ── */
  {
    const mons = MONS().concat([{ id: 14, user_id: 'u1', scope: 'section', course_code: 'MEEN 3411', section: '101',
      crn: '30014', term: '202720', last_status: 'CLOSE', notified_at: null, created_at: ago(60e3) }]);
    const { ctx, pg, errs } = await open({ status: () => WIN(), user: [PROF({ is_pro: false }), mons], seen: '1' });
    const v = await snap(pg);
    const p = v.rows.filter(r => /paused/.test(r.cls));
    t.eq(p.map(r => r.id).sort(), [13, 14], `**المجاني: الثالثة و«كل الشعب» متوقفة** (pausedMonitorIds نفسها) — ${JSON.stringify(v.rows.map(r => [r.id, r.cls]))}`);
    t.ok(p.some(r => /متوقفة — فوق حد المجاني/.test(r.st)) && p.some(r => /كل الشعب للمشتركين/.test(r.st)), `بسببها — ${JSON.stringify(p.map(r => r.st))}`);
    t.eq(v.count, '2', 'والعدّاد يعدّ اللي تنراقب فعلاً');
    t.eq((v.chips[1] || {}).t, '🚨 أضف التنبيه الطارئ', 'وما اشترى التنبيه الطارئ: «أضف التنبيه الطارئ»');
    t.ok(errs.length === 0, '(د) بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (هـ) ما تبان: خارج التسجيل · زائر · بلا مراقبة في ترم التسجيل ── */
  for (const [what, o] of [
    ['خارج فترة التسجيل', { status: () => OFF() }],
    ['زائر بلا دخول', { status: () => WIN(), user: null }],
    ['مراقبته كلها من ترم قديم', { status: () => WIN(), user: [PROF(), MONS().filter(m => m.term !== '202720')] }]]) {
    const { ctx, pg, errs } = await open(o);
    await pg.waitForTimeout(400);
    const v = await snap(pg);
    t.ok(v.exists && !v.shown, `**${what}: ما تبان** (ولا بكسل فوق البحث) — ${JSON.stringify({ exists: v.exists, shown: v.shown })}`);
    t.ok(errs.length === 0, `(${what}) بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── (و) ‎?monpreview=1‎: معاينة موسومة لأي أحد وفي أي وقت — وما تلمس الحساب ── */
  for (const [who, user] of [['زائر', null], ['مسجّل', [PROF(), MONS()]]]) {
    const { ctx, pg, errs } = await open({ status: () => OFF(), user, query: '?monpreview=1', seen: '1' });
    let v = await snap(pg);
    t.ok(v.shown && /معاينة — بيانات تجريبية/.test(v.demo), `**[${who}] ‎?monpreview=1‎ خارج التسجيل: البطاقة طالعة وموسومة «معاينة»** — «${v.demo}»`);
    t.eq(v.rows.map(r => r.code), ['MEEN 3311§101', 'CHEN 3333§102', 'PHYS 1422كل الشعب'], `[${who}] بموادها التجريبية`);
    if (user) t.ok(!/monpreview/.test(await pg.evaluate(() => location.search)), `[${who}] (والرابط انمسح بعد الدخول — والمعاينة باقية)`);
    await tap(pg, '.ml-row[data-id="-2"] .ml-stop'); await tap(pg, '.ml-row[data-id="-2"] .ml-stop');
    v = await snap(pg);
    t.ok(!v.rows.some(r => r.id === -2) && /معاينة — ما وقّفنا شي حقيقي/.test(v.toast) && (!user || v.dels.length === 0),
      `**[${who}] الإيقاف في المعاينة: من البطاقة وبس — ولا حذف من الحساب** — ${JSON.stringify(v.dels)}`);
    /* دورة المعاينة: العدّ يخلص ⇒ «نفحص الحين» ⇒ «آخر فحص الحين» */
    await run(pg, () => { MONLIVE.dst.next = Date.now() + 800 });
    await pg.waitForFunction(() => /نفحص الحين/.test((document.getElementById('mlClockLbl') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    t.eq((await snap(pg)).lbl, 'نفحص الحين', `[${who}] المعاينة تمثّل الفحص: «نفحص الحين»`);
    await pg.waitForFunction(() => /آخر فحص الحين/.test((document.getElementById('mlSub') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    v = await snap(pg);
    t.ok(/آخر فحص الحين/.test(v.sub) && secs(v.time) > 280, `[${who}] وبعده «آخر فحص الحين» وعدّ جديد — «${v.sub}» · ${v.time}`);
    if (!user) await shot(pg, 'mon-live-preview-dark.png');
    await tap(pg, '.ml-demo button');
    t.ok(!(await snap(pg)).shown, `[${who}] و✕ يقفل المعاينة`);
    t.ok(errs.length === 0, `[${who}] المعاينة بلا أخطاء JS: ` + errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
}

(async () => {
  await serverPart();
  await pagePart().catch(e => { fail++; out.push('  ✗ [page] انهار: ' + (e && e.stack || e)) });
  if (out.length) console.log(out.join('\n'));
  console.log(`مراقبتك: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
