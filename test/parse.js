// node test/parse.js file1.pdf file2.pdf ...   (prints what the syllabus reader finds, using the bundled pdf.js in Chromium)
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': /\.m?js$/.test(f) ? 'text/javascript' : 'text/html' }); r.end(d); } }); }).listen(0, async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); pg.on('pageerror', e => console.error('PAGEERR', e.message));
  await pg.goto(`http://localhost:${srv.address().port}/test/blank.html`); await pg.addScriptTag({ url: '/lib/pdfjs-worker.js' }); await pg.addScriptTag({ url: '/lib/pdfjs-main.js' });
  for (const f of process.argv.slice(2)) {
    const b64 = fs.readFileSync(f).toString('base64');
    const out = await pg.evaluate(async b64 => {
      const pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = '/lib/pdfjs-worker.js';
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const text = await window.CCMSyllabus.textFromPdf(pdfjs, u.buffer);
      return { text, courses: window.CCMSyllabus.splitCourses(text).map(t => window.CCMSyllabus.parseSyllabus(t)) };
    }, b64);
    if (process.env.RAW) console.log(out.text);
    console.log('=====', path.basename(f), '| courses:', out.courses.length);
    out.courses.forEach(p => {
      console.log(JSON.stringify(p.course), '| prereq:', p.prereq || p.course.prereq);
      console.log(' obj:', p.objectives.length, '| cos:', p.cos.length, p.cos.map(c => c.text.slice(0, 28)).join(' / '));
      p.units.forEach((u, i) => console.log(`  U${i + 1} h=${u.hours} sos=${u.sos} ${u.cos} [${u.title.slice(0, 30)}] ${u.topics.slice(0, 50).replace(/\n/g, ' / ')}… (${u.topics.length}ch)`));
      console.log(' guest:', p.guestHours, p.guestTitle, '| total:', p.totalHours, '| books:', p.textBooks.length, p.refBooks.length, '| exps:', p.experiments.length, '| bos:', p.bos, '| appr:', p.approval);
      console.log(' warnings:', p.warnings);
    });
  }
  await b.close(); srv.close();
});
