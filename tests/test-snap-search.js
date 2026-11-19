/* آخر جدول محفوظ يتجدّد من البحث كذلك — لقاها محمد (١٩ نوفمبر ٢٠٢٦: «انمسحت النسخ الي في الكاش بعد ما نزلت
   اخر تحديث للموقع ما نقدر نسترجعها؟»). صف snapshot-<ترم> في app_state يرجّع جدول الترم للكاش بعد كل نشر —
   بس الدورة وحدها كانت تحفظه، وهي ما تسحب إلا وقت التسجيل ولما مو موقوفة: في الإنتاج ما انحفظ ولا مرة، وكل
   نشر يبدأ بكاش فاضي (والجامعة متعطّلة وقتها = البحث يفشل للكل).
   اختبار سلوكي بنسخ سيرفر حقيقية (عمليات مستقلة) و«خارج» مشترك (الجامعة · القاعدة · تيليغرام):
   ١) defaults — بحث الصفحة الافتراضي («الكل» — ALL|ALL) يحفظ صفّه (snapshot-all-<ترم>)، ونسخة جديدة والجامعة
                 متعطّلة تخدم البحث الافتراضي منه. والجنس ما ينخمّن منه (M1 · F1 ما ترجع من «الكل»). وترم قديم لا.
   ٢) save     — بحث الجنسين يحفظ صف الجنس (snapshot-<ترم> — نفس صف الدورة) بعمر الأقدم، والترم الجاي كذلك.
   ٣) newer    — الصفّان موجودان: «الكل» يرجع من الأحدث (صف «الكل» أو الجنسين مع بعض).
   ٤) next     — الترم الجاي يرجع بعد الإقلاع (كانت الاستعادة للدراسة والتسجيل — خارج التسجيل نفس الترم).
   ٥) restored — النسخة اللي رجعت من القاعدة ما تنحفظ ثانية كأنها جديدة: الجنسان من سحبة حقيقية.
   ٦) short    — جدول ناقص عن أكبر ما شفناه (FEED_PEAK · PMU_PART_PEAK) ما ينحفظ.
   ٧) same     — نفس الجدول بعد النشر ما ينكتب ثانية، إلا مرة باليوم نجدّد عمره (وإلا تعدّى أسبوعه وما رجع).
   وdev ما يكتب (في defaults و save).

   node tests/test-snap-search.js [server.js] */
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ADMIN = 'admin-token-for-snap-search';
const AT = '2026-11-19T07:00:00Z';           /* خارج التسجيل: ترم الدراسة 202710 والجاي 202720 */
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ نسخة سيرفر: عملية مستقلة، وكل طلب خارجي يروح لخادم «الخارج» في الأب ═══ */
if (process.argv.includes('--child')) {
  const [outPort, port] = process.argv.slice(-2).map(Number);
  const at = process.argv.find(a => a.startsWith('--at='));
  const env = process.argv.find(a => a.startsWith('--env='));
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
  }, env ? { SITE_ENV: env.slice(6) } : {});
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

/* ═══ قاعدة PostgREST-ية (نفس محاكي test-pmu-fallbacks) ═══ */
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
  const st = { DB: o.DB, pmu: Object.assign({ hits: [], mode: 'ok' }, o.pmu), TG: [], writes: [], nextId: 1000 };
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
        if (P.mode === 'down') return req.socket.destroy();
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['s=1; path=/'] });
          return res.end('<input name="__RequestVerificationToken" type="hidden" value="tok">');
        }
        const q = new URLSearchParams(body), g = q.get('GenderList');
        P.hits.push({ term: q.get('TermList'), g });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(table(g === 'F1' ? P.F1 : g === 'M1' ? P.M1 : P.M1.concat(P.F1)));
      }
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
            if (/^snapshot-/.test(x.key)) st.writes.push(x.key);
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

let PORTN = 20300 + (process.pid % 40) * 2;
function instance(st, extra) {
  const port = PORTN++;
  const c = fork(__filename, [SRV, '--child'].concat(extra || [], [String(st.port), String(port)]), { silent: true });
  const get = (p, h) => new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: h || {} }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', x => b += x);
      res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, j }) });
    });
    r.on('error', () => resolve({ status: 0, headers: {}, j: null })); r.end();
  });
  c.health = () => get('/api/admin/health', { 'X-Admin-Token': ADMIN }).then(r => r.j || {});
  c.warp = ms => c.send({ warp: ms });
  c.search = (term, g) => get(`/api/courses?term=${term}&college=ALL&gender=${g}`);
  c.stop = () => new Promise(r => { c.on('exit', r); c.kill('SIGKILL') });
  return c;
}
/* جاهز = الإقلاع خلص (الاستعادة) */
const ready = async c => {
  for (let i = 0; i < 150; i++) {
    const h = await c.health();
    if (h.booted || (h.uptimeHours !== undefined && !('booted' in h))) return true;
    await wait(100);
  }
  return false;
};
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(100) } return fn() };
/* «الخارج» هدأ: ولا طلب جديد ٣٠٠ م.ث — الحفظ ينرسل بلا await بعد ما يرجع البحث */
const settle = async st => { let n = -1; for (const t0 = Date.now(); Date.now() - t0 < 5000 && st.reqs !== n;) { n = st.reqs; await wait(300) } };

/* ═══ البيانات — بصيغة الجامعة حرفاً بحرف ═══ */
const row = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '101', 'UT', '0930 - 1045',
  'Smith, John', 'M-CORE - G034', st];
const frow = (crn, st, sec) => [crn, 'MEEN 3311', 'Thermodynamics', sec || '201', 'UT', '0930 - 1045',
  'Lee, Sara', 'F-CORE - 101', st];
const many = (n, from, f) => Array.from({ length: n }, (_, i) => f(String(from + i), i % 2 ? 'OPEN' : 'CLOSE',
  String((f === frow ? 201 : 101) + (i % 9))));
/* المراقبة موقوفة (مثل الإنتاج الحين): ولا دورة تحفظ — الحفظ من البحث وحده */
const base = extra => ({ monitored_courses: [], profiles: [], app_events: [], user_schedule: [], pending_changes: [],
  app_state: [{ key: 'runtime', value: Object.assign({ toggles: { monitorPaused: true } }, extra || {}) }] });
const snapOf = (st, term) => (st.DB.app_state || []).find(x => x.key === 'snapshot-' + term);
const crnsOf = r => ((r.j && r.j.courses) || []).map(x => x.crn).sort();
/* صف محفوظ جاهز — بنفس شكل snapSave (مصفوفات بترتيب الأعمدة) */
const COLS = ['crn', 'courseCode', 'courseTitle', 'section', 'courseDate', 'courseTiming', 'instructor', 'room', 'status'];
const seed = (term, at, M1, F1) => ({ key: 'snapshot-' + term, value: { term, at, cols: COLS, M1, F1 },
  updated_at: new Date(at).toISOString() });
const seedAll = (term, at, ALL) => ({ key: 'snapshot-all-' + term, value: { term, at, cols: COLS, ALL },
  updated_at: new Date(at).toISOString() });
const restoredKeys = h => (h.cache || []).filter(c => c.restored).map(c => c.key).sort();

const SCEN = {
  async defaults(t) {
    const st = await makeOutside({ DB: base(), pmu: { M1: [row('30011', 'CLOSE'), row('30012', 'OPEN', '102')],
      F1: [frow('40011', 'CLOSE')] } });
    const a = instance(st, ['--at=' + AT]);
    t.ok(await ready(a), 'الإنتاج قلع');
    let s = await a.search('202710', 'ALL');
    t.eq([s.status, crnsOf(s)], [200, ['30011', '30012', '40011']], 'البحث الافتراضي (الكل) يشتغل');
    await until(() => snapOf(st, 'all-202710'), 4000);
    const sv = snapOf(st, 'all-202710');
    t.ok(sv && sv.value && Array.isArray(sv.value.ALL) && sv.value.ALL.length === 3 && !sv.value.M1,
      '**البحث الافتراضي يحفظ جدول الترم في القاعدة** (صف snapshot-all-202710 — والمراقبة موقوفة فما كان ينحفظ شي)');
    t.eq(sv && sv.value.cols, COLS, 'بنفس شكل صف الدورة (أعمدة ومصفوفات)');
    t.ok(!snapOf(st, '202710'), 'وصف الجنس (الدورة) ما ينلمس — «الكل» ما ينكتب فوقه');
    await a.search('202610', 'ALL');
    await settle(st);
    t.ok(!snapOf(st, 'all-202610'), 'ترم قديم (202610) يبحث فيه أحد: ما يصير صفاً في القاعدة');
    await a.stop();

    /* نشر جديد والجامعة متعطّلة (dev هنا — يقرأ ولا يكتب) */
    st.pmu.mode = 'down';
    const writes = st.writes.length;
    const b = instance(st, ['--at=' + AT, '--env=dev']);
    t.ok(await ready(b), 'نسخة جديدة قلعت');
    s = await b.search('202710', 'ALL');
    t.eq([s.status, crnsOf(s)], [200, ['30011', '30012', '40011']],
      '**بعد النشر والجامعة متعطّلة: البحث الافتراضي يخدم الجدول المحفوظ** (كان «فشل» للكل)');
    t.eq(restoredKeys(await b.health()), ['202710|ALL|ALL'],
      'اللوحة تعرف اللي رجع (↺) — والجنس ما ينخمّن من رقم الشعبة: M1 · F1 ما ترجع من «الكل»');
    await settle(st);
    t.eq(st.writes.length, writes, 'dev ما يكتب نسخته');
    await b.stop();
    st.server.close();
  },

  async save(t) {
    const st = await makeOutside({ DB: base(), pmu: { M1: [row('30011', 'CLOSE'), row('30012', 'OPEN', '102')],
      F1: [frow('40011', 'CLOSE')] } });
    const a = instance(st, ['--at=' + AT]);
    t.ok(await ready(a), 'الإنتاج قلع');
    let s = await a.search('202710', 'M1');
    t.eq([s.status, crnsOf(s)], [200, ['30011', '30012']], 'بحث الطلاب يشتغل');
    await settle(st);
    t.ok(!snapOf(st, '202710'), 'جنس واحد في الكاش: ما نحفظ نص جدول');
    a.warp(60 * 60 * 1000);                    /* ساعة — سحبة الطالبات بعد سحبة الطلاب */
    await wait(200);
    s = await a.search('202710', 'F1');
    t.eq([s.status, crnsOf(s)], [200, ['40011']], 'بحث الطالبات يشتغل');
    await until(() => snapOf(st, '202710'), 4000);
    const sv = snapOf(st, '202710');
    t.ok(sv && sv.value && sv.value.M1.length === 2 && sv.value.F1.length === 1,
      '**بحث الجنسين يحفظ جدول الترم في القاعدة** (كانت الدورة وحدها تحفظ — والمراقبة موقوفة فما انحفظ شي)');
    t.ok(sv && Date.parse(sv.updated_at) - sv.value.at >= 59 * 60 * 1000,
      'وعمره عمر السحبة الأقدم (الطلاب قبل ساعة) — لا وقت الحفظ: ' + (sv && Math.round((Date.parse(sv.updated_at) - sv.value.at) / 60000)) + ' د');
    t.eq(sv && sv.value.cols, COLS, 'بنفس شكل حفظ الدورة (أعمدة ومصفوفات)');
    /* ترم قديم: ما يصير صفاً في القاعدة */
    await a.search('202610', 'M1'); await a.search('202610', 'F1');
    await settle(st);
    t.ok(!snapOf(st, '202610'), 'ترم قديم (202610) يبحث فيه أحد: ما يصير صفاً في القاعدة');
    /* الترم الجاي (ترم التسجيل الجاي — الربيع) */
    await a.search('202720', 'M1'); await a.search('202720', 'F1');
    await until(() => snapOf(st, '202720'), 4000);
    t.ok(snapOf(st, '202720'), '**الترم الجاي (202720 — الطلاب يخططون له الحين) ينحفظ كذلك**');
    await a.stop();

    /* نشر جديد والجامعة متعطّلة: البحث من المحفوظ (dev هنا — يقرأ ولا يكتب) */
    st.pmu.mode = 'down';
    const writes = st.writes.length;
    const b = instance(st, ['--at=' + AT, '--env=dev']);
    t.ok(await ready(b), 'نسخة جديدة قلعت');
    s = await b.search('202710', 'M1');
    t.eq([s.status, crnsOf(s)], [200, ['30011', '30012']],
      '**بعد النشر والجامعة متعطّلة: البحث يخدم الجدول المحفوظ** (كان «فشل» للكل)');
    s = await b.search('202720', 'F1');
    t.eq([s.status, crnsOf(s)], [200, ['40011']], '**والترم الجاي كذلك**');
    t.eq(restoredKeys(await b.health()),
      ['202710|ALL|ALL', '202710|ALL|F1', '202710|ALL|M1', '202720|ALL|ALL', '202720|ALL|F1', '202720|ALL|M1'],
      'الجنسان والكل رجعوا للترمين (اللوحة تعلّمهم ↺)');
    await b.search('202710', 'F1');
    await settle(st);
    t.eq(st.writes.length, writes, 'dev ما يكتب نسخته');
    await b.stop();
    st.server.close();
  },

  async newer(t) {
    const T0 = Date.parse(AT);
    const one = async (gAgo, aAgo) => {
      const DB = base();
      DB.app_state.push(seed('202710', T0 - gAgo, [row('30011', 'CLOSE')], [frow('40011', 'CLOSE')]));
      DB.app_state.push(seedAll('202710', T0 - aAgo, [row('30099', 'OPEN'), frow('40099', 'OPEN')]));
      const st = await makeOutside({ DB, pmu: { mode: 'down', M1: [], F1: [] } });
      const c = instance(st, ['--at=' + AT, '--env=dev']);
      await ready(c);
      const r = { all: crnsOf(await c.search('202710', 'ALL')), m: crnsOf(await c.search('202710', 'M1')) };
      await c.stop();
      st.server.close();
      return r;
    };
    t.eq(await one(3 * 3600e3, 3600e3), { all: ['30099', '40099'], m: ['30011'] },
      '**صف «الكل» أحدث: البحث الافتراضي منه**، والجنس من صف الجنس');
    t.eq(await one(3600e3, 3 * 3600e3), { all: ['30011', '40011'], m: ['30011'] },
      'صف الجنس أحدث: «الكل» من الجنسين مع بعض');
  },

  async next(t) {
    /* المحفوظ للترم الجاي وحده، والجامعة متعطّلة */
    const at = Date.parse(AT) - 2 * 3600 * 1000;
    const DB = base();
    DB.app_state.push(seed('202720', at, [row('31011', 'OPEN')], [frow('41011', 'CLOSE')]));
    DB.app_state.push(seedAll('202720', at + 60000, [row('31011', 'OPEN'), frow('41011', 'CLOSE'), row('31012', 'OPEN', '103')]));
    const st = await makeOutside({ DB, pmu: { mode: 'down', M1: [], F1: [] } });
    const c = instance(st, ['--at=' + AT, '--env=dev']);
    t.ok(await ready(c), 'قلع');
    let s = await c.search('202720', 'M1');
    t.eq([s.status, crnsOf(s)], [200, ['31011']],
      '**الترم الجاي يرجع بعد الإقلاع** (كانت الاستعادة لترمي الدراسة والتسجيل — خارج التسجيل نفس الترم)');
    s = await c.search('202720', 'ALL');
    t.eq([s.status, crnsOf(s)], [200, ['31011', '31012', '41011']], 'وبحثه الافتراضي كذلك');
    await c.stop();
    st.server.close();
  },

  async restored(t) {
    /* المحفوظ عمره ٧ ساعات (أقدم من صلاحية الكاش خارج التسجيل): البحث يسحب جديداً */
    const old = Date.parse(AT) - 7 * 3600 * 1000;
    const DB = base();
    DB.app_state.push(seed('202710', old, [row('30011', 'CLOSE')], [frow('40011', 'CLOSE')]));
    const st = await makeOutside({ DB, pmu: { M1: [row('30011', 'OPEN')], F1: [frow('40011', 'OPEN')] } });
    const c = instance(st, ['--at=' + AT]);
    t.ok(await ready(c), 'قلع');
    let s = await c.search('202710', 'M1');
    t.eq([s.status, (s.j && s.j.courses || []).map(x => x.status)], [200, ['OPEN']], 'الطلاب: سحبة جديدة (المحفوظ منتهي)');
    await settle(st);
    t.eq(snapOf(st, '202710').value.at, old,
      '**الطالبات لسا من المحفوظ: ما نحفظ** (نسخة رجعت من القاعدة ما تنحفظ كأنها سحبة جديدة)');
    s = await c.search('202710', 'F1');
    await until(() => snapOf(st, '202710').value.at !== old, 4000);
    const sv = snapOf(st, '202710').value;
    t.ok(sv.at > old && sv.M1[0][8] === 'OPEN' && sv.F1[0][8] === 'OPEN',
      '**الجنسان من سحبة حقيقية: الجديد انحفظ مكانه**');
    await c.stop();
    st.server.close();
  },

  async short(t) {
    /* أكبر ما شفناه: ٥٠ للطلاب و٥٠ للطالبات (يُحفظ مع الحالة) */
    const DB = base({ partPeak: [['202710|M1', 50], ['202710|F1', 50]], feedPeak: [['202710', 100]] });
    const st = await makeOutside({ DB, pmu: { M1: many(5, 30100, row), F1: many(50, 40100, frow) } });
    const c = instance(st, ['--at=' + AT]);
    t.ok(await ready(c), 'قلع');
    await c.search('202710', 'M1'); await c.search('202710', 'F1'); await c.search('202710', 'ALL');
    await settle(st);
    t.ok(!snapOf(st, '202710'), 'جدول الطلاب ناقص (٥ من ٥٠): ما ينحفظ');
    t.ok(!snapOf(st, 'all-202710'), 'و«الكل» ناقص (٥٥ من ١٠٠): ما ينحفظ');
    st.pmu.M1 = many(48, 30100, row);
    c.warp(6 * 3600 * 1000 + 60000);          /* صلاحية الكاش خارج التسجيل خلصت: سحبة جديدة */
    await wait(200);
    await c.search('202710', 'M1'); await c.search('202710', 'F1'); await c.search('202710', 'ALL');
    await until(() => snapOf(st, '202710') && snapOf(st, 'all-202710'), 4000);
    const sv = snapOf(st, '202710'), sa = snapOf(st, 'all-202710');
    t.ok(sv && sv.value.M1.length === 48 && sv.value.F1.length === 50, '**رجع كامل (٤٨ من ٥٠): ينحفظ**');
    t.ok(sa && sa.value.ALL.length === 98, '**و«الكل» (٩٨ من ١٠٠) كذلك**');
    await c.stop();
    st.server.close();
  },

  async same(t) {
    /* المحفوظ نفس جدول الجامعة بالضبط، وعمره ٧ ساعات */
    const M1 = [row('30011', 'CLOSE'), row('30012', 'OPEN', '102')], F1 = [frow('40011', 'CLOSE')];
    const old = Date.parse(AT) - 7 * 3600 * 1000;
    const DB = base();
    DB.app_state.push(seed('202710', old, M1, F1));
    const st = await makeOutside({ DB, pmu: { M1, F1 } });
    const c = instance(st, ['--at=' + AT]);
    t.ok(await ready(c), 'قلع');
    await c.search('202710', 'M1'); await c.search('202710', 'F1');
    await settle(st);
    t.eq(st.writes.length, 0, 'نفس الجدول بعد النشر: ما ينكتب ثانية (كل نشر كان بيكتب جدول الترم كامل)');
    c.warp(18 * 3600 * 1000);                  /* يوم وساعة من عمر المحفوظ */
    await wait(200);
    await c.search('202710', 'M1'); await c.search('202710', 'F1');
    await until(() => st.writes.length > 0, 4000);
    const sv = snapOf(st, '202710').value;
    t.ok(st.writes.length === 1 && sv.at - old >= 24 * 3600 * 1000,
      '**نفس الجدول بعد يوم: نجدّد عمره** (وإلا تعدّى أسبوعه وما رجع بعد نشر وهو صحيح) — ' + Math.round((sv.at - old) / 3600000) + ' س');
    await c.stop();
    st.server.close();
  }
};

(async () => {
  await Promise.all(Object.entries(SCEN).map(([name, fn]) =>
    fn(T(name)).catch(e => { fail++; out.push(`  ✗ [${name}] انهار: ` + (e && e.stack || e)) })));
  if (out.length) console.log(out.join('\n'));
  console.log(`آخر جدول محفوظ من البحث: ${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})();
