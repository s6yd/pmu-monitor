const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
        p.on('error', reject); p.write(postData); p.end();
      });
    });
    req.on('error', reject); req.end();
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
function logCycle(c) {
  OPS.cycles.push(c);
  if (OPS.cycles.length > 40) OPS.cycles.shift();
}

async function runMonitorCycle() {
  if (!SB_URL || !SB_SERVICE_KEY) return;

  /* قفل: لو الدورة السابقة ما خلصت، ما نبدأ وحدة جديدة فوقها.
     بدونه الدورات تتراكم في الذروة وتاكل الذاكرة. */
  if (cycleRunning) { OPS.skipped++; console.log('cycle still running — skipped'); return; }
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
      } catch (e) { OPS.pmuFails++; console.log('fetch fail', term, e.message); }
      await new Promise(r => setTimeout(r, 1500));
    }

    const now = new Date().toISOString();

    /* ── 2. نحدد الصفوف اللي تغيّرت حالتها ── */
    stat.rows = monitors.length;
    stat.terms = terms.length;
    stat.snapshot = Object.keys(snapshot).length;

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
    cycleRunning = false;
  }
}

/* ============ Telegram webhook ============ */
async function handleTelegramUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

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
      `روح للموقع واختر المواد اللي تبي تراقبها 👇\njadwalik.com`);
  }

  if (text === '/stop') {
    const rows = await sb('GET', 'profiles',
      { query: `?telegram_chat_id=eq.${chatId}&select=id` });
    if (rows && rows.length) {
      await sb('PATCH', 'profiles', { query: `?id=eq.${rows[0].id}`, body: { telegram_chat_id: null } });
    }
    return sendMsg(chatId, `🔕 وقفت الإشعارات. تقدر ترجع تربط حسابك من الموقع أي وقت.`);
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

/* --- ملاحظات الطلاب --- */
async function adminFeedback() {
  let rows = [];
  try {
    const r = await sb('GET', 'feedback', { query: '?select=*&order=created_at.desc&limit=200' });
    if (Array.isArray(r)) rows = r.map(x => ({
      at: x.created_at ? Date.parse(x.created_at) : null,
      text: x.message, category: x.category,
      email: x.user_email, name: x.user_name, major: x.major, lang: x.lang,
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
    ttl: ttlReason(),
    cache: cacheSnapshot(),
    riyadhDate: riyadhDate(),
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

function coursesTTL() {
  if (currentWindow()) return TTL_PEAK;
  if (nearWindow())    return TTL_NEAR;
  return TTL_OFF;
}

/* لماذا المستوى الحالي؟ — للعرض في لوحة التحكم */
function ttlReason() {
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
const coursesCache = new Map();     // key → {at, courses}
const inFlight     = new Map();     // key → Promise (يمنع سحبتين متزامنتين لنفس التركيبة)

async function getCourses(term, college, gender) {
  const key = `${term}|${college}|${gender}`;
  OPS.searches++;
  const TTL = coursesTTL();
  const hit = coursesCache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
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
    const courses = parseHTML(await fetchPMUData(term, college, gender));
    coursesCache.set(key, { at: Date.now(), courses });
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
  { from: '2026-08-21', to: '2026-09-10', ar: 'تسجيل الترم الأول' },
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

function monitorState() {
  if (!MONITOR_ENABLED) {
    return { active: false, reason: 'disabled',
             ar: 'المراقبة معطّلة في هذي النسخة', en: 'Monitoring disabled on this instance',
             window: null, intervalMin: null };
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
  console.log(`next cycle in ${(delay / 60000).toFixed(1)} min — ${st.reason}`);
  setTimeout(async () => {
    if (monitorState().active) {
      try { await runMonitorCycle(); } catch (e) { console.log('cycle err', e.message); }
    }
    scheduleNextCycle();
  }, delay);
}

/* ============ HTTP server ============ */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('onrender.com') && !req.url.startsWith('/tg-webhook')) {
    /* 308 بدل 301: يحافظ على POST بدل ما المتصفح يحوّلها GET */
    res.writeHead(308, { Location: 'https://jadwalik.com' + req.url });
    res.end(); return;
  }

  const parsed = url.parse(req.url, true);

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
    res.setHeader('Content-Type', 'application/json');
    const { term = '202630', college = 'ALL', gender = 'M1' } = parsed.query;
    try {
      const r = await getCourses(term, college, gender);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true, count: r.courses.length,
        cached: r.cached, ageMs: r.age,
        ttlMin: Math.round(coursesTTL() / 60000),
        courses: r.courses
      }));
    } catch (err) {
      /* لو الجامعة تعطلت، نخدم آخر نسخة محفوظة بدل ما نفشل */
      OPS.lastError = { at: Date.now(), where: 'search', msg: err.message };
      const stale = coursesCache.get(`${term}|${college}|${gender}`);
      if (stale) {
        OPS.searchStale++;
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true, count: stale.courses.length,
          cached: true, stale: true, ageMs: Date.now() - stale.at,
          courses: stale.courses
        }));
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

      if (req.method === 'POST') {
        const b = await readBody(req);
        if (act === 'grant')  return send(200, await adminGrant(b.userId, b.days || 365));
        if (act === 'revoke') return send(200, await adminRevoke(b.userId));
        if (act === 'delete-review') return send(200, await adminDeleteReview(b));
        if (act === 'notify') return send(200, await adminNotify(b.userId, b.text || ''));
      }
      return send(404, { error: 'إجراء غير معروف' });
    } catch (e) {
      return send(500, { error: e.message });
    }
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
      lang:  b.lang === 'en' ? 'en' : 'ar'
    };

    /* نحفظها في Supabase لو الجدول موجود، وإلا نخزّنها بالذاكرة */
    let saved = false;
    try {
      const r = await sb('POST', 'feedback', {
        body: {
          user_email: entry.email, user_name: entry.name,
          category: entry.category, message: entry.text,
          major: entry.major, lang: entry.lang
        },
        prefer: 'return=minimal'
      });
      saved = !(r && r.code);        /* لو رجع كود خطأ فالجدول ناقص */
    } catch (e) { saved = false; }
    if (!saved) {
      FEEDBACK_MEM.unshift(entry);
      if (FEEDBACK_MEM.length > 200) FEEDBACK_MEM.pop();
    }
    OPS.feedback++;

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

  /* الأيقونات والمانيفست */
  if (/^\/(favicon-\d+\.png|manifest\.json|jadwalik-logo[\w-]*\.png)$/.test(parsed.pathname)) {
    try {
      const f = path.join(__dirname, parsed.pathname.slice(1));
      const buf = fs.readFileSync(f);
      res.setHeader('Content-Type',
        parsed.pathname.endsWith('.json') ? 'application/json' : 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.writeHead(200); res.end(buf);
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
    try {
      const html = fs.readFileSync(path.join(__dirname, 'pmu-schedule.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200); res.end(html);
    } catch (e) { res.writeHead(500); res.end('Page not found'); }
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log('Jadwalik running on ' + PORT);
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
