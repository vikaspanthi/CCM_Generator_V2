/* Import class lists: VTOP "date of lecture" pages (.html), Excel (.xlsx) and CSV.
   Output: [{classId, slot, venue, courseCode, title, seats, credits, dates:[ISO yyyy-mm-dd, ascending]}]
   No dependencies. Browser: window.CCMImport; Node: require('./importers.js'). */
(function (root) {
  'use strict';

  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');

  function toISO(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { // Excel serial date
      if (v < 20000 || v > 80000) return '';
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.\s]([A-Za-z]{3,9})[-/.\s,]*(\d{2,4})/))) {
      const mo = MON[m[2].slice(0, 4).toLowerCase()] || MON[m[2].slice(0, 3).toLowerCase()];
      if (!mo) return '';
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + pad(mo) + '-' + pad(m[1]);
    }
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { // day first (Indian format)
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + pad(m[2]) + '-' + pad(m[1]);
    }
    if (/^\d{5}$/.test(s)) return toISO(Number(s));
    return '';
  }

  const decode = s => String(s)
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();

  // ---------- VTOP html ----------
  function parseVtopHtml(html) {
    const clean = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
    const tables = clean.match(/<table[\s\S]*?<\/table>/gi) || [];
    const info = tables.find(t => /ClassDetailDataTable|Class Id:/i.test(t));
    const att = tables.find(t => /AttendanceDateDetailDataTable|Attendance Date/i.test(t));
    if (!att) return [];
    const it = info ? decode(info) : '';
    const grab = re => { const m = it.match(re); return m ? m[1].trim() : ''; };
    const cls = {
      classId: grab(/Class Id:\s*([A-Z0-9]+)/i),
      slot: grab(/Slot:\s*([A-Z0-9+]+)/i),
      venue: grab(/Venue:\s*(.+?)(?:\s+(?:Manual|Faculty|Registered|Class Id|Slot)\b|$)/i),
      courseCode: grab(/Code:\s*([A-Z0-9]+)/i),
      title: grab(/Title:\s*(.+?)\s+Version:/i),
      seats: grab(/Registered Seats:\s*(\d+)/i),
      credits: (it.match(/L T P J C:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)/i) || [])[5] || '',
      dates: []
    };
    (att.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(tr => {
      const cells = (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map(decode);
      if (cells.length >= 2) { const iso = toISO(cells[1]); if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(cells[1]) && iso) cls.dates.push(iso); }
    });
    cls.dates = Array.from(new Set(cls.dates)).sort();
    return cls.dates.length ? [cls] : [];
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = String(text).replace(/^\uFEFF/, '');
    const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : (text.split('\n')[0].includes('\t') ? '\t' : ',');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }

  // ---------- XLSX (zip + inflate via DecompressionStream) ----------
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    const chunks = []; const rd = ds.readable.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); }
    let n = 0; chunks.forEach(c => (n += c.length));
    const out = new Uint8Array(n); let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; });
    return out;
  }
  async function unzip(buf) {
    const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a valid .xlsx file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const files = {}; const dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u.subarray(p + 46, p + 46 + nl));
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const start = off + 30 + lnl + lel;
      files[name] = { method, data: u.subarray(start, start + csize) };
      p += 46 + nl + el + cl;
    }
    return async name => {
      const f = files[name]; if (!f) return null;
      const bytes = f.method === 0 ? f.data : await inflateRaw(f.data);
      return dec.decode(bytes);
    };
  }
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function parseXlsx(buf) {
    const read = await unzip(buf);
    const sstXml = await read('xl/sharedStrings.xml');
    const sst = sstXml ? (sstXml.match(/<si[\s>][\s\S]*?<\/si>/g) || []).map(si => decode((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')).replace(/\s+/g, ' ')) : [];
    let sheetName = 'xl/worksheets/sheet1.xml';
    if (!(await read(sheetName))) {
      const wb = await read('xl/_rels/workbook.xml.rels');
      const t = wb && wb.match(/Target="(worksheets\/[^"]+)"/);
      if (t) sheetName = 'xl/' + t[1];
    }
    const xml = await read(sheetName);
    if (!xml) throw new Error('No worksheet found in the .xlsx file');
    const rows = [];
    (xml.match(/<row[\s\S]*?<\/row>/g) || []).forEach(r => {
      const arr = [];
      (r.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || []).forEach(c => {
        const ref = (c.match(/\br="([A-Z]+\d+)"/) || [])[1]; if (!ref) return;
        const t = (c.match(/\bt="(\w+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = sst[Number(v)] || '';
        else if (t === 'inlineStr') val = decode((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
        else if (t === 'str' || t === 'b' || t === 'e') val = decode(v || '');
        else if (v != null && v !== '') val = Number(v);
        arr[colIdx(ref)] = val;
      });
      rows.push(Array.from(arr, x => (x == null ? '' : x)));
    });
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }

  // ---------- table rows -> classes ----------
  const HEAD = {
    classId: /^(class\s*(id|no|number|nbr)|classid)/i,
    date: /(date|lecture)/i,
    slot: /^slot/i, venue: /^(venue|room)/i,
    courseCode: /^(course\s*)?code/i, title: /^(course\s*)?title/i
  };
  function rowsToClasses(rows) {
    if (!rows.length) return [];
    let hi = rows.findIndex(r => r.some(c => HEAD.classId.test(String(c).trim())) && r.some(c => HEAD.date.test(String(c).trim())));
    const hasHeader = hi >= 0; if (!hasHeader) hi = -1;
    const idx = { classId: 0, date: 1 };
    if (hasHeader) {
      const h = rows[hi].map(c => String(c).trim());
      Object.keys(HEAD).forEach(k => { const j = h.findIndex(c => HEAD[k].test(c)); if (j >= 0) idx[k] = j; });
    }
    const map = new Map();
    rows.slice(hi + 1).forEach(r => {
      const iso = toISO(r[idx.date]); if (!iso) return;
      const id = String(r[idx.classId] == null ? '' : r[idx.classId]).trim() || 'CLASS';
      if (!map.has(id)) map.set(id, { classId: id === 'CLASS' ? '' : id, slot: '', venue: '', courseCode: '', title: '', seats: '', credits: '', dates: [] });
      const c = map.get(id);
      ['slot', 'venue', 'courseCode', 'title'].forEach(k => { if (idx[k] != null && r[idx[k]] && !c[k]) c[k] = String(r[idx[k]]).trim(); });
      c.dates.push(iso);
    });
    return Array.from(map.values()).map(c => Object.assign(c, { dates: Array.from(new Set(c.dates)).sort() }));
  }

  async function importFile(name, content) { // content: string for html/csv, ArrayBuffer for xlsx
    const n = name.toLowerCase();
    if (n.endsWith('.xlsx')) return rowsToClasses(await parseXlsx(content));
    if (n.endsWith('.csv') || n.endsWith('.txt') || n.endsWith('.tsv')) return rowsToClasses(parseCsv(content));
    const v = parseVtopHtml(content);
    if (v.length) return v;
    throw new Error('Could not find a class table and a date table in ' + name);
  }

  const TEMPLATE_CSV = 'Class ID,Date,Slot,Venue\nBL2026270100324,14-07-2026,F11+F12,AB02-301\nBL2026270100324,16-07-2026,F11+F12,AB02-301\nBL2026270100325,15-07-2026,G11+G12,AB02-302\n';

  const api = { toISO, parseVtopHtml, parseCsv, parseXlsx, rowsToClasses, importFile, TEMPLATE_CSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCMImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
