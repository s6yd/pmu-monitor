/* إنهاء موسم المراقبة — اختبار تكاملي حقيقي.
   نشغّل server.js فعلاً ونعترض https، فالمسار والصلاحية والحذف
   والرسائل كلها تمرّ بالكود الحقيقي. بلا شبكة.

   node tests/test-season-end.js [مسار server.js] */
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
/* المنفذ يتغيّر مع كل تشغيل: منفذ ثابت يبقى محجوزاً بعد انتهاء
   العملية (TIME_WAIT أو بقايا جلسة)، فيفشل التشغيل التالي بـEADDRINUSE
   والاختبار يطلع أحمر بلا علاقة بالكود. النطاق ١٠٠ لكل ملف فما يتصادمان. */
const PORT = 46700 + (process.pid % 100);
const TOKEN = 'admin-token-for-tests';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

/* ── قاعدة وهمية ── */
const DB = { monitored_courses: [], profiles: [], app_events: [], notif_approvals: [] };
const TG = [];                      /* كل نداء راح لتيليغرام — بطريقته */
/* **الرسائل وحدها**: نداء تيليغرام مو كله رسالة لطالب. `setMyCommands`
   يضبط قائمة أوامر البوت عند الإقلاع وما فيه `chat_id` أصلاً — فعدّه
   رسالةً يخلّي «ولا رسالة راحت» تفشل على شي ما وصل أحداً.
   نسجّل الكل (المحاكي يبقى أمينًا) ونعدّ ما له مستقبِل. */
const msgs = () => TG.filter(x => x.body && x.body.chat_id !== undefined);
let nextId = 1;

for (let u = 1; u <= 4; u++) {
  DB.profiles.push({ id: 'user-' + u, telegram_chat_id: u === 4 ? null : '90' + u,
                     notif_prefs: null, is_pro: true });
  const n = u === 1 ? 5 : 2;
  for (let i = 0; i < n; i++)
    DB.monitored_courses.push({
      id: nextId++, user_id: 'user-' + u, scope: i === 0 ? 'course' : 'section',
      course_code: 'MEEN 33' + (10 + i), crn: i === 0 ? null : '2000' + i,
      term: '202710', created_at: new Date(Date.now() - 3 * 864e5).toISOString()
    });
}
/* الصف الشارد بترم آخر */
DB.monitored_courses.push({ id: nextId++, user_id: 'user-2', scope: 'course',
  course_code: 'MEEN 4311', crn: null, term: '202720',
  created_at: new Date(Date.now() - 864e5).toISOString() });

const TOTAL = DB.monitored_courses.length;      /* 11 */
const STUDENTS = 4;

/* ── اعتراض https قبل تحميل السيرفر ── */
const https = require('https');
https.request = function (opts, cb) {
  const host = opts.hostname || '';
  const chunks = [];
  const req = {
    on(ev, fn) { if (ev === 'error') req._err = fn; return req },
    setTimeout() { return req },
    write(d) { chunks.push(d) },
    end() {
      const body = chunks.join('');
      let out = '[]';
      if (host === 'api.telegram.org') {
        TG.push({ method: String(opts.path || '').split('/').pop(),
                  body: JSON.parse(body || '{}') });
        out = JSON.stringify({ ok: true, result: { message_id: TG.length } });
      } else {
        out = JSON.stringify(supabase(opts.method, opts.path, body));
      }
      const res = new Readable({ read() { this.push(out); this.push(null) } });
      res.statusCode = 200;
      res.headers = {};
      setImmediate(() => cb(res));
    }
  };
  return req;
};

function supabase(method, urlPath, body) {
  const [p, rawQs = ''] = urlPath.split('?');
  /* URL يرمّز علامات الاقتباس إلى %22 — نفكّها كما يفعل PostgREST */
  let qs; try { qs = decodeURIComponent(rawQs) } catch (e) { qs = rawQs }
  const table = p.replace('/rest/v1/', '');
  const rows = DB[table] || (DB[table] = []);
  const idIn = /id=in\.\(([^)]*)\)/.exec(qs);
  const idsQ = idIn ? new Set(idIn[1].split(',').map(x => x.replace(/"/g, ''))) : null;

  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    const row = Object.assign({ id: nextId++ }, b);
    rows.push(row);
    return /return=representation/.test(qs) ? [row] : [];
  }
  if (method === 'DELETE') {
    const gone = rows.filter(r => idsQ && idsQ.has(String(r.id)));
    DB[table] = rows.filter(r => !(idsQ && idsQ.has(String(r.id))));
    return gone;
  }
  /* GET */
  let out = rows.slice();
  if (idsQ) out = out.filter(r => idsQ.has(String(r.id)));
  const lim = /limit=(\d+)/.exec(qs);
  const off = /offset=(\d+)/.exec(qs);
  if (off) out = out.slice(Number(off[1]));
  if (lim) out = out.slice(0, Number(lim[1]));
  return out;
}

/* ── تشغيل السيرفر ── */
process.env.PORT = String(PORT);
process.env.ADMIN_TOKEN = TOKEN;
process.env.SB_URL = 'https://fake.supabase.co';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SB_SERVICE_KEY = 'service-key';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.TELEGRAM_TOKEN = 'tg-token';
process.env.ADMIN_CHAT_ID = '5555';
process.env.SITE_ENV = 'prod';
const realLog = console.log;
console.log = () => {};
require(SRV);
console.log = realLog;

function call(act, method, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/admin/' + act, method,
      headers: Object.assign({ 'X-Admin-Token': TOKEN },
        data ? { 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
      let o = ''; res.on('data', c => o += c);
      res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(o) }) }
                            catch (e) { resolve({ code: res.statusCode, body: o }) } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(400);

  /* ── ١) الصلاحية ── */
  {
    const r = await new Promise((res, rej) => {
      const q = http.request({ host: '127.0.0.1', port: PORT,
        path: '/api/admin/monitor-season-end', method: 'GET',
        headers: { 'X-Admin-Token': 'wrong' } },
        x => { let o = ''; x.on('data', c => o += c); x.on('end', () => res({ code: x.statusCode })) });
      q.on('error', rej); q.end();
    });
    ok(r.code === 401, 'بلا كلمة سر صحيحة: ٤٠١ — جاء ' + r.code);
  }

  /* ── ٢) العدّ قبل القرار لا يحذف شيئاً ── */
  {
    const r = await call('monitor-season-end', 'GET');
    ok(r.code === 200, 'العدّ يرجّع ٢٠٠');
    ok(r.body.total === TOTAL, `المجموع ${TOTAL} — جاء ${r.body.total}`);
    ok(r.body.students === STUDENTS, `الطلاب ${STUDENTS} — جاء ${r.body.students}`);
    const t1 = (r.body.terms || []).find(t => t.term === '202710');
    const t2 = (r.body.terms || []).find(t => t.term === '202720');
    ok(t1 && t1.rows === TOTAL - 1, `تفصيل ترم 202710: ${t1 && t1.rows} والمتوقع ${TOTAL - 1}`);
    ok(t2 && t2.rows === 1, 'الصف الشارد بترم 202720 ظاهر في التفصيل');
    ok(DB.monitored_courses.length === TOTAL, 'GET ما حذف ولا صفاً');
    ok(msgs().length === 0, 'GET ما أرسل ولا رسالة');
    /* وضبط قائمة الأوامر عند الإقلاع نداء إعداد لا رسالة — نثبته هنا
       بدل ما نتركه يتنكّر في عدّ الرسائل */
    ok(TG.some(x => x.method === 'setMyCommands'),
       'وقائمة أوامر البوت انضبطت عند الإقلاع');
    ok(!TG.filter(x => x.method === 'setMyCommands')
        .some(x => x.body.chat_id !== undefined),
       'وهي بلا مستقبِل — إعداد للبوت لا رسالة لطالب');
  }

  /* ── ٣) ترم واحد فقط ── */
  {
    const r = await call('monitor-season-end', 'POST', { term: '202720', notify: false });
    ok(r.body.stopped === 1, 'حذف صف الترم المحدد وحده');
    ok(DB.monitored_courses.length === TOTAL - 1, 'الباقي سليم');
    ok(msgs().length === 0, 'notify=false: صفر رسالة');
  }

  /* ── ٤) إنهاء الموسم كاملاً ── */
  {
    const before = DB.monitored_courses.length;
    const r = await call('monitor-season-end', 'POST', { notify: true, note: 'شكراً لكم' });
    ok(r.body.ok === true, 'التنفيذ رجع ok');
    ok(r.body.stopped === before, `أوقف ${before} — جاء ${r.body.stopped}`);
    ok(r.body.students === STUDENTS, 'عدّ الطلاب صحيح');
    ok(DB.monitored_courses.length === 0, 'الجدول صار فاضياً');

    await wait(2500);                       /* الرسائل تنطلق بالخلفية */
    const toStudents = msgs().filter(m => ['901', '902', '903'].includes(String(m.body.chat_id)));
    ok(toStudents.length === 3,
       `رسالة واحدة لكل طالب مربوط — وصلت ${toStudents.length} لا ${before}`);
    const u1 = (toStudents.find(m => String(m.body.chat_id) === '901') || {}).body;
    ok(u1 && (u1.text.match(/^•/gm) || []).length === 5,
       'رسالة صاحب الخمس مواد تجمعها كلها في رسالة واحدة');
    ok(u1 && /كل الشعب/.test(u1.text), 'تفرّق بين «كل الشعب» والشعبة');
    ok(u1 && /CRN 20001/.test(u1.text), 'وتذكر رقم الشعبة');
    ok(u1 && /شكراً لكم/.test(u1.text), 'والسطر الإضافي وصل');
    ok(u1 && /ترجّعها من الجرس/.test(u1.text), 'وفيها كيف يرجّعها');
    ok(!msgs().some(m => String(m.body.chat_id) === 'null'),
       'من لم يربط تيليغرام لم تُحاول له رسالة');
    ok(msgs().some(m => String(m.body.chat_id) === '5555'
        && /انتهى موسم المراقبة/.test(m.body.text)),
       'وصل تقرير الإدارة');
    const ev = DB.app_events.filter(e => e.kind === 'season-end');
    ok(ev.length === 2, 'حدث واحد لكل تنفيذ لا حدث لكل صف — ' + ev.length);
    ok(ev[1] && ev[1].payload.rows === before, 'الحدث يحمل العدد');
    ok(ev[1] && ev[1].payload.medianLivedMin > 0, 'ووسيط عمر المراقبة محفوظ');
  }

  /* ── ٥) الجدول فاضي: لا انهيار ── */
  {
    const r = await call('monitor-season-end', 'POST', { notify: true });
    ok(r.body.stopped === 0, 'جدول فاضٍ: صفر بلا خطأ');
  }

  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('انهار الاختبار: ' + e.stack); process.exit(1) });
