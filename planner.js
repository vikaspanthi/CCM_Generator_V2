/* Session planner: turns syllabus + number of lectures into a session-by-session plan.
   Pure logic, no DOM. Works in the browser (window.CCMPlanner) and in Node (module.exports). */
(function (root) {
  'use strict';

  // ---- helpers -------------------------------------------------------------
  // Split a topic blob on newlines, semicolons and commas that are not inside brackets.
  function splitTopics(text) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of String(text || '')) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.map(t => t.replace(/\s+/g, ' ').replace(/[.]+$/, ''));
  }

  // Largest-remainder allocation of `total` lectures over weights, each at least `min` when possible.
  function allocate(weights, total, min) {
    const n = weights.length;
    if (!n) return [];
    const sum = weights.reduce((a, b) => a + b, 0) || n;
    const w = weights.map(x => (sum === n && !weights.some(v => v > 0) ? 1 : x));
    const wsum = w.reduce((a, b) => a + b, 0);
    const raw = w.map(x => (x / wsum) * total);
    const res = raw.map(x => Math.floor(x));
    if (total >= n * min) for (let i = 0; i < n; i++) if (res[i] < min) res[i] = min;
    let diff = total - res.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map(a => a[1]);
    let guard = 0;
    while (diff !== 0 && guard++ < 1000) {
      if (diff > 0) { res[order[(guard - 1) % n]]++; diff--; }
      else {
        // remove from the unit with the most lectures above the minimum
        let idx = -1, best = -1;
        for (let i = 0; i < n; i++) if (res[i] > min && res[i] > best) { best = res[i]; idx = i; }
        if (idx < 0) break;
        res[idx]--; diff++;
      }
    }
    return res;
  }

  // Split topics into k contiguous groups of (almost) equal size.
  function chunk(topics, k) {
    const groups = [];
    const n = topics.length;
    let start = 0;
    for (let i = 0; i < k; i++) {
      const size = Math.floor(n / k) + (i < n % k ? 1 : 0);
      groups.push(topics.slice(start, start + size));
      start += size;
    }
    return groups;
  }

  const topicsOf = u => (u.lines ? String(u.topics || '').split('\n').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean) : splitTopics(u.topics));

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) {
    return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
  }

  function makeDates(count, start, weekdays, holidays) {
    if (!start || !weekdays || !weekdays.length) return new Array(count).fill('');
    const hol = new Set((holidays || []).map(s => s.trim()).filter(Boolean));
    const [y, m, d] = start.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < 3000) {
      const iso = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
      if (weekdays.includes(cur.getDay()) && !hol.has(iso)) out.push(fmtDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    while (out.length < count) out.push('');
    return out;
  }

  function isoToFmt(iso) {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? fmtDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : String(iso || '');
  }

  function coList(str) {
    return String(str || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  // ---- main ----------------------------------------------------------------
  /* cfg = {
       units:[{title,hours,sos,cos,topics,activity}], cos:[{id,text}],
       lectures, guestLectures, guestTitle, experiments:[], venue,
       startDate, weekdays:[0-6], holidays:[]
     } */
  function buildPlan(cfg) {
    const units = cfg.units || [];
    const hasList = Array.isArray(cfg.dateList) && cfg.dateList.length > 0;
    const total = hasList ? cfg.dateList.length : Math.max(1, parseInt(cfg.lectures, 10) || 1);
    const guest = Math.min(Math.max(0, parseInt(cfg.guestLectures, 10) || 0), total - 1);
    const teaching = total - guest;
    const coText = {};
    (cfg.cos || []).forEach(c => (coText[c.id.toUpperCase()] = c.text));

    const counts = allocate(units.map(u => parseFloat(u.hours) || 0), teaching, 1);
    const sessions = [];
    // too few sessions for the units: topics of a unit that got no session are folded into the nearest unit that did
    const extraTopics = units.map(() => []);
    counts.forEach((k, ui) => {
      if (k) return;
      let t = ui - 1; while (t >= 0 && !counts[t]) t--;
      if (t < 0) { t = ui + 1; while (t < units.length && !counts[t]) t++; }
      if (t >= 0 && t < units.length) extraTopics[t] = extraTopics[t].concat(topicsOf(units[ui]));
    });

    units.forEach((u, ui) => {
      const k = counts[ui] || 0;
      if (!k) return;
      const topics = topicsOf(u).concat(extraTopics[ui]);
      const useActivity = u.activity && k >= 3;
      const lectureSlots = useActivity ? k - 1 : k;
      const groups = chunk(topics, Math.min(lectureSlots, Math.max(topics.length, 1)));
      const cos = coList(u.cos);
      const label = 'Unit ' + (ui + 1);
      for (let i = 0; i < lectureSlots; i++) {
        if (i < groups.length && groups[i].length) {
          sessions.push({ type: 'lecture', unitIdx: ui, cos, topic: groups[i].join(', '), unit: label });
        } else {
          sessions.push({ type: 'practice', unitIdx: ui, cos, unit: label,
            topic: 'Hands-on practice and tutorial – ' + (u.title || label) });
        }
      }
      if (useActivity) {
        sessions.push({ type: 'activity', unitIdx: ui, cos, unit: label,
          topic: 'Activity on ' + label + (u.title ? ' – ' + u.title : '') });
      }
    });

    for (let g = 0; g < guest; g++) {
      sessions.push({ type: 'guest', unitIdx: -1, cos: (cfg.cos || []).map(c => c.id.toUpperCase()), unit: 'Guest',
        topic: (cfg.guestTitle || 'Guest Lecture on Contemporary Topics') + (guest > 1 ? ' (' + (g + 1) + ')' : '') });
    }

    // experiments: spread evenly over the teaching sessions that are not guest lectures
    const labSlots = sessions.map((s, i) => (s.type === 'guest' ? -1 : i)).filter(i => i >= 0);
    const exps = (cfg.experiments || []).filter(Boolean);
    const labMap = {};
    exps.forEach((e, i) => {
      const slot = labSlots[Math.min(labSlots.length - 1, Math.floor(((i + 0.5) * labSlots.length) / exps.length))];
      (labMap[slot] = labMap[slot] || []).push('Lab Exp ' + (i + 1) + ': ' + e.replace(/[.\s]+$/, ''));
    });

    const dates = hasList ? cfg.dateList.map(isoToFmt) : makeDates(sessions.length, cfg.startDate, cfg.weekdays, cfg.holidays);
    const half = Math.ceil(sessions.length * 0.45);

    sessions.forEach((s, i) => {
      s.no = i + 1;
      s.date = dates[i] || '';
      s.venue = cfg.venue || 'Classroom / Computer Lab';
      s.coTag = s.cos.length ? s.cos.join(', ') : (units.length ? 'CO' : '');
      s.outcomes = s.cos.map(c => coText[c]).filter(Boolean);
      if (s.type === 'guest') s.outcomes = ['To gain exposure to current industry practice and emerging topics.'];
      else if (!s.outcomes.length) s.outcomes = [''];
      const first = String(s.topic).split(',')[0];
      switch (s.type) {
        case 'activity':
          s.before = 'Prepare doubts and revise the topics of ' + s.unit;
          s.entry = 'Recap quiz on ' + s.unit;
          s.material = 'PPT, activity sheet';
          s.exit = 'Peer review of activity solutions and discussion';
          s.after = 'Group activity / assignment submission';
          s.weight = 'Group activity, Assignment, TEE';
          break;
        case 'guest':
          s.before = 'Prepare questions for the industry expert';
          s.entry = 'Brief introduction of the speaker and topic';
          s.material = 'Presentation by the invited industry expert';
          s.exit = 'Interactive Q & A with the expert';
          s.after = 'Write a one-page reflection on the lecture';
          s.weight = 'Reflection, TEE';
          break;
        case 'practice':
          s.before = 'Attempt practice problems from ' + s.unit;
          s.entry = 'Quick quiz on previous session';
          s.material = 'Problem sheet, live coding / demonstration';
          s.exit = 'Solutions discussed with the class';
          s.after = 'Tutorial problems and quiz';
          s.weight = 'Tutorial, Assignment, TEE';
          break;
        default:
          s.before = 'Read ahead / watch an introductory video on: ' + first;
          s.entry = 'Q & A followed by discussion';
          s.material = 'Power point presentation, live demonstration';
          s.exit = 'Discussion and real-life scenario / problem solving';
          s.after = 'Quiz from the topics delivered';
          s.weight = i < half ? 'Quiz, Midterm, TEE' : 'Tutorial, Assignment, TEE';
      }
      s.pedagogy = 'CALTECH – Flipped classroom with active learning';
      s.lpt = exps.length ? 'LP' : 'L';
      if (labMap[i]) s.after = labMap[i].join('; ') + (s.type === 'lecture' ? '; Quiz' : '');
    });
    return sessions;
  }

  // ---- model question paper skeleton ---------------------------------------
  function buildQuestionPaper(cfg) {
    const units = cfg.units || [];
    const U = units.length || 1;
    const KL = ['KL2', 'KL3', 'KL3', 'KL4', 'KL3', 'KL4', 'KL3', 'KL4'];
    const verbs = ['Explain', 'Discuss', 'Describe with suitable examples', 'Illustrate', 'Write a program / short note on', 'Compare and contrast', 'Design and explain', 'Analyse'];
    const slots = [['1', '(a)'], ['1', '(b)'], ['2', '(a)'], ['2', '(b)'], ['3', '(a)'], ['3', '(b)'], ['4', ''], ['5', '']];
    const usedOffset = {};
    return slots.map((sl, i) => {
      const ui = Math.min(U - 1, Math.floor((i * U) / slots.length));
      const u = units[ui] || { topics: '', cos: '' };
      const topics = topicsOf(u);
      const off = usedOffset[ui] || 0;
      const pick = [];
      for (let t = 0; t < Math.min(3, topics.length); t++) pick.push(topics[(off + t) % topics.length]);
      usedOffset[ui] = off + 3;
      const cos = coList(u.cos);
      return {
        no: sl[0], part: sl[1], part2: i < 6 ? 'A' : 'B',
        text: verbs[i % verbs.length] + ' ' + (pick.length ? pick.join('; ') : 'the topics of ' + (u.title || 'this unit')) + '.',
        marks: 10, module: ordinal(ui + 1) + ' Module', kl: KL[i], co: cos[0] || ''
      };
    });
  }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  const api = { splitTopics, allocate, chunk, makeDates, buildPlan, buildQuestionPaper, coList, fmtDate, isoToFmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCMPlanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
