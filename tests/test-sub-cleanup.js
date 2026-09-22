/* تنظيف الاشتراك القديم — اختبار عبر الملفات الثلاثة.
   أ) ما انحذف ما يرجع  ب) الصفحة تقرأ الفترة المجانية من السيرفر
   ج) السيرفر: المفتاح والتفعيل للترم والإلغاء، والإشعار يحترم الفترة

   node tests/test-sub-cleanup.js [server.js] [pmu-schedule.html] [admin.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ADMIN = path.resolve(process.argv[4] || path.join(__dirname, '..', 'admin.html'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

/* ═══ أ) ما انحذف ما يرجع ═══ */
{
  const f = fs.readFileSync(PAGE, 'utf8');
  for (const dead of ['PAY_NUMBER', 'togglePay', 'isTrial', 'payBox', 'STC Pay',
                      '19 ريال / سنة', 'SAR 19 / year', 'proFeat1', 'payAmount',
                      'تجربتك المجانية'])
    ok(!f.includes(dead), 'الصفحة: لا أثر لـ «' + dead + '»');
  /* «حفظ سحابي» في دليل الموقع ميزة مجانية فعلاً — الممنوع بيعه في البطاقة */
  const card = (/<div class="pro-card" id="proCard">[\s\S]*?\n  <\/div>/.exec(f) || [''])[0];
  ok(card && !/حفظ سحابي|Cloud sync/.test(card), 'بطاقة الاشتراك ما تبيع الحفظ السحابي');
  ok(!/const FREE_BETA/.test(f), 'الصفحة: لا ثابت FREE_BETA — القرار من السيرفر');
  ok(!/id="proTitle" data-i18n|id="proPrice" data-i18n/.test(f),
     'عناصر البطاقة بلا data-i18n — تبديل اللغة ما يعيد السعر القديم');

  const s = fs.readFileSync(SRV, 'utf8');
  /* المقصود: فحص «الاشتراك ساري» اللي كان مكتوباً خمس مرات. كان الاختبار
     يعدّ «p.is_pro ||» — فتصيده دالة إضافة Pushover وهي قاعدة مختلفة */
  const subChecks = (s.match(/subscription_expires_at && new Date\(p\.subscription_expires_at\)/g) || []).length;
  ok(subChecks === 1, 'السيرفر: فحص الاشتراك الساري مكتوب مرة واحدة — ' + subChecks);
  const g = /async function adminGrant[\s\S]*?\n}/.exec(s);
  ok(g && !/paid_at/.test(g[0]), 'التفعيل من اللوحة ما يكتب paid_at');

  const a = fs.readFileSync(ADMIN, 'utf8');
  ok(!/\+ سنة|\+ شهر|\+ أسبوع/.test(a), 'اللوحة: لا أزرار سنة/شهر/أسبوع');
  ok(/فعّل للترم/.test(a), 'اللوحة: زر «فعّل للترم»');
  ok(/toggleBeta/.test(a), 'اللوحة: مفتاح الفترة المجانية');
}

/* ═══ ج) السيرفر الحقيقي ═══ */
const DB = { profiles: [], monitored_courses: [], app_state: [], app_events: [] };
const TG = [];
const PATCHES = [];
let nextId = 1;

DB.profiles.push(
  { id: 'u-sub', telegram_chat_id: '901', is_pro: false, notif_prefs: null, pushover_key: null,
    subscription_expires_at: new Date(Date.now() + 30 * 864e5).toISOString() },
  { id: 'u-free', telegram_chat_id: '902', is_pro: false, notif_prefs: null, pushover_key: null,
    subscription_expires_at: null });
for (const [uid, crn] of [['u-sub', '30011'], ['u-free', '30011']])
  DB.monitored_courses.push({ id: nextId++, user_id: uid, scope: 'section',
    course_code: 'MEEN 3311', crn, term: '202710', last_status: 'CLOSED',
    followup_done: true, followup_at: null, expires_at: null,
    created_at: new Date(Date.now() - 864e5).toISOString() });

let STATUS = 'OPEN';
function rows(list) {
  return '<table><tbody>' + list.map(r => '<tr>' + [r[0], r[1], 'Thermo', r[2], 'UT',
    '10:00-11:15', 'Dr. X', 'M-CORE - G034', STATUS].map(v => `<td>${v}</td>`).join('') + '</tr>')
    .join('') + '</tbody></table>';
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
        else {
          const g = (/GenderList=([^&]*)/.exec(chunks.join('')) || [])[1];
          o = g === 'F1' ? rows([['30021', 'MEEN 3311', '02']]) : rows([['30011', 'MEEN 3311', '01']]);
        }
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

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(r => r.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
      return [];
    }
    (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: nextId++ }, x)));
    return [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const m = /id=eq\.([^&]+)/.exec(qs) || /id=in\.\(([^)]*)\)/.exec(qs);
    const ids = m ? new Set(String(m[1]).split(',')) : new Set();
    const hit = list.filter(r => ids.has(String(r.id)));
    hit.forEach(r => Object.assign(r, b));
    if (table === 'profiles') PATCHES.push({ qs, body: b });
    return /return=representation/.test(prefer) ? hit.map(r => Object.assign({}, r)) : [];
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
  if (lim) r = r.slice(0, Number(lim[1]));
  return r;
}

const PORT = 45879, TOKEN = 'admin-token-for-tests';
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: TOKEN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'true'
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
const got = chat => TG.filter(m => String(m.chat_id) === chat && /فتحت|الشعبة/.test(m.text || '')).length;

(async () => {
  await wait(400);

  /* المفتاح */
  {
    let r = await call('/api/admin/beta-toggle', 'GET');
    ok(r.on === true, 'الفترة المجانية شغّالة افتراضياً');
    let st = await call('/api/monitor-status', 'GET');
    ok(st.freeBeta === true, 'والصفحة تستلمها شغّالة');
  }

  /* الإشعار في الفترة المجانية: للاثنين */
  {
    await call('/api/run-check', 'GET'); await wait(5500);
    ok(got('901') >= 1 && got('902') >= 1, `الفترة المجانية: المشترك وغيره وصلهم — ${got('901')}/${got('902')}`);
  }

  /* إنهاء الفترة: للمشترك فقط */
  {
    const r = await call('/api/admin/beta-toggle', 'POST', { on: false });
    ok(r.on === false, 'المفتاح انطفأ');
    const st = await call('/api/monitor-status', 'GET');
    ok(st.freeBeta === false, 'والصفحة تستلمها منتهية');
    const saved = DB.app_state.find(x => x.key === 'runtime');
    ok(saved && saved.value && saved.value.toggles && saved.value.toggles.freeBeta === false,
       'ومحفوظة — تصمد بعد النشر');

    DB.monitored_courses.forEach(m => { m.last_status = 'CLOSED' });
    const a = got('901'), b = got('902');
    await call('/api/run-check', 'GET'); await wait(5500);
    ok(got('901') > a, 'بعد الفترة: المشترك وصله');
    /* تغيّرت القاعدة في دفعة الحصة المجانية: قبلها «كل شي أو لا شي»،
       الآن المجاني يُخدم في أقدم مراقبتين — وعنده هنا واحدة فقط */
    ok(got('902') > b, 'وغير المشترك وصله في حصّته المجانية (مراقبة من اثنتين)');
  }

  /* التفعيل للترم */
  {
    PATCHES.length = 0;
    const r = await call('/api/admin/grant', 'POST', { userId: 'u-free' });
    ok(r.ok === true, 'التفعيل نجح');
    ok(r.expires === '2026-12-30T20:59:59.000Z', 'حتى آخر يوم نهائيات ٢٣:٥٩ الرياض — ' + r.expires);
    const pb = PATCHES[0] && PATCHES[0].body;
    ok(pb && !('paid_at' in pb), 'وما انكتب paid_at — هدية لا دفع');
    const u = DB.profiles.find(p => p.id === 'u-free');
    ok(u.subscription_expires_at === '2026-12-30T20:59:59.000Z', 'والحساب انحدّث فعلاً');

    const bad = await call('/api/admin/grant', 'POST', { userId: 'nobody' });
    ok(bad.ok === false, 'مستخدم غير موجود: رفض صريح لا «تمّ» كاذبة');
  }

  /* الإلغاء */
  {
    const r = await call('/api/admin/revoke', 'POST', { userId: 'u-free' });
    ok(r.ok === true, 'الإلغاء نجح');
    const u = DB.profiles.find(p => p.id === 'u-free');
    ok(new Date(u.subscription_expires_at) < new Date(), 'والتاريخ صار في الماضي');
    const bad = await call('/api/admin/revoke', 'POST', { userId: 'nobody' });
    ok(bad.ok === false, 'إلغاء مستخدم غير موجود: رفض صريح');
  }

  /* ═══ ب) الصفحة ═══ */
  {
    const { chromium } = require('playwright');
    const srv = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
      if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"courses":[]}');
    });
    await new Promise(r => srv.listen(0, r));
    const browser = await chromium.launch();
    const p = await browser.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};' }));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof freeBeta === 'function', null, { timeout: 15000 });

    const r = await p.evaluate(() => {
      const res = {};
      USER = { id: 'u1', email: 'x@y' };
      MON_STATE = null;                    res.noState = freeBeta();
      MON_STATE = { freeBeta: true };      res.on = freeBeta(); res.proOn = isPro();
      MON_STATE = { freeBeta: false };     res.off = freeBeta();
      PROFILE = { is_pro: false };         res.proFree = isPro();
      PROFILE = { subscription_expires_at: new Date(Date.now() + 864e5).toISOString() };
      res.proSub = isPro();

      LANG = 'ar';
      MON_STATE = { freeBeta: true }; PROFILE = {};
      renderSettings();
      res.betaTitle = document.getElementById('proTitle').textContent;
      MON_STATE = { freeBeta: false }; PROFILE = {};
      renderSettings();
      res.freeTitle = document.getElementById('proTitle').textContent;
      res.freePrice = document.getElementById('proPrice').textContent;
      res.cardText = document.getElementById('proCard').innerText;
      return res;
    });
    ok(r.noState === true, 'قبل وصول حالة السيرفر: نفترض الفترة شغّالة');
    ok(r.on === true && r.proOn === true, 'الفترة شغّالة: المسجّل عنده كل شي');
    ok(r.off === false, 'السيرفر يقول انتهت: الصفحة تتبعه');
    ok(r.proFree === false, 'بعد الفترة: غير المشترك مو pro');
    ok(r.proSub === true, 'والمشترك الساري pro');
    ok(/كل شي مجاني/.test(r.betaTitle), 'بطاقة الفترة المجانية — ' + r.betaTitle);
    ok(/حساب مجاني/.test(r.freeTitle), 'بعد الفترة: «حساب مجاني» — ' + r.freeTitle);
    /* مكان السعر صار زر «الباقات» — الممنوع سعر قديم أو كلمة «سنة» */
    ok(!/\d|سنة|ريال/.test(r.freePrice), 'بلا سعر قديم — ' + r.freePrice);
    ok(!/سنة|STC|تجربة|حفظ سحابي/.test(r.cardText), 'ولا أثر للسنة أو التحويل أو التجربة');

    /* تبديل اللغة ما يرجّع النص القديم */
    const after = await p.evaluate(() => {
      MON_STATE = { freeBeta: false }; PROFILE = {};
      try { if (typeof setLang === 'function') { setLang('en'); setLang('ar') } } catch (e) {}
      renderSettings();
      return document.getElementById('proPrice').textContent;
    });
    ok(!/19/.test(after), 'بعد تبديل اللغة: لا «19 ريال» يرجع');

    ok(errs.length === 0, 'الصفحة بلا أخطاء: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
