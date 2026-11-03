(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const P = window.CCMPlanner, D = window.CCMDoc, CI = window.CCMImport, CAL = window.CCMCalendar;
  const KEY = 'ccm-generator-v1';

  const blankState = () => ({
    course: { code: '', title: '', type: '', credits: 3, prereq: '', manualTitle: 'CALTech', slot: '', classNo: '', semester: '', faculty: '', designation: '', school: '', programme: 'B.Tech.', useLogo: true },
    objectives: [], cos: [], units: [{ title: '', hours: 6, sos: '', cos: '', topics: '', activity: true }],
    guestHours: 0, guestLectures: 0, guestTitle: 'Guest Lecture on Contemporary Topics', lectures: 22,
    tools: '', textBooks: [], refBooks: [], bos: '', approval: '', compiledBy: '', psos: [], experiments: [],
    venue: 'Classroom / Computer Lab', startDate: '', weekdays: [], holidays: [],
    mapSO: {}, mapPO: {}, classes: [],
    calendar: { terms: [], sel: '', sectionalWorks: true, catOff: true },
    assessment: [{ tool: 'Midterm (50)', weight: 30 }, { tool: 'TEE / FAT (100)', weight: 30 }, { tool: 'Attendance (5)', weight: 5 },
      { tool: 'Class Assessment\n1. Quiz – 10 Marks\n2. Tutorial – 10 marks\n3. Group activity – 5 marks\n4. Assignment – 10 marks', weight: 35 }],
    target: 60, expected: 70, qpTime: '1½ hours', qpMarks: 50
  });

  let S = blankState();
  // ---------- storage (best effort) ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode etc. */ } }
  function restore() {
    try { const t = localStorage.getItem(KEY); if (t) return JSON.parse(t); } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- path helpers ----------
  function getp(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setp(o, path, v) { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o); t[last] = v; }

  function toField(el, v) {
    const t = el.dataset.type;
    if (el.type === 'checkbox') return void (el.checked = !!v);
    if (t === 'lines') el.value = (v || []).join('\n');
    else if (t === 'cos') el.value = (v || []).map(c => c.text).join('\n');
    else el.value = v == null ? '' : v;
  }
  function fromField(el) {
    const t = el.dataset.type;
    if (el.type === 'checkbox') return el.checked;
    if (t === 'lines') return el.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (t === 'cos') return el.value.split('\n').map(s => s.trim().replace(/^CO\s*\d+[.:)\-\s]+/i, '')).filter(Boolean).map((text, i) => ({ id: 'CO' + (i + 1), text }));
    if (el.type === 'number') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }

  function normalise() {
    S.calendar = Object.assign(blankState().calendar, S.calendar || {}); if (!Array.isArray(S.calendar.terms)) S.calendar.terms = [];
    S.cos.forEach(c => {
      if (!Array.isArray(S.mapSO[c.id])) S.mapSO[c.id] = new Array(7).fill(0);
      if (!Array.isArray(S.mapPO[c.id])) S.mapPO[c.id] = new Array(14).fill(0);
    });
  }

  // ---------- form binding ----------
  function renderForm() {
    $$('[data-k]').forEach(el => toField(el, getp(S, el.dataset.k)));
    $$('.wd').forEach(el => (el.checked = (S.weekdays || []).includes(Number(el.value))));
    renderUnits(); renderMaps(); renderClasses(); renderCalendar();
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && el.dataset.k) {
      setp(S, el.dataset.k, fromField(el));
      if (el.dataset.k === 'cos') { normalise(); renderMaps(); }
      save();
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList && el.classList.contains('wd')) {
      S.weekdays = $$('.wd').filter(x => x.checked).map(x => Number(x.value)); save();
    }
    if (el.dataset && el.dataset.k && el.type === 'checkbox') { setp(S, el.dataset.k, el.checked); save(); }
  });

  // ---------- units ----------
  function renderUnits() {
    const box = $('#units'); box.innerHTML = '';
    S.units.forEach((u, i) => {
      const d = document.createElement('div'); d.className = 'unit';
      d.innerHTML = `<div class="head">
        <label>Unit ${i + 1} title<input data-f="title"></label>
        <label>Hours<input data-f="hours" type="number" min="0" step="0.5"></label>
        <label>SOs<input data-f="sos" placeholder="b, c, i"></label>
        <label>COs covered<input data-f="cos" placeholder="CO1, CO2"></label>
        <button type="button" class="x" ${S.units.length < 2 ? 'hidden' : ''}>Remove</button></div>
        <label>Topics<textarea data-f="topics" rows="3"></textarea></label>
        <label class="act"><input type="checkbox" data-f="activity"> Reserve the last session of this unit for an activity (when it has 3+ sessions)</label>`;
      $$('[data-f]', d).forEach(el => {
        const k = el.dataset.f;
        if (el.type === 'checkbox') el.checked = !!u[k]; else el.value = u[k] == null ? '' : u[k];
        el.addEventListener('input', () => { u[k] = el.type === 'checkbox' ? el.checked : el.value; save(); });
      });
      $('.x', d).addEventListener('click', () => { S.units.splice(i, 1); renderUnits(); save(); });
      box.appendChild(d);
    });
  }
  $('#addUnit').addEventListener('click', () => { S.units.push({ title: '', hours: 6, sos: '', cos: '', topics: '', activity: true }); renderUnits(); save(); });

  // ---------- mapping grids ----------
  function grid(title, cols, store) {
    const wrap = document.createElement('div'); wrap.className = 'mapwrap';
    let h = `<h3>${title}</h3><table class="map"><tr><th></th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
    S.cos.forEach(c => {
      h += `<tr><th>${c.id}</th>` + cols.map((_, j) => `<td><select data-co="${c.id}" data-j="${j}">${[0, 1, 2, 3].map(v => `<option value="${v}">${v || '–'}</option>`).join('')}</select></td>`).join('') + '</tr>';
    });
    wrap.innerHTML = h + '</table>';
    $$('select', wrap).forEach(sel => {
      sel.value = String(store[sel.dataset.co][sel.dataset.j] || 0);
      sel.addEventListener('change', () => { store[sel.dataset.co][Number(sel.dataset.j)] = Number(sel.value); save(); });
    });
    return wrap;
  }
  function renderMaps() {
    normalise();
    const box = $('#maps'); box.innerHTML = '';
    if (!S.cos.length) { box.innerHTML = '<p class="hint">Add course outcomes in section 2 to map them here.</p>'; return; }
    box.appendChild(grid('CO – SO mapping', Array.from({ length: 7 }, (_, i) => 'SO' + (i + 1)), S.mapSO));
    box.appendChild(grid('CO – PO / PSO mapping', Array.from({ length: 12 }, (_, i) => 'PO' + (i + 1)).concat(['PSO1', 'PSO2']), S.mapPO));
  }
  $('#suggest').addEventListener('click', () => { suggestMaps(); renderMaps(); save(); });
  function suggestMaps() {
    normalise();
    const baseSO = [3, 3, 1, 1, 1, 2, 2];
    const basePO = [3, 3, 3, 2, 3, 1, 0, 1, 1, 2, 1, 2, 3, 2];
    S.cos.forEach((c, i) => {
      S.mapSO[c.id] = baseSO.map((v, j) => (v >= 2 ? Math.max(2, v - ((i + j) % 2)) : v));
      S.mapPO[c.id] = basePO.map((v, j) => (v >= 2 ? Math.max(2, v - ((i + j) % 2)) : v));
    });
  }

  // ---------- toolbar ----------
  function loadState(obj) {
    S = Object.assign(blankState(), obj);
    S.course = Object.assign(blankState().course, obj.course || {});
    plans = {}; $('#plan').hidden = true; setMsg('');
    normalise(); renderForm(); save();
  }
  $('#btnSample').addEventListener('click', () => loadState(JSON.parse(JSON.stringify(window.CCM_SAMPLE))));
  $('#btnReset').addEventListener('click', () => { if (confirm('Clear all fields?')) loadState(blankState()); });
  $('#btnSave').addEventListener('click', () => download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), 'ccm-' + (S.course.code || 'course') + '.json'));
  $('#fileLoad').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { loadState(JSON.parse(r.result)); } catch (err) { setMsg('That file is not valid JSON.', true); } };
    r.readAsText(f); e.target.value = '';
  });

  function setMsg(t, bad) { const m = $('#msg'); m.textContent = t; m.className = bad ? '' : 'ok'; if (bad) m.style.color = '#c0392b'; else m.style.color = ''; }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- syllabus PDF ----------
  const SY = window.CCMSyllabus;
  function syllMsg(html, cls) { const m = $('#syllMsg'); m.className = cls || ''; m.innerHTML = html; }
  let pdfjsPromise = null;
  // pdf.js is shipped as two classic scripts (works from file:// too). The worker script runs on the main thread.
  function addScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
  }
  function loadPdfjs() {
    if (!pdfjsPromise) pdfjsPromise = addScript('lib/pdfjs-worker.js').then(() => addScript('lib/pdfjs-main.js')).then(() => {
      const lib = window.pdfjsLib; if (!lib) throw new Error('PDF reader did not start');
      lib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs-worker.js'; return lib;
    }).catch(e => { pdfjsPromise = null; throw e; });
    return pdfjsPromise;
  }
  function applySyllabus(r, note) {
    const k = S.course;
    ['code', 'title', 'type', 'credits', 'prereq'].forEach(f => { if (r.course[f] !== undefined && r.course[f] !== '') k[f] = r.course[f]; });
    if (r.objectives.length) S.objectives = r.objectives;
    if (r.cos.length) { S.cos = r.cos; S.mapSO = {}; S.mapPO = {}; }
    if (r.units.length) S.units = r.units.map(u => Object.assign({ title: '', hours: 0, sos: '', cos: '', topics: '', activity: true }, u));
    if (r.guestHours !== undefined) { S.guestHours = r.guestHours; S.guestLectures = r.guestHours > 0 ? 1 : 0; if (r.guestTitle) S.guestTitle = r.guestTitle; }
    if (r.tools) S.tools = r.tools;
    if (r.textBooks.length) S.textBooks = r.textBooks;
    if (r.refBooks.length) S.refBooks = r.refBooks;
    if (r.experiments.length) S.experiments = r.experiments;
    if (r.bos) S.bos = r.bos; if (r.approval) S.approval = r.approval; if (r.compiledBy) S.compiledBy = r.compiledBy;
    plans = {}; $('#plan').hidden = true;
    normalise(); suggestMaps(); renderForm(); save();
    const found = [r.course.code && 'course code', r.course.title && 'title', r.objectives.length && r.objectives.length + ' objectives', r.cos.length && r.cos.length + ' outcomes',
      r.units.length && r.units.length + ' units', r.guestHours && 'guest lecture', r.textBooks.length + r.refBooks.length && 'books', r.experiments.length && r.experiments.length + ' experiments'].filter(Boolean);
    syllMsg('Filled: ' + found.join(', ') + '.' + (r.warnings.length ? '<ul>' + r.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
      (note ? '<br>' + esc(note) : '') + '<br>Next: add faculty / semester details in section 1, upload your class list in section 3, and check the outcome mapping suggestion in section 4.', r.warnings.length ? '' : 'ok');
  }
  $('#fileSyllabus').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    syllMsg('Reading ' + esc(f.name) + '…');
    let text;
    try {
      const pdfjs = await loadPdfjs();
      text = await SY.textFromPdf(pdfjs, await f.arrayBuffer());
    } catch (err) {
      console.error(err);
      syllMsg('The PDF could not be read (' + esc(err.message || err) + '). Check that the whole “lib” folder was uploaded with the app (lib/pdfjs-main.js and lib/pdfjs-worker.js), or paste the syllabus text below.', 'bad');
      return;
    }
    if (text.replace(/\s/g, '').length < 80) { syllMsg('This PDF has no selectable text (it may be a scan). Paste the text below instead.', 'bad'); return; }
    useText(text);
  });
  let parsedCourses = [];
  function useText(text) {
    parsedCourses = SY.splitCourses(text).map(t => SY.parseSyllabus(t));
    const sel = $('#courseSel'); sel.innerHTML = '';
    parsedCourses.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = (p.course.code || 'Course ' + (i + 1)) + (p.course.title ? ' – ' + p.course.title : ''); sel.appendChild(o); });
    $('#courseSelWrap').hidden = parsedCourses.length < 2;
    applySyllabus(parsedCourses[0], parsedCourses.length > 1 ? 'This PDF contains ' + parsedCourses.length + ' courses; the first one is loaded. Choose another in the list above if needed.' : '');
  }
  $('#courseSel').addEventListener('change', () => applySyllabus(parsedCourses[Number($('#courseSel').value)]));
  $('#btnPasteParse').addEventListener('click', () => {
    const t = $('#pasteText').value; if (t.trim().length < 40) { syllMsg('Paste the syllabus text first.', 'bad'); return; }
    useText(t);
  });

  // ---------- classes (VTOP / Excel / CSV) ----------
  const fmt = iso => P.isoToFmt(iso);
  function renderClasses() {
    const box = $('#classList'); const cl = S.classes || [];
    $('#btnClearClasses').hidden = !cl.length;
    if (!cl.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<table class="cl"><tr><th>Class ID</th><th>Slot</th><th>Venue</th><th>Sessions (dates)</th><th>From – To</th><th></th></tr>' +
      cl.map((c, i) => `<tr><td>${esc(c.classId || '(no id)')}</td><td>${esc(c.slot || S.course.slot || '')}</td><td>${esc(c.venue || '')}</td><td>${c.dates.length}</td><td>${fmt(c.dates[0])} – ${fmt(c.dates[c.dates.length - 1])}</td><td><button type="button" data-rm="${i}">Remove</button></td></tr>`).join('') + '</table>';
    $$('[data-rm]', box).forEach(b => b.addEventListener('click', () => { S.classes.splice(Number(b.dataset.rm), 1); plans = {}; $('#plan').hidden = true; renderClasses(); save(); }));
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  $('#fileClasses').addEventListener('change', async e => {
    const files = Array.from(e.target.files); e.target.value = '';
    const added = []; const problems = [];
    for (const f of files) {
      try {
        const isX = /\.xlsx$/i.test(f.name);
        const content = isX ? await f.arrayBuffer() : await f.text();
        (await CI.importFile(f.name, content)).forEach(c => added.push(c));
      } catch (err) { problems.push(f.name + ': ' + err.message); }
    }
    added.forEach(c => {
      const k = S.classes.findIndex(x => x.classId && x.classId === c.classId);
      if (k >= 0) S.classes[k] = c; else S.classes.push(c);
      const cs = S.course; // fill empty course fields from the first class that has them
      if (!cs.code && c.courseCode) cs.code = c.courseCode;
      if (!cs.title && c.title) cs.title = c.title;
      if (!cs.slot && c.slot) cs.slot = c.slot;
      if ((!cs.credits || cs.credits === '') && c.credits) cs.credits = Number(c.credits);
    });
    plans = {}; $('#plan').hidden = true;
    renderForm(); renderClasses(); save();
    setMsg(added.length ? added.length + ' class(es) loaded.' + (problems.length ? ' Problems: ' + problems.join('; ') : '') : (problems.join('; ') || 'No classes found in the file.'), !added.length || problems.length > 0);
  });
  $('#btnTemplate').addEventListener('click', () => download(new Blob([CI.TEMPLATE_CSV], { type: 'text/csv' }), 'class-dates-template.csv'));
  $('#btnClearClasses').addEventListener('click', () => { S.classes = []; plans = {}; $('#plan').hidden = true; renderClasses(); save(); });

  // ---------- academic calendar ----------
  const curTerm = () => (S.calendar.terms || []).find(t => t.key === S.calendar.sel) || null;
  const calOpts = () => ({ sectionalWorks: S.calendar.sectionalWorks !== false, catOff: S.calendar.catOff !== false, extra: (S.holidays || []).map(x => String(x).trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)) });
  function calMsg(html, cls) { const m = $('#calMsg'); m.className = cls || ''; m.innerHTML = html; }
  function calCheck(term, dates, notes) {
    const inside = dates.filter(d => (!term.first || d >= term.first) && (!term.last || d <= term.last)).length;
    if (dates.length && inside < dates.length / 2) {
      const other = S.calendar.terms.find(t => t.key !== term.key && dates.filter(d => d >= t.first && d <= t.last).length > inside);
      notes.push({ level: 'warn', msg: 'Most class dates are outside ' + term.label + '.' + (other ? ' They look like ' + other.label + '; choose that semester in the calendar box.' : '') });
    }
    CAL.checkDates(term, dates, calOpts()).forEach(x => notes.push({ level: x.level === 'info' ? 'info' : 'warn', msg: x.msg }));
  }
  function renderPlanNotes() {
    const keys = Object.keys(plans), box = $('#planWarn'); box.innerHTML = '';
    const rows = [];
    keys.forEach(k => (plans[k].notes || []).forEach(n => rows.push({ lvl: n.level, msg: (keys.length > 1 ? plans[k].label + ': ' : '') + n.msg })));
    const term = curTerm();
    if (!term && (S.classes || []).length === 0 && S.startDate) { /* manual dates only */ }
    if (!rows.length) { if (term) box.innerHTML = '<p class="i hint">Dates checked against ' + esc(term.label) + ': no holiday, CAT week or out-of-term date found.</p>'; return; }
    const warn = rows.filter(r => r.lvl === 'warn'), info = rows.filter(r => r.lvl !== 'warn');
    box.innerHTML = (warn.length ? '<p class="w"><b>Check these dates (' + esc((term || {}).label || 'calendar') + '):</b></p><ul class="w">' + warn.map(r => '<li>' + esc(r.msg) + '</li>').join('') + '</ul>' : '') +
      (info.length ? '<ul class="i">' + info.map(r => '<li>' + esc(r.msg) + '</li>').join('') + '</ul>' : '');
  }
  function renderCalendar() {
    const terms = S.calendar.terms || [], term = curTerm();
    $('#btnCalClear').hidden = !terms.length; $('#termSelWrap').hidden = !terms.length; $('#calOpts').hidden = !terms.length;
    const sel = $('#termSel'); sel.innerHTML = '';
    terms.forEach(t => { const o = document.createElement('option'); o.value = t.key; o.textContent = t.label; if (t.key === S.calendar.sel) o.selected = true; sel.appendChild(o); });
    const box = $('#calSummary'); box.innerHTML = '';
    if (!term) return;
    const n = CAL.dayCount(term, calOpts());
    const d = CAL.fmtLong;
    const hol = term.holidays.filter(h => (!term.last || h.from <= term.last) && (!term.first || h.to >= term.first));
    box.innerHTML = '<p class="hint"><b>' + esc(term.label) + '</b>: first instructional day <b>' + d(term.first) + '</b>, last instructional day <b>' + d(term.last) + '</b>. ' +
      n + ' class days counted' + (term.published ? ' (the calendar states ' + term.published + (term.published === n ? ', matches' : ', check the holidays below') + ')' : '') + '.</p>' +
      (term.warnings.length ? '<ul class="w">' + term.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
      '<div class="calgrid"><div><h4>Holidays inside the term</h4><table>' + (hol.length ? hol.map(h => '<tr><td>' + d(h.from) + (h.to !== h.from ? ' – ' + d(h.to) : '') + '</td><td>' + esc(h.name) + (h.sectional ? ' <i>(sectional)</i>' : '') + '</td></tr>').join('') : '<tr><td>none</td></tr>') + '</table></div>' +
      '<div><h4>No regular classes</h4><table>' + term.cats.concat(term.blocks).map(w => '<tr><td>' + d(w.from) + (w.to !== w.from ? ' – ' + d(w.to) : '') + '</td><td>' + esc(w.name) + '</td></tr>').join('') + '</table></div>' +
      '<div><h4>Saturday instructional days</h4><table>' + (term.satDays.length ? term.satDays.map(x => '<tr><td>' + d(x.date) + '</td><td>' + esc(x.orderName) + ' timetable</td></tr>').join('') : '<tr><td>none listed</td></tr>') + '</table></div></div>';
  }
  function useCalendarText(text) {
    const r = CAL.parseCalendar(text);
    if (!r.terms.length) { calMsg(esc(r.warnings[0] || 'No semester found in this calendar.') + ' You can still plan with a first class date and holidays typed below.', 'bad'); return; }
    S.calendar.terms = r.terms;
    const want = String(S.course.semester || '').toLowerCase();
    const pick = r.terms.find(t => want && want.includes(t.term.toLowerCase()) && want.includes(t.year.slice(0, 4))) || r.terms[0];
    S.calendar.sel = pick.key; applyTerm();
    calMsg('Read ' + r.terms.length + ' semester' + (r.terms.length > 1 ? 's' : '') + ': ' + r.terms.map(t => esc(t.label)).join(', ') + '. Check the dates below.', 'ok');
    plans = {}; $('#plan').hidden = true; renderCalendar(); save();
  }
  function applyTerm() { const t = curTerm(); if (t) S.course.semester = t.label; $$('[data-k="course.semester"]').forEach(el => (el.value = S.course.semester)); }
  $('#termSel').addEventListener('change', () => { S.calendar.sel = $('#termSel').value; applyTerm(); plans = {}; $('#plan').hidden = true; renderCalendar(); save(); });
  $$('[data-k^="calendar."]').forEach(el => el.addEventListener('change', () => { plans = {}; $('#plan').hidden = true; renderCalendar(); }));
  $('#btnCalClear').addEventListener('click', () => { S.calendar.terms = []; S.calendar.sel = ''; calMsg(''); plans = {}; $('#plan').hidden = true; renderCalendar(); save(); });
  $('#btnCalPaste').addEventListener('click', () => { const t = $('#calPaste').value; if (t.trim().length < 60) { calMsg('Paste the calendar text first.', 'bad'); return; } useCalendarText(t); });
  $('#fileCalendar').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    calMsg('Reading ' + esc(f.name) + '…');
    let text;
    try { const pdfjs = await loadPdfjs(); text = await SY.textFromPdf(pdfjs, await f.arrayBuffer()); }
    catch (err) { console.error(err); calMsg('The PDF could not be read (' + esc(err.message || err) + '). Paste its text below instead.', 'bad'); return; }
    if (text.replace(/\s/g, '').length < 80) { calMsg('This PDF has no selectable text. Paste the text below instead.', 'bad'); return; }
    useCalendarText(text);
  });

  // ---------- plan ----------
  const classKey = c => (c ? (c.classId || 'class') : '_');
  function targets() { return S.classes && S.classes.length ? S.classes : [null]; }
  function cfgFor(c) {
    const cfg = JSON.parse(JSON.stringify(S));
    cfg.units = cfg.units.filter(u => String(u.topics).trim());
    cfg.notes = [];
    const term = curTerm();
    if (c) {
      cfg.dateList = c.dates; cfg.lectures = c.dates.length;
      cfg.course.classNo = c.classId; if (c.slot) cfg.course.slot = c.slot;
      if (c.venue) cfg.venue = c.venue;
      if (term) calCheck(term, c.dates, cfg.notes);
    } else if (term) {
      const wd = (S.weekdays || []).filter(n => n >= 1 && n <= 5);
      const want = Number(S.lectures) || 0;
      const r = CAL.datesFor(term, Object.assign({ weekdays: wd, count: want, start: S.startDate || '' }, calOpts()));
      if (r.dates.length) { cfg.dateList = r.dates; cfg.lectures = r.dates.length; } else { cfg.dateList = []; cfg.lectures = want; }
      if (r.short) cfg.notes.push({ level: 'warn', msg: 'Only ' + r.dates.length + ' class days fit between ' + CAL.fmtLong(S.startDate && S.startDate > term.first ? S.startDate : term.first) + ' and the last instructional day (' + CAL.fmtLong(term.last) + ') for the chosen class days, so the plan has ' + r.dates.length + ' sessions instead of ' + want + '. Choose more class days, an earlier start or fewer sessions.' });
      r.saturdays.forEach(x => cfg.notes.push({ level: 'info', msg: CAL.fmtLong(x.iso) + ' is a Saturday instructional day that follows the ' + x.orderName + ' timetable; the session is dated on that Saturday.' }));
    }
    return cfg;
  }
  function validate() {
    const errs = [];
    if (!S.course.code) errs.push('course code');
    if (!S.course.title) errs.push('course title');
    if (!S.course.slot && !(S.classes || []).some(c => c.slot)) errs.push('slot');
    if (!S.cos.length) errs.push('at least one course outcome');
    if (!S.units.some(u => String(u.topics).trim())) errs.push('topics in at least one unit');
    if (!(S.classes || []).length && !(Number(S.lectures) >= 1)) errs.push('number of sessions');
    if (curTerm() && !(S.classes || []).length && !(S.weekdays || []).some(n => n >= 1 && n <= 5)) errs.push('class days (Mon–Fri) for the calendar');
    return errs;
  }
  let plans = {};
  $('#btnPlan').addEventListener('click', () => {
    const errs = validate();
    if (errs.length) { setMsg('Please fill: ' + errs.join(', ') + '.', true); return; }
    plans = {};
    targets().forEach(c => { const cfg = cfgFor(c); plans[classKey(c)] = { cfg, sessions: P.buildPlan(cfg), qp: P.buildQuestionPaper(cfg), label: c ? (c.classId || 'class') : 'Course', notes: cfg.notes || [] }; });
    const sel = $('#classSel'); sel.innerHTML = '';
    Object.keys(plans).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = plans[k].label + ' – ' + plans[k].sessions.length + ' sessions'; sel.appendChild(o); });
    $('#classSelWrap').hidden = Object.keys(plans).length < 2; $('#btnZip').hidden = Object.keys(plans).length < 2;
    showPlan();
    renderPlanNotes();
    const n = Object.keys(plans).length;
    setMsg(n > 1 ? n + ' class plans created.' : plans[Object.keys(plans)[0]].sessions.length + ' sessions created.');
    $('#plan').hidden = false;
    $('#plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#classSel').addEventListener('change', showPlan);
  let plan = null, qp = null;
  function showPlan() { const cur = plans[$('#classSel').value || Object.keys(plans)[0]]; plan = cur.sessions; qp = cur.qp; renderPlan(); }

  const FIELDS = [['topic', 'Topic', 'full'], ['outcomesText', 'Course outcome(s)', 'full'], ['venue', 'Venue'], ['pedagogy', 'Pedagogy adopted'], ['before', 'Before class activity'], ['entry', 'Entry ticket / assessment'],
    ['material', 'Material'], ['exit', 'Exit ticket / assessment'], ['after', 'After class activity', 'full'], ['weight', 'Assessment weightage', 'full']];
  function renderPlan() {
    const box = $('#sessions'); box.innerHTML = '';
    plan.forEach(s => {
      s.outcomesText = (s.outcomes || []).join('\n');
      const d = document.createElement('details'); d.className = 'sess';
      const sum = document.createElement('summary');
      sum.innerHTML = `<span>#${s.no}</span><span class="d"></span><span class="c"></span><span class="t"></span>`;
      const body = document.createElement('div'); body.className = 'body';
      FIELDS.forEach(([k, label, cls]) => {
        const l = document.createElement('label'); if (cls) l.className = cls;
        l.append(label);
        const inp = document.createElement(k === 'topic' || k === 'after' || k === 'outcomesText' ? 'textarea' : 'input');
        if (inp.tagName === 'TEXTAREA') inp.rows = k === 'topic' ? 3 : 2;
        inp.value = s[k] == null ? '' : s[k];
        inp.addEventListener('input', () => { s[k] = inp.value; if (k === 'outcomesText') s.outcomes = inp.value.split('\n').filter(Boolean); sync(); });
        l.append(inp); body.append(l);
      });
      [['date', 'Date'], ['coTag', 'CO tag']].forEach(([k, label]) => {
        const l = document.createElement('label'); l.append(label);
        const inp = document.createElement('input'); inp.value = s[k] || '';
        inp.addEventListener('input', () => { s[k] = inp.value; sync(); });
        l.append(inp); body.append(l);
      });
      function sync() { sum.children[1].textContent = s.date || 'no date'; sum.children[2].textContent = s.coTag; sum.children[3].textContent = s.topic; }
      sync(); d.append(sum, body); box.append(d);
    });
    const qb = $('#qp'); qb.innerHTML = '';
    qp.forEach((q, i) => {
      const r = document.createElement('div'); r.className = 'qrow';
      r.innerHTML = `<div><strong>Q${q.no}${q.part ? ' ' + q.part : ''}</strong><br><small>${i < 6 ? 'Part A' : 'Part B'}</small></div><textarea class="q" rows="3"></textarea><input data-q="module"><input data-q="kl"><input data-q="co">`;
      const ta = $('textarea', r); ta.value = q.text; ta.addEventListener('input', () => (q.text = ta.value));
      $$('input', r).forEach(inp => { const k = inp.dataset.q; inp.value = q[k]; inp.addEventListener('input', () => (q[k] = inp.value)); });
      qb.append(r);
    });
  }

  // ---------- document ----------
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const fname = (cfg, id) => ('CCM_' + (cfg.course.code || 'course') + '_' + (cfg.course.title || '') + (id ? '_' + id : '')).replace(/[^\w\-]+/g, '_').replace(/_+$/, '') + '.docx';
  async function build(p) {
    const cfg = p.cfg; cfg.sessions = p.sessions; cfg.qp = p.qp; cfg.mapSO = S.mapSO; cfg.mapPO = S.mapPO;
    return D.generate(cfg);
  }
  $('#btnDoc').addEventListener('click', async () => {
    if (!plan) return;
    const btn = $('#btnDoc'); btn.disabled = true; setMsg('Building document…');
    try {
      const key = $('#classSel').value || Object.keys(plans)[0]; const p = plans[key];
      const bytes = await build(p);
      const name = fname(p.cfg, p.cfg.course.classNo);
      download(new Blob([bytes], { type: MIME }), name); setMsg('Downloaded ' + name);
    } catch (err) { console.error(err); setMsg('Could not build the document: ' + err.message, true); }
    btn.disabled = false;
  });
  $('#btnZip').addEventListener('click', async () => {
    const btn = $('#btnZip'); btn.disabled = true; setMsg('Building all documents…');
    try {
      const files = [];
      for (const k of Object.keys(plans)) { const p = plans[k]; files.push({ name: fname(p.cfg, p.cfg.course.classNo), data: await build(p) }); }
      const zipBytes = await D.zip(files);
      download(new Blob([zipBytes], { type: 'application/zip' }), 'CCM_' + (S.course.code || 'course') + '_all_classes.zip');
      setMsg(files.length + ' CCM files downloaded in one zip.');
    } catch (err) { console.error(err); setMsg('Could not build the zip: ' + err.message, true); }
    btn.disabled = false;
  });

  // ---------- safety net ----------
  function banner(msg) { const b = $('#errBar'); b.textContent = 'Something went wrong: ' + msg + ' — your form data is safe (it is saved in this browser). Reload the page and try again, or save the form as JSON.'; b.hidden = false; }
  window.addEventListener('error', e => banner(e.message || 'unexpected error'));
  window.addEventListener('unhandledrejection', e => banner((e.reason && e.reason.message) || String(e.reason)));

  // ---------- init ----------
  const saved = restore();
  if (saved) { S = Object.assign(blankState(), saved); S.course = Object.assign(blankState().course, saved.course || {}); }
  normalise(); renderForm();
})();
