/* سرّ الـwebhook — اختبار سلوكي على السيرفر الحقيقي (موافقة محمد).
   السيرفر يشتغل فعلاً، و https.request محاكٍ يلعب دور تيليغرام وSupabase.

   الخطر: /tg-webhook كان يقبل أي طلب بلا تحقق إنه من تيليغرام. تيليغرام
   يرسل مع كل تحديث ترويسة سرّ نختاره عند setWebhook، ونرفض ما يحملها.

   أخطار يمسكها:
   ١) تحديث بلا السرّ (أو بسرّ غلط) ينعالج.
   ٢) التسجيل يغيّر رابط البوت أو يرمي تحديثاته المعلّقة.
   ٣) التسجيل فشل فانقفل البوت على نفسه — الربط بـ/start يمر من هنا.
   ٤) ما فيه رابط مسجّل فنخترع واحداً.
   ٥) الرفض يصير بوابة لإغراق تيليغرام بإعادة التسجيل.

   node tests/test-tg-hook.js [server.js]
   (يشغّل نفسه مرتين إضافيتين كعمليات مستقلة: التسجيل يفشل · بلا رابط —
    التسجيل مرة عند الإقلاع) */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const { fork } = require('child_process');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=ok').slice(7);

let pass = 0, fail = 0;
const out = [];
const ok = (c, m) => { if (c) { pass++ } else { fail++; out.push(`  ✗ [${MODE}] ` + m) } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} — توقّعنا ${JSON.stringify(b)} وجانا ${JSON.stringify(a)}`);

const HOOK_URL = 'https://jadwalik.com/tg-webhook';
const TOKEN = '8123456789:AAH-test-token-for-jadwalik';
const TG = [];
let MID = 100;

const DB = {
  profiles: [
    { id: 'u-own', telegram_chat_id: '5555', telegram_username: 'own', name: 'Own' },
    { id: 'u-st', telegram_chat_id: '6101', telegram_username: 'st', name: 'St' },
    { id: 'u-st2', telegram_chat_id: '6102', telegram_username: 'st2', name: 'St2' },
  ],
};
function supabase(method, urlPath) {
  const [p, qs = ''] = urlPath.split('?');
  const table = p.replace('/rest/v1/', '');
  if (method !== 'GET') return [201, []];
  const rows = (DB[table] || []).slice();
  const P = new URLSearchParams(qs);
  const chat = P.get('telegram_chat_id');
  if (chat && /^eq\./.test(chat)) return [200, rows.filter(r => r.telegram_chat_id === chat.slice(3))];
  return [200, rows];
}

const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on() { return req }, setTimeout() { return req }, destroy() {},
    write(d) { chunks.push(d) },
    end(d) {
      if (d) chunks.push(d);
      let code = 200, o = [];
      const body = chunks.join('');
      if (host === 'api.telegram.org') {
        let b = {}; try { b = JSON.parse(body || '{}') } catch (e) {}
        const method = String(opts.path || '').split('/').pop();
        TG.push({ method, b, path: opts.path });
        if (method === 'getWebhookInfo')
          o = { ok: true, result: MODE === 'nourl'
            ? { url: '', has_custom_certificate: false, pending_update_count: 0 }
            : { url: HOOK_URL, has_custom_certificate: false, pending_update_count: 3,
                allowed_updates: ['message', 'callback_query'], max_connections: 40 } };
        else if (method === 'setWebhook')
          o = MODE === 'fail' ? { ok: false, error_code: 400, description: 'Bad Request: test' }
                              : { ok: true, result: true, description: 'Webhook was set' };
        else o = { ok: true, result: { message_id: ++MID } };
      } else if (host.includes('pmu.edu.sa')) {
        o = [];
      } else {
        [code, o] = supabase(opts.method, opts.path);
      }
      const txt = JSON.stringify(o);
      const res = new Readable({ read() { this.push(txt); this.push(null) } });
      res.statusCode = code; res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

const BASES = { ok: 48100, fail: 48200, nourl: 48300 };
const PORT = BASES[MODE] + (process.pid % 100);
Object.assign(process.env, {
  SITE_ENV: 'prod', PORT: String(PORT), ADMIN_TOKEN: 'admin-token-for-tests',
  ADMIN_CHAT_ID: '5555', TELEGRAM_TOKEN: TOKEN,
  ACTIVE_TERM: '203010', FREE_BETA: 'true', MONITOR_ENABLED: 'false',
  SB_URL: 'https://fake.supabase.co', SUPABASE_URL: 'https://fake.supabase.co',
  SB_SERVICE_KEY: 'k', SUPABASE_SERVICE_KEY: 'k',
});
const realLog = console.log;
console.log = () => {};
require(SRV);

let UPD = 1;
function post(update, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(update);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/tg-webhook', method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => resolve({ code: res.statusCode, body: o }));
    });
    r.on('error', reject); r.end(data);
  });
}
const msg = (chat, text) => ({ update_id: ++UPD, message: { message_id: ++UPD,
  date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' },
  from: { id: Number(chat), is_bot: false, first_name: 'X' }, text } });
const wait = ms => new Promise(r => setTimeout(r, ms));
const sentTo = (n, chat) => TG.slice(n).filter(c => c.method === 'sendMessage'
  && String(c.b.chat_id) === String(chat));
const H = s => ({ 'X-Telegram-Bot-Api-Secret-Token': s });

async function main() {
  /* التسجيل يصير بعد الإقلاع بلحظات — ننتظره (ثلاث ثواني حد أقصى) */
  for (let i = 0; i < 30; i++) {
    if (TG.some(c => c.method === 'setWebhook') ||
        (MODE === 'nourl' && TG.some(c => c.method === 'getWebhookInfo'))) break;
    await wait(100);
  }
  await wait(100);

  if (MODE === 'ok') {
    const set = TG.find(c => c.method === 'setWebhook') || { b: {} };
    ok(TG.some(c => c.method === 'setWebhook'), '**الإقلاع يسجّل السرّ عند تيليغرام**');
    eq(set.b.url, HOOK_URL, '**بنفس الرابط المسجّل** — ما نخمّن رابطاً ولا ننقل البوت');
    ok(/^[A-Za-z0-9_-]{32,256}$/.test(set.b.secret_token || ''),
       'السرّ بصيغة تيليغرام — ' + String(set.b.secret_token).length + ' حرف');
    ok(!String(set.b.secret_token).includes(TOKEN.split(':')[1]), 'والسرّ مو رمز البوت نفسه');
    eq(set.b.allowed_updates, ['message', 'callback_query'], 'ونفس أنواع التحديثات');
    eq(set.b.max_connections, 40, 'ونفس عدد الاتصالات');
    ok(!('drop_pending_updates' in set.b), '**وما نرمي التحديثات المعلّقة**');
    /* بلا تسجيل (كود قديم) ما فيه سرّ — نكمل ونبلّغ الفشل مرتّباً بدل انهيار */
    const S = set.b.secret_token || 'no-secret-registered';

    let n = TG.length;
    let r = await post(msg('6101', '/help'));
    eq(r.code, 401, '**تحديث بلا السرّ: مرفوض**');
    eq(sentTo(n, '6101').length, 0, 'وما انعالج — ما رد البوت');

    n = TG.length;
    r = await post(msg('5555', '/broadcast رسالة مزيّفة للكل'));
    eq(r.code, 401, '**تحديث مزيّف بأمر مشرف: مرفوض**');
    ok(!TG.slice(n).some(c => c.method === 'sendMessage'), '**وما طلعت ولا رسالة لأحد**');

    n = TG.length;
    r = await post(msg('6101', '/help'), H('x'.repeat(64)));
    eq(r.code, 401, 'سرّ غلط: مرفوض');
    eq(sentTo(n, '6101').length, 0, 'وما انعالج');

    n = TG.length;
    r = await post(msg('6101', '/help'), H(S));
    eq(r.code, 200, '**بالسرّ الصحيح: مقبول**');
    ok(sentTo(n, '6101').some(c => /وش يقدر يسوي جدولك/.test(c.b.text || '')),
       'وانعالج — رد /help');

    /* رفضات كثيرة ما تسبّب إعادة تسجيل مع كل واحد */
    for (let i = 0; i < 5; i++) await post(msg('6102', 'هلا'));
    await wait(200);
    eq(TG.filter(c => c.method === 'setWebhook').length, 1,
       '**الرفض ما يصير بوابة لإغراق تيليغرام** — إعادة التسجيل بحدّها');
  }

  if (MODE === 'fail') {
    ok(TG.some(c => c.method === 'setWebhook'), 'حاول يسجّل');
    let n = TG.length;
    const r = await post(msg('6101', '/help'));
    eq(r.code, 200, '**التسجيل فشل: ما نقفل البوت على نفسه** — نقبل بلا ترويسة');
    ok(sentTo(n, '6101').length > 0, 'وانعالج');
    n = TG.length;
    const r2 = await post(msg('6101', '/help'), H('wrong-secret-value-here'));
    eq(r2.code, 401, 'لكن السرّ الغلط مرفوض دائماً');
    eq(sentTo(n, '6101').length, 0, 'وما انعالج');
  }

  if (MODE === 'nourl') {
    ok(TG.some(c => c.method === 'getWebhookInfo'), 'سأل تيليغرام عن الرابط');
    ok(!TG.some(c => c.method === 'setWebhook'), '**ما فيه رابط مسجّل: ما نخترع رابطاً**');
    const n = TG.length;
    const r = await post(msg('6101', '/help'));
    eq(r.code, 200, 'وبلا تسجيل ما نقفل البوت');
    ok(sentTo(n, '6101').length > 0, 'وانعالج');
  }
}

/* البيئات الثانية في عمليات مستقلة: التسجيل مرة عند الإقلاع */
function child(mode) {
  return new Promise(resolve => {
    const p = fork(__filename, [SRV, '--mode=' + mode], { silent: true });
    let s = '';
    p.stdout.on('data', d => s += d);
    p.on('exit', () => resolve(s));
  });
}

main().then(async () => {
  console.log = realLog;
  if (MODE === 'ok') {
    for (const m of ['fail', 'nourl']) {
      const s = await child(m);
      const mm = /(\d+) نجحت · (\d+) فشلت/.exec(s);
      s.split('\n').filter(l => l.includes('✗')).forEach(l => out.push(l));
      if (mm) { pass += +mm[1]; fail += +mm[2] } else { fail++; out.push(`  ✗ [${m}] انهار: ${s.slice(-300)}`) }
    }
  }
  out.forEach(l => console.log(l));
  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.log = realLog;
  out.forEach(l => console.log(l));
  console.log('انهار: ' + (e && e.stack || e));
  process.exit(1);
});
