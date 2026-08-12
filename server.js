const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

/* ============================================================
   PRO_KEYS: المستخدمين المسموح لهم بالمراقبة والإشعارات
   في Render اكتب المتغير بهذا الشكل (مفصول بفاصلة):
   mohammad=731902558,ahmed=123456789
   ============================================================ */
function getProKeys() {
  const raw = process.env.PRO_KEYS || '';
  const map = {};
  raw.split(',').forEach(pair => {
    const [k, chat] = pair.split('=');
    if (k && chat) map[k.trim()] = chat.trim();
  });
  return map;
}

/* منع تكرار نفس الرسالة — 20 دقيقة بين كل إشعار لنفس المادة */
const lastSent = {};
function shouldSend(key, crn) {
  const id = key + ':' + crn;
  const now = Date.now();
  if (lastSent[id] && now - lastSent[id] < 20 * 60 * 1000) return false;
  lastSent[id] = now;
  return true;
}

function sendTelegram(chatId, msg) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  const u = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(msg)}`;
  https.get(u, r => r.resume()).on('error', () => {});
}

/* ================= PMU FETCH ================= */
function fetchPMUData(termList, collegeList, genderList) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'masterschedule.pmu.edu.sa',
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, res => {
      let data = '';
      const cookies = res.headers['set-cookie'] || [];
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(/__RequestVerificationToken[^>]+value="([^"]+)"/);
        if (!m) return reject(new Error('Token not found'));
        const token = m[1];

        const postData = new URLSearchParams({
          TermList: termList,
          CollegeList: collegeList,
          GenderList: genderList,
          DataTables_Table_1_length: '10000',
          __RequestVerificationToken: token,
          'X-Requested-With': 'XMLHttpRequest'
        }).toString();

        const pReq = https.request({
          hostname: 'masterschedule.pmu.edu.sa',
          path: '/Home/getData',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Content-Length': Buffer.byteLength(postData),
            'Cookie': cookieStr,
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://masterschedule.pmu.edu.sa/',
            'Origin': 'https://masterschedule.pmu.edu.sa'
          }
        }, pRes => {
          let html = '';
          pRes.on('data', c => html += c);
          pRes.on('end', () => resolve(html));
        });
        pReq.on('error', reject);
        pReq.write(postData);
        pReq.end();
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseHTML(html) {
  const rows = [];
  const trs = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  for (const tr of trs) {
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

/* ================= SERVER ================= */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  /* تحويل الرابط القديم إلى الدومين الجديد */
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('onrender.com')) {
    res.writeHead(301, { Location: 'https://jadwalik.com' + req.url });
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/api/courses') {
    res.setHeader('Content-Type', 'application/json');
    const { term = '202630', college = 'ALL', gender = 'M1', filter = '', key = '' } = parsed.query;
    try {
      const html = await fetchPMUData(term, college, gender);
      const courses = parseHTML(html);

      const keys = getProKeys();
      const chatId = key && keys[key];

      if (chatId && filter) {
        const f = filter.toUpperCase();
        const open = courses
          .filter(c => c.status === 'OPEN' &&
            (c.courseCode.toUpperCase().includes(f) || c.crn.includes(filter)))
          .filter(c => shouldSend(key, c.crn));
        if (open.length) {
          const msg = '🟢 فتحت مادة!\n\n' +
            open.map(c => `${c.courseCode} §${c.section}\nCRN: ${c.crn}\n${c.courseDate} ${c.courseTiming}\n${c.instructor || ''}`).join('\n\n') +
            '\n\nسجّل الحين!';
          sendTelegram(chatId, msg);
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, count: courses.length, pro: !!chatId, courses }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/check') {
    res.setHeader('Content-Type', 'application/json');
    const keys = getProKeys();
    res.writeHead(200);
    res.end(JSON.stringify({ valid: !!keys[parsed.query.key || ''] }));
    return;
  }

  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'pmu-schedule.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Page not found');
    }
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log('PMU Monitor running on ' + PORT));
