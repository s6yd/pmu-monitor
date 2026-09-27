/* الملاحظات وتذاكر الدعم — الحد والهوية. اختبار سلوكي على السيرفر الحقيقي.

   خطران يمسكهما:
   ١) **شبكة الحرم**: الطلاب في الجامعة كلهم خلف عنوان واحد، وحد
      الملاحظات كان ٥ بالساعة **لكل عنوان** — فالسادس ينحجب وهو ما أرسل
      شيئاً (وتذاكر الدعم من المساعد تمر من نفس الباب).
      القاعدة الجديدة (قرار محمد): ٥ **لكل حساب** للمسجّل، و٥ **لكل عنوان**
      للزائر وحده — والمسجّلون ما يستهلكون حصة زوار شبكتهم.
   ٢) **الإيميل المكتوب ما يثبت شي**: كان السيرفر يبحث بالإيميل اللي في
      الطلب ويربط التذكرة بتلقرام صاحبه. فأي أحد يكتب إيميل طالب ⇒ تذكرته
      تنضاف لتذكرة ذاك الطالب المفتوحة، ويروح ردّك لتلقرامه، وتشوف اسمه.
      صارت الهوية من رمز الجلسة وحده (مثل /api/me).

   node tests/test-feedback.js [server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* ستة طلاب + ضحية عندها تلقرام مربوط وتذكرة مفتوحة */
const TOK = {};
const USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
USERS.forEach((u, i) => { TOK[`tok-${u}-${'abcdefghijklmnopqrstu'[i].repeat(24)}`] = u });
const tokOf = u => Object.keys(TOK).find(k => TOK[k] === u);

const DB = {
  profiles: [
    /* u1 ربط تلقرام — والصفوف فيها العمودان القديمان كما في القاعدة */
    { id: 'u1', email: 'u1@x', user_email: 'u1@x',
      telegram_chat_id: '1001', telegram_username: 'u1tg' },
    ...USERS.slice(1).map(u => ({ id: u, email: u + '@x', user_email: u + '@x',
      telegram_chat_id: null, telegram_username: null })),
    { id: 'u9', email: 'victim@x', user_email: 'victim@x',
      telegram_chat_id: '9999', telegram_username: 'victimtg' }],
  tickets: [{ id: 70, chat_id: '9999', user_email: 'victim@x', status: 'open',
              updated_at: '2026-09-20T10:00:00+00:00' }],
  ticket_messages: [], feedback: [], app_state: []
};
let nextTicket = 100;
const TG = [];   /* رسائل تلقرام — للمشرف */

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
    /* PostgREST يقصّ عند ١٠٠٠ بلا limit صريح */
    return r.slice(0, lim ? Number(lim[1]) : 1000);
  };
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (table === 'app_state') {
      const i = list.findIndex(x => x.key === b.key);
      if (i >= 0) list[i] = b; else list.push(b);
      return [];
    }
    const row = Object.assign({}, b);
    if (table === 'tickets') { row.id = nextTicket++; row.status = 'open' }
    list.push(row);
    return /return=representation/.test(prefer) ? [Object.assign({}, row)] : [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(list);
    hit.forEach(x => Object.assign(x, b));
    return /return=representation/.test(prefer) ? hit.map(x => Object.assign({}, x)) : [];
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
        /* نفس شكل رد Supabase: الاسم داخل user_metadata من قوقل */
        if (TOK[t]) o = JSON.stringify({ id: TOK[t], email: TOK[t] + '@x',
          user_metadata: { name: 'Student ' + TOK[t], full_name: 'Student ' + TOK[t] } });
        else { code = 401; o = JSON.stringify({ msg: 'invalid JWT' }) }
      } else if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(chunks.join('') || '{}') } catch (e) {}
        if (/sendMessage/.test(opts.path || '')) TG.push(b);
        o = JSON.stringify({ ok: true, result: { message_id: 1 } });
      } else if (!host.includes('pmu.edu.sa'))
        o = JSON.stringify(supabase(opts.method, opts.path, chunks.join(''),
          (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || ''));
      const res = new Readable({ read() { this.push(o); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 47400 + (process.pid % 100);
Object.assign(process.env, {
  PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests', SITE_ENV: 'dev', ACTIVE_TERM: '202710',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
  TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555'
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function send(body, { tok, ip } = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || '10.0.0.1' };
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/feedback',
      method: 'POST', headers }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end(data);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const adminMsgs = () => TG.filter(m => String(m.chat_id) === '5555');
const lastAdmin = () => { const a = adminMsgs(); return String((a[a.length - 1] || {}).text || '') };
const msg = (s, extra) => Object.assign({ text: 'ملاحظة رقم ' + s, category: 'bug', lang: 'ar' }, extra || {});

(async () => {
  await wait(400);

  /* ═══ ١) شبكة الحرم: ستة حسابات من عنوان واحد ═══ */
  {
    const CAMPUS = '185.1.1.1';
    const codes = [];
    for (const u of USERS) codes.push((await send(msg(u, { email: u + '@x' }), { tok: tokOf(u), ip: CAMPUS })).code);
    eq(codes, [200, 200, 200, 200, 200, 200],
       '**ستة طلاب من شبكة الحرم نفسها: كلهم يرسلون** — كان السادس ينحجب بـ٤٢٩ وهو ما أرسل شيئاً');

    /* والمسجّلون ما يستهلكون حصة زوار نفس الشبكة */
    const g = await send(msg('زائر الحرم'), { ip: CAMPUS });
    eq(g.code, 200, '**وأول زائر من نفس الشبكة يرسل** — حسابات المسجّلين ما تُحسب عليه');

    /* الحد باقٍ — بالحساب: u1 أرسل ١، نكمّل ٤ من عناوين مختلفة ثم السادسة */
    const more = [];
    for (let i = 0; i < 4; i++) more.push((await send(msg('u1-' + i), { tok: tokOf('u1'), ip: '10.9.9.' + i })).code);
    eq(more, [200, 200, 200, 200], 'الحساب الواحد: خمس في الساعة من أي شبكة');
    const sixth = await send(msg('u1-6'), { tok: tokOf('u1'), ip: '10.9.9.77' });
    eq(sixth.code, 429, '**والسادسة من نفس الحساب تنحجب ولو من عنوان جديد** — الحد صار بالحساب لا اختفى');
    const other = await send(msg('u2-2'), { tok: tokOf('u2'), ip: '10.9.9.77' });
    eq(other.code, 200, 'وحجب حساب ما يحجب غيره على نفس العنوان');
  }

  /* ═══ ٢) الزائر: حده بعنوانه كما كان ═══ */
  {
    const IP = '10.0.0.2', codes = [];
    for (let i = 0; i < 6; i++) codes.push((await send(msg('زائر ' + i), { ip: IP })).code);
    eq(codes, [200, 200, 200, 200, 200, 429], 'الزائر: خمس لكل عنوان، والسادسة ٤٢٩ — ما تغيّر');
    const fake = await send(msg('برمز مزوّر'), { tok: 'tok-fake-zzzzzzzzzzzzzzzzzzzzzzzz', ip: IP });
    eq(fake.code, 429, '**ورمز مزوّر = زائر** — ما يفتح له حصة حساب');
    const fake2 = await send(msg('برمز مزوّر ٢'), { tok: 'tok-fake-zzzzzzzzzzzzzzzzzzzzzzzz', ip: '10.0.0.3' });
    eq(fake2.code, 200, 'ومن عنوان ثانٍ يمر كزائر عادي — لا خطأ');
  }

  /* ═══ ٣) الإيميل المكتوب ما يربط تذكرة بتلقرام أحد ═══ */
  {
    const tBefore = DB.tickets.length, mBefore = DB.ticket_messages.length;
    const r = await send(msg('انتحال', { email: 'victim@x', name: 'Victim' }), { ip: '10.0.0.4' });
    eq(r.code, 200, 'الزائر يرسل عادي');
    const onVictim = DB.ticket_messages.slice(mBefore).filter(m => m.ticket_id === 70);
    eq(onVictim.length, 0, '**ورسالته ما تنضاف لتذكرة الضحية المفتوحة**');
    const t = DB.tickets.slice(tBefore);
    eq(t.length, 1, 'تذكرة جديدة له');
    eq(t[0] && t[0].chat_id, null, '**بلا تلقرام الضحية** — ردّك ما يروح لها');
    eq(t[0] && t[0].user_email, 'victim@x', 'والإيميل المكتوب محفوظ كوسيلة تواصل');
    const a = lastAdmin();
    ok(!/#u9999/.test(a) && !/↩️/.test(a), '**ورسالتك ما فيها «رد عليها يوصله»** — ' + a.slice(-120));
    ok(/غير موثّق/.test(a), '**والإيميل معلَّم «غير موثّق»** — كتبه بنفسه');
    ok(!/victimtg/.test(a), 'ولا معرّف تلقرام الضحية');
  }

  /* ═══ ٤) المسجّل: هويته من جلسته لا من جسم الطلب ═══ */
  {
    const tBefore = DB.tickets.length;
    const r = await send(msg('مسجّل يكتب إيميل غيره', { email: 'victim@x', name: 'Victim' }),
      { tok: tokOf('u3'), ip: '10.0.0.5' });
    eq(r.code, 200, 'يرسل');
    const t = DB.tickets.slice(tBefore)[0] || {};
    eq(t.user_email, 'u3@x', '**الإيميل من جلسته** لا من الطلب');
    eq(t.user_name, 'Student u3', 'والاسم من حسابه في قوقل');
    eq(t.chat_id, null, 'وبلا تلقرام الضحية');
    const a = lastAdmin();
    ok(/u3@x/.test(a) && !/victim/.test(a), 'رسالتك تقول مين أرسل فعلاً — ' + a.slice(0, 160));
    ok(!/غير موثّق/.test(a), 'وإيميل الجلسة موثّق — بلا علامة');
  }

  /* ═══ ٥) اللي كان شغّال يبقى: المسجّل المربوط يوصله ردّك ═══ */
  {
    const tBefore = DB.tickets.length;
    const r = await send(msg('مسجّل مربوط', { email: 'u5@x' }), { tok: tokOf('u5'), ip: '10.0.0.6' });
    eq(r.code, 200, 'u5 يرسل');
    /* نربط u5 ونعيد — التذكرة تنربط بتلقرامه من ملفه */
    DB.profiles.find(p => p.id === 'u5').telegram_chat_id = '1005';
    DB.profiles.find(p => p.id === 'u5').telegram_username = 'u5tg';
    const r2 = await send(msg('مسجّل مربوط ٢', { email: 'u5@x' }), { tok: tokOf('u5'), ip: '10.0.0.6' });
    eq(r2.code, 200, 'u5 يرسل ثانية');
    const t = DB.tickets.slice(tBefore);
    eq(t.map(x => x.chat_id), [null, '1005'], '**بعد الربط: التذكرة على تلقرامه** من ملفه');
    const a = lastAdmin();
    ok(/#u1005/.test(a) && /↩️/.test(a), '**ورسالتك فيها «رد عليها يوصله»** كما كانت');
    ok(/@u5tg/.test(a), 'ومعرّفه من ملفه');
  }

  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log = realLog;
  console.log('انهار: ' + (e && e.stack || e));
  console.log(`\n${pass} نجحت · ${fail + 1} فشلت`);
  process.exit(1);
});
