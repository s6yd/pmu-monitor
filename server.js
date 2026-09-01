const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/* ═══ صفحة الموقع: تُقرأ وتُضغط مرة وحدة عند تشغيل السيرفر ═══
   قبل كذا كنا نقرأها من القرص مع كل زيارة (300KB لكل طالب).
   الآن تُحفظ في الذاكرة مضغوطة (~60KB) مع ETag.
   أي رفع جديد للملف يعيد تشغيل Render فتتجدد النسخة تلقائياً. */
let PAGE = null;
function loadPage() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'pmu-schedule.html'));
    PAGE = {
      raw,
      gz: zlib.gzipSync(raw, { level: 9 }),
      etag: '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"'
    };
    console.log(`page cached: ${(raw.length / 1024).toFixed(0)}KB → gzip ${(PAGE.gz.length / 1024).toFixed(0)}KB`);
  } catch (e) {
    PAGE = null;
    console.log('page load failed:', e.message);
  }
}
loadPage();

/* .trim() مهم: أي مسافة أو سطر زائد في متغيرات Render
   يكسر الطلبات برسالة "Request path contains unescaped characters" */
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN || '').trim();
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SB_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();   // كلمة سر لوحة التحكم

/* فترة تجريبية مجانية: كل من ربط تيليغرام يستلم الإشعارات بدون اشتراك.
   لإيقافها لاحقاً: FREE_BETA=false في متغيرات Render. */
const FREE_BETA = (process.env.FREE_BETA || 'true').trim() !== 'false';
/* ترم التسجيل النشط — المزامنة والإشعارات تقتصر عليه وحده.
   من متغيّر بيئة عشان تغيّره من Render بلا نشر كل ترم جديد. */
const ACTIVE_TERM = (process.env.ACTIVE_TERM || '202710').trim();

/* معرّف محادثتك في تيليغرام — يوصلك عليه كل رأي جديد فوراً.
   تجيبه بإرسال /whoami للبوت، ثم تحطه في Render باسم ADMIN_CHAT_ID */
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

/* ═══ Pushover — قناة تنبيه إضافية لك أنت فقط ═══
   تحتاج متغيرين في Render: PUSHOVER_TOKEN (من تطبيق تنشئه في
   pushover.net/apps) و PUSHOVER_USER (مفتاحك في إعدادات التطبيق).
   بدونهما هذي الدالة ما تسوي شي، والموقع يشتغل كما هو تماماً.
   ما تُستخدم أبداً لإشعارات الطلاب — لك وحدك. */
const PUSHOVER_TOKEN = (process.env.PUSHOVER_TOKEN || '').trim();
const PUSHOVER_USER  = (process.env.PUSHOVER_USER  || '').trim();
const PUSHOVER_ON = !!(PUSHOVER_TOKEN && PUSHOVER_USER);

function pushover(title, message, opts) {
  if (!PUSHOVER_ON) {
    console.log('pushover: معطّل — PUSHOVER_TOKEN أو PUSHOVER_USER ناقص');
    return Promise.resolve(null);
  }
  /* opts رقم = الأولوية فقط (توافق مع الاستدعاءات القديمة)،
     أو كائن {priority, sound, retry, expire}.
     الأولوية 2 = طارئ: يعيد التنبيه حتى تضغط «تأكيد» بنفسك،
     وتيليغرام يشترط معها retry و expire. */
  const o = (typeof opts === 'object' && opts) ? opts : { priority: opts || 0 };
  const pr = Number(o.priority || 0);
  return new Promise(resolve => {
    try {
      const fields = {
        token: PUSHOVER_TOKEN, user: PUSHOVER_USER,
        title: String(title || 'جدولك').slice(0, 250),
        message: String(message || '').slice(0, 1024),
        priority: String(pr)
      };
      if (o.sound) fields.sound = String(o.sound);
      if (pr === 2) {
        fields.retry  = String(o.retry  || 30);    /* يعيد كل 30 ثانية */
        fields.expire = String(o.expire || 3600);  /* يوقف بعد ساعة */
      }
      const body = new URLSearchParams(fields).toString();
      const req = https.request({
        hostname: 'api.pushover.net', path: '/1/messages.json', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                   'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let out = '';
        res.on('data', c => { if (out.length < 400) out += c; });
        res.on('end', () => {
          if (res.statusCode === 200) console.log(`pushover: تم الإرسال ✓ (أولوية ${pr})`);
          else console.log(`pushover: فشل ${res.statusCode} — ${out.slice(0, 300)}`);
          resolve(res.statusCode === 200);
        });
      });
      req.on('error', e => { console.log('pushover: خطأ اتصال —', e.message); resolve(false) });
      req.setTimeout(8000, () => { req.destroy(); console.log('pushover: انتهت المهلة'); resolve(false) });
      req.write(body); req.end();
    } catch (e) { console.log('pushover: استثناء —', e.message); resolve(false) }
  });
}

/* وضع الصيانة: MAINTENANCE=on في Render يقفل الموقع للطلاب.
   لوحة التحكم و/api/admin تبقى شغالة عشان تقدر تتابع. */
let MAINTENANCE = (process.env.MAINTENANCE || '').trim() === 'on';
let MAINT_MSG = (process.env.MAINTENANCE_MSG || '').trim();

/* عرض جدول الاختبارات النهائية: FINALS_ENABLED=off في Render يوقفه.
   نوقفه بين الترمين لأن موقع الجامعة يبقي جدول الترم الماضي منشوراً،
   وأسماء المواد والشعب تتكرر فيطلع للطالب جدول قديم كأنه جديد.
   يُبدّل أيضاً من لوحة التحكم، لكن إعادة تشغيل Render ترجّعه لقيمة الإعداد. */
let FINALS_ON = (process.env.FINALS_ENABLED || '').trim() !== 'off';

/* نسخة الاختبار: تخدم الموقع لكن ما تراقب ولا ترسل إشعارات،
   عشان ما تتكرر الرسائل مع نسخة الإنتاج. */
const SITE_ENV = (process.env.SITE_ENV || 'prod').trim();
const MONITOR_ENABLED = SITE_ENV === 'prod' &&
  (process.env.MONITOR_ENABLED || 'true').trim() !== 'false';
const CHECK_INTERVAL = 5 * 60 * 1000;   // كل 5 دقائق

/* ============ Supabase REST helper ============ */
function sb(method, table, { query = '', body = null, prefer = '' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${SB_URL}/rest/v1/${table}${query}`);
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'apikey': SB_SERVICE_KEY,
      'Authorization': `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };
    if (prefer) headers['Prefer'] = prefer;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method, headers
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve(out ? JSON.parse(out) : []); }
        catch (e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Supabase timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

/* ============ سحبة على صفحات ============
   Supabase يقصّ أي رد عند سقف الصفوف (1000 افتراضياً) ويرجع 200 بلا تحذير.
   فالجدول اللي تجاوز الألف يُفحص جزئياً والباقي يُهمل بصمت.
   نطلب صفحة صفحة بترتيب ثابت على id، ونقف عند أول صفحة ناقصة. */
const SB_PAGE = 1000;
const SB_PAGE_MAX = 100;                 /* حارس: 100 ألف صف كحد أقصى */
async function sbAll(table, { query = '', order = 'id', pageSize = SB_PAGE } = {}) {
  const out = [];
  for (let page = 0; page < SB_PAGE_MAX; page++) {
    const q = `${query}&order=${order}.asc&limit=${pageSize}&offset=${page * pageSize}`;
    const rows = await sb('GET', table, { query: q });
    if (!Array.isArray(rows)) break;
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) return out;   /* صفحة ناقصة = النهاية */
  }
  console.log(`sbAll: ${table} تجاوز حارس الصفحات — الرد مقصوص`);
  return out;
}

/* ============ Telegram ============ */
/* ═══════════ تنبيهات جدولك ═══════════
   دورة يومية الساعة 5 العصر بتوقيت السعودية. تقرأ المواعيد والغياب،
   تحترم تفضيلات الطالب و«ذكّرني بكرة»، وترسل عبر البوت.
   المبدأ: قلة التنبيهات تحميها. طالب يكتم البوت يخسر معه تنبيهات
   المراقبة كلها، فأي تنبيه زائد أغلى مما يبدو. */
const NOTIF_HOUR = 17;                    /* 5 العصر */
const NOTIF_LEAD = 2;                     /* ننبّه قبل الموعد بيومين */
const NOTIF_CONFIRM_MIN = 3;              /* عتبة «أكّده زملاؤك» */
const NOTIF_DEF = { on: true, event: true, confirmed: true, absence: true, acad: true };
const NOTIF_KIND_AR = { quiz: '📝 كويز', hw: '📄 واجب', project: '📐 مشروع',
                        midterm: '📕 اختبار فصلي', other: '📌 موعد' };


/* التقويم على السيرفر — المواعيد الحرجة فقط. نسخة مصغّرة من ACAD_CAL في
   الواجهة، وهذا تكرار مقصود لكنه دَيْن: أي تعديل هناك لازم ينعكس هنا.
   الأصح لاحقاً أن يُقرأ من جدول في Supabase وتقرأه الجهتان. */
const ACAD_CAL_SERVER = [
  { s: '2026-08-30', t: 'start', ar: 'بداية الدراسة' },
  { s: '2026-09-06', e: '2026-09-10', t: 'add', ar: 'فترة الحذف (آخر يوم بدون رسوم)' },
  { s: '2026-09-23', e: '2026-09-26', t: 'off', ar: 'إجازة اليوم الوطني' },
  { s: '2026-11-05', t: 'warn', ar: 'آخر يوم للانسحاب بتقدير W' },
  { s: '2026-11-22', e: '2026-11-24', t: 'off', ar: 'إجازة منتصف الترم' },
  { s: '2026-12-20', e: '2026-12-30', t: 'exam', ar: 'الاختبارات النهائية' }
];

/* حد الغياب: 15% من محاضرات الجلسة، معدودة بين بداية الدراسة وأول يوم
   نهائيات ناقص الإجازات — نفس قاعدة الواجهة بالضبط. */
const WD_LETTER_SRV = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
function absAllowedFor(courseDate) {
  const days = String(courseDate || '').toUpperCase().split('')
    .filter(c => 'UMTWRFS'.includes(c));
  if (!days.length) return 0;
  const start = ACAD_CAL_SERVER.find(e => e.t === 'start');
  const exam = ACAD_CAL_SERVER.find(e => e.t === 'exam');
  if (!start || !exam) return 0;
  const off = new Set();
  ACAD_CAL_SERVER.filter(e => e.t === 'off').forEach(e => {
    let d = new Date(e.s + 'T00:00:00Z');
    const last = new Date((e.e || e.s) + 'T00:00:00Z');
    let g = 0;
    while (d <= last && g++ < 400) {
      off.add(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 864e5);
    }
  });
  let n = 0, g = 0;
  let d = new Date(start.s + 'T00:00:00Z');
  const end = new Date(exam.s + 'T00:00:00Z');
  while (d < end && g++ < 400) {
    const iso = d.toISOString().slice(0, 10);
    if (days.includes(WD_LETTER_SRV[d.getUTCDay()]) && !off.has(iso)) n++;
    d = new Date(d.getTime() + 864e5);
  }
  return Math.floor(n * 0.15);
}

/* التاريخ والساعة بتوقيت السعودية — نعيد استخدام riyadhNow القائمة
   بدل حساب ثانٍ قد ينحرف عنها. */
function ksaParts() {
  const d = riyadhNow();
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

function notifPrefsOf(profile) {
  return Object.assign({}, NOTIF_DEF, (profile && profile.notif_prefs) || {});
}

/* ما نرسل لمن لم يربط تيليغرام، ولا لمن أطفأ النوع أو المفتاح الرئيسي */
function wants(profile, key) {
  if (!profile || !profile.telegram_chat_id) return false;
  const p = notifPrefsOf(profile);
  return !!(p.on && p[key]);
}

/* ═══ بناء رسائل اليوم ═══
   دالة نقية: تأخذ الحالة وترجّع الرسائل. الإرسال منفصل عنها عشان
   نقدر نختبر المنطق بلا شبكة ولا قاعدة. */
function buildNotifications(state) {
  const { today, profiles, schedules, events, absences, acadCal, sharedCounts } = state;
  const target = dayShift(today, NOTIF_LEAD);
  const out = [];

  /* من يدرس أي CRN — نحتاجها للغياب و«أكّده زملاؤك» */
  const byUser = {};
  (schedules || []).forEach(r => {
    (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
  });

  for (const prof of (profiles || [])) {
    const uid = prof.id;
    const mine = byUser[uid] || [];
    if (!mine.length) continue;
    const lines = [];

    /* 1) موعد قادم بعد يومين */
    if (wants(prof, 'event')) {
      for (const e of (events || [])) {
        if (e.user_id !== uid) continue;
        if (e.on_date !== target) continue;
        if (e.notified_on === today) continue;          /* أُرسل اليوم */
        if (e.snooze_to && e.snooze_to > today) continue; /* مؤجَّل */
        const c = mine.find(m => String(m.crn) === String(e.crn));
        lines.push({
          kind: 'event', id: e.id,
          text: `${NOTIF_KIND_AR[e.kind] || '📌 موعد'} بعد يومين\n` +
                `${c ? c.course_code : ''}${e.note ? '\n' + e.note : ''}`
        });
      }
    }

    /* 2) موعد أكّده ثلاثة من الشعبة وما هو عندك */
    if (wants(prof, 'confirmed')) {
      for (const s of (sharedCounts || [])) {
        if (s.n < NOTIF_CONFIRM_MIN) continue;
        if (s.on_date <= today) continue;               /* مضى */
        const c = mine.find(m => String(m.crn) === String(s.crn));
        if (!c) continue;                               /* مو في شعبتك */
        const has = (events || []).some(e => e.user_id === uid &&
          String(e.crn) === String(s.crn) && e.kind === s.kind && e.on_date === s.on_date);
        if (has) continue;                              /* عندك أصلاً */
        lines.push({
          kind: 'confirmed',
          text: `✅ ${s.n} من شعبتك حدّدوا ${NOTIF_KIND_AR[s.kind] || 'موعداً'}\n` +
                `${c.course_code} · ${s.on_date}`
        });
      }
    }

    /* 3) قرب الحرمان */
    if (wants(prof, 'absence')) {
      const seen = {};
      for (const c of mine) {
        const used = (absences || []).filter(a =>
          a.user_id === uid && String(a.crn) === String(c.crn)).length;
        const max = c.allowed_abs;
        if (!max || used !== max - 1) continue;         /* بقي واحد بالضبط */
        if (seen[c.crn]) continue;
        seen[c.crn] = 1;
        lines.push({
          kind: 'absence',
          text: `⚠️ باقي لك غياب واحد في ${c.course_code}\n` +
                `${used} من ${max} — الغياب الجاي حرمان`
        });
      }
    }

    /* 4) موعد أكاديمي */
    if (wants(prof, 'acad')) {
      for (const a of (acadCal || [])) {
        if (a.s !== target) continue;
        if (a.t !== 'warn' && a.t !== 'add') continue;  /* المواعيد الحرجة فقط */
        lines.push({ kind: 'acad', text: `🗓️ بعد يومين: ${a.ar}` });
      }
    }

    if (lines.length)
      out.push({ user_id: uid, chat_id: prof.telegram_chat_id, lines });
  }
  return out;
}

/* ═══ الدورة ═══ */
let NOTIF_LAST = null;                    /* آخر يوم أُرسل فيه — يمنع التكرار */

async function notifyTick() {
  if (!SB_URL || !SB_SERVICE_KEY) return;
  const { date, hour } = ksaParts();
  if (hour !== NOTIF_HOUR) return;
  if (NOTIF_LAST === date) return;        /* أُرسلت اليوم */
  NOTIF_LAST = date;

  try {
    const term = ACTIVE_TERM;
    const [profiles, schedules, events, absences] = await Promise.all([
      sbAll('profiles', { query: '?select=id,telegram_chat_id,notif_prefs' }),
      sbAll('user_schedule', {
        query: `?term=eq.${encodeURIComponent(term)}&select=user_id,crn,course_code,course_date`
      }),
      sbAll('course_events', {
        query: `?term=eq.${encodeURIComponent(term)}&select=*`
      }),
      sbAll('absences', {
        query: `?term=eq.${encodeURIComponent(term)}&select=user_id,crn`
      })
    ]);

    /* عدّ المواعيد المشتركة لكل (شعبة + نوع + تاريخ) */
    const cnt = {};
    events.forEach(e => {
      if (e.shared === false) return;
      const k = `${e.crn}|${e.kind}|${e.on_date}`;
      cnt[k] = cnt[k] || { crn: e.crn, kind: e.kind, on_date: e.on_date, n: 0 };
      cnt[k].n++;
    });

    /* حد الغياب لكل جلسة — يُحسب من أيامها كما في الواجهة */
    const withMax = schedules.map(r => Object.assign({}, r, {
      allowed_abs: absAllowedFor(r.course_date)
    }));

    const msgs = buildNotifications({
      today: date, profiles, schedules: withMax, events, absences,
      acadCal: ACAD_CAL_SERVER, sharedCounts: Object.values(cnt)
    });

    let sent = 0, evIds = [];
    for (const m of msgs) {
      const body = m.lines.map(l => l.text).join('\n\n');
      const r = await sendMsg(m.chat_id, `🔔 تنبيهات جدولك\n\n${body}`);
      if (r && r.ok) {
        sent++;
        m.lines.forEach(l => { if (l.kind === 'event' && l.id) evIds.push(l.id) });
      }
      await new Promise(r2 => setTimeout(r2, 120));   /* حدود تيليغرام */
    }

    /* نعلّم المرسَل حتى لا يتكرر لو أُعيد تشغيل السيرفر */
    if (evIds.length)
      await sb('PATCH', 'course_events', {
        query: `?id=in.(${evIds.join(',')})`,
        body: { notified_on: date }, prefer: 'return=minimal'
      }).catch(() => {});

    if (sent) {
      console.log(`تنبيهات جدولك: ${sent} رسالة`);
      logEvent('notify', { sent, at: Date.now() });
    }
  } catch (e) {
    console.log('notifyTick: ' + e.message);
    NOTIF_LAST = null;                    /* نعيد المحاولة الساعة الجاية */
  }
}

function tg(method, payload) {
  return new Promise(resolve => {
    if (!TELEGRAM_TOKEN) return resolve({ ok: false, description: 'TELEGRAM_TOKEN غير مضبوط' });
    let req;
    try {
      const data = JSON.stringify(payload);
      req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, res => { let o=''; res.on('data',c=>o+=c); res.on('end',()=>{ try{resolve(JSON.parse(o))}catch(e){resolve(null)} }); });
      req.on('error', e => resolve({ ok: false, description: e.message }));
      req.write(data);
      req.end();
    } catch (e) {
      /* لا نترك الخطأ يوقف السيرفر — نرجّع سبب مفهوم */
      resolve({ ok: false, description: 'صيغة TELEGRAM_TOKEN غلط: ' + e.message });
    }
  });
}

/* ═══ سجل الرسائل الصادرة ═══
   نعترض في نقطة واحدة بدل ما نضيف تسجيلاً عند كل موضع إرسال —
   موضع واحد منسي يعني رسالة راحت لطالب بلا أثر.
   في الذاكرة فقط: يضيع مع كل إعادة تشغيل أو نشر. */
const MSG_LOG = [];
const MSG_LOG_MAX = 300;
/* من أرقام المحادثات إلى أسماء — تُملأ كسولاً ولا تُستعلم لكل رسالة */
const CHAT_NAMES = new Map();

function logMsg(chatId, text, kind, ok, err) {
  const row = {
    at: Date.now(),
    chatId: String(chatId),
    who: CHAT_NAMES.get(String(chatId)) || null,
    admin: !!(ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID)),
    kind,
    /* نخزّن النص كما أُرسل بوسومه — اللوحة تنظّفه عند العرض */
    text: String(text || '').slice(0, 1200),
    ok: !!ok,
    err: err || null
  };
  MSG_LOG.unshift(row);
  if (MSG_LOG.length > MSG_LOG_MAX) MSG_LOG.length = MSG_LOG_MAX;
  if (EVENTS_READY) logEvent('message', row);
}

/* نستعلم مرة واحدة عن الأرقام المجهولة فقط، لا عن السجل كله كل مرة */
async function fillChatNames() {
  const need = [...new Set(MSG_LOG.map(m => m.chatId))]
    .filter(id => !CHAT_NAMES.has(id));
  if (!need.length) return;
  const safe = numList(need);            /* نفس فئة الحقن — الأرقام فقط */
  need.forEach(id => { if (!safe.includes(id)) CHAT_NAMES.set(id, null); });
  if (!safe.length) return;
  const list = inList(safe);
  const rows = await sb('GET', 'profiles', {
    query: `?telegram_chat_id=in.(${list})&select=name,email,telegram_chat_id`
  }).catch(() => []);
  (Array.isArray(rows) ? rows : []).forEach(r => {
    CHAT_NAMES.set(String(r.telegram_chat_id), r.name || r.email || null);
  });
  /* الأرقام اللي ما لها حساب نعلّمها عشان ما نعيد السؤال عنها */
  need.forEach(id => { if (!CHAT_NAMES.has(id)) CHAT_NAMES.set(id, null); });
}

/* يصنّف الرسالة من محتواها — أرخص من تمرير وسم عند كل نداء */
function msgKind(text) {
  const t = String(text || '');
  if (/فتحت مادة|نزلت شعبة|فتحت شعبة|الشعبة اللي تبيها/.test(t)) return 'شعبة فتحت';
  if (/تغيّر في جدولك/.test(t)) return 'تغيّر جدول';
  if (/سجّلت .*؟|أوقف المراقبة عشان/.test(t)) return 'متابعة';
  if (/تم الربط بنجاح/.test(t)) return 'ربط';
  if (/رد من فريق جدولك/.test(t)) return 'رد شخصي';
  if (/^🔴|^✅ <b>رجع طبيعي/.test(t)) return 'إنذار مشرف';
  if (/أمر غير معروف/.test(t)) return 'أمر غير معروف';
  if (/وقفت الإشعارات/.test(t)) return 'إيقاف';
  return 'أخرى';
}

/* ═══ تنقية قيم فلاتر PostgREST ═══
   الـCRN ورقم محادثة تيليغرام يصلان من صفوف يكتبها الطالب بنفسه عبر RLS.
   بناء `in.("a","b")` منها مباشرةً يسمح لطالب واحد بحقن `")&crn=not.is.null&x=in.("`
   فيتحوّل الفلتر ليطابق جداول كل الطلاب — والاستعلام يعمل بمفتاح الخدمة
   الذي يتجاوز RLS. نقبل الأرقام فقط، وكلاهما رقمي أصلاً. */
function numList(values, maxLen) {
  const out = [];
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (/^\d{1,20}$/.test(s) && (!maxLen || s.length <= maxLen)) out.push(s);
  }
  return [...new Set(out)];
}

/* نستخدم المصفوفة كما هي في in.(...) — الأرقام ما تحتاج تنصيص */
const inList = arr => arr.join(',');

/* معرّفات Supabase كلها UUID — أي شيء غيره ما له أن يصل الاستعلام */
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  .test(String(v == null ? '' : v).trim());

/* ═══ استمرارية السجلات ═══
   كل ما في الذاكرة يضيع مع كل نشر — وأنت تنشر عدة مرات يومياً في الموسم.
   فنكتب كل حدث في القاعدة فور وقوعه (بلا await: التسجيل ما يؤخّر شيئاً)،
   ونستعيد الأحدث عند الإقلاع.
   ما نحفظ الكاش عمداً: صلاحيته دقيقة داخل الذروة، ويُبنى بسحبة واحدة. */
const EVENT_KEEP = { message: 300, correction: 60, flap: 60, unwatch: 200, notify: 60 };
const EVENT_MAX_AGE_DAYS = 30;
let EVENTS_READY = false;          /* قبل الاستعادة ما نكتب، لئلا نضاعف */

function logEvent(kind, payload) {
  sb('POST', 'app_events', {
    body: { kind, at: new Date(payload.at || Date.now()).toISOString(), payload },
    prefer: 'return=minimal'
  }).catch(e => console.log('logEvent ' + kind + ': ' + (e && e.message)));
}

async function restoreEvents() {
  for (const [kind, limit] of Object.entries(EVENT_KEEP)) {
    const rows = await sb('GET', 'app_events', {
      query: `?kind=eq.${kind}&select=payload&order=at.desc&limit=${limit}`
    }).catch(() => []);
    const list = (Array.isArray(rows) ? rows : []).map(r => r.payload);
    const target = kind === 'message' ? MSG_LOG
                 : kind === 'correction' ? SCHED_LOG
                 : kind === 'unwatch' ? UNWATCH_LOG : FLAP_LOG;
    target.length = 0;
    list.forEach(p => target.push(p));
  }
  console.log(`استعادة: ${MSG_LOG.length} رسالة · ${SCHED_LOG.length} تصحيح · ` +
              `${FLAP_LOG.length} رفّة`);
}

/* عدّادات وذروة التغذية — الذروة أهمها:
   بدونها يبدأ قاطع الدائرة أعمى بعد كل نشر ولا يحميه إلا الحد المطلق. */
async function saveState() {
  const body = {
    key: 'runtime',
    value: {
      feedPeak: [...FEED_PEAK.entries()],
      totalUpdated: SCHED_SYNC.totalUpdated,
      runs: SCHED_SYNC.runs,
      confirmForces: CONFIRM_STAT.forces,
      confirmPurged: CONFIRM_STAT.purged,
      /* مفاتيح اللوحة: بدونها يرجع كل شي للوضع التلقائي بعد كل نشر،
         فيشتغل التسخين وأنت مطفّيه أو ترجع المراقبة وأنت موقّفها. */
      toggles: { ttlOverride: TTL_OVERRIDE, monitorPaused: MONITOR_PAUSED,
                 prewarmOn: PREWARM_ON, finalsOn: FINALS_ON },
      ops: { searches: OPS.searches, feedback: OPS.feedback,
             pmuFails: OPS.pmuFails, tgFails: OPS.tgFails,
             searchesCached: OPS.searchesCached, searchStale: OPS.searchStale,
             cacheFromMonitor: OPS.cacheFromMonitor }
    },
    updated_at: new Date().toISOString()
  };
  await sb('POST', 'app_state', {
    body, prefer: 'resolution=merge-duplicates,return=minimal'
  }).catch(e => console.log('saveState: ' + (e && e.message)));
}

async function restoreState() {
  const rows = await sb('GET', 'app_state', {
    query: '?key=eq.runtime&select=value&limit=1'
  }).catch(() => []);
  const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
  if (!v) { console.log('استعادة الحالة: ما فيه نسخة محفوظة بعد'); return; }
  (v.feedPeak || []).forEach(([t, n]) => FEED_PEAK.set(t, n));
  SCHED_SYNC.totalUpdated = v.totalUpdated || 0;
  SCHED_SYNC.runs = v.runs || 0;
  CONFIRM_STAT.forces = v.confirmForces || 0;
  CONFIRM_STAT.purged = v.confirmPurged || 0;
  Object.assign(OPS, v.ops || {});

  const g = v.toggles || {};
  if ('ttlOverride' in g) TTL_OVERRIDE = g.ttlOverride || null;
  if ('monitorPaused' in g) MONITOR_PAUSED = !!g.monitorPaused;
  if ('prewarmOn' in g) PREWARM_ON = !!g.prewarmOn;
  /* FINALS_ENABLED=off في Render مفتاح قتل على مستوى النشر — يغلب المحفوظ.
     غير ذلك، ما ضبطته من اللوحة هو الأصح. */
  if ('finalsOn' in g && (process.env.FINALS_ENABLED || '').trim() !== 'off')
    FINALS_ON = !!g.finalsOn;

  console.log('استعادة الحالة: ذروة التغذية ' +
    ([...FEED_PEAK.values()][0] || '—') + ' · تصحيحات ' + SCHED_SYNC.totalUpdated);
  console.log('استعادة المفاتيح: المراقبة ' + (MONITOR_PAUSED ? 'موقوفة' : 'شغالة') +
    ' · التسخين ' + (PREWARM_ON ? 'مفعّل' : 'مطفأ') +
    ' · الصلاحية ' + (TTL_OVERRIDE ? TTL_OVERRIDE + ' د يدوي' : 'تلقائية') +
    ' · النهائيات ' + (FINALS_ON ? 'معروضة' : 'موقوفة'));
}

const sendMsg = async (chatId, text, markup) => {
  const r = await tg('sendMessage', Object.assign(
    { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
    markup ? { reply_markup: markup } : {}));
  try {
    logMsg(chatId, text, msgKind(text), r && r.ok,
           r && !r.ok ? (r.description || 'فشل') : null);
    /* الحظر رفض صريح للرسائل — نعامله معاملة /stop بدل ما نظل
       نحاول عند كل إشعار ونستهلك محاولة تفشل دائماً. */
    if (r && !r.ok && /blocked by the user|user is deactivated|chat not found/i
        .test(String(r.description || ''))) {
      unlinkBlocked(chatId, r.description);
    }
  } catch (e) { /* التسجيل ما يعطّل الإرسال أبداً */ }
  return r;
};

/* بلا await: فكّ الربط تنظيف لا يؤخّر شيئاً، والـcatch إجباري */
function unlinkBlocked(chatId, why) {
  sb('PATCH', 'profiles', {
    query: `?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}`,
    body: { telegram_chat_id: null, telegram_username: null },
    prefer: 'return=minimal'
  }).then(() => console.log(`فُكّ ربط ${chatId} — ${why}`))
    .catch(e => console.log('فكّ الربط فشل: ' + (e && e.message)));
}

/* أزرار داخلية أسفل الرسالة */
const btn = (label, data) => ({ text: label, callback_data: data });
const kb  = rows => ({ inline_keyboard: rows });

/* ============ PMU fetch ============ */
function fetchPMUData(termList, collegeList, genderList) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'masterschedule.pmu.edu.sa', path: '/', method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, res => {
      let data = '';
      const cookieStr = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(/__RequestVerificationToken[^>]+value="([^"]+)"/);
        if (!m) return reject(new Error('Token not found'));
        const postData = new URLSearchParams({
          TermList: termList, CollegeList: collegeList, GenderList: genderList,
          DataTables_Table_1_length: '10000',
          __RequestVerificationToken: m[1], 'X-Requested-With': 'XMLHttpRequest'
        }).toString();

        const p = https.request({
          hostname: 'masterschedule.pmu.edu.sa', path: '/Home/getData', method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Content-Length': Buffer.byteLength(postData),
            'Cookie': cookieStr, 'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://masterschedule.pmu.edu.sa/',
            'Origin': 'https://masterschedule.pmu.edu.sa'
          }
        }, pr => { let h=''; pr.on('data',c=>h+=c); pr.on('end',()=>resolve(h)); });
        p.on('error', reject);
        p.setTimeout(20000, () => { p.destroy(); reject(new Error('PMU data timeout')); });
        p.write(postData); p.end();
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('PMU token timeout')); });
    req.end();
  });
}

function parseHTML(html) {
  const rows = [];
  for (const tr of (html.match(/<tr>[\s\S]*?<\/tr>/g) || [])) {
    const tds = tr.match(/<td>([\s\S]*?)<\/td>/g) || [];
    if (tds.length < 9) continue;
    const t = td => td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    rows.push({
      crn: t(tds[0]), courseCode: t(tds[1]), courseTitle: t(tds[2]),
      section: t(tds[3]), courseDate: t(tds[4]), courseTiming: t(tds[5]),
      instructor: t(tds[6]), room: t(tds[7]), status: t(tds[8]).toUpperCase()
    });
  }
  return rows;
}

/* ============ الفحص الجماعي ============ */
/* سحبة واحدة من الجامعة لكل ترم مطلوب، ثم توزيع على كل الطلاب */
/* ينفّذ مهام على دفعات متوازية بدل واحدة واحدة */
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(x => fn(x).catch(e => {
      console.log('batch item failed:', e.message);
    })));
  }
}

let cycleRunning = false;

/* سجل تشغيلي — يُقرأ من لوحة التحكم. في الذاكرة فقط، يُصفّر عند إعادة النشر. */
const OPS = {
  bootedAt: Date.now(),
  cycles: [],          // آخر 40 دورة
  skipped: 0,          // دورات تخطّت لأن السابقة ما خلصت
  pmuFails: 0,         // فشل سحب من الجامعة
  tgFails: 0,          // رسائل تيليغرام فشلت
  searches: 0,         // عمليات بحث
  feedback: 0,         // ملاحظات وصلت
  searchesCached: 0,   // منها المخدومة من الكاش
  searchStale: 0,      // مخدومة من نسخة قديمة (الجامعة واقعة)
  cacheFromMonitor: 0, // نسخ عبّأتها دورة المراقبة مجاناً للبحث
  lastError: null
};
/* ═══ إنذارات تيليغرام ═══
   نرسل الإنذار مرة وحدة، وما نكرره إلا بعد ساعة أو بعد ما يُحل ويرجع. */
const ALERTS = {};
const ALERT_COOLDOWN = 60 * 60 * 1000;

async function alert(key, title, detail) {
  if (!ADMIN_CHAT_ID) return;
  const now = Date.now(), prev = ALERTS[key];
  if (prev && prev.active && now - prev.at < ALERT_COOLDOWN) return;
  ALERTS[key] = { active: true, at: now, title };
  await sendMsg(ADMIN_CHAT_ID,
    `🔴 <b>${title}</b>\n\n${detail}\n\n` +
    `🕐 ${new Date(now + 3*3600e3).toISOString().slice(11,16)} بتوقيت الرياض\n` +
    `📊 jadwalik.com/admin`).catch(() => {});
  /* نسخة على Pushover — أولوية عادية وصوت هادئ، مو زي إشعار الشعب */
  pushover('🔴 ' + title, detail, { priority: 0, sound: 'pushover' }).catch(() => {});
}

async function resolve(key, title) {
  if (!ADMIN_CHAT_ID) return;
  const prev = ALERTS[key];
  if (!prev || !prev.active) return;
  ALERTS[key] = { active: false, at: Date.now(), title };
  const mins = Math.round((Date.now() - prev.at) / 60000);
  await sendMsg(ADMIN_CHAT_ID,
    `✅ <b>رجع طبيعي: ${title}</b>\n\nكانت المشكلة قائمة ${mins} دقيقة.`).catch(() => {});
}

function logCycle(c) {
  OPS.cycles.push(c);
  if (OPS.cycles.length > 40) OPS.cycles.shift();
}

const FOLLOWUP_AFTER = 10 * 60 * 1000;   /* نسأل الطالب بعد عشر دقائق */

/* ═══ سؤال المتابعة: «سجّلتها؟» ═══
   يشتغل مع كل دورة مراقبة. الموعد مخزّن في القاعدة، فإعادة نشر
   السيرفر ما تضيّع السؤال — يُرسل في الدورة التالية لموعده. */
async function sendFollowups() {
  if (!SB_URL || !SB_SERVICE_KEY) return 0;
  const nowIso = new Date().toISOString();
  const due = await sb('GET', 'monitored_courses', {
    query: `?followup_done=eq.false&followup_at=not.is.null` +
           `&followup_at=lte.${encodeURIComponent(nowIso)}&select=*&limit=50`
  }).catch(() => null);
  if (!Array.isArray(due) || !due.length) return 0;

  const ids = [...new Set(due.map(m => m.user_id))].map(u => `"${u}"`).join(',');
  const profs = await sb('GET', 'profiles', {
    query: `?id=in.(${ids})&select=id,telegram_chat_id`
  }).catch(() => []);
  const byUser = {};
  (Array.isArray(profs) ? profs : []).forEach(p => { byUser[p.id] = p });

  let sent = 0;
  for (const m of due) {
    const p = byUser[m.user_id];
    const label = m.scope === 'course'
      ? (m.course_code || 'المادة')
      : `${m.course_code || 'المادة'}${m.crn ? ' · CRN ' + m.crn : ''}`;
    if (p && p.telegram_chat_id) {
      const r = await sendMsg(p.telegram_chat_id,
        `⏳ <b>سجّلت ${label}؟</b>\n\n` +
        `لو سجّلتها، أوقف المراقبة عشان ما توصلك إشعارات ما تحتاجها.`,
        kb([[btn('✅ سجّلتها — أوقف المراقبة', 'stop:' + m.id)],
            [btn('⏳ لا، كمّل المراقبة', 'keep:' + m.id)]]));
      if (r && r.ok) sent++; else OPS.tgFails++;
      await new Promise(r2 => setTimeout(r2, 400));
    }
    /* نعلّمها منتهية حتى لو فشل الإرسال — ما نكرر السؤال أبداً */
    await sb('PATCH', 'monitored_courses', {
      query: `?id=eq.${m.id}`,
      body: { followup_done: true, followup_at: null },
      prefer: 'return=minimal'
    }).catch(() => {});
  }
  return sent;
}

/* حذف صفوف انتهت مهلة تأكيدها ولا أحد أكّدها */
async function dropExpired() {
  if (!SB_URL || !SB_SERVICE_KEY) return 0;
  const nowIso = new Date().toISOString();
  const due = await sb('GET', 'monitored_courses', {
    query: `?expires_at=not.is.null&expires_at=lte.${encodeURIComponent(nowIso)}&select=*&limit=200`
  }).catch(() => null);
  if (!Array.isArray(due) || !due.length) return 0;
  const ids = due.map(r => r.id);
  logUnwatch(due, 'expired');
  await sb('DELETE', 'monitored_courses',
    { query: `?id=in.(${ids.join(',')})`, prefer: 'return=minimal' }).catch(() => {});
  console.log(`expired: أوقفنا ${ids.length} مراقبة بلا تأكيد`);
  return ids.length;
}

async function runMonitorCycle() {
  if (!SB_URL || !SB_SERVICE_KEY) return;

  /* قفل: لو الدورة السابقة ما خلصت، ما نبدأ وحدة جديدة فوقها.
     بدونه الدورات تتراكم في الذروة وتاكل الذاكرة. */
  if (cycleRunning) {
    OPS.skipped++;
    console.log('cycle still running — skipped');
    if (OPS.skipped === 3)
      alert('skip', 'دورات المراقبة تتراكم',
        `تخطّت ${OPS.skipped} دورات لأن السابقة ما خلصت في وقتها.\n` +
        `الإشعارات بتتأخر على الطلاب.`);
    return;
  }
  cycleRunning = true;
  const t0 = Date.now();
  const stat = { at: t0, rows: 0, changed: 0, toNotify: 0, eligible: 0,
                 notified: 0, terms: 0, snapshot: 0, sec: 0, error: null };

  try {
    /* أسئلة المتابعة المستحقة — مستقلة عن وجود صفوف مراقبة متغيّرة */
    stat.followups = await sendFollowups().catch(() => 0);
    stat.expired = await dropExpired().catch(() => 0);

    const monitors = await sb('GET', 'monitored_courses', { query: '?select=*' });
    if (!Array.isArray(monitors) || !monitors.length) return;

    /* ── 1. سحبة واحدة لكل ترم ── */
    const terms = [...new Set(monitors.map(m => m.term || '202630'))];
    const snapshot = {};
    for (const term of terms) {
      try {
        const html = await fetchPMUData(term, 'ALL', 'ALL');
        /* نوسم الجنس هنا أيضاً — الكاش يخدم البحث مباشرة */
        const parsed = tagGender(parseHTML(html), 'ALL');
        /* parseHTML ما تضع الترم في المادة، و byCourse يبني مفتاحه من
           c.term — فكان يطلع '|PHYS 1422' بدل '202710|PHYS 1422' ولا
           يتطابق أبداً، فتتعطّل مراقبة المادة كاملة بصمت. نوسمه هنا. */
        parsed.forEach(c => { c.term = term; snapshot[term + ':' + c.crn] = c; });

        /* نفس البيانات اللي سحبناها للمراقبة هي اللي يحتاجها البحث،
           فنغذّي بها كاش البحث بدل ما نسحبها مرة ثانية.
           يقلّل الطلبات على موقع الجامعة، ويخلي الطالب يلقى النتيجة جاهزة. */
        const ck = `${term}|ALL|ALL`;
        const prev = coursesCache.get(ck);
        coursesCache.set(ck, {
          at: Date.now(),
          lastHit: (prev && prev.lastHit) || 0,   /* ما نوهم التسخين إنها مطلوبة */
          courses: parsed
        });
        while (coursesCache.size > 40)
          coursesCache.delete(coursesCache.keys().next().value);
        OPS.cacheFromMonitor = (OPS.cacheFromMonitor || 0) + 1;

        /* المزامنة كانت مربوطة بسحبة getCourses. وبما إن المراقبة صارت
           تعبّي الكاش، ما عادت تنطلق من هناك — فنطلقها من هنا.
           الحارس الزمني داخل syncSchedules يمنع الكتابة المتكررة. */
        syncSchedules(term, parsed).catch(() => {});
      } catch (e) {
        OPS.pmuFails++;
        console.log('fetch fail', term, e.message);
        alert('pmu', 'موقع الجامعة ما يستجيب',
          `فشل سحب بيانات الترم ${term}.\nالسبب: ${e.message}\n\n` +
          `المراقبة والبحث بيتأثرون. لو تكرر كثير، تحقق إذا السيرفر محجوب.`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    const now = new Date().toISOString();

    /* ── 2. نحدد الصفوف اللي تغيّرت حالتها ── */
    stat.rows = monitors.length;
    stat.terms = terms.length;
    stat.snapshot = Object.keys(snapshot).length;
    if (stat.snapshot > 0) resolve('pmu', 'موقع الجامعة ما يستجيب');

    /* فهرس المواد: ترم|كود → كل شعبها. نحتاجه لمراقبة المادة كاملة. */
    const normCode = s => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const byCourse = {};
    Object.values(snapshot).forEach(c => {
      const k = (c.term || '') + '|' + normCode(c.courseCode);
      (byCourse[k] = byCourse[k] || []).push(c);
    });

    const sectionMons = monitors.filter(m => m.scope !== 'course');
    const courseMons  = monitors.filter(m => m.scope === 'course');
    stat.courseRows = courseMons.length;

    const changed = [];      // {m, live}
    const toNotify = [];     // {m, live}
    /* ═══ تصحيح الأساس عند التفعيل ═══
       last_status يجي من القائمة المعروضة عند الطالب، وقد تكون قديمة
       بدقائق. فتنشأ حالتان خاطئتان:
       • عنده CLOSED وعندنا OPEN → إشعار فوري عن شعبة كانت مفتوحة أصلاً.
       • عنده OPEN وعندنا CLOSED → يُسجَّل OPEN، فحين تفتح فعلاً ما يُرسل
         شيء — يفوته الإشعار الذي فعّل المراقبة لأجله.
       فأول دورة بعد التفعيل نصحّح الحالة بلا إشعار. النافذة قصيرة
       (دقيقتان) فلا تبتلع فتحة حقيقية وقعت بعد التفعيل بوقت. */
    const BASELINE_GRACE = 2 * 60 * 1000;
    for (const m of sectionMons) {
      const live = snapshot[(m.term || '202630') + ':' + m.crn];
      if (!live) continue;
      if (live.status === m.last_status) continue;

      const age = m.created_at ? (Date.now() - new Date(m.created_at).getTime()) : Infinity;
      if (age < BASELINE_GRACE) {
        changed.push({ m, live });          /* نكتب الحالة الصحيحة */
        stat.baselineFixed = (stat.baselineFixed || 0) + 1;
        continue;                            /* بلا إشعار */
      }
      changed.push({ m, live });
      if (live.status === 'OPEN' && m.last_status !== 'OPEN') toNotify.push({ m, live });
    }

    /* ── 2ب. مراقبة المادة كاملة ──
       نخزّن حالة كل شعبها في sections_state، ونقارن بها كل دورة:
       • شعبة فتحت بعد ما كانت مغلقة  → إشعار
       • شعبة جديدة ما كانت موجودة    → إشعار «نزلت شعبة»
       أول دورة لأي صف جديد نسجّل الحالة فقط بلا إشعار، عشان ما ننهال
       على الطالب بكل الشعب المفتوحة أصلاً وقت ما فعّل المراقبة. */
    const courseStateUpdates = [];   // {id, state}
    for (const m of courseMons) {
      const term = m.term || '202630';
      const list = byCourse[term + '|' + normCode(m.course_code)] || [];
      if (!list.length) continue;

      const cur = {};
      list.forEach(c => { cur[String(c.crn)] = c.status; });
      const prev = (m.sections_state && typeof m.sections_state === 'object')
        ? m.sections_state : null;

      /* كانت تُكتب كل دورة حتى بلا تغيير — كتابة لكل مادة مراقَبة كل
         خمس دقائق بلا داعٍ، وهي مصدر رئيسي لتضخّم WAL في القاعدة.
         المقارنة ببصمة مرتّبة لا بـJSON خام: ترتيب شعب الجامعة قد
         يتغيّر بين الدورات فتبدو الحالة مختلفة وهي نفسها. */
      const fp = o => Object.keys(o || {}).sort()
        .map(k => k + ':' + o[k]).join('|');
      if (!prev || fp(prev) !== fp(cur))
        courseStateUpdates.push({ id: m.id, state: cur });
      if (!prev) continue;                       /* أول دورة — تسجيل فقط */

      const hits = [];
      for (const c of list) {
        const crn = String(c.crn);
        const was = prev[crn];
        const isNew = !(crn in prev);
        if (c.status === 'OPEN' && was !== 'OPEN') hits.push({ c, isNew });
        else if (isNew) hits.push({ c, isNew, closedNew: true });
      }
      /* سقف ثلاث شعب في الدورة الواحدة — الباقي يُذكر بالعدد */
      hits.slice(0, 3).forEach(h => toNotify.push({
        m, live: h.c, courseScope: true, isNew: h.isNew, closedNew: h.closedNew,
        more: hits.length > 3 ? hits.length - 3 : 0
      }));
    }

    /* حفظ حالة صفوف المادة — كل صف بحالته */
    for (const u of courseStateUpdates) {
      await sb('PATCH', 'monitored_courses', {
        query: `?id=eq.${u.id}`,
        body: { sections_state: u.state },
        prefer: 'return=minimal'
      }).catch(() => {});
    }

    stat.changed = changed.length;
    stat.toNotify = toNotify.length;
    if (!changed.length && !toNotify.length) return;

    /* ── 3. تحديث الحالة بالجملة ──
       بدل PATCH لكل صف، نجمع الصفوف حسب الحالة الجديدة ونرسل طلباً واحداً
       لكل حالة باستخدام id=in.(...). 2000 طلب تصير 2-3 طلبات. */
    const byStatus = {};
    changed.forEach(({ m, live }) => {
      (byStatus[live.status] = byStatus[live.status] || []).push(m.id);
    });

    for (const status of Object.keys(byStatus)) {
      const ids = byStatus[status];
      /* نقسّمها لدفعات عشان الرابط ما يطول أكثر من اللازم */
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        await sb('PATCH', 'monitored_courses', {
          query: `?id=in.(${chunk.join(',')})`,
          body: { last_status: status },
          prefer: 'return=minimal'
        });
      }
    }

    if (!toNotify.length) return;

    /* ── 4. سحب ملفات المستخدمين المعنيين دفعة واحدة ── */
    const userIds = [...new Set(toNotify.map(x => x.m.user_id))];
    const profiles = {};
    for (let i = 0; i < userIds.length; i += 100) {
      const chunk = userIds.slice(i, i + 100).map(u => `"${u}"`).join(',');
      const rows = await sb('GET', 'profiles', {
        query: `?id=in.(${chunk})&select=id,telegram_chat_id,is_pro,subscription_expires_at`
      });
      (Array.isArray(rows) ? rows : []).forEach(p => { profiles[p.id] = p; });
    }

    /* ── 5. من يستحق الإشعار فعلاً ── */
    const nowMs = Date.now();
    const sendList = toNotify.filter(({ m }) => {
      const p = profiles[m.user_id];
      if (!p || !p.telegram_chat_id) return false;
      if (FREE_BETA) return true;          /* الفترة التجريبية: للجميع */
      return p.is_pro ||
        (p.subscription_expires_at && new Date(p.subscription_expires_at).getTime() > nowMs);
    });

    /* ── 6. إرسال على دفعات متوازية ──
       تيليغرام يسمح بحوالي 30 رسالة/ثانية، فدفعات من 20 مع فاصل بسيط آمنة. */
    stat.eligible = sendList.length;
    const notified = [];
    const followups = [];      /* نسأل صاحبها بعد عشر دقائق: سجّلتها؟ */
    await inBatches(sendList, 20, async ({ m, live, courseScope, isNew, closedNew, more }) => {
      const p = profiles[m.user_id];
      /* أربع حالات، والعنوان هو الوحيد الظاهر في إشعار القفل —
         فالتمييز لازم يكون فيه لا في سطر داخلي.
         الطالب قد يراقب المادة كاملة وشعبة بعينها منها، فيستلم
         رسالتين عن نفس الحدث: وحدة تقول «شعبتك» ووحدة «شعبة في مادتك».
         التكرار مقصود — النيّتان مختلفتان — لكن لازم يُفهم. */
      const head = closedNew ? '🆕 <b>نزلت شعبة جديدة</b>'
                 : isNew     ? '🆕 <b>نزلت شعبة جديدة ومفتوحة!</b>'
                 : courseScope ? '🟢 <b>فتحت شعبة في مادة تراقبها</b>'
                 :               '⭐️ <b>الشعبة اللي تبيها فتحت!</b>';
      const tail = closedNew ? '📌 مقفلة حالياً — بنراقبها لك.'
                             : '⚡️ سجّل الحين قبل ما تنسكر!';
      const scopeLine = courseScope
        ? `\n<i>وصلتك لأنك تراقب ${live.courseCode} كاملة</i>`
        : `\n<i>وصلتك لأنك مراقب هذي الشعبة بالذات</i>`;
      const moreLine = more ? `\n<i>+ ${more} شعبة ثانية تغيّرت</i>` : '';
      const r = await sendMsg(p.telegram_chat_id,
        `${head}\n\n` +
        `<b>${live.courseCode}</b> — شعبة ${live.section}\n` +
        `${live.courseTitle}\n\n` +
        `🔢 CRN: <code>${live.crn}</code>\n` +
        `📅 ${live.courseDate}  ⏰ ${live.courseTiming}\n` +
        `👤 ${live.instructor || '—'}\n` +
        `🏛️ ${live.room || '—'}${scopeLine}${moreLine}\n\n` +
        tail,
        /* زر يوقف المراقبة من داخل تيليغرام — الطالب يسجّل وينسى
           يرجع للموقع، فيظل يستقبل إشعارات ما عاد يحتاجها. */
        kb([[btn(courseScope ? '🔕 أوقف مراقبة هذي المادة'
                             : '🔕 أوقف مراقبة هذي الشعبة', 'stop:' + m.id)]]));
      if (r && r.ok) { notified.push(m.id); followups.push(m.id); }
      else OPS.tgFails++;

      /* لو المستلم أنت، نرسل نسخة على Pushover كمان — إشعار أقوى
         ما يفوتك. الطلاب ما يتأثرون: الشرط عليك وحدك. */
      if (PUSHOVER_ON && ADMIN_CHAT_ID &&
          String(p.telegram_chat_id) === String(ADMIN_CHAT_ID)) {
        pushover(`${closedNew || isNew ? '🆕' : '🟢'} ${live.courseCode} §${live.section}`,
          `${live.courseTitle}\nCRN ${live.crn}\n` +
          `${live.courseDate} · ${live.courseTiming}\n` +
          `${live.instructor || '—'} · ${live.room || '—'}`,
          /* الشعبة المغلقة الجديدة خبر لا طارئ */
          closedNew ? { priority: 0, sound: 'pushover' }
                    : { priority: 2, sound: 'siren', retry: 30, expire: 1800 }).catch(() => {});
      }
      await new Promise(r2 => setTimeout(r2, 700));   // تهدئة بين الدفعات
    });

    /* ── 7. تعليم المُشعَرين بالجملة ── */
    for (let i = 0; i < notified.length; i += 200) {
      const chunk = notified.slice(i, i + 200);
      await sb('PATCH', 'monitored_courses', {
        query: `?id=in.(${chunk.join(',')})`,
        body: { notified_at: now },
        prefer: 'return=minimal'
      });
    }

    /* ── 7ب. جدولة سؤال المتابعة في القاعدة ──
       بالقاعدة لا بمؤقت في الذاكرة، عشان إعادة نشر السيرفر ما تضيّعها. */
    if (followups.length) {
      const at = new Date(Date.now() + FOLLOWUP_AFTER).toISOString();
      const ids = [...new Set(followups)];
      for (let i = 0; i < ids.length; i += 200) {
        await sb('PATCH', 'monitored_courses', {
          query: `?id=in.(${ids.slice(i, i + 200).join(',')})`,
          body: { followup_at: at, followup_done: false },
          prefer: 'return=minimal'
        }).catch(() => {});
      }
    }

    stat.notified = notified.length;
    console.log(`cycle: ${monitors.length} rows | ${changed.length} changed | ` +
                `${notified.length} notified | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    stat.error = e.message;
    OPS.lastError = { at: Date.now(), where: 'monitorCycle', msg: e.message };
    console.log('monitor cycle error', e.message);
  } finally {
    stat.sec = Number(((Date.now() - t0) / 1000).toFixed(1));
    logCycle(stat);
    if (stat.sec > 240)
      alert('slow', 'دورة المراقبة بطيئة',
        `آخر دورة أخذت ${stat.sec} ثانية (الحد 300).\n` +
        `${stat.rows} صف · ${stat.notified} إشعار.`);
    else if (stat.sec < 120) resolve('slow', 'دورة المراقبة بطيئة');
    cycleRunning = false;
  }
}

/* ============ Telegram webhook ============ */
/* ═══ ضغطات الأزرار الداخلية ═══
   نتحقق أن الصف يخص صاحب المحادثة فعلاً قبل أي حذف — البيانات
   في الزر تجي من العميل ولا يُوثق بها وحدها. */
async function handleCallback(cq) {
  const data = String(cq.data || '');
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const ack = (text) => tg('answerCallbackQuery',
    { callback_query_id: cq.id, text: text || '', show_alert: false }).catch(() => {});

  const mm = data.match(/^(stop|keep):(\d+)$/);
  if (!mm || !chatId) return ack();
  const action = mm[1], rowId = mm[2];

  const profs = await sb('GET', 'profiles', {
    query: `?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}&select=id&limit=1`
  }).catch(() => []);
  const me = Array.isArray(profs) && profs[0] ? profs[0].id : null;
  if (!me) return ack('ما لقيت حسابك');

  const rows = await sb('GET', 'monitored_courses', {
    query: `?id=eq.${rowId}&select=*&limit=1`
  }).catch(() => []);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) {
    await ack('المراقبة موقوفة أصلاً');
    return editMsg(cq, '🔕 المراقبة على هذي المادة موقوفة.');
  }
  if (String(row.user_id) !== String(me)) return ack('هذا مو صفك');

  const label = (row.course_code || 'المادة') +
                (row.scope === 'course' ? '' : (row.crn ? ' · CRN ' + row.crn : ''));

  if (action === 'keep') {
    await sb('PATCH', 'monitored_courses', {
      query: `?id=eq.${rowId}`,
      body: { followup_done: true, followup_at: null, expires_at: null },
      prefer: 'return=minimal'
    }).catch(() => {});
    await ack('تمام، المراقبة مستمرة');
    return editMsg(cq, `⏳ <b>المراقبة مستمرة</b>\n\n${label} — بنبلغك أول ما تفتح.`);
  }

  logUnwatch(row, 'telegram');
  await sb('DELETE', 'monitored_courses', {
    query: `?id=eq.${rowId}`, prefer: 'return=minimal'
  }).catch(() => {});
  await ack('أوقفت المراقبة');
  return editMsg(cq, `🔕 <b>أوقفت المراقبة</b>\n\n${label}\n\n` +
    `ترجّعها أي وقت من الجرس في الموقع.`);
}

function editMsg(cq, text) {
  if (!cq.message) return Promise.resolve();
  return tg('editMessageText', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id,
    text, parse_mode: 'HTML'
  }).catch(() => {});
}

/* ═══ تحديث معرّف تيليغرام ═══
   الحقل كان يُكتب مرة واحدة عند /start ثم يتجمّد، فيصير
   قديماً لو غيّر الطالب معرّفه — والمعرّفات المهجورة تُعاد للتداول.
   نصحّحه ذاتياً كل ما راسلنا الطالب. الكتابة تحصل فقط عند الاختلاف. */
async function refreshTgUsername(chatId, from) {
  if (!chatId || !from) return;
  const fresh = from.username || null;
  const rows = await sb('GET', 'profiles', {
    query: `?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}` +
           `&select=id,telegram_username&limit=1`
  });
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return;                       /* غير مرتبط بعد — لا شيء نحدّثه */
  const stored = row.telegram_username || null;
  if (stored === fresh) return;           /* الحالة الغالبة: لا كتابة */
  await sb('PATCH', 'profiles', {
    query: `?id=eq.${row.id}`,
    body: { telegram_username: fresh }
  });
  console.log(`تيليغرام: تحديث معرّف ${chatId} — ${stored || '(فارغ)'} ← ${fresh || '(فارغ)'}`);
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  if (!msg) return;
  /* نقبل النص والصور — الصورة تجي مع caption أحياناً */
  const photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : null;
  if (!msg.text && !photo) return;
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();

  /* بلا await — ما نأخّر رد البوت على شيء تجميلي.
     الـcatch إجباري وإلا صار رفضاً غير معالج يسقط العملية. */
  refreshTgUsername(chatId, msg.from).catch(e =>
    console.log('تحديث معرّف تيليغرام فشل: ' + (e && e.message ? e.message : e)));

  /* صور من المشرف — سواء أُرسلت كألبوم أو صوراً منفصلة متتالية.
     تيليغرام ما يجمّعها إلا لو اختار خيار الألبوم، فنجمّعها نحن. */
  if (photo && String(chatId) === String(ADMIN_CHAT_ID)) {
    /* مفتاح واحد لكل الصور المتتالية، فتلتصق ببعضها */
    const gid = msg.media_group_id || ('solo-' + chatId);
    collectAlbum(gid, photo, text, async (photos, caption) => {
      const cmd = (caption || '').trim();
      try {
        if (cmd.startsWith('/broadcast')) {
          const body = cmd.slice(10).trim();
          const r = await adminBroadcast(body, photos, false);
          await sendMsg(chatId, r.ok
            ? `📢 بدأ البث لـ <b>${r.total}</b> طالب مع <b>${photos.length}</b> صور.`
            : `❌ ${r.error}`);
        } else if (cmd.startsWith('/reply')) {
          const rest = cmd.slice(6).trim(), sp = rest.search(/\s/);
          const who = sp > 0 ? rest.slice(0, sp).trim() : rest;
          let body = sp > 0 ? rest.slice(sp + 1).trim() : '';
          if (body.startsWith('!')) body = body.slice(1).trim();
          const whoN = String(who || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g,
            d => String(d.charCodeAt(0) & 0xf)).trim();
          let target = /^\d+$/.test(whoN) ? whoN : null;
          if (!target) {
            try {
              const rows = await sb('GET', 'profiles', {
                query: `?email=ilike.${encodeURIComponent(whoN)}&select=telegram_chat_id` });
              if (Array.isArray(rows) && rows[0] && rows[0].telegram_chat_id)
                target = rows[0].telegram_chat_id;
            } catch (e) { /* تجاهل */ }
          }
          if (!target) return sendMsg(chatId, '❌ ما لقيت أحداً بهذا البريد.');
          const r = await sendMedia(target, photos, body);
          await sendMsg(chatId, (r && r.ok)
            ? `✅ وصلت ${photos.length} صور.`
            : `⚠️ ما وصلت: ${(r && r.description) || 'غير معروف'}`);
        } else {
          await sendMsg(chatId,
            `📷 وصلتني <b>${photos.length}</b> ${photos.length===1?'صورة':'صور'}.\n\n` +
            `عشان ترسلها، اكتب في تعليق <b>أول صورة</b>:\n` +
            `<code>/broadcast النص</code> — للجميع\n` +
            `<code>/reply البريد !النص</code> — لطالب واحد`);
        }
      } catch (e) { await sendMsg(chatId, '⚠️ ' + e.message); }
    });
    return;
  }

  /* ═══ رد المشرف على طالب ═══
     تسحب الإشعار وترد عليه، فنستخرج معرّف الطالب من البصمة #u123 */
  const isAdmin = ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID);

  if (isAdmin && msg.reply_to_message && msg.reply_to_message.text) {
    const m = msg.reply_to_message.text.match(/#u(\d+)/);

    /* حالة الاختبار: أنت ترد على رسالة "رد من فريق جدولك" الموجّهة لك أنت.
       ما فيها بصمة، فنعاملك كطالب عادي. */
    if (!m && msg.reply_to_message.text.includes('رد من فريق جدولك')) {
      return sendMsg(chatId,
        `✅ وصلتنا رسالتك، شكراً لك 🙏\n\n` +
        `<i>(أنت المشرف — الطالب العادي يوصلك ردّه هنا مباشرة.)</i>`);
    }

    if (m) {
      const target = m[1];
      let r;
      if (photo) {
        r = await tg('sendPhoto', { chat_id: target, photo,
          caption: `💬 <b>رد من فريق جدولك</b>\n\n${text}`,
          parse_mode: 'HTML' });
      } else {
        r = await sendMsg(target,
          `💬 <b>رد من فريق جدولك</b>\n\n${text}\n\n` +
          `<i>💬 تبي ترد؟ اكتب رسالتك هنا مباشرة وبتوصلنا.</i>`);
      }
      /* نسجّل الرد في تذكرة الطالب */
      try {
        const t = await sb('GET', 'tickets', {
          query: `?chat_id=eq.${encodeURIComponent(target)}&status=eq.open&select=id&limit=1` });
        if (Array.isArray(t) && t[0]) await addTicketMessage(t[0].id, 'admin', text || '(صورة)', photo);
      } catch (e) { /* ما يهم */ }
      return sendMsg(chatId, (r && r.ok)
        ? `✅ وصلت رسالتك للطالب.`
        : `⚠️ ما وصلت: ${(r && r.description) || 'الطالب قد يكون حظر البوت'}`);
    }

    /* رد على رسالة ما فيها بصمة — نوضح بدل ما نسكت */
    return sendMsg(chatId,
      `ℹ️ هذي الرسالة ما فيها معرّف طالب، فما أعرف لمين أوصل ردك.\n\n` +
      `رد على <b>إشعار ملاحظة</b> فيه <code>#u…</code> في آخره،\n` +
      `أو استخدم:\n<code>/reply البريد النص</code>`);
  }

  /* رد الطالب على رسالة الفريق — يوصلك كملاحظة */
  if (!isAdmin && msg.reply_to_message && msg.reply_to_message.text &&
      msg.reply_to_message.text.includes('رد من فريق جدولك')) {
    if (ADMIN_CHAT_ID) {
      const who = msg.from
        ? (msg.from.first_name || '') + (msg.from.username ? ` @${msg.from.username}` : '')
        : '';
      await sendMsg(ADMIN_CHAT_ID,
        `↩️ <b>رد طالب</b>\n\n<blockquote>${text.replace(/[<>]/g,'')}</blockquote>\n` +
        `👤 ${who.replace(/[<>]/g,'') || 'غير معروف'}\n\n` +
        `<code>#u${chatId}</code>`);
    }
    return sendMsg(chatId, '✅ وصلتنا رسالتك، شكراً لك 🙏');
  }

  /* ═══ /broadcast <النص> — بث لكل من ربط تيليغرام ═══ */
  if (isAdmin && text.startsWith('/broadcast')) {
    const body = text.slice(10).trim();
    if (!body && !photo) {
      const d = await adminBroadcast('x', null, true);
      return sendMsg(chatId,
        `📢 <b>البث الجماعي</b>\n\n` +
        `المستلمون: <b>${d.total || 0}</b> طالب ربطوا تيليغرام\n\n` +
        `الصيغة:\n<code>/broadcast نص الرسالة</code>\n\n` +
        `أو أرسل صورة مع تعليق يبدأ بـ <code>/broadcast</code>`);
    }
    const r = await adminBroadcast(body, photo, false);
    return sendMsg(chatId, r.ok
      ? `📢 بدأ البث لـ <b>${r.total}</b> طالب.\nبوصلك تقرير لما يخلص.`
      : `❌ ${r.error}`);
  }

  /* ═══ /reply <إيميل أو معرّف> <النص> ═══ */
  if (isAdmin && text.startsWith('/reply')) {
    const rest = text.slice(6).trim();
    /* الفاصل أي مسافة بيضاء لا المسافة وحدها: كتابة البريد ثم Enter
       ثم النص هو الأسلوب الطبيعي في تيليغرام للرسائل الطويلة، وكان
       يجعل who = "البريد\nأول كلمة" فلا يطابق أحداً. */
    const sp = rest.search(/\s/);
    if (sp < 1) return sendMsg(chatId,
      `<b>رد على طالب:</b>\n<code>/reply البريد النص</code>\n` +
      `<i>يضيف ترويسة "رد من فريق جدولك"</i>\n\n` +
      `<b>رسالة مستقلة (تحديث/إعلان):</b>\n<code>/reply البريد !النص</code>\n` +
      `<i>علامة التعجب تشيل الترويسة</i>\n\n` +
      `مثال:\n<code>/reply s@pmu.edu.sa !🎉 تحديث جديد في جدولك</code>`);
    const who = rest.slice(0, sp).trim();
    let body = rest.slice(sp + 1).trim();

    /* "!" في أول النص = رسالة مستقلة بدون ترويسة "رد من فريق جدولك".
       نستخدمها للتحديثات والإعلانات، والترويسة تبقى للردود الفعلية. */
    let bare = false;
    if (body.startsWith('!')) { bare = true; body = body.slice(1).trim(); }

    /* لوحة الجوال تكبّر أول حرف تلقائياً، وقد تكتب الأرقام عربية.
       نطبّع الاثنين قبل البحث بدل ما نرمي رسالة "ما لقيت أحداً". */
    const arabicDigits = s => String(s || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g,
      d => String(d.charCodeAt(0) & 0xf));
    const whoNorm = arabicDigits(who).trim();

    let target = /^\d+$/.test(whoNorm) ? whoNorm : null;
    if (!target) {
      try {
        const rows = await sb('GET', 'profiles', {
          query: `?email=ilike.${encodeURIComponent(whoNorm)}&select=telegram_chat_id`
        });
        if (Array.isArray(rows) && rows[0] && rows[0].telegram_chat_id)
          target = rows[0].telegram_chat_id;
      } catch (e) { /* تجاهل */ }
    }
    if (!target) return sendMsg(chatId,
      `❌ ما لقيت أحداً بهذا البريد، أو ما ربط تيليغرام.\n\n` +
      `<i>البحث غير حساس لحالة الأحرف. جرّب رقم المحادثة بدل البريد:</i>\n` +
      `<code>/reply 123456789 !النص</code>`);

    if (photo) {
      const rp = await tg('sendPhoto', { chat_id: target, photo,
        caption: (bare ? body : `💬 <b>رد من فريق جدولك</b>\n\n${body}`).slice(0, 1000),
        parse_mode: 'HTML' });
      return sendMsg(chatId, (rp && rp.ok) ? `✅ وصلت مع الصورة.` :
        `⚠️ ما وصلت: ${(rp && rp.description) || 'تأكد أن الوسوم مغلقة صح'}`);
    }

    const r = await sendMsg(target, bare
      ? `${body}\n\n<i>💬 عندك ملاحظة؟ اكتبها هنا مباشرة.</i>`
      : `💬 <b>رد من فريق جدولك</b>\n\n${body}\n\n` +
        `<i>💬 تبي ترد؟ اكتب رسالتك هنا مباشرة وبتوصلنا.</i>`);
    return sendMsg(chatId, (r && r.ok) ? `✅ وصلت.` :
      `⚠️ ما وصلت: ${(r && r.description) || 'تأكد أن الوسوم مغلقة صح'}`);
  }

  if (text.startsWith('/start')) {
    const code = (text.split(' ')[1] || '').trim().toUpperCase();
    if (!code) {
      /* المربوط أصلاً كان يقرأ «عشان تربط حسابك...» فيظن إنه غير مربوط
         ويروح يربط مرة ثانية — وهذا مصدر أغلب الربط المكرر. */
      const me = await sb('GET', 'profiles', {
        query: `?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}` +
               `&select=name&limit=1`
      }).catch(() => []);
      if (Array.isArray(me) && me.length) {
        return sendMsg(chatId,
          `✅ <b>حسابك مربوط</b>\n\n` +
          `الإشعارات شغّالة، ما تحتاج تسوي شي.\n\n` +
          `<code>/status</code> — تشوف مواد تراقبها\n` +
          `<code>/stop</code> — توقف الإشعارات\n\n` +
          `اختر مواد للمراقبة من jadwalik.com`);
      }
      return sendMsg(chatId,
        `👋 <b>أهلاً بك في جدولك</b>\n\n` +
        `عشان تربط حسابك، افتح jadwalik.com → الإعدادات → فعّل إشعارات تيليغرام.`);
    }
    const rows = await sb('GET', 'profiles',
      { query: `?telegram_link_code=eq.${encodeURIComponent(code)}&select=id,name,telegram_chat_id` });
    if (!rows || !rows.length) {
      return sendMsg(chatId, `❌ الكود غير صحيح أو منتهي.\nجرّب تولّد كود جديد من الموقع.`);
    }

    /* ضغط الزر مرتين شائع — الواجهة كانت تتأخر في إظهار الربط.
       نقول له إنه مربوط أصلاً بدل «تم الربط» التي توحي بشيء جديد. */
    if (String(rows[0].telegram_chat_id || '') === String(chatId)) {
      return sendMsg(chatId,
        `✅ <b>حسابك مربوط أصلاً</b>\n\n` +
        `ما تحتاج تربط مرة ثانية — الإشعارات شغّالة.\n\n` +
        `اختر المواد اللي تبي تراقبها من jadwalik.com`);
    }
    /* رقم تيليغرام واحد ما يخدم حسابين: الإشعارات تُجمَّع بـuser_id
       ثم تُترجم لـchat_id، فيستلم الشخص رسالتين متطابقتين على نفس
       المحادثة — ولا يرى حسابين، بل بوتاً يكرّر نفسه. ننقل الربط
       بدل ما نرفضه: الرفض يترك الطالب حائراً بلا سبب مفهوم. */
    const moved = await sb('GET', 'profiles', {
      query: `?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}` +
             `&id=neq.${encodeURIComponent(rows[0].id)}&select=id,name,email`
    }).catch(() => []);
    if (Array.isArray(moved) && moved.length) {
      await sb('PATCH', 'profiles', {
        query: `?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}` +
               `&id=neq.${encodeURIComponent(rows[0].id)}`,
        body: { telegram_chat_id: null, telegram_username: null },
        prefer: 'return=minimal'
      }).catch(() => {});
      console.log(`ربط: نُقل ${chatId} من ${moved.length} حساب سابق`);
    }

    await sb('PATCH', 'profiles', {
      query: `?id=eq.${rows[0].id}`,
      body: { telegram_chat_id: String(chatId), telegram_username: msg.from.username || null }
    });
    return sendMsg(chatId,
      `✅ <b>تم الربط بنجاح!</b>\n\n` +
      (moved.length
        ? `⚠️ كان تيليغرامك مربوطاً بحساب ثاني (${esc(moved[0].email || moved[0].name || '—')}) ` +
          `وفصلناه — الإشعارات بتوصلك لهذا الحساب وحده.\n\n`
        : '') +
      `بتوصلك إشعارات فورية أول ما تنفتح أي مادة تراقبها.\n\n` +
      `روح للموقع واختر المواد اللي تبي تراقبها 👇\njadwalik.com\n\n` +
      `💬 <b>وأي ملاحظة أو اقتراح؟</b> اكتبها هنا مباشرة وبتوصلني.`);
  }

  /* يعطيك معرّف محادثتك عشان تحطه في ADMIN_CHAT_ID */
  if (text === '/whoami' || text === '/id') {
    return sendMsg(chatId,
      `🆔 <b>معرّف محادثتك</b>\n\n<code>${chatId}</code>\n\n` +
      `حطّه في Render باسم <code>ADMIN_CHAT_ID</code> عشان توصلك آراء الطلاب هنا فوراً.`);
  }

  if (text === '/stop') {
    const rows = await sb('GET', 'profiles',
      { query: `?telegram_chat_id=eq.${chatId}&select=id` });
    if (rows && rows.length) {
      await sb('PATCH', 'profiles', { query: `?id=eq.${rows[0].id}`, body: { telegram_chat_id: null } });
    }
    return sendMsg(chatId, `🔕 وقفت الإشعارات. تقدر ترجع تربط حسابك من الموقع أي وقت.`);
  }

  /* ═══ أي كلام حر من طالب = رسالة توصل المشرف ═══
     نخليها آخر شي بعد الأوامر، فما تتعارض معها. */
  if (!text.startsWith('/') && !(isAdmin && msg.reply_to_message)) {
    if (!ADMIN_CHAT_ID) return;

    /* حد بسيط: 6 رسائل لكل محادثة في الساعة */
    const now = Date.now(), rec = botMsgLimit.get(String(chatId));
    if (rec && now - rec.first < 3600e3 && rec.count >= 6) {
      return sendMsg(chatId, '⏳ وصلتنا رسائلك، نقرأها ونرد عليك قريب.');
    }
    if (!rec || now - rec.first >= 3600e3) botMsgLimit.set(String(chatId), { first: now, count: 1 });
    else rec.count++;
    if (botMsgLimit.size > 3000) botMsgLimit.clear();

    /* نجيب اسمه من حسابه لو مربوط */
    let who = '', profName = null, profEmail = null, profMajor = null;
    try {
      const rows = await sb('GET', 'profiles',
        { query: `?telegram_chat_id=eq.${encodeURIComponent(chatId)}&select=name,email,major` });
      const p = Array.isArray(rows) && rows[0];
      if (p) {
        profName = p.name || null; profEmail = p.email || null; profMajor = p.major || null;
        who = `${p.name || ''}${p.email ? ` · ${p.email}` : ''}${p.major ? ` · ${p.major}` : ''}`;
      }
    } catch (e) { /* ما يهم */ }
    if (!who && msg.from)
      who = (msg.from.first_name || '') + (msg.from.username ? ` @${msg.from.username}` : '');

    OPS.feedback++;

    /* كل رسالة تلتصق بتذكرة الطالب المفتوحة، أو تفتح وحدة جديدة */
    const tk = await getOrCreateTicket({
      chatId, name: profName || who, email: profEmail, major: profMajor,
      telegram: msg.from && msg.from.username ? msg.from.username : null,
      text, category: 'other'
    });
    if (tk) await addTicketMessage(tk.id, 'student', text || '(صورة)', photo);
    else {
      FEEDBACK_MEM.unshift({ at: now, text, category: 'other', email: profEmail,
        name: who || null, major: profMajor, lang: 'ar',
        telegram: msg.from && msg.from.username ? msg.from.username : null,
        chatId: String(chatId) });
      if (FEEDBACK_MEM.length > 200) FEEDBACK_MEM.pop();
    }

    const tag = tk ? `🎫 تذكرة <b>#${tk.id}</b>\n` : '';
    if (photo) {
      await tg('sendPhoto', { chat_id: ADMIN_CHAT_ID, photo,
        caption: `${tag}💬 <b>صورة من طالب</b>\n${text ? '\n' + text.replace(/[<>]/g,'') + '\n' : ''}` +
                 `👤 ${(who || 'غير معروف').replace(/[<>]/g,'')}\n\n#u${chatId}`,
        parse_mode: 'HTML' });
    } else {
      await sendMsg(ADMIN_CHAT_ID,
        `${tag}💬 <b>رسالة من طالب</b>\n\n<blockquote>${text.replace(/[<>]/g, '')}</blockquote>\n` +
        `👤 ${(who || 'غير معروف').replace(/[<>]/g, '')}\n\n` +
        `<i>↩️ رد على هذي الرسالة عشان يوصله ردك</i>\n` +
        `<code>#u${chatId}</code>`);
    }

    return sendMsg(chatId,
      (tk ? `✅ وصلتنا رسالتك — رقم تذكرتك <b>#${tk.id}</b>\n\n`
          : '✅ وصلتنا رسالتك\n\n') +
      'نقرأ كل رسالة ونرد عليك هنا 🙏');
  }

  if (text === '/status') {
    const rows = await sb('GET', 'profiles',
      { query: `?telegram_chat_id=eq.${chatId}&select=id,is_pro,subscription_expires_at` });
    if (!rows || !rows.length) return sendMsg(chatId, `ما لقيت حسابك مربوط. افتح jadwalik.com للربط.`);
    const p = rows[0];
    const mons = await sb('GET', 'monitored_courses',
      { query: `?user_id=eq.${p.id}&select=course_code,section,scope,sections_state` });
    const active = p.is_pro ||
      (p.subscription_expires_at && new Date(p.subscription_expires_at) > new Date());
    /* مراقبة المادة كاملة تترك section فاضياً، فكانت تطبع «§null».
       اللوحة تعالجها صح — هذي وحدها كانت ناقصة. */
    const line = m => {
      const code = m.course_code || '?';
      if (m.scope === 'course') {
        const n = m.sections_state && typeof m.sections_state === 'object'
          ? Object.keys(m.sections_state).length : 0;
        return `• ${code} — كل الشعب${n ? ` (${n})` : ''}`;
      }
      return `• ${code} §${m.section || '?'}`;
    };
    return sendMsg(chatId,
      `📊 <b>حالتك</b>\n\n` +
      `الاشتراك: ${active ? '✅ فعّال' : '❌ غير فعّال'}\n` +
      `المواد المراقبة: ${mons.length}\n` +
      (mons.length ? '\n' + mons.map(line).join('\n') : ''));
  }

  /* ═══ أمر غير معروف ═══
     السكوت هنا كلّفنا تشخيصاً خاطئاً من قبل — نرد بوضوح.
     نشرط على '/' فقط، فالكلام الحر تكفّل به الفرع أعلاه،
     ورد المشرف على صورة (بلا نص) ما يتأثر. */
  if (text.startsWith('/')) {
    return sendMsg(chatId,
      `❓ <b>أمر غير معروف</b>\n\n` +
      `الأوامر المتاحة:\n` +
      `<code>/start</code> — ربط حسابك\n` +
      `<code>/status</code> — حالتك ومراقباتك\n` +
      `<code>/stop</code> — إيقاف الإشعارات\n\n` +
      `💬 وأي ملاحظة؟ اكتبها هنا مباشرة بدون أمر.`);
  }
}

/* ================================================================
   ============          لوحة التحكم (Admin)          ============
   ================================================================ */

/* --- مقارنة آمنة ضد هجمات التوقيت --- */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);   // نستهلك نفس الوقت حتى لو الطول مختلف
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/* --- تحديد المحاولات: 8 محاولات فاشلة لكل IP خلال 15 دقيقة --- */
const loginTries = new Map();
const fbLimit = new Map();
const botMsgLimit = new Map();

/* ═══ تجميع الألبومات ═══
   تيليغرام يرسل كل صورة من الألبوم كتحديث منفصل بنفس media_group_id.
   نجمّعها 1.5 ثانية ثم ننفّذ الأمر مرة وحدة بكل الصور. */
const albums = new Map();

function collectAlbum(gid, photo, caption, run) {
  let a = albums.get(gid);
  if (!a) {
    a = { photos: [], caption: '', timer: null };
    albums.set(gid, a);
  }
  if (photo) a.photos.push(photo);
  if (caption && !a.caption) a.caption = caption;

  clearTimeout(a.timer);
  /* 3 ثوانٍ: تكفي للصور المنفصلة اللي ترسل ورا بعض */
  a.timer = setTimeout(() => {
    albums.delete(gid);
    run(a.photos.slice(0, 10), a.caption);
  }, 3000);
}

/* يرسل صورة أو ألبوم أو نصاً — واجهة واحدة لكل الحالات */
async function sendMedia(chatId, photos, text) {
  const list = Array.isArray(photos) ? photos.filter(Boolean) : (photos ? [photos] : []);
  if (!list.length) return sendMsg(chatId, text);

  if (list.length === 1) {
    return tg('sendPhoto', { chat_id: chatId, photo: list[0],
      caption: (text || '').slice(0, 1000), parse_mode: 'HTML' });
  }
  /* ألبوم: التعليق على أول صورة فقط */
  return tg('sendMediaGroup', {
    chat_id: chatId,
    media: list.slice(0, 10).map((p, i) => ({
      type: 'photo', media: p,
      ...(i === 0 && text ? { caption: text.slice(0, 1000), parse_mode: 'HTML' } : {})
    }))
  });
}

/* ═══ الزوار المتصلون ═══
   نسجّل بصمة مجهولة (IP + المتصفح) لكل طلب، ونعدّ آخر 5 دقائق.
   ما نخزّن IP خاماً — نجزّئه فما يعرّف بشخص. */
const visitors = new Map();
const VISITOR_WINDOW = 5 * 60 * 1000;

function touchVisitor(req) {
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
               req.socket.remoteAddress || '';
    const ua = (req.headers['user-agent'] || '').slice(0, 60);
    const h = crypto.createHash('sha1').update(ip + '|' + ua).digest('hex').slice(0, 16);
    visitors.set(h, Date.now());
    if (visitors.size > 8000) {
      const cut = Date.now() - VISITOR_WINDOW;
      for (const [k, t] of visitors) if (t < cut) visitors.delete(k);
    }
  } catch (e) { /* ما يهم */ }
}

function liveVisitors() {
  const cut = Date.now() - VISITOR_WINDOW;
  let live = 0, last1 = 0;
  const cut1 = Date.now() - 60000;
  for (const t of visitors.values()) { if (t >= cut) live++; if (t >= cut1) last1++; }
  return { live, lastMinute: last1 };
}
const FEEDBACK_MEM = [];        /* احتياطي لو جدول feedback مو موجود */
function tooManyTries(ip) {
  const now = Date.now(), rec = loginTries.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) return false;
  return rec.count >= 8;
}
function noteFail(ip) {
  const now = Date.now(), rec = loginTries.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) loginTries.set(ip, { first: now, count: 1 });
  else rec.count++;
  if (loginTries.size > 5000) loginTries.clear();
}
const clientIP = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || 'unknown';

/* ═══ حدّ الطلبات ═══
   /api/courses أغلى نقطة وأكثرها انكشافاً: كل طلب يعيد ١٨٠٠ مادة.
   الردّ مخزَّن مضغوطاً فالطلب الواحد زهيد، والخطر الحقيقي حلقة مجنونة
   أو ساحب بيانات يطلب عشرات المرات في الثانية.

   الرقم مبنيّ على قياس الواجهة لا على تقدير:
   • الكتابة في مربّع البحث تفلتر محلياً بلا أي طلب.
   • quietRefresh يطلب كل ٩٠ ثانية = ٠٫٧ طلب/دقيقة للطالب الواحد.
   • البحث اليدوي يضيف طلبين أو ثلاثة في الدقيقة للطالب النشط.
   فالطالب النشط ≈ ٣ طلبات/دقيقة.

   والطلاب لا يملكون عناوين مستقلة: شبكة الحرم خلف عنوان واحد، وشبكات
   الجوال خلف CGNAT. فمئة طالب نشط في ذروة التسجيل قد يظهرون كعنوان
   واحد يطلب ٣٠٠ في الدقيقة — أي أن حدّاً عند ٣٠٠ يقفل الموقع عليهم.
   ١٢٠٠ (٢٠ في الثانية) يفصل بوضوح: لا يبلغه حشد بشري، ويوقف أي آلة
   لأن الساحب يطلب مئات في الثانية لا عشرين. */
const RATE = new Map();
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 1200;

function rateHit(ip) {
  const now = Date.now();
  let rec = RATE.get(ip);
  if (!rec || now - rec.first > RATE_WINDOW) {
    rec = { first: now, count: 0 };
    RATE.set(ip, rec);
  }
  rec.count++;
  if (RATE.size > 5000) {                     /* تنظيف كسول: المنتهية أولاً */
    for (const [k, v] of RATE) if (now - v.first > RATE_WINDOW) RATE.delete(k);
    if (RATE.size > 5000) RATE.clear();       /* آخر ملاذ — لا نُراكم ذاكرة */
  }
  return {
    ok: rec.count <= RATE_MAX,
    retry: Math.max(1, Math.ceil((rec.first + RATE_WINDOW - now) / 1000))
  };
}

function isAdmin(req) {
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) return false;   // مقفلة لو ما ضبطت كلمة السر
  const given = req.headers['x-admin-token'] || '';
  return safeEqual(String(given), ADMIN_TOKEN);
}

/* --- قراءة جسم الطلب --- */
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) b = b.slice(0, 1e6); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

const isActive = p => !!(p.is_pro ||
  (p.subscription_expires_at && new Date(p.subscription_expires_at) > new Date()));

/* --- حجم التخزين ---
   Supabase يحاسب على التخزين والتحميل معاً. الحجم محفوظ في size_kb
   لكل ملف، فالجمع محلي بلا استعلام على Storage. */
async function adminStorage() {
  const rows = await sbAll('course_photos',
    { query: '?select=id,kind,size_kb,shared,user_id,term,created_at' });
  if (!Array.isArray(rows)) return { total_kb: 0, photos: 0, files: 0 };
  const sum = a => a.reduce((n, r) => n + (r.size_kb || 0), 0);
  const ph = rows.filter(r => r.kind !== 'file');
  const fl = rows.filter(r => r.kind === 'file');
  /* الصور القديمة انرفعت قبل عمود size_kb — نقدّرها بمتوسط المعروف */
  const known = ph.filter(r => r.size_kb);
  const avg = known.length ? Math.round(sum(known) / known.length) : 300;
  const phKb = sum(ph) + ph.filter(r => !r.size_kb).length * avg;
  const byUser = {};
  rows.forEach(r => { byUser[r.user_id] = (byUser[r.user_id] || 0) + (r.size_kb || avg) });
  const top = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([u, kb]) => ({ user: String(u).slice(0, 8), kb }));
  const day = new Date(Date.now() - 7 * 864e5).toISOString();
  return {
    total_kb: phKb + sum(fl),
    photos: ph.length, photos_kb: phKb,
    files: fl.length, files_kb: sum(fl),
    shared: rows.filter(r => r.shared).length,
    estimated: ph.filter(r => !r.size_kb).length,   /* كم صورة حجمها مقدَّر */
    week: rows.filter(r => r.created_at > day).length,
    top
  };
}

/* --- ما رُفع فعلاً ---
   الأرقام تقول «٩٠٠ ك.ب» ولا تقول هل الميزة مستعملة. هذي تعرض المحتوى
   نفسه: صور وملفات وملاحظات، ومع كل واحد حالته مشارك أو خاص. */
async function adminUploads() {
  const [ph, ev] = await Promise.all([
    sbAll('course_photos',
      { query: '?select=id,kind,filename,size_kb,shared,crn,term,on_date,created_at,user_id,note' }),
    sbAll('course_events',
      { query: '?select=id,kind,title,note,note_shared,shared,crn,term,on_date,created_at,user_id' })
  ]);
  const cut = (u) => String(u || '').slice(0, 8);
  const items = [];
  (Array.isArray(ph) ? ph : []).forEach(r => items.push({
    id: r.id, type: r.kind === 'file' ? 'file' : 'photo',
    title: r.filename || null, size_kb: r.size_kb || null,
    shared: !!r.shared, crn: r.crn, term: r.term,
    on_date: r.on_date, at: r.created_at, user: cut(r.user_id),
    note: r.note || null
  }));
  /* الملاحظة وحدها هي المحتوى الذي يكتبه الطالب في الموعد — الموعد بلا
     ملاحظة تاريخ مجرّد لا يفيد في قياس الاستعمال. */
  (Array.isArray(ev) ? ev : []).filter(r => r.note).forEach(r => items.push({
    id: r.id, type: 'note', title: r.title || r.kind,
    size_kb: null, shared: !!r.note_shared, crn: r.crn, term: r.term,
    on_date: r.on_date, at: r.created_at, user: cut(r.user_id),
    note: r.note
  }));
  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const n = t => items.filter(x => x.type === t).length;
  const s = t => items.filter(x => x.type === t && x.shared).length;
  return {
    items: items.slice(0, 300),
    total: items.length,
    counts: { photo: n('photo'), file: n('file'), note: n('note') },
    sharedCounts: { photo: s('photo'), file: s('file'), note: s('note') },
    users: new Set(items.map(x => x.user)).size
  };
}

/* --- الأحجام الحقيقية من Storage ---
   size_kb أُضيف بعد أول الرفعات، فالقديمة تُقدَّر بالمتوسط ويبقى الرقم
   تقريبياً للأبد. هذي تقرأ الأحجام الفعلية مرة واحدة وتملأ العمود،
   وبعدها الحساب دقيق بلا استعلام على Storage في كل مرة. */
async function adminStorageSync() {
  if (!SB_URL || !SB_SERVICE_KEY)
    return { ok: false, error: 'إعدادات Supabase ناقصة', checked: 0, updated: 0, missing: 0 };
  const rows = await sbAll('course_photos', { query: '?select=id,path,size_kb' })
    .catch(() => null);
  if (!Array.isArray(rows))
    return { ok: false, error: 'تعذّرت قراءة الجدول', checked: 0, updated: 0, missing: 0 };
  const need = rows.filter(r => !r.size_kb && r.path);
  if (!need.length) return { ok: true, checked: 0, updated: 0, missing: 0 };

  /* الملفات موزّعة على مجلد لكل طالب، فنسرد كل مجلد على حدة */
  const folders = [...new Set(need.map(r => String(r.path).split('/')[0]))];
  const sizes = new Map();
  for (const f of folders) {
    const body = JSON.stringify({ prefix: f, limit: 1000 });
    const res = await new Promise(resolve => {
      const u = new URL(`${SB_URL}/storage/v1/object/list/course-photos`);
      const rq = https.request({
        hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`
        }
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } });
      });
      rq.on('error', () => resolve(null));
      rq.write(body); rq.end();
    });
    if (Array.isArray(res)) res.forEach(o => {
      const kb = o && o.metadata && o.metadata.size
        ? Math.max(1, Math.round(o.metadata.size / 1024)) : 0;
      if (kb) sizes.set(f + '/' + o.name, kb);
    });
  }

  let updated = 0;
  for (const r of need) {
    const kb = sizes.get(r.path);
    if (!kb) continue;
    const ok = await sb('PATCH', 'course_photos',
      { query: `?id=eq.${r.id}`, body: { size_kb: kb } }).catch(() => null);
    if (ok !== null) updated++;
  }
  return { ok: true, checked: need.length, updated, missing: need.length - updated };
}

/* --- بلاغات المحتوى المشترك ---
   البلاغ لا يخفي شيئاً تلقائياً: طالبان يقدران يحجبان محتوى سليماً بالإساءة.
   يصل هنا وينبّهني، وأنا أقرّر. */
let REPORTS_SEEN = 0;
async function adminReports() {
  const rows = await sbAll('content_reports', { query: '?select=*' });
  if (!Array.isArray(rows) || !rows.length) return [];
  /* نجيب المحتوى المبلَّغ عنه ليظهر مع البلاغ لا كرقم مجرّد */
  const phIds = rows.filter(r => r.kind === 'photo').map(r => r.target_id);
  const evIds = rows.filter(r => r.kind === 'event').map(r => r.target_id);
  const [ph, ev] = await Promise.all([
    phIds.length ? sb('GET', 'course_photos',
      { query: `?id=in.(${phIds.join(',')})&select=id,path,crn,on_date,kind,filename,user_id` })
      : Promise.resolve([]),
    evIds.length ? sb('GET', 'course_events',
      { query: `?id=in.(${evIds.join(',')})&select=id,crn,kind,on_date,note,user_id` })
      : Promise.resolve([])
  ]);
  const byId = {};
  (Array.isArray(ph) ? ph : []).forEach(x => { byId['photo:' + x.id] = x });
  (Array.isArray(ev) ? ev : []).forEach(x => { byId['event:' + x.id] = x });
  return rows
    .map(r => Object.assign({}, r, { target: byId[r.kind + ':' + r.target_id] || null }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/* إنذار فوري عند بلاغ جديد — نفحص مع دورة المراقبة القائمة */
async function reportsWatch() {
  try {
    const rows = await sb('GET', 'content_reports',
      { query: '?select=id&order=id.desc&limit=1' }).catch(() => []);
    const top = Array.isArray(rows) && rows[0] ? rows[0].id : 0;
    if (!REPORTS_SEEN) { REPORTS_SEEN = top; return; }   /* أول إقلاع: مرجع فقط */
    if (top > REPORTS_SEEN) {
      const n = top - REPORTS_SEEN;
      REPORTS_SEEN = top;
      alert('report', 'بلاغ على محتوى مشترك',
        `${n} بلاغ جديد. افتح اللوحة › تبويب البلاغات وراجعه.`);
    }
  } catch (e) {}
}

/* --- إحصائيات عامة --- */
async function adminStats() {
  const [profiles, reviews, monitors, sched] = await Promise.all([
    sb('GET', 'profiles', { query: '?select=*' }),
    sb('GET', 'instructor_reviews', { query: '?select=*' }),
    sb('GET', 'monitored_courses', { query: '?select=*' }),
    sbAll('user_schedule', { query: '?select=user_id' })
  ]);
  const P = Array.isArray(profiles) ? profiles : [];
  const R = Array.isArray(reviews) ? reviews : [];
  const M = Array.isArray(monitors) ? monitors : [];
  const S = Array.isArray(sched) ? sched : [];

  const now = Date.now(), week = now - 7 * 864e5;
  const paid = P.filter(p => p.paid_at);
  const active = P.filter(isActive);

  const dateOf = p => p.created_at || p.paid_at || null;
  const newWeek = P.filter(p => { const d = dateOf(p); return d && new Date(d).getTime() > week; });

  const expSoon = P.filter(p => {
    if (!p.subscription_expires_at) return false;
    const t = new Date(p.subscription_expires_at).getTime();
    return t > now && t < now + 14 * 864e5;
  });

  const avg = R.length ? (R.reduce((s, r) => s + (Number(r.rating) || 0), 0) / R.length) : 0;

  return {
    users: P.length,
    newThisWeek: newWeek.length,
    activeSubs: active.length,
    paidUsers: paid.length,
    expiringSoon: expSoon.length,
    telegramLinked: P.filter(p => p.telegram_chat_id).length,
    revenue: paid.length * 19,
    reviews: R.length,
    avgRating: Number(avg.toFixed(2)),
    monitors: M.length,
    monitoringUsers: new Set(M.map(m => m.user_id)).size,
    scheduleUsers: new Set(S.map(s => s.user_id)).size,
    hasCreatedAt: P.some(p => p.created_at !== undefined)
  };
}

/* --- قائمة المستخدمين --- */
async function adminUsers() {
  const P = await sb('GET', 'profiles', { query: '?select=*' });
  const M = await sb('GET', 'monitored_courses', { query: '?select=user_id' });
  const counts = {};
  (Array.isArray(M) ? M : []).forEach(m => { counts[m.user_id] = (counts[m.user_id] || 0) + 1; });

  return (Array.isArray(P) ? P : []).map(p => ({
    id: p.id,
    name: p.name || '—',
    email: p.email || '—',
    major: p.major || '—',
    /* نسخة الخطة — نعرضها فقط للتخصصات اللي لها نسختان، والافتراضي
       الجديدة لمن ما بدّل. مهمة عشان تفهم شكوى الطالب من خطته. */
    planVer: (p.plan_ver === 'old') ? 'old' : 'new',
    isPro: !!p.is_pro,
    active: isActive(p),
    expires: p.subscription_expires_at || null,
    paidAt: p.paid_at || null,
    createdAt: p.created_at || null,
    telegram: p.telegram_username ? '@' + p.telegram_username : (p.telegram_chat_id ? '✓' : null),
    monitors: counts[p.id] || 0
  })).sort((a, b) => {
    const da = new Date(a.createdAt || a.paidAt || 0).getTime();
    const db = new Date(b.createdAt || b.paidAt || 0).getTime();
    return db - da;
  });
}

/* --- التقييمات مع اسم صاحبها --- */
async function adminReviews() {
  const R = await sb('GET', 'instructor_reviews', { query: '?select=*' });
  const P = await sb('GET', 'profiles', { query: '?select=id,name,email' });
  const map = {};
  (Array.isArray(P) ? P : []).forEach(p => { map[p.id] = p; });

  return (Array.isArray(R) ? R : []).map(r => ({
    id: r.id !== undefined ? r.id : null,
    userId: r.user_id,
    author: (map[r.user_id] || {}).name || '—',
    authorEmail: (map[r.user_id] || {}).email || '—',
    instructor: r.instructor_name || '—',
    rating: Number(r.rating) || 0,
    agree: Number(r.agree) || 0,
    disagree: Number(r.disagree) || 0,
    reports: Number(r.reports) || 0,
    hidden: !!r.hidden,
    course: r.course_code || '—',
    comment: r.comment || '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    createdAt: r.created_at || null
  })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/* --- المواد المراقبة، مجمّعة --- */
async function adminMonitors() {
  const M = await sb('GET', 'monitored_courses', { query: '?select=*' });
  const list = Array.isArray(M) ? M : [];
  /* أسماء المراقِبين عشان تشوف مين يراقب وش */
  const uids = [...new Set(list.map(m => m.user_id).filter(Boolean))];
  const who = {};
  if (uids.length) {
    const ps = await sb('GET', 'profiles', {
      query: `?id=in.(${uids.map(u => `"${u}"`).join(',')})&select=id,name,email,telegram_chat_id`
    }).catch(() => []);
    (Array.isArray(ps) ? ps : []).forEach(p => { who[p.id] = p });
  }
  const g = {};
  list.forEach(m => {
    /* صفوف المادة ما لها شعبة ولا CRN — نميّزها بدل ما تطلع "؟" */
    const isCourse = m.scope === 'course';
    const k = isCourse
      ? (m.course_code || '?') + ' · كل الشعب'
      : (m.course_code || '?') + ' §' + (m.section || '?');
    if (!g[k]) g[k] = { key: k, crn: m.crn, term: m.term, scope: m.scope || 'section',
                        sections: isCourse && m.sections_state
                          ? Object.keys(m.sections_state).length : null,
                        status: isCourse ? null : (m.last_status || '—'),
                        watchers: 0, notified: 0, rows: [] };
    g[k].watchers++;
    if (m.notified_at) g[k].notified++;
    const p = who[m.user_id] || {};
    g[k].rows.push({
      id: m.id,
      name: p.name || '—',
      email: p.email || '—',
      linked: !!p.telegram_chat_id,
      askedAt: m.expires_at || null,
      notifiedAt: m.notified_at || null,   /* عشان ما نرسل تنبيهاً مرتين بلا ما ندري */
      since: m.created_at || null
    });
  });
  return Object.values(g).sort((a, b) => b.watchers - a.watchers);
}

/* --- تفعيل / تمديد اشتراك --- */
async function adminGrant(userId, days) {
  const rows = await sb('GET', 'profiles',
    { query: `?id=eq.${encodeURIComponent(userId)}&select=subscription_expires_at` });
  if (!rows || !rows.length) return { ok: false, error: 'المستخدم غير موجود' };

  const cur = rows[0].subscription_expires_at ? new Date(rows[0].subscription_expires_at) : null;
  const base = (cur && cur > new Date()) ? cur : new Date();   // يمدّد من تاريخ الانتهاء لو لسا فعّال
  base.setDate(base.getDate() + Number(days));

  await sb('PATCH', 'profiles', {
    query: `?id=eq.${encodeURIComponent(userId)}`,
    body: { subscription_expires_at: base.toISOString(), paid_at: new Date().toISOString() }
  });
  return { ok: true, expires: base.toISOString() };
}

/* --- إلغاء اشتراك --- */
async function adminRevoke(userId) {
  await sb('PATCH', 'profiles', {
    query: `?id=eq.${encodeURIComponent(userId)}`,
    body: { is_pro: false, subscription_expires_at: new Date(Date.now() - 864e5).toISOString() }
  });
  return { ok: true };
}

/* --- حذف تقييم مسيء --- */
async function adminDeleteReview(r) {
  let q;
  if (r.id !== undefined && r.id !== null && r.id !== '') {
    q = `?id=eq.${encodeURIComponent(r.id)}`;
  } else if (r.userId && r.instructor) {
    q = `?user_id=eq.${encodeURIComponent(r.userId)}` +
        `&instructor_name=eq.${encodeURIComponent(r.instructor)}`;
  } else {
    return { ok: false, error: 'ما قدرت أحدد التقييم' };
  }
  await sb('DELETE', 'instructor_reviews', { query: q, prefer: 'return=minimal' });
  return { ok: true };
}

/* --- إرسال رسالة تيليغرام لمستخدم --- */
async function adminNotify(userId, text) {
  const rows = await sb('GET', 'profiles',
    { query: `?id=eq.${encodeURIComponent(userId)}&select=telegram_chat_id` });
  const chat = rows && rows[0] && rows[0].telegram_chat_id;
  if (!chat) return { ok: false, error: 'المستخدم ما ربط تيليغرام' };
  const r = await sendMsg(chat, String(text).slice(0, 3000));
  /* ما نقول "انرسلت" إلا لو تيليغرام أكّد فعلاً */
  if (!r || r.ok !== true) {
    return { ok: false, error: (r && r.description) || 'ما وصل تأكيد من تيليغرام' };
  }
  return { ok: true };
}

/* ================================================================
   ============        نظام التذاكر        ============
   ================================================================ */

/* تجيب التذكرة المفتوحة للطالب، أو تنشئ وحدة جديدة */
async function getOrCreateTicket(info) {
  const chat = String(info.chatId || '');
  if (chat) {
    try {
      const open = await sb('GET', 'tickets', {
        query: `?chat_id=eq.${encodeURIComponent(chat)}&status=eq.open` +
               `&select=*&order=updated_at.desc&limit=1`
      });
      if (Array.isArray(open) && open[0]) return open[0];
    } catch (e) { /* الجدول ناقص */ }
  }
  try {
    const created = await sb('POST', 'tickets', {
      body: {
        user_email: info.email || null, user_name: info.name || null,
        chat_id: chat || null, telegram: info.telegram || null,
        major: info.major || null, category: info.category || 'other',
        subject: String(info.text || '').slice(0, 80)
      },
      prefer: 'return=representation'
    });
    return Array.isArray(created) ? created[0] : null;
  } catch (e) { return null; }
}

async function addTicketMessage(ticketId, sender, body, photoId) {
  if (!ticketId) return;
  try {
    await sb('POST', 'ticket_messages', {
      body: { ticket_id: ticketId, sender, body: String(body || '').slice(0, 4000),
              photo_id: photoId || null },
      prefer: 'return=minimal'
    });
    await sb('PATCH', 'tickets', {
      query: `?id=eq.${ticketId}`,
      body: { updated_at: new Date().toISOString(), status: 'open', closed_at: null },
      prefer: 'return=minimal'
    });
  } catch (e) { /* ما يهم */ }
}

async function closeTicket(id) {
  try {
    await sb('PATCH', 'tickets', {
      query: `?id=eq.${id}`,
      body: { status: 'closed', closed_at: new Date().toISOString() },
      prefer: 'return=minimal'
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function adminTickets(status) {
  try {
    const q = status === 'closed' ? '&status=eq.closed'
            : status === 'all' ? '' : '&status=eq.open';
    const rows = await sb('GET', 'tickets',
      { query: `?select=*${q}&order=updated_at.desc&limit=100` });
    if (!Array.isArray(rows)) return [];
    /* نجيب رسائل كل التذاكر دفعة واحدة */
    const ids = rows.map(r => r.id);
    let msgs = [];
    if (ids.length) {
      msgs = await sb('GET', 'ticket_messages', {
        query: `?ticket_id=in.(${ids.join(',')})&select=*&order=created_at.asc&limit=1000`
      });
      if (!Array.isArray(msgs)) msgs = [];
    }
    return rows.map(r => ({
      ...r,
      messages: msgs.filter(m => String(m.ticket_id) === String(r.id))
    }));
  } catch (e) { return []; }
}

/* ================================================================
   ============   تفاعلات التقييمات والتبليغ   ============
   ================================================================ */
async function reviewReact(reviewId, userId, kind, reason) {
  if (!['agree', 'disagree', 'report'].includes(kind))
    return { ok: false, error: 'نوع غير معروف' };
  if (!reviewId || !userId) return { ok: false, error: 'بيانات ناقصة' };
  /* المسار مفتوح للإنترنت بلا توثيق، والمعرّف يدخل الفلتر —
     نفرض شكل UUID قبل أي استعلام. */
  if (!isUuid(reviewId) || !isUuid(userId))
    return { ok: false, error: 'معرّف غير صالح' };

  try {
    /* موجود من قبل؟ نتراجع عنه (عدا التبليغ) */
    const prev = await sb('GET', 'review_reactions', {
      query: `?review_id=eq.${reviewId}&user_id=eq.${encodeURIComponent(userId)}` +
             `&kind=eq.${kind}&select=id`
    });
    if (Array.isArray(prev) && prev[0]) {
      if (kind === 'report') return { ok: true, already: true };
      await sb('DELETE', 'review_reactions',
        { query: `?id=eq.${prev[0].id}`, prefer: 'return=minimal' });
      await bumpReview(reviewId, kind, -1);
      return { ok: true, removed: true };
    }

    /* موافق وغير موافق متعارضان — نشيل الآخر */
    if (kind === 'agree' || kind === 'disagree') {
      const other = kind === 'agree' ? 'disagree' : 'agree';
      const o = await sb('GET', 'review_reactions', {
        query: `?review_id=eq.${reviewId}&user_id=eq.${encodeURIComponent(userId)}` +
               `&kind=eq.${other}&select=id`
      });
      if (Array.isArray(o) && o[0]) {
        await sb('DELETE', 'review_reactions',
          { query: `?id=eq.${o[0].id}`, prefer: 'return=minimal' });
        await bumpReview(reviewId, other, -1);
      }
    }

    await sb('POST', 'review_reactions', {
      body: { review_id: reviewId, user_id: userId, kind,
              reason: reason ? String(reason).slice(0, 300) : null },
      prefer: 'return=minimal'
    });
    await bumpReview(reviewId, kind, 1);

    /* التبليغ يوصلك فوراً */
    if (kind === 'report' && ADMIN_CHAT_ID) {
      let rv = null;
      try {
        const r = await sb('GET', 'instructor_reviews',
          { query: `?id=eq.${reviewId}&select=*` });
        rv = Array.isArray(r) ? r[0] : null;
      } catch (e) { /* ما يهم */ }
      const esc = x => String(x || '').replace(/[<>]/g, '');
      sendMsg(ADMIN_CHAT_ID,
        `🚩 <b>بلاغ على تقييم</b>\n\n` +
        (rv ? `<blockquote>${esc(rv.comment || '(بدون تعليق)')}</blockquote>\n` +
              `👨‍🏫 ${esc(rv.instructor_name)}\n⭐ ${rv.rating}/5\n` : '') +
        (reason ? `\n📝 السبب: ${esc(reason)}\n` : '') +
        `🚩 مجموع البلاغات: ${rv ? (rv.reports || 0) + 1 : '?'}\n\n` +
        `📊 jadwalik.com/admin`).catch(() => {});
    }
    return { ok: true, added: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* نزيد أو ننقص العدّاد على التقييم نفسه */
async function bumpReview(reviewId, kind, delta) {
  const col = kind === 'agree' ? 'agree' : kind === 'disagree' ? 'disagree' : 'reports';
  try {
    const r = await sb('GET', 'instructor_reviews',
      { query: `?id=eq.${reviewId}&select=${col}` });
    const cur = (Array.isArray(r) && r[0] && r[0][col]) || 0;
    await sb('PATCH', 'instructor_reviews', {
      query: `?id=eq.${reviewId}`,
      body: { [col]: Math.max(0, cur + delta) },
      prefer: 'return=minimal'
    });
  } catch (e) { /* ما يهم */ }
}

/* إلغاء البلاغات على تقييم — نصفّر العدّاد ونحذف سجلاتها */
async function clearReports(id) {
  try {
    await sb('DELETE', 'review_reactions',
      { query: `?review_id=eq.${id}&kind=eq.report`, prefer: 'return=minimal' });
    await sb('PATCH', 'instructor_reviews',
      { query: `?id=eq.${id}`, body: { reports: 0 }, prefer: 'return=minimal' });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* حذف تذكرة ورسائلها */
async function deleteTicket(id) {
  try {
    await sb('DELETE', 'ticket_messages',
      { query: `?ticket_id=eq.${id}`, prefer: 'return=minimal' });
    await sb('DELETE', 'tickets',
      { query: `?id=eq.${id}`, prefer: 'return=minimal' });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* حذف ملاحظة */
async function deleteFeedback(id) {
  if (!id) return { ok: false, error: 'بدون معرّف' };
  try {
    await sb('DELETE', 'feedback',
      { query: `?id=eq.${id}`, prefer: 'return=minimal' });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* إخفاء أو إظهار تقييم من اللوحة */
async function setReviewHidden(id, hidden) {
  try {
    await sb('PATCH', 'instructor_reviews', {
      query: `?id=eq.${id}`, body: { hidden: !!hidden }, prefer: 'return=minimal' });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ================================================================
   ============        البث الجماعي        ============
   ================================================================ */
const BROADCAST = { running: false, sent: 0, failed: 0, total: 0, at: 0, text: '' };

async function adminBroadcast(text, photo, dryRun) {
  if (BROADCAST.running) return { ok: false, error: 'فيه بث شغّال الآن' };
  const body = String(text || '').trim();
  if (!body && !photo) return { ok: false, error: 'الرسالة فاضية' };

  let rows = [];
  try {
    rows = await sb('GET', 'profiles',
      { query: '?telegram_chat_id=not.is.null&select=telegram_chat_id,name' });
  } catch (e) { return { ok: false, error: e.message }; }
  const list = (Array.isArray(rows) ? rows : []).filter(r => r.telegram_chat_id);

  if (dryRun) return { ok: true, dryRun: true, total: list.length };
  if (!list.length) return { ok: false, error: 'ما فيه أحد ربط تيليغرام' };

  Object.assign(BROADCAST, { running: true, sent: 0, failed: 0,
    total: list.length, at: Date.now(), text: body.slice(0, 120) });

  /* نرسل بالخلفية على دفعات — تيليغرام حده ~30 رسالة/ثانية */
  (async () => {
    try {
      await inBatches(list, 20, async (r) => {
        const res = photo
          ? await sendMedia(r.telegram_chat_id, photo, body)
          : await sendMsg(r.telegram_chat_id,
              body.slice(0, 3400) + `\n\n<i>💬 عندك ملاحظة؟ اكتبها هنا مباشرة.</i>`);
        if (res && res.ok) BROADCAST.sent++; else BROADCAST.failed++;
        await new Promise(x => setTimeout(x, 700));
      });
    } finally {
      BROADCAST.running = false;
      if (ADMIN_CHAT_ID) sendMsg(ADMIN_CHAT_ID,
        `📢 <b>انتهى البث</b>\n\n` +
        `✅ وصلت: ${BROADCAST.sent}\n` +
        `⚠️ فشلت: ${BROADCAST.failed}\n` +
        `👥 المجموع: ${BROADCAST.total}` +
        (BROADCAST.failed ? `\n\n<i>الفشل غالباً طلاب حظروا البوت.</i>` : '')).catch(()=>{});
    }
  })();

  return { ok: true, started: true, total: list.length };
}

/* --- رد مباشر على طالب من اللوحة --- */
async function adminReply(chatId, email, text) {
  const body = String(text || '').trim();
  if (body.length < 2) return { ok: false, error: 'الرسالة قصيرة' };

  let target = chatId ? String(chatId) : null;
  if (!target && email) {
    /* عمود user_email غير موجود في profiles — كان يرمي خطأ في كل نداء */
    try {
      const rows = await sb('GET', 'profiles', {
        query: `?email=ilike.${encodeURIComponent(email)}&select=telegram_chat_id`
      });
      if (Array.isArray(rows) && rows[0] && rows[0].telegram_chat_id)
        target = rows[0].telegram_chat_id;
    } catch (e) { /* تجاهل */ }
  }
  if (!target) return { ok: false, error: 'ما ربط تيليغرام — رد بالإيميل' };

  const r = await sendMsg(target,
    `💬 <b>رد من فريق جدولك</b>\n\n${body.slice(0,3000)}\n\n` +
    `<i>💬 تبي ترد؟ اكتب رسالتك هنا مباشرة وبتوصلنا.</i>`);
  if (!r || r.ok !== true) return { ok: false, error: (r && r.description) || 'ما وصل تأكيد' };
  return { ok: true };
}

/* --- ملاحظات الطلاب --- */
async function adminFeedback() {
  let rows = [];
  try {
    const r = await sb('GET', 'feedback', { query: '?select=*&order=created_at.desc&limit=200' });
    if (Array.isArray(r)) rows = r.map(x => ({
      at: x.created_at ? Date.parse(x.created_at) : null,
      text: x.message, category: x.category,
      id: x.id,
      email: x.user_email, name: x.user_name, major: x.major, lang: x.lang,
      telegram: x.telegram, chatId: x.chat_id || null,
      id: x.id, source: 'db'
    }));
  } catch (e) { /* الجدول غير موجود */ }
  const mem = FEEDBACK_MEM.map(f => ({ ...f, source: 'mem' }));
  return [...rows, ...mem].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 200);
}

/* --- فحص صحة الإعدادات --- */
async function adminHealth() {
  const now = Date.now();
  const C = OPS.cycles;
  const last = C[C.length - 1] || null;
  const recent = C.slice(-12);

  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const secs = recent.map(c => c.sec);

  /* ── تيليغرام ── */
  let tgOk = false, tgName = null, tgErr = null;
  if (TELEGRAM_TOKEN) {
    const me = await tg('getMe', {});
    if (me && me.ok) { tgOk = true; tgName = '@' + me.result.username; }
    else tgErr = (me && me.description) || 'ما وصل رد من تيليغرام';
  } else tgErr = 'TELEGRAM_TOKEN غير مضبوط';

  /* ── الجامعة: هل آخر سحبة نجحت؟ ── */
  const pmuOk = last ? last.snapshot > 0 : null;

  /* ── الحمل ── */
  const monitors = await sb('GET', 'monitored_courses', { query: '?select=id' })
    .then(r => Array.isArray(r) ? r.length : 0).catch(() => 0);

  const mem = process.memoryUsage();
  const cacheHitRate = OPS.searches ? OPS.searchesCached / OPS.searches : null;

  /* ── التحذيرات ── */
  const warn = [];
  const add = (level, ar, en, hint) => warn.push({ level, ar, en, hint });

  if (!tgOk)
    add('bad', 'بوت تيليغرام ما يرسل', 'Telegram bot cannot send',
        tgErr + ' — تأكد أن TELEGRAM_TOKEN في Render بدون مسافات.');

  if (pmuOk === false)
    add('bad', 'آخر سحبة من الجامعة فشلت', 'Last university fetch failed',
        'موقع الجامعة قد يكون معطلاً أو حجب السيرفر. تحقق من masterschedule.pmu.edu.sa');

  if (last && last.sec > 240)
    add('bad', `الدورة أخذت ${last.sec} ثانية`, `Cycle took ${last.sec}s`,
        'الحد 300 ثانية. لو تكررت، تحتاج توسعة.');
  else if (last && last.sec > 150)
    add('warn', `الدورة أخذت ${last.sec} ثانية`, `Cycle took ${last.sec}s`,
        'قريبة من الحد (300 ثانية). راقبها.');

  if (OPS.skipped > 0)
    add('warn', `${OPS.skipped} دورة تخطّت`, `${OPS.skipped} cycles skipped`,
        'الدورة السابقة ما خلصت في وقتها. الإشعارات قد تتأخر.');

  if (OPS.tgFails > 0)
    add('warn', `${OPS.tgFails} رسالة فشلت`, `${OPS.tgFails} messages failed`,
        'غالباً طالب حظر البوت أو حذف المحادثة.');

  if (OPS.pmuFails > 3)
    add('warn', `${OPS.pmuFails} فشل في سحب بيانات الجامعة`, `${OPS.pmuFails} university fetch failures`,
        'لو الرقم يزيد بسرعة، السيرفر قد يكون محجوباً.');

  if (OPS.searchStale > 0)
    add('warn', `${OPS.searchStale} بحث خُدم من نسخة قديمة`, `${OPS.searchStale} searches served stale`,
        'الجامعة كانت معطلة والموقع خدم آخر نسخة محفوظة.');

  if (cacheHitRate !== null && OPS.searches > 30 && cacheHitRate < 0.4)
    add('warn', `الكاش يخدم ${Math.round(cacheHitRate * 100)}% فقط`,
        `Cache hit rate only ${Math.round(cacheHitRate * 100)}%`,
        'ضغط أعلى على موقع الجامعة من المتوقع.');

  const memPct = mem.rss / (512 * 1024 * 1024);
  if (memPct > 0.85)
    add('bad', `الذاكرة ${Math.round(memPct * 100)}%`, `Memory at ${Math.round(memPct * 100)}%`,
        'خطة Render فيها 512 ميجا. قريب من الامتلاء.');
  else if (memPct > 0.7)
    add('warn', `الذاكرة ${Math.round(memPct * 100)}%`, `Memory at ${Math.round(memPct * 100)}%`, '');

  if (!ADMIN_CHAT_ID)
    add('warn', 'إشعارات الآراء غير مفعّلة', 'Feedback alerts not enabled',
        'أرسل /whoami للبوت وحط الرقم في Render باسم ADMIN_CHAT_ID.');

  if (FEEDBACK_MEM.length)
    add('warn', `${FEEDBACK_MEM.length} ملاحظة محفوظة بالذاكرة فقط`,
        `${FEEDBACK_MEM.length} feedback items in memory only`,
        'جدول feedback غير موجود في Supabase — تُفقد عند إعادة التشغيل. شغّل SQL الإنشاء.');

  const upMin = (now - OPS.bootedAt) / 60000;
  if (upMin < 20 && OPS.searches > 3)
    add('warn', `السيرفر أُعيد تشغيله قبل ${Math.round(upMin)} دقيقة`,
        `Server restarted ${Math.round(upMin)} min ago`,
        'الكاش في الذاكرة، فيُمسح مع كل إعادة تشغيل. لو تتكرر كثيراً فالخدمة على خطة تنام عند الخمول.');

  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 16)
    add('warn', 'كلمة سر اللوحة قصيرة', 'Admin password is short',
        'استخدم 16 حرف فأكثر.');

  /* الإنذار لا يسري إلا لو المراقبة يفترض أنها شغّالة —
     الاشتكاء من غياب دورة أوقفتها بنفسك خارج ساعات العمل
     يضيء نقطة حمراء كل ليلة، فتتعوّد تجاهلها يوم يتعطل شيء حقيقي. */
  if (last && (now - last.at) > 12 * 60 * 1000 && monitorState().active)
    add('bad', 'ما فيه دورة مراقبة منذ فترة', 'No monitor cycle recently',
        'المفروض كل 5 دقائق. تحقق من سجل Render.');

  /* ── حالة الجدولة ── */
  const ms = monitorState();
  if (SITE_ENV !== 'prod')
    add('warn', `هذي نسخة اختبار (${SITE_ENV})`, `This is a ${SITE_ENV} instance`,
        'المراقبة والإشعارات معطّلة هنا عشان ما تتكرر مع نسخة الإنتاج.');
  if (!ms.active && ms.reason === 'offseason') {
    const nw = nextWindow();
    add('warn', 'المراقبة متوقفة — خارج فترات التسجيل',
        'Monitoring paused — outside registration periods',
        nw ? `تستأنف تلقائياً في ${nw.ar} (${nw.from}).` : 'ما فيه نافذة قادمة في التقويم — حدّث MONITOR_WINDOWS.');
  } else if (!ms.active)
    add('warn', 'المراقبة متوقفة الآن — ' + ms.ar, 'Monitoring paused — ' + ms.en,
        'تستأنف تلقائياً الساعة 7 صباحاً بتوقيت الرياض.');
  else if (ms.reason === 'idle')
    add('warn', 'المراقبة مخفّفة — خارج فترة التسجيل', 'Reduced monitoring — outside registration',
        'يرجع مكثفاً تلقائياً في نافذة التسجيل القادمة.');

  /* ── سعة تقديرية ── */
  const rate = 20 / 0.88;                       // رسالة/ثانية
  const capacity = Math.floor(280 * rate / 2.4); // طالب في أقصى ذروة

  return {
    /* الإعدادات */
    telegramOk: tgOk, telegramName: tgName, telegramError: tgErr,
    supabase: SB_URL && SB_SERVICE_KEY ? 'مضبوط' : 'ناقص',
    telegramToken: TELEGRAM_TOKEN ? 'مضبوط' : 'ناقص',
    adminChat: ADMIN_CHAT_ID ? 'مضبوط' : 'ناقص',

    /* التشغيل */
    uptimeHours: Number(((now - OPS.bootedAt) / 3600000).toFixed(1)),
    memMB: Math.round(mem.rss / 1048576),
    memPct: Math.round(memPct * 100),

    /* الدورة */
    pmuOk,
    lastCycle: last,
    lastCycleAgoSec: last ? Math.round((now - last.at) / 1000) : null,
    cycleAvgSec: Number(avg(secs).toFixed(1)),
    cycleMaxSec: secs.length ? Math.max(...secs) : 0,
    cycleCount: C.length,
    cycles: recent,
    skipped: OPS.skipped,

    /* البحث */
    searches: OPS.searches,
    feedbackCount: OPS.feedback,
    cacheHitPct: cacheHitRate === null ? null : Math.round(cacheHitRate * 100),
    searchStale: OPS.searchStale,
    cacheFromMonitor: OPS.cacheFromMonitor,

    /* الحمل */
    monitorRows: monitors,
    tgFails: OPS.tgFails,
    pmuFails: OPS.pmuFails,
    lastError: OPS.lastError,

    env: SITE_ENV,
    freeBeta: FREE_BETA,
    maintenance: MAINTENANCE,
    maintenanceMsg: MAINT_MSG,
    finalsOn: FINALS_ON,
    monitorPaused: MONITOR_PAUSED,

    /* ── تفاصيل جدولة المراقبة، للعرض في اللوحة ── */
    monitorInfo: {
      state: ms,
      paused: MONITOR_PAUSED,
      enabled: MONITOR_ENABLED,
      hoursFrom: activeFrom(),
      hoursTo: activeTo(),
      hoursCustom: !!HOURS_OVERRIDE,
      windowCustom: !!WINDOW_OVERRIDE,
      riyadhHour: riyadhHour(),
      riyadhTime: riyadhTime(),
      riyadhDate: riyadhDate(),
      intervalMin: INTERVAL_PEAK / 60000,
      jitterPct: Math.round(JITTER * 100),
      intervalMinLow: Number(((INTERVAL_PEAK * (1 - JITTER)) / 60000).toFixed(2)),
      intervalMinHigh: Number(((INTERVAL_PEAK * (1 + JITTER)) / 60000).toFixed(2)),
      idleOff: !INTERVAL_IDLE,
      window: currentWindow(),
      nextWindow: nextWindow(),
      windows: MONITOR_WINDOWS,
      nextCycleAt: NEXT_CYCLE_AT || null,
      nextCycleInSec: NEXT_CYCLE_AT ? Math.max(0, Math.round((NEXT_CYCLE_AT - now) / 1000)) : null
    },

    prewarmOn: PREWARM_ON,
    prewarm: {
      runs: PREWARM.runs, refreshed: PREWARM.refreshed,
      lastAt: PREWARM.lastAt, lastKeys: PREWARM.lastKeys, err: PREWARM.err,
      on: PREWARM.on, skipped: PREWARM.skipped, lastSkip: PREWARM.lastSkip,
      demand: demandNow(),
      minRate: DEMAND_MIN_RATE, slowRate: DEMAND_SLOW_RATE,
      busyRate: DEMAND_BUSY_RATE,
      windowMin: Math.round(DEMAND_WINDOW / 60000),
      slowMs: SLOW_FETCH_MS
    },
    cacheSize: coursesCache.size,
    ttlOverride: TTL_OVERRIDE,
    ttlChoices: TTL_CHOICES,
    ttlLimits: { min: TTL_MIN_ALLOWED, max: TTL_MAX_ALLOWED },
    monitorJitterPct: Math.round(JITTER * 100),
    schedSync: {
      last: SCHED_SYNC.last,
      lastChange: SCHED_SYNC.lastChange,
      runs: SCHED_SYNC.runs,
      totalUpdated: SCHED_SYNC.totalUpdated,
      markedMissing: (SCHED_SYNC.last && SCHED_SYNC.last.markedMissing) || 0,
      log: SCHED_LOG.slice(0, 15),
      missingList: (SCHED_SYNC.last && SCHED_SYNC.last.missingList) || [],
      gapMin: Math.round(SCHED_SYNC_GAP / 60000),
      /* ── طابور التأكيد ── */
      confirmAfterMin: Math.round(CONFIRM_AFTER / 60000),
      minSightings: CONFIRM_MIN_SIGHTINGS,
      feedN: (SCHED_SYNC.last && SCHED_SYNC.last.feedN) || null,
      feedPeak: (SCHED_SYNC.last && SCHED_SYNC.last.feedPeak) || null,
      feedFloor: FEED_FLOOR,
      activeTerm: ACTIVE_TERM,
      skippedTerms: SCHED_SYNC.skippedTerms || 0,
      feedRejected: (SCHED_SYNC.last && SCHED_SYNC.last.feedRejected) || null,
      crnRejected: (SCHED_SYNC.last && SCHED_SYNC.last.crnRejected) || 0,
      pendingNew: (SCHED_SYNC.last && SCHED_SYNC.last.pendingNew) || 0,
      pendingWaiting: (SCHED_SYNC.last && SCHED_SYNC.last.pendingWaiting) || 0,
      confirmed: (SCHED_SYNC.last && SCHED_SYNC.last.confirmed) || 0,
      discarded: (SCHED_SYNC.last && SCHED_SYNC.last.discarded) || 0,
      notified: (SCHED_SYNC.last && SCHED_SYNC.last.notified) || 0,
      notifySuppressed: (SCHED_SYNC.last && SCHED_SYNC.last.notifySuppressed) || 0,
      notifyCap: LAST_CAP,
      notifyRatio: NOTIFY_RATIO,
      notifyFloor: NOTIFY_FLOOR,
      activeStudents: (SCHED_SYNC.last && SCHED_SYNC.last.activeStudents) || 0,
      stormApproved: (SCHED_SYNC.last && SCHED_SYNC.last.stormApproved) || 0,
      stormAbort: (SCHED_SYNC.last && SCHED_SYNC.last.stormAbort) || 0,
      pending: await pendingSnapshot(),
      tick: { everyMin: Math.round(CONFIRM_TICK / 60000),
              maxAgeHr: Math.round(PENDING_MAX_AGE / 3600000),
              lastTick: CONFIRM_STAT.lastTick || null,
              lastForce: CONFIRM_STAT.lastForce || null,
              forces: CONFIRM_STAT.forces, purged: CONFIRM_STAT.purged },
      flaps: FLAP_LOG.slice(0, 15),
      unwatch: {
        total: UNWATCH_LOG.length,
        byVia: UNWATCH_LOG.reduce((a, e) => { a[e.via] = (a[e.via] || 0) + 1; return a }, {}),
        recent: UNWATCH_LOG.slice(0, 12)
      }
    },
    alerts: Object.entries(ALERTS).filter(([,v])=>v.active)
              .map(([k,v])=>({key:k,title:v.title,since:v.at})),
    ttl: ttlReason(),
    cache: cacheSnapshot(),
    caches: {
      finals: ['M','F'].map(g=>({
        key:'اختبارات '+(g==='M'?'الطلاب':'الطالبات'),
        ok: !!(finalsCache[g]&&finalsCache[g].exams&&finalsCache[g].exams.length),
        count: finalsCache[g]&&finalsCache[g].exams?finalsCache[g].exams.length:0,
        ageMin: finalsCache[g]?Math.round((now-finalsCache[g].at)/60000):null,
        ttlMin: 360
      })),
      docs: {
        key:'قائمة الدكاترة',
        note:'تُبنى في متصفح كل طالب من كاش البحث — ما لها كاش مستقل في السيرفر'
      }
    },
    riyadhDate: riyadhDate(),
    visitors: liveVisitors(),
    monitor: {
      active: ms.active, reason: ms.reason, ar: ms.ar,
      intervalMin: ms.intervalMin,
      dataTtlMin: Math.round(coursesTTL() / 60000),
      window: ms.window ? ms.window.ar : null,
      nextWindow: MONITOR_WINDOWS.find(w => riyadhDate() < w.from) || null,
      riyadhHour: riyadhHour()
    },

    capacity,
    loadPct: capacity ? Math.min(100, Math.round(monitors / 2.4 / capacity * 100)) : 0,

    warnings: warn
  };
}

/* --- تفاصيل حساب: جدوله + معدله --- */
const GRADE_POINTS = { 'A+':4.00,'A':3.75,'B+':3.50,'B':3.00,
  'C+':2.50,'C':2.00,'D+':1.50,'D':1.00,'F':0.00,'WF':0.00 };

function creditsFromCode(code) {
  const m = String(code || '').match(/(\d{4})/);
  if (m) { const d = parseInt(m[1][1], 10); if (d >= 1 && d <= 6) return d; }
  return 3;
}

async function adminUserDetail(userId) {
  const id = encodeURIComponent(userId);
  const [prof, sched, done] = await Promise.all([
    sb('GET', 'profiles',          { query: `?id=eq.${id}&select=*` }),
    sb('GET', 'user_schedule',     { query: `?user_id=eq.${id}&select=*` }),
    sb('GET', 'completed_courses', { query: `?user_id=eq.${id}&select=*` })
  ]);
  const p = (prof && prof[0]) || null;
  if (!p) return { ok: false, error: 'المستخدم غير موجود' };

  const S = Array.isArray(sched) ? sched : [];
  const D = Array.isArray(done) ? done : [];

  /* المعدل بنظام PMU */
  let pts = 0, hrs = 0, counted = 0;
  D.forEach(c => {
    const g = String(c.grade || '').toUpperCase().trim();
    if (!(g in GRADE_POINTS)) return;                 // I / W / P / TR لا تدخل
    const h = creditsFromCode(c.course_code);
    pts += GRADE_POINTS[g] * h; hrs += h; counted++;
  });

  return {
    ok: true,
    user: {
      id: p.id, name: p.name || '—', email: p.email || '—', major: p.major || '—',
      planVer: (p.plan_ver === 'old') ? 'old' : 'new',
      isPro: !!p.is_pro, active: isActive(p),
      expires: p.subscription_expires_at || null,
      telegram: p.telegram_username ? '@' + p.telegram_username : (p.telegram_chat_id ? '✓' : null)
    },
    gpa: hrs ? Number((pts / hrs).toFixed(2)) : null,
    gpaHours: hrs,
    gradedCourses: counted,
    completedCount: D.length,
    completed: D.map(c => ({ code: c.course_code, grade: c.grade || '—' }))
                .sort((a, b) => String(a.code).localeCompare(String(b.code))),
    schedule: S.map(s => ({
      crn: s.crn, code: s.course_code, section: s.section,
      slot: s.slot || 1,
      days: s.course_date, time: s.course_timing,
      room: s.room, instructor: s.instructor, term: s.term
    })),
    /* مؤشر استدلالي للتحضيري: خانة pmu_prep محفوظة في متصفح الطالب فقط
       وما توصل القاعدة، فنستدل عليها من وجود مواد التحضيري عنده. */
    prepHint: (() => {
      const isPrep = c => /^(PRP|PREE)/i.test(String(c || '').trim());
      const inDone = D.filter(c => isPrep(c.course_code)).length;
      const inSched = S.filter(s => isPrep(s.course_code)).length;
      return { done: inDone, sched: inSched, likely: inDone + inSched > 0 };
    })(),
    scheduleCredits: S.reduce((t, s) => t + creditsFromCode(s.course_code), 0)
  };
}

/* ================================================================
   ============      جدول الاختبارات النهائية      ============
   ================================================================ */

/* صفحات الجامعة. صفحة الطالبات تُضاف هنا لما نلقى رابطها. */
const FINALS_PAGES = {
  M: '/admission/final_exam_schedule_ro',
  F: '/admission/final_exam_schedule_ro?ID=2'
};

/* كاش 6 ساعات — الجدول ما يتغير كثير، وما نبي نرهق موقع الجامعة */
const finalsCache = { M: null, F: null };
const FINALS_TTL = 6 * 60 * 60 * 1000;

function fetchPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'pmu.edu.sa', path: pathname, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

/* تنظيف خلية جدول */
const cell = td => td
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

function parseFinals(html) {
  const rows = [];
  const seen = new Set();
  /* الصفوف قد تحمل خصائص (class/style)، فنسمح بها */
  for (const tr of (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
    const tds = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(cell);
    if (tds.length < 10) continue;
    const crn = tds[0];
    if (!/^\d{4,6}$/.test(crn)) continue;        // يتخطى صف العناوين
    if (seen.has(crn)) continue;
    seen.add(crn);
    rows.push({
      crn,
      code:       tds[1],
      title:      tds[2],
      section:    tds[3],
      instructor: tds[4],
      building:   tds[5],
      room:       tds[6],
      day:        tds[7],
      date:       tds[8],
      hour:       tds[9]
    });
  }
  return rows;
}

async function getOne(g) {
  const c = finalsCache[g];
  if (c && Date.now() - c.at < FINALS_TTL) return c;
  const page = FINALS_PAGES[g];
  if (!page) return { at: Date.now(), exams: [] };
  const exams = parseFinals(await fetchPage(page));
  exams.forEach(e => { e.gender = g; });
  const out = { at: Date.now(), exams };
  finalsCache[g] = out;
  return out;
}

/* نسحب جدولي الطلاب والطالبات ونضمّهم.
   الـ CRN فريد على مستوى الجامعة، فالمطابقة تظل دقيقة بدون ما نخمّن جنس الطالب. */
async function getFinals() {
  const [m, f] = await Promise.all([
    getOne('M').catch(() => ({ at: Date.now(), exams: [] })),
    getOne('F').catch(() => ({ at: Date.now(), exams: [] }))
  ]);
  const exams = m.exams.concat(f.exams);
  return {
    at: Math.min(m.at, f.at),
    exams,
    unavailable: exams.length === 0
  };
}

/* ================================================================
   ============   كاش البحث + منع الطلبات المكرّرة   ============
   ================================================================
   بدون كاش: كل ضغطة "ابحث" = سحبة من موقع الجامعة.
   900 طالب يوم التسجيل = مئات الطلبات بالدقيقة من IP واحد → حجب.
   مع الكاش: طلب واحد لكل تركيبة كل 60 ثانية مهما كان عدد الطلاب. */

/* عمر الكاش يتغيّر حسب الموسم — الجدول ما يتغيّر خارج التسجيل:
   داخل نافذة التسجيل  → دقيقة   (المقاعد تتقلب لحظياً)
   أسبوع قبلها أو بعدها → ساعة
   بقية السنة          → 6 ساعات (4 مرات باليوم) */
const TTL_PEAK = 60 * 1000;
const TTL_NEAR = 60 * 60 * 1000;
const TTL_OFF  = 6 * 60 * 60 * 1000;

/* تجاوز يدوي من لوحة التحكم — بالدقائق. null = تلقائي حسب الموسم */
let TTL_OVERRIDE = null;

/* ═══ مفاتيح تشغيل لحظية من اللوحة (بدون إعادة تشغيل الخدمة) ═══
   MONITOR_ENABLED متغيّر بيئة — تغييره يتطلب إعادة تشغيل، وهذا آخر
   شي نبيه وقت التسجيل. هذا المفتاح يوقف المراقبة فوراً بضغطة. */
let MONITOR_PAUSED = false;

/* التسخين المسبق: يجدّد نسخ الكاش المطلوبة كثيراً قبل ما تنتهي صلاحيتها،
   فما ينتظر أي طالب سحبة كاملة من موقع الجامعة.
   يبدأ مطفأً — تشغّله من اللوحة وقت الحاجة فقط. */
let PREWARM_ON = false;
const PREWARM = { runs: 0, refreshed: 0, lastAt: 0, lastKeys: [], err: null,
                  skipped: 0, lastSkip: null, on: false };

/* ═══ قياس الطلب والبطء ═══
   التسخين يكلّف سحبة من الجامعة. في الهدوء هذي تكلفة بلا مقابل —
   ولا أحد ينتظر النتيجة أصلاً. وفي الذروة هي أنفع شيء: الطالب يبحث
   فيجد نسخة جاهزة بدل ما ينتظر عشر ثوانٍ.
   فنقيس الاثنين بنافذة متحركة ونشغّله عند الحاجة فقط. */
const DEMAND = { hits: [], fetchMs: [], cached: [] };
const DEMAND_WINDOW = 10 * 60000;      /* نافذة القياس: عشر دقائق */
const DEMAND_MIN_RATE = 6;             /* أقل من 6 بحثات = هدوء، نطفيه */
const DEMAND_SLOW_RATE = 3;            /* الجامعة بطيئة: نكتفي بـ3 بحثات */
const DEMAND_BUSY_RATE = 25;           /* فوقها ذروة، نوسّع التسخين */
/* الطبيعي عند PMU من 13 إلى 18 ثانية — سحبة ثقيلة أصلاً.
   فالعتبة لازم تكون فوق الطبيعي بوضوح، وإلا صُنِّف كل شيء «بطيئاً»
   وسرت العتبة المنخفضة دائماً وفقد التمييز معناه. */
const SLOW_FETCH_MS = 25000;           /* أبطأ من 25 ثانية = تدهور فعلي */

function recordSearch(fromCache) {
  const now = Date.now();
  DEMAND.hits.push(now);
  if (fromCache) DEMAND.cached.push(now);
  const cut = now - DEMAND_WINDOW;
  while (DEMAND.hits.length && DEMAND.hits[0] < cut) DEMAND.hits.shift();
  while (DEMAND.cached.length && DEMAND.cached[0] < cut) DEMAND.cached.shift();
}
function recordFetch(ms) {
  DEMAND.fetchMs.push({ at: Date.now(), ms });
  const cut = Date.now() - DEMAND_WINDOW;
  while (DEMAND.fetchMs.length && DEMAND.fetchMs[0].at < cut) DEMAND.fetchMs.shift();
}
function demandNow() {
  const cut = Date.now() - DEMAND_WINDOW;
  const rate = DEMAND.hits.filter(t => t >= cut).length;
  const lat = DEMAND.fetchMs.filter(x => x.at >= cut);
  const avgMs = lat.length
    ? Math.round(lat.reduce((a, b) => a + b.ms, 0) / lat.length) : 0;
  const hitN = DEMAND.cached.filter(t => t >= cut).length;
  return { rate, avgMs, slow: avgMs >= SLOW_FETCH_MS,
           cached: hitN,
           hitPct: rate ? Math.round(hitN / rate * 100) : null,
           busy: rate >= DEMAND_BUSY_RATE, quiet: rate < DEMAND_MIN_RATE };
}

/* موعد الدورة القادمة — يُحدَّث مع كل جدولة، ويُعرض في اللوحة */
let NEXT_CYCLE_AT = 0;
const TTL_CHOICES = [1, 5, 15, 60, 360];   /* أزرار سريعة في اللوحة */
const TTL_MIN_ALLOWED = 1;                 /* أقل من دقيقة يعني سحب متواصل */
const TTL_MAX_ALLOWED = 24 * 60;           /* أكثر من يوم يعني بيانات بايتة */

function coursesTTL() {
  if (TTL_OVERRIDE) return TTL_OVERRIDE * 60 * 1000;
  if (currentWindow()) return TTL_PEAK;
  if (nearWindow())    return TTL_NEAR;
  return TTL_OFF;
}

/* لماذا المستوى الحالي؟ — للعرض في لوحة التحكم */
function ttlReason() {
  if (TTL_OVERRIDE)
    return { tier: 'manual', ttlMin: TTL_OVERRIDE, manual: true,
             ar: `مضبوط يدوياً من اللوحة على ${TTL_OVERRIDE} دقيقة — يتجاهل الموسم` };
  const w = currentWindow();
  if (w) return { tier: 'peak', ttlMin: 1,
                  ar: `داخل نافذة "${w.ar}" — الجدول يتغيّر لحظياً` };
  const nx = nextWindow();
  if (nearWindow()) {
    const near = MONITOR_WINDOWS.find(x =>
      riyadhDate() >= dayShift(x.from, -NEAR_DAYS) && riyadhDate() <= dayShift(x.to, NEAR_DAYS));
    return { tier: 'near', ttlMin: 60,
             ar: `ضمن ${NEAR_DAYS} أيام من نافذة "${near ? near.ar : ''}" ` +
                 `(${near ? near.from : ''} → ${near ? near.to : ''})` };
  }
  return { tier: 'off', ttlMin: 360,
           ar: 'خارج كل النوافذ' + (nx ? ` — القادمة ${nx.ar} في ${nx.from}` : '') };
}

/* لقطة عن محتوى الكاش */
function cacheSnapshot() {
  const ttl = coursesTTL(), now = Date.now();
  return [...coursesCache.entries()].map(([k, v]) => ({
    key: k,
    ageSec: Math.round((now - v.at) / 1000),
    ttlSec: Math.round(ttl / 1000),
    valid: (now - v.at) < ttl,
    courses: v.courses.length
  })).sort((a, b) => a.ageSec - b.ageSec);
}
/* ================================================================
   ====   تحديث جداول الطلاب المحفوظة من نتائج البحث   ====
   ================================================================
   الجدول المحفوظ لقطة ثابتة وقت الإضافة: لو غيّرت الجامعة الدكتور
   أو القاعة أو الوقت، يبقى الطالب يشوف القديم.
   الحل: كل ما تتحدث قائمة ALL/ALL في الذاكرة، نقارنها بالجداول
   المحفوظة بالـ CRN (رقم فريد وثابت) ونصحّح المختلف — بدون أي
   طلب إضافي على موقع الجامعة.
   الصف الواحد يُصحَّح لكل الطلاب دفعة وحدة لأن الفلترة بالـ CRN. */

let SCHED_SYNC = { at: 0, running: false, last: null, lastChange: null,
                   runs: 0, totalUpdated: 0 };
const SCHED_SYNC_GAP = 10 * 60 * 1000;   /* لا نكتب في القاعدة أكثر من مرة كل 10 دقائق */

/* سجل التغييرات: آخر 40 تصحيحاً بتفاصيلها (من → إلى).
   في الذاكرة فقط — يُصفَّر مع كل إعادة نشر على Render. */
/* ═══ عتبات قاطع الدائرة ═══
   الذروة تُبنى من أول دورة سليمة وتضيع عند إعادة التشغيل — وهذا مقصود:
   بعد إعادة التشغيل يحمينا الحد المطلق وحده حتى تُبنى ذروة جديدة. */
const FEED_PEAK = new Map();          /* ترم → أكبر عدد مواد شفناه */
/* الحد كان 900 رقماً عالمياً بينما الذروة لكل ترم — فأي بحث في ترم
   أصغر (الافتراضي 202630 مثلاً) كان يُرفض بإنذار كاذب، لأن حجمه
   الطبيعي أقل من حد مبنيّ على ترم آخر. الأرضية الآن منخفضة عمداً:
   وظيفتها منع الصفر والقائمة المهترئة فقط، والحماية الحقيقية من
   نسبة ذروة نفس الترم. */
const FEED_FLOOR = 100;
const FEED_MIN_RATIO = 0.6;           /* أقل من 60% من ذروة نفس الترم = مشبوه */

/* ═══ تأكيد التغييرات ═══
   المزامنة كل 10 دقائق، فنافذة 15 تضمن رصدتين على الأقل.
   الشرطان معاً: مضى الوقت، وشفناه مرتين — الوقت وحده ما يكفي
   لو تأخّرت دورة، والعدّ وحده ما يكفي لو تسارعت. */
const CONFIRM_AFTER = 15 * 60 * 1000;
const CONFIRM_TICK = 5 * 60 * 1000;            /* كل كم نفحص الطابور */
const PENDING_MAX_AGE = 24 * 60 * 60 * 1000;   /* صفّ ما نضج خلال يوم = عالق */
const CONFIRM_MIN_SIGHTINGS = 2;

/* بصمة مستقرة للفروق — الترتيب مثبّت عشان نفس التغيير يعطي نفس البصمة */
function fingerprint(fields) {
  return (fields || [])
    .map(f => `${f.field}:${String(f.from || '')}>${String(f.to || '')}`)
    .sort()
    .join('|');
}

/* الرفّات المرفوضة — دليلك على أن الانتظار كان يستحق */
const UNWATCH_LOG = [];    /* إلغاءات المراقبة — تُستعاد عند الإقلاع */
const FLAP_LOG = [];
const FLAP_LOG_MAX = 60;

/* ما ينتظر التأكيد الآن، مع كم بقي له */
async function pendingSnapshot() {
  const rows = await sb('GET', 'pending_changes', {
    query: '?select=*&order=first_seen.asc&limit=40'
  }).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map(p => {
    const age = Date.now() - new Date(p.first_seen).getTime();
    return {
      crn: p.crn, code: p.course_code, fields: p.fields,
      seen: p.seen_count, ageMin: Math.round(age / 60000),
      leftMin: Math.max(0, Math.ceil((CONFIRM_AFTER - age) / 60000)),
      ready: age >= CONFIRM_AFTER && p.seen_count >= CONFIRM_MIN_SIGHTINGS
    };
  });
}

/* تهريب لوسوم تيليغرام — أسماء الدكاترة والقاعات تجي من الجامعة،
   و'&' وحدها في اسم كافية لتفشل الرسالة كلها بخطأ parse_mode. */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ═══ كشف التعارض في السيرفر ═══
   نسخة مطابقة لمنطق الصفحة. تغيّر الوقت قد يخلق تصادماً مع مادة
   ثانية في جدول الطالب وهو لا يدري — وهذا أخطر من تغيّر الدكتور. */
function schedDays(s) {
  return String(s || '').toUpperCase().split('').filter(c => 'UMTWRFS'.includes(c));
}
function schedTime(s) {
  const m = String(s || '').match(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/);
  return m ? { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] } : null;
}
function schedClash(a, b) {
  const da = schedDays(a.courseDate || a.course_date);
  const db = schedDays(b.courseDate || b.course_date);
  if (!da.some(d => db.includes(d))) return false;
  const ta = schedTime(a.courseTiming || a.course_timing);
  const tb = schedTime(b.courseTiming || b.course_timing);
  if (!ta || !tb) return false;
  return ta.start < tb.end && tb.start < ta.end;
}

/* ═══ إشعار تغيّر الجدول ═══
   يُرسل بعد التأكيد فقط. التغيير يمسّ كل من في جدوله تلك الشعبة،
   فنجمّع لكل طالب رسالة واحدة مهما تعددت مواده المتغيّرة في الدورة. */
/* ═══ حد العاصفة ═══
   نسبة لا رقم ثابت: الرقم الثابت يشيخ مع نمو المستخدمين — 100 اليوم
   ثلثا طلابك، وبعد سنة قد تكون خُمسهم فيصير الحد بلا معنى.
   القاعدة: عدد الطلاب أصحاب الجداول في هذا الترم × النسبة.
   والأرضية تمنع التوتر الزائد وقت قلة المستخدمين (60% من 10 = 6). */
const NOTIFY_RATIO = 0.6;
const NOTIFY_FLOOR = 25;
function notifyCap(activeStudents) {
  return Math.max(NOTIFY_FLOOR, Math.round((activeStudents || 0) * NOTIFY_RATIO));
}
let LAST_CAP = NOTIFY_FLOOR;        /* آخر حد محسوب — للعرض في اللوحة */

/* موافقة يدوية لمرة واحدة: تراجع العاصفة في اللوحة، وإن طلعت
   صحيحة تضغط «وافق وأرسل» فتمر الدورة التالية بلا حد.
   النافذة قصيرة عمداً — الموافقة تخص ما رأيته لا ما يجي بعد ساعات. */
const STORM_OK = { until: 0, affected: 0 };
const STORM_OK_WINDOW = 30 * 60 * 1000;

async function notifyChanges(list, stat) {
  if (!list.length) return;

  /* الصمّام صار يقرر قبل الكتابة داخل syncSchedules، فما نصل هنا
     أصلاً في العاصفة. نتركه هنا كشبكة أخيرة لا أكثر. */
  if (list.length > LAST_CAP * 2) {
    stat.notifySuppressed = list.length;
    console.log(`notifyChanges: ${list.length} إشعاراً — كُبت احتياطياً`);
    return;
  }

  /* من user_id إلى محادثة تيليغرام — استعلام واحد */
  const ids = [...new Set(list.map(x => x.userId))].filter(isUuid);
  if (!ids.length) return;
  const profs = await sb('GET', 'profiles', {
    query: `?id=in.(${ids.join(',')})&select=id,name,telegram_chat_id`
  }).catch(() => []);
  const chat = new Map();
  (Array.isArray(profs) ? profs : []).forEach(p => {
    /* من كتب /stop انمسح رقمه، فالاحترام تلقائي */
    if (p.telegram_chat_id) chat.set(p.id, String(p.telegram_chat_id));
  });

  /* رسالة واحدة لكل طالب */
  /* نجمّع بـchat_id لا بـuser_id: لو ارتبط رقم واحد بحسابين — وقد
     حصل فعلاً — فالتجميع بالحساب يرسل رسالتين متطابقتين لنفس الشخص.
     والبصمة تمنع تكرار نفس المادة داخل الرسالة الواحدة. */
  const byChat = new Map();
  const seen = new Set();
  list.forEach(x => {
    const cid = chat.get(x.userId);
    if (!cid) return;
    const sig = cid + '|' + x.code + '|' + x.section + '|' +
      (x.fields || []).map(f => `${f.field}:${f.from}>${f.to}`).sort().join(',');
    if (seen.has(sig)) return;
    seen.add(sig);
    if (!byChat.has(cid)) byChat.set(cid, []);
    byChat.get(cid).push(x);
  });
  stat.notified = 0;

  for (const [cid, items] of byChat) {
    const body = items.map(it => {
      /* بلا سهم: القيم لاتينية والوصف عربي، فاتجاه القراءة ينقلب
         بصرياً ولا يعرف الطالب أيهما القديم. سطران وكلام صريح
         يزيلان اللبس، وما فيه شطب يعتمد عليه الفهم. */
      const lines = it.fields.map(f => {
        const from = esc(f.from || '—'), to = esc(f.to || '—');
        /* الدكتور مذكّر والقاعة والمادة مؤنثة — الصياغة الموحّدة تطلع ركيكة */
        const m = f.field === 'instructor';
        /* خانة كانت فاضية ثم تحدّدت — خبر لا تحذير */
        if (!f.from || f.from === '—')
          return `${f.ar || f.field}: ${m ? 'تحدّد' : 'تحدّدت'} — <b>${to}</b>`;
        /* والعكس: الجامعة شالت القيمة ولا حطّت بديلاً.
           «صار: —» ما تفهم، فنقولها بوضوح. */
        if (!f.to || f.to === '—')
          return `${f.ar || f.field}: <s>${from}</s>\n` +
                 `   ⚠️ ${m ? 'انشال ولا فيه بديل معلَن بعد' : 'انشالت ولا فيه بديل معلَن بعد'}`;
        return `${f.ar || f.field}\n` +
               `   ${m ? 'كان' : 'كانت'}: <s>${from}</s>\n` +
               `   ${m ? 'صار' : 'صارت'}: <b>${to}</b>`;
      });
      const cl = it.clashes && it.clashes.length
        ? `\n⚠️ <b>صار يتعارض مع ${it.clashes.map(esc).join('، ')}</b>` : '';
      return `📌 <b>${esc(it.code)} §${esc(it.section)}</b>\n` + lines.join('\n') + cl;
    }).join('\n\n');

    const r = await sendMsg(cid,
      `🔔 <b>تغيّر في جدولك</b>\n\n${body}\n\n` +
      `التغيير من نظام الجامعة · راجع جدولك في jadwalik.com`);
    if (r && r.ok) stat.notified++;
    await new Promise(x => setTimeout(x, 700));   /* تهدئة مثل إشعارات الشعب */
  }
}

/* ═══ سجل إلغاء المراقبة ═══
   الحذف كان يمحو الصفّ بلا أثر، فما نعرف كم يلغي ولا من أين.
   والمصدر أهم من العدد: من يلغي من تلقرام عرف الطريق (الزر أمامه)،
   ومن يلغي من الموقع بحث عنه — والفرق يقول أين يحتاج الطلاب توجيهاً.
   بلا await: التسجيل ما يؤخّر الإلغاء ولا يفشله. */
function logUnwatch(rows, via) {
  if (!EVENTS_READY) return;
  (Array.isArray(rows) ? rows : [rows]).forEach(r => {
    if (!r) return;
    const born = r.created_at ? new Date(r.created_at).getTime() : 0;
    const ev = {
      at: Date.now(), via,
      userId: r.user_id || null,
      code: r.course_code || null,
      crn: r.crn || null,
      scope: r.scope === 'course' ? 'course' : 'section',
      lastStatus: r.last_status || null,
      /* كم عاشت المراقبة قبل الإلغاء — يفرّق بين «جرّب وتراجع»
         و«راقب أسابيع ثم سجّل» */
      livedMin: born ? Math.round((Date.now() - born) / 60000) : null
    };
    UNWATCH_LOG.unshift(ev);
    if (UNWATCH_LOG.length > 200) UNWATCH_LOG.length = 200;
    logEvent('unwatch', ev);
  });
}

const SCHED_LOG = [];
const SCHED_LOG_MAX = 40;
const FIELD_AR = {
  course_title: 'اسم المادة', course_date: 'الأيام',
  course_timing: 'الوقت', instructor: 'الدكتور', room: 'القاعة'
};

/* توزيع الجنس من رقم الشعبة: 1xx طلاب · 2xx طالبات — قاعدة الجامعة الثابتة.
   لازم تُطبَّق على أي قائمة تدخل كاش البحث، سواء جت من بحث الطالب
   أو من دورة المراقبة، وإلا اختفت علامة طلاب/طالبات عشوائياً. */
function tagGender(courses, gender) {
  const forced = gender === 'F1' ? 'F' : gender === 'M1' ? 'M' : null;
  (courses || []).forEach(c => {
    if (forced) { c.gender = forced; return; }
    const sec = String(c.section || '').trim();
    c.gender = /^2/.test(sec) ? 'F' : /^1/.test(sec) ? 'M' : null;
  });
  return courses;
}

async function syncSchedules(term, courses, force) {
  /* ═══ ترم واحد فقط ═══
     الجامعة تعيد استخدام أرقام CRN بين الترمات، فصفّ طالب من ترم قديم
     بـCRN 10655 قد يطابق شعبة مختلفة تماماً بنفس الرقم في الترم الجديد.
     المزامنة تربط بالـCRN، فلو انطلقت لترم غير النشط كتبت دكتور مادة
     على مادة أخرى وأرسلت «تغيّر في جدولك» عن شيء ما تغيّر.
     البحث يبقى حراً في كل الترمات — التصحيح والإشعارات وحدها محصورة. */
  if (String(term).trim() !== ACTIVE_TERM) {
    SCHED_SYNC.skippedTerms = (SCHED_SYNC.skippedTerms || 0) + 1;
    return null;
  }
  if (SCHED_SYNC.running) return null;
  if (!force && Date.now() - SCHED_SYNC.at < SCHED_SYNC_GAP) return null;
  SCHED_SYNC.running = true;
  SCHED_SYNC.at = Date.now();

  const stat = { at: Date.now(), term, rows: 0, changed: 0, updated: 0,
                 missing: 0, error: null, ms: 0 };
  const t0 = Date.now();
  try {
    /* ═══ قاطع الدائرة ═══
       أخطر حالة ليست فشل الاتصال — الفشل يرمي استثناءً فلا نصل هنا أصلاً.
       الخطر أن يرجع الطلب "بنجاح" بصفحة صيانة أو جلسة منتهية أو تحليل ناقص،
       فتطلع القائمة فارغة أو نصفها، ونعلّم جداول الطلاب كلها كمفقودة.
       القاعدة تشفى ذاتياً في الدورة التالية — لكن رسالة تيليغرام لا تُسحب.
       فنرفض العمل بالكامل بدل ما نكتب شيئاً مشكوكاً فيه. */
    const feedN = Array.isArray(courses) ? courses.length : 0;
    const peak = FEED_PEAK.get(term) || 0;

    /* ترم ما شفناه من قبل: لا نملك مرجعاً نحكم به. الرفض إنذار كاذب،
       والقبول ثقة عمياء. فنسجّل الذروة ونمتنع عن الكتابة هذي المرة —
       الدورة الجاية تملك مرجعاً وتقرر. تكلفتها تأخير واحد لكل ترم جديد. */
    if (!peak && feedN >= FEED_FLOOR) {
      FEED_PEAK.set(term, feedN);
      stat.feedN = feedN; stat.feedPeak = feedN; stat.feedFirstSeen = true;
      console.log(`syncSchedules: ترم جديد ${term} — سجّلنا ${feedN} مادة كمرجع، ` +
                  `والمزامنة تبدأ الدورة الجاية`);
      return stat;
    }

    const tooSmall = feedN < FEED_FLOOR || (peak > 0 && feedN < peak * FEED_MIN_RATIO);
    if (tooSmall) {
      stat.error = `تغذية مشبوهة: ${feedN} مادة` +
                   (peak ? ` مقابل ذروة ${peak}` : ' (لا ذروة مسجّلة بعد)') +
                   ' — أُلغيت المزامنة';
      stat.feedRejected = feedN;
      console.log('syncSchedules: ' + stat.error);
      alert('feed', 'تغذية الجامعة ناقصة — أوقفنا المزامنة',
        `وصلتنا ${feedN} مادة فقط للترم ${term}` +
        (peak ? `، والذروة المسجّلة ${peak}.` : '، ولا ذروة مسجّلة بعد.') +
        `\n\nما كتبنا شيئاً على جداول الطلاب. المزامنة بتحاول تلقائياً في الدورة الجاية.`);
      return stat;                       /* الـfinally يفكّ القفل */
    }
    if (feedN > peak) FEED_PEAK.set(term, feedN);
    stat.feedN = feedN; stat.feedPeak = FEED_PEAK.get(term);
    if (peak && feedN >= peak * FEED_MIN_RATIO) resolve('feed', 'تغذية الجامعة');

    /* المادة قد تجي بجلستين بنفس الـCRN (محاضرة + معمل) وأيام مختلفة.
       لو للـCRN جلسة وحدة نطابق بالـCRN وحده — فنمسك حتى تغيّر اليوم.
       ولو له أكثر من جلسة نطابق بالـCRN + الأيام + الوقت، وما نخمّن أبداً:
       الجلسة اللي ما نلقى لها مثيلاً نتركها كما هي بدل ما نكتب فوقها غلط. */
    const byCrn = new Map();                       /* CRN → [جلسات] */
    (courses || []).forEach(c => {
      const k = String(c.crn || '').trim();
      if (!byCrn.has(k)) byCrn.set(k, []);
      byCrn.get(k).push(c);
    });
    const sessionKey = (d, t) =>
      String(d || '').trim() + '|' + String(t || '').trim();
    const live = new Map();                        /* مفتاح → مادة */
    for (const [crn, list] of byCrn) {
      if (list.length === 1) { live.set(crn, list[0]); continue; }
      for (const c of list)
        live.set(crn + '#' + sessionKey(c.courseDate, c.courseTiming), c);
    }
    const lookup = r => {
      const crn = String(r.crn || '').trim();
      const list = byCrn.get(crn);
      if (!list) return null;                      /* شعبة مو موجودة أصلاً */
      if (list.length === 1) return list[0];
      return live.get(crn + '#' + sessionKey(r.course_date, r.course_timing)) || 'skip';
    };

    const rows = await sbAll('user_schedule', {
      query: `?term=eq.${encodeURIComponent(term)}` +
             `&select=user_id,crn,section,course_code,course_title,` +
             `course_date,course_timing,instructor,room`
    });
    if (!Array.isArray(rows) || !rows.length) return stat;
    stat.rows = rows.length;

    /* جدول كل طالب كاملاً — نحتاجه لكشف التعارض الصامت عند تغيّر الوقت.
       مبني من نفس الصفوف المسحوبة، فلا استعلام إضافي. */
    const byUser = new Map();
    for (const r of rows) {
      if (!r.user_id) continue;
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r);
    }

    /* CRN → البيانات الحية، فقط للصفوف اللي فعلاً مختلفة */
    const stale = new Map();
    const diffs = new Map();
    /* تتبّع صامت: نعلّم الصفوف المتغيّرة والشعب المفقودة في القاعدة.
       ما يظهر للطالب شي في هذي المرحلة — نجمع بيانات موثوقة أولاً. */
    const missingCrns = new Set();
    const presentCrns = new Set();                       /* CRN → تفاصيل الفروق */
    const same = (a, b) => String(a || '').trim() === String(b || '').trim();
    const missingList = [];
    for (const r of rows) {
      const crn = String(r.crn || '').trim();
      const c = lookup(r);
      if (c === 'skip') { stat.skipped = (stat.skipped || 0) + 1; continue; }
      if (!c) {                                    /* شعبة انحذفت من الجامعة — ما نلمسها */
        stat.missing++;
        if (!missingList.some(m => m.crn === crn))
          missingList.push({ crn, code: r.course_code || '', title: r.course_title || '' });
        missingCrns.add(crn);
        continue;
      }
      presentCrns.add(crn);
      const pairs = [
        ['course_title', r.course_title, c.courseTitle],
        ['course_date', r.course_date, c.courseDate],
        ['course_timing', r.course_timing, c.courseTiming],
        ['instructor', r.instructor, c.instructor],
        ['room', r.room, c.room]
      ];
      const changed = pairs.filter(([, a, b]) => !same(a, b))
        .map(([f, a, b]) => ({ field: f, ar: FIELD_AR[f] || f,
                               from: String(a || '—'), to: String(b || '—') }));
      if (!changed.length) continue;
      /* المفتاح: للجلسة الواحدة CRN فقط، وللمتعددة CRN + أيامها ووقتها،
         عشان التحديث ما يكتب فوق الجلسة الثانية. */
      const multi = (byCrn.get(crn) || []).length > 1;
      const key = multi ? crn + '#' + sessionKey(r.course_date, r.course_timing) : crn;
      if (!stale.has(key)) stale.set(key, {
        crn, course: c,
        scope: multi ? { date: r.course_date, timing: r.course_timing } : null
      });
      if (!diffs.has(key))
        diffs.set(key, { crn, code: r.course_code || c.courseCode || '', fields: changed });
    }
    stat.changed = stale.size;
    stat.missingList = missingList.slice(0, 20);

    /* نعلّم الشعبة المفقودة أول مرة فقط (missing_since فاضي)،
       ونمسح العلامة عن أي شعبة رجعت — كتابتان محدودتان لا أكثر. */
    const enc = encodeURIComponent;
    /* أرقام فقط — الصفوف يكتبها الطالب، فقيمة مصنوعة تكسر الفلتر */
    const missingSafe = numList(missingCrns);
    const presentSafe = numList(presentCrns);
    stat.crnRejected = (missingCrns.size + presentCrns.size)
                     - (missingSafe.length + presentSafe.length);
    if (missingSafe.length) {
      const list = inList(missingSafe);
      await sb('PATCH', 'user_schedule', {
        query: `?term=eq.${enc(term)}&crn=in.(${list})&missing_since=is.null`,
        body: { missing_since: new Date().toISOString() },
        prefer: 'return=minimal'
      }).catch(() => {});
      stat.markedMissing = missingSafe.length;
    }
    if (presentSafe.length) {
      const list = inList(presentSafe);
      await sb('PATCH', 'user_schedule', {
        query: `?term=eq.${enc(term)}&crn=in.(${list})&missing_since=not.is.null`,
        body: { missing_since: null },
        prefer: 'return=minimal'
      }).catch(() => {});
    }

    /* ═══ طابور التأكيد ═══
       التغيير ما يُطبَّق أول ما نشوفه. نسجّله وننتظر رصدة ثانية
       بعد CONFIRM_AFTER. الفرق الذي يختفي بينهما كان رفّة في بيانات
       الجامعة، ونرميه بلا أثر. قاطع الدائرة يمسك الانهيار الكامل،
       وهذا يمسك الرفّة الصغيرة التي تعبره. */
    const pend = await sb('GET', 'pending_changes', {
      query: `?term=eq.${enc(term)}&select=*`
    }).catch(() => []);
    const pendBy = new Map();
    (Array.isArray(pend) ? pend : []).forEach(p =>
      pendBy.set(String(p.crn) + '|' + String(p.session_key || ''), p));

    const nowIso = new Date().toISOString();
    const seenKeys = new Set();
    stat.pendingNew = 0; stat.pendingWaiting = 0; stat.confirmed = 0; stat.discarded = 0;
    const notifyList = [];

    /* ═══ صمّام العاصفة — يقرر قبل أي كتابة ═══
       كان يكبت الرسائل بعد ما تتم الكتابة، فيصمت تيليغرام
       ويظل الموقع يعرض التحذير الخاطئ لكل طالب — حماية نصف.
       الآن نحصي المتأثرين أولاً: لو تجاوزوا الحد لا نكتب ولا نرسل،
       والصفوف تبقى في الطابور فتُعاد المحاولة بعد ما تفحصها. */
    let stormAbort = 0;
    {
      let affected = 0;
      for (const [key, item] of stale) {
        const d0 = diffs.get(key);
        if (!d0) continue;
        const pk = String(item.crn) + '|' +
          (item.scope ? sessionKey(item.scope.date, item.scope.timing) : '');
        const prev = pendBy.get(pk);
        if (!prev || prev.fingerprint !== fingerprint(d0.fields)) continue;
        const age = Date.now() - new Date(prev.first_seen).getTime();
        if (age < CONFIRM_AFTER || (prev.seen_count + 1) < CONFIRM_MIN_SIGHTINGS) continue;
        /* ناضج — كم طالباً يمسّه؟ نعدّ كل الطلاب لا المربوطين بتيليغرام،
           فالتحذير في الصفحة يصل الجميع والمربوطون أقل من ربعهم. */
        affected += rows.filter(r =>
          String(r.crn || '').trim() === String(item.crn).trim() &&
          (!item.scope ||
            (same(r.course_date, item.scope.date) &&
             same(r.course_timing, item.scope.timing)))).length;
      }
      const cap = notifyCap(byUser.size);
      LAST_CAP = cap;
      stat.notifyCap = cap; stat.activeStudents = byUser.size;
      const approved = Date.now() < STORM_OK.until;
      if (affected > cap && !approved) {
        stormAbort = affected;
        stat.stormAbort = affected;
        console.log(`syncSchedules: ${affected} طالباً متأثراً — تجاوز ${cap}، أُلغي التأكيد`);
        alert('notify-storm', '⛔️ عاصفة تغييرات — أوقفنا كل شيء',
          `دورة واحدة كانت بتغيّر جداول ${affected} طالباً من ${byUser.size}، ` +
          `والحد ${cap}.\n\n` +
          `ما كتبنا شيئاً وما أرسلنا رسالة. الصفوف باقية في طابور التأكيد.\n\n` +
          `افتح اللوحة › النظام › طابور التأكيد. لو راجعتها وطلعت صحيحة ` +
          `اضغط «وافق وأرسل» وتمر الدورة الجاية.`);
      } else {
        if (affected > cap && approved) {
          stat.stormApproved = affected;
          STORM_OK.until = 0;                  /* الموافقة تُستهلك مرة واحدة */
          console.log(`syncSchedules: عاصفة ${affected} مرّت بموافقتك`);
        }
        if (affected) resolve('notify-storm', 'عاصفة التغييرات');
      }
    }

    for (const [key, item] of stale) {
      const c = item.course;
      const d0 = diffs.get(key);
      if (!d0) continue;
      const sessKey = item.scope
        ? sessionKey(item.scope.date, item.scope.timing) : '';
      const pk = String(item.crn) + '|' + sessKey;
      seenKeys.add(pk);
      const fp = fingerprint(d0.fields);
      const prev = pendBy.get(pk);

      /* أول رصدة، أو تغيّر التغيير نفسه → نبدأ العدّ من جديد */
      if (!prev || prev.fingerprint !== fp) {
        await sb(prev ? 'PATCH' : 'POST', 'pending_changes', {
          query: prev ? `?id=eq.${enc(prev.id)}` : '',
          body: prev
            ? { fields: d0.fields, fingerprint: fp, first_seen: nowIso,
                last_seen: nowIso, seen_count: 1, course_code: d0.code }
            : { term, crn: String(item.crn), session_key: sessKey,
                course_code: d0.code, fields: d0.fields, fingerprint: fp },
          prefer: 'return=minimal'
        }).catch(() => {});
        stat.pendingNew++;
        continue;
      }

      /* نفس الفرق — هل نضج؟ (والعاصفة تُبقيه منتظراً بدل ما نكتب) */
      const age = Date.now() - new Date(prev.first_seen).getTime();
      if (stormAbort ||
          age < CONFIRM_AFTER || (prev.seen_count + 1) < CONFIRM_MIN_SIGHTINGS) {
        await sb('PATCH', 'pending_changes', {
          query: `?id=eq.${enc(prev.id)}`,
          body: { last_seen: nowIso, seen_count: prev.seen_count + 1 },
          prefer: 'return=minimal'
        }).catch(() => {});
        stat.pendingWaiting++;
        continue;
      }

      /* مؤكَّد — الآن فقط نكتب على جدول الطالب */
      let q = `?term=eq.${enc(term)}&crn=eq.${enc(item.crn)}`;
      if (item.scope) {                            /* جلسة بعينها لا كل جلسات الـCRN */
        q += `&course_date=eq.${enc(item.scope.date || '')}` +
             `&course_timing=eq.${enc(item.scope.timing || '')}`;
      }
      await sb('PATCH', 'user_schedule', {
        query: q,
        body: {
          course_title: c.courseTitle, course_date: c.courseDate,
          course_timing: c.courseTiming, instructor: c.instructor, room: c.room,
          changed_at: nowIso,
          change_note: { at: Date.now(), fields: d0.fields,
                         confirmedAfterMin: Math.round(age / 60000) }
        },
        prefer: 'return=minimal'
      });
      await sb('DELETE', 'pending_changes', {
        query: `?id=eq.${enc(prev.id)}`, prefer: 'return=minimal'
      }).catch(() => {});
      stat.updated++; stat.confirmed++;

      /* من يملك هذي الشعبة؟ من الصفوف المسحوبة أصلاً — بلا استعلام إضافي */
      const owners = rows.filter(r =>
        String(r.crn || '').trim() === String(item.crn).trim() &&
        (!item.scope ||
          (same(r.course_date, item.scope.date) && same(r.course_timing, item.scope.timing))));
      const moved = d0.fields.some(f =>
        f.field === 'course_timing' || f.field === 'course_date');
      for (const o of owners) {
        if (!o.user_id) continue;
        /* التعارض يُحسب بالوقت الجديد ضد بقية جدوله */
        const others = (byUser.get(o.user_id) || []).filter(x =>
          !(String(x.crn).trim() === String(o.crn).trim() &&
            same(x.course_date, o.course_date) && same(x.course_timing, o.course_timing)));
        const clashes = moved
          ? others.filter(x => schedClash(c, x))
                  .map(x => `${x.course_code} §${x.section}`)
          : [];
        notifyList.push({ userId: o.user_id, code: o.course_code || d0.code,
                          section: o.section || '—', fields: d0.fields, clashes });
      }
      const corr = { at: Date.now(), term, confirmed: true,
                     waitedMin: Math.round(age / 60000), ...d0 };
      SCHED_LOG.unshift(corr);
      if (EVENTS_READY) logEvent('correction', corr);
      await new Promise(r => setTimeout(r, 150));   /* ما نضغط على Supabase */
    }

    /* الفرق الذي اختفى قبل أن ينضج = رفّة. نرميه ونسجّلها لك.
       شرط: الشعبة موجودة في التغذية — وإلا فغيابها سبب آخر لا نحكم عليه. */
    for (const [pk, p] of pendBy) {
      if (seenKeys.has(pk)) continue;
      if (!presentCrns.has(String(p.crn))) continue;
      await sb('DELETE', 'pending_changes', {
        query: `?id=eq.${enc(p.id)}`, prefer: 'return=minimal'
      }).catch(() => {});
      stat.discarded++;
      const flap = { at: Date.now(), term, crn: p.crn,
        code: p.course_code, fields: p.fields,
        livedMin: Math.round((Date.now() - new Date(p.first_seen).getTime()) / 60000) };
      FLAP_LOG.unshift(flap);
      if (EVENTS_READY) logEvent('flap', flap);
      if (FLAP_LOG.length > FLAP_LOG_MAX) FLAP_LOG.length = FLAP_LOG_MAX;
    }

    /* الإرسال بعد اكتمال الكتابة كلها — لو انكسر شيء في المنتصف
       ما نكون أرسلنا نصف الطلاب خبراً وتركنا القاعدة ناقصة. */
    await notifyChanges(notifyList, stat).catch(e =>
      console.log('notifyChanges: ' + (e && e.message)));
    if (SCHED_LOG.length > SCHED_LOG_MAX) SCHED_LOG.length = SCHED_LOG_MAX;
  } catch (e) {
    stat.error = e.message;
  } finally {
    stat.ms = Date.now() - t0;
    SCHED_SYNC.running = false;
    SCHED_SYNC.last = stat;
    SCHED_SYNC.runs++;
    /* نحتفظ بآخر جولة صحّحت شيئاً — الجولات الفاضية تطمس المفيد */
    if (stat.updated > 0) {
      SCHED_SYNC.lastChange = stat;
      SCHED_SYNC.totalUpdated += stat.updated;
    }
  }
  return stat;
}

const RESP_CACHE = new Map();   /* مفتاح → {at, raw, gz} — البايتات الجاهزة للإرسال */
const coursesCache = new Map();     // key → {at, courses}
const inFlight     = new Map();     // key → Promise (يمنع سحبتين متزامنتين لنفس التركيبة)

async function getCourses(term, college, gender, force) {
  const key = `${term}|${college}|${gender}`;
  /* التسخين وساعة التأكيد ينادياها بـforce — وهي ليست بحث طالب.
     كانت تُحسب في المقام بلا أن تدخل البسط (force يتجاوز فرع الكاش)،
     فيبدو التسخين وكأنه يُنقص نسبة الخدمة من الكاش لا يرفعها. */
  if (!force) OPS.searches++;
  const TTL = coursesTTL();
  const hit = coursesCache.get(key);
  if (hit && !force && Date.now() - hit.at < TTL) {
    hit.lastHit = Date.now();          /* لمعرفة أي التركيبات تستحق التسخين */
    OPS.searchesCached++;
    if (!force) recordSearch(true);
    return { courses: hit.courses, cached: true, age: Date.now() - hit.at, at: hit.at };
  }

  /* لو فيه سحبة جارية لنفس التركيبة، ننتظرها بدل ما نبدأ وحدة جديدة.
     هذي تمنع 50 طالب يضغطون "ابحث" بنفس اللحظة من إطلاق 50 سحبة. */
  if (inFlight.has(key)) {
    OPS.searchesCached++;
    if (!force) recordSearch(true);
    const courses = await inFlight.get(key);
    const h2 = coursesCache.get(key);
    return { courses, cached: true, age: 0, at: (h2 && h2.at) || Date.now() };
  }

  const p = (async () => {
    /* سحبة واحدة بـ ALL، ونوزّع الجنس من رقم الشعبة:
       1xx = طلاب · 2xx = طالبات — قاعدة الجامعة الثابتة.
       أوفر من سحبتين منفصلتين، وأدق من التخمين من القاعة. */
    const courses = tagGender(parseHTML(await fetchPMUData(term, college, gender)), gender);
    coursesCache.set(key, { at: Date.now(), lastHit: (hit && hit.lastHit) || Date.now(), courses });
    resolve('search', 'البحث ما يشتغل');
    /* قائمة ALL/ALL هي الأشمل — نصحّح بها جداول الطلاب المحفوظة */
    if (college === 'ALL' && gender === 'ALL')
      syncSchedules(term, courses).catch(() => {});
    if (coursesCache.size > 40) {                     /* تنظيف بسيط */
      const oldest = [...coursesCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) coursesCache.delete(oldest[0]);
    }
    return courses;
  })();

  inFlight.set(key, p);
  if (!force) recordSearch(false);
  try {
    const t0 = Date.now();
    const courses = await p;
    recordFetch(Date.now() - t0);
    const h3 = coursesCache.get(key);
    return { courses, cached: false, age: 0, at: (h3 && h3.at) || Date.now() };
  }
  finally { inFlight.delete(key); }
}

/* ================================================================
   ============   جدولة ذكية للمراقبة   ============
   ================================================================
   بدل الفحص كل 5 دقائق على مدار السنة، نفحص بكثافة في أوقات
   التسجيل والحذف والإضافة فقط، ونهدأ في بقية الأوقات.
   يقلّل الطلبات على موقع الجامعة بأكثر من 90% سنوياً. */

/* نوافذ التسجيل من التقويم الأكاديمي المعتمد (تشمل يومين احتياط قبل وبعد) */
const MONITOR_WINDOWS = [
  { from: '2026-08-23', to: '2026-09-10', ar: 'تسجيل الترم الأول' },
  { from: '2027-01-08', to: '2027-01-28', ar: 'تسجيل الترم الثاني' },
  { from: '2027-04-09', to: '2027-04-17', ar: 'التسجيل المبكر للصيفي' },
  { from: '2027-06-13', to: '2027-06-22', ar: 'تسجيل الصيفي' }
];

const ACTIVE_FROM_DEFAULT = 7;    // 7 صباحاً بتوقيت الرياض
const ACTIVE_TO_DEFAULT   = 24;   // حتى منتصف الليل

/* تُعدَّل من اللوحة بدون إعادة تشغيل. null = القيمة الافتراضية.
   تُصفَّر مع كل إعادة نشر على Render. */
let HOURS_OVERRIDE = null;        // {from, to}
let WINDOW_OVERRIDE = null;       // {from:'YYYY-MM-DD', to:'YYYY-MM-DD', ar}

const activeFrom = () => HOURS_OVERRIDE ? HOURS_OVERRIDE.from : ACTIVE_FROM_DEFAULT;
const activeTo   = () => HOURS_OVERRIDE ? HOURS_OVERRIDE.to   : ACTIVE_TO_DEFAULT;

const INTERVAL_PEAK = 5 * 60 * 1000;    // داخل نافذة التسجيل
const JITTER        = 0.25;             // ±25% تفادياً لنمط منتظم تماماً

/* خارج نوافذ التسجيل المراقبة تتوقف تماماً.
   لو حبيت ترجّعها مخفّفة، حط هنا مثلاً 30*60*1000 بدل null. */
const INTERVAL_IDLE = null;

/* هامش "قرب التسجيل" — يستخدمه كاش البحث */
const NEAR_DAYS = 7;

/* ساعة الرياض (السيرفر يعمل بتوقيت UTC) */
function riyadhNow() {
  return new Date(Date.now() + 3 * 3600 * 1000);
}
function riyadhHour() { return riyadhNow().getUTCHours(); }
/* الساعة بالدقائق «6:30» — اللوحة كانت تعرض 6 فقط */
function riyadhTime() {
  const d = riyadhNow();
  return d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}
function riyadhDate() { return riyadhNow().toISOString().slice(0, 10); }

function windowList() {
  /* نافذة يدوية من اللوحة تتقدّم على قائمة التقويم */
  return WINDOW_OVERRIDE ? [WINDOW_OVERRIDE] : MONITOR_WINDOWS;
}
function currentWindow() {
  const d = riyadhDate();
  return windowList().find(w => d >= w.from && d <= w.to) || null;
}
function nextWindow() {
  const d = riyadhDate();
  return windowList().find(w => d < w.from) || null;
}
const dayShift = (iso, n) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/* هل نحن خلال أسبوع قبل نافذة تسجيل أو أسبوع بعدها؟ */
function nearWindow() {
  const d = riyadhDate();
  return MONITOR_WINDOWS.some(w =>
    d >= dayShift(w.from, -NEAR_DAYS) && d <= dayShift(w.to, NEAR_DAYS));
}

/* ═══ التسخين المسبق ═══
   يجدّد نسخ الكاش الأكثر طلباً قبل ما تنتهي صلاحيتها بقليل، فيلقى
   الطالب النتيجة جاهزة بدل ما ينتظر سحبة كاملة من موقع الجامعة.
   يتبع مدة الصلاحية الفعلية — بما فيها القيمة اليدوية من اللوحة. */
const PREWARM_MAX_KEYS = 3;          /* أكثر ثلاث تركيبات طلباً فقط */
const PREWARM_RECENT   = 30 * 60000; /* تركيبة ما طُلبت منذ نصف ساعة نتركها */

async function prewarmTick() {
  if (!PREWARM_ON) return;
  if (!MONITOR_ENABLED) return;

  /* ═══ القرار: نشتغل أو نطفي ═══
     في الهدوء التسخين سحبة من الجامعة لا ينتظرها أحد — نطفيه.
     وفي الذروة، أو لما تصير الجامعة بطيئة، هو أنفع شيء: الطالب
     يلقى نسخة جاهزة بدل ما ينتظر السحبة كاملة. */
  const d = demandNow();
  PREWARM.demand = d;
  /* البطء يخفّض العتبة ولا يلغيها. الصيغة الأولى كانت «بطيئة ← شغّله
     دائماً»، فلو بقيت الجامعة ثقيلة يومين وما فيه إلا طالب واحد يظل
     يسحب بلا مبرر — ويزيد الحمل على جامعة متعبة أصلاً.
     بحثة أو بحثتان لا تستحقان تسخيناً مهما كان البطء. */
  const need = d.slow ? DEMAND_SLOW_RATE : DEMAND_MIN_RATE;
  if (d.rate < need) {
    PREWARM.on = false;
    PREWARM.skipped++;
    PREWARM.lastSkip = { at: Date.now(), rate: d.rate, need,
                         why: d.slow ? 'طلب قليل رغم البطء' : 'هدوء' };
    return;
  }
  PREWARM.on = true;
  /* الذروة أو البطء يوسّعان التغطية، والعادي يبقى على ثلاث */
  const maxKeys = (d.busy || d.slow) ? PREWARM_MAX_KEYS + 2 : PREWARM_MAX_KEYS;

  const now = Date.now();
  const TTL = coursesTTL();
  /* عتبة عشوائية في كل دورة (70%–95% من الصلاحية) — نفس فلسفة التشويش
     في دورة المراقبة: ما نبي نمطاً منتظماً يُقرأ من طرف الجامعة. */
  const at = 0.70 + Math.random() * 0.25;

  const due = [...coursesCache.entries()]
    .filter(([, v]) => now - (v.lastHit || v.at) < PREWARM_RECENT)
    .filter(([, v]) => now - v.at >= TTL * at)      /* قاربت تنتهي */
    .sort((a, b) => (b[1].lastHit || b[1].at) - (a[1].lastHit || a[1].at))
    .slice(0, maxKeys);

  if (!due.length) return;
  PREWARM.runs++;
  PREWARM.lastAt = now;
  PREWARM.lastKeys = due.map(([k]) => k);

  for (const [k] of due) {
    const [term, college, gender] = k.split('|');
    try {
      await getCourses(term, college, gender, true);
      PREWARM.refreshed++;
      PREWARM.err = null;
    } catch (e) {
      /* الفشل ما يضر: النسخة القديمة تبقى في الكاش ويخدمها البحث */
      PREWARM.err = { at: Date.now(), msg: e.message };
    }
  }
}

function monitorState() {
  if (!MONITOR_ENABLED) {
    return { active: false, reason: 'disabled',
             ar: 'المراقبة معطّلة في هذي النسخة', en: 'Monitoring disabled on this instance',
             window: null, intervalMin: null };
  }
  if (MONITOR_PAUSED) {
    return { active: false, reason: 'paused',
             ar: 'المراقبة موقوفة يدوياً من اللوحة',
             en: 'Monitoring paused manually from the dashboard',
             window: currentWindow(), intervalMin: null, paused: true };
  }
  const hour = riyadhHour();
  const win = currentWindow();
  const hFrom = activeFrom(), hTo = activeTo();
  const inHours = hour >= hFrom && hour < hTo;

  if (!inHours) {
    return { active: false, reason: 'hours',
             ar: `خارج ساعات العمل (${hFrom}:00 – ${hTo}:00)`,
             en: `Outside active hours (${hFrom}:00–${hTo}:00)`,
             window: win, intervalMin: null };
  }
  if (win) {
    return { active: true, reason: 'peak', ar: 'مراقبة مكثفة — ' + win.ar,
             en: 'Intensive monitoring — registration period',
             window: win, intervalMin: INTERVAL_PEAK / 60000 };
  }
  if (!INTERVAL_IDLE) {
    return { active: false, reason: 'offseason',
             ar: 'خارج فترات التسجيل — المراقبة متوقفة',
             en: 'Outside registration periods — monitoring paused',
             window: null, intervalMin: null, next: nextWindow() };
  }
  return { active: true, reason: 'idle', ar: 'مراقبة مخفّفة (خارج فترة التسجيل)',
           en: 'Reduced monitoring (outside registration)',
           window: null, intervalMin: INTERVAL_IDLE / 60000 };
}

/* الفاصل القادم مع تشويش عشوائي — يمنع النمط المنتظم تماماً
   ويوزّع الحمل بدل ما يجي كله في نفس الثانية من كل دقيقة */
function nextDelay() {
  const st = monitorState();

  if (st.reason === 'disabled') return 60 * 60 * 1000;

  /* خارج الموسم: نفحص مرة كل ساعة فقط إذا بدأت نافذة جديدة */
  if (st.reason === 'offseason') return 60 * 60 * 1000 * (1 + Math.random() * 0.2);

  if (!st.active) {
    /* ننام حتى 7 صباحاً بالضبط */
    const now = riyadhNow();
    const target = new Date(now);
    target.setUTCHours(activeFrom(), 0, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return Math.max(60000, target - now) + Math.random() * 120000;
  }

  const base = st.reason === 'peak' ? INTERVAL_PEAK : INTERVAL_IDLE;
  return base * (1 + (Math.random() * 2 - 1) * JITTER);
}

function scheduleNextCycle() {
  const delay = nextDelay();
  const st = monitorState();
  NEXT_CYCLE_AT = Date.now() + delay;      /* لعرضه في اللوحة */
  console.log(`next cycle in ${(delay / 60000).toFixed(1)} min — ${st.reason}`);
  setTimeout(async () => {
    if (monitorState().active) {
      try { await runMonitorCycle(); } catch (e) { console.log('cycle err', e.message); }
    }
    scheduleNextCycle();
  }, delay);
}

/* ============ صفحة الصيانة ============ */
function maintenancePage() {
  const msg = MAINT_MSG || 'نسوّي تحديث سريع للموقع. نرجع خلال وقت قصير بإذن الله.';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>جدولك — تحت الصيانة</title>
<meta name="robots" content="noindex">
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#080b12;color:#e2e8f8;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;
min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center}
.w{max-width:420px}
.ic{width:76px;height:76px;background:#3d6fff;border-radius:22px;display:flex;
align-items:center;justify-content:center;font-size:38px;margin:0 auto 22px;
box-shadow:0 10px 34px rgba(61,111,255,.35)}
h1{font-size:22px;font-weight:700;margin-bottom:12px}
p{font-size:14.5px;color:#8b96b8;line-height:1.9;margin-bottom:22px}
.box{background:#131928;border:1px solid #1e2740;border-radius:14px;padding:15px 17px;
font-size:13px;color:#8b96b8;line-height:1.8}
.box b{color:#e2e8f8}
a{color:#6b8fff;text-decoration:none}
.dots span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#3d6fff;
margin:0 3px;animation:b 1.3s infinite}
.dots span:nth-child(2){animation-delay:.18s}
.dots span:nth-child(3){animation-delay:.36s}
@keyframes b{0%,60%,100%{opacity:.28;transform:translateY(0)}30%{opacity:1;transform:translateY(-5px)}}
.f{margin-top:24px;font-size:11.5px;color:#4a5580;font-family:'JetBrains Mono',monospace}
</style></head><body>
<div class="w">
  <div class="ic">🎓</div>
  <h1>جدولك تحت الصيانة</h1>
  <p>${msg.replace(/[<>]/g,'')}</p>
  <div class="dots"><span></span><span></span><span></span></div>
  <div class="box" style="margin-top:24px">
    <b>بياناتك محفوظة بالكامل</b><br>
    جدولك وخطتك ومعدلك في حسابك، وترجع لك زي ما تركتها.
  </div>
  <div class="f">jadwalik.com</div>
</div></body></html>`;
}

/* ============ صفحة ٤٠٤ ============ */
function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>جدولك — الصفحة غير موجودة</title>
<meta name="robots" content="noindex">
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#080b12;color:#e2e8f8;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;
min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center}
.w{max-width:420px}
.ic{width:76px;height:76px;background:#3d6fff;border-radius:22px;display:flex;
align-items:center;justify-content:center;font-size:27px;margin:0 auto 22px;
box-shadow:0 10px 34px rgba(61,111,255,.35);
font-family:'JetBrains Mono',monospace;font-weight:500;
direction:ltr;unicode-bidi:isolate}
h1{font-size:22px;font-weight:700;margin-bottom:12px}
p{font-size:14.5px;color:#8b96b8;line-height:1.9;margin-bottom:18px}
.en{font-size:12.5px;color:#4a5580;margin-bottom:24px;direction:ltr;unicode-bidi:isolate}
.btn{display:inline-block;background:#3d6fff;color:#fff;text-decoration:none;
padding:13px 30px;border-radius:13px;font-size:14.5px;font-weight:600;
box-shadow:0 8px 24px rgba(61,111,255,.3)}
.links{margin-top:22px;font-size:13px;color:#4a5580}
.links a{color:#6b8fff;text-decoration:none;padding:0 7px}
.f{margin-top:26px;font-size:11.5px;color:#4a5580;font-family:'JetBrains Mono',monospace}
</style></head><body>
<div class="w">
  <div class="ic">404</div>
  <h1>ما لقينا الصفحة</h1>
  <p>الرابط اللي فتحته مو موجود أو تغيّر. بياناتك ما تأثرت — جدولك وخطتك ومعدلك محفوظة في حسابك.</p>
  <div class="en">The page you requested does not exist.</div>
  <a class="btn" href="/">الرجوع للرئيسية</a>
  <div class="links"><a href="/guide">دليل الاستخدام</a>·<a href="/privacy">الخصوصية</a>·<a href="/terms">الشروط</a></div>
  <div class="f">jadwalik.com</div>
</div></body></html>`;
}

/* ============ HTTP server ============ */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const host = (req.headers.host || '').toLowerCase();
  /* نطاق onrender يُحوَّل للنطاق الرسمي — إلا في نسخة الاختبار،
     لأنها لا تملك نطاقاً خاصاً ولازم تُعرض كما هي. */
  if (SITE_ENV === 'prod' &&
      host.includes('onrender.com') && !req.url.startsWith('/tg-webhook')) {
    /* 308 بدل 301: يحافظ على POST بدل ما المتصفح يحوّلها GET */
    res.writeHead(308, { Location: 'https://jadwalik.com' + req.url });
    res.end(); return;
  }

  /* ═══ http → https ═══
     قوقل فهرس نسخة http كصفحة منفصلة (١٢ ظهوراً في أسبوع).
     Render ينهي TLS ويمرّر البروتوكول الأصلي في هذي الترويسة،
     فنحوّل فقط لو صرّحت بـ http — وغيابها يعني تشغيلاً محلياً فلا نلمسه. */
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'http' && host && !req.url.startsWith('/tg-webhook')) {
    res.writeHead(308, { Location: 'https://' + host + req.url });
    res.end(); return;
  }

  const parsed = url.parse(req.url, true);

  /* وضع الصيانة — نقفل على الطلاب فقط، واللوحة تبقى شغالة */
  if (MAINTENANCE &&
      !parsed.pathname.startsWith('/api/admin/') &&
      parsed.pathname !== '/admin' && parsed.pathname !== '/admin.html' &&
      parsed.pathname !== '/tg-webhook') {
    if (parsed.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(503);
      res.end(JSON.stringify({ success: false, maintenance: true,
                               error: MAINT_MSG || 'الموقع تحت الصيانة' }));
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Retry-After', '600');
      res.writeHead(503);
      res.end(maintenancePage());
    }
    return;
  }

  /* Telegram webhook */
  if (parsed.pathname === '/tg-webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try { await handleTelegramUpdate(JSON.parse(body)); } catch (e) {}
      res.writeHead(200); res.end('ok');
    });
    return;
  }

  /* بحث المواد */
  if (parsed.pathname === '/api/courses') {
    const rl = rateHit(clientIP(req));
    if (!rl.ok) {
      OPS.rateLimited = (OPS.rateLimited || 0) + 1;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', String(rl.retry));
      res.writeHead(429);
      res.end(JSON.stringify({ success: false, error: 'طلبات كثيرة — جرّب بعد شوي' }));
      return;
    }
    touchVisitor(req);
    res.setHeader('Content-Type', 'application/json');
    /* ═══ ردّ مضغوط مخزَّن ═══
       كل طلب كان يعيد بناء الرد: JSON.stringify لـ1800 مادة (430 كيلوبايت)
       ثم ضغطها — حتى الطلبات المخدومة من الكاش. على نصف معالج هذا هو
       السقف الحقيقي، لا الذاكرة. نخزّن البايتات المضغوطة مرة ونرسلها
       جاهزة، فيقفز السقف من عشرات الطلبات في الثانية إلى آلاف.
       ageMs و cached و ttlMin كانت تجعل الجسم يتغيّر كل ميلي ثانية
       فيستحيل تخزينه — والواجهة لا تقرأها أصلاً، فنقلناها لترويسات. */
    const sendCourses = (r, key) => {
      res.setHeader('X-Cached', r.cached ? '1' : '0');
      res.setHeader('X-Age-Ms', String(r.age || 0));
      res.setHeader('X-TTL-Min', String(Math.round(coursesTTL() / 60000)));
      const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const hit = key ? RESP_CACHE.get(key) : null;

      if (hit && hit.at === r.at) {                /* نفس النسخة بالضبط */
        OPS.respCacheHits = (OPS.respCacheHits || 0) + 1;
        if (wantsGzip && hit.gz) {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.writeHead(200); return res.end(hit.gz);
        }
        res.writeHead(200); return res.end(hit.raw);
      }

      const raw = Buffer.from(JSON.stringify({
        success: true, count: r.courses.length, courses: r.courses
      }), 'utf8');
      if (!wantsGzip) {
        if (key) RESP_CACHE.set(key, { at: r.at, raw, gz: null });
        res.writeHead(200); return res.end(raw);
      }
      zlib.gzip(raw, (err, gz) => {
        if (err) { res.writeHead(200); return res.end(raw); }
        if (key) {
          RESP_CACHE.set(key, { at: r.at, raw, gz });
          while (RESP_CACHE.size > 12)             /* سقف: لا نُراكم ترمات وكليات */
            RESP_CACHE.delete(RESP_CACHE.keys().next().value);
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.writeHead(200); res.end(gz);
      });
    };
    const sendJSON = obj => {
      const buf = Buffer.from(JSON.stringify(obj), 'utf8');
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        zlib.gzip(buf, (err, gz) => {
          if (err) { res.writeHead(200); return res.end(buf); }
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.writeHead(200); res.end(gz);
        });
      } else { res.writeHead(200); res.end(buf); }
    };
    const { term = '202630', college = 'ALL', gender = 'M1' } = parsed.query;
    try {
      const r = await getCourses(term, college, gender);
      sendCourses(r, `${term}|${college}|${gender}`);
    } catch (err) {
      /* لو الجامعة تعطلت، نخدم آخر نسخة محفوظة بدل ما نفشل */
      OPS.lastError = { at: Date.now(), where: 'search', msg: err.message };
      alert('search', 'البحث ما يشتغل',
        `فشل جلب المواد من موقع الجامعة.\nالسبب: ${err.message}\n\n` +
        (coursesCache.size ? 'نخدم النسخة المحفوظة مؤقتاً.' : 'ما فيه نسخة محفوظة — البحث معطّل.'));
      const stale = coursesCache.get(`${term}|${college}|${gender}`);
      if (stale) {
        OPS.searchStale++;
        /* نادر جداً فلا نخزّنه (بلا مفتاح) — لكن نوحّد الشكل والترويسات */
        res.setHeader('X-Stale', '1');
        sendCourses({ courses: stale.courses, cached: true,
                      age: Date.now() - stale.at, at: stale.at }, null);
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }
    return;
  }

  /* ---------- صفحة لوحة التحكم ---------- */
  if (parsed.pathname === '/admin' || parsed.pathname === '/admin.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200); res.end(html);
    } catch (e) { res.writeHead(404); res.end('Not found'); }
    return;
  }

  /* ---------- واجهات لوحة التحكم ---------- */
  if (parsed.pathname.startsWith('/api/admin/')) {
    /* لا نسمح لأي موقع خارجي يناديها */
    res.setHeader('Access-Control-Allow-Origin', 'https://jadwalik.com');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const ip = clientIP(req);
    const send = (code, obj) => { res.writeHead(code); res.end(JSON.stringify(obj)); };

    if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) {
      return send(503, { error: 'ADMIN_TOKEN غير مضبوط في Render (لازم 12 حرف فأكثر)' });
    }
    if (tooManyTries(ip)) {
      return send(429, { error: 'محاولات كثيرة. انتظر ١٥ دقيقة.' });
    }
    if (!isAdmin(req)) {
      noteFail(ip);
      return send(401, { error: 'كلمة السر غلط' });
    }

    try {
      const act = parsed.pathname.replace('/api/admin/', '');

      if (act === 'ping')     return send(200, { ok: true });
      if (act === 'health')   return send(200, await adminHealth());
      if (act === 'stats')    return send(200, await adminStats());
      if (act === 'users')    return send(200, { users: await adminUsers() });
      if (act === 'reviews')  return send(200, { reviews: await adminReviews() });
      if (act === 'monitors') return send(200, { monitors: await adminMonitors() });
      if (act === 'feedback') return send(200, { feedback: await adminFeedback() });
      if (act === 'reports')  return send(200, { reports: await adminReports() });
      if (act === 'storage')  return send(200, await adminStorage());
      if (act === 'uploads')  return send(200, await adminUploads());
      if (act === 'storage-sync' && req.method === 'POST')
        return send(200, await adminStorageSync());
      if (act === 'user')     return send(200, await adminUserDetail(parsed.query.id || ''));
      if (act === 'tickets')  return send(200, { tickets: await adminTickets(parsed.query.status) });
      if (act === 'broadcast-status') return send(200, BROADCAST);
      if (act === 'messages') {
        await fillChatNames().catch(() => {});
        const kind = (parsed.query.kind || '').trim();
        const list = kind ? MSG_LOG.filter(m => m.kind === kind) : MSG_LOG;
        return send(200, {
          messages: list.slice(0, 150).map(m =>
            Object.assign({}, m, { who: CHAT_NAMES.get(m.chatId) || m.who })),
          total: MSG_LOG.length,
          kinds: [...new Set(MSG_LOG.map(m => m.kind))],
          sinceBoot: OPS.bootedAt
        });
      }

      /* موافقة يدوية على عاصفة راجعتها بنفسك */
      if (act === 'approve-storm' && req.method === 'POST') {
        STORM_OK.until = Date.now() + STORM_OK_WINDOW;
        STORM_OK.affected = (SCHED_SYNC.last && SCHED_SYNC.last.stormAbort) || 0;
        console.log(`approve-storm: وافق المشرف على ${STORM_OK.affected} — ` +
                    `صالحة ${Math.round(STORM_OK_WINDOW / 60000)} دقيقة`);
        /* نشغّلها فوراً بدل ما ننتظر الدورة — الموافقة تعني «الآن» */
        const term = String((SCHED_SYNC.last && SCHED_SYNC.last.term) || '202710');
        const r = await getCourses(term, 'ALL', 'ALL', true).catch(() => null);
        const stat = r ? await syncSchedules(term, r.courses, true) : null;
        return send(200, { ok: true, stat, windowMin: Math.round(STORM_OK_WINDOW / 60000) });
      }

      if (act === 'sync-schedules') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const term = String(b.term || '202710').trim();
          const r = await getCourses(term, 'ALL', 'ALL');
          const stat = await syncSchedules(term, r.courses, true);
          return send(200, { ok: true, stat });
        }
        return send(200, { last: SCHED_SYNC.last });
      }

      if (act === 'monitor-row') {
        if (req.method !== 'POST') return send(405, { error: 'POST فقط' });
        const b = await readBody(req);
        const ids = (Array.isArray(b.ids) ? b.ids : [b.id])
          .map(x => parseInt(x, 10)).filter(Number.isFinite);
        if (!ids.length) return send(400, { error: 'ما فيه صفوف' });

        const rows = await sb('GET', 'monitored_courses', {
          query: `?id=in.(${ids.join(',')})&select=*`
        }).catch(() => []);
        if (!Array.isArray(rows) || !rows.length) return send(404, { error: 'ما لقيت الصفوف' });

        const uids = [...new Set(rows.map(r => r.user_id))].map(u => `"${u}"`).join(',');
        const ps = await sb('GET', 'profiles', {
          query: `?id=in.(${uids})&select=id,telegram_chat_id`
        }).catch(() => []);
        const chat = {};
        (Array.isArray(ps) ? ps : []).forEach(p => { chat[p.id] = p.telegram_chat_id });

        const label = r => (r.course_code || 'المادة') +
          (r.scope === 'course' ? ' · كل الشعب' : (r.crn ? ' · CRN ' + r.crn : ''));

        if (b.action === 'stop') {
          logUnwatch(rows, 'admin');
          await sb('DELETE', 'monitored_courses',
            { query: `?id=in.(${ids.join(',')})`, prefer: 'return=minimal' });
          if (b.notify) for (const r of rows) {
            if (chat[r.user_id]) await sendMsg(chat[r.user_id],
              `🔕 <b>أوقفنا مراقبة ${label(r)}</b>\n\n` +
              `${b.reason ? b.reason + '\n\n' : ''}ترجّعها أي وقت من الجرس في الموقع.`)
              .catch(() => {});
          }
          return send(200, { ok: true, stopped: ids.length });
        }

        if (b.action === 'ask') {
          /* سؤال تأكيد مع مهلة — الصف يُحذف تلقائياً لو ما أكّد */
          const hours = Math.max(1, Math.min(168, parseInt(b.hours, 10) || 24));
          const deadline = new Date(Date.now() + hours * 3600e3).toISOString();
          let sent = 0;
          for (const r of rows) {
            if (!chat[r.user_id]) continue;
            const ok = await sendMsg(chat[r.user_id],
              `⏳ <b>هل ما زلت تحتاج مراقبة ${label(r)}؟</b>\n\n` +
              `لو ما أكّدت خلال <b>${hours} ساعة</b>، بنوقف المراقبة تلقائياً.`,
              kb([[btn('✅ نعم، كمّل المراقبة', 'keep:' + r.id)],
                  [btn('🔕 لا، أوقفها', 'stop:' + r.id)]])).catch(() => null);
            if (ok && ok.ok) sent++;
            await new Promise(x => setTimeout(x, 300));
          }
          await sb('PATCH', 'monitored_courses', {
            query: `?id=in.(${ids.join(',')})`,
            body: { expires_at: deadline }, prefer: 'return=minimal'
          });
          return send(200, { ok: true, asked: ids.length, sent, hours, deadline });
        }

        return send(400, { error: 'action لازم تكون stop أو ask' });
      }

      if (act === 'monitor-hours') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (b.reset) HOURS_OVERRIDE = null;
          else if ('from' in b && 'to' in b) {
            const f = Math.max(0, Math.min(23, parseInt(b.from, 10)));
            const t = Math.max(1, Math.min(24, parseInt(b.to, 10)));
            if (Number.isFinite(f) && Number.isFinite(t) && t > f)
              HOURS_OVERRIDE = { from: f, to: t };
            else return send(400, { error: 'ساعات غير صالحة — لازم "من" أصغر من "إلى"' });
          }
        }
        return send(200, { from: activeFrom(), to: activeTo(),
                           custom: !!HOURS_OVERRIDE, state: monitorState() });
      }

      if (act === 'monitor-window') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (b.reset) WINDOW_OVERRIDE = null;
          else if (b.from && b.to) {
            const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
            if (!ok(b.from) || !ok(b.to))
              return send(400, { error: 'التاريخ لازم يكون بصيغة YYYY-MM-DD' });
            if (String(b.to) < String(b.from))
              return send(400, { error: 'تاريخ النهاية قبل البداية' });
            WINDOW_OVERRIDE = { from: String(b.from), to: String(b.to),
                                ar: String(b.ar || 'نافذة يدوية من اللوحة') };
          }
        }
        return send(200, { window: WINDOW_OVERRIDE, custom: !!WINDOW_OVERRIDE,
                           current: currentWindow(), next: nextWindow(),
                           state: monitorState() });
      }

      if (act === 'monitor-toggle') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const was = MONITOR_PAUSED;
          /* بدون حقل on نرجّع الحالة فقط — ما نغيّر شي بالغلط */
          if ('on' in b) MONITOR_PAUSED = !b.on;   /* on = المراقبة شغالة */
          if (was !== MONITOR_PAUSED) saveState().catch(() => {});
          if (was !== MONITOR_PAUSED)
            sendMsg(ADMIN_CHAT_ID, MONITOR_PAUSED
              ? '⏸️ <b>المراقبة موقوفة يدوياً</b>\n\nما راح يستلم أحد إشعارات فتح شعب حتى تشغّلها.'
              : '▶️ <b>المراقبة رجعت تشتغل</b>').catch(() => {});
        }
        return send(200, { on: !MONITOR_PAUSED, state: monitorState() });
      }

      if (act === 'cache-clear') {
        if (req.method === 'POST') {
          const n = coursesCache.size;
          coursesCache.clear();
          return send(200, { ok: true, cleared: n });
        }
        return send(200, { size: coursesCache.size });
      }

      if (act === 'prewarm-toggle') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          if ('on' in b) PREWARM_ON = !!b.on;
          if (PREWARM_ON) prewarmTick().catch(() => {});   /* دورة فورية */
          saveState().catch(() => {});
        }
        return send(200, { on: PREWARM_ON, stat: PREWARM,
                           ttlMin: Math.round(coursesTTL() / 60000) });
      }

      if (act === 'cache-ttl') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const v = Math.round(Number(b.min));
          /* 0 أو فاضي أو قيمة غير صالحة = رجوع للتلقائي */
          if (!v || !isFinite(v) || v <= 0) TTL_OVERRIDE = null;
          else TTL_OVERRIDE = Math.min(TTL_MAX_ALLOWED, Math.max(TTL_MIN_ALLOWED, v));
          saveState().catch(() => {});
        }
        return send(200, { override: TTL_OVERRIDE, choices: TTL_CHOICES,
                           min: TTL_MIN_ALLOWED, max: TTL_MAX_ALLOWED,
                           effectiveMin: Math.round(coursesTTL() / 60000),
                           reason: ttlReason() });
      }

      if (act === 'finals-toggle') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const was = FINALS_ON;
          FINALS_ON = !!b.on;
          if (was !== FINALS_ON) saveState().catch(() => {});
          if (was !== FINALS_ON) {
            /* لما نشغّله نفضي الكاش عشان يسحب جدول الترم الجديد لا القديم */
            if (FINALS_ON) { finalsCache.M = null; finalsCache.F = null; }
            sendMsg(ADMIN_CHAT_ID, FINALS_ON
              ? '📕 <b>جدول الاختبارات النهائية شغّال للطلاب</b>'
              : '📕 <b>جدول الاختبارات النهائية موقوف</b>\n\nالطلاب يشوفون رسالة أن الجامعة ما نشرت الجدول بعد.').catch(() => {});
          }
        }
        return send(200, { on: FINALS_ON });
      }

      if (act === 'maintenance') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const was = MAINTENANCE;
          MAINTENANCE = !!b.on;
          if (typeof b.msg === 'string') MAINT_MSG = b.msg.slice(0, 300);
          if (was !== MAINTENANCE) {
            sendMsg(ADMIN_CHAT_ID, MAINTENANCE
              ? `🔧 <b>الموقع دخل وضع الصيانة</b>\n\n${MAINT_MSG || 'بدون رسالة'}`
              : `✅ <b>الموقع رجع للعمل</b>`).catch(() => {});
          }
        }
        return send(200, { on: MAINTENANCE, msg: MAINT_MSG });
      }

      if (req.method === 'POST') {
        const b = await readBody(req);
        if (act === 'grant')  return send(200, await adminGrant(b.userId, b.days || 365));
        if (act === 'revoke') return send(200, await adminRevoke(b.userId));
        if (act === 'delete-review') return send(200, await adminDeleteReview(b));
        if (act === 'notify') return send(200, await adminNotify(b.userId, b.text || ''));
        if (act === 'reply')  return send(200, await adminReply(b.chatId, b.email, b.text || ''));
        if (act === 'broadcast')
          return send(200, await adminBroadcast(b.text, b.photo, !!b.dryRun));
        if (act === 'close-ticket') return send(200, await closeTicket(b.id));
        if (act === 'hide-review')   return send(200, await setReviewHidden(b.id, b.hidden));
        if (act === 'clear-reports') return send(200, await clearReports(b.id));
        if (act === 'del-ticket')    return send(200, await deleteTicket(b.id));
        if (act === 'del-feedback')  return send(200, await deleteFeedback(b.id));
      }
      return send(404, { error: 'إجراء غير معروف' });
    } catch (e) {
      return send(500, { error: e.message });
    }
  }

  /* الطالب يلغي المراقبة من الموقع مباشرة عبر Supabase بلا مرور
     بالسيرفر، فما نشوف الحدث. هذا المسار للتسجيل فقط — لا يحذف
     شيئاً ولا يعطّل الإلغاء لو فشل. */
  if (parsed.pathname === '/api/unwatch-log' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const b = await readBody(req);
      if (isUuid(b.userId)) {
        logUnwatch({
          user_id: b.userId, course_code: b.code, crn: b.crn,
          scope: b.scope, last_status: b.lastStatus, created_at: b.createdAt
        }, 'web');
      }
    } catch (e) { /* التسجيل ما يهم لو فشل */ }
    res.writeHead(200); res.end('{"ok":true}');
    return;
  }

  /* تفاعل الطالب مع تقييم: موافق / غير موافق / بلاغ */
  if (parsed.pathname === '/api/review-react' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const b = await readBody(req);
    const r = await reviewReact(b.reviewId, b.userId, b.kind, b.reason);
    res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r));
    return;
  }

  /* ملاحظات الطلاب */
  if (parsed.pathname === '/api/feedback' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const ip = clientIP(req);
    /* حد بسيط: 5 رسائل لكل IP كل ساعة */
    const now = Date.now();
    const rec = fbLimit.get(ip);
    if (rec && now - rec.first < 3600e3 && rec.count >= 5) {
      res.writeHead(429); res.end(JSON.stringify({ ok: false, error: 'كثير، جرّب بعدين' })); return;
    }
    const b = await readBody(req);
    const text = String(b.text || '').trim().slice(0, 1200);
    if (text.length < 5) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'نص قصير' })); return;
    }
    if (!rec || now - rec.first >= 3600e3) fbLimit.set(ip, { first: now, count: 1 });
    else rec.count++;
    if (fbLimit.size > 3000) fbLimit.clear();

    const entry = {
      at: now,
      text,
      category: ['idea', 'bug', 'other'].includes(b.category) ? b.category : 'other',
      email: String(b.email || '').slice(0, 120) || null,
      name:  String(b.name  || '').slice(0, 80)  || null,
      major: String(b.major || '').slice(0, 12)  || null,
      lang:  b.lang === 'en' ? 'en' : 'ar',
      /* من الزائر: يكتبه بنفسه. من المسجّل: نجيبه من حسابه تحت */
      telegram: String(b.telegram || '').trim().replace(/^@+/, '').slice(0, 40) || null,
      chatId: null
    };

    /* لو مسجّل وربط تيليغرام، نجيب معرّفه من حسابه — أدق من كتابته يدوياً */
    if (entry.email) {
      try {
        const p = await sb('GET', 'profiles', {
          query: `?user_email=eq.${encodeURIComponent(entry.email)}` +
                 `&select=telegram_username,telegram_chat_id`
        });
        const row = Array.isArray(p) ? p[0] : null;
        if (!row) {
          const p2 = await sb('GET', 'profiles', {
            query: `?email=eq.${encodeURIComponent(entry.email)}` +
                   `&select=telegram_username,telegram_chat_id`
          });
          const r2 = Array.isArray(p2) ? p2[0] : null;
          if (r2) {
            entry.telegram = entry.telegram || r2.telegram_username || null;
            entry.chatId = r2.telegram_chat_id || null;
          }
        } else {
          entry.telegram = entry.telegram || row.telegram_username || null;
          entry.chatId = row.telegram_chat_id || null;
        }
      } catch (e) { /* ما يهم */ }
    }

    /* نفتح تذكرة عشان تتجمّع المحادثة في مكان واحد */
    let ticket = null;
    if (entry.chatId || entry.email) {
      ticket = await getOrCreateTicket({
        chatId: entry.chatId, email: entry.email, name: entry.name,
        major: entry.major, telegram: entry.telegram,
        text: entry.text, category: entry.category
      });
      if (ticket) await addTicketMessage(ticket.id, 'student', entry.text, null);
    }

    /* ونحفظها في جدول الملاحظات كذلك */
    let saved = false;
    try {
      const r = await sb('POST', 'feedback', {
        body: {
          user_email: entry.email, user_name: entry.name,
          category: entry.category, message: entry.text,
          major: entry.major, lang: entry.lang,
          telegram: entry.telegram
        },
        prefer: 'return=minimal'
      });
      saved = !(r && r.code);
    } catch (e) { saved = false; }
    if (!saved) {
      FEEDBACK_MEM.unshift(entry);
      if (FEEDBACK_MEM.length > 200) FEEDBACK_MEM.pop();
    }
    OPS.feedback++;

    /* إشعار فوري لك على تيليغرام */
    if (ADMIN_CHAT_ID) {
      const icon = { idea: '💡', bug: '🐞', other: '💬' }[entry.category] || '💬';
      const label = { idea: 'اقتراح جديد', bug: 'مشكلة جديدة', other: 'ملاحظة جديدة' }[entry.category] || 'ملاحظة جديدة';
      const esc = x => String(x || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const who = entry.name || entry.email || 'زائر غير مسجّل';
      /* رابط يفتح محادثة مباشرة مع الطالب */
      let reply = '';
      if (entry.telegram) {
        reply = `\n💬 <a href="https://t.me/${esc(entry.telegram)}">تكلّم معه على تيليغرام</a>`;
      } else if (entry.chatId) {
        reply = `\n💬 <a href="tg://user?id=${esc(entry.chatId)}">تكلّم معه على تيليغرام</a>`;
      } else if (entry.email) {
        reply = `\n✉️ <a href="mailto:${esc(entry.email)}">رد بالإيميل</a>`;
      }

      sendMsg(ADMIN_CHAT_ID,
        (ticket ? `🎫 تذكرة <b>#${ticket.id}</b>\n` : '') +
        `${icon} <b>${label}</b>\n\n` +
        `<blockquote>${esc(entry.text)}</blockquote>\n` +
        `👤 ${esc(who)}\n` +
        (entry.email ? `✉️ <code>${esc(entry.email)}</code>\n` : '') +
        (entry.telegram ? `📱 @${esc(entry.telegram)}\n` : '') +
        (entry.major ? `🎓 ${esc(entry.major)}\n` : '') +
        (saved ? '' : '⚠️ محفوظة بالذاكرة فقط — جدول feedback ناقص\n') +
        reply +
        (entry.chatId ? `\n\n<i>↩️ رد على هذي الرسالة عشان يوصله ردك</i>` : '') +
        `\n\n📊 jadwalik.com/admin` +
        (entry.chatId ? `\n<code>#u${entry.chatId}</code>` : '')
      ).catch(() => {});
    }

    res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    return;
  }

  /* حالة المراقبة — يعرضها الموقع للطالب بشفافية */
  if (parsed.pathname === '/api/monitor-status') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=120');
    const st = monitorState();
    res.writeHead(200);
    res.end(JSON.stringify({
      active: st.active, reason: st.reason,
      env: SITE_ENV, freeBeta: FREE_BETA,
      /* بصمة النسخة المخدومة الآن. المثبَّت على الشاشة الرئيسية قد يعيش
         أياماً بلا إعادة تحميل، فيقارن الصفحة المحمّلة عنده بهذي
         ويعرض «فيه تحديث» بدل ما يظل على نسخة قديمة بصمت. */
      build: PAGE ? PAGE.etag : null,
      next: st.next || nextWindow(),
      dataTtlMin: Math.round(coursesTTL() / 60000),
      ar: st.ar, en: st.en,
      intervalMin: st.intervalMin,
      activeHours: [activeFrom(), activeTo()],
      windows: MONITOR_WINDOWS
    }));
    return;
  }

  /* جدول الاختبارات النهائية */
  if (parsed.pathname === '/api/finals') {
    res.setHeader('Content-Type', 'application/json');
    /* موقوف من اللوحة: ما نسحب من الجامعة أصلاً */
    if (!FINALS_ON) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, disabled: true, count: 0, exams: [] }));
      return;
    }
    try {
      const d = await getFinals();
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        unavailable: d.unavailable,
        count: d.exams.length,
        fetchedAt: new Date(d.at).toISOString(),
        exams: d.exams
      }));
    } catch (err) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: err.message, exams: [] }));
    }
    return;
  }

  /* تشغيل دورة فحص يدوياً (للاختبار) */
  if (parsed.pathname === '/api/run-check') {
    res.setHeader('Content-Type', 'application/json');
    runMonitorCycle();
    res.writeHead(200); res.end(JSON.stringify({ started: true }));
    return;
  }

  /* قوقل يطلب أيقونة الموقع من /favicon.ico تحديداً، وبدونها يعرض
     كرة أرضية عامة في نتائج البحث. نخدمها من أكبر أيقونة متوفرة. */
  if (parsed.pathname === '/favicon.ico') {
    const candidates = ['favicon-192.png', 'favicon-512.png', 'favicon-180.png', 'favicon-32.png'];
    for (const name of candidates) {
      try {
        const buf = fs.readFileSync(path.join(__dirname, name));
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        res.writeHead(200); res.end(buf);
        return;
      } catch (e) { /* نجرّب اللي بعدها */ }
    }
    res.writeHead(404); res.end('Not found');
    return;
  }

  /* الأيقونات والمانيفست */
  if (/^\/(favicon-\d+\.png|og\.png|manifest\.json|jadwalik-logo[\w-]*\.png)$/.test(parsed.pathname)) {
    try {
      const f = path.join(__dirname, parsed.pathname.slice(1));
      const buf = fs.readFileSync(f);
      res.setHeader('Content-Type',
        parsed.pathname.endsWith('.json') ? 'application/json; charset=utf-8' : 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.writeHead(200); res.end(buf);
    } catch (e) {
      console.log('404 asset ' + parsed.pathname + ' — الملف غير موجود في المستودع');
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  /* ملفات الفهرسة — يطلبها قوقل قبل ما يزحف الموقع */
  if (parsed.pathname === '/robots.txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.writeHead(200);
    res.end(
      'User-agent: *\n' +
      'Allow: /\n' +
      'Disallow: /admin.html\n' +
      'Disallow: /api/\n\n' +
      'Sitemap: https://jadwalik.com/sitemap.xml\n');
    return;
  }

  if (parsed.pathname === '/sitemap.xml') {
    const today = riyadhDate();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.writeHead(200);
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      ['https://jadwalik.com/', 'https://jadwalik.com/guide',
       'https://jadwalik.com/about',
       'https://jadwalik.com/privacy', 'https://jadwalik.com/terms']
        .map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>\n`).join('') +
      '</urlset>\n');
    return;
  }

  /* دليل الاستخدام بالصور */
  if (parsed.pathname === '/guide' || parsed.pathname === '/guide.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'jadwalik-guide.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.writeHead(200); res.end(html);
    } catch (e) { res.writeHead(404); res.end('Not found'); }
    return;
  }

  /* الصفحات القانونية والتعريفية — يطلبها قوقل وبوابات الدفع */
  if (parsed.pathname === '/privacy' || parsed.pathname === '/privacy.html' ||
      parsed.pathname === '/terms'   || parsed.pathname === '/terms.html'   ||
      parsed.pathname === '/about'   || parsed.pathname === '/about.html') {
    const file = parsed.pathname.includes('privacy') ? 'privacy.html'
               : parsed.pathname.includes('about')   ? 'about.html'
               : 'terms.html';
    try {
      const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.writeHead(200); res.end(html);
    } catch (e) { res.writeHead(404); res.end('Not found'); }
    return;
  }

  /* الصفحة */
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    touchVisitor(req);
    if (!PAGE) loadPage();                       /* محاولة أخيرة لو فشلت عند الإقلاع */
    if (!PAGE) { res.writeHead(500); res.end('Page not found'); return; }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');  /* يتحقق مع كل زيارة — ما يعلق على نسخة قديمة */
    res.setHeader('ETag', PAGE.etag);
    res.setHeader('Vary', 'Accept-Encoding');

    /* الصفحة ما تغيّرت عند الطالب — نرد بدون إرسال أي محتوى */
    if ((req.headers['if-none-match'] || '') === PAGE.etag) {
      res.writeHead(304); res.end(); return;
    }

    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.writeHead(200); res.end(PAGE.gz);
    } else {
      res.writeHead(200); res.end(PAGE.raw);
    }
    return;
  }

  /* ---------- ٤٠٤ ----------
     الواجهات ترد JSON لأن الكود يقرأها، والصفحات ترد HTML لأن الطالب
     يقرأها بعينه. قبل هذا كان أي رابط مكسور يعرض سطر JSON عارياً. */
  if (parsed.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(404);
  res.end(notFoundPage());
});

/* ═══ ساعة التأكيد المستقلة ═══
   المزامنة ما تملك ساعة خاصة — تنطلق فقط لما تسحب دورة المراقبة.
   فتتوقف لو أُوقفت المراقبة، أو خرجنا من ساعات العمل، أو ما فيه
   مراقبات أصلاً. وفي مسار البحث الكاش يعيش ساعة أو ست ساعات.
   والأهم: إعادة الفحص على نفس النسخة المخزّنة ليست رصدة ثانية —
   هي قراءة ثانية لنفس البيانات، تؤكد نفسها بلا معنى.
   فهنا نجبر سحبة طازجة، ولا نفعل ذلك إلا لو فيه شيء نضج فعلاً. */
let CONFIRM_BUSY = false;
const CONFIRM_STAT = { lastTick: 0, lastForce: 0, forces: 0, ripe: 0, purged: 0 };

async function confirmTick() {
  if (CONFIRM_BUSY) return;
  CONFIRM_BUSY = true;
  try {
    CONFIRM_STAT.lastTick = Date.now();

    /* ── تنظيف أولاً ──
       الشعبة الملغاة تُتجاوَز قبل رصد الفروق، فصفّها لا يتأكد ولا يُرمى.
       بدون هذا كان يظل «ناضجاً» فيجبر سحبة كل خمس دقائق إلى الأبد. */
    const dead = new Date(Date.now() - PENDING_MAX_AGE).toISOString();
    const purged = await sb('DELETE', 'pending_changes', {
      query: `?first_seen=lt.${encodeURIComponent(dead)}`,
      prefer: 'return=representation'
    }).catch(() => []);
    if (Array.isArray(purged) && purged.length) {
      CONFIRM_STAT.purged += purged.length;
      console.log(`confirmTick: نظّفت ${purged.length} صفّاً عالقاً أقدم من ` +
                  `${Math.round(PENDING_MAX_AGE / 3600000)} ساعة`);
    }

    /* تنظيف السجل: بلا هذا يكبر الجدول بلا سقف.
       مرة كل ساعة تكفي — لا حاجة لها كل خمس دقائق. */
    if (Date.now() - (CONFIRM_STAT.lastPurgeEvents || 0) > 60 * 60 * 1000) {
      CONFIRM_STAT.lastPurgeEvents = Date.now();
      const old = new Date(Date.now() - EVENT_MAX_AGE_DAYS * 864e5).toISOString();
      await sb('DELETE', 'app_events', {
        query: `?at=lt.${encodeURIComponent(old)}`, prefer: 'return=minimal'
      }).catch(() => {});
    }

    /* استعلام خفيف: هل نضج شيء؟ الطابور فاضي في الغالب فالتكلفة صفر عملياً */
    const cutoff = new Date(Date.now() - CONFIRM_AFTER).toISOString();
    const ripe = await sb('GET', 'pending_changes', {
      query: `?first_seen=lte.${encodeURIComponent(cutoff)}` +
             `&first_seen=gte.${encodeURIComponent(dead)}` +
             `&seen_count=gte.${CONFIRM_MIN_SIGHTINGS - 1}` +
             `&select=term&limit=20`
    }).catch(() => []);
    CONFIRM_STAT.ripe = Array.isArray(ripe) ? ripe.length : 0;
    if (!CONFIRM_STAT.ripe) return;

    /* سحبة طازجة حقيقية لكل ترم فيه صفّ ناضج — هذي هي المشاهدة الثانية */
    for (const term of [...new Set(ripe.map(r => r.term))]) {
      try {
        /* أثر صريح في السجل: العدّاد وحده يقول إن سحبة حصلت، ولا يقول
           إنها هي التي أكّدت هذا الصف. هذان السطران يربطان الاثنين
           بالوقت، فتقدر تطابقهما مع لحظة وصول الرسالة. */
        const ripeHere = ripe.filter(r => r.term === term).length;
        const t0 = Date.now();
        console.log(`تأكيد: ${ripeHere} صفّاً ناضجاً في ${term} — أجبر سحبة طازجة`);
        const r = await getCourses(term, 'ALL', 'ALL', true);   /* force = تجاوز الكاش */
        const n = (r && Array.isArray(r.courses)) ? r.courses.length : 0;
        /* cached=true مع force يعني حالة واحدة: انضممنا لسحبة جارية
           بدأها طالب قبل لحظات. القائمة طازجة فعلاً، لكنها ليست
           مشاهدة مستقلة — نسجّلها بوضوح بدل ما نخلطها بالسحبة الخاصة. */
        console.log(`تأكيد: وصلت ${n} مادة في ${Date.now() - t0}ms` +
                    (r && r.cached ? ' (انضممنا لسحبة جارية)' : ' (سحبة خاصة)'));
        const st = await syncSchedules(term, r.courses, true);  /* force = تجاوز الفجوة */
        console.log(`تأكيد: النتيجة — مؤكَّد ${st && st.confirmed || 0} · ` +
                    `ينتظر ${st && st.pendingWaiting || 0} · ` +
                    `مرفوض ${st && st.discarded || 0} · ` +
                    `أُرسل ${st && st.notified || 0}`);
        CONFIRM_STAT.forces++; CONFIRM_STAT.lastForce = Date.now();
      } catch (e) {
        console.log('confirmTick: ' + term + ' — ' + e.message);
      }
    }
  } finally { CONFIRM_BUSY = false; }
}

server.listen(PORT, () => {
  console.log('Jadwalik running on ' + PORT);
  console.log('pushover: ' + (PUSHOVER_ON
    ? `مفعّل (token ${PUSHOVER_TOKEN.length} حرف · user ${PUSHOVER_USER.length} حرف)`
    : 'معطّل — المتغيران ناقصان'));
  if (PUSHOVER_ON)
    pushover('✅ جدولك شغّال', 'السيرفر اشتغل و Pushover موصول.', 0).catch(() => {});
  /* التسخين المسبق: فحص كل 20 ثانية، وما يسحب إلا لو فيه تركيبة
     مطلوبة قاربت صلاحيتها تنتهي — والمفتاح مطفأ افتراضياً. */
  setInterval(() => { prewarmTick().catch(() => {}) }, 20000);
  /* ساعة التأكيد: تفحص الطابور كل 5 دقائق، وما تسحب إلا لو نضج صفّ */
  setInterval(() => { confirmTick().catch(() => {}) }, CONFIRM_TICK);
  /* تنبيهات جدولك: فحص كل 10 دقائق، وما ترسل إلا الساعة 5 العصر مرة واحدة */
  setInterval(() => { notifyTick().catch(() => {}) }, 10 * 60 * 1000);
  /* البلاغات: فحص خفيف كل 3 دقائق — صف واحد لا أكثر */
  setInterval(() => { reportsWatch().catch(() => {}) }, 3 * 60 * 1000);
  reportsWatch().catch(() => {});

  /* الاستعادة أولاً، ثم نسمح بالكتابة — وإلا ضاعفنا ما استعدناه */
  (async () => {
    try {
      await restoreState();
      await restoreEvents();
    } catch (e) {
      console.log('الاستعادة فشلت (نكمل بذاكرة فاضية): ' + e.message);
    } finally {
      EVENTS_READY = true;
    }
  })();
  /* حفظ العدّادات كل 5 دقائق، وعند الإغلاق النظيف */
  setInterval(() => { saveState().catch(() => {}) }, 5 * 60 * 1000);
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.on(sig, () => { saveState().catch(() => {}).finally(() => process.exit(0)); });
  const st = monitorState();
  console.log(`env=${SITE_ENV} | freeBeta=${FREE_BETA} | ترم المزامنة=${ACTIVE_TERM}` +
              ` | monitor: ${st.reason} — ${st.ar}`);
  /* أول دورة بعد 20-60 ثانية عشوائياً، ثم جدولة ذكية */
  setTimeout(async () => {
    if (monitorState().active) {
      try { await runMonitorCycle(); } catch (e) { console.log('cycle err', e.message); }
    }
    scheduleNextCycle();
  }, 20000 + Math.random() * 40000);
});
