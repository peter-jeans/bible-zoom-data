// Bible Zoom data build: the pre-population scheduler (spec v0.5 §8.3).
//
// 1. Works out the queue: reader requests, then the top-200 passages, then the 5 popular
//    books, then everything else in canonical order.
// 2. Builds as many queued chapters as today's budget allows (initial + per-day growth),
//    filling every layer it can from canonical open sources:
//      text (KJV with Strong's, WEB), figures / imagery / poetry (unfoldingWord Translation
//      Notes, CC BY-SA), genre (Bible Zoom genre table).
// 3. Curated seed data (seed/bible) always wins for the layers it provides.
// 4. Writes coverage.json, rollups and progress.json, then copies everything into dist/.
//
// Usage: node scripts/build.mjs [outDir] [--all]
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { argv } from 'node:process';
import { parseUsfm } from './lib/usfm.mjs';
import { notesToTags } from './lib/notes.mjs';
import { genreFor } from './lib/genre.mjs';

const out = argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'dist';
const buildAll = argv.includes('--all');
const SEED = 'seed/bible', CACHE = '.cache';
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const save = async (f, data) => { await mkdir(f.slice(0, f.lastIndexOf('/')), { recursive: true }); await writeFile(f, JSON.stringify(data)); };

const registry = await json(`${SEED}/registry.json`);
const seedCoverage = await json(`${SEED}/coverage.json`);
const config = await json('queue/config.json');
const top = await json('queue/top-passages.json');
const requests = existsSync(config.requests_file) ? (await json(config.requests_file)).chapters || [] : [];
const books = registry.books;
const bookIds = new Set(books.map(b => b.id));
const chaptersOf = id => books.find(b => b.id === id)?.chapters || 0;
const total = books.reduce((s, b) => s + b.chapters, 0);

// ---- 1. Queue -------------------------------------------------------------------------
const queue = [], inQueue = new Set();
const enqueue = key => { if (!inQueue.has(key)) { inQueue.add(key); queue.push(key); } };
const refToKeys = ref => {
  const m = /^([1-3A-Z]{3})\s+(\d+)(?::\d+(?:-\d+)?)?$/.exec(ref.trim());
  if (!m || !bookIds.has(m[1]) || +m[2] < 1 || +m[2] > chaptersOf(m[1])) throw Error(`Bad queue reference: ${ref}`);
  return [`${m[1]}/${+m[2]}`];
};
for (const key of requests) if (/^[1-3A-Z]{3}\/\d+$/.test(key)) enqueue(key);
for (const ref of top.passages) refToKeys(ref).forEach(enqueue);
for (const id of config.popular_books) for (let c = 1; c <= chaptersOf(id); c++) enqueue(`${id}/${c}`);
for (const b of books) for (let c = 1; c <= b.chapters; c++) enqueue(`${b.id}/${c}`);

const days = Math.max(0, Math.floor((Date.now() - Date.parse(config.start_date)) / 86400000));
const allowed = buildAll ? total : Math.min(total, config.initial_chapters + config.chapters_per_day * days);
const toBuild = new Set([...queue.slice(0, allowed), ...Object.keys(seedCoverage)]);

// ---- 2. Sources ------------------------------------------------------------------------
const usfmFile = async (dir, id) => (await readdir(`${CACHE}/${dir}`)).find(f => new RegExp(`^\\d+-${id}`).test(f));
const textCache = {}, notesCache = {};
async function bookText(id) {
  if (!textCache[id]) {
    const [k, w] = [await usfmFile('kjv', id), await usfmFile('web', id)];
    textCache[id] = {
      KJV: parseUsfm(await readFile(`${CACHE}/kjv/${k}`, 'utf8'), id, { strongs: true }),
      WEB: parseUsfm(await readFile(`${CACHE}/web/${w}`, 'utf8'), id, { strongs: false }),
    };
  }
  return textCache[id];
}
async function bookNotes(id) {
  if (!notesCache[id]) {
    const f = `${CACHE}/tn/tn_${id}.tsv`;
    notesCache[id] = existsSync(f) ? notesToTags(await readFile(f, 'utf8')) : { figures: {}, imagery: {}, poetry: {} };
  }
  return notesCache[id];
}

// ---- 3. Build ---------------------------------------------------------------------------
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(SEED, out, { recursive: true });

const coverage = {};
const layerIds = registry.layers.map(l => l.id);
let builtCount = 0;
for (const key of queue.filter(k => toBuild.has(k))) {
  const [id, chs] = key.split('/'); const ch = +chs;
  const seed = seedCoverage[key] || null;
  const entry = { ...(seed || {}) };
  // Text: keep curated seed text; otherwise generate.
  if (!seed) {
    const t = await bookText(id);
    for (const tr of ['KJV', 'WEB']) {
      const verses = t[tr][ch];
      if (!verses?.length) throw Error(`Missing ${tr} text for ${key}`);
      await save(`${out}/text/${tr}/${id}/${ch}.json`, { book: id, ch, verses });
    }
  }
  // Layers from canonical sources, unless the seed already provides that layer.
  const notes = await bookNotes(id);
  const generated = { figures: notes.figures[ch], imagery: notes.imagery[ch], poetry: notes.poetry[ch], genre: genreFor(id, ch) };
  for (const [layer, tags] of Object.entries(generated)) {
    if (!tags?.length) continue;
    // Curated seed tags come first; for the note-based layers the canonical tags are added after
    // them, so readers see every option. Genre stays curated where the seed provides it.
    if (layer in entry) {
      if (entry[layer] && layer !== 'genre') {
        const file = `${out}/layers/${layer}/${id}/${ch}.json`;
        const seedTags = JSON.parse(await readFile(file, 'utf8'));
        const known = new Set(seedTags.map(t => `${t.start}|${t.end}|${t.label}`));
        await save(file, [...seedTags, ...tags.filter(t => !known.has(`${t.start}|${t.end}|${t.label}`))]);
      }
      continue;
    }
    await save(`${out}/layers/${layer}/${id}/${ch}.json`, tags);
    entry[layer] = tags[0].category;
  }
  if (!Object.keys(entry).length) entry.genre = null;
  coverage[key] = Object.fromEntries(layerIds.filter(l => l in entry).map(l => [l, entry[l]]));
  builtCount++;
}

// ---- 4. Coverage, rollups, progress -----------------------------------------------------
const ordered = {};
for (const b of books) for (let c = 1; c <= b.chapters; c++) if (coverage[`${b.id}/${c}`]) ordered[`${b.id}/${c}`] = coverage[`${b.id}/${c}`];
await save(`${out}/coverage.json`, ordered);
const bible = books.map(b => ({ id: b.id, chapters: Array.from({ length: b.chapters }, (_, i) => ordered[`${b.id}/${i + 1}`] ?? null) }));
for (const r of bible) await save(`${out}/rollups/${r.id}.json`, [r]);
await save(`${out}/rollups/bible.json`, bible);

const layers = {};
for (const l of layerIds) {
  const built = Object.values(ordered).filter(e => e[l]).length;
  layers[l] = { built, total, percent: +(100 * built / total).toFixed(1) };
}
const remaining = queue.filter(k => !ordered[k]);
const progress = {
  generated: new Date().toISOString(),
  chapters: { total, built: Object.keys(ordered).length, allowed_today: allowed, per_day: config.chapters_per_day },
  layers,
  books: Object.fromEntries(bible.map(r => [r.id, {
    chapters: r.chapters.length,
    built: r.chapters.filter(Boolean).length,
    layers: Object.fromEntries(layerIds.map(l => [l, r.chapters.filter(c => c?.[l]).length]).filter(([, n]) => n)),
  }])),
  queue: { order: ['reader requests', 'top 200 passages', `popular books: ${config.popular_books.join(', ')}`, 'everything else'], requests: requests.length, next: remaining.slice(0, 25), remaining: remaining.length },
};
await save(`${out}/progress.json`, progress);
await writeFile(`${out}/.nojekyll`, '');
console.log(`Built ${builtCount} chapters (${Object.keys(ordered).length}/${total}; budget ${allowed}). Next: ${remaining.slice(0, 5).join(', ') || 'none'}.`);
