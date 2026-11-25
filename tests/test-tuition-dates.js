/* أقساط الرسوم في «مواعيد تهمك» — طلب الطلاب عبر محمد (٢٥ نوفمبر ٢٠٢٦، إيميل الجامعة «2026/2027 Tuition Payment
   Schedule»: القسط الأول 1–10 أكتوبر · الثاني 1–10 نوفمبر · الثالث 1–10 ديسمبر، وغرامة التأخير 750 ريال لكل قسط).
   **المواعيد والغرامة وحدها بلا المبالغ**: المبلغ يختلف بالجنسية والتخصص والموقع ما يعرفها.
   السيرفر (منطقة التنبيهات الحقيقية في vm، بقاعدة وبوت وهميين — نفس test-notif-approval):
   ١) الأقساط في التقويم الموحّد بنوعها (pay) وتواريخها، والغرامة في النص، وبلا مبالغ.
   ٢) موعد حرج: التنبيه العام قبل **آخر يوم** بيومين (8 ديسمبر) لا قبل أوّله، ونصّه يقول «آخر يوم».
   ٣) **بموافقة محمد**: 7 ديسمبر يوصله السؤال وما يطلع لطالب، والموافَق عليه يطلع 8 ديسمبر للطلاب.
   الصفحة (Chromium على ٣٩٠ بالثيمين، بساعة مثبّتة):
   ٤) 25 نوفمبر: «💳 سداد القسط الثالث…» بـ1–10 ديسمبر و«بعد 6 يوم» ملوّن، والقسطان اللي فاتوا ما يطلعون.
   ٥) 5 ديسمبر «جارٍ الآن» · 11 ديسمبر اختفى · بالإنجليزي نصّه · عنوان البطاقة يقول من وين.

   node tests/test-tuition-dates.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const SHARED = path.join(path.dirname(SRV), 'shared', 'plans.js');
const source = fs.readFileSync(SRV, 'utf8');

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push('  ✗ ' + m) } };
const done = () => { out.forEach(l => console.log(l)); console.log(`\nأقساط الرسوم: ${pass} نجحت · ${fail} فشلت`); process.exit(fail ? 1 : 0) };

function slice(from, toExclusive) {
  const L = source.split('\n');
  const a = L.findIndex(x => x.startsWith(from));
  const b = L.findIndex(x => x.startsWith(toExclusive));
  if (a < 0 || b < 0 || b <= a) throw new Error('ما لقيت حدود المنطقة');
  return L.slice(a, b).join('\n');
}
const REGION = slice('const NOTIF_HOUR = 17;', 'function tg(');

/* قاعدة وهمية: notif_approvals بقيد فريد على (send_date, kind, ref) — نفس test-notif-approval */
function makeDb() {
  const rows = [];
  let id = 0;
  return {
    rows,
    async sb(method, table, opt = {}) {
      if (table !== 'notif_approvals') return [];
      const q = opt.query || '';
      if (method === 'POST') {
        const b = opt.body;
        if (rows.some(r => r.send_date === b.send_date && r.kind === b.kind && r.ref === b.ref))
          return { code: '23505', message: 'duplicate key' };
        const row = Object.assign({ id: ++id, decided_at: null }, b);
        rows.push(row);
        return opt.prefer === 'return=representation' ? [row] : [];
      }
      if (method === 'GET') {
        let o = rows.slice();
        const sd = /send_date=eq\.([^&]+)/.exec(q);
        if (sd) o = o.filter(r => r.send_date === decodeURIComponent(sd[1]));
        const kd = /kind=eq\.([^&]+)/.exec(q);
        if (kd) o = o.filter(r => r.kind === kd[1]);
        const st = /[?&]status=eq\.([^&]+)/.exec(q);
        if (st) o = o.filter(r => r.status === st[1]);
        const idm = /id=eq\.(\d+)/.exec(q);
        if (idm) o = o.filter(r => String(r.id) === idm[1]);
        return o.map(r => Object.assign({}, r));
      }
      if (method === 'PATCH') {
        let o = rows.slice();
        const idm = /id=eq\.(\d+)/.exec(q);
        if (idm) o = o.filter(r => String(r.id) === idm[1]);
        const inm = /id=in\.\(([^)]*)\)/.exec(q);
        if (inm) { const set = new Set(inm[1].split(',').filter(Boolean)); o = o.filter(r => set.has(String(r.id))) }
        const st = /[?&]status=eq\.([^&]+)/.exec(q);
        if (st) o = o.filter(r => r.status === st[1]);
        o.forEach(r => Object.assign(r, opt.body));
        return opt.prefer === 'return=representation' ? o.map(r => Object.assign({}, r)) : [];
      }
      return [];
    }
  };
}
/* طالبان مربوطان بتيليغرام، والإدارة 999 */
function makeCtx({ db, today, hour = 17 }) {
  const toStudents = [], toAdmin = [];
  const ctx = {
    console: { log() {} }, SB_URL: 'https://x', SB_SERVICE_KEY: 'k',
    SITE_ENV: 'prod', activeTerm: () => '202710', ADMIN_CHAT_ID: '999', toStudents, toAdmin,
    riyadhNow: () => new Date(`${today}T${String(hour).padStart(2, '0')}:00:00Z`),
    dayShift: (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10),
    esc: v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    btn: (label, data) => ({ text: label, callback_data: data }),
    kb: r => ({ inline_keyboard: r }),
    logEvent() {},
    sb: (m, t, o) => db.sb(m, t, o),
    sbAll: async table => {
      if (table === 'profiles') return [
        { id: 'u1', telegram_chat_id: '111', notif_prefs: null },
        { id: 'u2', telegram_chat_id: '222', notif_prefs: null }];
      if (table === 'user_schedule') return [
        { user_id: 'u1', crn: '1', course_code: 'MEEN 3311', course_date: 'UT' },
        { user_id: 'u2', crn: '2', course_code: 'FINA 3311', course_date: 'MW' }];
      return [];
    },
    sendMsg: async (chat, text) => { (String(chat) === '999' ? toAdmin : toStudents).push({ chat, text }); return { ok: true } },
    Promise, Date, Set, Map, Object, Array, String, Number, Math, JSON, encodeURIComponent, setTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(REGION + '\nthis.ACAD_CAL = ACAD_CAL; this.acadDeadline = acadDeadline; this.acadRef = acadRef;', ctx);
  return ctx;
}

(async () => {
  /* ═══ ١) في التقويم الموحّد ═══ */
  const c0 = makeCtx({ db: makeDb(), today: '2026-11-25' });
  const pay = c0.ACAD_CAL.filter(e => e.t === 'pay');
  const span = pay.map(e => `${e.s}…${e.e || ''}`);
  ok(JSON.stringify(span) === JSON.stringify(['2026-10-01…2026-10-10', '2026-11-01…2026-11-10', '2026-12-01…2026-12-10']),
    '**الأقساط الثلاثة في التقويم الموحّد بمدتها (1–10 أكتوبر · نوفمبر · ديسمبر)** — ' + JSON.stringify(span));
  ok(pay.length === 3 && pay.every(e => e.term === '202710' && /750/.test(e.ar) && /750/.test(e.en || '')),
    'كلها للخريف 2026/2027 ومعها غرامة التأخير 750 ريال بالعربي والإنجليزي');
  ok(pay.length === 3 && ['الأول', 'الثاني', 'الثالث'].every((n, i) => pay[i].ar.includes('القسط ' + n)),
    'كل قسط باسمه — ' + pay.map(e => e.ar).join(' | '));
  ok(pay.length > 0 && !pay.some(e => /1[012],?000|9,?000|9,?350|10,?500|12,?375/.test(e.ar + ' ' + (e.en || ''))),
    '**بلا المبالغ** (تختلف بالجنسية والتخصص — الموقع ما يعرفها)');

  /* ═══ ٢) موعد حرج: قبل آخر يوم بيومين ═══ */
  const third = pay[2] || { t: 'pay', s: '2026-12-01', e: '2026-12-10', ar: '' };
  ok(c0.acadDue(c0.ACAD_CAL, '2026-12-10').some(e => e.t === 'pay'), '**القسط موعد حرج: يطلع له تنبيه على آخر يوم (10 ديسمبر)**');
  ok(!c0.acadDue(c0.ACAD_CAL, '2026-12-01').some(e => e.t === 'pay'), 'لا على أوّل المدة (1 ديسمبر)');
  const txt = c0.acadText(third);
  ok(/آخر يوم/.test(txt) && /10 ديسمبر/.test(txt) && /القسط الثالث/.test(txt) && /750/.test(txt),
    '**نص التنبيه يقول «آخر يوم» وتاريخه والغرامة** (بلا «بعد يومين» وحدها: توهم إن السداد يبدأ) — ' + txt.replace(/\n/g, ' | '));

  /* ═══ ٣) بموافقة محمد ═══ */
  {
    const db = makeDb();
    const c = makeCtx({ db, today: '2026-12-07' });
    await c.notifyTick();
    const pend = db.rows.filter(r => r.kind === 'acad' && /^pay\|/.test(r.ref));
    ok(pend.length === 1 && pend[0].send_date === '2026-12-08' && pend[0].status === 'pending',
      '**7 ديسمبر: صف معلّق للقسط يطلع 8 ديسمبر** — ' + JSON.stringify(pend.map(r => [r.send_date, r.ref, r.status])));
    ok(c.toAdmin.some(m => /ينتظر موافقتك/.test(m.text) && /القسط الثالث/.test(m.text)),
      'والسؤال وصل محمد بالنص — ' + c.toAdmin.map(m => m.text.slice(0, 60)).join(' | '));
    ok(c.toStudents.length === 0, '**وما طلع لطالب بلا موافقته**');
  }
  {
    const db = makeDb();
    db.rows.push({ id: 1, send_date: '2026-12-08', kind: 'acad', ref: 'pay|2026-12-01|2026-12-10', body: 'x',
      status: 'approved', decided_at: null });
    const c = makeCtx({ db, today: '2026-12-08' });
    await c.notifyTick();
    ok(c.toStudents.length === 2 && c.toStudents.every(m => /القسط الثالث/.test(m.text) && /آخر يوم/.test(m.text) &&
      /10 ديسمبر/.test(m.text)),
      '**وافق ⇒ 8 ديسمبر يوصل الطلاب: آخر يوم 10 ديسمبر** — ' + c.toStudents.map(m => m.text.replace(/\n/g, ' | ')).join(' || '));
  }

  /* ═══ ٤ · ٥) الصفحة ═══ */
  let chromium;
  try { ({ chromium } = require('playwright')) } catch (e) { ok(false, 'Playwright مو مثبّت'); return done() }
  const ci = source.indexOf('const ACAD_CAL = ['), cj = source.indexOf('\n];', ci);
  const CAL = new Function(source.slice(ci, cj + 3) + '; return ACAD_CAL;')();
  const calJs = 'window.ACAD_CAL=' + JSON.stringify(CAL) + ';';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)) }
    if (u === '/calendar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(calJs) }
    if (u === '/plans.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(SHARED)) }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ term: '202710', regTerm: '202710', nextRegTerm: '202720', canWatch: false, env: 'prod' }));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const SUPA = 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},then:(f)=>f({data:[],error:null})}),channel:()=>({on(){return this},subscribe(){return this}}),storage:{from:()=>({list:async()=>({data:[],error:null})})}})};';
  const openAt = async (iso, theme) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme || 'dark' });
    const p = await ctx.newPage();
    p.errs = [];
    p.on('pageerror', e => p.errs.push(String(e)));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
    await p.addInitScript(([t, th]) => {
      const F = Date.parse(t), R = Date;
      window.Date = class extends R { constructor(...a) { super(...(a.length ? a : [F])) } static now() { return F } };
      try { localStorage.setItem('theme', th); localStorage.setItem('pmu_seen_guide', 'true') } catch (e) {}
    }, [iso, theme || 'dark']);
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof renderCalendar === 'function', null, { timeout: 15000 }).catch(() => {});
    p.ctx = ctx;
    return p;
  };
  const card = p => p.evaluate(() => {
    renderCalendar();
    const rows = [...document.querySelectorAll('#calBody .cal-row')].map(r => ({ cls: r.className,
      ic: (r.querySelector('.cal-ic') || {}).textContent, name: (r.querySelector('.cal-name') || {}).textContent || '',
      date: (r.querySelector('.cal-date') || {}).textContent || '', badge: (r.querySelector('.cal-badge') || {}).textContent || '' }));
    return { rows, sub: (document.querySelector('#calCard .fin-sub') || {}).textContent || '',
      note: (document.querySelector('#calBody .fin-note') || {}).textContent || '' };
  });
  const payRows = c => c.rows.filter(r => /القسط|installment/i.test(r.name));
  const shots = process.env.SHOT_DIR;

  for (const theme of ['dark', 'light']) {
    const p = await openAt('2026-11-25T06:00:00Z', theme);       /* 9 الصبح بالرياض */
    let c = await card(p);
    const pr = payRows(c);
    ok(pr.length === 1 && /\bpay\b/.test(pr[0].cls) && pr[0].ic === '💳' && /القسط الثالث/.test(pr[0].name) && /750/.test(pr[0].name),
      `[${theme}] **25 نوفمبر: «💳 سداد القسط الثالث من الرسوم — غرامة التأخير 750 ريال» في «مواعيد تهمك»** — ` + JSON.stringify(pr));
    ok(pr[0] && /1 ديسمبر/.test(pr[0].date) && /10 ديسمبر/.test(pr[0].date), `[${theme}] بمدته 1–10 ديسمبر — ${pr[0] && pr[0].date}`);
    ok(pr[0] && /بعد 6/.test(pr[0].badge) && /\bsoon\b/.test(pr[0].cls), `[${theme}] وعدّاده «بعد 6» ملوّن (قريب) — ${pr[0] && pr[0].badge}`);
    ok(c.rows[0] && /القسط الثالث/.test(c.rows[0].name), `[${theme}] وهو أقرب موعد (أول سطر)`);
    ok(!/القسط الأول|القسط الثاني/.test(c.rows.map(r => r.name).join(' ')), `[${theme}] والقسطان اللي فاتوا ما يطلعون`);
    ok(/الرسوم/.test(c.sub) && /الرسوم/.test(c.note), `[${theme}] **البطاقة تقول من وين: التقويم وجدول سداد الرسوم** — ${c.sub}`);
    const over = await p.evaluate(() => { switchTab('sched'); const el = document.getElementById('calCard'); if (el) el.scrollIntoView({ block: 'center' });
      return document.documentElement.scrollWidth - innerWidth });
    ok(over <= 1, `[${theme}] بلا تمرير أفقي على ٣٩٠ — ${over}`);
    if (shots) { await p.waitForTimeout(400); await p.screenshot({ path: path.join(shots, `tuition-${theme}.png`) }) }
    if (theme === 'dark') {
      await p.evaluate(() => toggleLang());
      c = await card(p);
      ok(payRows(c).some(r => /Tuition — 3rd installment \(late fee SAR 750\)/.test(r.name)),
        '**بالإنجليزي: «Tuition — 3rd installment (late fee SAR 750)»** — ' + JSON.stringify(payRows(c).map(r => r.name)));
      ok(/tuition/i.test(c.sub), 'وعنوانها بالإنجليزي — ' + c.sub);
    }
    ok(p.errs.length === 0, `[${theme}] بلا أخطاء JS: ` + p.errs.slice(0, 2).join(' | '));
    await p.ctx.close();
  }
  {
    const p = await openAt('2026-12-05T06:00:00Z');
    const r = payRows(await card(p));
    ok(r.length === 1 && /جارٍ الآن/.test(r[0].badge) && /\blive\b/.test(r[0].cls), '**5 ديسمبر: «جارٍ الآن»** — ' + JSON.stringify(r));
    await p.ctx.close();
  }
  {
    const p = await openAt('2026-12-11T06:00:00Z');
    ok(payRows(await card(p)).length === 0, '**11 ديسمبر: خلص واختفى**');
    await p.ctx.close();
  }
  await browser.close(); server.close();
  done();
})().catch(e => { ok(false, 'انهار: ' + (e && e.stack || e)); done() });
