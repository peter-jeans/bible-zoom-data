// Mechanistic engines over OpenBible.info open data (CC BY 4.0):
//  - crossReferences(): Intertext layer tags (top cross-references per verse by reader votes)
//  - places(): World › Places layer tags (places named in each verse, with identification confidence)
import { readFile } from 'node:fs/promises';

// OSIS book codes in canonical order; index i matches registry.books[i].
export const OSIS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'];

function osisMap(books) {
  const m = new Map(OSIS.map((o, i) => [o, books[i]]));
  return ref => {
    const r = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)/.exec(ref);
    if (!r || !m.has(r[1])) return null;
    const b = m.get(r[1]);
    return { book: b.id, short: b.short || b.id, ch: +r[2], v: +r[3] };
  };
}

// Returns { [BOOK]: { [ch]: tags[] } }: one tag per verse listing its strongest cross-references.
export async function crossReferences(file, books, { perVerse = 4, minVotes = 3 } = {}) {
  const parse = osisMap(books);
  const byVerse = new Map();
  for (const line of (await readFile(file, 'utf8')).split('\n').slice(1)) {
    const [from, to, votesRaw] = line.split('\t');
    const votes = +votesRaw;
    if (!from || !to || !(votes >= minVotes)) continue;
    const a = parse(from), b = parse(to.split('-')[0]);
    if (!a || !b) continue;
    const key = `${a.book}|${a.ch}|${a.v}`;
    if (!byVerse.has(key)) byVerse.set(key, []);
    byVerse.get(key).push({ ref: `${b.book}.${b.ch}.${b.v}`, label: `${b.short} ${b.ch}:${b.v}`, votes });
  }
  const out = {};
  for (const [key, refs] of byVerse) {
    const [book, ch, v] = key.split('|');
    const top = refs.sort((x, y) => y.votes - x.votes).slice(0, perVerse);
    ((out[book] ||= {})[ch] ||= []).push({
      category: 'echo', label: top.map(r => r.label).join(' · '), start: +v, end: +v, status: 'SETTLED',
      source: 'openbible-xref', witnesses: 1, links: top.map(r => ({ ref: r.ref, votes: r.votes })),
      detail: `Most-voted cross-references: ${top.map(r => `${r.label} (${r.votes} votes)`).join(', ')}.`,
    });
  }
  for (const chs of Object.values(out)) for (const tags of Object.values(chs)) tags.sort((x, y) => x.start - y.start);
  return out;
}

// Returns { [BOOK]: { [ch]: tags[] } }. A place with one clear identification is SETTLED;
// close candidates become CONTESTED lanes (equal, unranked), up to four.
export async function places(file, books) {
  const parse = osisMap(books);
  const out = {};
  const clean = s => (s || '').replace(/<[^>]+>/g, '').trim();
  for (const line of (await readFile(file, 'utf8')).trim().split('\n')) {
    const p = JSON.parse(line);
    const extra = JSON.parse(p.extra || '{}');
    const ids = (p.identifications || []).map(i => ({ name: clean(i.description), score: i.score?.time_total ?? 0 })).filter(i => i.name);
    ids.sort((a, b) => b.score - a.score);
    const top = ids[0];
    const contested = ids.length > 1 && ids[1].score >= top.score * 0.5;
    const candidates = contested ? ids.filter(i => i.score >= top.score * 0.5).slice(0, 4) : ids.slice(0, 1);
    for (const osis of extra.osises || []) {
      const r = parse(osis);
      if (!r) continue;
      const tags = ((out[r.book] ||= {})[r.ch] ||= []);
      if (!candidates.length) { tags.push({ category: 'site', label: `${p.friendly_id}: location unknown`, start: r.v, end: r.v, status: 'SINGLE_PROPOSAL', source: 'openbible-geo', witnesses: 1 }); continue; }
      const group = contested ? `place-${p.id}-${r.ch}-${r.v}` : undefined;
      for (const c of candidates) tags.push({
        category: 'site', label: contested ? `${p.friendly_id}: ${c.name}?` : `${p.friendly_id}${c.name && c.name !== p.friendly_id ? ` (${c.name})` : ''}`,
        start: r.v, end: r.v, status: contested ? 'CONTESTED' : 'SETTLED', ...(group ? { group } : {}),
        source: 'openbible-geo', witnesses: 1, place: p.id, detail: contested ? `Candidate locations for ${p.friendly_id}: ${candidates.map(x => x.name).join(', ')}.` : undefined,
      });
    }
  }
  for (const chs of Object.values(out)) for (const tags of Object.values(chs)) tags.sort((x, y) => x.start - y.start);
  return out;
}
