/* فحص صياغة: server.js وكل سكربت داخل ملفات HTML.
   نفس فكرة check-html.py — لكن بـNode فيشتغل بلا بايثون.
   node tests/check-js.js [ملفات…] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['server.js', 'pmu-schedule.html', 'admin.html'];
let bad = 0;
for (const f of files) {
  const p = path.resolve(root, f);
  if (!fs.existsSync(p)) { console.log(`  ⚠︎ ${f}: غير موجود`); continue }
  if (f.endsWith('.js')) {
    try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); console.log(`  ✓ ${f}`) }
    catch (e) { bad++; console.log(`  ✗ ${f}: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`) }
    continue;
  }
  const src = fs.readFileSync(p, 'utf8');
  const blocks = [...src.matchAll(/<script(?![^>]*src=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/type="application\/(ld\+)?json"/.test(m[1]));
  let ok = true;
  blocks.forEach((m, i) => {
    try { new Function(m[2]) }
    catch (e) { ok = false; bad++; console.log(`  ✗ ${f} كتلة ${i}: ${e.message}`) }
  });
  if (ok) console.log(`  ✓ ${f} (${blocks.length} كتلة)`);
}
process.exit(bad ? 1 : 0);
