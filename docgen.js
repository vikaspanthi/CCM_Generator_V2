/* Template-driven CCM writer.
   Opens the embedded CCM_Template.docx, fills its placeholders and empty cells in place (keeping the template's own
   run / paragraph / table properties), clones its own rows and tables where more are needed, and re-zips the package.
   Nothing of the layout is generated here: styles, numbering, header/footer, media, section properties and table
   grids are copied byte for byte from the template.
   Browser: window.CCMDoc.generate(cfg) -> Promise<Uint8Array>.  Needs DOMParser/XMLSerializer (any browser). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- ZIP ----
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return buf => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  })();
  async function pipe(Stream, kind, bytes) {
    if (typeof Stream === 'undefined') return null;
    try {
      const s = new Stream(kind);
      const w = s.writable.getWriter(); w.write(bytes); w.close();
      const chunks = []; const rd = s.readable.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); }
      let len = 0; chunks.forEach(c => (len += c.length));
      const out = new Uint8Array(len); let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; });
      return out;
    } catch (e) { return null; }
  }
  const deflateRaw = b => pipe(typeof CompressionStream === 'undefined' ? undefined : CompressionStream, 'deflate-raw', b);
  const inflateRaw = b => pipe(typeof DecompressionStream === 'undefined' ? undefined : DecompressionStream, 'deflate-raw', b);

  async function zip(files) { // files: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const parts = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >> 8) & 255];
    const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = CRC(f.data);
      let comp = f.noCompress ? null : await deflateRaw(f.data), method = 8;
      if (!comp || comp.length >= f.data.length) { comp = f.data; method = 0; }
      const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(comp.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
      parts.push(head, name, comp);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(comp.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + comp.length;
    }
    const cdStart = offset; let cdLen = 0; central.forEach(c => (cdLen += c.length));
    const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(cdStart), 0, 0]);
    const all = [...parts, ...central, end]; let n = 0; all.forEach(p => (n += p.length));
    const out = new Uint8Array(n); let o = 0; all.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  async function unzip(u) { // -> [{name, data}] in archive order
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('The embedded CCM template is damaged.');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder(); const out = [];
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u.subarray(p + 46, p + 46 + nl));
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const start = off + 30 + lnl + lel;
      const raw = u.subarray(start, start + csize);
      const data = method === 0 ? raw : await inflateRaw(raw);
      if (!data) throw new Error('This browser cannot unpack the CCM template (DecompressionStream missing).');
      out.push({ name, data, noCompress: method === 0 });
      p += 46 + nl + el + cl;
    }
    return out;
  }
  function b64ToBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  // ---------------------------------------------------------------- XML ----
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const XMLNS = 'http://www.w3.org/XML/1998/namespace';
  let D = null; // document being edited
  const mk = tag => D.createElementNS(W, 'w:' + tag);
  const kids = (n, tag) => Array.from(n.childNodes).filter(c => c.nodeType === 1 && c.namespaceURI === W && c.localName === tag);
  const first = (n, tag) => kids(n, tag)[0] || null;
  const desc = (n, tag) => Array.from(n.getElementsByTagNameNS(W, tag));
  const rowsOf = t => kids(t, 'tr');
  const cellsOf = r => kids(r, 'tc');
  const parasOf = c => kids(c, 'p');
  const textOf = n => desc(n, 't').map(t => t.textContent).join('');
  const attr = (n, name) => n.getAttributeNS(W, name);
  const setAttr = (n, name, v) => n.setAttributeNS(W, 'w:' + name, String(v));

  // Replace the text of a paragraph. The run properties of its first run (or, for an empty paragraph, its paragraph-mark
  // properties) are reused, so the font, size and weight are exactly what the template defines.
  function setPara(p, text) {
    let rPr = null;
    for (const r of kids(p, 'r')) { const x = first(r, 'rPr'); if (x) { rPr = x.cloneNode(true); break; } }
    if (!rPr) { const pp = first(p, 'pPr'); const x = pp && first(pp, 'rPr'); if (x) rPr = x.cloneNode(true); }
    Array.from(p.childNodes).forEach(c => { if (!(c.namespaceURI === W && c.localName === 'pPr')) p.removeChild(c); });
    if (text === '' || text == null) return p;
    String(text).split('\n').forEach((line, i) => {
      const r = mk('r'); if (rPr) r.appendChild(rPr.cloneNode(true));
      if (i) r.appendChild(mk('br'));
      const t = mk('t'); t.setAttributeNS(XMLNS, 'xml:space', 'preserve'); t.textContent = line; r.appendChild(t); p.appendChild(r);
    });
    return p;
  }
  // Fill a cell with one paragraph per line, cloned from the cell's own paragraph (keeps numbering, indents, fonts).
  function setLines(tc, lines, protoIdx) {
    const ps = parasOf(tc); if (!ps.length) { const p = mk('p'); tc.appendChild(p); ps.push(p); }
    const proto = ps[Math.min(protoIdx || 0, ps.length - 1)].cloneNode(true);
    ps.forEach(p => tc.removeChild(p));
    (lines && lines.length ? lines : ['']).forEach(l => { const p = proto.cloneNode(true); setPara(p, l); tc.appendChild(p); });
  }
  const setCell = (tc, text) => setLines(tc, [text == null ? '' : String(text)]);
  // Cells whose template paragraph carries a list number (entry ticket, question text) would count 1., 2., ... across the
  // cloned tables and rows, so the automatic number is dropped there and the text is written as it is.
  const noNum = (tc, dropInd) => parasOf(tc).forEach(p => { const pp = first(p, 'pPr'), n = pp && first(pp, 'numPr'); if (n) { pp.removeChild(n); if (dropInd) kids(pp, 'ind').forEach(i => pp.removeChild(i)); } });

  // Remove rows startRow..endRow (inclusive) and put n clones of proto where they were. Returns the new rows.
  function rebuild(startRow, endRow, n, proto) {
    const parent = startRow.parentNode, ref = endRow.nextSibling;
    const rm = []; for (let r = startRow; r; r = r.nextElementSibling) { rm.push(r); if (r === endRow) break; }
    const base = proto.cloneNode(true);
    rm.forEach(r => parent.removeChild(r));
    const out = [];
    for (let i = 0; i < n; i++) { const c = base.cloneNode(true); parent.insertBefore(c, ref); out.push(c); }
    return out;
  }
  const removeRows = (a, b) => rebuild(a, b, 0, a);
  const clearVMerge = tc => { const pr = first(tc, 'tcPr'); if (pr) kids(pr, 'vMerge').forEach(v => pr.removeChild(v)); };
  function setVMerge(tc, restart) {
    clearVMerge(tc);
    const pr = first(tc, 'tcPr'); const v = mk('vMerge'); if (restart) setAttr(v, 'val', 'restart');
    const after = ['tcW', 'gridSpan', 'hMerge'].map(t => first(pr, t)).filter(Boolean).pop();
    pr.insertBefore(v, after ? after.nextSibling : pr.firstChild);
  }
  function setShade(tc, fill) {
    const pr = first(tc, 'tcPr'); let s = first(pr, 'shd');
    if (!s) { s = mk('shd'); setAttr(s, 'val', 'clear'); setAttr(s, 'color', 'auto'); pr.appendChild(s); }
    setAttr(s, 'fill', fill);
  }

  // PAGEREF field with a cached value, bound to a bookmark placed on a heading.
  let bmId = 900;
  function addBookmark(p, name) {
    const id = String(bmId++);
    const s = mk('bookmarkStart'); setAttr(s, 'id', id); setAttr(s, 'name', name);
    const e = mk('bookmarkEnd'); setAttr(e, 'id', id);
    const pp = first(p, 'pPr');
    p.insertBefore(s, pp ? pp.nextSibling : p.firstChild);
    p.insertBefore(e, s.nextSibling);
  }
  function setPageRef(p, name, cached) {
    let rPr = null;
    for (const r of kids(p, 'r')) { const x = first(r, 'rPr'); if (x) { rPr = x.cloneNode(true); break; } }
    if (!rPr) { const pp = first(p, 'pPr'); const x = pp && first(pp, 'rPr'); if (x) rPr = x.cloneNode(true); }
    Array.from(p.childNodes).forEach(c => { if (!(c.namespaceURI === W && c.localName === 'pPr')) p.removeChild(c); });
    const run = fn => { const r = mk('r'); if (rPr) r.appendChild(rPr.cloneNode(true)); fn(r); p.appendChild(r); };
    const fld = t => r => { const f = mk('fldChar'); setAttr(f, 'fldCharType', t); r.appendChild(f); };
    run(fld('begin'));
    run(r => { const i = mk('instrText'); i.setAttributeNS(XMLNS, 'xml:space', 'preserve'); i.textContent = ' PAGEREF ' + name + ' \\h '; r.appendChild(i); });
    run(fld('separate'));
    run(r => { const t = mk('t'); t.textContent = String(cached); r.appendChild(t); });
    run(fld('end'));
  }

  // ------------------------------------------------------------ content ----
  const P = () => root.CCMPlanner;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const hasPractical = c => /P/i.test(String((c.course || {}).type || '')) || (c.experiments || []).length > 0;

  // Units grouped under the CO they mainly serve (the template's syllabus table has one row per CO).
  function groupByCO(c) {
    const cos = (c.cos || []).map(x => String(x.id).toUpperCase());
    const rows = cos.map(id => ({ id, units: [], hours: 0 }));
    const find = id => rows.find(r => r.id === id);
    let last = null;
    (c.units || []).forEach(u => {
      const list = P().coList(u.cos).filter(id => find(id));
      let tgt = list.length ? find(list[0]) : (last || rows[0]);
      if (!tgt) return;
      tgt.units.push(u); tgt.hours += num(u.hours); last = tgt;
    });
    return rows;
  }
  const unitLine = u => {
    const t = clean(u.title), tp = clean(String(u.topics || '').replace(/\n+/g, '; '));
    return t && tp ? t + ': ' + tp : (t || tp);
  };

  function assessWeights(c) {
    const out = { cat1: '', cat2: '', tee: '', att: '', cls: '', lab: '', classLines: [] };
    (c.assessment || []).forEach(a => {
      const tool = String(a.tool || ''), name = tool.split('\n')[0].toLowerCase(), w = a.weight;
      if (/cat\s*-?\s*1|cat-i\b/.test(name)) out.cat1 = w;
      else if (/cat\s*-?\s*2|cat-ii/.test(name)) out.cat2 = w;
      else if (/mid/.test(name)) { out.cat1 = out.cat2 = num(w) / 2; }
      else if (/tee|fat|final|end\s*term/.test(name)) out.tee = w;
      else if (/attend/.test(name)) out.att = w;
      else if (/lab/.test(name)) out.lab = w;
      else if (/class|continuous|assessment/.test(name)) { out.cls = w; out.classLines = tool.split('\n').slice(1).map(clean).filter(Boolean); }
    });
    return out;
  }

  // ---------------------------------------------------------- estimate ----
  // The Contents page numbers are PAGEREF fields (Word and LibreOffice refresh them); the cached values are estimated here.
  function lines(text, cpl) { return Math.max(1, String(text || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0)); }
  function estimate(c, groups, sessions, qpRows) {
    const pageH = 15400; // twips usable on A4 with 0.5" margins
    let h = 840 + 621 + 400 + 3 * 330;
    h += (c.objectives || []).reduce((n, o) => n + lines(o, 95) * 290, 0) + 320;
    h += (c.cos || []).reduce((n, o) => n + lines(o.text, 90) * 290, 0) + 600;
    groups.forEach(g => { const t = g.units.map(unitLine).join('\n'); h += Math.max(330, lines(t, 80) * 290); });
    h += 350 + 330 * 2;
    (c.textBooks || []).forEach(b => (h += lines(b, 100) * 290)); (c.refBooks || []).forEach(b => (h += lines(b, 100) * 290));
    h += 330 * 2; if (hasPractical(c)) (c.experiments || []).forEach(b => (h += lines(b, 95) * 290 + 40)); h += 330 * 3;
    const synPages = Math.max(1, Math.ceil(h / pageH));
    const so = 3, syl = 5, map = syl + synPages, plan = map + 1;
    const planPages = Math.max(1, Math.ceil(((sessions.length + 1) * 450 + 1300) / 10467));
    const assess = plan + planPages;
    const sess = assess + 1;
    const sessPages = Math.max(1, sessions.length);
    return { so, syl, map, plan, assess, att: assess, sess, qp: sess + sessPages };
  }

  // ------------------------------------------------------------ generate ----
  async function generate(cfg) {
    const c = JSON.parse(JSON.stringify(cfg));
    c.course = c.course || {}; c.units = c.units || []; c.cos = c.cos || [];
    const sessions = c.sessions || P().buildPlan(c);
    const qp = c.qp || P().buildQuestionPaper(c);
    if (!c.cos.length) c.cos = [{ id: 'CO1', text: '' }];

    if (typeof DOMParser === 'undefined') throw new Error('DOMParser is not available in this environment.');
    if (!root.CCM_TEMPLATE_B64) throw new Error('assets/template.js is missing (the embedded CCM template).');
    const files = await unzip(b64ToBytes(root.CCM_TEMPLATE_B64));
    const docFile = files.find(f => f.name === 'word/document.xml');
    D = new DOMParser().parseFromString(new TextDecoder().decode(docFile.data), 'application/xml');
    if (D.getElementsByTagName('parsererror').length) throw new Error('The embedded CCM template could not be parsed.');
    const body = D.getElementsByTagNameNS(W, 'body')[0];
    const B = Array.from(body.childNodes).filter(n => n.nodeType === 1); // top-level blocks, template order
    const T = B.filter(n => n.localName === 'tbl'); // 0 contents,1 syllabus,2 CO-SO,3 CO-PO,4 plan,5 assess,6 attain,7 session,8 QP
    if (T.length !== 9) throw new Error('Unexpected template layout (' + T.length + ' tables).');
    const co = c.course;

    // ---- cover -------------------------------------------------------------------------------
    if (co.manualTitle && co.manualTitle !== 'CALTech') { const r = kids(B[4], 'r')[0]; desc(r, 't')[0].textContent = co.manualTitle; }
    setPara(B[6], clean(co.code) + ' – ' + clean(co.title));
    setPara(B[9], [clean(co.slot), clean(co.classNo)].filter(Boolean).join(', '));
    setPara(B[10], clean(co.semester));
    setPara(B[17], clean(co.faculty)); setPara(B[18], clean(co.designation)); setPara(B[19], clean(co.school));

    // ---- syllabus table ----------------------------------------------------------------------
    const R = rowsOf(T[1]);
    const type = clean(co.type) || (hasPractical(c) ? 'LP' : 'LT');
    setCell(cellsOf(R[0])[1], clean(co.title)); setCell(cellsOf(R[0])[3], type);
    setCell(cellsOf(R[1])[1], clean(co.code)); setCell(cellsOf(R[1])[3], co.credits === '' || co.credits == null ? '' : String(co.credits));
    setCell(cellsOf(R[2])[1], clean(co.prereq) || 'NIL');
    const objs = (c.objectives || []).map(clean).filter(Boolean);
    if (objs.length) setLines(cellsOf(R[4])[0], objs); else removeRows(R[3], R[4]);
    // outcomes: keep the lead-in paragraph, then one numbered (CO1., CO2., ...) paragraph per outcome
    { const tc = cellsOf(R[6])[0], ps = parasOf(tc); const lead = ps[0], proto = ps[1].cloneNode(true);
      ps.slice(1).forEach(p => tc.removeChild(p));
      c.cos.forEach(o => { const p = proto.cloneNode(true); setPara(p, clean(o.text)); tc.appendChild(p); }); }
    const groups = groupByCO(c);
    const coRows = rebuild(R[8], R[14], groups.length, R[10]);
    let total = 0;
    groups.forEach((g, i) => {
      const cs = cellsOf(coRows[i]);
      setCell(cs[0], g.id); // template shows CO + number as two bold runs; one bold run is equivalent
      const p0 = parasOf(cs[0])[0], rp = first(first(p0, 'pPr'), 'rPr'); // bold, centred like the template's CO1 row
      const j = first(first(p0, 'pPr'), 'jc') || (() => { const x = mk('jc'); first(p0, 'pPr').insertBefore(x, rp); return x; })(); setAttr(j, 'val', 'center');
      setLines(cs[1], g.units.map(unitLine));
      setCell(cs[2], g.hours ? String(g.hours) : ''); total += g.hours;
      const q = parasOf(cs[2])[0], pq = first(q, 'pPr'); const jq = first(pq, 'jc') || (() => { const x = mk('jc'); pq.insertBefore(x, first(pq, 'rPr')); return x; })(); setAttr(jq, 'val', 'center');
    });
    { const cs = cellsOf(R[15]); setCell(cs[2], total ? String(total) : ''); }
    const bookRows = (a, b, items) => {
      if (!items.length) { removeRows(R[a], R[b]); return; }
      const rows = rebuild(R[a], R[b], items.length, R[a]);
      items.forEach((t, i) => { const cs = cellsOf(rows[i]); setCell(cs[0], String(i + 1)); setCell(cs[1], clean(t)); });
    };
    bookRows(17, 18, (c.textBooks || []).map(clean).filter(Boolean));
    bookRows(20, 26, (c.refBooks || []).map(clean).filter(Boolean));
    const exps = hasPractical(c) ? (c.experiments || []).map(clean).filter(Boolean) : [];
    if (exps.length) bookRows(28, 32, exps); else removeRows(R[27], R[32]);
    setCell(cellsOf(R[33])[1], clean(c.bos)); setCell(cellsOf(R[34])[1], clean(c.approval)); setCell(cellsOf(R[35])[1], clean(c.compiledBy));

    // ---- CO-SO and CO-PO mapping -------------------------------------------------------------
    const FILL = { 3: '00B050', 2: 'FFC000', 1: 'FF0000', 0: 'FF0000' };
    const mapTable = (tbl, data, ncols) => {
      const rs = rowsOf(tbl);
      const rows = rebuild(rs[1], rs[4], c.cos.length, rs[1]);
      c.cos.forEach((o, i) => {
        const cs = cellsOf(rows[i]); const vals = (data || {})[o.id] || [];
        setCell(cs[0], o.id);
        for (let k = 0; k < ncols; k++) { setCell(cs[k + 1], ''); const v = Math.max(0, Math.min(3, num(vals[k]))); setShade(cs[k + 1], FILL[v]); }
      });
    };
    mapTable(T[2], c.mapSO, 7); mapTable(T[3], c.mapPO, 14);

    // ---- course plan (landscape) -------------------------------------------------------------
    { const rs = rowsOf(T[4]);
      const rows = rebuild(rs[1], rs[rs.length - 1], sessions.length, rs[7]);
      const n = sessions.length, b1 = Math.ceil(n / 3), b2 = Math.ceil((2 * n) / 3);
      const weights = i => (i < b1 ? 'CAT 1' : i < b2 ? 'CAT 2' : 'TEE / FAT');
      sessions.forEach((s, i) => {
        const cs = cellsOf(rows[i]);
        setCell(cs[0], ''); /* number comes from the template's own list numbering */ setCell(cs[1], s.date || ''); setCell(cs[2], s.coTag || ''); setCell(cs[3], clean(s.topic));
        setCell(cs[4], clean(s.pedagogy)); setCell(cs[5], s.lpt || 'L');
        const start = i === 0 || weights(i) !== weights(i - 1);
        if (i === 0 || start) { setCell(cs[6], weights(i)); setVMerge(cs[6], true); } else { setCell(cs[6], ''); setVMerge(cs[6], false); }
      });
      // single-row blocks need no merge marker
      for (let i = 0; i < n; i++) { const next = i + 1 < n && weights(i + 1) === weights(i); const prevSame = i > 0 && weights(i - 1) === weights(i); if (!next && !prevSame) clearVMerge(cellsOf(rows[i])[6]); }
    }

    // ---- assessment tools --------------------------------------------------------------------
    { const rs = rowsOf(T[5]); const a = assessWeights(c); const w = v => (v === '' || v == null ? '' : String(v));
      setCell(cellsOf(rs[1])[2], w(a.cat1)); setCell(cellsOf(rs[2])[2], w(a.cat2)); setCell(cellsOf(rs[3])[2], w(a.tee)); setCell(cellsOf(rs[4])[2], w(a.att));
      setCell(cellsOf(rs[5])[2], w(a.cls)); setCell(cellsOf(rs[6])[2], w(a.lab));
      if (a.classLines.length) { const tc = cellsOf(rs[5])[1]; const ps = parasOf(tc); const lead = clean(textOf(ps[0])) ? ps[0] : ps[1];
        const proto = ps[ps.length - 1].cloneNode(true); ps.slice(1).forEach(p => tc.removeChild(p)); a.classLines.forEach(l => { const p = proto.cloneNode(true); setPara(p, l); tc.appendChild(p); }); }
      if (!hasPractical(c)) removeRows(rs[6], rs[6]);
    }

    // ---- attainment ---------------------------------------------------------------------------
    { const rs = rowsOf(T[6]); const tgt = c.target == null || c.target === '' ? 60 : c.target;
      const rows = rebuild(rs[1], rs[rs.length - 1], c.cos.length, rs[2]);
      c.cos.forEach((o, i) => { const cs = cellsOf(rows[i]); setCell(cs[0], o.id); setCell(cs[1], String(tgt)); setCell(cs[2], c.expected == null ? '' : String(c.expected)); setCell(cs[3], ''); }); }

    // ---- session tables ----------------------------------------------------------------------
    { const proto = T[7], sep = B[87]; const anchor = sep; // template's empty paragraph after the table
      const make = (s, tbl) => {
        const rs = rowsOf(tbl), val = k => cellsOf(rs[k])[1];
        setPara(parasOf(cellsOf(rs[0])[0])[0], 'Session Number: ' + s.no);
        setPara(parasOf(cellsOf(rs[0])[1])[0], 'Date: ' + (s.date || ''));
        setPara(parasOf(cellsOf(rs[0])[2])[0], 'Class no: ' + (clean(co.classNo) || '') + '   Slot: ' + (clean(co.slot) || ''));
        const coText = (s.outcomes || []).filter(Boolean);
        setCell(val(1), clean(s.topic)); setCell(val(2), clean(s.venue));
        setLines(val(3), [clean(s.coTag), ...coText.map(clean)].filter(Boolean));
        setCell(val(4), clean(s.before)); setCell(val(5), clean(s.entry)); noNum(val(5)); setCell(val(6), clean(s.pedagogy));
        setCell(val(7), clean(s.material)); setCell(val(8), clean(s.exit)); setCell(val(9), clean(s.after));
      };
      const first1 = proto.cloneNode(true), spacer = sep.cloneNode(true);
      { // every session starts on its own page (a session table is about two thirds of a page)
        let pp = first(spacer, 'pPr'); if (!pp) { pp = mk('pPr'); spacer.insertBefore(pp, spacer.firstChild); }
        if (!first(pp, 'pageBreakBefore')) { const pb = mk('pageBreakBefore'); const at = ['pStyle', 'keepNext', 'keepLines'].map(t => first(pp, t)).filter(Boolean).pop(); pp.insertBefore(pb, at ? at.nextSibling : pp.firstChild); } }
      make(sessions[0], proto);
      for (let i = 1; i < sessions.length; i++) {
        const t = first1.cloneNode(true); make(sessions[i], t);
        body.insertBefore(spacer.cloneNode(true), anchor); body.insertBefore(t, anchor);
      }
    }

    // ---- model question paper ----------------------------------------------------------------
    { const rs = rowsOf(T[8]);
      const val = (r, label) => { const cs = cellsOf(r); for (let i = 0; i < cs.length - 1; i++) if (clean(textOf(cs[i])) === ':' && new RegExp(label, 'i').test(clean(textOf(cs[i - 1])))) return cs[i + 1]; return null; };
      const put = (r, label, v) => { const tc = val(rs[r], label); if (tc) setCell(tc, v); };
      put(4, 'Programme', clean(co.programme)); put(4, 'Semester', clean(co.semester));
      put(5, 'Course', clean(co.title)); put(5, 'Code', clean(co.code));
      put(6, 'Faculty', clean(co.faculty)); put(6, 'Slot', [clean(co.slot), clean(co.classNo)].filter(Boolean).join(' / '));
      put(7, 'Time', clean(c.qpTime) || '1½ hours'); put(7, 'Max', String(c.qpMarks || 50));
      const rows = rebuild(rs[10], rs[16], qp.length, rs[14]);
      let g = 0;
      qp.forEach((q, i) => {
        const cs = cellsOf(rows[i]);
        const newGroup = i === 0 || qp[i - 1].no !== q.no, more = i + 1 < qp.length && qp[i + 1].no === q.no;
        setCell(cs[0], newGroup ? String(q.no) : '');
        if (newGroup && more) setVMerge(cs[0], true); else if (!newGroup) setVMerge(cs[0], false); else clearVMerge(cs[0]);
        setCell(cs[1], q.part || ''); noNum(cs[1]);
        const tag = [q.co, q.kl].filter(Boolean).join(', ');
        setCell(cs[2], clean(q.text) + (tag ? ' (' + tag + ')' : '')); noNum(cs[2], true);
        setCell(cs[3], q.marks == null ? '' : String(q.marks));
      });
    }

    // ---- contents page numbers (PAGEREF fields bound to bookmarks) --------------------------
    { const pg = estimate(c, groups, sessions, qp);
      const targets = [
        ['ccm_so', B[27], pg.so], ['ccm_syl', B[54], pg.syl], ['ccm_map', B[61], pg.map], ['ccm_plan', B[69], pg.plan],
        ['ccm_assess', B[75], pg.assess], ['ccm_att', B[80], pg.att], ['ccm_sess', B[85], pg.sess], ['ccm_qp', parasOf(cellsOf(rowsOf(T[8])[0])[0])[0], pg.qp]];
      const rs = rowsOf(T[0]);
      targets.forEach(([name, p, n], i) => { addBookmark(p, name); setPageRef(parasOf(cellsOf(rs[i + 1])[2])[0], name, n); });
    }

    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + new XMLSerializer().serializeToString(D.documentElement);
    docFile.data = new TextEncoder().encode(xml); docFile.noCompress = false;
    D = null;
    return zip(files);
  }

  const api = { generate, zip, unzip, estimate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCMDoc = api;
})(typeof window !== 'undefined' ? window : globalThis);
