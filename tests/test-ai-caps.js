/* سقوف المساعد من اللوحة — اختبار سلوكي على السيرفر الحقيقي.
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور Supabase والنموذج.

   الخطر: زر «السقوف» في اللوحة يرسل أربعة (اليومي · المجاني · الترمي ·
   الشهري)، والسيرفر كان يبني السقوف من الأربعة بالاسم — فيسقط سقفا
   الزوار (guestDay · guestMonthSar) مع أول حفظ، والزائر يسأل بلا حد
   يومي ولا شهري حتى النشر الجاي. فلوس لا خصوصية: الزائر بلا حساب.

   node tests/test-ai-caps.js [server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

/* حالة محفوظة من قبل فصل القنوات (هالشهر): مجموع الزوار بلا ch —
   الاسترجاع لازم يبقيه في المجموع ويبدأ القنوات من صفر */
const RIYADH = new Date(Date.now() + 3 * 3600e3).toISOString();
const DB = { app_state: [{ key: 'runtime', value: { toggles: { aiGuest: {
               ym: RIYADH.slice(0, 7), ymd: RIYADH.slice(0, 10), micro: 5000, questions: 2, ips: [] } } } }],
             app_events: [], ai_usage: [], ai_threads: [] };
function supabase(method, urlPath, body) {
  const [p] = urlPath.split('?');
  const table = p.replace('/rest/v1/', '');
  const L = DB[table] || (DB[table] = []);
  if (method === 'POST' && table === 'app_state') {
    const b = JSON.parse(body || '{}');
    const i = L.findIndex(x => x.key === b.key);
    if (i >= 0) L[i] = b; else L.push(b);
    return [201, []];
  }
  /* عرض القنوات ما انخلق (الـSQL ما انشغّل) ⇒ رد PostgREST الحقيقي */
  if (method === 'GET' && table === 'ai_spend_channel')
    return [404, { code: 'PGRST205',
                   message: "Could not find the table 'public.ai_spend_channel' in the schema cache" }];
  if (method === 'GET') return [200, L.slice(0, 1000)];
  return [201, []];
}
let ASKED = 0;
const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { return req }, setTimeout() { return req }, destroy() {},
    write(d) { chunks.push(d) },
    end(d) {
      if (d) chunks.push(d);
      let code = 200, o = [];
      const body = chunks.join('');
      if (host === 'api.anthropic.com') {
        ASKED++;
        o = { id: 'm', type: 'message', role: 'assistant',
              content: [{ type: 'text', text: 'التقويم فيه كذا' }], stop_reason: 'end_turn',
              usage: { input_tokens: 50, output_tokens: 10 } };
      } else if (opts.path && opts.path.startsWith('/auth/v1/user')) {
        code = 401; o = { msg: 'invalid JWT' };
      } else if (host === 'api.telegram.org' || host.includes('pmu.edu.sa')) {
        o = host === 'api.telegram.org' ? { ok: true, result: {} } : [];
      } else {
        [code, o] = supabase(opts.method, opts.path, body);
      }
      const txt = JSON.stringify(o);
      const res = new Readable({ read() { this.push(txt); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const PORT = 48000 + (process.pid % 100);
Object.assign(process.env, {
  SITE_ENV: 'prod', PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests',
  ADMIN_CHAT_ID: '5555', TELEGRAM_TOKEN: 'tg', ANTHROPIC_API_KEY: 'sk-test-key',
  ACTIVE_TERM: '203010', FREE_BETA: 'true', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k',
});
const realLog = console.log;
console.log = () => {};
require(SRV);

function call(method, p, { body, admin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = {};
    if (data) h['Content-Type'] = 'application/json';
    if (admin) h['X-Admin-Token'] = 'admin-token-for-tests';
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { let j; try { j = JSON.parse(o) } catch (e) { j = o } resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end(data || undefined);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await wait(300);
  let r = await call('POST', '/api/admin/ai', { admin: true, body: { mode: 'all' } });
  const def = r.j && r.j.caps || {};
  eq([def.guestDay, def.guestMonthSar], [3, 30], 'سقفا الزوار الافتراضيان: ٣ باليوم · ٣٠ ريال بالشهر');

  /* بالضبط ما يرسله زر «السقوف» في اللوحة (admin.html → aiSetCaps) */
  r = await call('POST', '/api/admin/ai', { admin: true,
    body: { caps: { day: 30, dayFree: 6, term: 300, monthSar: 250 } } });
  const c = r.j && r.j.caps || {};
  eq([c.day, c.dayFree, c.term, c.monthSar], [30, 6, 300, 250], 'السقوف الأربعة انحفظت');
  eq([c.guestDay, c.guestMonthSar], [3, 30],
     '**وسقفا الزوار باقيان بعد حفظ اللوحة** — ما يسقطان لأنها ما أرسلتهما');
  const saved = (DB.app_state[0] && DB.app_state[0].value.toggles.aiCaps) || {};
  eq([saved.guestDay, saved.guestMonthSar], [3, 30], 'والمحفوظ في app_state فيه الاثنين');

  /* السلوك نفسه: الزائر الرابع في اليوم يوقف */
  const asks = [];
  for (let i = 0; i < 4; i++)
    asks.push((await call('POST', '/api/me/ai', { body: { q: 'متى يبدأ التسجيل؟' } })).j);
  eq(asks.slice(0, 3).map(a => a.ok), [true, true, true], 'الزائر: ثلاثة أسئلة تنجاوب');
  eq([asks[3].ok, asks[3].why], [false, 'day'], '**والرابع يوقف عند سقف الزوار اليومي**');
  eq(ASKED, 3, '**وما انصرف على النموذج إلا ثلاثة**');

  /* وسقف الزوار يتعدّل من الـAPI صريحاً لو أرسلناه */
  r = await call('POST', '/api/admin/ai', { admin: true, body: { caps: { guestDay: 5 } } });
  const c2 = (r.j && r.j.caps) || {};
  eq([r.code, c2.guestDay, c2.guestMonthSar, c2.day], [200, 5, 30, 30],
     'تعديل واحد منها ما يلمس الباقي');

  /* ── حسب القناة: اللوحة تشوف الزوار (لقاها محمد: الصفحة ما تعرض تلقرام) ── */
  r = await call('GET', '/api/admin/ai', { admin: true });
  const gc = (r.j && r.j.guestChannels) || {};
  eq([gc.web && gc.web.questions, gc.tg && gc.tg.questions, gc.before], [3, 0, 2],
     '**الزوار في اللوحة حسب القناة: الموقع ٣ · تلقرام ٠** — و٢ قبل الفصل (من الحالة المحفوظة)');
  const sp = (r.j && r.j.spend) || {};
  eq([sp.guestQuestions, sp.questions], [5, 5], '**وأسئلة الزوار داخل مجموع الشهر** — كانت صفراً');
  eq(r.j && r.j.channels, null, 'وعرض القنوات ناقص في القاعدة ⇒ null لا أصفار');
  const sg = ((DB.app_state.find(x => x.key === 'runtime') || {}).value || {}).toggles || {};
  eq(sg.aiGuest && sg.aiGuest.ch && sg.aiGuest.ch.web && sg.aiGuest.ch.web.questions, 3,
     '**والعدّاد حسب القناة محفوظ في app_state** — يصمد بعد النشر');
}

main().then(() => {
  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log('انهار: ' + (e && e.stack || e));
  process.exit(1);
});
