/* التنبيه الطارئ كإضافة — اختبار.
   أ) السيرفر: الإرسال نفسه يحترم الوضع والإضافة، والوضع القديم يُقرأ addon
   ب) الصفحة: مقفولة بشرح لغير المشتري، ونص بلا «ادفع لـPushover» للمشتري
   ج) اللوحة: تفعيل الإضافة من الدرج

   node tests/test-pushover-addon.js [server.js] [pmu-schedule.html] [admin.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const querystring = require('querystring');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ADMIN = path.resolve(process.argv[4] || path.join(__dirname, '..', 'admin.html'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

const future = new Date(Date.now() + 30 * 864e5).toISOString();
let nextId = 1;
const DB = {
  profiles: [
    { id: 's1', telegram_chat_id: '901', subscription_expires_at: future, pushover_key: 'k-s1', pushover_until: future },
    { id: 's2', telegram_chat_id: '902', subscription_expires_at: future, pushover_key: 'k-s2', pushover_until: null },
    { id: 's3', telegram_chat_id: '903', is_pro: true, pushover_key: 'k-s3', pushover_until: null }],
  monitored_courses: ['s1', 's2', 's3'].map(u => ({ id: nextId++, user_id: u, scope: 'section',
    course_code: 'MEEN 3311', crn: '30011', term: '202710', last_status: 'CLOSED', followup_done: true,
    created_at: '2026-09-01T00:00:00Z' })),
  /* الوضع محفوظ بالاسم القديم */
  app_state: [{ key: 'runtime', value: { toggles: { pushoverMode: 'pro' } } }],
  app_events: [], subscriptions: []
};
const PO = [];

function pmuRows(g) {
  const rows = g === 'F1' ? [['30021', '21']] : [['30011', '01']];
  return '<table><tbody>' + rows.map(([crn, s]) => '<tr>' + [crn, 'MEEN 3311', 'Thermo', s, 'UT',
    '10:00-11:15', 'Dr. X', 'M-CORE - G034', 'OPEN'].map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}
function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const filt = rows => {
    let r = rows.slice();
    for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=eq\.([^&]+)/g)) r = r.filter(x => String(x[m[1]]) === m[2]);
    const m = /id=in\.\(([^)]*)\)/.exec(qs);
    if (m) { const ids = new Set(m[1].split(',').map(x => x.replace(/"/g, ''))); r = r.filter(x => ids.has(String(x.id))) }
    const off = /offset=(\d+)/.exec(qs), lim = /limit=(\d+)/.exec(qs);
    if (off) r = r.slice(Number(off[1]));
    if (lim) r = r.slice(0, Number(lim[1]));
    return r;
  };
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
      return [];
    }
    const rows = (Array.isArray(b) ? b : [b]).map(x => Object.assign({ id: nextId++ }, x));
    list.push(...rows);
    return /return=representation/.test(prefer) ? rows : [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(list); hit.forEach(x => Object.assign(x, b));
    return /return=representation/.test(prefer) ? hit.map(x => Object.assign({}, x)) : [];
  }
  if (method === 'DELETE') return [];
  if (/expires_at=|followup_at=|followup_done=/.test(qs)) return [];
  return filt(list);
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
      } else if (host === 'api.pushover.net') {
        const raw = chunks.join('');
        let f; try { f = JSON.parse(raw) } catch (e) { f = querystring.parse(raw) }
        PO.push(f); o = JSON.stringify({ status: 1 });
      } else if (host === 'api.telegram.org') o = JSON.stringify({ ok: true, result: {} });
      else o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = 200; res.headers = { 'set-cookie': ['a=b'] };
      setImmediate(() => cb(res));
    }
  };
  return req;
};

/* المنفذ يتغيّر مع كل تشغيل: منفذ ثابت يبقى محجوزاً بعد انتهاء
   العملية (TIME_WAIT أو بقايا جلسة)، فيفشل التشغيل التالي بـEADDRINUSE
   والاختبار يطلع أحمر بلا علاقة بالكود. النطاق ١٠٠ لكل ملف فما يتصادمان. */
const PORT = 46400 + (process.pid % 100), TOKEN = 'admin-token-for-tests';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: TOKEN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false',
  PUSHOVER_TOKEN: 'po-token', PUSHOVER_USER: 'po-admin',
  PUSHOVER_SUBSCRIBE_URL: 'https://pushover.net/subscribe/Jadwalik-test'
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
const keysPushed = () => new Set(PO.map(f => f.user).filter(Boolean));
async function cycleWith(mode) {
  if (mode) await call('/api/admin/pushover-mode', 'POST', { mode });
  DB.monitored_courses.forEach(m => { m.last_status = 'CLOSED' });
  PO.length = 0;
  await call('/api/run-check', 'GET');
  await wait(4500);
  return keysPushed();
}

(async () => {
  await wait(500);

  /* ═══ أ) السيرفر ═══ */
  const h = await call('/api/admin/health', 'GET');
  ok(h.monitorInfo && h.monitorInfo.pushoverMode === 'addon', 'الوضع المحفوظ «pro» يُقرأ «addon» — ' +
     (h.monitorInfo && h.monitorInfo.pushoverMode));

  let got = await cycleWith(null);
  ok(got.has('k-s1'), 'addon: من اشترى الإضافة استلم');
  ok(got.has('k-s3'), 'والدائم (is_pro) استلم');
  ok(!got.has('k-s2'), 'ومشترك الترم بلا الإضافة ما استلم — كان يستلم لأن مفتاحه مربوط');

  got = await cycleWith('off');
  ok(!got.has('k-s1') && !got.has('k-s2') && !got.has('k-s3'), 'off: ولا طالب — كان يستلم كل من ربط مفتاحه');

  got = await cycleWith('all');
  ok(got.has('k-s1') && got.has('k-s2') && got.has('k-s3'), 'all: الكل');

  await call('/api/admin/pushover-mode', 'POST', { mode: 'addon' });

  /* التفعيل من اللوحة */
  let r = await call('/api/admin/grant-pushover', 'POST', { userId: 's2', note: 'تجربة' });
  ok(r.ok === true && r.until === '2026-12-30T20:59:59.000Z', 'فعّلت الإضافة لـ s2 حتى نهاية الترم');
  const comp = DB.subscriptions.filter(x => x.user_id === 's2' && x.pushover);
  ok(comp.length === 1 && comp[0].status === 'comp' && comp[0].includes_term === false,
     'صف «هدية» للإضافة وحدها — ما يلمس اشتراك الترم');
  await call('/api/admin/grant-pushover', 'POST', { userId: 's2' });
  ok(DB.subscriptions.filter(x => x.user_id === 's2' && x.pushover).length === 1, 'تفعيل ثانٍ ما يكرر الصف');
  got = await cycleWith(null);
  ok(got.has('k-s2'), 'وبعد التفعيل استلم');
  r = await call('/api/admin/grant-pushover', 'POST', { userId: 's2', on: false });
  ok(r.ok === true && new Date(DB.profiles[1].pushover_until) < new Date(), 'والإيقاف يرجّعها');
  const d = await call('/api/admin/user?id=s2', 'GET');
  ok(d.user && d.user.pushoverAddon === false && d.user.pushoverLinked === true, 'الدرج: غير مفعّل · التطبيق مربوط');

  /* ═══ ب) الصفحة ═══ */
  {
    const { chromium } = require('playwright');
    const srv = http.createServer((q, res) => {
      const u = q.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
      /* الصفحة صارت تحمّل الخطط من /plans.js — نخدم الملف الحقيقي.
         تغيير بنية لا تسهيل: قبله كان المحاكي يرد 404 على كل .js، فالصفحة
         تفقد PLANS وتبويب خطتي يعرض رسالة العطل بدل الخطة. */
      if (u === '/plans.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end(fs.readFileSync(path.join(__dirname, '..', 'shared', 'plans.js')));
      }
      if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"courses":[]}');
    });
    await new Promise(z => srv.listen(0, z));
    const browser = await chromium.launch();
    const p = await browser.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', z => z.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof poState === 'function', null, { timeout: 15000 });
    const v = await p.evaluate(() => {
      const res = {};
      LANG = 'ar'; USER = { id: 's2' };
      const plans = { termHalalas: 1900, pushoverHalalas: 1000, freeMonitors: 2, freeSchedules: 1, pushoverOffered: true };
      MON_STATE = { freeBeta: false, plans, pushover: { mode: 'addon', url: 'https://pushover.net/subscribe/x' } };
      PROFILE = { id: 's2', telegram_chat_id: '1', subscription_expires_at: new Date(Date.now() + 864e5).toISOString() };
      res.stLocked = poState();
      renderPushover();
      res.locked = document.getElementById('poRow').innerText;
      const btn = document.querySelector('#poRow button');
      if (btn) btn.click();
      const sh = document.getElementById('planSheet');
      res.sheetCtx = sh && !sh.hidden ? (sh.querySelector('.ps-ctx') || {}).textContent : null;
      res.poChecked = !!(document.getElementById('psPo') || {}).checked;
      closePlans();

      PROFILE.pushover_until = new Date(Date.now() + 864e5).toISOString();
      res.stOpen = poState(); renderPushover();
      res.open = document.getElementById('poRow').innerText;

      MON_STATE.pushover.mode = 'all'; PROFILE.pushover_until = null; renderPushover();
      res.all = document.getElementById('poRow').innerText;

      USER = null; MON_STATE.pushover.mode = 'addon'; res.stGuest = poState();
      return res;
    });
    ok(v.stLocked === 'locked', 'مشترك بلا الإضافة: البطاقة «مقفولة» لا مخفية');
    ok(/يرن حتى لو الجوال صامت/.test(v.locked) && /10 ريال/.test(v.locked) && /أضفه/.test(v.locked),
       'وتشرح الميزة وسعرها وزر «أضفه»');
    ok(/إضافة على اشتراك الترم/.test(v.sheetCtx || '') && v.poChecked === true,
       '«أضفه» يفتح الورقة والإضافة محددة سلفاً');
    ok(v.stOpen === 'open' && /إضافتك تغطيه/.test(v.open) && /نحن ندفعه/.test(v.open),
       'المشتري: «إضافتك تغطيه، ولو طلب منك الدفع نحن ندفعه»');
    ok(!/شراء مرة واحدة/.test(v.open), 'وما يُطلب منه يشتري التطبيق');
    ok(/شراء مرة واحدة/.test(v.all), 'في وضع all (بلا إضافة) يبقى الإفصاح عن سعر التطبيق');
    ok(v.stGuest === 'hidden', 'زائر بلا حساب: مخفية');
    ok(errs.length === 0, 'الصفحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  /* ═══ ج) اللوحة ═══ */
  {
    const { chromium } = require('playwright');
    let posted = null;
    const DETAIL = { ok: true, user: { id: 's2', name: 'نورة', email: 'n@x', major: 'MEEN', planVer: 'new',
        active: true, pushoverAddon: false, pushoverLinked: true },
      gpa: null, gpaHours: 0, gradedCourses: 0, completedCount: 0, completed: [], schedule: [], prepHint: {},
      subscriptions: [], credit: { balance: { available: 0 }, rows: [] } };
    const srv = http.createServer((q, res) => {
      const u = q.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(ADMIN)) }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.endsWith('/user')) return res.end(JSON.stringify(DETAIL));
      if (u.endsWith('/grant-pushover')) {
        let bd = ''; q.on('data', c => bd += c);
        return q.on('end', () => { posted = JSON.parse(bd || '{}'); res.end(JSON.stringify({ ok: true, until: '2026-12-30T20:59:59.000Z' })) });
      }
      if (u.endsWith('/health')) return res.end(JSON.stringify({ monitorInfo: { pushoverMode: 'addon', pushoverReady: true }, cache: [] }));
      res.end('{}');
    });
    await new Promise(z => srv.listen(0, z));
    const browser = await chromium.launch();
    const p = await browser.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', z => z.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.evaluate(() => sessionStorage.setItem('jdw_admin', 'x'.repeat(16)));
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1200);
    const v = await p.evaluate(async () => {
      await openUser('s2'); await new Promise(z => setTimeout(z, 250));
      const text = document.getElementById('drawerBody').innerText;
      window.prompt = () => 'هدية';
      await grantPo('s2', 'نورة', true);
      return { text };
    });
    ok(/التنبيه الطارئ/.test(v.text) && /غير مفعّل/.test(v.text) && /التطبيق مربوط/.test(v.text),
       'الدرج: «غير مفعّل · التطبيق مربوط»');
    ok(posted && posted.userId === 's2' && posted.on === true && posted.note === 'هدية', 'وزر التفعيل يرسل للسيرفر');
    ok(errs.length === 0, 'اللوحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
