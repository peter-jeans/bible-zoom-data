// A small reader for SWORD zCom/zText modules (CrossWire), KJV versification. Used for Matthew Henry's
// Concise Commentary (public domain; spec v0.37). Format: <t>.bzs holds one 12-byte entry per compressed
// block (offset, size, uncompressed size); <t>.bzz the zlib blocks; <t>.bzv one 10-byte entry per verse
// slot (block number, offset in block, size). Slots run: 2 header slots, then per book a book slot and per
// chapter a chapter slot followed by its verses.
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '’').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
// OSIS/ThML markup to plain paragraphs; scripture references stay as text.
export const plainText = s => decode(s.replace(/<(?:lb|p|div)[^>]*\/?>|<\/(?:p|div)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

// books: registry books in canonical order (39 OT, then 27 NT), each with { id, chapters }.
// verseCounts(bookId, chapter) -> number of verses in KJV versification.
export async function readCommentary(dir, books, verseCounts) {
  const out = new Map(); // "BOOK|ch|v" -> text
  for (const [t, list] of [['ot', books.slice(0, 39)], ['nt', books.slice(39)]]) {
    const [bzs, bzz, bzv] = await Promise.all(['bzs', 'bzz', 'bzv'].map(x => readFile(join(dir, `${t}.${x}`))));
    const blocks = new Map();
    const block = n => {
      if (!blocks.has(n)) { const off = bzs.readUInt32LE(n * 12), size = bzs.readUInt32LE(n * 12 + 4); blocks.set(n, inflateSync(bzz.subarray(off, off + size))); }
      return blocks.get(n);
    };
    let slot = 2;
    // Verses in one section all point to the same text; each text is returned once, at its first verse.
    const seen = new Set();
    const entry = i => {
      const at = i * 10; if (at + 10 > bzv.length) return '';
      const b = bzv.readUInt32LE(at), o = bzv.readUInt32LE(at + 4), size = bzv.readUInt16LE(at + 8);
      if (!size || seen.has(`${b}|${o}`)) return '';
      seen.add(`${b}|${o}`);
      return block(b).subarray(o, o + size).toString('utf8');
    };
    for (const book of list) {
      slot++; // book introduction
      for (let ch = 1; ch <= book.chapters; ch++) {
        const intro = entry(slot++);
        if (intro.trim()) out.set(`${book.id}|${ch}|0`, intro);
        const n = verseCounts(book.id, ch);
        for (let v = 1; v <= n; v++) { const text = entry(slot++); if (text.trim()) out.set(`${book.id}|${ch}|${v}`, text); }
      }
    }
  }
  return out;
}

// Every distinct comment with the verses it covers: verses that point to the same text form one range.
// Supports zCom (10-byte verse entries) and zCom4 (12-byte, 4-byte sizes). Returns
// [{ book, ch, start, end, text }] in canonical order; chapter introductions have start 0.
export async function readCommentaryRanges(dir, books, verseCounts, { driver = 'zCom' } = {}) {
  const wide = /4$/.test(driver), step = wide ? 12 : 10;
  const out = [];
  for (const [t, list] of [['ot', books.slice(0, 39)], ['nt', books.slice(39)]]) {
    let bzs, bzz, bzv;
    // Blocks by book are .bz*, by chapter .cz*, by verse .vz*; a New-Testament-only module has no ot files.
    for (const k of ['b', 'c', 'v']) { try { [bzs, bzz, bzv] = await Promise.all(['s', 'z', 'v'].map(x => readFile(join(dir, `${t}.${k}z${x}`)))); break; } catch { /* try the next block type */ } }
    if (!bzv) continue;
    const blocks = new Map();
    const block = n => { if (!blocks.has(n)) { const off = bzs.readUInt32LE(n * 12), size = bzs.readUInt32LE(n * 12 + 4); blocks.set(n, inflateSync(bzz.subarray(off, off + size))); } return blocks.get(n); };
    const at = i => { const o = i * step; if (o + step > bzv.length) return null; const size = wide ? bzv.readUInt32LE(o + 8) : bzv.readUInt16LE(o + 8); return size ? { b: bzv.readUInt32LE(o), o: bzv.readUInt32LE(o + 4), size } : null; };
    const text = e => block(e.b).subarray(e.o, e.o + e.size).toString('utf8');
    let slot = 2;
    for (const book of list) {
      slot++;
      for (let ch = 1; ch <= book.chapters; ch++) {
        const intro = at(slot++);
        if (intro) { const x = text(intro); if (x.trim()) out.push({ book: book.id, ch, start: 0, end: 0, text: x }); }
        const n = verseCounts(book.id, ch);
        let run = null;
        for (let v = 1; v <= n; v++) {
          const e = at(slot++);
          const key = e && `${e.b}|${e.o}`;
          if (run && key && key === run.key) { run.end = v; continue; }
          if (run) out.push(run);
          run = e ? { book: book.id, ch, start: v, end: v, key, e } : null;
        }
        if (run) out.push(run);
      }
    }
    for (const r of out) if (r.e) { r.text = text(r.e); delete r.e; delete r.key; }
  }
  return out.filter(r => r.text && r.text.trim());
}
