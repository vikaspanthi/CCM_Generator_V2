/* Syllabus PDF -> form data (VIT style syllabi).
   textFromPdf(pdfjsLib, ArrayBuffer) rebuilds text lines from a PDF (columns are separated by 3+ spaces).
   splitCourses(text) cuts a multi-course PDF into one text per course.
   parseSyllabus(text) turns one course's lines into form fields. Never throws: problems become `warnings`.
   Works in the browser and in Node. */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ PDF -> lines
  async function textFromPdf(pdfjs, data) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str !== undefined && (i.str.trim() !== '' || i.width > 0))
        .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || 10 }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      items.forEach(it => {
        const tol = Math.max(2.5, it.h * 0.4);
        const ln = lines.find(l => Math.abs(l.y - it.y) <= tol);
        if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
      });
      lines.sort((a, b) => b.y - a.y);
      lines.forEach(l => {
        l.items.sort((a, b) => a.x - b.x);
        let s = '', end = null;
        l.items.forEach(it => {
          if (end !== null) {
            const gap = it.x - end;
            if (gap > 14) s += '   '; else if (gap > 1.2 && !/\s$/.test(s) && !/^\s/.test(it.s)) s += ' ';
          }
          s += it.s; end = it.x + it.w;
        });
        if (s.trim()) out.push(s.replace(/\s+$/, ''));
      });
      out.push('\f');
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------ helpers
  const BUL_CH = '\\u2022\\u25CF\\u25AA\\u25A0\\u25E6\\u2023\\u2043\\u2219\\u00B7\\uF0B7\\uF0A7\\uF076\\uF0D8\\uF0FC\\uF02D\\u2013\\u2014\\u25AB\\u27A2\\u2192';
  const BUL_START = new RegExp('^\\s*[' + BUL_CH + '*]\\s*');
  const squash = s => String(s == null ? '' : s).replace(/[-]/g, ' ').replace(/\s+/g, ' ').trim();
  const find = (lines, re, from, to) => { for (let i = from || 0; i < (to == null ? lines.length : to); i++) if (re.test(lines[i])) return i; return -1; };
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const STOP = new Set('the a an of and or to in for on with by from at as is are be this that these those using use students will able should course into its their it can have has one two what how'.split(' '));
  const stem = w => w.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
  function tokens(s, extra) { return new Set(String(s).split(/[^A-Za-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w.toLowerCase()) && !(extra && extra.has(w.toLowerCase()))).map(stem)); }

  const HDR = {
    objectives: /^\s*(course\s+(educational\s+|learning\s+)?objectives?|objectives?\s+of\s+the\s+course|objectives?)\s*[:\-]?/i,
    outcomes: /^\s*((expected\s+)?course\s+(learning\s+)?outcomes?(\s*\(cos?\))?|course\s+outcomes?|learning\s+outcomes?|expected\s+(learning\s+)?outcomes?|cos?\s*:)\s*[:\-]?/i,
    studentOutcomes: /^\s*(student\s+(learning\s+)?outcomes?|program(me)?\s+outcomes?)/i,
    unitTable: /unit\s+content|unit\s+no\.?\s*$|^\s*unit\s+no/i,
    module: /^\s*(?:module|unit|chapter)\s*[:\-.#]?\s*(\d{1,2}|[IVX]{1,4})\b\s*[:\-.–—]?\s*(.*)$/i,
    stop: /^\s*(total\s+(lecture|contact|laboratory|lab|practical|hours?)|text\s*books?|reference\s*books?|references?\b|mode\s+of\s+(evaluation|teaching|assessment)|recommended\s+by|recommendation\s+by|approved\s+by|approval\s+by|list\s+of\s+(challenging\s+|suggested\s+|indicative\s+)*(experiments|practicals?|projects)|indicative\s+experiments|laboratory\s+experiments|lab\s+experiments|compiled\s+by|suggested\s+tools)/i,
    textBooks: /^\s*(text\s*books?(\s*\(s\))?|textbooks?|text\s*book\(s\)|prescribed\s+books?)\s*[:\-]?\s*$/i,
    refBooks: /^\s*(reference\s*books?(\s*\(s\))?|references?|reference\s+book\(s\))\s*[:\-]?\s*$/i,
    experiments: /^\s*(list\s+of\s+(challenging\s+|suggested\s+|indicative\s+|laboratory\s+|lab\s+)*(experiments|practicals?)|(indicative|laboratory|lab|suggested)\s+experiments|experiments?\s*(\(indicative\))?\s*:?)\s*(\(indicative\))?\s*[:\-]?\s*$/i,
    guest: /guest\s+lecture|contemporary\s+(topics|issues)|industry\s+expert|expert\s+lecture/i
  };
  // course header: "CODE  Title  L T P J C"  or  "Title / CODE  TYPE  CREDITS"
  const RE_LTPJC = /^\s*([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\s+(.+?)\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d(?:\.\d)?)\s*$/;
  const RE_CTC = /^\s*([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\s+([A-Z]{1,4})\s+(\d(?:\.\d)?)\s*$/;

  function cleanLines(text, pages) {
    let lines = String(text).replace(/\r/g, '').split('\n').map(l => l.replace(/[ ​]/g, ' ').replace(/\s+$/, ''));
    lines = lines.filter(l => l === '\f' || l.trim() !== '');
    const freq = {};
    lines.forEach(l => { const k = squash(l); if (k && k !== '\f') freq[k] = (freq[k] || 0) + 1; });
    return lines.filter(l => {
      if (l === '\f') return false;
      const k = squash(l);
      if (/^(page\s+)?\d+\s*(of|\/)\s*\d+$/i.test(k) || /^page\s+\d+$/i.test(k)) return false;
      if (pages >= 3 && freq[k] >= 3 && k.length < 110 && !/^\d+$/.test(k) && !HDR.module.test(k) && !/^\d+[.)]\s/.test(k)) return false; // running headers/footers
      return true;
    });
  }

  // Split a PDF that holds several courses into one text per course.
  function splitCourses(text) {
    const raw = String(text).replace(/\r/g, '').split('\n');
    const marks = [];
    raw.forEach((l, i) => {
      const m = l.match(RE_LTPJC) || l.match(RE_CTC);
      if (m) {
        let start = i;
        for (let k = i - 1; k >= Math.max(0, i - 3); k--) if (/course\s+code|course\s+title/i.test(raw[k])) { start = k; break; }
        if (!RE_LTPJC.test(l) && start === i && i > 0 && raw[i - 1].trim()) start = i - 1; // title line above
        marks.push({ code: m[1].replace(/\s/, ''), start, line: i });
      }
    });
    const uniq = []; marks.forEach(m => { if (!uniq.some(u => u.code === m.code)) uniq.push(m); });
    if (uniq.length < 2) return [String(text)];
    return uniq.map((m, i) => raw.slice(i === 0 ? 0 : m.start, i + 1 < uniq.length ? uniq[i + 1].start : raw.length).join('\n'));
  }

  // ------------------------------------------------------------ list reader
  // Reads numbered / bulleted / sentence lists with wrapped lines.
  function listItems(seg, opt) {
    opt = opt || {};
    const NUM = opt.loose ? /^\s*(?:CO\s?\d{1,2}|\(?\d{1,2}\)?)[.):\-]?\s+(?=\S)/i : /^\s*(?:CO\s?\d{1,2}|\(?\d{1,2}\))\s*[.):\-]\s*(?=\S)|^\s*CO\s?\d{1,2}\s+(?=\S)|^\s*\d{1,2}[.)]\s*(?=\S)/i;
    const numbered = seg.filter(l => NUM.test(l)).length;
    const bulleted = seg.filter(l => BUL_START.test(l) && /[-]|^\s*[•●▪■◦*]/.test(l) && l.replace(BUL_START, '').trim()).length;
    const items = [];
    if (numbered >= (opt.minNum || 1) && numbered >= bulleted) {
      let expect = 1;
      seg.forEach(l => {
        const m = l.match(NUM);
        const num = m ? Number((m[0].match(/\d+/) || [0])[0]) : -1;
        if (m && (!opt.sequential || num === expect)) { items.push(squash(l.slice(m[0].length))); expect++; }
        else if (items.length) items[items.length - 1] += ' ' + squash(l);
      });
    } else if (bulleted >= 1) {
      seg.forEach(l => {
        if (BUL_START.test(l) && /[-]|^\s*[•●▪■◦*]/.test(l)) { const t = squash(l.replace(BUL_START, '')); if (t) items.push(t); }
        else if (items.length) items[items.length - 1] += ' ' + squash(l);
      });
    } else {
      const k = seg.findIndex(l => /[:]\s*$/.test(l.trim()));
      const body = squash((k >= 0 ? seg.slice(k + 1) : seg).join(' '));
      body.split(/(?<=[.;])\s+(?=[A-Z(])/).forEach(s => { s = squash(s); if (s.length > 3) items.push(s); });
    }
    return items.map(s => s.replace(/\s+([,.;])/g, '$1')).filter(Boolean);
  }
  const endDot = s => (/[.!?]$/.test(s) ? s : s + '.');

  // ------------------------------------------------------------ main parser
  function parseSyllabus(raw) {
    const res = { course: {}, objectives: [], cos: [], units: [], experiments: [], textBooks: [], refBooks: [], warnings: [] };
    try { parseInto(raw, res); }
    catch (e) { res.warnings.push('The syllabus could not be read completely (' + e.message + '). Please fill the missing parts by hand.'); }
    return res;
  }

  function parseInto(raw, res) {
    const pages = (String(raw).match(/\f/g) || []).length;
    const lines = cleanLines(raw, pages);
    const all = lines.join('\n');
    if (!lines.length) { res.warnings.push('No text found.'); return; }

    // ---- code / title / L-T-P-J-C / credits
    let m, ci = -1;
    for (let i = 0; i < lines.length && i < 60; i++) {
      if ((m = lines[i].match(RE_LTPJC))) {
        ci = i; res.course.code = m[1].replace(/\s/, ''); res.course.title = squash(m[2]).replace(/\s*L\s*T\s*P\s*J\s*C\s*$/i, '');
        const [L, T, P, J] = [m[3], m[4], m[5], m[6]].map(Number);
        res.course.credits = Number(m[7]); res.course.type = ['L', 'T', 'P', 'J'].filter((_, k) => [L, T, P, J][k] > 0).join('') || 'L';
        res.course.ltpjc = [L, T, P, J, Number(m[7])];
        break;
      }
      if ((m = lines[i].match(RE_CTC))) {
        ci = i; res.course.code = m[1].replace(/\s/, ''); res.course.type = m[2]; res.course.credits = Number(m[3]);
        for (let k = i - 1; k >= 0 && k >= i - 3; k--) { // title is the nearest line above that is not a column header
          const t = squash(lines[k].replace(/Course Code|Course Type|Credits|Course Title|Title/gi, ''));
          if (t) { res.course.title = t; break; }
        }
        break;
      }
    }
    if (ci < 0) { // labelled fields: "Course Code: XXX", "Course Title: YYY"
      if ((m = all.match(/Course\s+Code\s*[:\-]?\s*([A-Z]{2,5}\s?\d{3,4}[A-Z]?)/i))) res.course.code = m[1].replace(/\s/, '');
      if ((m = all.match(/Course\s+Title\s*[:\-]?\s*(.+)/i))) res.course.title = squash(m[1].split(/\s{3,}/)[0]);
      if ((m = all.match(/\bcredits?\s*[:\-]?\s*(\d(?:\.\d)?)/i))) res.course.credits = Number(m[1]);
      if (!res.course.code && (m = all.match(/\b([A-Z]{3,4}\d{4})\b/))) res.course.code = m[1];
      if (!res.course.code) res.warnings.push('Course code not found.');
      if (!res.course.title) res.warnings.push('Course title not found.');
    }
    if (!res.course.type) { if ((m = all.match(/Course\s+Type\s*[:\-]?\s*([A-Z]{1,4})\b/))) res.course.type = m[1]; }

    // ---- pre-requisite
    const pi = find(lines, /^\s*pre-?requisites?/i);
    if (pi >= 0) {
      let t = lines[pi].replace(/^\s*pre-?requisites?( knowledge)?( is required on)?\s*[:\-]?\s*/i, '');
      let k = pi + 1;
      if (!t || /^syllabus version/i.test(t)) { t = t.replace(/syllabus version.*$/i, ''); }
      while (k < lines.length && k < pi + 3 && !HDR.objectives.test(lines[k]) && !/^\s*(course|syllabus)/i.test(lines[k]) && !/^\s*\d+[.)]/.test(lines[k]) && /^[a-z]/.test(squash(lines[k]).charAt(0)) ) { t += ' ' + lines[k]; k++; }
      t = squash(t.replace(/\s{3,}syllabus version.*$/i, '').replace(/syllabus version\s*[:\-]?\s*[\d.]*/i, ''));
      res.course.prereq = /^(nil|none|-|na|n\/a)\.?$/i.test(t) ? 'NIL' : t.replace(/\.$/, '');
    }

    // ---- objectives & outcomes
    const oi = find(lines, HDR.objectives);
    const coi = find(lines, HDR.outcomes, oi >= 0 ? oi + 1 : 0);
    const afterCO = (from) => {
      let e = lines.length;
      for (let i = from + 1; i < lines.length; i++) {
        if (HDR.studentOutcomes.test(lines[i]) || HDR.module.test(lines[i]) || HDR.unitTable.test(lines[i]) || /^\s*(course\s+content|syllabus|module\s*:?\s*\d)/i.test(lines[i]) || HDR.stop.test(lines[i])) { e = i; break; }
      }
      return e;
    };
    if (oi >= 0) {
      const end = coi > oi ? coi : Math.min(lines.length, oi + 12);
      res.objectives = listItems(lines.slice(oi + 1, end).filter(l => !/^\s*the\s+course\s+(is|aims)\b.*(to|:)\s*$/i.test(l))).map(endDot);
    }
    if (coi >= 0) {
      const end = afterCO(coi);
      const seg = lines.slice(coi + 1, Math.min(end, coi + 40));
      const intro = seg.findIndex(l => /(should be able to|will be able to|able to do the following|following)\s*:?\s*$/i.test(l.trim()));
      res.cos = listItems(intro >= 0 ? seg.slice(intro + 1) : seg).map(t => t.replace(/\s*\[[^\]]*\]\s*$/, '')).map(endDot).map((text, i) => ({ id: 'CO' + (i + 1), text }));
    }

    // ---- units: module style first, then the VIT "Unit Content" table
    let guestHours, guestTitle, totalHours, labHours;
    const mod = [];
    lines.forEach((l, i) => { const mm = l.match(HDR.module); if (mm && i > Math.max(coi, 0)) { const n = /^\d/.test(mm[1]) ? Number(mm[1]) : ROMAN[mm[1].toUpperCase()]; if (n) mod.push({ i, n, rest: mm[2] }); } });
    // keep a consecutive 1..k sequence starting at the first "1"
    const seq = []; mod.forEach(x => { if (x.n === seq.length + 1) seq.push(x); });
    if (seq.length >= 1) {
      seq.forEach((x, k) => {
        let end = k + 1 < seq.length ? seq[k + 1].i : lines.length;
        for (let j = x.i + 1; j < end; j++) if (HDR.stop.test(lines[j])) { end = j; break; }
        let head = squash(x.rest), hours = '';
        const hm = head.match(/\(?\b(\d{1,2})\s*(?:hours?|hrs?\.?|h)\b\)?\s*$/i) || x.rest.match(/\s{2,}(\d{1,2})\s*$/);
        if (hm) { hours = hm[1]; head = squash(head.replace(hm[0], '').replace(/\(\s*$/, '')); }
        const body = lines.slice(x.i + 1, end).map(l => l.replace(/\s{3,}(\d{1,2}\s*(hours?|hrs?)?)\s*$/i, '')).join(' ');
        const topics = squash(body).replace(/\s+,/g, ',');
        if (HDR.guest.test(head)) { guestHours = Number(hours) || 2; guestTitle = head; return; }
        res.units.push({ title: head.replace(/[:\-]\s*$/, ''), hours: Number(hours) || 0, sos: '', cos: '', topics: topics || head, activity: true });
      });
    } else {
      const hi = find(lines, HDR.unitTable);
      if (hi >= 0) {
        const ti = lines.findIndex((l, i) => i > hi && /total\s+(lecture\s+)?hours/i.test(l));
        const block = lines.slice(hi + 1, ti > hi ? ti + 1 : undefined);
        const units = []; const extra = []; let cur = null;
        block.forEach(l => {
          const mm = l.match(/^\s*(\d{1,2})\s{1,}(\S.*)$/);
          if (/guest lecture|total\s+(lecture\s+)?hours/i.test(l)) { extra.push(l); cur = null; }
          else if (mm && Number(mm[1]) === units.length + 1) { cur = { lines: [l.replace(/^\s*\d{1,2}\s+/, '')] }; units.push(cur); }
          else if (HDR.stop.test(l)) cur = null;
          else if (cur) cur.lines.push(l);
        });
        units.forEach(u => {
          let hours = '', sos = ''; const kept = [];
          u.lines.forEach(l => {
            const mm = l.match(/\s{2,}(\d{1,2})\s{2,}([a-z](?:\s*,\s*[a-z])*)\s*$/i) || l.match(/\s(\d{1,2})\s+([a-z](?:\s*,\s*[a-z])*)\s*$/) || l.match(/\s{2,}(\d{1,2})\s*$/);
            if (mm && !hours) { hours = mm[1]; sos = (mm[2] || '').replace(/\s+/g, ''); kept.push(l.slice(0, mm.index)); } else kept.push(l);
          });
          res.units.push({ title: '', hours: Number(hours) || 0, sos: sos.split(',').filter(Boolean).join(', '), cos: '', topics: squash(kept.join(' ')).replace(/\s+,/g, ','), activity: true });
        });
        extra.forEach(l => {
          const t = squash(l); let mm;
          if (/guest lecture/i.test(t) && (mm = t.match(/(\d{1,2})\s*(hours?|hrs?)?\s*$/i))) { guestHours = Number(mm[1]); guestTitle = t.replace(/\s*\d{1,2}\s*(hours?|hrs?)?\s*$/i, '').replace(/^\d+\s+/, ''); }
        });
      }
    }
    if ((m = all.match(/total\s+(?:lecture|contact)?\s*hours?\s*[:\-]?\s*(\d{1,3})/i))) totalHours = Number(m[1]);
    if ((m = all.match(/total\s+(?:laboratory|lab|practical)\s*hours?\s*[:\-]?\s*(\d{1,3})/i))) labHours = Number(m[1]);
    if (guestHours !== undefined) { res.guestHours = guestHours; res.guestTitle = guestTitle; }
    if (totalHours) res.totalHours = totalHours;

    // ---- books
    function block(startRe, bookStop) {
      const s = find(lines, startRe); if (s < 0) return [];
      let e = lines.length;
      for (let i = s + 1; i < lines.length; i++) if (bookStop.test(lines[i])) { e = i; break; }
      return listItems(lines.slice(s + 1, e), { minNum: 1 });
    }
    const bookStop = /^\s*(text\s*books?|reference\s*books?|references?\s*[:\-]?\s*$|mode\s+of|recommended\s+by|recommendation\s+by|approved\s+by|approval\s+by|list\s+of|total\s+|compiled\s+by|indicative|laboratory\s+experiments|lab\s+experiments|module\s*:?\s*\d)/i;
    res.textBooks = block(HDR.textBooks, bookStop);
    res.refBooks = block(HDR.refBooks, bookStop);

    // ---- experiments
    const ei = find(lines, HDR.experiments);
    if (ei >= 0) {
      let e = lines.length;
      for (let i = ei + 1; i < lines.length; i++) if (/^\s*(recommended\s+by|recommendation\s+by|approved\s+by|approval\s+by|compiled\s+by|total\s+(laboratory|lab|practical)|mode\s+of)/i.test(lines[i])) { e = i; break; }
      res.experiments = listItems(lines.slice(ei + 1, e), { loose: true, sequential: true });
    }

    // ---- footer
    if ((m = all.match(/(?:recommended|recommendation)\s+by\s+(?:the\s+)?board\s+of\s+studies(?:\s+on)?\s*[:\-]?\s*(.*)/i))) res.bos = squash(m[1].split(/\s{3,}/)[0]);
    if ((m = all.match(/(?:approved|approval)\s+by\s+(?:the\s+)?academic\s+council(?:\s+on)?\s*[:\-]?\s*(.*)/i))) res.approval = squash(m[1].split(/\s{3,}/)[0]);
    if ((m = all.match(/compiled\s+by\s*[:\-]?\s*(.*)/i))) res.compiledBy = squash(m[1]);
    if ((m = all.match(/suggested\s+tools\s*[:\-]?\s*(.*)/i))) res.tools = squash(m[1]);

    // ---- lab-only courses: use the experiments as the unit's topics
    if (!res.units.length && res.experiments.length) {
      res.units.push({ title: 'Laboratory experiments', hours: labHours || res.experiments.length * 2, sos: '', cos: '', topics: res.experiments.map(e => e.replace(/[.]+$/, '')).join('\n'), lines: true, activity: false });
      res.warnings.push('No lecture units found, so the suggested experiments were used as the topics (one per session).');
      res.experiments = [];
    }

    // ---- unit -> CO links
    const courseWords = new Set(squash(res.course.title || '').toLowerCase().split(' '));
    mapCOs(res, courseWords);

    // ---- checks
    const sum = res.units.reduce((a, u) => a + u.hours, 0) + (res.guestHours || 0);
    if (res.totalHours && sum && sum !== res.totalHours && !res.units.some(u => u.lines)) res.warnings.push('Unit hours add up to ' + sum + ' but the syllabus says ' + res.totalHours + ' in total. Please check.');
    if (res.units.some(u => !u.hours)) res.warnings.push('Hours are missing for some units; lectures will be shared equally. Please check.');
    if (res.cos.length && res.units.length) res.warnings.push('The unit → CO links were guessed from the wording. Please check “COs covered” for every unit.');
    if (!res.cos.length) res.warnings.push('No course outcomes found.');
    if (!res.objectives.length) res.warnings.push('No course objectives found.');
    if (!res.units.length) res.warnings.push('No units / modules found.');
    if (!res.textBooks.length && !res.refBooks.length) res.warnings.push('No text / reference books found.');
  }

  // Assign each unit the CO whose wording overlaps most; unmatched units borrow from a neighbour.
  function mapCOs(res, courseWords) {
    if (!res.cos.length || !res.units.length) return;
    const coTok = res.cos.map(c => tokens(c.text, courseWords));
    const best = res.units.map(u => {
      const ut = tokens(u.title + ' ' + u.topics, courseWords); let bi = -1, bs = 0;
      coTok.forEach((ct, j) => { let s = 0; ct.forEach(w => ut.has(w) && s++); if (s > bs) { bs = s; bi = j; } });
      return bs >= 1 ? bi : -1;
    });
    if (res.units.length === res.cos.length && best.every(b => b < 0)) best.forEach((_, i) => (best[i] = i));
    best.forEach((b, i) => {
      if (b < 0) {
        let k = i - 1; while (k >= 0 && best[k] < 0) k--;
        let n = i + 1; while (n < best.length && best[n] < 0) n++;
        res.units[i].cos = 'CO' + ((k >= 0 ? best[k] : (n < best.length ? best[n] : 0)) + 1);
      } else res.units[i].cos = 'CO' + (b + 1);
    });
  }

  const api = { textFromPdf, splitCourses, parseSyllabus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCMSyllabus = api;
})(typeof window !== 'undefined' ? window : globalThis);
