// Node smoke test: node test/generate.js  -> writes test/out.docx
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/data.js'), 'utf8'));
const P = require('../planner.js'), D = require('../docgen.js'), S = require('../sample.js');
(async () => {
  const cfg = JSON.parse(JSON.stringify(S));
  const sessions = P.buildPlan(cfg);
  console.log('sessions:', sessions.length);
  sessions.forEach(s => console.log(String(s.no).padStart(2), s.type.padEnd(8), s.coTag.padEnd(8), s.topic.slice(0, 70), '|', s.after.slice(0, 40)));
  cfg.sessions = sessions; cfg.qp = P.buildQuestionPaper(cfg);
  const bytes = await D.generate(cfg);
  fs.writeFileSync(path.join(__dirname, 'out.docx'), bytes);
  console.log('docx bytes', bytes.length);
})();
