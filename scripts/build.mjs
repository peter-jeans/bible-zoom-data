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
import { crossReferences, places } from './lib/openbible.mjs';
import { outlineFromNotes } from './lib/structure.mjs';
import { loadTheographic, names as nameTags, events as eventTags, bookSetting } from './lib/theographic.mjs';
import { themes as themeTags } from './lib/themes.mjs';
import { poeticLines, acrostics } from './lib/poetry.mjs';

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
const textCache = {}, notesCache = {}, bookCache = {};
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

// Book-level engines from the unfoldingWord introductions and the WEB poetry markers.
async function bookExtras(id) {
  if (!bookCache[id]) {
    const t = await bookText(id);
    const last = c => t.KJV[c]?.at(-1)?.number || 0;
    const tn = existsSync(`${CACHE}/tn/tn_${id}.tsv`) ? await readFile(`${CACHE}/tn/tn_${id}.tsv`, 'utf8') : '';
    bookCache[id] = {
      outline: tn ? outlineFromNotes(tn, last) : {},
      setting: tn ? bookSetting(tn) : [],
      lines: poeticLines(await readFile(`${CACHE}/web/${await usfmFile('web', id)}`, 'utf8')),
    };
  }
  return bookCache[id];
}
const lastVerseOf = (book, ch) => textCache[book]?.KJV[ch]?.at(-1)?.number || 0;

// Figurative mode (spec v0.6 §5.10): a passage (outline section, else the chapter) where trope tags
// cover at least the registry threshold of verses is marked "figurative" by rule.
const litGroup = (registry.groups || []).find(g => g.id === 'Literature');
const FIG_THRESHOLD = litGroup?.figurative_threshold ?? 0.4;
function figurativeMode(sections = [], tropes, last) {
  const units = sections.filter(t => t.category === 'section');
  const spans = units.length ? units.map(t => [t.start, Math.min(t.end, last)]) : [[1, last]];
  const covered = new Set();
  for (const t of tropes) for (let v = t.start; v <= Math.min(t.end, last); v++) covered.add(v);
  const out = [];
  for (const [a, z] of spans) {
    const n = z - a + 1;
    let hit = 0;
    for (let v = a; v <= z; v++) if (covered.has(v)) hit++;
    if (n >= 2 && hit / n >= FIG_THRESHOLD) out.push({
      category: 'figurative', label: `Figurative (metaphor-rich) · ${Math.round(100 * hit / n)}% of verses`, start: a, end: z,
      status: 'SINGLE_PROPOSAL', method: 'rule', rule: 'trope-density', source: 'uw-tn', witnesses: 1,
      detail: `Found by a rule: ${hit} of ${n} verses here carry a metaphor or simile in unfoldingWord's notes (threshold ${Math.round(FIG_THRESHOLD * 100)}%). Rules can be wrong; check the text.`,
    });
  }
  return out;
}

// Mechanistic engines over whole-Bible data (no AI): cross-references, places, concordance counts.
const xref = await crossReferences(`${CACHE}/openbible/xref/cross_references.txt`, books);
const geo = await places(`${CACHE}/openbible/ancient.jsonl`, books);
const strongCount = new Map();
const occurrences = new Map();
for (const b of books) for (const [c, vs] of Object.entries((await bookText(b.id)).KJV)) for (const v of vs) for (const w of v.words) if (w.strong) {
  strongCount.set(w.strong, (strongCount.get(w.strong) || 0) + 1);
  if (!occurrences.has(w.strong)) occurrences.set(w.strong, []);
  const list = occurrences.get(w.strong);
  if (list.length < 500) list.push({ book: b.id, ch: +c, verse: v.number, text: w.text.replace(/[^\p{L}'’-]/gu, ''), id: w.id });
}
const theo = await loadTheographic(`${CACHE}/theographic`, books);
const names = nameTags(theo, (book, ch) => textCache[book]?.WEB[ch]);
const dated = eventTags(theo);
const acrostic = acrostics(lastVerseOf);
const peopleSubjects = new Set([...theo.person.values()].map(p => p.name?.toUpperCase()).filter(Boolean));
const placeSubjects = new Set(Object.values(geo).flatMap(chs => Object.values(chs).flat()).map(t => t.label.split(/[:(]/)[0].trim().toUpperCase()));
const topical = themeTags(await readFile(`${CACHE}/naves/naves.csv`, 'utf8'), books, { exclude: new Set([...peopleSubjects, ...placeSubjects]), lastVerse: lastVerseOf });
const withCounts = verses => verses.map(v => ({ ...v, words: v.words.map(w => (w.strong ? { ...w, count: strongCount.get(w.strong) } : w)) }));
function rareWords(verses = []) {
  const tags = [];
  for (const v of verses) {
    const rare = v.words.filter(w => w.strong && strongCount.get(w.strong) <= 2);
    if (rare.length) tags.push({
      category: 'occurrence', start: v.number, end: v.number, status: 'SETTLED', source: 'kjv-strongs', witnesses: 1,
      label: `Rare word${rare.length > 1 ? 's' : ''}: ${rare.map(w => `${w.text.replace(/[^\p{L}'’-]/gu, '')} (${w.strong}, ${strongCount.get(w.strong) === 1 ? 'only here' : 'twice in the Bible'})`).join(', ')}`,
    });
  }
  return tags;
}

// AI-suggested batches (spec §8.7): drafted by Claude in batches, labelled, never settled.
const aiByChapter = new Map();
if (existsSync('ai')) for (const f of (await readdir('ai')).filter(n => n.endsWith('.json')).sort()) {
  const batch = await json(`ai/${f}`);
  for (const g of batch.groups) for (const [book, c1, v1, c2, v2] of g.passages) for (let c = c1; c <= c2; c++) {
    const key = `${book}/${c}`;
    if (!aiByChapter.has(key)) aiByChapter.set(key, []);
    aiByChapter.get(key).push({ g, batch, from: c === c1 ? v1 : 1, to: c === c2 ? v2 : 0, group: `${g.group}-${book}` });
  }
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
      await save(`${out}/text/${tr}/${id}/${ch}.json`, { book: id, ch, verses: tr === 'KJV' ? withCounts(verses) : verses });
    }
  }
  // Layers from canonical sources, unless the seed already provides that layer.
  const notes = await bookNotes(id);
  const kjv = (await bookText(id)).KJV[ch];
  const extras = await bookExtras(id);
  const last = kjv.at(-1).number;
  const setting = extras.setting.map(s => ({ category: 'context', label: `${s.kind}: ${s.sentence}`, start: 1, end: last, status: 'SETTLED', source: 'uw-tn', witnesses: 1, detail: s.detail }));
  const poetry = [...(acrostic[id]?.[ch] || []), ...(extras.lines[ch] || []), ...(notes.poetry[ch] || [])];
  const history = [...setting, ...(dated[id]?.[ch] || [])];
  const generated = {
    figures: notes.figures[ch], imagery: notes.imagery[ch], poetry, genre: genreFor(id, ch),
    intertext: xref[id]?.[ch], places: geo[id]?.[ch], concordance: rareWords(kjv),
    structure: extras.outline[ch], history, themes: topical[id]?.[ch],
    names: (names[id]?.[ch] || []).filter(t => t.category !== 'speaker'),
    voice: (names[id]?.[ch] || []).filter(t => t.category === 'speaker'),
    mode: figurativeMode(extras.outline[ch], notes.imagery[ch] || [], last),
  };
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
  for (const a of aiByChapter.get(key) || []) {
    const file = `${out}/layers/${a.g.layer}/${id}/${ch}.json`;
    const existing = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : [];
    const end = a.to || last;
    const tags = a.g.options.map(o => ({
      category: o.category, label: o.label, start: Math.min(a.from, last), end: Math.min(end, last), status: 'CONTESTED', group: a.group,
      method: 'ai-suggested', reasoning: o.reasoning, drafted: a.batch.drafted, batch: a.batch.batch,
    }));
    await save(file, [...existing, ...tags]);
    if (!entry[a.g.layer]) entry[a.g.layer] = tags[0].category;
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

// Whole-Bible concordance: one file per Strong's number (first 500 occurrences, with the total).
let lexFiles = 0;
for (const [strong, list] of occurrences) {
  await save(`${out}/library/lexicon/${strong}.json`, { scope: 'Whole Bible (KJV)', total: strongCount.get(strong), occurrences: { KJV: { [strong]: list } } });
  lexFiles++;
}
console.log(`Concordance index: ${lexFiles} Strong's numbers.`);
await writeFile(`${out}/.nojekyll`, '');
console.log(`Built ${builtCount} chapters (${Object.keys(ordered).length}/${total}; budget ${allowed}). Next: ${remaining.slice(0, 5).join(', ') || 'none'}.`);
