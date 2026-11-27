// Reception engine (owner request 2026-11-27): Matthew Henry's Concise Commentary (1706–1721), public
// domain, from the CrossWire SWORD module MHCC (text from CCEL). A linking task, not AI: Henry divides
// each chapter into headed sections ("Verses 1-8"), and each section becomes a tag over exactly those
// verses, carrying his full text. The chapter outline and, in chapter 1, the book introduction become
// tags over the whole chapter.
import { plainText } from './sword.mjs';

const SECTION = /^(?:Verses?|Ver\.)\s+(\d+)(?:\s*[-–,]\s*(\d+))?\s*$/i;
const slugs = { PSA: 'psalms', SNG: 'songs' };
// Matthew Henry's Complete Commentary for the same chapter, at Bible Hub (public domain text).
export const completeUrl = (book, ch) => `https://biblehub.com/commentaries/mhc/${slugs[book.id] || book.name.toLowerCase().replace(/^song of (solomon|songs)$/, 'songs').replace(/\s+/g, '_')}/${ch}.htm`;

function base(label, start, end, detail, kind) {
  return { category: 'tradition', label, start, end, status: 'SINGLE_PROPOSAL', source: 'henry-mhcc', witnesses: 1, method: 'source', tradition: 'English Nonconformist (1706–1721)', kind, detail };
}

// commentary: Map("BOOK|ch|v" -> OSIS text) from readCommentary(); lastVerse(book, ch) -> number.
export function henryTags(commentary, books, lastVerse) {
  const out = {};
  for (const book of books) {
    for (let ch = 1; ch <= book.chapters; ch++) {
      const last = lastVerse(book.id, ch);
      if (!last) continue;
      const parts = [];
      for (let v = 0; v <= last; v++) { const t = commentary.get(`${book.id}|${ch}|${v}`); if (t) parts.push(plainText(t)); }
      if (!parts.length) continue;
      const lines = parts.join('\n\n').split('\n').map(l => l.trim());
      // Split into: the lead (book introduction, chapter heading and outline) and headed sections.
      const lead = [], sections = [];
      for (const line of lines) {
        const m = SECTION.exec(line);
        if (m) { const a = Math.max(1, Math.min(+m[1], last)), b = Math.max(a, Math.min(+(m[2] || m[1]), last)); sections.push({ start: a, end: b, text: [] }); continue; }
        (sections.length ? sections.at(-1).text : lead).push(line);
      }
      // A comment runs until the next heading: Henry's heading is sometimes shorter than his comment
      // (John 3 "Verses 1-8" continues to verse 21), so each section is extended to fill any gap.
      sections.sort((x, y) => x.start - y.start);
      sections.forEach((s, i) => { s.end = Math.max(s.end, (sections[i + 1]?.start ?? last + 1) - 1); });
      const name = book.id === 'PSA' ? 'Psalm' : book.name;
      const tags = [];
      const tidy = arr => arr.join('\n').trim().replace(/^Chapter \d+\s*/i, '').replace(/\n{3,}/g, '\n\n').trim();
      let leadText = tidy(lead);
      // Chapter 1 opens with the book introduction before "Chapter 1".
      if (ch === 1) {
        const i = lead.findIndex(l => /^Chapter 1\b/i.test(l));
        if (i > 0) { const intro = tidy(lead.slice(0, i)).replace(new RegExp(`^${book.name}\\s*`, 'i'), '').trim(); if (intro.length > 40) tags.push(base(`Matthew Henry: introduction to ${book.name}`, 1, last, intro, 'introduction')); leadText = tidy(lead.slice(i)); }
      }
      if (!sections.length) { if (leadText) tags.push(base(`Matthew Henry on ${name} ${ch}`, 1, last, leadText, 'section')); }
      else {
        const outline = leadText.replace(/^Chapter Outline\s*/i, '').trim();
        if (outline) tags.push(base(`Matthew Henry: outline of ${name} ${ch}`, 1, last, outline, 'outline'));
        for (const s of sections) { const text = tidy(s.text); if (text) tags.push(base(`Matthew Henry on ${s.start === s.end ? `verse ${s.start}` : `verses ${s.start}–${s.end}`}`, s.start, s.end, text, 'section')); }
      }
      // Every tag links to the Complete Commentary on the same chapter.
      for (const t of tags) t.url = completeUrl(book, ch);
      if (tags.length) (out[book.id] ||= {})[ch] = tags;
    }
  }
  return out;
}
