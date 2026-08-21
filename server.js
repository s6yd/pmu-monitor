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

/* معرّف محادثتك في تيليغرام — يوصلك عليه كل رأي جديد فوراً.
   تجيبه بإرسال /whoami للبوت، ثم تحطه في Render باسم ADMIN_CHAT_ID */
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

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

/* ============ Telegram ============ */
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

const sendMsg = (chatId, text) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

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
    const monitors = await sb('GET', 'monitored_courses', { query: '?select=*' });
    if (!Array.isArray(monitors) || !monitors.length) return;

    /* ── 1. سحبة واحدة لكل ترم ── */
    const terms = [...new Set(monitors.map(m => m.term || '202630'))];
    const snapshot = {};
    for (const term of terms) {
      try {
        const html = await fetchPMUData(term, 'ALL', 'ALL');
        parseHTML(html).forEach(c => { snapshot[term + ':' + c.crn] = c; });
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

    const changed = [];      // {m, live}
    const toNotify = [];     // {m, live}
    for (const m of monitors) {
      const live = snapshot[(m.term || '202630') + ':' + m.crn];
      if (!live) continue;
      if (live.status !== m.last_status) {
        changed.push({ m, live });
        if (live.status === 'OPEN' && m.last_status !== 'OPEN') toNotify.push({ m, live });
      }
    }
    stat.changed = changed.length;
    stat.toNotify = toNotify.length;
    if (!changed.length) return;

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
    await inBatches(sendList, 20, async ({ m, live }) => {
      const p = profiles[m.user_id];
      const r = await sendMsg(p.telegram_chat_id,
        `🟢 <b>فتحت مادة!</b>\n\n` +
        `<b>${live.courseCode}</b> — شعبة ${live.section}\n` +
        `${live.courseTitle}\n\n` +
        `🔢 CRN: <code>${live.crn}</code>\n` +
        `📅 ${live.courseDate}  ⏰ ${live.courseTiming}\n` +
        `👤 ${live.instructor || '—'}\n` +
        `🏛️ ${live.room || '—'}\n\n` +
        `⚡️ سجّل الحين قبل ما تنسكر!`);
      if (r && r.ok) notified.push(m.id); else OPS.tgFails++;
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
async function handleTelegramUpdate(update) {
  const msg = update.message;
  if (!msg) return;
  /* نقبل النص والصور — الصورة تجي مع caption أحياناً */
  const photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : null;
  if (!msg.text && !photo) return;
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();

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
          const rest = cmd.slice(6).trim(), sp = rest.indexOf(' ');
          const who = sp > 0 ? rest.slice(0, sp).trim() : rest;
          let body = sp > 0 ? rest.slice(sp + 1).trim() : '';
          if (body.startsWith('!')) body = body.slice(1).trim();
          let target = /^\d+$/.test(who) ? who : null;
          if (!target) {
            for (const col of ['email', 'user_email']) {
              try {
                const rows = await sb('GET', 'profiles', {
                  query: `?${col}=eq.${encodeURIComponent(who)}&select=telegram_chat_id` });
                if (Array.isArray(rows) && rows[0] && rows[0].telegram_chat_id) {
                  target = rows[0].telegram_chat_id; break;
                }
              } catch (e) { /* العمود غير موجود */ }
            }
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
    const sp = rest.indexOf(' ');
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

    let target = /^\d+$/.test(who) ? who : null;
    if (!target) {
      for (const col of ['email', 'user_email']) {
        try {
          const rows = await sb('GET', 'profiles', {
            query: `?${col}=eq.${encodeURIComponent(who)}&select=telegram_chat_id`
          });
          if (Array.isArray(rows) && rows[0] && rows[0].telegram_chat_id) {
            target = rows[0].telegram_chat_id; break;
          }
        } catch (e) { /* العمود غير موجود */ }
      }
    }
    if (!target) return sendMsg(chatId, `❌ ما لقيت أحداً بهذا البريد، أو ما ربط تيليغرام.`);

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
      return sendMsg(chatId,
        `👋 <b>أهلاً بك في جدولك</b>\n\n` +
        `عشان تربط حسابك، افتح jadwalik.com → الإعدادات → فعّل إشعارات تيليغرام.`);
    }
    const rows = await sb('GET', 'profiles',
      { query: `?telegram_link_code=eq.${encodeURIComponent(code)}&select=id,name` });
    if (!rows || !rows.length) {
      return sendMsg(chatId, `❌ الكود غير صحيح أو منتهي.\nجرّب تولّد كود جديد من الموقع.`);
    }
    await sb('PATCH', 'profiles', {
      query: `?id=eq.${rows[0].id}`,
      body: { telegram_chat_id: String(chatId), telegram_username: msg.from.username || null }
    });
    return sendMsg(chatId,
      `✅ <b>تم الربط بنجاح!</b>\n\n` +
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
      { query: `?user_id=eq.${p.id}&select=course_code,section` });
    const active = p.is_pro ||
      (p.subscription_expires_at && new Date(p.subscription_expires_at) > new Date());
    return sendMsg(chatId,
      `📊 <b>حالتك</b>\n\n` +
      `الاشتراك: ${active ? '✅ فعّال' : '❌ غير فعّال'}\n` +
      `المواد المراقبة: ${mons.length}\n` +
      (mons.length ? mons.map(m => `• ${m.course_code} §${m.section}`).join('\n') : ''));
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

/* --- إحصائيات عامة --- */
async function adminStats() {
  const [profiles, reviews, monitors, sched] = await Promise.all([
    sb('GET', 'profiles', { query: '?select=*' }),
    sb('GET', 'instructor_reviews', { query: '?select=*' }),
    sb('GET', 'monitored_courses', { query: '?select=*' }),
    sb('GET', 'user_schedule', { query: '?select=user_id' })
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
  const g = {};
  (Array.isArray(M) ? M : []).forEach(m => {
    const k = (m.course_code || '?') + ' §' + (m.section || '?');
    if (!g[k]) g[k] = { key: k, crn: m.crn, term: m.term, status: m.last_status || '—', watchers: 0 };
    g[k].watchers++;
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
    for (const col of ['email', 'user_email']) {
      try {
        const rows = await sb('GET', 'profiles', {
          query: `?${col}=eq.${encodeURIComponent(email)}&select=telegram_chat_id`
        });
        if (Array.isArray(rows) && rows[0] && rows[0].telegram_chat_id) {
          target = rows[0].telegram_chat_id; break;
        }
      } catch (e) { /* العمود غير موجود */ }
    }
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

  if (last && (now - last.at) > 12 * 60 * 1000)
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
      hoursFrom: ACTIVE_FROM_HOUR,
      hoursTo: ACTIVE_TO_HOUR,
      riyadhHour: riyadhHour(),
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
      lastAt: PREWARM.lastAt, lastKeys: PREWARM.lastKeys, err: PREWARM.err
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
      gapMin: Math.round(SCHED_SYNC_GAP / 60000)
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
      days: s.course_date, time: s.course_timing,
      room: s.room, instructor: s.instructor, term: s.term
    })),
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
const PREWARM = { runs: 0, refreshed: 0, lastAt: 0, lastKeys: [], err: null };

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

async function syncSchedules(term, courses, force) {
  if (SCHED_SYNC.running) return null;
  if (!force && Date.now() - SCHED_SYNC.at < SCHED_SYNC_GAP) return null;
  SCHED_SYNC.running = true;
  SCHED_SYNC.at = Date.now();

  const stat = { at: Date.now(), term, rows: 0, changed: 0, updated: 0,
                 missing: 0, error: null, ms: 0 };
  const t0 = Date.now();
  try {
    const live = new Map();
    (courses || []).forEach(c => live.set(String(c.crn || '').trim(), c));

    const rows = await sb('GET', 'user_schedule', {
      query: `?term=eq.${encodeURIComponent(term)}` +
             `&select=crn,course_title,course_date,course_timing,instructor,room`
    });
    if (!Array.isArray(rows) || !rows.length) return stat;
    stat.rows = rows.length;

    /* CRN → البيانات الحية، فقط للصفوف اللي فعلاً مختلفة */
    const stale = new Map();
    const same = (a, b) => String(a || '').trim() === String(b || '').trim();
    for (const r of rows) {
      const crn = String(r.crn || '').trim();
      const c = live.get(crn);
      if (!c) { stat.missing++; continue; }        /* شعبة انحذفت من الجامعة — ما نلمسها */
      if (same(r.course_title, c.courseTitle) &&
          same(r.course_date, c.courseDate) &&
          same(r.course_timing, c.courseTiming) &&
          same(r.instructor, c.instructor) &&
          same(r.room, c.room)) continue;
      stale.set(crn, c);
    }
    stat.changed = stale.size;

    for (const [crn, c] of stale) {
      await sb('PATCH', 'user_schedule', {
        query: `?term=eq.${encodeURIComponent(term)}&crn=eq.${encodeURIComponent(crn)}`,
        body: {
          course_title: c.courseTitle, course_date: c.courseDate,
          course_timing: c.courseTiming, instructor: c.instructor, room: c.room
        },
        prefer: 'return=minimal'
      });
      stat.updated++;
      await new Promise(r => setTimeout(r, 150));   /* ما نضغط على Supabase */
    }
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

const coursesCache = new Map();     // key → {at, courses}
const inFlight     = new Map();     // key → Promise (يمنع سحبتين متزامنتين لنفس التركيبة)

async function getCourses(term, college, gender, force) {
  const key = `${term}|${college}|${gender}`;
  OPS.searches++;
  const TTL = coursesTTL();
  const hit = coursesCache.get(key);
  if (hit && !force && Date.now() - hit.at < TTL) {
    hit.lastHit = Date.now();          /* لمعرفة أي التركيبات تستحق التسخين */
    OPS.searchesCached++;
    return { courses: hit.courses, cached: true, age: Date.now() - hit.at };
  }

  /* لو فيه سحبة جارية لنفس التركيبة، ننتظرها بدل ما نبدأ وحدة جديدة.
     هذي تمنع 50 طالب يضغطون "ابحث" بنفس اللحظة من إطلاق 50 سحبة. */
  if (inFlight.has(key)) {
    OPS.searchesCached++;
    const courses = await inFlight.get(key);
    return { courses, cached: true, age: 0 };
  }

  const p = (async () => {
    /* سحبة واحدة بـ ALL، ونوزّع الجنس من رقم الشعبة:
       1xx = طلاب · 2xx = طالبات — قاعدة الجامعة الثابتة.
       أوفر من سحبتين منفصلتين، وأدق من التخمين من القاعة. */
    const courses = parseHTML(await fetchPMUData(term, college, gender));
    const forced = gender === 'F1' ? 'F' : gender === 'M1' ? 'M' : null;
    courses.forEach(c => {
      if (forced) { c.gender = forced; return; }
      const sec = String(c.section || '').trim();
      c.gender = /^2/.test(sec) ? 'F' : /^1/.test(sec) ? 'M' : null;
    });
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
  try { return { courses: await p, cached: false, age: 0 }; }
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

const ACTIVE_FROM_HOUR = 7;    // 7 صباحاً بتوقيت الرياض
const ACTIVE_TO_HOUR   = 23;   // حتى 11 مساءً

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
function riyadhDate() { return riyadhNow().toISOString().slice(0, 10); }

function currentWindow() {
  const d = riyadhDate();
  return MONITOR_WINDOWS.find(w => d >= w.from && d <= w.to) || null;
}
function nextWindow() {
  const d = riyadhDate();
  return MONITOR_WINDOWS.find(w => d < w.from) || null;
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
  const now = Date.now();
  const TTL = coursesTTL();
  /* عتبة عشوائية في كل دورة (70%–95% من الصلاحية) — نفس فلسفة التشويش
     في دورة المراقبة: ما نبي نمطاً منتظماً يُقرأ من طرف الجامعة. */
  const at = 0.70 + Math.random() * 0.25;

  const due = [...coursesCache.entries()]
    .filter(([, v]) => now - (v.lastHit || v.at) < PREWARM_RECENT)
    .filter(([, v]) => now - v.at >= TTL * at)      /* قاربت تنتهي */
    .sort((a, b) => (b[1].lastHit || b[1].at) - (a[1].lastHit || a[1].at))
    .slice(0, PREWARM_MAX_KEYS);

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
  const inHours = hour >= ACTIVE_FROM_HOUR && hour < ACTIVE_TO_HOUR;

  if (!inHours) {
    return { active: false, reason: 'hours', ar: 'خارج ساعات العمل (7 ص – 11 م)',
             en: 'Outside active hours (7am–11pm)', window: win, intervalMin: null };
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
    target.setUTCHours(ACTIVE_FROM_HOUR, 0, 0, 0);
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
    touchVisitor(req);
    res.setHeader('Content-Type', 'application/json');
    /* قائمة المواد كبيرة (مئات الكيلوبايتات لقائمة ALL) — الضغط يقصّها
       لعُشر حجمها تقريباً، وهذا أكبر فرق يحسّه الطالب على بيانات الجوال. */
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
      sendJSON({
        success: true, count: r.courses.length,
        cached: r.cached, ageMs: r.age,
        ttlMin: Math.round(coursesTTL() / 60000),
        courses: r.courses
      });
    } catch (err) {
      /* لو الجامعة تعطلت، نخدم آخر نسخة محفوظة بدل ما نفشل */
      OPS.lastError = { at: Date.now(), where: 'search', msg: err.message };
      alert('search', 'البحث ما يشتغل',
        `فشل جلب المواد من موقع الجامعة.\nالسبب: ${err.message}\n\n` +
        (coursesCache.size ? 'نخدم النسخة المحفوظة مؤقتاً.' : 'ما فيه نسخة محفوظة — البحث معطّل.'));
      const stale = coursesCache.get(`${term}|${college}|${gender}`);
      if (stale) {
        OPS.searchStale++;
        sendJSON({
          success: true, count: stale.courses.length,
          cached: true, stale: true, ageMs: Date.now() - stale.at,
          courses: stale.courses
        });
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
      if (act === 'user')     return send(200, await adminUserDetail(parsed.query.id || ''));
      if (act === 'tickets')  return send(200, { tickets: await adminTickets(parsed.query.status) });
      if (act === 'broadcast-status') return send(200, BROADCAST);

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

      if (act === 'monitor-toggle') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const was = MONITOR_PAUSED;
          /* بدون حقل on نرجّع الحالة فقط — ما نغيّر شي بالغلط */
          if ('on' in b) MONITOR_PAUSED = !b.on;   /* on = المراقبة شغالة */
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
      next: st.next || nextWindow(),
      dataTtlMin: Math.round(coursesTTL() / 60000),
      ar: st.ar, en: st.en,
      intervalMin: st.intervalMin,
      activeHours: [ACTIVE_FROM_HOUR, ACTIVE_TO_HOUR],
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
  if (/^\/(favicon-\d+\.png|manifest\.json|jadwalik-logo[\w-]*\.png)$/.test(parsed.pathname)) {
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

  /* الصفحات القانونية — يطلبها قوقل وبوابات الدفع */
  if (parsed.pathname === '/privacy' || parsed.pathname === '/privacy.html' ||
      parsed.pathname === '/terms'   || parsed.pathname === '/terms.html') {
    const file = parsed.pathname.includes('privacy') ? 'privacy.html' : 'terms.html';
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

  /* تسجيل مؤقت لمصدر الـ404 — يظهر في سجل Render.
     احذف هذا السطر بعد ما نعرف المسار المسبّب. */
  console.log('404 ' + req.method + ' ' + parsed.pathname +
    ' | ref: ' + (req.headers.referer || '-'));

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log('Jadwalik running on ' + PORT);
  /* التسخين المسبق: فحص كل 20 ثانية، وما يسحب إلا لو فيه تركيبة
     مطلوبة قاربت صلاحيتها تنتهي — والمفتاح مطفأ افتراضياً. */
  setInterval(() => { prewarmTick().catch(() => {}) }, 20000);
  const st = monitorState();
  console.log(`env=${SITE_ENV} | freeBeta=${FREE_BETA} | monitor: ${st.reason} — ${st.ar}`);
  /* أول دورة بعد 20-60 ثانية عشوائياً، ثم جدولة ذكية */
  setTimeout(async () => {
    if (monitorState().active) {
      try { await runMonitorCycle(); } catch (e) { console.log('cycle err', e.message); }
    }
    scheduleNextCycle();
  }, 20000 + Math.random() * 40000);
});
