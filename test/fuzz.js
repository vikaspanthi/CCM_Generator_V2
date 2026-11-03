// Randomised robustness test: node test/fuzz.js  (planner + document writer must never throw, no topic may be lost)
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/data.js'), 'utf8'));
const P = require('../planner.js'), D = require('../docgen.js'), S = require('../sample.js');
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const words = 'loops arrays strings files pointers classes graphs trees sorting hashing recursion threads sockets gui regex sets maps'.split(' ');
(async () => {
  let ok = 0;
  for (let n = 0; n < 300; n++) {
    const cfg = JSON.parse(JSON.stringify(S));
    cfg.units = Array.from({ length: ri(1, 9) }, (_, i) => ({ title: rnd() < .5 ? 'U' + i : '', hours: rnd() < .15 ? 0 : ri(1, 12), sos: '', cos: 'CO' + ri(1, 3), activity: rnd() < .5,
      topics: Array.from({ length: ri(1, 14) }, () => words[ri(0, words.length - 1)] + ri(0, 99)).join(rnd() < .5 ? ', ' : '\n') }));
    cfg.lectures = ri(1, 45); cfg.guestLectures = ri(0, 4); cfg.experiments = rnd() < .5 ? [] : cfg.experiments.slice(0, ri(1, 12));
    if (rnd() < .2) cfg.dateList = Array.from({ length: ri(1, 30) }, (_, i) => '2026-08-' + String(1 + (i % 28)).padStart(2, '0'));
    if (rnd() < .2) { cfg.cos = cfg.cos.slice(0, ri(1, 3)); }
    const sessions = P.buildPlan(cfg);
    const want = cfg.dateList ? cfg.dateList.length : cfg.lectures;
    if (sessions.length !== want) throw new Error(`#${n}: got ${sessions.length} sessions, wanted ${want}`);
    // every topic must be kept in some lecture / practice / activity session (unless there is nothing but guest sessions)
    const text = sessions.map(s => s.topic).join(' | ');
    cfg.units.forEach(u => P.splitTopics(u.topics).forEach(t => { if (!text.includes(t)) throw new Error(`#${n}: topic lost: ${t}`); }));
    const qp = P.buildQuestionPaper(cfg); cfg.sessions = sessions; cfg.qp = qp;
    const bytes = await D.generate(cfg); if (bytes.length < 2000) throw new Error('tiny docx');
    ok++;
  }
  console.log('fuzz ok:', ok, 'random configurations');
})().catch(e => { console.error('FUZZ FAIL', e.message); process.exit(1); });
