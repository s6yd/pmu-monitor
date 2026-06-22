const https = require('https');
const http = require('http');
const url = require('url');

const PORT = 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(msg) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  const text = encodeURIComponent(msg);
  const tUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${text}`;
  https.get(tUrl, () => {}).on('error', () => {});
}

// Fetch token + cookie from PMU homepage, then call getData
async function fetchPMUData(termList, collegeList, genderList) {
  return new Promise((resolve, reject) => {
    // Step 1: GET homepage to extract token + session cookie
    const options = {
      hostname: 'masterschedule.pmu.edu.sa',
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      const cookies = res.headers['set-cookie'] || [];
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Extract __RequestVerificationToken
        const tokenMatch = data.match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/);
        if (!tokenMatch) {
          // Try alternate pattern
          const altMatch = data.match(/__RequestVerificationToken[^>]+value="([^"]+)"/);
          if (!altMatch) {
            reject(new Error('Token not found'));
            return;
          }
        }
        const token = (tokenMatch || data.match(/__RequestVerificationToken[^>]+value="([^"]+)"/))[1];

        // Step 2: POST to getData
        const postData = new URLSearchParams({
          TermList: termList,
          CollegeList: collegeList,
          GenderList: genderList,
          DataTables_Table_1_length: '10000',
          __RequestVerificationToken: token,
          'X-Requested-With': 'XMLHttpRequest'
        }).toString();

        const postOptions = {
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
            'Origin': 'https://masterschedule.pmu.edu.sa',
          }
        };

        const postReq = https.request(postOptions, (postRes) => {
          let html = '';
          postRes.on('data', chunk => html += chunk);
          postRes.on('end', () => {
            resolve(html);
          });
        });

        postReq.on('error', reject);
        postReq.write(postData);
        postReq.end();
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function parseHTML(html) {
  const rows = [];
  const trMatches = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  
  for (const tr of trMatches) {
    const tds = tr.match(/<td>([\s\S]*?)<\/td>/g) || [];
    if (tds.length >= 9) {
      const getText = td => td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
      rows.push({
        crn: getText(tds[0]),
        courseCode: getText(tds[1]),
        courseTitle: getText(tds[2]),
        section: getText(tds[3]),
        courseDate: getText(tds[4]),
        courseTiming: getText(tds[5]),
        instructor: getText(tds[6]),
        room: getText(tds[7]),
        status: getText(tds[8]).toUpperCase()
      });
    }
  }
  return rows;
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  
  if (parsed.pathname === '/api/courses') {
    const { term = '202630', college = 'ALL', gender = 'M1', filter = '' } = parsed.query;

    
    try {
      console.log(`Fetching: term=${term} college=${college} gender=${gender}`);
      const html = await fetchPMUData(term, college, gender);
      const courses = parseHTML(html);
      console.log(`Got ${courses.length} courses`);
      res.writeHead(200);
      const openCourses = courses.filter(c => c.status === 'OPEN' && (!filter || c.courseCode.toUpperCase().includes(filter.toUpperCase()) || c.crn.includes(filter)));

if (openCourses.length > 0) {
  sendTelegram('🟢 يوجد ' + openCourses.length + ' مادة مفتوحة!\n' + openCourses.map(c => c.courseCode + ' Sec ' + c.section).join('\n'));
}

      res.end(JSON.stringify({ success: true, count: courses.length, courses }));
    } catch (err) {
      console.error('Error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  const fs = require('fs');
const path = require('path');
if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
  const html = fs.readFileSync(path.join(__dirname, 'pmu-schedule.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html');
  res.writeHead(200);
  res.end(html);
  return;
}
res.writeHead(404);
res.end(JSON.stringify({ error: 'Not found' }));

});

server.listen(PORT, () => {
  console.log(`PMU Monitor API running on http://localhost:${PORT}`);
  console.log(`Test: http://localhost:${PORT}/api/courses?term=202630&college=ALL&gender=M1`);
});
