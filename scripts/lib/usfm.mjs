// Parses an eBible USFM book into { [chapter]: [{ number, words: [{ id, text, strong?, added? }] }] }.
// Words keep their trailing punctuation (as in the seed data). KJV "\add" words (the
// translators' italics) are marked added:true for the translation lens.
const SKIP = /^\\(id|ide|h|toc\d?|mt\d?|ms\d?|mr|s\d?|r|d|cl|sp|rem|is\d?|ip|imt\d?|io\d?|ior|iot|ie|periph|cp)\b/;

function normStrong(s) {
  const m = /^([HG])0*(\d+)([a-z]?)$/i.exec(s);
  return m ? `${m[1].toUpperCase()}${m[2]}${m[3] || ''}` : undefined;
}

function tokenize(raw, { strongs }) {
  let s = raw
    .replace(/\\f\s.*?\\f\*/g, '')
    .replace(/\\x\s.*?\\x\*/g, '')
    .replace(/\\add\*/g, '\u0005').replace(/\\add\s?/g, '\u0004')
    .replace(/\\\+?w\s([^|\\]*?)\|[^\\]*?strong="([^"]+)"[^\\]*?\\\+?w\*/g, (_, w, st) => w.trim().split(/\s+/).map((part, i) => `\u0001${part}\u0002${i === 0 ? st : ''}\u0003`).join(' '))
    .replace(/\\\+?w\s([^|\\]*?)(\|[^\\]*)?\\\+?w\*/g, '$1')
    .replace(/\\[a-z0-9+]+\*?/gi, ' ')
    .replace(/¶/g, ' ');
  const out = [];
  let added = false;
  for (const piece of s.split(/\s+/)) {
    if (!piece) continue;
    let text = '', strong;
    for (const part of piece.split(/(\u0001[^\u0003]*\u0003)/)) {
      if (part.startsWith('\u0001')) {
        const [w, st] = part.slice(1, -1).split('\u0002');
        text += w;
        if (!strong && st) strong = normStrong(st.split(/\s+/)[0]);
      } else {
        for (const ch of part) {
          if (ch === '\u0004') added = true;
          else if (ch === '\u0005') added = false;
          else text += ch;
        }
      }
    }
    // A marker can open/close at a word boundary: re-check for stray markers.
    if (piece.includes('\u0004') && !piece.includes('\u0005')) added = true;
    text = text.trim();
    if (!text) continue;
    const word = { text };
    if (strongs && strong) word.strong = strong;
    if (added || piece.includes('\u0004')) word.added = true;
    out.push(word);
    if (piece.includes('\u0005')) added = false;
  }
  return out;
}

export function parseUsfm(source, bookId, { strongs = false } = {}) {
  const chapters = {};
  let ch = 0, verse = null, buffer = '';
  const flush = () => {
    if (verse && ch) {
      const words = tokenize(buffer, { strongs }).map((w, i) => ({ id: `${bookId}.${ch}.${verse}.${i + 1}`, ...w }));
      if (words.length) (chapters[ch] ||= []).push({ number: verse, words });
    }
    buffer = '';
  };
  for (const line of source.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const c = /^\\c\s+(\d+)/.exec(t);
    if (c) { flush(); ch = +c[1]; verse = null; continue; }
    if (SKIP.test(t)) continue;
    const v = /^\\v\s+(\d+)(?:-\d+)?\s?(.*)$/.exec(t);
    if (v) { flush(); verse = +v[1]; buffer = v[2]; continue; }
    // Poetry and paragraph lines (\q1, \p, \m, \li…) continue the current verse.
    const inline = t.replace(/^\\(q\d?|p|m|pi\d?|li\d?|nb|pc|qc|qr|qm\d?|b)\b\s?/, '');
    const v2 = /\\v\s+(\d+)(?:-\d+)?\s?(.*)$/.exec(inline);
    if (v2) { buffer += ' ' + inline.slice(0, v2.index); flush(); verse = +v2[1]; buffer = v2[2]; continue; }
    if (verse) buffer += ' ' + inline;
  }
  flush();
  return chapters;
}
