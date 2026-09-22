/* الحالة المحفوظة لكل بيئة — اختبار.
   الخدمتان في Render تتشاركان قاعدة واحدة. كانتا تكتبان نفس صف app_state،
   فمفتاح تضبطه في لوحة dev يغلب الإنتاج مع أول إعادة تشغيل له.

   node tests/test-state-isolation.js [server.js] */
const path = require('path');
const { spawnSync } = require('child_process');
const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));

/* ═══ الابن: سيرفر بقاعدة مزيّفة مزروعة، يطفئ الفترة المجانية ويطبع ما انكتب ═══ */
if (process.argv[2] === '--child') {
  const [, , , srv, env, seedJson] = process.argv;
  const http = require('http'), https = require('https');
  const { Readable } = require('stream');
  const DB = { app_state: JSON.parse(seedJson) };
  https.request = function (opts, cb) {
    const chunks = [];
    const req = { on() { return req }, setTimeout() { return req }, destroy() {},
      write(d) { chunks.push(d) },
      end() {
        let o = '[]';
        const [p, raw = ''] = (opts.path || '').split('?');
        const qs = decodeURIComponent(raw);
        if (p.endsWith('/app_state')) {
          if (opts.method === 'POST') {
            const b = JSON.parse(chunks.join('') || '{}');
            const i = DB.app_state.findIndex(x => x.key === b.key);
            if (i >= 0) DB.app_state[i] = b; else DB.app_state.push(b);
          } else {
            const k = (/key=eq\.([^&]+)/.exec(qs) || [])[1];
            o = JSON.stringify(DB.app_state.filter(x => x.key === k));
          }
        } else if ((opts.hostname || '') === 'api.telegram.org') o = '{"ok":true,"result":{}}';
        const res = new Readable({ read() { this.push(o); this.push(null) } });
        res.statusCode = 200; res.headers = {};
        setImmediate(() => cb(res));
      } };
    return req;
  };
  Object.assign(process.env, { PORT: '45891', ADMIN_TOKEN: 'admin-token-for-tests', SITE_ENV: env,
    SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
    SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', ADMIN_CHAT_ID: '5555', FREE_BETA: 'true' });
  const log = console.log; console.log = () => {};
  require(srv);
  const call = (p, m, body) => new Promise(r => {
    const data = body ? JSON.stringify(body) : null;
    const q = http.request({ host: '127.0.0.1', port: 45891, path: p, method: m,
      headers: Object.assign({ 'X-Admin-Token': 'admin-token-for-tests' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
      res => { let s = ''; res.on('data', c => s += c); res.on('end', () => r(JSON.parse(s || '{}'))) });
    if (data) q.write(data); q.end();
  });
  setTimeout(async () => {
    const before = await call('/api/admin/beta-toggle', 'GET');
    await call('/api/admin/beta-toggle', 'POST', { on: !before.on });
    const h = await call('/api/admin/health', 'GET');
    log(JSON.stringify({ restored: before.on, state: DB.app_state, key: h.stateKey, env: h.env }));
    process.exit(0);
  }, 700);
  return;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };
const run = (env, seed) => {
  const r = spawnSync(process.execPath, [__filename, '--child', SRV, env, JSON.stringify(seed)],
                      { encoding: 'utf8', timeout: 20000 });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch (e) { return null }
};
const row = (key, freeBeta) => ({ key, value: { toggles: { freeBeta } } });

/* الإنتاج محفوظ «منتهية»، و dev محفوظ «شغّالة» */
const seed = [row('runtime', false), row('runtime-dev', true)];

const dev = run('dev', seed);
ok(!!dev, 'dev اشتغل');
if (dev) {
  ok(dev.key === 'runtime-dev' && dev.env === 'dev', 'dev يقرأ ويكتب صفه — ' + dev.key);
  ok(dev.restored === true, 'dev استعاد حالته هو (شغّالة) لا حالة الإنتاج');
  const prod = dev.state.find(x => x.key === 'runtime');
  ok(prod && prod.value.toggles.freeBeta === false, 'مفتاح في لوحة dev ما لمس صف الإنتاج');
  const mine = dev.state.find(x => x.key === 'runtime-dev');
  ok(mine && mine.value.toggles.freeBeta === false, 'وانحفظ في صف dev');
}

const prod = run('prod', seed);
ok(!!prod, 'الإنتاج اشتغل');
if (prod) {
  ok(prod.key === 'runtime', 'الإنتاج باقٍ على «runtime» — ما يضيع ما هو محفوظ');
  ok(prod.restored === false, 'الإنتاج استعاد حالته هو (منتهية)');
  const d = prod.state.find(x => x.key === 'runtime-dev');
  ok(d && d.value.toggles.freeBeta === true, 'ومفتاحه ما لمس صف dev');
}

console.log(`\n${pass} نجحت · ${fail} فشلت`);
process.exit(fail ? 1 : 0);
