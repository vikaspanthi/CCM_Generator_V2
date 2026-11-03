/* Academic calendar reader and class-day calculator (VIT Bhopal "Academic Calendar" PDFs).
   parseCalendar(text)  -> { terms:[{key,label,term,year,first,last,cats,holidays,blocks,satDays,published,warnings}], warnings }
   classDays(term, opts), datesFor(term, o), checkDates(term, isoList, opts), dayCount(term, opts)
   Rules (checked against the published "No. of instructional days" lines of the Fall and Winter 2026-27 calendars):
     - classes run Mon-Fri from the First to the Last Instructional Day;
     - Holiday rows and the CAT-1 / CAT-2 windows (and fests) have no regular classes;
     - a "Sectional Holiday" applies only to some students, so it is a working day unless opts.sectionalWorks === false;
     - a Saturday listed in the "Saturday Instructional Day" table is a class day that follows the stated weekday's timetable;
       any other Saturday or Sunday has no class.
   Dates are ISO strings (YYYY-MM-DD). Works in the browser (window.CCMCalendar) and in Node (require). */
(function (root) {
  'use strict';
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MON_RE = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';
  const DAY_RE = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
  const pad = n => String(n).padStart(2, '0');
  const mkIso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const monthNo = s => MONTHS.findIndex(m => m.startsWith(s.toLowerCase().replace('.', '').slice(0, 3))) + 1;
  const dow = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const addDay = iso => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return mkIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  const fmtLong = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS[m - 1].slice(0, 3).replace(/^./, c => c.toUpperCase()) + ' ' + y; };
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  // "29th September – 2nd October 2026", "2nd & 3rd November 2026", "11th to 15th January, 2027", "13th July 2026 – Monday"
  function parseDateExpr(s) {
    const re = new RegExp('(\\d{4})|(\\d{1,2})(?:st|nd|rd|th)?\\b|(' + MON_RE + ')|(' + DAY_RE + ')', 'gi');
    const parts = []; let m;
    while ((m = re.exec(s))) {
      if (m[1]) { if (parts.length) parts[parts.length - 1].y = Number(m[1]); }
      else if (m[2]) { const n = Number(m[2]); if (n >= 1 && n <= 31) { if (parts.length < 2) parts.push({ d: n }); } }
      else if (m[3]) { if (parts.length) parts[parts.length - 1].m = monthNo(m[3]); }
    }
    if (!parts.length) return null;
    const a = parts[0], b = parts[1] || null;
    if (b) {
      if (!a.m) a.m = b.m; if (!b.m) b.m = a.m;
      if (!b.y) b.y = a.y; if (!a.y) a.y = b.y && (a.m > b.m ? b.y - 1 : b.y);
    }
    if (!a.m || !a.y) return null;
    if (!validDate(a.y, a.m, a.d)) return null;
    const from = mkIso(a.y, a.m, a.d);
    if (!b) return { from, to: from };
    if (!b.m || !b.y || !validDate(b.y, b.m, b.d)) return { from, to: from };
    const to = mkIso(b.y, b.m, b.d);
    return from <= to ? { from, to } : { from: to, to: from };
  }

  function parseCalendar(text) {
    const lines = String(text || '').split(/\r?\n/);
    const terms = []; let cur = null; const warnings = [];
    const headRe = /^(?:Academic\s+Calendar\s+)?([A-Za-z]+)\s+Semester\s+(\d{4})\s*[-–]\s*(\d{2,4})\s*$/i;
    const satRe = new RegExp('^\\d+\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + MON_RE + ')\\s*,?\\s*(\\d{4})\\s+(' + DAY_RE + ')\\b', 'i');
    lines.forEach(raw => {
      const t = raw.replace(/\f/g, '').trim(); if (!t) return;
      const h = headRe.exec(t);
      if (h) {
        const yr = h[2] + '-' + h[3].slice(-2), term = h[1][0].toUpperCase() + h[1].slice(1).toLowerCase();
        cur = { key: (term + '-' + yr).toLowerCase(), label: term + ' Semester ' + yr, term, year: yr, first: '', last: '', cats: [], holidays: [], blocks: [], satDays: [], published: 0, warnings: [] };
        terms.push(cur); return;
      }
      if (!cur) return;
      const pub = /No\.?\s*of\s+instructional\s+days.*?Total\s+Days\s*:?\s*(\d+)/i.exec(t);
      if (pub) { cur.published = Number(pub[1]); return; }
      const sat = satRe.exec(t);
      if (sat) {
        const mo = monthNo(sat[2]), y = Number(sat[3]), d = Number(sat[1]);
        if (validDate(y, mo, d)) cur.satDays.push({ date: mkIso(y, mo, d), order: DAYS.indexOf(sat[4].toLowerCase()), orderName: sat[4][0].toUpperCase() + sat[4].slice(1).toLowerCase() });
        return;
      }
      const at = t.search(/\b\d{1,2}(?:st|nd|rd|th)\b/); if (at < 0) return;
      const label = t.slice(0, at), range = parseDateExpr(t.slice(at)); if (!range) return;
      const sectional = /sectional\s+holiday/i.test(label), holiday = /\bholiday\b/i.test(label);
      const name = clean(label.split(/\s{3,}/).filter(p => !/^(sectional\s+)?holiday$/i.test(p.trim())).join(' ').replace(/\b(sectional\s+)?holiday\b/ig, '')).replace(/[–\-:,]+$/, '').trim();
      const low = name.toLowerCase();
      if (/first instructional day/.test(low)) cur.first = range.from;
      else if (/last instructional day/.test(low)) cur.last = range.from;
      else if (/last date|scripts|marks|foil/.test(low)) return;
      else if (/continuous assessment test|\bcat[-\s]*\d\b/.test(low)) cur.cats.push({ name: (/cat[-\s]*(\d)/i.exec(name) ? 'CAT-' + /cat[-\s]*(\d)/i.exec(name)[1] : name), from: range.from, to: range.to });
      else if (holiday) cur.holidays.push({ name, from: range.from, to: range.to, sectional });
      else if (/\bfest\b|techno|cultural/.test(low)) cur.blocks.push({ name, from: range.from, to: range.to });
    });
    terms.forEach(tm => {
      tm.satDays.sort((a, b) => (a.date < b.date ? -1 : 1)); tm.holidays.sort((a, b) => (a.from < b.from ? -1 : 1));
      if (!tm.first) tm.warnings.push('No “First Instructional Day” was found for ' + tm.label + '; enter the first class date yourself.');
      if (!tm.last) tm.warnings.push('No “Last Instructional Day” was found for ' + tm.label + '; classes are not limited by an end date.');
      if (tm.first && tm.last && tm.first > tm.last) { tm.warnings.push('The first instructional day is after the last one in ' + tm.label + '.'); }
    });
    if (!terms.length) warnings.push('No semester heading (for example “Fall Semester 2026-27”) was found in this text. Is this an academic calendar?');
    return { terms, warnings };
  }

  const inRange = (iso, a, b) => iso >= a && iso <= b;
  function blockedBy(term, iso, opts) {
    opts = opts || {};
    for (const h of term.holidays) if (inRange(iso, h.from, h.to)) { if (h.sectional && opts.sectionalWorks !== false) continue; return { name: h.name + (h.sectional ? ' (sectional holiday)' : ' (holiday)') }; }
    if (opts.catOff !== false) for (const w of term.cats) if (inRange(iso, w.from, w.to)) return { name: w.name + ' week' };
    for (const w of term.blocks) if (inRange(iso, w.from, w.to)) return { name: w.name };
    if ((opts.extra || []).includes(iso)) return { name: 'extra holiday' };
    return null;
  }

  // Every class day of the term: {iso, order (JS weekday whose timetable runs, 1=Mon..5=Fri), sat (true for a Saturday instructional day)}
  function classDays(term, opts) {
    opts = opts || {}; const out = [];
    if (!term || !term.first) return out;
    const end = term.last || term.first; let d = term.first, guard = 0;
    while (d <= end && guard++ < 800) {
      const w = dow(d);
      if (!blockedBy(term, d, opts)) {
        if (w >= 1 && w <= 5) out.push({ iso: d, order: w, sat: false });
        else if (w === 6) { const s = term.satDays.find(x => x.date === d); if (s && s.order >= 1 && s.order <= 5) out.push({ iso: d, order: s.order, sat: true, orderName: s.orderName }); }
      }
      d = addDay(d);
    }
    return out;
  }
  const dayCount = (term, opts) => classDays(term, opts).length;

  // Dates for a class that meets on `weekdays` (JS getDay numbers, 1=Mon..5=Fri); `start` (optional ISO) delays the first class.
  function datesFor(term, o) {
    const wd = (o.weekdays || []).filter(n => n >= 1 && n <= 5), start = o.start || '';
    const all = classDays(term, o).filter(c => wd.includes(c.order) && (!start || c.iso >= start) && !(o.extra || []).includes(c.iso));
    const dates = all.slice(0, o.count);
    return { dates: dates.map(c => c.iso), available: all.length, short: all.length < o.count, saturdays: dates.filter(c => c.sat).map(c => ({ iso: c.iso, orderName: c.orderName })) };
  }

  // Problems with a given list of class dates (for example from VTOP).
  function checkDates(term, isoList, opts) {
    const out = [];
    (isoList || []).forEach(iso => {
      if (term.first && iso < term.first) { out.push({ iso, level: 'warn', msg: fmtLong(iso) + ' is before the first instructional day (' + fmtLong(term.first) + ').' }); return; }
      if (term.last && iso > term.last) { out.push({ iso, level: 'warn', msg: fmtLong(iso) + ' is after the last instructional day (' + fmtLong(term.last) + ').' }); return; }
      const b = blockedBy(term, iso, opts);
      if (b) { out.push({ iso, level: 'warn', msg: fmtLong(iso) + ' falls on ' + b.name + '.' }); return; }
      const w = dow(iso);
      if (w === 0) out.push({ iso, level: 'warn', msg: fmtLong(iso) + ' is a Sunday.' });
      else if (w === 6) { const s = term.satDays.find(x => x.date === iso); out.push(s ? { iso, level: 'info', msg: fmtLong(iso) + ' is a Saturday instructional day (' + s.orderName + ' timetable).' } : { iso, level: 'warn', msg: fmtLong(iso) + ' is a Saturday that the calendar does not list as an instructional day.' }); }
    });
    return out;
  }

  const api = { parseCalendar, parseDateExpr, classDays, dayCount, datesFor, checkDates, blockedBy, fmtLong, dow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CCMCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
