// Reception by writer (spec v0.37). Each writer's commentary is linked to verses by engine (no AI) and
// written to its own small files: commentary/<writer>/<BOOK>/<ch>.json = [{ start, end, text, work, url }].
// The app loads one writer's chapter only when the reader taps that writer's button.
import { readCommentaryRanges, plainText } from './sword.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Public-domain CrossWire modules: id, module folder, writer name, tradition, date (for ordering).
export const SWORD_WRITERS = [
  { id: 'calvin', module: 'CalvinCommentaries', name: 'John Calvin', work: "Calvin's Collected Commentaries", tradition: 'Reformation', year: 1550 },
  { id: 'henry-mhcc', module: 'MHCC', name: 'Matthew Henry', work: 'Concise Commentary on the Whole Bible', tradition: '18th–19th-century Protestant', year: 1706 },
  { id: 'wesley', module: 'Wesley', name: 'John Wesley', work: 'Notes on the Bible', tradition: '18th–19th-century Protestant', year: 1755 },
  { id: 'clarke', module: 'Clarke', name: 'Adam Clarke', work: 'Commentary and Critical Notes', tradition: '18th–19th-century Protestant', year: 1810 },
  { id: 'barnes', module: 'Barnes', name: 'Albert Barnes', work: 'Notes on the New Testament', tradition: '18th–19th-century Protestant', year: 1834 },
  { id: 'kd', module: 'KD', name: 'Keil and Delitzsch', work: 'Biblical Commentary on the Old Testament', tradition: '18th–19th-century Protestant', year: 1861 },
  { id: 'jfb', module: 'JFB', name: 'Jamieson, Fausset and Brown', work: 'Commentary Critical and Explanatory', tradition: '18th–19th-century Protestant', year: 1871 },
];

async function moduleDir(cache, module) {
  const base = join(cache, 'sword', module);
  const conf = (await readdir(join(base, 'mods.d'))).find(f => f.endsWith('.conf'));
  const text = await readFile(join(base, 'mods.d', conf), 'utf8');
  const path = /^DataPath=\.?\/?(.+?)\/?\s*$/m.exec(text)[1];
  return { dir: join(base, path), driver: /^ModDrv=(\S+)/m.exec(text)[1] };
}

const clean = t => plainText(t).replace(/\n{3,}/g, '\n\n').trim();

// Returns Map(writerId -> { BOOK: { ch: [entries] } }).
export async function swordWriters(cache, books, verseCounts) {
  const out = new Map();
  for (const w of SWORD_WRITERS) {
    if (!existsSync(join(cache, 'sword', w.module))) throw Error(`CrossWire module missing: ${w.module} (run scripts/fetch-sources.mjs)`);
    const { dir, driver } = await moduleDir(cache, w.module);
    const ranges = await readCommentaryRanges(dir, books, verseCounts, { driver });
    const byBook = {};
    for (const r of ranges) {
      const text = clean(r.text);
      if (text.length < 3) continue;
      const last = verseCounts(r.book, r.ch);
      ((byBook[r.book] ||= {})[r.ch] ||= []).push({ start: r.start || 1, end: r.end || (r.start ? r.start : last), text, ...(r.start ? {} : { intro: true }) });
    }
    out.set(w.id, byBook);
  }
  return out;
}

// Church Fathers from the HistoricalChristianFaith Commentaries Database (public-domain dedication).
// Only entries from Aquinas's Catena Aurea are used in this version: its English translation (J. H.
// Newman and others, 1841–45) is public domain. Fair-use excerpts of modern translations are not used.
const PD_WORKS = [/^Catena Aurea by Aquinas$/i];
export async function fatherWriters(hcfDir, books) {
  const names = JSON.parse(await readFile(join(hcfDir, 'book_names.json'), 'utf8').catch(() => '{}'));
  const byName = new Map();
  for (const b of books) byName.set(b.name.toLowerCase(), b.id);
  for (const [k, v] of Object.entries(names)) { const id = byName.get(String(v).toLowerCase()) || byName.get(String(k).toLowerCase()); if (id) byName.set(String(k).toLowerCase(), id); }
  byName.set('psalms', 'PSA'); byName.set('song of songs', 'SNG'); byName.set('song of solomon', 'SNG');
  const writers = new Map(); // name -> { BOOK: { ch: [entries] } }
  for (const father of await readdir(hcfDir)) {
    const dir = join(hcfDir, father);
    if (father.startsWith('.') || !existsSync(join(dir)) || /\.(json|py|md)$|^LICENSE$/.test(father)) continue;
    let files; try { files = await readdir(dir); } catch { continue; }
    for (const f of files) {
      const m = /^(.+?) (\d+)_(\d+)(?:-(?:(\d+)_)?(\d+))?\.toml$/.exec(f);
      if (!m) continue;
      const id = byName.get(m[1].toLowerCase());
      if (!id) continue;
      const ch = +m[2], start = +m[3], endCh = m[4] ? +m[4] : ch, end = endCh === ch ? +(m[5] || m[3]) : 999;
      const raw = await readFile(join(dir, f), 'utf8');
      for (const block of raw.split(/\[\[commentary\]\]/).slice(1)) {
        const title = /source_title\s*=\s*"([^"]*)"/.exec(block)?.[1] || /source_title\s*=\s*'([^']*)'/.exec(block)?.[1] || '';
        if (!PD_WORKS.some(re => re.test(title))) continue;
        const quote = /quote\s*=\s*'''([\s\S]*?)'''/.exec(block)?.[1] || /quote\s*=\s*"""([\s\S]*?)"""/.exec(block)?.[1];
        if (!quote?.trim()) continue;
        const url = /source_url\s*=\s*'([^']*)'/.exec(block)?.[1] || /source_url\s*=\s*"([^"]*)"/.exec(block)?.[1] || '';
        if (!writers.has(father)) writers.set(father, {});
        ((writers.get(father)[id] ||= {})[ch] ||= []).push({ start, end, text: quote.trim(), work: `${title} (tr. J. H. Newman and others, 1841–45)`, ...(url ? { url } : {}) });
      }
    }
  }
  return writers;
}
