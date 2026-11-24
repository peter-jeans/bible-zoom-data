// Themes engine: Nave's Topical Bible (public-domain text; structured CSV by Brady Stephenson,
// bible-data, CC BY 4.0). Each verse gets its strongest topics; runs of verses sharing a topic merge
// into one band. Topics that are people or places are left to the Names and Places layers.

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const title = s => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// "EXO 6:16-20; JOS 21:4,10; 1CH 6:2,3; 23:13" -> [{book, ch, v1, v2}] (v1=0 means whole chapter)
function refs(text, bookIds) {
  const out = [];
  let book = null;
  for (const raw of text.split(/;/)) {
    let t = raw.trim();
    const b = /^([1-3]?[A-Z]{2,3})\s+(.*)$/.exec(t);
    if (b && bookIds.has(b[1])) { book = b[1]; t = b[2]; }
    else if (b) { book = null; continue; }
    if (!book) continue;
    let m;
    if ((m = /^(\d+):(\d+)-(\d+):(\d+)/.exec(t))) { out.push({ book, ch: +m[1], v1: +m[2], v2: 999 }); for (let c = +m[1] + 1; c < +m[3]; c++) out.push({ book, ch: c, v1: 0, v2: 0 }); out.push({ book, ch: +m[3], v1: 1, v2: +m[4] }); continue; }
    if ((m = /^(\d+):([\d,\s-]+)/.exec(t))) {
      for (const part of m[2].split(',')) { const [a, z] = part.trim().split('-').map(Number); if (a) out.push({ book, ch: +m[1], v1: a, v2: z || a }); }
      continue;
    }
    if ((m = /^(\d+)\s*$/.exec(t))) out.push({ book, ch: +m[1], v1: 0, v2: 0 });
  }
  return out;
}

// Returns { [BOOK]: { [ch]: tags[] } }. exclude: Set of upper-case subjects to skip (people, places).
export function themes(csv, books, { exclude = new Set(), perVerse = 3, lastVerse } = {}) {
  const bookIds = new Set(books.map(b => b.id));
  const rows = parseCsv(csv.replace(/^﻿/, '')).slice(1);
  const topics = [];
  for (const [, subject, entry] of rows) {
    if (!subject || !entry || exclude.has(subject.trim().toUpperCase())) continue;
    const subj = title(subject.trim());
    const lines = entry.split('\n');
    const items = [];
    for (const line of lines) {
      const l = line.replace(/^-/, '').trim();
      if (!l || /^see\b/i.test(l)) continue;
      const at = l.search(/\b[1-3]?[A-Z]{2,3}\s+\d/);
      if (at < 0) continue;
      let sub = l.slice(0, at).replace(/[,;:\s]+$/, '').trim();
      if (/^(unclassified|general|miscellany|miscellaneous)\b|scriptures (relating|concerning)/i.test(sub)) sub = '';
      if (sub && sub === sub.toUpperCase()) sub = sub.charAt(0) + sub.slice(1).toLowerCase();
      items.push({ sub, refs: refs(l.slice(at), bookIds) });
    }
    const size = items.reduce((s, i) => s + i.refs.length, 0);
    if (size) topics.push({ subj, items, size });
  }
  // Per verse: candidate topics, strongest (most widely referenced subject) first.
  const perV = new Map();
  for (const t of topics) for (const it of t.items) for (const r of it.refs) {
    const last = lastVerse(r.book, r.ch);
    if (!last) continue;
    const [a, z] = r.v1 === 0 ? [1, last] : [r.v1, Math.min(r.v2, last)];
    if (z - a > 40) continue; // whole-chapter references to long chapters say little about each verse
    for (let v = a; v <= z; v++) {
      const k = `${r.book}|${r.ch}|${v}`;
      if (!perV.has(k)) perV.set(k, new Map());
      const m = perV.get(k);
      if (!m.has(t.subj)) m.set(t.subj, { subj: t.subj, sub: it.sub, size: t.size, refs: it.refs });
    }
  }
  const out = {};
  for (const [k, m] of perV) {
    const [book, ch, v] = k.split('|');
    const top = [...m.values()].sort((x, y) => y.size - x.size).slice(0, perVerse);
    const tags = ((out[book] ||= {})[ch] ||= []);
    for (const t of top) tags.push({ v: +v, ...t });
  }
  // Merge consecutive verses with the same subject into one band.
  for (const [book, chs] of Object.entries(out)) for (const [ch, list] of Object.entries(chs)) {
    list.sort((a, b) => a.subj.localeCompare(b.subj) || a.v - b.v);
    const merged = [];
    for (const t of list) {
      const prev = merged[merged.length - 1];
      if (prev && prev.subj === t.subj && prev.end === t.v - 1) { prev.end = t.v; continue; }
      merged.push({ subj: t.subj, sub: t.sub, start: t.v, end: t.v, refs: t.refs });
    }
    chs[ch] = merged.sort((a, b) => a.start - b.start).map(t => ({
      category: 'theme', label: t.sub ? `${t.subj}: ${t.sub.length > 70 ? t.sub.slice(0, 69).replace(/\s+\S*$/, '') + '…' : t.sub}` : t.subj,
      start: t.start, end: t.end, status: 'SETTLED', source: 'naves', witnesses: 1, topic: t.subj,
      // Other passages Nave's lists under the same topic entry, for the card's "Connected passages".
      links: [...new Map((t.refs || []).filter(r => !(r.book === book && r.ch === +ch)).map(r => [`${r.book}.${r.ch}.${r.v1 || 1}`, { ref: `${r.book}.${r.ch}.${r.v1 || 1}`, ...(r.v2 && r.v2 !== r.v1 ? { to: Math.min(r.v2, 999) } : {}) }])).values()].slice(0, 6),
    }));
  }
  return out;
}
