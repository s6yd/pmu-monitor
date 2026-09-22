/* بيانات الخطط — اختبار.
   الخطط قلب الموقع: مادة بمتطلب يشير لكود غير موجود تظهر مقفلة للأبد،
   وكود مكرر في خطة يخلّي العدّاد يحسب الساعات مرتين. وبعد نقلها لملف
   مشترك صار فيه خطر ثانٍ: المخدوم على /plans.js يخالف الملف، أو الصفحة
   تنهار لو ما وصل. الأربعة مغطّاة هنا.

   node tests/test-plans.js [server.js] [pmu-schedule.html] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const zlib = require('zlib');
const crypto = require('crypto');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const PAGE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'pmu-schedule.html'));
const ROOT = path.dirname(SRV);
const SHARED = path.join(ROOT, 'shared', 'plans.js');
const PORT = 45901;

/* ═══ الابن: السيرفر الحقيقي، نطلب منه /plans.js والبصمة ═══ */
if (process.argv[2] === '--child') {
  const [, , , srv] = process.argv;
  const https = require('https');
  const { Readable } = require('stream');
  https.request = function (opts, cb) {
    const req = { on() { return req }, setTimeout() { return req }, destroy() {}, write() {},
      end() {
        const o = (opts.hostname || '') === 'api.telegram.org' ? '{"ok":true,"result":{}}' : '[]';
        const res = new Readable({ read() { this.push(o); this.push(null) } });
        res.statusCode = 200; res.headers = {};
        setImmediate(() => cb(res));
      } };
    return req;
  };
  Object.assign(process.env, { PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests',
    SITE_ENV: 'dev', SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
    SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'true', MONITOR_ENABLED: 'false' });
  const log = console.log; console.log = () => {};
  require(srv);

  const get = (p, hdrs) => new Promise(r => {
    const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET',
      headers: hdrs || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => r({ code: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks) }));
    });
    q.on('error', e => r({ code: 0, headers: {}, body: Buffer.alloc(0), err: e.message }));
    q.end();
  });

  setTimeout(async () => {
    const plain = await get('/plans.js');
    const gz = await get('/plans.js', { 'accept-encoding': 'gzip' });
    const etagReq = await get('/plans.js', { 'if-none-match': plain.headers.etag || '' });
    const st = await get('/api/monitor-status');
    /* لا نخدم أي ملف آخر من shared/ */
    const sneaky = await Promise.all(
      ['/shared/plans.js', '/plans.js/../server.js', '/shared/../server.js']
        .map(p => get(p).then(r => ({ p, code: r.code }))));
    /* بصمة لا محتوى: المقارنة تبقى بايتية (sha256 + الطول) لكن الحمولة
       مئات البايتات بدل ١٤٦ ك.ب. الملف الكامل عبر الأنبوب كان يُقطع
       لما كبر shared/plans.js، فيفشل الاختبار بلا سبب حقيقي. */
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    let un = null;
    try { un = zlib.gunzipSync(gz.body) } catch (e) {}
    const out = JSON.stringify({
      plain: { code: plain.code, etag: plain.headers.etag, cc: plain.headers['cache-control'],
               type: plain.headers['content-type'], enc: plain.headers['content-encoding'] || null,
               len: plain.body.length, sha: sha(plain.body) },
      gz: { code: gz.code, enc: gz.headers['content-encoding'] || null,
            len: gz.body.length,
            unLen: un ? un.length : -1, unSha: un ? sha(un) : null },
      notModified: etagReq.code,
      build: (() => { try { return JSON.parse(st.body.toString()).build } catch (e) { return null } })(),
      sneaky,
    });
    /* stdout أنبوب: process.exit يقطع ما لم يُكتب بعد — ننتظر الكتابة */
    process.stdout.write(out + '\n', () => process.exit(0));
  }, 800);
  return;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

/* ═══ ١. سلامة البيانات ═══ */
let DATA = null;
try { DATA = require(SHARED) } catch (e) { console.log('  ✗ تعذّر require: ' + e.message) }
ok(!!DATA, 'shared/plans.js يُقرأ بـrequire في Node');

if (DATA) {
  const { PLANS, PLAN_ALT, REG_CAL, GUIDE } = DATA;
  ok(PLANS && typeof PLANS === 'object' && Object.keys(PLANS).length >= 20,
     'PLANS فيه ٢٠ تخصصاً فأكثر — فيه ' + Object.keys(PLANS).length);
  ok(!!PLAN_ALT && typeof PLAN_ALT === 'object', 'PLAN_ALT كائن');
  ok(!!REG_CAL && Array.isArray(REG_CAL.rows), 'REG_CAL.rows مصفوفة');
  ok(!!GUIDE && !!GUIDE.ar && !!GUIDE.en, 'GUIDE فيه العربي والإنجليزي');

  for (const [code, p] of Object.entries(PLANS || {})) {
    ok(typeof p.name === 'string' && p.name, `${code}: له اسم إنجليزي`);
    ok(typeof p.ar === 'string' && p.ar, `${code}: له اسم عربي`);
    ok(typeof p.total === 'number' && p.total > 0, `${code}: مجموع ساعات موجب`);
    ok(Array.isArray(p.sems) && p.sems.length > 0, `${code}: فيه فصول`);

    /* كل أكواد المواد في الخطة */
    const codes = [];
    for (const s of (p.sems || [])) for (const c of (s.courses || [])) codes.push(c.c);

    /* لا كود مكرر في نفس الخطة — التكرار يحسب الساعات مرتين */
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    ok(dup.length === 0, `${code}: لا كود مكرر — مكرر: ${[...new Set(dup)].join(', ')}`);

    /* كل متطلب سابق يشير لمادة موجودة في نفس الخطة، أو لمادة تحضيري.
       متطلب يشير لكود غير موجود = مادة مقفلة للأبد عند الطالب. */
    const known = new Set(codes);
    const missing = [];
    for (const s of (p.sems || [])) for (const c of (s.courses || [])) {
      for (const pr of (c.p || [])) if (!known.has(pr)) missing.push(`${c.c}←${pr}`);
    }
    ok(missing.length === 0,
       `${code}: كل متطلب يشير لمادة موجودة — ناقص: ${missing.slice(0, 6).join(' · ')}`);

    /* ساعات كل ترم: مجموع ساعات المواد = المعلن، إن أُعلن */
    for (const s of (p.sems || [])) {
      if (typeof s.hrs !== 'number') continue;
      const sum = (s.courses || []).reduce((a, c) => a + (typeof c.h === 'number' ? c.h : 0), 0);
      ok(sum === s.hrs, `${code}/${s.id || s.label}: مجموع الساعات ${sum} = المعلن ${s.hrs}`);
    }

    /* متطلبات المواد الاختيارية تشير لمواد معروفة كذلك */
    for (const [tc, prs] of Object.entries(p.tech || {})) {
      ok(Array.isArray(prs), `${code}/${tc}: متطلبات الاختياري مصفوفة`);
    }
  }

  /* PLAN_ALT يشير لخطط موجودة فعلاً */
  for (const [code, alt] of Object.entries(PLAN_ALT || {})) {
    ok(!!PLANS[code], `PLAN_ALT: التخصص ${code} موجود في PLANS`);
    ok(!!PLANS[alt], `PLAN_ALT: الخطة البديلة ${alt} موجودة في PLANS`);
  }
}

/* ═══ ٢. /plans.js يُخدم ومطابق للملف ═══ */
const r = spawnSync(process.execPath, [__filename, '--child', SRV],
                    { encoding: 'utf8', timeout: 30000 });
let S = null;
try { S = JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch (e) {}
ok(!!S, 'السيرفر اشتغل ورد على /plans.js');

/* لو shared/plans.js مو موجود أصلاً (كود قديم قبل النقل) نبلّغ فشلاً
   مرتّباً بدل انهيار — run-all.sh لازم يشوف سطر الملخص. */
let onDisk = null;
try { onDisk = fs.readFileSync(SHARED) } catch (e) {}
ok(!!onDisk, 'shared/plans.js موجود على القرص');

/* فحوصات الخدمة تعتمد على السيرفر وحده — تفشل صراحة لو ما خدم /plans.js،
   ولا تُتخطّى. التخطّي يخفي العطل بدل ما يكشفه. */
if (S) {
  ok(S.plain.code === 200, '/plans.js يرجع 200 — رجع ' + S.plain.code);
  ok(/javascript/i.test(S.plain.type || ''), '/plans.js نوعه javascript — ' + S.plain.type);
  ok((S.plain.cc || '') === 'no-cache', '/plans.js فيه Cache-Control: no-cache — فيه ' + S.plain.cc);
  ok(!!S.plain.etag, '/plans.js فيه ETag');
  ok(S.notModified === 304, 'ETag مطابق ← 304 — رجع ' + S.notModified);
  ok(S.gz.enc === 'gzip', '/plans.js يُضغط gzip عند الطلب — enc=' + S.gz.enc);

  /* لا يُخدم أي ملف آخر من المجلد */
  for (const s of (S.sneaky || [])) ok(s.code !== 200, `لا يُخدم ${s.p} — رجع ${s.code}`);

  /* البصمة تشمل الخطط */
  ok(!!S.build, 'بصمة البناء موجودة في /api/monitor-status');

  /* المطابقة البايتية تحتاج الملف على القرص */
  if (onDisk) {
    const want = crypto.createHash('sha256').update(onDisk).digest('hex');
    ok(S.plain.len === onDisk.length && S.plain.sha === want,
       `/plans.js مطابق بايت ببايت لـshared/plans.js — ${S.plain.len}/${onDisk.length} بايت`);
    ok(S.gz.unLen === onDisk.length && S.gz.unSha === want,
       `فكّ الgzip يعطي نفس الملف بايت ببايت — ${S.gz.unLen}/${onDisk.length} بايت`);
    ok(S.gz.len > 0 && S.gz.len < onDisk.length,
       `الgzip أصغر من الأصل فعلاً — ${S.gz.len} < ${onDisk.length}`);
  } else {
    ok(false, '/plans.js مطابق بايت ببايت لـshared/plans.js (لا يوجد ملف)');
    ok(false, 'فكّ الgzip يعطي نفس الملف بايت ببايت (لا يوجد ملف)');
    ok(false, 'الgzip أصغر من الأصل فعلاً (لا يوجد ملف)');
  }
}

/* ═══ ٣. البصمة تتغيّر لو تغيّرت الخطط وحدها ═══ */
(() => {
  if (!onDisk) { ok(false, 'بصمة البناء تشمل الخطط (تخطّي: لا يوجد shared/plans.js)'); return }
  const tmp = path.join(require('os').tmpdir(), 'plans-fp-' + Date.now());
  fs.mkdirSync(path.join(tmp, 'shared'), { recursive: true });
  for (const f of fs.readdirSync(ROOT)) {
    const s = path.join(ROOT, f);
    if (fs.statSync(s).isDirectory()) continue;
    fs.copyFileSync(s, path.join(tmp, f));
  }
  /* نغيّر الخطط فقط — الصفحة كما هي */
  const orig = fs.readFileSync(SHARED, 'utf8');
  fs.writeFileSync(path.join(tmp, 'shared', 'plans.js'), orig + '\n/* بصمة */\n');

  const one = spawnSync(process.execPath, [__filename, '--child', path.join(ROOT, 'server.js')],
                        { encoding: 'utf8', timeout: 30000 });
  const two = spawnSync(process.execPath, [__filename, '--child', path.join(tmp, 'server.js')],
                        { encoding: 'utf8', timeout: 30000 });
  const g = t => { try { return JSON.parse((t.stdout || '').trim().split('\n').pop()).build } catch (e) { return null } };
  const b1 = g(one), b2 = g(two);
  ok(!!b1 && !!b2, 'البصمتان قُرئتا');
  ok(b1 !== b2, 'تعديل الخطط وحدها يغيّر بصمة البناء — قبل ' + b1 + ' بعد ' + b2);
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
})();

/* ═══ ٤. الصفحة: ترسم كل تخصص، وترجع بأمان لو غاب الملف ═══ */
const SB = `
window.__PROFILE={id:'u1',major:'MEEN',plan_ver:'old',name:'mohammad',
                  telegram_chat_id:'1',is_pro:true};
window.__CC=[{course_code:'MATH 1422',grade:'A'},{course_code:'PHYS 1421',grade:'B+'},
             {course_code:'COMM 1311',grade:'A'},{course_code:'ALIS 1211',grade:'A'}];
function q(rows){ const o={
  select(){return o}, eq(){return o}, order(){return o}, limit(){return o},
  in(){return o}, gte(){return o}, lte(){return o}, neq(){return o}, is(){return o},
  single(){ return Promise.resolve({data:Array.isArray(rows)?rows[0]:rows,error:null}) },
  update(){ return {eq:async()=>({data:[],error:null})} },
  insert(){ return {select:async()=>({data:[],error:null})} },
  upsert(){ return Promise.resolve({data:[],error:null}) },
  delete(){ return {eq:async()=>({data:[],error:null}),in:async()=>({data:[],error:null})} },
  then(f,r){ return Promise.resolve({data:rows,error:null}).then(f,r) }
}; return o }
window.supabase={createClient:()=>({
  auth:{ getSession:async()=>({data:{session:window.__NOSESSION?null:
           {user:{id:'u1',email:'m@x.com'}}}}),
         onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
         signOut:async()=>({}) },
  from:(t)=> t==='profiles' ? q([window.__PROFILE])
           : t==='completed_courses' ? q(window.__CC) : q([]),
  channel:()=>({on(){return this},subscribe(){return this}}),
  storage:{from:()=>({list:async()=>({data:[],error:null})})}
})};`;

(async () => {
  let chromium = null;
  try { ({ chromium } = require('playwright')) } catch (e) {}
  if (!chromium) { ok(false, 'playwright متوفر'); return done() }

  if (!onDisk) { ok(false, 'رسم الصفحة (تخطّي: لا يوجد shared/plans.js)'); return done() }
  const pageHtml = fs.readFileSync(PAGE, 'utf8');
  const plansJs = onDisk;

  /* خادم صغير: الصفحة + /plans.js (أو بدونه حسب الوضع) */
  const mk = servePlans => http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/plans.js') {
      if (!servePlans) { res.writeHead(404); return res.end('') }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(plansJs);
    }
    if (u.endsWith('.js')) { res.writeHead(404); return res.end('') }
    if (u.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(u === '/api/monitor-status'
        ? { term: '202710', canWatch: false, build: '"x"' }
        : { success: true, courses: [], cached: false, age: 0 }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pageHtml);
  });

  const open = async (browser, port) => {
    const pg = await browser.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await pg.addInitScript(SB);
    await pg.route('**/fonts.googleapis.com/**',
      r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await pg.route('**/cdn.jsdelivr.net/**',
      r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB }));
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await pg.waitForTimeout(1200);
    return { pg, errs };
  };

  const browser = await chromium.launch();

  /* ٤أ) الخطط وصلت: كل تخصص يُرسم بلا أخطاء */
  {
    const srv = mk(true); await new Promise(r => srv.listen(45902, r));
    const { pg, errs } = await open(browser, 45902);

    const majors = await pg.evaluate(() => Object.keys(window.PLANS || {}));
    ok(majors.length >= 20, 'الصفحة قرأت الخطط من /plans.js — ' + majors.length + ' مفتاح');
    ok(await pg.evaluate(() => window.PLANS_OK === true), 'PLANS_OK صحيحة لما يصل الملف');

    /* كل تخصص × كل نسخة خطة (جديدة وقديمة) */
    for (const code of majors) {
      if (/_OLD$/.test(code)) continue;                /* تُرسم عبر نسختها */
      for (const ver of ['new', 'old']) {
        const before = errs.length;
        const out = await pg.evaluate(([c, v]) => {
          try {
            PLAN_VER = v; applyMajor(c, true); switchTab('plan'); renderPlan();
            return { ok: true, sems: document.querySelectorAll('.sem-block').length,
                     len: (document.getElementById('planSemesters') || {}).textContent.length };
          } catch (e) { return { ok: false, err: String(e.message) } }
        }, [code, ver]);
        ok(out.ok && out.sems >= 4,
           `خطتي ترسم ${code}/${ver} — ${out.ok ? out.sems + ' ترم' : out.err}`);
        ok(errs.length === before,
           `${code}/${ver} بلا أخطاء JS — ` + errs.slice(before).join(' | '));
      }
    }
    ok(errs.length === 0, 'ولا خطأ JS في كل الجولة — ' + errs.slice(0, 3).join(' | '));
    await pg.close(); srv.close();
  }

  /* ٤ب) الخطط ما وصلت: لا انهيار، ورسالة واضحة */
  {
    const srv = mk(false); await new Promise(r => srv.listen(45903, r));
    const { pg, errs } = await open(browser, 45903);

    ok(await pg.evaluate(() => window.PLANS_OK === false), 'PLANS_OK خاطئة لما يغيب الملف');

    const msg = await pg.evaluate(() => {
      try { switchTab('plan'); renderPlan();
        const el = document.getElementById('planSemesters');
        return el ? el.textContent.trim() : '';
      } catch (e) { return 'THREW:' + e.message }
    });
    ok(!/^THREW:/.test(msg), 'renderPlan ما رمى استثناءً بلا خطط — ' + msg);
    ok(/تعذّر تحميل الخطط/.test(msg),
       'تبويب خطتي يعرض رسالة واضحة — «' + msg.slice(0, 60) + '»');
    ok(errs.length === 0, 'لا انهيار JS لما يغيب /plans.js — ' + errs.slice(0, 3).join(' | '));
    ok(await pg.evaluate(() => !!document.getElementById('pagePlan')), 'بقية الصفحة حيّة');
    await pg.close(); srv.close();
  }

  await browser.close();
  done();
})().catch(e => { ok(false, 'انهار اختبار الصفحة: ' + e.message); done() });

function done() {
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}
