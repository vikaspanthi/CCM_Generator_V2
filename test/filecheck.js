// node test/filecheck.js [url]  -> uploads the sample syllabus; prints the syllabus message
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const url = process.argv[2] || 'file://' + path.resolve(__dirname, '../index.html');
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = [];
  pg.on('console', m => m.type() === 'error' && errs.push(m.text().slice(0, 160))); pg.on('pageerror', e => errs.push('PAGEERR ' + e.message.slice(0, 160)));
  await pg.goto(url);
  await pg.setInputFiles('#fileSyllabus', path.join(__dirname, 'sample-syllabus.pdf'));
  await pg.waitForFunction(() => /Filled|could not|no selectable/.test(document.querySelector('#syllMsg').textContent), null, { timeout: 30000 });
  console.log((await pg.textContent('#syllMsg')).slice(0, 300)); console.log('errors:', errs); await b.close();
})();
