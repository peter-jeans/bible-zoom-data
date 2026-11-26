// Search index (spec v0.35). Static files, split so one search loads only what it needs:
//   search/meta.json                  books, verses per chapter (to turn a verse number into a reference)
//   search/<TR>/w/<stem>.json         a word in one translation: its forms with counts, and the verses
//   search/<TR>/text/<BOOK>/<ch>.json plain verse text of one chapter, to check phrases and show results
//   search/strong/<G26>.json          verses where a Strong's number is translated (KJV and WEB)
//   search/lemma/<letter>.json        Hebrew and Greek lemmas, their transliteration, gloss and Strong's
//   search/names/<letter>.json        people and places by name, and the verses that name them
// Verses are numbered 0…31101 in canonical order; lists hold the gaps between them in base 36.
// The browser does all the matching; nothing is sent anywhere.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Word stems, so love, loved, loveth and loving are found together. The app uses the same rules
// (src/lib/searchCore.js); tests on both sides check the same examples.
export function stem(word) {
  let w = word.toLowerCase().normalize('NFC').replace(/[’']s$/, '').replace(/[^\p{L}]/gu, '');
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  for (const suf of ['eth', 'est', 'ing', 'ed', 'es', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3 && !(suf === 's' && w.endsWith('ss'))) { w = w.slice(0, -suf.length); break; }
  }
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}
// Accents and breathings removed, for matching Greek and Hebrew typed without them.
export const bare = s => s.normalize('NFD').replace(/[̀-֑ͯ-ׇ]/g, '').normalize('NFC').toLowerCase();
const pack = list => { let prev = -1, out = []; for (const n of [...new Set(list)].sort((a, b) => a - b)) { out.push((n - prev).toString(36)); prev = n; } return out.join(','); };
const safe = s => encodeURIComponent(s).replace(/%/g, '_');
const json = async (path, data) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(data)); };

export async function buildSearchIndex(out, books) {
  const dir = join(out, 'search');
  const meta = { version: 1, books: [] };
  const ordinal = new Map(); // "BOOK|ch|v" -> n
  let n = 0;
  for (const b of books) {
    const chapters = [];
    for (let ch = 1; ch <= b.chapters; ch++) {
      const f = join(out, 'text', 'KJV', b.id, `${ch}.json`);
      const verses = existsSync(f) ? JSON.parse(await readFile(f, 'utf8')).verses : [];
      chapters.push(verses.length);
      for (const v of verses) ordinal.set(`${b.id}|${ch}|${v.number}`, n++);
    }
    meta.books.push({ id: b.id, chapters });
  }
  meta.verses = n;
  await json(join(dir, 'meta.json'), meta);

  const strongs = new Map(), lexInfo = new Map();
  const counts = {};
  for (const tr of ['KJV', 'WEB']) {
    const stems = new Map();
    for (const b of books) {
      for (let ch = 1; ch <= b.chapters; ch++) {
        const f = join(out, 'text', tr, b.id, `${ch}.json`);
        if (!existsSync(f)) continue;
        const rows = [];
        for (const v of JSON.parse(await readFile(f, 'utf8')).verses) {
          const at = ordinal.get(`${b.id}|${ch}|${v.number}`);
          if (at === undefined) continue;
          rows.push(v.words.map(w => w.text).join(' '));
          for (const w of v.words) {
            const s = stem(w.text);
            if (s) {
              if (!stems.has(s)) stems.set(s, { forms: {}, v: [] });
              const e = stems.get(s), form = w.text.toLowerCase().replace(/[^\p{L}’']/gu, '');
              e.forms[form] = (e.forms[form] || 0) + 1; e.v.push(at);
            }
            if (w.strong) { const k = w.strong.replace(/^([HG])0*/, '$1'); if (w.lemma && !lexInfo.has(k)) lexInfo.set(k, [w.lemma, '', w.gloss || '']); if (!strongs.has(k)) strongs.set(k, { KJV: [], WEB: [] }); strongs.get(k)[tr].push(at); }
          }
        }
        await json(join(dir, tr, 'text', b.id, `${ch}.json`), rows);
      }
    }
    for (const [s, e] of stems) await json(join(dir, tr, 'w', `${safe(s)}.json`), { forms: e.forms, v: pack(e.v) });
    counts[tr] = stems.size;
  }
  for (const [k, e] of strongs) await json(join(dir, 'strong', `${k}.json`), { KJV: pack(e.KJV), WEB: pack(e.WEB) });

  // Lemmas: from the lexicon files the build already wrote (Hebrew from Strong's, Greek from TAGNT).
  const lemmas = {};
  const lexDir = join(out, 'library', 'lexicon');
  const base = JSON.parse(await readFile(join(lexDir, 'strong.json'), 'utf8')).lex || {};
  for (const f of await readdir(lexDir)) {
    const id = f.replace(/\.json$/, '');
    if (!/^[HG]\d+$/.test(id)) continue;
    const e = JSON.parse(await readFile(join(lexDir, f), 'utf8'));
    const lang = e.greek || e.hebrew;
    const [lemma, , gloss] = lang ? [lang.lemma, '', lang.gloss] : base[id] || lexInfo.get(id) || [];
    const translit = e.translit || base[id]?.[1] || '';
    const first = (e.occurrences?.KJV?.[id] || [])[0];
    const row = [id, lemma || '', translit || '', gloss || '', e.total || 0, first?.text || ''];
    for (const key of new Set([bare(lemma || '')[0], bare(translit || '')[0]].filter(Boolean))) (lemmas[key] ||= []).push(row);
  }
  for (const [k, rows] of Object.entries(lemmas)) await json(join(dir, 'lemma', `${safe(k)}.json`), rows);

  // People and places, from the Names and Places layers.
  const names = new Map();
  for (const [layer, kind] of [['names', 'person'], ['places', 'place']]) {
    for (const b of books) {
      const bd = join(out, 'layers', layer, b.id);
      if (!existsSync(bd)) continue;
      for (const f of await readdir(bd)) {
        const ch = +f.replace('.json', '');
        for (const t of JSON.parse(await readFile(join(bd, f), 'utf8'))) {
          if (!t.source) continue;
          // Names tags list several people per verse ("Jesse · David +2"); places carry a site number.
          for (const part of t.label.split(/[:(]/)[0].split('·')) {
            const name = part.replace(/\+\d+$/, '').replace(/\s+\d+$/, '').trim();
            if (!name || name.length > 40) continue;
            const key = `${kind}|${name}`;
            if (!names.has(key)) names.set(key, []);
            for (let v = t.start; v <= t.end; v++) { const at = ordinal.get(`${b.id}|${ch}|${v}`); if (at !== undefined) names.get(key).push(at); }
          }
        }
      }
    }
  }
  const byLetter = {};
  for (const [key, list] of names) { const [kind, name] = key.split('|'); (byLetter[bare(name)[0]] ||= []).push([name, kind, pack(list)]); }
  for (const [k, rows] of Object.entries(byLetter)) await json(join(dir, 'names', `${safe(k)}.json`), rows);
  return { verses: n, stems: counts, strongs: strongs.size, names: names.size };
}
