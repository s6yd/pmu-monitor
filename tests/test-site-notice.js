/* إعلان فوق الموقع — طلب محمد (٢٠ نوفمبر ٢٠٢٦: صيانة بانر عند الجامعة من ١٩ لين ٢٥ نوفمبر وقّفت موقع جدولهم، والطلاب
   يحسبون البحث خربان عندنا — «ودي نحط اعلان صغير فوق في موقعنا عن انه المشكلة مو من عندنا»، ثم «خليه بس اعلان بسيط فوق
   اقدر احطه واطفيه من لوحة التحكم»). نسخ سيرفر حقيقية و«خارج» مشترك (الجدول · بانر · القاعدة · تيليغرام):
   ١) publish — ينشره من اللوحة (برمزها وحده) ويوصل الصفحة في حالة الموقع، بنص نظيف (سطر واحد · بلا محارف تحكم ولا
                تضمين اتجاه · ٣٠٠ حرف بالكثير)، وينحفظ مع الحالة، ونشر جديد للموقع ما يشيله (بنفس رقمه).
   ٢) off     — «أطفه»: ما يطلع للصفحة، ونصّه باقٍ للوحة، ويبقى مطفي بعد نشر للموقع، ونشره ثانية برقم جديد.
   ٣) env     — لكل بيئة إعلانها (القاعدة مشتركة): إعلان dev ما يطلع في الإنتاج.
   ٤) search  — موقع الجدول واقف وما عندنا نسخة ولا بانر: «المشكلة من الجامعة» بدل «PMU token timeout» (وreason للصفحة).

   node tests/test-site-notice.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-site-notice';
const NOW = '2026-11-20T09:00:00Z';                    /* خارج التسجيل */
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
  const env = (process.argv.find(a => a.startsWith('--env=')) || '--env=prod').slice(6);
  let shift = at ? Date.parse(at.slice(5)) - Date.now() : 0;
  const now = Date.now.bind(Date);
  Date.now = () => now() + shift;
  process.on('message', m => { if (m && m.warp) shift += m.warp });
  const https = require('https');
  https.request = (opts, cb) => http.request({ hostname: '127.0.0.1', port: outPort, path: opts.path,
    method: opts.method, headers: Object.assign({}, opts.headers, { 'x-host': opts.hostname }) }, cb);
  Object.assign(process.env, {
    PORT: String(port), ADMIN_TOKEN: ADMIN, SITE_ENV: env, ACTIVE_TERM: '202710',
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

/* ═══ قاعدة PostgREST-ية (نفس محاكي test-banner-search) ═══ */
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

/* الجدول: down (ينقطع — «PMU token timeout» وأخواتها بلا نوع) · 503 (نوعه down) · format (صفحة بلا رمز) */
function makeOutside(o) {
  const st = { DB: o.DB, pmu: Object.assign({ hits: 0, mode: 'down' }, o.pmu), ban: { hits: 0 }, TG: [], nextId: 1000 };
  st.server = http.createServer((req, res) => {
    const host = req.headers['x-host'];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = (code, j) => { if (res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) };
      if (host === 'masterschedule.pmu.edu.sa') {
        st.pmu.hits++;
        if (st.pmu.mode === 'down') return req.socket.destroy();
        if (st.pmu.mode === '503') { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end('<title>Service Unavailable</title>') }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><title>Banner Maintenance</title><body>We are down for maintenance</body></html>');
      }
      if (host === 'banreg.pmu.edu.sa') { st.ban.hits++; return req.socket.destroy() }   /* بانر نفسه في الصيانة */
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body) } catch (e) {}
        if (/sendMessage$/.test(req.url)) st.TG.push({ chat: String(b.chat_id), text: String(b.text || '') });
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
        const lim = /(?:^|&)limit=(\d+)/.exec(qs);
        return json(200, filt(list, qs).slice(0, lim ? Number(lim[1]) : 1000));
      }
      json(200, { status: 1 });
    });
  });
  return new Promise(r => st.server.listen(0, '127.0.0.1', () => { st.port = st.server.address().port; r(st) }));
}

let PORTN = 20700 + (process.pid % 45) * 2;
function instance(st, opt) {
  opt = opt || {};
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child', '--at=' + (opt.at || NOW), '--env=' + (opt.env || 'prod'),
    String(st.port), String(port)], { silent: true });
  const call = (p, method, h, body) => new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET',
      headers: Object.assign({}, h || {}, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, j }) });
    });
    r.on('error', () => resolve({ status: 0, headers: {}, j: null })); if (data) r.write(data); r.end();
  });
  const A = { 'X-Admin-Token': ADMIN };
  c.health = () => call('/api/admin/health', 'GET', A).then(r => r.j || {});
  c.notice = (body, h) => call('/api/admin/site-notice', 'POST', h === undefined ? A : h, body);
  c.status = () => call('/api/monitor-status').then(r => (r.j || {}));
  c.search = () => call('/api/courses?term=202710&college=ALL&gender=ALL');
  c.warp = ms => c.send({ warp: ms });
  c.stop = () => new Promise(r => { c.on('exit', r); c.kill('SIGKILL') });
  return c;
}
const ready = async c => {
  for (let i = 0; i < 150; i++) {
    const h = await c.health();
    if (h.booted || (h.uptimeHours !== undefined && !('booted' in h))) return true;
    await wait(100);
  }
  return false;
};
const base = () => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: { toggles: { monitorPaused: true } } },
              { key: 'runtime-dev', value: { toggles: { monitorPaused: true } } }] });
const savedOf = (st, key) => ((((st.DB.app_state || []).find(x => x.key === (key || 'runtime')) || {}).value || {}).toggles || {}).siteNotice;
/* محارف ما تنكتب حرفياً في المصدر (§ الصفحة): نبنيها برقمها */
const CH = n => String.fromCharCode(n);
const AR = 'المشكلة من الجامعة';

const SCEN = {
  async publish(t) {
    const st = await makeOutside({ DB: base() });
    const c = instance(st); await ready(c);
    t.eq((await c.status()).notice, null, 'قبل النشر: ما فيه إعلان في حالة الموقع');
    let r = await c.notice({ ar: 'نص' }, {});
    t.eq(r.status, 401, 'بلا رمز اللوحة: مرفوض');
    r = await c.notice({ ar: '   ' });
    t.ok(r.status === 400 && /اكتب نص الإعلان/.test(r.j && r.j.error), 'بلا نص: «اكتب نص الإعلان» — ' + JSON.stringify(r.j));
    r = await c.notice({ ar: 'ا'.repeat(301) });
    t.ok(r.status === 400 && /طويل/.test(r.j && r.j.error), 'فوق ٣٠٠ حرف: مرفوض');
    t.eq((await c.status()).notice, null, 'والمرفوض ما ينشر شي');

    const raw = '⚠️ أنظمة الجامعة متوقفة' + '\n\n' + CH(0x202e) + 'للصيانة' + CH(7) + ' <b>لين</b>   الأربعاء';
    r = await c.notice({ ar: raw });
    t.eq(r.status, 200, '**النشر برمز اللوحة — نص وبس** (بلا وقت انتهاء)');
    const n = (await c.status()).notice || {};
    t.eq(n.ar, '⚠️ أنظمة الجامعة متوقفة للصيانة <b>لين</b> الأربعاء',
      '**يوصل الصفحة في حالة الموقع، سطراً واحداً بلا محارف تحكم ولا تضمين اتجاه** (والصفحة تهرّب الوسوم)');
    t.ok(n.v > 0 && Object.keys(n).sort().join() === 'ar,v', 'ومعه رقم (v) — ✕ الطالب يقفل هالإعلان بس — ' + JSON.stringify(n));
    const h = await c.health();
    t.ok(h.siteNoticeLive === true && h.siteNotice && h.siteNotice.ar === n.ar, 'اللوحة تشوفه (siteNotice · siteNoticeLive)');
    const sv = savedOf(st);
    t.ok(sv && sv.ar === n.ar && sv.v === n.v && sv.on === true, '**ينحفظ مع الحالة** (بلاه ينشال مع كل نشر) — ' + JSON.stringify(sv));
    await c.stop();

    const c2 = instance(st); await ready(c2);
    const n2 = (await c2.status()).notice || {};
    t.eq([n2.ar, n2.v], [n.ar, n.v], '**نشر جديد للموقع: الإعلان باقٍ بنفس رقمه** (اللي قفله يبقى مقفول)');
    c2.warp(30 * 864e5);
    await wait(150);
    t.eq(((await c2.status()).notice || {}).ar, n.ar, '**ويبقى لين يطفيه** (ما ينتهي لحاله — بعد ٣٠ يوم باقٍ)');
    await c2.stop(); st.server.close();
  },

  async off(t) {
    const st = await makeOutside({ DB: base() });
    const c = instance(st); await ready(c);
    await c.notice({ ar: 'إعلان تجربة' });
    const n = (await c.status()).notice || {};
    t.ok(n.ar === 'إعلان تجربة', 'منشور');
    const r = await c.notice({ on: false });
    t.ok(r.status === 200 && r.j && r.j.live === false, '«أطفه» من اللوحة');
    t.eq((await c.status()).notice, null, '**بعد «أطفه» ما يطلع للصفحة**');
    const h = await c.health();
    t.ok(h.siteNoticeLive === false && h.siteNotice && h.siteNotice.ar === 'إعلان تجربة',
      'ونصّه باقٍ للوحة (تعيد نشره بضغطة) — ' + JSON.stringify(h.siteNotice));
    t.ok((savedOf(st) || {}).on === false, 'والمحفوظ مطفي');
    await c.stop();
    const c2 = instance(st); await ready(c2);
    t.eq((await c2.status()).notice, null, '**ويبقى مطفي بعد نشر للموقع**');
    c2.warp(3600e3); await wait(150);                      /* بعد ساعة */
    await c2.notice({ ar: 'إعلان تجربة' });
    const n2 = (await c2.status()).notice || {};
    t.ok(n2.ar === 'إعلان تجربة' && n2.v !== n.v, '**ونشره ثانية يرجّعه برقم جديد** (يطلع حتى للي قفله) — ' + JSON.stringify([n.v, n2.v]));
    await c2.stop(); st.server.close();
  },

  async env(t) {
    const st = await makeOutside({ DB: base() });
    const d = instance(st, { env: 'dev' }); await ready(d);
    await d.notice({ ar: 'إعلان نسخة التجربة' });
    t.ok(((await d.status()).notice || {}).ar === 'إعلان نسخة التجربة', 'dev: الإعلان في نسخته');
    t.ok(savedOf(st, 'runtime-dev') && !savedOf(st, 'runtime'), 'ينحفظ بمفتاح dev وحده — ' +
      JSON.stringify((st.DB.app_state || []).map(x => x.key)));
    await d.stop();
    const p = instance(st); await ready(p);
    t.eq((await p.status()).notice, null, '**إعلان dev ما يطلع في الإنتاج** (القاعدة مشتركة)');
    await p.stop(); st.server.close();
  },

  async search(t) {
    for (const mode of ['down', '503', 'format']) {
      const st = await makeOutside({ DB: base(), pmu: { mode } });
      const c = instance(st); await ready(c);
      const s = await c.search();
      const e = (s.j && s.j.error) || '';
      t.ok(s.status === 500 && s.j && s.j.reason === 'pmu-down' && e.includes(AR) && !/PMU|timeout/i.test(e),
        `**موقع الجدول واقف (${mode}) وما عندنا نسخة ولا بانر: «${AR}»** بدل الخطأ الفني — ${s.status} ${JSON.stringify(s.j)}`);
      t.ok(st.ban.hits > 0, `(${mode}) وبانر انجرّب قبلها`);
      await c.stop(); st.server.close();
    }
  }
};

(async () => {
  const only = process.argv.slice(3).filter(a => !a.startsWith('--'));
  for (const [name, fn] of Object.entries(SCEN)) {
    if (only.length && !only.includes(name)) continue;
    const t = T(name);
    try { await fn(t) } catch (e) { fail++; out.push(`  ✗ [${name}] انهار: ${e && e.stack || e}`) }
  }
  out.forEach(l => console.log(l));
  console.log(`\nإعلان فوق الموقع (السيرفر): ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
