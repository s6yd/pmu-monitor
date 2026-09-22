/* جهة الطالب — الحصة المجانية.
   أ) السيرفر: بعد الفترة المجانية، المجاني يُخدم في أقدم مراقبتين فقط،
      والمشترك في كل شي — ومراقبة بعد الصف الألف تُفحص (كانت تُقصّ)
   ب) الصفحة: ورقة الباقات، الجرس، الجداول، المتوقفة، البطاقة

   node tests/test-free-tier.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

/* ═══ أ) السيرفر ═══ */
const DB = { profiles: [], monitored_courses: [], app_state: [], app_events: [] };
const TG = [];
let nextId = 1;
const day = n => new Date(Date.now() - n * 864e5).toISOString();

DB.profiles.push(
  { id: 'free', telegram_chat_id: '701', is_pro: false, subscription_expires_at: null },
  { id: 'paid', telegram_chat_id: '702', is_pro: false,
    subscription_expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });

/* ١٠٠٠ صف في ترم آخر — تملأ حد PostgREST قبل صفوف الترم الحالي */
for (let i = 0; i < 1000; i++)
  DB.monitored_courses.push({ id: nextId++, user_id: 'paid', scope: 'section', course_code: 'OLD 1000',
    crn: 'X' + i, term: '202620', last_status: 'CLOSED', followup_done: true, created_at: day(400) });

const mon = (uid, crn, age, scope) => DB.monitored_courses.push({ id: nextId++, user_id: uid,
  scope: scope || 'section', course_code: 'MEEN 3311', crn: scope === 'course' ? null : crn,
  term: '202710', last_status: 'CLOSED', followup_done: true, followup_at: null,
  expires_at: null, created_at: day(age) });
mon('free', '30011', 5); mon('free', '30012', 4); mon('free', '30013', 3); mon('free', null, 2, 'course');
mon('paid', '30011', 5); mon('paid', '30012', 4); mon('paid', '30013', 3);

function pmuRows(g) {
  const sec = g === 'F1' ? [['30021', '21']] : [['30011', '01'], ['30012', '02'], ['30013', '03']];
  return '<table><tbody>' + sec.map(([crn, s]) => '<tr>' + [crn, 'MEEN 3311', 'Thermo', s, 'UT',
    '10:00-11:15', 'Dr. X', 'M-CORE - G034', 'OPEN'].map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
    } else (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: nextId++ }, x)));
    return [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const m = /id=in\.\(([^)]*)\)/.exec(qs) || /id=eq\.([^&]+)/.exec(qs);
    const ids = m ? new Set(String(m[1]).split(',').map(x => x.replace(/"/g, ''))) : new Set();
    list.filter(r => ids.has(String(r.id))).forEach(r => Object.assign(r, b));
    return [];
  }
  if (method === 'DELETE') return [];
  if (/expires_at=|followup_at=|followup_done=/.test(qs)) return [];
  let r = list.slice();
  const key = /key=eq\.([^&]+)/.exec(qs);
  if (key) r = r.filter(x => x.key === key[1]);
  const m = /id=in\.\(([^)]*)\)/.exec(qs);
  if (m) { const ids = new Set(m[1].split(',').map(x => x.replace(/"/g, ''))); r = r.filter(x => ids.has(String(x.id))) }
  const off = /offset=(\d+)/.exec(qs), lim = /limit=(\d+)/.exec(qs);
  if (off) r = r.slice(Number(off[1]));
  /* حد PostgREST: بلا limit صريح، أول ١٠٠٠ صف فقط — بلا خطأ */
  r = r.slice(0, lim ? Number(lim[1]) : 1000);
  return r;
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
      let o = '[]';
      if (host.includes('pmu.edu.sa')) {
        if (opts.path !== '/Home/getData') o = '<input name="__RequestVerificationToken" value="t">';
        else o = pmuRows((/GenderList=([^&]*)/.exec(chunks.join('')) || [])[1]);
      } else if (host === 'api.telegram.org') {
        TG.push(JSON.parse(chunks.join('') || '{}'));
        o = JSON.stringify({ ok: true, result: {} });
      } else o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = 200; res.headers = { 'set-cookie': ['a=b'] };
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 45883, TOKEN = 'admin-token-for-tests';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: TOKEN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(p, method, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'X-Admin-Token': TOKEN }, data ? { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { try { resolve(JSON.parse(o)) } catch (e) { resolve(o) } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const crnsTo = chat => TG.filter(m => String(m.chat_id) === chat).map(m => m.text || '')
  .join('\n').match(/300\d\d/g) || [];

(async () => {
  await wait(400);

  const st = await call('/api/monitor-status', 'GET');
  ok(st.freeBeta === false, 'الفترة المجانية منتهية في هذا الاختبار');
  ok(st.plans && st.plans.termHalalas === 1900 && st.plans.freeMonitors === 2 && st.plans.freeSchedules === 1,
     'الصفحة تستلم الأسعار والحدود — ' + JSON.stringify(st.plans));
  ok(st.plans && st.plans.termEnd === '2026-12-30T20:59:59.000Z', 'ونهاية الترم لورقة الباقات');

  await call('/api/run-check', 'GET');
  await wait(6500);
  const free = new Set(crnsTo('701')), paid = new Set(crnsTo('702'));
  ok(free.has('30011') && free.has('30012'), 'المجاني: أقدم مراقبتين وصلته — ' + [...free]);
  ok(!free.has('30013'), 'والثالثة ما وصلته — متوقفة');
  ok(!TG.some(m => String(m.chat_id) === '701' && /كل شعب|نزلت شعبة/.test(m.text || '')),
     'ومراقبة «كل الشعب» ما خدمته');
  ok(paid.has('30011') && paid.has('30012') && paid.has('30013'),
     'المشترك: الثلاث وصلته — وصفوفه بعد الصف الألف انفحصت (كانت تُقصّ) — ' + [...paid]);

  /* ═══ ب) الصفحة ═══ */
  const { chromium } = require('playwright');
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ courses: [], term: '202710', regTerm: '202710', canWatch: true, freeBeta: false,
      plans: st.plans }));
  });
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch();
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
    body: 'window.__DEL=[];window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:(t)=>({select(){return this},eq(){return this},order(){return this},limit(){return this},insert(){return this},delete(){return{eq:async(k,v)=>{window.__DEL.push(v);return{error:null}}}},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => typeof openPlans === 'function', null, { timeout: 15000 });

  const r = await p.evaluate(async P => {
    const res = {};
    LANG = 'ar';
    MON_STATE = { term: '202710', regTerm: '202710', canWatch: true, freeBeta: false, plans: P };
    USER = { id: 'u1', email: 'x@y' };
    PROFILE = { id: 'u1', telegram_chat_id: '1', is_pro: false };
    const t0 = '2026-09-01T00:00:00Z', t1 = '2026-09-02T00:00:00Z', t2 = '2026-09-03T00:00:00Z';
    monitored = [
      { id: 11, scope: 'section', crn: '30011', course_code: 'MEEN 3311', term: '202710', created_at: t0 },
      { id: 12, scope: 'section', crn: '30012', course_code: 'MEEN 3311', term: '202710', created_at: t1 }];
    allCourses = [{ crn: '30099', courseCode: 'MEEN 4411', section: '01', status: 'CLOSE' },
                  { crn: '30011', courseCode: 'MEEN 3311', section: '01', status: 'CLOSE' }];
    document.getElementById('term').value = '202710';
    const sheetCtx = () => { const s = document.getElementById('planSheet');
      return s && !s.hidden ? (s.querySelector('.ps-ctx') || {}).textContent || '(بلا سياق)' : null };

    res.cap = monCapReached();
    await toggleMonitorCourseGo('30099');
    res.sheetNew = sheetCtx(); closePlans(); await new Promise(z => setTimeout(z, 250));

    await toggleMonitorCourseGo('30011');                       /* إيقاف مراقبة قائمة */
    res.sheetStop = sheetCtx(); res.deleted = window.__DEL.slice();

    await toggleMonitorAllGo('MEEN 4411');
    res.sheetCourse = sheetCtx(); closePlans(); await new Promise(z => setTimeout(z, 250));

    SLOT = 0; switchSlot(1);
    res.sheetSlot = sheetCtx(); res.slotAfter = SLOT; closePlans(); await new Promise(z => setTimeout(z, 250));

    SCHEDULES = [[], [{ crn: '1' }], []]; SLOT = 1; schedule = SCHEDULES[1];
    res.enforced = enforceSlot(); res.slotNow = SLOT;

    monitored = [
      { id: 1, scope: 'section', term: '202710', created_at: t0 },
      { id: 2, scope: 'section', term: '202710', created_at: t1 },
      { id: 3, scope: 'section', term: '202710', created_at: t2 },
      { id: 4, scope: 'course', term: '202710', created_at: t0 }];
    res.paused = [...pausedMonitorIds()].sort();

    openPlans('compare');
    res.noPoRow = !document.getElementById('psPo');       /* Pushover غير مضبوط: لا صف */
    closePlans(); await new Promise(z => setTimeout(z, 250));
    MON_STATE.plans = Object.assign({}, P, { pushoverOffered: true });
    openPlans('compare');
    res.total0 = document.getElementById('psTotal').textContent;
    const po = document.getElementById('psPo');
    if (po) { po.checked = true; plansTotal() }
    res.total1 = document.getElementById('psTotal').textContent;
    res.payDisabled = document.getElementById('psPay').disabled;
    closePlans(); await new Promise(z => setTimeout(z, 250));

    monitored = monitored.slice(0, 2);
    renderSettings();
    res.cardTitle = document.getElementById('proTitle').textContent;
    res.cardSub = document.getElementById('proSub').textContent;

    PROFILE = { id: 'u1', telegram_chat_id: '1', subscription_expires_at: new Date(Date.now() + 864e5).toISOString() };
    res.proCap = monCapReached(); res.proSlot = slotLocked(2); res.proPaused = pausedMonitorIds().size;
    renderSettings(); res.proTitle = document.getElementById('proTitle').textContent;

    MON_STATE.freeBeta = true; PROFILE = { id: 'u1', telegram_chat_id: '1' };
    monitored = [1, 2, 3, 4, 5].map(i => ({ id: i, scope: 'section', term: '202710', created_at: t0 }));
    res.betaCap = monCapReached(); res.betaSlot = slotLocked(2);
    return res;
  }, st.plans);

  ok(r.cap === true, 'مراقبتان عند المجاني: الحد وصل');
  ok(/حد المراقبتين/.test(r.sheetNew || ''), 'مراقبة ثالثة ⇒ ورقة الباقات «وصلت حد المراقبتين» — ' + r.sheetNew);
  ok(r.sheetStop === null && r.deleted.includes(11), 'إيقاف مراقبة قائمة ما يفتح الورقة — ينحذف فعلاً');
  ok(/كل شعب المادة/.test(r.sheetCourse || ''), 'جرس «كل الشعب» للمجاني ⇒ الورقة — ' + r.sheetCourse);
  ok(/الجدول الثاني والثالث/.test(r.sheetSlot || '') && r.slotAfter === 0, 'الجدول الثاني ⇒ الورقة، والجدول ما تغيّر');
  ok(r.enforced === true && r.slotNow === 0, 'واقف على جدول مقفول ⇒ يرجع للأول، والبيانات باقية');
  ok(JSON.stringify(r.paused) === '[3,4]', 'المتوقفة: الثالثة و«كل الشعب» — نفس قاعدة السيرفر — ' + JSON.stringify(r.paused));
  ok(r.noPoRow === true, 'Pushover غير مضبوط في Render ⇒ ما يُعرض كإضافة');
  ok(/^19/.test(r.total0 || ''), 'الإجمالي ١٩ ريال — ' + r.total0);
  ok(/^29/.test(r.total1 || ''), 'ومع التنبيه الطارئ ٢٩ — ' + r.total1);
  ok(r.payDisabled === true, 'زر الدفع معطّل حتى تجهز البوابة');
  ok(/حساب مجاني/.test(r.cardTitle) && /المراقبة 2 من 2/.test(r.cardSub), 'البطاقة: «حساب مجاني · المراقبة 2 من 2» — ' + r.cardSub);
  ok(r.proCap === false && r.proSlot === false && r.proPaused === 0, 'المشترك: لا حد ولا قفل ولا متوقفة');
  ok(/اشتراك الترم/.test(r.proTitle), 'وبطاقته «اشتراك الترم ✅»');
  ok(r.betaCap === false && r.betaSlot === false, 'الفترة المجانية: خمس مراقبات وثلاثة جداول بلا أي قفل');
  ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close(); srv.close();
  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
