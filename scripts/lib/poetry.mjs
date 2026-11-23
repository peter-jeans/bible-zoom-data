// Poetry engines (no AI):
//  - poeticLines(): runs of verses that the WEB sets as poetry (USFM \q markers), with line counts.
//  - acrostics():   the alphabetic acrostics of the Hebrew Bible, from a fixed table.

export function poeticLines(source) {
  const out = {};
  let ch = 0, verse = null;
  const lines = {}; // ch -> verse -> count of poetic lines
  let pending = 0;
  const add = (c, v, n) => { (lines[c] ||= {})[v] = (lines[c][v] || 0) + n; };
  for (const raw of source.split(/\r?\n/)) {
    const t = raw.trim();
    const c = /^\\c\s+(\d+)/.exec(t);
    if (c) { ch = +c[1]; verse = null; pending = 0; continue; }
    const q = /^\\q\d?\b\s*(.*)$/.exec(t);
    const v = /\\v\s+(\d+)/.exec(t);
    if (v) { verse = +v[1]; if (pending && ch) { add(ch, verse, pending); pending = 0; } }
    else if (pending && ch && verse && !q && t && !t.startsWith('\\c')) { add(ch, verse, pending); pending = 0; }
    if (!q || !ch) continue;
    // A bare \q line opens a poetic line whose text (and verse number) follows on the next line.
    if (!q[1]) pending++;
    else if (verse) add(ch, verse, 1);
  }
  for (const [c, vs] of Object.entries(lines)) {
    const nums = Object.keys(vs).map(Number).sort((a, b) => a - b);
    const runs = [];
    for (const n of nums) {
      const last = runs[runs.length - 1];
      if (last && n === last.end + 1) { last.end = n; last.count += vs[n]; } else runs.push({ start: n, end: n, count: vs[n] });
    }
    out[c] = runs.map(r => ({
      category: 'line', label: `Set as poetry · ${r.count} line${r.count === 1 ? '' : 's'}`, start: r.start, end: r.end,
      status: 'SETTLED', source: 'web-text', witnesses: 1,
      detail: `The World English Bible lays out verses ${r.start}–${r.end} as poetry in ${r.count} lines (USFM poetry markers).`,
    }));
  }
  return out;
}

const ALEPHBET = ['Aleph', 'Beth', 'Gimel', 'Daleth', 'He', 'Waw', 'Zayin', 'Heth', 'Teth', 'Yod', 'Kaph', 'Lamed', 'Mem', 'Nun', 'Samekh', 'Ayin', 'Pe', 'Tsadhe', 'Qoph', 'Resh', 'Shin', 'Taw'];
const PE_FIRST = [...ALEPHBET.slice(0, 15), 'Pe', 'Ayin', ...ALEPHBET.slice(17)];

// Each entry: book, ch, verses per letter (0 = whole poem only), first verse, order, note.
const TABLE = [
  { book: 'PSA', ch: 9, whole: 'Acrostic (with Psalm 10), partly broken' },
  { book: 'PSA', ch: 10, whole: 'Acrostic (with Psalm 9), partly broken' },
  { book: 'PSA', ch: 25, whole: 'Alphabetic acrostic' },
  { book: 'PSA', ch: 34, whole: 'Alphabetic acrostic' },
  { book: 'PSA', ch: 37, whole: 'Alphabetic acrostic (a letter every two verses, roughly)' },
  { book: 'PSA', ch: 111, whole: 'Alphabetic acrostic by half-line' },
  { book: 'PSA', ch: 112, whole: 'Alphabetic acrostic by half-line' },
  { book: 'PSA', ch: 119, per: 8, from: 1, order: ALEPHBET, whole: 'Alphabetic acrostic: 22 stanzas of 8 verses, each verse beginning with the stanza’s letter' },
  { book: 'PSA', ch: 145, whole: 'Alphabetic acrostic (Nun missing in the Masoretic Text)' },
  { book: 'PRO', ch: 31, per: 1, from: 10, order: ALEPHBET, whole: 'Alphabetic acrostic: the capable wife (31:10–31)' },
  { book: 'LAM', ch: 1, per: 1, from: 1, order: ALEPHBET, whole: 'Alphabetic acrostic' },
  { book: 'LAM', ch: 2, per: 1, from: 1, order: PE_FIRST, whole: 'Alphabetic acrostic (Pe before Ayin)' },
  { book: 'LAM', ch: 3, per: 3, from: 1, order: PE_FIRST, whole: 'Alphabetic acrostic: three verses per letter (Pe before Ayin)' },
  { book: 'LAM', ch: 4, per: 1, from: 1, order: PE_FIRST, whole: 'Alphabetic acrostic (Pe before Ayin)' },
];

// Returns { [BOOK]: { [ch]: tags[] } }
export function acrostics(lastVerse) {
  const out = {};
  for (const a of TABLE) {
    const last = lastVerse(a.book, a.ch);
    if (!last) continue;
    const tags = ((out[a.book] ||= {})[a.ch] ||= []);
    const from = a.from || 1;
    tags.push({ category: 'acrostic', label: a.whole, start: from, end: last, status: 'SETTLED', source: 'bz-acrostic', witnesses: 1, detail: `${a.whole}. Letters follow the Hebrew alphabet; English translations cannot show it.` });
    if (a.per) a.order.forEach((letter, i) => {
      const start = from + i * a.per, end = Math.min(last, start + a.per - 1);
      if (start <= last) tags.push({ category: 'acrostic', label: letter, start, end, status: 'SETTLED', source: 'bz-acrostic', witnesses: 1 });
    });
  }
  return out;
}
