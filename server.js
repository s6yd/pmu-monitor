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
async function runMonitorCycle() {
  if (!SB_URL || !SB_SERVICE_KEY) return;
  try {
    const monitors = await sb('GET', 'monitored_courses', { query: '?select=*' });
    if (!Array.isArray(monitors) || !monitors.length) return;

    const terms = [...new Set(monitors.map(m => m.term || '202630'))];
    const snapshot = {};

    for (const term of terms) {
      try {
        const html = await fetchPMUData(term, 'ALL', 'ALL');
        parseHTML(html).forEach(c => { snapshot[term + ':' + c.crn] = c; });
      } catch (e) { console.log('fetch fail', term, e.message); }
      await new Promise(r => setTimeout(r, 1500));  // فاصل بسيط بين الترمات
    }

    const now = new Date().toISOString();
    const profileCache = {};

    for (const m of monitors) {
      const live = snapshot[(m.term || '202630') + ':' + m.crn];
      if (!live) continue;

      const opened = live.status === 'OPEN' && m.last_status !== 'OPEN';

      if (live.status !== m.last_status) {
        await sb('PATCH', 'monitored_courses',
          { query: `?id=eq.${m.id}`, body: { last_status: live.status } });
      }
      if (!opened) continue;

      /* تحقق من الاشتراك والتيليغرام */
      if (!profileCache[m.user_id]) {
        const p = await sb('GET', 'profiles',
          { query: `?id=eq.${m.user_id}&select=telegram_chat_id,is_pro,subscription_expires_at` });
        profileCache[m.user_id] = (p && p[0]) || {};
      }
      const prof = profileCache[m.user_id];
      const active = prof.is_pro ||
        (prof.subscription_expires_at && new Date(prof.subscription_expires_at) > new Date());
      if (!active || !prof.telegram_chat_id) continue;

      await sendMsg(prof.telegram_chat_id,
        `🟢 <b>فتحت مادة!</b>\n\n` +
        `<b>${live.courseCode}</b> — شعبة ${live.section}\n` +
        `${live.courseTitle}\n\n` +
        `🔢 CRN: <code>${live.crn}</code>\n` +
        `📅 ${live.courseDate}  ⏰ ${live.courseTiming}\n` +
        `👤 ${live.instructor || '—'}\n` +
        `🏛️ ${live.room || '—'}\n\n` +
        `⚡️ سجّل الحين قبل ما تنسكر!`);

      await sb('PATCH', 'monitored_courses',
        { query: `?id=eq.${m.id}`, body: { notified_at: now } });
    }
  } catch (e) { console.log('monitor cycle error', e.message); }
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

/* --- فحص صحة الإعدادات --- */
async function adminHealth() {
  const out = {
    telegramToken: TELEGRAM_TOKEN ? 'مضبوط' : 'ناقص',
    supabase: SB_URL && SB_SERVICE_KEY ? 'مضبوط' : 'ناقص',
    telegramOk: false, telegramName: null, telegramError: null
  };
  if (TELEGRAM_TOKEN) {
    const me = await tg('getMe', {});
    if (me && me.ok) { out.telegramOk = true; out.telegramName = '@' + me.result.username; }
    else out.telegramError = (me && me.description) || 'ما وصل رد من تيليغرام';
  }
  return out;
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

/* ============ HTTP server ============ */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('onrender.com') && !req.url.startsWith('/tg-webhook')) {
    res.writeHead(301, { Location: 'https://jadwalik.com' + req.url });
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
      const courses = parseHTML(await fetchPMUData(term, college, gender));
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, count: courses.length, courses }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
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

  /* تشغيل دورة فحص يدوياً (للاختبار) */
  if (parsed.pathname === '/api/run-check') {
    res.setHeader('Content-Type', 'application/json');
    runMonitorCycle();
    res.writeHead(200); res.end(JSON.stringify({ started: true }));
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
  setInterval(runMonitorCycle, CHECK_INTERVAL);
  setTimeout(runMonitorCycle, 20000);
});
