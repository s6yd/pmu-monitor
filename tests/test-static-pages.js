/* الصفحات والملفات الثابتة — اختبار.
   main وdev كانا تاريخين منفصلين، فـ about.html وog.png كانا في الإنتاج فقط.
   دمج dev ← main بنسخة dev عمياني كان يحذفهما من الإنتاج بصمت: /about يرجع
   404، وog:image في الصفحة يشير لملف غير موجود فتنكسر معاينة الروابط.
   هذا الاختبار يمسك النوعين: مسار يرجع غير 200، وملف تشير له الصفحة وهو ناقص.

   node tests/test-static-pages.js [server.js] */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const ROOT = path.dirname(SRV);
/* المنفذ يتغيّر مع كل تشغيل: منفذ ثابت يبقى محجوزاً بعد انتهاء
   العملية (TIME_WAIT أو بقايا جلسة)، فيفشل التشغيل التالي بـEADDRINUSE
   والاختبار يطلع أحمر بلا علاقة بالكود. النطاق ١٠٠ لكل ملف فما يتصادمان. */
const PORT = 46800 + (process.pid % 100);

/* المسارات اللي لازم تُخدم — قوقل وبوابات الدفع وiOS يطلبونها */
const ROUTES = [
  '/', '/index.html',
  '/about', '/about.html',
  '/privacy', '/privacy.html',
  '/terms', '/terms.html',
  '/guide', '/guide.html',
  '/og.png', '/manifest.json',
  '/favicon.ico',
  '/favicon-32.png', '/favicon-180.png', '/favicon-192.png', '/favicon-512.png',
];

/* ═══ الملفات اللي تشير لها الصفحة والمانيفست — تُستخرج لا تُكتب بيدنا ═══
   لو أضيفت أيقونة جديدة للصفحة، الاختبار يلتقطها تلقائياً. */
function referencedAssets() {
  const out = new Set();
  const add = u => { const p = toPath(u); if (p) out.add(p) };

  const page = read('pmu-schedule.html');
  if (page) {
    /* og:image و twitter:image — بالترتيبين (content قبل property أو بعدها) */
    for (const m of page.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi)) add(m[1]);
    for (const m of page.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) add(m[1]);
    /* الأيقونات والمانيفست */
    for (const m of page.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/gi)) add(m[1]);
    for (const m of page.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/gi)) add(m[1]);
    for (const m of page.matchAll(/<link[^>]+rel=["']manifest["'][^>]*href=["']([^"']+)["']/gi)) add(m[1]);
  }

  const man = read('manifest.json');
  if (man) { try { (JSON.parse(man).icons || []).forEach(i => i && i.src && add(i.src)) } catch (e) {} }

  return [...out];
}

/* رابط ← مسار محلي. الروابط لنطاقات غيرنا تُتجاهل — مو مسؤوليتنا. */
function toPath(u) {
  if (!u) return null;
  if (/^data:/i.test(u)) return null;
  if (/^https?:\/\//i.test(u)) {
    let x; try { x = new URL(u) } catch (e) { return null }
    if (!/(^|\.)jadwalik\.com$/i.test(x.hostname)) return null;
    return x.pathname;
  }
  if (u.startsWith('//')) return null;
  return u.startsWith('/') ? u : '/' + u;
}

function read(f) { try { return fs.readFileSync(path.join(ROOT, f), 'utf8') } catch (e) { return null } }

/* المسار ← اسم الملف على القرص، حسب توجيه server.js */
function diskFile(p) {
  if (p === '/' || p === '/index.html') return 'pmu-schedule.html';
  if (p === '/guide' || p === '/guide.html') return 'jadwalik-guide.html';
  if (p === '/about' || p === '/about.html') return 'about.html';
  if (p === '/privacy' || p === '/privacy.html') return 'privacy.html';
  if (p === '/terms' || p === '/terms.html') return 'terms.html';
  if (p === '/favicon.ico') return null;            /* يُخدم من أي أيقونة متوفرة */
  return p.slice(1);
}

/* ═══ الابن: يشغّل السيرفر فعلياً ويطلب كل مسار ═══ */
if (process.argv[2] === '--child') {
  const [, , , srv, routesJson] = process.argv;
  const http = require('http'), https = require('https');
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

  const get = p => new Promise(r => {
    const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, res => {
      let n = 0; res.on('data', c => n += c.length);
      res.on('end', () => r({ p, code: res.statusCode, type: res.headers['content-type'] || '', bytes: n }));
    });
    q.on('error', e => r({ p, code: 0, type: '', bytes: 0, err: String(e.message) }));
    q.end();
  });

  setTimeout(async () => {
    const out = [];
    for (const p of JSON.parse(routesJson)) out.push(await get(p));
    log(JSON.stringify(out));
    process.exit(0);
  }, 700);
  return;
}

/* ═══ الأب ═══ */
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

const refs = referencedAssets();
const all = [...new Set([...ROUTES, ...refs])];

const r = spawnSync(process.execPath, [__filename, '--child', SRV, JSON.stringify(all)],
                    { encoding: 'utf8', timeout: 30000 });
let res = null;
try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch (e) {}
ok(!!res, 'السيرفر اشتغل ورد على الطلبات');
if (!res) { console.log(`\n${pass} نجحت · ${fail} فشلت`); process.exit(1) }

const by = Object.fromEntries(res.map(x => [x.p, x]));

/* ١) كل مسار مطلوب يرجع 200 وبمحتوى فعلي */
for (const p of ROUTES) {
  const x = by[p];
  ok(x && x.code === 200, `${p} يرجع 200 — رجع ${x ? x.code : 'لا شيء'}`);
  if (x && x.code === 200) ok(x.bytes > 0, `${p} يرجع محتوى غير فارغ`);
}

/* ٢) الملف الأصلي موجود على القرص لكل مسار صفحة */
for (const p of ROUTES) {
  const f = diskFile(p);
  if (!f) continue;
  ok(fs.existsSync(path.join(ROOT, f)), `الملف ${f} موجود في المستودع (يخدمه ${p})`);
}

/* ٣) كل ملف تشير له الصفحة أو المانيفست موجود ويُخدم فعلاً */
ok(refs.length > 0, 'استُخرجت إشارات الصفحة للأيقونات وog:image');
for (const p of refs) {
  const f = diskFile(p);
  if (f) ok(fs.existsSync(path.join(ROOT, f)), `مُشار له من الصفحة: ${f} موجود في المستودع`);
  const x = by[p];
  ok(x && x.code === 200, `مُشار له من الصفحة: ${p} يُخدم 200 — رجع ${x ? x.code : 'لا شيء'}`);
}

/* ٤) الأنواع صحيحة — صورة ما ترجع HTML وبالعكس */
const isHtml = p => /text\/html/i.test((by[p] || {}).type || '');
const isPng  = p => /image\/png/i.test((by[p] || {}).type || '');
for (const p of ['/', '/about', '/privacy', '/terms', '/guide']) ok(isHtml(p), `${p} نوعه HTML`);
for (const p of ['/og.png', '/favicon-192.png']) ok(isPng(p), `${p} نوعه PNG`);
ok(/application\/json/i.test((by['/manifest.json'] || {}).type || ''), '/manifest.json نوعه JSON');

console.log(`\n${pass} نجحت · ${fail} فشلت`);
process.exit(fail ? 1 : 0);
