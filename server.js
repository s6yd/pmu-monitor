const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
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
    if (!TELEGRAM_TOKEN) return resolve(null);
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let o=''; res.on('data',c=>o+=c); res.on('end',()=>{ try{resolve(JSON.parse(o))}catch(e){resolve(null)} }); });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
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

/* ============ HTTP server ============ */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
