/* الدعوات والحساب الموثّق — اختبار.
   أ) السيرفر: الهوية برمز الجلسة، كود الدعوة، الحساب، حساب السعر
   ب) الصفحة: التقاط ?ref=، البطاقة، الورقة تعرض حساب السيرفر

   node tests/test-referral.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };

const TOK = { 'tok-u1-aaaaaaaaaaaaaaaaaaaa': 'u1', 'tok-u2-bbbbbbbbbbbbbbbbbbbb': 'u2',
              'tok-u3-cccccccccccccccccccc': 'u3' };
const DB = {
  profiles: [
    { id: 'u1', is_pro: false, subscription_expires_at: null, invite_code: null },
    { id: 'u2', is_pro: false, subscription_expires_at: null, invite_code: 'KWT234' },
    { id: 'u3', is_pro: false, subscription_expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      invite_code: 'SUB345' }],
  credit_ledger: [
    { id: 1, user_id: 'u1', amount_halalas: 500, expires_at: '2027-08-17T20:59:59+00:00',
      created_at: '2026-09-01T10:00:00+00:00' },
    { id: 2, user_id: 'u2', amount_halalas: 500, expires_at: '2027-08-17T20:59:59+00:00',
      created_at: '2026-09-01T10:00:00+00:00' }],
  referrals: [{ id: 1, referrer_id: 'u1', invited_id: 'u9' }],
  subscriptions: [], app_state: [], app_events: [], monitored_courses: []
};
let patchCalls = 0, collideOnce = true;

function supabase(method, urlPath, body, prefer) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const table = p.replace('/rest/v1/', '');
  const list = DB[table] || (DB[table] = []);
  const filt = rows => {
    let r = rows.slice();
    for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=eq\.([^&]+)/g)) r = r.filter(x => String(x[m[1]]) === m[2]);
    for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=is\.null/g)) r = r.filter(x => x[m[1]] == null);
    const lim = /limit=(\d+)/.exec(qs);
    if (lim) r = r.slice(0, Number(lim[1]));
    return r;
  };
  if (method === 'PATCH' && table === 'profiles') {
    patchCalls++;
    const b = JSON.parse(body || '{}');
    if (b.invite_code && collideOnce) { collideOnce = false; return { code: '23505', message: 'duplicate key' } }
    const hit = filt(list);
    hit.forEach(x => Object.assign(x, b));
    return /return=representation/.test(prefer) ? hit.map(x => Object.assign({}, x)) : [];
  }
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
    }
    return [];
  }
  if (method === 'GET') return filt(list);
  return [];
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
      let o = '[]', code = 200;
      if (opts.path && opts.path.startsWith('/auth/v1/user')) {
        const t = String((opts.headers && opts.headers.Authorization) || '').replace('Bearer ', '');
        if (TOK[t]) o = JSON.stringify({ id: TOK[t], email: TOK[t] + '@x' });
        else { code = 401; o = JSON.stringify({ msg: 'invalid JWT' }) }
      } else if (host === 'api.telegram.org') o = JSON.stringify({ ok: true, result: {} });
      else if (!host.includes('pmu.edu.sa'))
        o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 45885;
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests', SITE_ENV: 'dev', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function me(p, tok) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET',
      headers: tok ? { Authorization: 'Bearer ' + tok } : {} }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end();
  });
}
const U1 = 'tok-u1-aaaaaaaaaaaaaaaaaaaa', U2 = 'tok-u2-bbbbbbbbbbbbbbbbbbbb', U3 = 'tok-u3-cccccccccccccccccccc';

(async () => {
  await new Promise(r => setTimeout(r, 400));

  /* ═══ أ) السيرفر ═══ */
  {
    let r = await me('/api/me/account');
    ok(r.code === 401, 'بلا رمز: ٤٠١');
    r = await me('/api/me/account', 'tok-fake-zzzzzzzzzzzzzzzzzzzz');
    ok(r.code === 401, 'رمز مزوّر: ٤٠١ — السيرفر يسأل Supabase ولا يثق بالمتصفح');

    r = await me('/api/me/account', U1);
    const code = r.j.invite && r.j.invite.code;
    ok(r.code === 200 && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code || ''),
       'كود دعوة انولد: ستة من أبجدية بلا حروف ملتبسة — ' + code);
    ok(DB.profiles[0].invite_code === code, 'وانحفظ في الملف');
    ok(patchCalls === 2, 'تصادم أول محاولة ⇒ محاولة ثانية بكود جديد — ' + patchCalls);
    ok(r.j.credit && r.j.credit.available === 500, 'والرصيد ٥ ريال');
    ok(r.j.invite.paidFriends === 1, 'وصديق دفع واحد');
    const before = patchCalls;
    r = await me('/api/me/account', U1);
    ok(r.j.invite.code === code && patchCalls === before, 'طلب ثانٍ: نفس الكود بلا كتابة');

    /* السعر */
    let q = (await me('/api/me/quote', U2)).j;
    ok(q.base === 1900 && q.po === 0 && q.credit === 500 && q.amount === 1400,
       'الترم ١٩ − رصيد ٥ = ١٤ — ' + JSON.stringify([q.base, q.po, q.credit, q.amount]));
    q = (await me('/api/me/quote?pushover=1', U2)).j;
    ok(q.po === 1000 && q.amount === 2400, 'ومع التنبيه الطارئ: ٢٤');
    q = (await me(`/api/me/quote?pushover=1&ref=${code}`, U2)).j;
    ok(q.ref === 'ok' && q.discount === 300 && q.amount === 2100,
       'كود صديق صالح: −٣ ⇒ ٢١ — ' + JSON.stringify([q.ref, q.discount, q.amount]));
    q = (await me('/api/me/quote?ref=KWT234', U2)).j;
    ok(q.ref === 'own' && q.discount === 0, 'كودك أنت: ما ينطبق');
    q = (await me('/api/me/quote?ref=ZZZZZZ', U2)).j;
    ok(q.ref === 'unknown' && q.discount === 0, 'كود غير موجود: ما ينطبق');
    q = (await me('/api/me/quote?ref=x', U2)).j;
    ok(q.ref === 'unknown', 'كود بصيغة غلط: ما ينطبق');

    DB.subscriptions.push({ id: 7, user_id: 'u2', status: 'paid' });
    q = (await me(`/api/me/quote?ref=${code}`, U2)).j;
    ok(q.ref === 'used' && q.discount === 0, 'اشترى من قبل: خصم الصديق لأول شراء فقط');
    DB.subscriptions.length = 0;

    DB.credit_ledger[1].amount_halalas = 5000;
    q = (await me('/api/me/quote', U2)).j;
    ok(q.credit === 1900 && q.amount === 0, 'رصيد أكبر من السعر: يغطيه ويبقى الباقي — المبلغ صفر');
    DB.credit_ledger[1].amount_halalas = 500;

    q = (await me(`/api/me/quote?pushover=1&ref=${code}`, U3)).j;
    ok(q.includesTerm === false && q.base === 0 && q.po === 1000,
       'مشترك فعّال: ما يدفع الترم مرة ثانية — الإضافة وحدها');
    ok(q.ref === 'used', 'وكود الصديق ما ينطبق على الإضافة');
  }

  /* ═══ ب) الصفحة ═══ */
  {
    const { chromium } = require('playwright');
    const srv = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
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
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    const browser = await chromium.launch();
    const SB = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
    const open = async q => {
      const p = await browser.newPage();
      await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB }));
      await p.goto(`http://127.0.0.1:${port}/${q}`, { waitUntil: 'load' });
      await p.waitForFunction(() => typeof storedRef === 'function', null, { timeout: 15000 });
      return p;
    };

    let p = await open('?ref=abc234&x=1');
    let r = await p.evaluate(() => ({ ref: storedRef(), url: location.search }));
    ok(r.ref === 'ABC234', 'رابط الدعوة انحفظ (والحروف الصغيرة تُكبَّر) — ' + r.ref);
    ok(r.url === '?x=1', 'وانشال من الرابط، وبقي غيره — ' + r.url);
    await p.close();

    p = await open('?ref=BAD!!');
    r = await p.evaluate(() => ({ ref: storedRef(), url: location.search }));
    ok(r.ref === '' && r.url === '', 'كود بصيغة غلط: ما ينحفظ، وينشال من الرابط');
    const expired = await p.evaluate(() => {
      localStorage.setItem('pmu_ref', JSON.stringify({ code: 'ABC234', at: Date.now() - 61 * 864e5 }));
      return storedRef();
    });
    ok(expired === '', 'كود عمره فوق ٦٠ يوماً: منتهٍ');

    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    const card = await p.evaluate(async () => {
      LANG = 'ar';
      MON_STATE = { freeBeta: false, plans: { termHalalas: 1900, pushoverHalalas: 1000,
        friendDiscountHalalas: 300, referrerCreditHalalas: 500, freeMonitors: 2, freeSchedules: 1,
        termEnd: '2026-12-30T20:59:59.000Z', pushoverOffered: true } };
      USER = { id: 'u1', email: 'x@y' }; PROFILE = { id: 'u1' };
      ACCOUNT = { ok: true, active: false, credit: { available: 500, nextExpiry: '2027-08-17T20:59:59.000Z' },
                  invite: { code: 'MHD7K2', paidFriends: 2 } };
      ACCOUNT_AT = Date.now();
      renderSettings();
      const acct = document.getElementById('proAcct').innerText;
      const open = !document.getElementById('proBody').hidden;
      MON_STATE.freeBeta = true; renderSettings();
      const beta = document.getElementById('proAcct').innerText;
      return { acct, open, beta };
    });
    ok(/5 ريال/.test(card.acct) && /17 أغسطس/.test(card.acct), 'البطاقة: الرصيد ٥ ريال وينتهي ١٧ أغسطس');
    /* الكود ظاهر كاملاً — الرابط الطويل كان ينقصّ عند الكود نفسه على الجوال */
    ok(/MHD7K2/.test(card.acct) && /شارك الرابط/.test(card.acct), 'كود الدعوة ظاهر كاملاً وزر مشاركة الرابط');
    ok(/يوفّر 3 ريال/.test(card.acct) && /تكسب 5 ريال/.test(card.acct) && /دفعوا: 2/.test(card.acct),
       'والشرح من أسعار اللوحة، وعدد من دفع');
    const link = await p.evaluate(async () => {
      let got = '';
      Object.defineProperty(navigator, 'share', { value: async d => { got = d.text }, configurable: true });
      await copyInvite(); return got;
    });
    ok(/https:\/\/jadwalik\.com\/\?ref=MHD7K2/.test(link) && /3 ريال/.test(link),
       'المشاركة ترسل الرابط كاملاً مع الخصم — ' + link.slice(0, 60));
    ok(card.open === true, 'البطاقة تنفتح لوحدها بعد الفترة المجانية — الدعوة ما تنخفي');
    ok(card.beta === '', 'في الفترة المجانية: لا رصيد ولا دعوات');

    const sheet = await p.evaluate(async () => {
      MON_STATE.freeBeta = false;
      localStorage.setItem('pmu_ref', JSON.stringify({ code: 'KWT234', at: Date.now() }));
      let asked = '';
      window.meFetch = async path => { asked = path;
        return { ok: true, base: 1900, po: 0, discount: 300, credit: 500, amount: 1100, ref: 'ok' } };
      openPlans('compare');
      await new Promise(z => setTimeout(z, 200));
      return { asked, lines: document.getElementById('psLines').innerText,
               total: document.getElementById('psTotal').textContent };
    });
    ok(/ref=KWT234/.test(sheet.asked), 'الورقة تسأل السيرفر بالكود المحفوظ — ' + sheet.asked);
    ok(/خصم صديقك/.test(sheet.lines) && /رصيدك/.test(sheet.lines), 'وتعرض الخصم والرصيد سطراً سطراً');
    ok(/^11/.test(sheet.total), 'والإجمالي من حساب السيرفر (١١) لا من الصفحة — ' + sheet.total);
    ok(errs.length === 0, 'بلا أخطاء JS: ' + errs.slice(0, 2).join(' | '));
    await browser.close(); srv.close();
  }

  out.forEach(l => realLog(l));
  realLog(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out.forEach(l => realLog(l)); realLog('انهار الاختبار: ' + e.message.split('\n')[0]); process.exit(1) });
