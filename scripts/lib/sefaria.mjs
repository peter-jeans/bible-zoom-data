// Jewish commentary from Sefaria (spec v0.37): Rashi on the Hebrew Bible and Ramban on the Torah, in the
// English translation Sefaria serves by default, used only when that translation's licence is public
// domain, CC0 or CC BY (non-commercial licences are excluded, §12). Each entry keeps its translation and
// licence. Linked to verses by engine; no AI.
//
// Versification: Sefaria follows the Hebrew numbering. Where a chapter has the same number of verses as
// the KJV, verses match. In Psalms, titles are extra Hebrew verses at the start, so the KJV verse is the
// Hebrew verse minus that difference (titles attach to verse 1). Any other chapter that differs is left
// out rather than risk a comment on the wrong verse.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = /^(public domain|cc0|cc-by)$/i;
// Only translations with these licences are kept on disk; any other is recorded as unavailable.
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sefariaName = b => b.name.replace(/^1 /, 'I ').replace(/^2 /, 'II ').replace(/^Song of (Solomon|Songs)$/, 'Song of Songs').replace(/ /g, '_');
export const SEFARIA_WRITERS = [
  { id: 'rashi', name: 'Rashi', work: 'Commentary on the Hebrew Bible', tradition: 'Jewish', year: 1090, books: 'ot' },
  { id: 'ramban', name: 'Ramban (Nachmanides)', work: 'Commentary on the Torah', tradition: 'Jewish', year: 1270, books: 'torah' },
];
const strip = h => String(h || '').replace(/<sup[^>]*>.*?<\/sup>|<i class="footnote">.*?<\/i>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();

async function getChapter(cache, ref) {
  const file = join(cache, `${ref}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=english`).catch(() => null);
    if (res?.status === 404) { await writeFile(file, 'null'); return null; }
    if (res?.ok) { const j = await res.json(); const v = j.versions?.[0]; const keep = v && ALLOWED.test(String(v.license || '').trim()) ? { title: v.versionTitle, license: v.license, text: v.text } : null; await writeFile(file, JSON.stringify(keep)); return keep; }
    await sleep(1500 * (i + 1));
  }
  return null; // not cached, so a later build tries again
}

// Returns Map(writerId -> { BOOK: { ch: [entries] } }).
export async function sefariaWriters(cacheRoot, books, kjvCount) {
  const cache = join(cacheRoot, 'sefaria');
  await mkdir(cache, { recursive: true });
  // Fetch what is not cached yet, four chapters at a time (each response is cached on disk).
  const refs = [];
  for (const w of SEFARIA_WRITERS) for (const b of books.slice(0, w.books === 'torah' ? 5 : 39)) for (let ch = 1; ch <= b.chapters; ch++) { const ref = `${w.id === 'rashi' ? 'Rashi' : 'Ramban'}_on_${sefariaName(b)}.${ch}`; if (!existsSync(join(cache, `${ref}.json`))) refs.push(ref); }
  for (let i = 0; i < refs.length; i += 4) await Promise.all(refs.slice(i, i + 4).map(r => getChapter(cache, r)));
  // The Hebrew verse count of every chapter (Sefaria's book shape), because commentary arrays stop at the
  // last verse that has a comment and so cannot show the chapter's length.
  const shapes = {};
  for (const b of books.slice(0, 39)) {
    const file = join(cache, `shape_${sefariaName(b)}.json`);
    for (let i = 0; i < 5 && !existsSync(file); i++) {
      const r = await fetch(`https://www.sefaria.org/api/shape/${encodeURIComponent(sefariaName(b))}`).catch(() => null);
      if (r?.ok) { const j = await r.json(); const x = Array.isArray(j) ? j[0] : j; if (Array.isArray(x?.chapters)) await writeFile(file, JSON.stringify(x.chapters)); }
      else await sleep(5000 * (i + 1)); // rate limited: wait and try again
      await sleep(1000);
    }
    if (existsSync(file)) shapes[b.id] = JSON.parse(await readFile(file, 'utf8'));
  }
  const out = new Map();
  for (const w of SEFARIA_WRITERS) {
    const list = books.slice(0, w.books === 'torah' ? 5 : 39);
    const byBook = {};
    for (const b of list) {
      const prefix = `${w.id === 'rashi' ? 'Rashi' : 'Ramban'}_on_${sefariaName(b)}`;
      for (let ch = 1; ch <= b.chapters; ch++) {
        const got = await getChapter(cache, `${prefix}.${ch}`);
        if (!got || !Array.isArray(got.text) || !ALLOWED.test(String(got.license || '').trim())) continue;
        const heb = shapes[b.id]?.[ch - 1], kjv = kjvCount(b.id, ch);
        if (!heb) continue;
        const shift = heb === kjv ? 0 : b.id === 'PSA' && heb > kjv && heb - kjv <= 2 ? heb - kjv : null;
        if (shift === null) continue;
        const entries = [];
        got.text.forEach((comments, i) => {
          const v = Math.max(1, i + 1 - shift);
          const text = (Array.isArray(comments) ? comments : [comments]).map(strip).filter(Boolean).join('\n\n');
          if (text) entries.push({ start: v, end: v, text, work: `${got.title} (${got.license})`, url: `https://www.sefaria.org/${prefix}.${ch}.${i + 1}?lang=en` });
        });
        if (entries.length) (byBook[b.id] ||= {})[ch] = entries;
      }
    }
    out.set(w.id, byBook);
  }
  return out;
}
