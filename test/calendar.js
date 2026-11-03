// Academic calendar end-to-end: node test/calendar.js   (needs playwright; NODE_PATH=$(npm root -g))
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('../academic.js');
const root = path.resolve(__dirname, '..'); const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0] === '/' ? '/index.html' : q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, async () => {
  const b = await chromium.launch(); let bad = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
  const run = async (term, days, n, extra) => {
    const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(`http://localhost:${srv.address().port}/`);
    await pg.setInputFiles('#fileSyllabus', path.join(__dirname, 'sample-syllabus.pdf'));
    await pg.waitForFunction(() => /Filled/.test(document.querySelector('#syllMsg').textContent), null, { timeout: 30000 });
    await pg.setInputFiles('#fileCalendar', path.join(__dirname, 'fixtures/academic-calendar-2026-27.pdf'));
    await pg.waitForFunction(() => /Read \d+ semester/.test(document.querySelector('#calMsg').textContent), null, { timeout: 30000 });
    await pg.selectOption('#termSel', { label: term + ' Semester 2026-27' });
    await pg.fill('[data-k="course.slot"]', 'F11+F12'); await pg.fill('[data-k="course.faculty"]', 'Dr Test');
    for (const w of [1, 2, 3, 4, 5]) await pg.setChecked(`.wd[value="${w}"]`, days.includes(w));
    await pg.fill('[data-k="lectures"]', String(n));
    if (extra) await extra(pg);
    await pg.click('#btnPlan'); await pg.waitForTimeout(300);
    const dates = await pg.$$eval('.sess summary span:nth-child(2)', els => els.map(e => e.textContent));
    const warn = await pg.$eval('#planWarn', e => e.textContent);
    const summary = await pg.$eval('#calSummary', e => e.textContent.slice(0, 200));
    return { pg, dates, warn, summary, errs };
  };
  const mon = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const iso = s => { const [d, m, y] = s.split('-'); return `20${y}-${String(mon[m]).padStart(2, '0')}-${d}`; };
  const cal = C.parseCalendar(fs.readFileSync('/tmp/cal.txt', 'utf8'));
  for (const [term, days, n] of [['Fall', [2, 4], 22], ['Winter', [2, 4], 22], ['Fall', [1, 3, 5], 40], ['Winter', [1, 2, 3, 4, 5], 60]]) {
    const t = cal.terms.find(x => x.term === term); const r = await run(term, days, n);
    const ds = r.dates.map(iso); const all = C.classDays(t).filter(x => days.includes(x.order)).map(x => x.iso);
    console.log(term, days.join(''), n, '->', r.dates.length, r.dates[0], '…', r.dates[r.dates.length - 1], '|', r.warn.slice(0, 120));
    ok(!r.errs.length, 'no page errors ' + r.errs.join(';'));
    ok(ds.length === Math.min(n, all.length) && ds.every((d, i) => d === all[i]), 'dates are the first ' + n + ' class days of ' + term);
    ok(ds.every(d => d >= t.first && d <= t.last), 'all inside first..last instructional day');
    ok(ds.every(d => !C.blockedBy(t, d)), 'none on a holiday / CAT week');
    await r.pg.close();
  }
  // VTOP dates (July 2026) against the Winter term should warn, against Fall should be clean
  for (const term of ['Fall', 'Winter']) {
    const r = await run(term, [2, 4], 22, async pg => { await pg.setInputFiles('#fileClasses', path.join(__dirname, 'sample-vtop.html')); await pg.waitForTimeout(400); });
    console.log('VTOP vs', term, '|', r.warn.slice(0, 200).replace(/\s+/g, ' '));
    ok(term === 'Fall' ? !/Check these dates/.test(r.warn) || /holiday|CAT/.test(r.warn) : /outside|before the first/.test(r.warn), 'VTOP dates checked against ' + term);
    await r.pg.close();
  }
  console.log(bad ? bad + ' FAILURES' : 'ALL PASSED'); await b.close(); srv.close(); process.exit(bad ? 1 : 0);
});
