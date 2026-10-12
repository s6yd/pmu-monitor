/* المراقبة ما تعلق للأبد — اختبار سلوكي بشبكة حقيقية.
   كانت مهلة كل طلب خارجي على **السكوت** لا على المدة، والاتصال اللي ينقطع وسط الرد ما
   يطلق end ولا error (Node 22) — فالوعد يعلق للأبد ومعه قفل دورة المراقبة: كل الدورات
   بعدها تتخطّى، والمراقبة ميتة لين أول نشر (جرّبناه: شعبة فتحت وصفر إشعارات).
   هنا كل «الخارج» خادم محلي حقيقي (الجامعة · القاعدة · تيليغرام)، فالانقطاع والتقطير
   والسكوت سلوك شبكة حقيقي لا محاكاة:
   ١) cut     — الجامعة تقطع الاتصال وسط الجدول ⇒ الدورة تخلص، واللي بعدها تنبّه الطالب.
   ٢) trickle — صفحة الرمز تقطّر حرفاً كل ثانية بلا نهاية ⇒ الحد المطلق (٢٠ ثانية) يوقفها.
   ٣) tg      — تيليغرام ما يرد على رسالة الطالب ⇒ مهلة ٢٠ ثانية (كان بلا مهلة أبداً).
   ٤) sb      — القاعدة تقطع الرد ⇒ الدورة تخلص بخطأ، واللي بعدها تشتغل.
   ٥) stuck   — تعليق من مصدر ما نعرفه ⇒ بعد ٨ دقائق نفكّ القفل وننذر، والقديمة لو صحت
                ما ترسل (CYCLE_GEN) — الطالب يوصله إشعار واحد مو اثنين.

   node tests/test-hang-guard.js [server.js]
   (كل سيناريو عملية مستقلة — قفل الدورة في ذاكرة السيرفر) */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=main').slice(7);

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${MODE}] ` + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ الجدول — بترتيب أعمدة parseHTML وصيغة الجامعة ═══ */
const ROWS = {
  M1: [['30011', 'MEEN 3311', 'Thermodynamics', '101', 'UT', '0930 - 1045', 'Smith, John', 'M-CORE - G034', 'OPEN'],
       ['30012', 'MEEN 3311', 'Thermodynamics', '102', 'MW', '1100 - 1215', 'Smith, John', 'M-CORE - G035', 'CLOSED']],
  F1: [['40011', 'MEEN 3311', 'Thermodynamics', '201', 'UT', '0930 - 1045', 'Lee, Sara', 'F-CORE - 101', 'CLOSED']]
};
const table = g => '<table><tbody>' + (g === 'F1' ? ROWS.F1 : g === 'M1' ? ROWS.M1 : ROWS.M1.concat(ROWS.F1))
  .map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</tbody></table>';

/* ═══ القاعدة ═══ */
const DB = { monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  /* بلا دورات مجدولة — الفحص اليدوي وحده */
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true } } }] };
let nextId = 1;
function filt(rows, qs) {
  let r = rows.slice();
  for (const m of qs.matchAll(/(?:^|&)([a-z_]+)=(eq|neq|lt|lte|gt|gte|in|is|not\.is)\.([^&]*)/g)) {
    const [, col, op, v] = m;
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    r = r.filter(x => {
      const a = x[col];
      if (op === 'eq') return a != null && String(a) === v;
      if (op === 'neq') return a == null || String(a) !== v;
      if (op === 'is') return v === 'null' ? a == null : String(a) === v;
      if (op === 'not.is') return v === 'null' ? a != null : String(a) !== v;
      if (op === 'in') return new Set(v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, ''))).has(String(a));
      if (a == null) return false;
      const A = Date.parse(a), V = Date.parse(v);
      const c = Number.isFinite(A) && Number.isFinite(V) ? A - V : (String(a) < v ? -1 : String(a) > v ? 1 : 0);
      return op === 'lt' ? c < 0 : op === 'lte' ? c <= 0 : op === 'gt' ? c > 0 : c >= 0;
    });
  }
  return r;
}
function supabase(method, urlPath, body) {
  const [p, raw = ''] = urlPath.split('?');
  let qs; try { qs = decodeURIComponent(raw) } catch (e) { qs = raw }
  const t = p.replace('/rest/v1/', '');
  const list = DB[t] || (DB[t] = []);
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (t !== 'app_state') (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: nextId++ }, x)));
    return [];
  }
  if (method === 'PATCH') {
    const b = JSON.parse(body || '{}');
    const hit = filt(list, qs);
    hit.forEach(x => Object.assign(x, b));
    return hit.map(x => Object.assign({}, x));
  }
  if (method === 'DELETE') {
    const hit = filt(list, qs);
    DB[t] = list.filter(x => !hit.includes(x));
    return hit;
  }
  let r = filt(list, qs);
  const off = /(?:^|&)offset=(\d+)/.exec(qs), lim = /(?:^|&)limit=(\d+)/.exec(qs);
  if (off) r = r.slice(Number(off[1]));
  return r.slice(0, lim ? Number(lim[1]) : 1000).map(x => Object.assign({}, x));
}

/* ═══ «الخارج»: خادم محلي حقيقي، والطلب يقول لأي مضيف كان رايح ═══ */
const PMU = [], TG = [];
const FAULT = { pmuPost: null, pmuGet: null, tgStudent: null, sbFollowups: null, sbCut: null };
const outside = http.createServer((req, res) => {
  const host = req.headers['x-host'];
  let body = '';
  req.setEncoding('utf8');
  req.on('data', c => body += c);
  req.on('end', () => {
    if (host === 'masterschedule.pmu.edu.sa') {
      const q = new URLSearchParams(body);
      PMU.push({ path: req.url, gender: q.get('GenderList') });
      if (req.url === '/' && FAULT.pmuGet === 'trickle') {
        FAULT.pmuGet = null;                               /* أول صفحة رمز بس */
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const t = setInterval(() => { if (res.destroyed) return clearInterval(t); res.write('x') }, 1000);
        res.on('close', () => clearInterval(t));
        return;
      }
      if (req.url === '/Home/getData' && FAULT.pmuPost === 'cut') {
        FAULT.pmuPost = null;                              /* أول جدول بس */
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('<table><tbody><tr><td>30011</td>');
        return setTimeout(() => req.socket.destroy(), 150);
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['ASP.NET_SessionId=abc; path=/'] });
        return res.end('<form><input name="__RequestVerificationToken" type="hidden" value="tok"></form>');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(table(q.get('GenderList')));
    }
    if (host === 'api.telegram.org') {
      let b = {}; try { b = JSON.parse(body) } catch (e) {}
      const student = String(b.chat_id) === '901';
      if (/sendMessage$/.test(req.url) && student && FAULT.tgStudent === 'hang') {
        FAULT.tgStudent = null;                            /* أول رسالة للطالب: لا رد أبداً */
        return;
      }
      if (/sendMessage$/.test(req.url)) TG.push({ chat: String(b.chat_id), text: String(b.text || '') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }
    if (host === 'fake.supabase.co') {
      if (FAULT.sbFollowups === 'stall' && /followup_done=eq\.false/.test(req.url)) {
        FAULT.sbFollowups = null;                          /* سكوت تام والاتصال مفتوح */
        return;
      }
      const data = JSON.stringify(supabase(req.method, req.url, body));
      if (FAULT.sbCut && req.method === 'GET' && req.url.includes('/rest/v1/' + FAULT.sbCut)) {
        FAULT.sbCut = null;                                /* الرد يبدأ ثم ينقطع */
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(data.slice(0, Math.max(1, Math.floor(data.length / 2))));
        return setTimeout(() => req.socket.destroy(), 150);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 1 }));
  });
});

const PORT = 47250 + (process.pid % 50), ADMIN = 'admin-token-for-hang-guard';
const https = require('https');
https.request = function (opts, cb) {
  return http.request({ hostname: '127.0.0.1', port: outside.address().port, path: opts.path,
    method: opts.method, headers: Object.assign({}, opts.headers, { 'x-host': opts.hostname }) }, cb);
};

function call(p, token) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET',
      headers: token ? { 'X-Admin-Token': token } : {} }, res => {
      let o = ''; res.setEncoding('utf8'); res.on('data', c => o += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(o) } catch (e) {} resolve({ code: res.statusCode, j }) });
    });
    r.on('error', reject); r.end();
  });
}
const check = () => call('/api/run-check', ADMIN);
const posts = () => PMU.filter(x => x.path === '/Home/getData').length;
const student = () => TG.filter(m => m.chat === '901');
const admin = re => TG.filter(m => m.chat === '5555' && re.test(m.text));
function watch(crn, last) {
  DB.monitored_courses.push({ id: nextId++, user_id: 'u1', scope: 'section', course_code: 'MEEN 3311', crn,
    term: '202710', last_status: last, followup_done: true, followup_at: null, expires_at: null,
    sections_state: null, created_at: new Date(Date.now() - 864e5).toISOString() });
}
/* ننتظر الشرط (أو المهلة) بدل وقت ثابت */
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(250) } return fn() }

const SCEN = {
  async cut() {
    FAULT.pmuPost = 'cut';
    await check();
    ok(await until(() => posts() >= 2, 8000), 'الدورة كمّلت بعد الانقطاع: سحبت جدول الطالبات بعده');
    await wait(4000);                                      /* تخلص الدورة الأولى */
    const before = posts();
    await check();
    ok(await until(() => student().length === 1, 10000),
       '**انقطع الاتصال وسط الجدول ⇒ الدورة اللي بعدها اشتغلت ونبّهت الطالب** — ما علقت للأبد');
    ok(posts() > before, 'والدورة الثانية سحبت من الجامعة فعلاً (ما تخطّت)');
  },
  async trickle() {
    FAULT.pmuGet = 'trickle';
    const t0 = Date.now();
    await check();
    ok(await until(() => posts() >= 1, 30000),
       '**صفحة الرمز تقطّر بلا نهاية ⇒ وقفناها بالحد المطلق** وكمّلنا للطالبات');
    const took = (Date.now() - t0) / 1000;
    ok(took < 28, `خلال حد المدة لا للأبد — ${took.toFixed(1)} ثانية`);
    await wait(5000);
    await check();
    ok(await until(() => student().length === 1, 10000), 'والدورة اللي بعدها نبّهت الطالب');
  },
  async tg() {
    FAULT.tgStudent = 'hang';
    await check();
    ok(await until(() => posts() >= 2, 8000), 'الدورة سحبت الجدول ووصلت الإرسال');
    /* تيليغرام ما رد: كانت الدورة تعلق للأبد (طلبات تيليغرام بلا أي مهلة) */
    watch('30012', 'CLOSED');
    ROWS.M1[1][8] = 'OPEN';                                /* شعبة ثانية فتحت */
    await wait(23000);                                     /* حد تيليغرام ٢٠ ثانية */
    const before = posts();
    await check();
    ok(await until(() => student().some(m => m.text.includes('30012')), 12000),
       '**تيليغرام علّق رسالة ⇒ بعد حد المدة كمّلت الدورة، واللي بعدها وصّلت الفتحة الثانية**');
    ok(posts() > before, 'والدورة الثانية اشتغلت فعلاً');
  },
  async sb() {
    FAULT.sbCut = 'monitored_courses';
    await check();
    await wait(6000);
    await check();
    ok(await until(() => student().length === 1, 12000),
       '**القاعدة قطعت ردها ⇒ الدورة خلصت بخطأ، واللي بعدها نبّهت الطالب**');
  },
  async stuck() {
    FAULT.sbFollowups = 'stall';                           /* أول سؤال في الدورة: سكوت تام */
    await check();
    await wait(2000);
    eq(student().length, 0, 'الدورة الأولى عالقة');
    /* مرّت ٩ دقائق (نقدّم الساعة) — والدورة لسا عالقة */
    const realNow = Date.now;
    Date.now = () => realNow() + 9 * 60 * 1000;
    const r = await check();
    eq(r.code, 200, 'فحص جديد');
    ok(await until(() => student().length === 1, 12000), '**بعد ٨ دقائق عالقة: فكّينا القفل والدورة الجديدة نبّهت الطالب**');
    ok(admin(/دورة المراقبة علقت/).length === 1, 'ووصلك «دورة المراقبة علقت» — مرة');
    /* القديمة تصحى بعد حد القاعدة (٣٠ ثانية): ما ترسل مرة ثانية */
    await wait(36000);
    eq(student().length, 1, '**والدورة القديمة لما صحت ما أرسلت ثانية** — إشعار واحد مو اثنين');
  }
};

async function child() {
  Object.assign(process.env, {
    PORT: String(PORT), ADMIN_TOKEN: ADMIN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false'
  });
  DB.profiles.push({ id: 'u1', telegram_chat_id: '901', is_pro: true, subscription_expires_at: null,
    pushover_key: null, pushover_until: null });
  watch('30011', 'CLOSED');
  await new Promise(r => outside.listen(0, '127.0.0.1', r));
  const realLog = console.log;
  console.log = () => {};
  require(SRV);
  await wait(800);
  try { await SCEN[MODE]() } catch (e) { fail++; out.push(`  ✗ [${MODE}] انهار: ` + (e && e.stack || e)) }
  console.log = realLog;
  if (out.length) console.log(out.join('\n'));
  console.log(`${pass} نجحت · ${fail} فشلت`);
  process.exit(0);
}

async function main() {
  const res = await Promise.all(Object.keys(SCEN).map(m => new Promise(resolve => {
    const c = fork(__filename, [SRV, '--mode=' + m], { silent: true });
    let o = '';
    c.stdout.on('data', d => o += d);
    const kill = setTimeout(() => c.kill('SIGKILL'), 150000);
    c.on('exit', () => { clearTimeout(kill); resolve([m, o]) });
  })));
  for (const [m, o] of res) {
    const r = /(\d+) نجحت · (\d+) فشلت/.exec(o);
    if (r) { pass += +r[1]; fail += +r[2] } else { fail++; out.push(`  ✗ [${m}] ما رجع نتيجة`) }
    for (const l of o.split('\n')) if (/✗/.test(l)) out.push(l);
  }
  if (out.length) console.log(out.join('\n'));
  console.log(`التعليق: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}

if (MODE === 'main') main(); else child();
