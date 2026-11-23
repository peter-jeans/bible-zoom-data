// Structure engine: book outlines from the "Outline" section of each unfoldingWord Translation
// Notes book introduction (front:intro row, CC BY-SA 4.0). Every outline line that carries a
// reference range becomes a section. A range that contains other outline ranges is a "division".
// Returns { [ch]: tags[] } with each range clipped to the chapter.

const DASH = '[–—-]';
// c:v–c:v | c:v–v | c:v | (Psalms) a–b | a
const RANGE = new RegExp(`(\\d+):(\\d+)\\s*${DASH}\\s*(\\d+):(\\d+)|(\\d+):(\\d+)\\s*${DASH}\\s*(\\d+)|(\\d+):(\\d+)|\\b(?:Psalms?|chapters?)\\s+(\\d+)\\s*${DASH}\\s*(\\d+)`);

function clean(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
    .replace(/\(\s*(?:[A-Z][a-z]+\s)?[\d:–—\-,\s]+\)/g, '')
    .replace(/\b(?:Psalms?|chapters?)\s+\d+\s*[–—-]\s*\d+/g, '')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+(?:[1-3]\s)?[A-Z][a-z]+\s+\d+:\d+\s*[–—-]\s*\d+(?::\d+)?\s*$/, '')
    .replace(/\s+-\s*(promise|covenant)s?\s*$/i, ' ($1)')
    .replace(/\s+-\s*$/, '')
    .replace(/\s*\(\s*\)\s*/g, ' ')
    .replace(/\s*[:;,]\s*$/, '')
    .replace(/\s+:/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRange(line, lastVerse) {
  const m = RANGE.exec(line);
  if (!m) {
    // Chapter-only ranges at the end of a list line: "(1–3)" or "(17)".
    const c = new RegExp(`\\((\\d+)(?:\\s*${DASH}\\s*(\\d+))?\\)\\s*$`).exec(line.trim());
    if (!c || !/^\s*(?:[-*]|\d+\.)/.test(line)) return null;
    const a = +c[1], b = +(c[2] || c[1]);
    return { c1: a, v1: 1, c2: b, v2: lastVerse(b) };
  }
  if (m[1]) return { c1: +m[1], v1: +m[2], c2: +m[3], v2: +m[4] };
  if (m[5]) return { c1: +m[5], v1: +m[6], c2: +m[5], v2: +m[7] };
  if (m[8]) return { c1: +m[8], v1: +m[9], c2: +m[8], v2: +m[9] };
  return { c1: +m[10], v1: 1, c2: +m[11], v2: lastVerse(+m[11]) };
}

export function outlineFromNotes(tsv, lastVerse) {
  const lines = tsv.split(/\r?\n/);
  const head = lines[0].split('\t');
  const cRef = head.indexOf('Reference'), cNote = head.indexOf('Note');
  const intro = lines.find(l => l.split('\t')[cRef] === 'front:intro');
  if (!intro) return {};
  const text = intro.split('\t')[cNote].replace(/\\n/g, '\n');
  const items = [];
  let inOutline = false;
  for (const raw of text.split('\n')) {
    const heading = /^(#{2,4})\s+(.*)$/.exec(raw.trim());
    if (heading) {
      if (/outline/i.test(heading[2])) { inOutline = true; continue; }
      if (inOutline && heading[1].length <= 3) break; // next ### or ## section ends the outline
      if (!inOutline) continue;
    }
    if (!inOutline) continue;
    const r = parseRange(raw, lastVerse);
    if (!r) continue;
    const label = clean(raw.replace(/^#+\s*/, ''));
    if (!label || label.length < 3) continue;
    // Prose paragraphs inside the outline section also cite verses; keep list-like lines only.
    if (!/^\s*(?:[-*]|\d+\.|#)/.test(raw) && raw.length > 160) continue;
    items.push({ label, ...r, a: r.c1 * 1000 + r.v1, b: r.c2 * 1000 + r.v2 });
  }
  const valid = items.filter(i => i.b >= i.a);
  const out = {};
  for (const it of valid) {
    const contains = valid.some(o => o !== it && o.a >= it.a && o.b <= it.b && (o.a !== it.a || o.b !== it.b));
    for (let ch = it.c1; ch <= it.c2; ch++) {
      const start = ch === it.c1 ? it.v1 : 1;
      const end = ch === it.c2 ? it.v2 : lastVerse(ch);
      if (!end || end < start) continue;
      (out[ch] ||= []).push({
        category: contains ? 'division' : 'section', label: it.label, start, end, status: 'SETTLED',
        source: 'uw-tn', witnesses: 1,
        detail: `Book outline: ${it.label} (${it.c1}:${it.v1}–${it.c2}:${it.v2}).`,
      });
    }
  }
  for (const tags of Object.values(out)) tags.sort((x, y) => (x.category === 'division' ? 0 : 1) - (y.category === 'division' ? 0 : 1) || x.start - y.start);
  return out;
}
