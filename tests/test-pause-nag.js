/* المراقبة الموقوفة يدوياً ما تدخل التسجيل بصمت — اختبار سلوكي بنسخ سيرفر حقيقية و«خارج» مشترك.
   «⏸️ أوقف المراقبة» ما يرجع لحاله. كان لو بقى لين يوم التسجيل: ولا دورة ولا إنذار (الموقوفة «سليمة»)،
   واللوحة تقول «تستأنف تلقائياً الساعة 7 صباحاً» وهي ما تستأنف.
   ١) openBoot — موقوفة والنافذة شغّالة: تذكير عند الإقلاع، ثم كل ساعتين، والتشغيل يوقفه بلا «رجع طبيعي».
   ٢) night    — النافذة شغّالة بس خارج ساعات العمل: ولا تذكير لين تبدأ.
   ٣) soon     — قبل النافذة بيومين: تذكير باليوم من ٩ الصبح («بعد يومين» ثم «بكرة») ثم يوم النافذة «شغّال».
   ٤) far      — بعيد عن أي نافذة: ولا تذكير، واللوحة تقول «ما ترجع لحالها» (كانت «تستأنف تلقائياً»)،
                 ورسالة الإيقاف تقول متى التسجيل الجاي ومتى نذكّر. وقبله بأربعة أيام ولا تذكير، وبثلاثة تذكير.
   ٥) pauseIn  — إيقاف وسط النافذة: رسالته تقولها، وأول تذكير بعد ساعتين (لا فوراً)، واللوحة حمراء.
   ٦) noMon    — نسخة بلا مراقبة: ولا تذكير ولا وعد بتذكير، واللوحة ما تقول «تستأنف».
   ٧) hours    — خارج ساعات العمل (مو موقوفة): اللوحة تقول ساعة البداية الفعلية لا «7» دائماً.

   node tests/test-pause-nag.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-pause-nag';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
  /* ساعة السيرفر: على يوم بعينه، وتتقدّم برسالة من الأب ({warp: ms}) */
  let shift = at ? Date.parse(at.slice(5)) - Date.now() : 0;
  const now = Date.now.bind(Date);
  Date.now = () => now() + shift;
  process.on('message', m => { if (m && m.warp) shift += m.warp });
  const https = require('https');
  https.request = (opts, cb) => http.request({ hostname: '127.0.0.1', port: outPort, path: opts.path,
    method: opts.method, headers: Object.assign({}, opts.headers, { 'x-host': opts.hostname }) }, cb);
  Object.assign(process.env, {
    PORT: String(port), ADMIN_TOKEN: ADMIN, SITE_ENV: 'prod', ACTIVE_TERM: '202710',
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'false'
  });
  if (process.argv.includes('--nomon')) process.env.MONITOR_ENABLED = 'false';
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

/* ═══ قاعدة PostgREST-ية (نفس محاكي test-cycle-resume) ═══ */
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
  const st = { DB: o.DB, pmu: Object.assign({ hits: [] }, o.pmu), TG: [], nextId: 1000 };
  st.server = http.createServer((req, res) => {
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        const P = st.pmu;
        P.hits.push({ method: req.method, url: req.url, at: Date.now() });
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const g = new URLSearchParams(body).get('GenderList');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? P.F1 : g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
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
          const b = JSON.parse(body || '{}');
          /* حالة السيرفر: upsert بالمفتاح مثل merge-duplicates */
          if (t === 'app_state') (Array.isArray(b) ? b : [b]).forEach(x => {
            const i = list.findIndex(y => y.key === x.key);
            if (i >= 0) list[i] = Object.assign({}, list[i], x); else list.push(x);
          });
          else (Array.isArray(b) ? b : [b]).forEach(x => list.push(Object.assign({ id: st.nextId++ }, x)));
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
      json(200, { status: 1 });
    });
  });
  return new Promise(r => st.server.listen(0, '127.0.0.1', () => { st.port = st.server.address().port; r(st) }));
}

let PORTN = 23600 + (process.pid % 90);
function instance(st, extra) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child'].concat(extra || [], [String(st.port), String(port)]), { silent: true });
  const call = (p, method, payload) => new Promise(resolve => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET',
      headers: Object.assign({ 'X-Admin-Token': ADMIN }, data ? { 'Content-Type': 'application/json' } : {}) }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, j }) });
    });
    r.on('error', () => resolve({ status: 0, j: null }));
    if (data) r.write(data);
    r.end();
  });
  c.adm = (act, payload) => call('/api/admin/' + act, payload ? 'POST' : 'GET', payload);
  c.health = () => call('/api/admin/health').then(r => r.j || {});
  c.gen = async () => ((await c.health()).lastCycle || {}).gen || 0;
  c.warp = ms => c.send({ warp: ms });
  c.st = st;
  return c;
}
const ready = async c => {
  for (let i = 0; i < 150; i++) { if ((await c.health()).booted) return true; await wait(100) }
  return false;
};
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(250) } return !!(await fn()) };

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف (الحالة CLOSE لا CLOSED) ═══ */
const row = (crn, st) => [crn, 'MEEN 3311', 'Thermodynamics', '101', 'UT', '0930 - 1045', 'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st) => [crn, 'MEEN 3311', 'Thermodynamics', '201', 'UT', '0930 - 1045', 'Lee, Sara', 'F-CORE - 101', st];
const PMU = () => ({ M1: [row('30011', 'CLOSE')], F1: [frow('40011', 'CLOSE')] });
const base = toggles => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: toggles ? [{ key: 'runtime', value: { toggles } }] : [] });
const admin = st => st.TG.filter(m => m.chat === '5555');
/* التذكير نفسه (إنذار 🔴) — غير رسالة الإيقاف ⏸️ ورسالة التشغيل ▶️ */
const NAG = /🔴 <b>المراقبة موقوفة والتسجيل/;
const nags = st => admin(st).filter(m => NAG.test(m.text));
const posts = st => st.pmu.hits.filter(h => h.method === 'POST').length;
const pausedWarn = h => (h.warnings || []).find(w => /موقوفة يدوياً/.test(w.ar)) || null;
const stopWarn = h => (h.warnings || []).find(w => /^المراقبة متوقفة الآن/.test(w.ar)) || null;
const hasAlert = h => (h.alerts || []).some(a => a.key === 'paused');

/* فحص التذكير كل ربع دقيقة: «وصل» ننتظره لين ٢٢ ثانية، و«ما وصل» ننتظر دورة فحص كاملة وزيادة */
const SOON = 22000, QUIET = 18000;
const H = 3600e3, DAY = 24 * H;
/* ١٠ الصبح بالرياض داخل نافذة «تسجيل الترم الثاني» (2027-01-10 → 2027-01-21) */
const IN_WINDOW = '2027-01-19T07:00:00Z';

const SCEN = {
  async openBoot(t) {
    const st = await makeOutside({ DB: base({ monitorPaused: true }), pmu: PMU() });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    t.ok(await until(() => nags(st).length === 1, 6000),
      '**موقوفة يدوياً والنافذة شغّالة: الإقلاع ينبّه صاحب الموقع** — كان ولا رسالة والتسجيل يمر بلا مراقبة');
    const m = (nags(st)[0] || {}).text || '';
    t.ok(/المراقبة موقوفة والتسجيل شغّال/.test(m) && /تسجيل الترم الثاني/.test(m) && /2027-01-21/.test(m),
      'والتذكير يسمّي النافذة ولين متى — ' + m);
    t.ok(/ما ترجع لحالها/.test(m) && /شغّل المراقبة/.test(m) && /كل ساعتين/.test(m),
      'ويقول إنها ما ترجع لحالها، ومن وين تشتغل، ومتى التذكير الجاي');
    const h = await c.health(), w = pausedWarn(h);
    t.ok(w && w.level === 'bad' && /شغّالة الحين/.test(w.hint) && /ما ترجع لحالها/.test(w.hint),
      '**واللوحة حمراء: «موقوفة يدوياً» والنافذة شغّالة وما ترجع لحالها** — ' + JSON.stringify(w));
    t.ok(!(h.warnings || []).some(x => /تستأنف تلقائياً/.test(x.hint || '')),
      '**ولا «تستأنف تلقائياً» في اللوحة** (كانت تقولها للموقوفة يدوياً)');
    t.ok(hasAlert(h), 'والإنذار قائم في حالة السيرفر');

    await wait(QUIET);
    t.eq(nags(st).length, 1, 'وما يتكرر مع كل فحص — تذكير واحد');
    c.warp(1 * H);
    await wait(QUIET);
    t.eq(nags(st).length, 1, 'وبعد ساعة: لسا واحد');
    c.warp(1 * H + 5 * 60e3);
    t.ok(await until(() => nags(st).length === 2, SOON), '**وبعد ساعتين وهي لسا موقوفة: تذكير ثانٍ**');
    t.eq([await c.gen(), posts(st)], [0, 0], 'وطول ما هي موقوفة: ولا دورة ولا سحبة من الجامعة');

    const r = await c.adm('monitor-toggle', { on: true });
    t.ok(r.status === 200 && r.j && r.j.on === true, '«▶️ شغّل المراقبة» انقبلت');
    await until(() => admin(st).some(x => /▶️ <b>/.test(x.text)), 5000);
    const h2 = await c.health();
    t.ok(!hasAlert(h2) && !pausedWarn(h2), 'بعد التشغيل: الإنذار انمسح واللوحة ما تقول «موقوفة»');
    c.warp(3 * H);
    await wait(QUIET);
    t.eq(nags(st).length, 2, '**وبعد التشغيل ولا تذكير** — حتى بعد ثلاث ساعات');
    t.eq(admin(st).filter(x => /رجع طبيعي: المراقبة موقوفة/.test(x.text)).length, 0,
      'وبلا «رجع طبيعي» — رسالة التشغيل تكفي');
    t.eq(admin(st).filter(x => /▶️ <b>المراقبة رجعت تشتغل/.test(x.text)).length, 1, 'ورسالة التشغيل وصلت مرة');
    c.kill('SIGKILL');
  },

  async night(t) {
    /* ٢ الفجر بالرياض (١٩ يناير) — داخل النافذة وخارج ساعات العمل ٧–٢٤ */
    const st = await makeOutside({ DB: base({ monitorPaused: true }), pmu: PMU() });
    const c = instance(st, ['--at=2027-01-18T23:00:00Z']); await ready(c);
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'النافذة شغّالة بس الساعة ٢ الفجر: ولا تذكير (ما يفوت شي بالليل)');
    c.warp(5 * H + 5 * 60e3);                     /* صارت ٧:٠٥ الصبح */
    t.ok(await until(() => nags(st).length === 1, SOON), '**ومع بداية ساعات العمل: التذكير يوصل**');
    c.kill('SIGKILL');
  },

  async soon(t) {
    /* ٨ يناير ٦ الصبح بالرياض — النافذة تبدأ ١٠ يناير (بعد يومين) */
    const st = await makeOutside({ DB: base({ monitorPaused: true }), pmu: PMU() });
    const c = instance(st, ['--at=2027-01-08T03:00:00Z']); await ready(c);
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'قبل النافذة بيومين والساعة ٦ الصبح: ولا تذكير قبل ٩');
    const w = pausedWarn(await c.health());
    t.ok(w && w.level === 'bad' && /يبدأ بعد يومين \(2027-01-10\)/.test(w.hint),
      'واللوحة حمراء من الحين: التسجيل بعد يومين — ' + JSON.stringify(w));
    c.warp(3 * H + 5 * 60e3);                     /* ٩:٠٥ */
    t.ok(await until(() => nags(st).length === 1, SOON), '**قبل النافذة بيومين (من ٩ الصبح): تذكير**');
    const m = (nags(st)[0] || {}).text || '';
    t.ok(/المراقبة موقوفة والتسجيل قريب/.test(m) && /تسجيل الترم الثاني/.test(m) && /يبدأ بعد يومين \(2027-01-10\)/.test(m) &&
      /كل يوم/.test(m), 'ويقول متى يبدأ التسجيل وإنه يذكّر كل يوم — ' + m);
    c.warp(3 * H);                                /* ١٢:٠٥ نفس اليوم */
    await wait(QUIET);
    t.eq(nags(st).length, 1, 'ونفس اليوم: مرة وحدة');
    c.warp(21 * H);                               /* ٩ يناير ٩:٠٥ */
    t.ok(await until(() => nags(st).length === 2, SOON), '**واليوم اللي بعده: تذكير ثانٍ**');
    t.ok(/يبدأ بكرة \(2027-01-10\)/.test((nags(st)[1] || {}).text || ''), 'ويقول «بكرة» — ' + ((nags(st)[1] || {}).text || ''));
    c.warp(1 * DAY);                              /* ١٠ يناير ٩:٠٥ — النافذة فتحت */
    t.ok(await until(() => nags(st).length === 3, SOON), '**ويوم التسجيل وهي لسا موقوفة: تذكير «والتسجيل شغّال»**');
    t.ok(/المراقبة موقوفة والتسجيل شغّال/.test((nags(st)[2] || {}).text || ''), 'بعنوان النافذة الشغّالة — ' + ((nags(st)[2] || {}).text || ''));
    c.kill('SIGKILL');
  },

  async far(t) {
    /* ١٣ نوفمبر ٢٠٢٦، ١٠ الصبح — النافذة الجاية ١٠ يناير (بعد ٥٨ يوماً) */
    const st = await makeOutside({ DB: base({ monitorPaused: true }), pmu: PMU() });
    const c = instance(st, ['--at=2026-11-13T07:00:00Z']); await ready(c);
    const h = await c.health(), w = pausedWarn(h);
    t.ok(w && w.level === 'warn' && /ما ترجع لحالها/.test(w.hint) && /شغّل المراقبة/.test(w.hint),
      '**بعيد عن التسجيل: اللوحة تقول «موقوفة يدوياً — ما ترجع لحالها»** — ' + JSON.stringify(w));
    t.ok(!(h.warnings || []).some(x => /تستأنف تلقائياً/.test(x.hint || '')),
      '**ولا «تستأنف تلقائياً الساعة 7»** — كانت تقولها والموقوفة يدوياً ما تستأنف');
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'وبعيد عن التسجيل: ولا تذكير');

    /* شغّل ثم أوقف: رسالة الإيقاف تقول متى التسجيل الجاي ومتى نذكّر */
    await c.adm('monitor-toggle', { on: true });
    await c.adm('monitor-toggle', { on: false });
    await until(() => admin(st).some(x => /⏸️ <b>/.test(x.text)), 5000);
    const p = admin(st).filter(x => /⏸️ <b>/.test(x.text));
    t.ok(p.length === 1 && /تبقى موقوفة لين تشغّلها بنفسك/.test(p[0].text) && /تسجيل الترم الثاني/.test(p[0].text) &&
      /2027-01-10/.test(p[0].text) && /بنذكّرك قبله بـ3 أيام/.test(p[0].text),
      '**رسالة الإيقاف: ما ترجع لحالها مع التسجيل الجاي، ومتى نذكّر** — ' + (p[0] && p[0].text));

    c.warp(54 * DAY);                             /* ٦ يناير ١٠ الصبح: باقي ٤ أيام */
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'قبل النافذة بأربعة أيام: ولا تذكير بعد');
    c.warp(1 * DAY);                              /* ٧ يناير: باقي ٣ */
    t.ok(await until(() => nags(st).length === 1, SOON), '**وقبلها بثلاثة أيام: أول تذكير**');
    t.ok(/يبدأ بعد 3 أيام \(2027-01-10\)/.test((nags(st)[0] || {}).text || ''), 'ويقول «بعد 3 أيام» — ' + ((nags(st)[0] || {}).text || ''));
    c.kill('SIGKILL');
  },

  async pauseIn(t) {
    /* شغّالة داخل النافذة، ثم «⏸️ أوقف المراقبة» */
    const st = await makeOutside({ DB: base(), pmu: PMU() });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    t.ok(!pausedWarn(await c.health()), 'شغّالة: اللوحة ما تقول «موقوفة»');
    const r = await c.adm('monitor-toggle', { on: false });
    t.ok(r.status === 200 && r.j && r.j.on === false, '«⏸️ أوقف المراقبة» انقبلت');
    await until(() => admin(st).some(x => /⏸️ <b>/.test(x.text)), 5000);
    const p = admin(st).filter(x => /⏸️ <b>/.test(x.text));
    t.ok(p.length === 1 && /⚠️ نافذة «تسجيل الترم الثاني» شغّالة الحين/.test(p[0].text) && /ما ترجع لحالها/.test(p[0].text) &&
      /بنذكّرك كل ساعتين/.test(p[0].text),
      '**إيقاف وسط النافذة: الرسالة تقول إن التسجيل شغّال وإننا بنذكّر كل ساعتين** — ' + (p[0] && p[0].text));
    const w = pausedWarn(await c.health());
    t.ok(w && w.level === 'bad', 'واللوحة حمراء — ' + JSON.stringify(w));
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'وأول تذكير مو فوراً (رسالة الإيقاف وصلته للتو)');
    c.warp(1 * H);
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'ولا بعد ساعة');
    c.warp(1 * H + 5 * 60e3);
    t.ok(await until(() => nags(st).length === 1, SOON), '**وبعد ساعتين وهي موقوفة: التذكير يوصل**');
    c.kill('SIGKILL');
  },

  async noMon(t) {
    /* نسخة بلا مراقبة (MONITOR_ENABLED=false): ما تراقب أصلاً — ولا تذكير ولا وعد بتذكير */
    const st = await makeOutside({ DB: base({ monitorPaused: true }), pmu: PMU() });
    const c = instance(st, ['--at=' + IN_WINDOW, '--nomon']); await ready(c);
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'نسخة بلا مراقبة: ولا تذكير');
    const h = await c.health(), w = stopWarn(h);
    t.ok(w && /معطّلة في هذي النسخة/.test(w.ar) && /MONITOR_ENABLED/.test(w.hint),
      'واللوحة تقول ليش هي واقفة (المتغيّر) — ' + JSON.stringify(w));
    t.ok(!(h.warnings || []).some(x => /تستأنف تلقائياً/.test(x.hint || '')),
      '**ولا «تستأنف تلقائياً»** — نسخة بلا مراقبة ما تستأنف (كانت تقولها)');
    await c.adm('monitor-toggle', { on: true });
    await c.adm('monitor-toggle', { on: false });
    await until(() => admin(st).some(x => /⏸️ <b>/.test(x.text)), 5000);
    const p = admin(st).filter(x => /⏸️ <b>/.test(x.text));
    t.ok(p.length === 1 && !/بنذكّرك/.test(p[0].text), 'ورسالة الإيقاف بلا وعد بتذكير ما يجي — ' + (p[0] && p[0].text));
    c.kill('SIGKILL');
  },

  async hours(t) {
    /* الساعات من اللوحة ١٢–٢٤ والساعة ١٠ (مو موقوفة): خارج ساعات العمل */
    const st = await makeOutside({ DB: base({ hoursOverride: { from: 12, to: 24 } }), pmu: PMU() });
    const c = instance(st, ['--at=' + IN_WINDOW]); await ready(c);
    const h = await c.health(), w = stopWarn(h);
    t.ok(w && /خارج ساعات العمل/.test(w.ar) && /تستأنف تلقائياً الساعة 12:00/.test(w.hint),
      '**خارج ساعات العمل: اللوحة تقول ساعة البداية الفعلية (١٢)** — كانت «7 صباحاً» دائماً — ' + JSON.stringify(w));
    t.ok(!pausedWarn(h), 'وما تقول «موقوفة يدوياً» — هي مو موقوفة');
    await wait(QUIET);
    t.eq(nags(st).length, 0, 'وخارج ساعات العمل بلا إيقاف يدوي: ولا تذكير');
    c.kill('SIGKILL');
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`الموقوفة يدوياً: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
