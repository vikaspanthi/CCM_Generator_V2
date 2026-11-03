// End-to-end over many syllabi: node test/e2e.js
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.resolve(__dirname, '..'); const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
const out = path.join(__dirname, 'e2e-out'); fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0]; const f = path.join(root, decodeURIComponent(u === '/' ? '/index.html' : u)); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, async () => {
  const b = await chromium.launch(); let bad = 0;
  const cases = [['sample-syllabus.pdf', true], ['fixtures/B_modules.pdf', false], ['fixtures/C_roman_units.pdf', false], ['fixtures/D_lab_only.pdf', false], ['fixtures/E_multi_course.pdf', false]];
  for (const [pdf, withClass] of cases) for (const lectures of withClass ? [22] : [22, 12]) {
    const pg = await b.newPage({ acceptDownloads: true }); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await pg.goto(`http://localhost:${srv.address().port}/`);
    await pg.setInputFiles('#fileSyllabus', path.join(__dirname, pdf));
    await pg.waitForFunction(() => /Filled|could not|no selectable/.test(document.querySelector('#syllMsg').textContent), null, { timeout: 30000 });
    await pg.fill('[data-k="course.slot"]', 'F11+F12'); await pg.fill('[data-k="course.faculty"]', 'Dr Test Faculty'); await pg.fill('[data-k="course.semester"]', 'Fall Semester 2026-27');
    if (withClass) { await pg.setInputFiles('#fileClasses', path.join(__dirname, 'sample-vtop.html')); await pg.waitForTimeout(300); } else await pg.fill('[data-k="lectures"]', String(lectures));
    await pg.click('#btnPlan'); await pg.waitForTimeout(200);
    const n = await pg.locator('.sess').count(); const title = await pg.inputValue('[data-k="course.title"]');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#btnDoc')]);
    const file = path.join(out, `${path.basename(pdf, '.pdf')}_${lectures}.docx`); await dl.saveAs(file);
    let pages = '?'; try { execSync(`cd ${out} && soffice --headless --convert-to pdf ${path.basename(file)} >/dev/null 2>&1`); pages = execSync(`pdfinfo ${file.replace('.docx', '.pdf')} | grep Pages`).toString().trim(); } catch (e) { pages = 'CONVERT FAILED'; bad++; }
    const status = errs.length || pages === 'CONVERT FAILED' ? 'FAIL' : 'ok';
    if (status === 'FAIL') bad++;
    console.log(status.padEnd(4), path.basename(pdf).padEnd(22), 'want', String(withClass ? 22 : lectures).padEnd(3), 'sessions', String(n).padEnd(3), '|', title, '|', pages, errs.length ? errs : '');
    await pg.close();
  }
  console.log(bad ? bad + ' FAILURES' : 'ALL PASSED'); await b.close(); srv.close(); process.exit(bad ? 1 : 0);
});
