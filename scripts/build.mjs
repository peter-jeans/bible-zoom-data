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
import { formsFor, formsFromNotes, voiceFromNotes, speechFormulas } from './lib/form.mjs';
import { buildSearchIndex } from './lib/search.mjs';
import { loadBsb, bsbVerse } from './lib/bsb.mjs';
import { readCommentary } from './lib/sword.mjs';
import { henryTags } from './lib/henry.mjs';
import { SWORD_WRITERS, swordWriters, fatherWriters } from './lib/commentaries.mjs';
import { SEFARIA_WRITERS, sefariaWriters } from './lib/sefaria.mjs';
import { buildScholars } from './lib/scholars.mjs';
import { loadTahot, originalTags, grammarTags, manuscriptTags, loadTagnt, greekOriginalTags, greekGrammarTags, greekVariantTags } from './lib/stepbible.mjs';
import { natureTags, objectTags } from './lib/world.mjs';
import { placeMaps, background, loadEaston } from './lib/background.mjs';
import { chapterOverview, bookOverview } from './lib/overview.mjs';

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
// Focus books first (spec v0.9 §8.8): FOCUS_BOOKS env (workflow input) overrides queue/config.json.
const focusBooks = (process.env.FOCUS_BOOKS ? process.env.FOCUS_BOOKS.split(',') : config.focus_books || []).map(b => b.trim().toUpperCase()).filter(b => bookIds.has(b));
for (const id of focusBooks) for (let c = 1; c <= chaptersOf(id); c++) enqueue(`${id}/${c}`);
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
// Spec v0.36: the Berean Standard Bible, verse places as in the KJV. Verses the BSB leaves out keep their
// place with a note pointing to the Manuscripts layer.
const bsb = existsSync(`${CACHE}/bsb/bsb_tables.tsv`) ? await loadBsb(`${CACHE}/bsb/bsb_tables.tsv`, `${CACHE}/bsb/bsb.txt`, registry.books) : null;
const bsbStats = { tables: 0, 'plain-fallback': 0, omitted: 0 };
function bsbChapters(id, kjv) {
  if (!bsb) throw Error('BSB source missing: run scripts/fetch-sources.mjs');
  const out = {};
  for (const [ch, verses] of Object.entries(kjv)) out[ch] = verses.map(v => {
    const got = bsbVerse(bsb, `${id}|${ch}|${v.number}`);
    if (!got?.words.length) { bsbStats.omitted++; return { number: v.number, words: [], omitted: true, note: 'The Berean Standard Bible leaves this verse out, as most modern Greek editions do. See the Manuscripts layer.' }; }
    bsbStats[got.checked]++;
    return { number: v.number, words: got.words.map((w, i) => ({ id: `${id}.${ch}.${v.number}.${i + 1}`, ...w })) };
  });
  return out;
}
async function bookText(id) {
  if (!textCache[id]) {
    const [k, w] = [await usfmFile('kjv', id), await usfmFile('web', id)];
    textCache[id] = {
      KJV: parseUsfm(await readFile(`${CACHE}/kjv/${k}`, 'utf8'), id, { strongs: true }),
      WEB: parseUsfm(await readFile(`${CACHE}/web/${w}`, 'utf8'), id, { strongs: false }),
    };
    textCache[id].BSB = bsbChapters(id, textCache[id].KJV);
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
      noteForms: tn ? formsFromNotes(tn) : {},
      voice: tn ? voiceFromNotes(tn) : {},
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
      category: 'symbolic', label: 'figurative (metaphor-rich)', share: Math.round(100 * hit / n), start: a, end: z,
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
const tahotFiles = existsSync(`${CACHE}/stepbible`) ? (await readdir(`${CACHE}/stepbible`)).filter(f => f.startsWith('tahot-')).map(f => `${CACHE}/stepbible/${f}`) : [];
const tahot = await loadTahot(tahotFiles, books);
const [hebrew, parsing, ketiv] = [originalTags(tahot), grammarTags(tahot), manuscriptTags(tahot)];
// Reception (owner request 2026-11-27): Matthew Henry's Concise Commentary by section, linked by its own
// headings. No AI.
const HENRY_DIR = `${CACHE}/sword/MHCC/modules/comments/zcom/mhcc`;
if (!existsSync(HENRY_DIR)) throw Error('Matthew Henry source missing: run scripts/fetch-sources.mjs');
const henryVerses = async (b, c) => (await bookText(b)).KJV[c]?.length || 0;
const henryCounts = {};
for (const b of books) { henryCounts[b.id] = {}; for (let c = 1; c <= b.chapters; c++) henryCounts[b.id][c] = await henryVerses(b.id, c); }
const henry = henryTags(await readCommentary(HENRY_DIR, books, (b, c) => henryCounts[b][c] || 0), books, (b, c) => henryCounts[b][c] || 0);
// Spec v0.37: Reception by writer. Each writer's commentary goes to commentary/<writer>/<BOOK>/<ch>.json,
// loaded only when a reader taps that writer; writers.json lists who they are. No AI.
const countOf = (b, c) => henryCounts[b]?.[c] || 0;
const writerMeta = [], writerData = new Map();
for (const [id, data] of await swordWriters(CACHE, books, countOf)) { const w = SWORD_WRITERS.find(x => x.id === id); writerMeta.push({ id, name: w.name, work: w.work, tradition: w.tradition, year: w.year, license: 'Public domain', source: `CrossWire SWORD module ${w.module}` }); writerData.set(id, data); }
if (existsSync(`${CACHE}/hcf`)) {
  for (const [name, data] of await fatherWriters(`${CACHE}/hcf`, books)) {
    const meta = await readFile(`${CACHE}/hcf/${name}/metadata.toml`, 'utf8').catch(() => '');
    const id = `father-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const category = /father_category\s*=\s*['"]([^'"]*)/.exec(meta)?.[1] || '';
    const tradition = { 'Second Temple Judaism': 'Jewish', 'Early Fathers (Pre-Nicaea)': 'Early church (before 325)', 'Eastern & Byzantine Theology': 'Eastern Fathers (Orthodox)', 'Western & Medieval Theology': 'Western Fathers and medieval (Catholic)', 'Syriac & Oriental Theology': 'Syriac and Oriental Fathers', 'Councils & Canons': 'Church councils', 'Pseudonymous Works': 'Works under another’s name', 'Canonical Scriptures': 'The Bible on itself (later books quoting earlier ones)', 'Apocrypha, Pseudepigrapha & Early Documents': 'Apocrypha and early writings', 'Reformation & Modern': 'Reformation and modern', 'Liturgies & Hymns': 'Liturgies and hymns' }[category] || 'Early church (before 325)';
    // Only named people can be cited as proponents (spec v0.38); books, councils, liturgies and anonymous works cannot.
    const person = !['Canonical Scriptures', 'Apocrypha, Pseudepigrapha & Early Documents', 'Liturgies & Hymns', 'Councils & Canons', 'Pseudonymous Works'].includes(category);
    const hasText = Object.values(data).some(chs => Object.values(chs).some(es => es.some(e => !e.linkOnly)));
    writerMeta.push({ id, name, person, work: hasText ? 'in the Catena Aurea of Thomas Aquinas, and other works (links)' : 'works linked at the source (not stored here)', linkOnly: !hasText, tradition, year: +(/default_year\s*=\s*(\d+)/.exec(meta)?.[1] || 600), license: hasText ? 'Public domain (Catena Aurea); other works linked only' : 'Linked only; text not stored', source: 'HistoricalChristianFaith Commentaries Database; Catena Aurea, tr. J. H. Newman and others, 1841–45, public domain; other works are links to that site, with no text stored' });
    writerData.set(id, data);
  }
}
// Sefaria text is kept in seed/bible/sefaria (public domain, CC0 or CC BY), so the build does not depend on
// Sefaria's rate limits; anything missing there is fetched and saved.
for (const [id, data] of await sefariaWriters(SEED, books, countOf)) { const w = SEFARIA_WRITERS.find(x => x.id === id); writerMeta.push({ id, name: w.name, work: w.work, tradition: w.tradition, year: w.year, license: 'Public domain or CC BY (shown on each entry)', source: 'Sefaria' }); writerData.set(id, data); }
const writersIn = (book, ch) => writerMeta.filter(w => writerData.get(w.id)?.[book]?.[ch]?.length).sort((a, b) => a.year - b.year);
const writersTag = (book, ch, last) => { const ws = writersIn(book, ch); return ws.length ? [{ category: 'tradition', kind: 'writers', label: `Commentary from ${ws.length} writer${ws.length > 1 ? 's' : ''}: ${ws.slice(0, 4).map(w => w.name).join(', ')}${ws.length > 4 ? '…' : ''}`, start: 1, end: last, status: 'SINGLE_PROPOSAL', source: 'henry-mhcc', witnesses: ws.length, writers: ws.map(w => w.id) }] : []; };
// Spec v0.35: the Greek New Testament from STEPBible TAGNT, in the same three layers.
const tagntFiles = existsSync(`${CACHE}/stepbible`) ? (await readdir(`${CACHE}/stepbible`)).filter(f => f.startsWith('tagnt-')).map(f => `${CACHE}/stepbible/${f}`) : [];
const tagnt = await loadTagnt(tagntFiles, books);
const [greek, greekParsing, greekVariants] = [greekOriginalTags(tagnt), greekGrammarTags(tagnt), greekVariantTags(tagnt)];
// Greek lemma details for the lexicon: the dictionary form, its gloss, and counts in two editions.
// Both languages also get the commonest transliteration, so search finds "agape" or "chesed".
const greekLex = new Map(), translits = new Map();
const noteTranslit = (strong, t) => { if (!strong || !t) return; const k = strong.replace(/^([HG])0*(\d+).*$/, '$1$2'); const s = t.split('/').pop().normalize('NFD').replace(/[^a-zA-Z ]/g, '').toLowerCase().trim(); if (!s) return; if (!translits.has(k)) translits.set(k, new Map()); const m = translits.get(k); m.set(s, (m.get(s) || 0) + 1); };
for (const words of tahot.verses.values()) for (const w of words) noteTranslit(w.strong, w.translit);
for (const words of tagnt.verses.values()) for (const w of words) noteTranslit(w.strong, w.translit);
// Hebrew dictionary forms and glosses, from TAHOT's "{H0430G=אֱלֹהִים=God»…}" column.
const hebrewLex = new Map();
for (const f of tahotFiles) for (const m of (await readFile(f, 'utf8')).matchAll(/\{H0*(\d+)\w?=([^=}]+)=([^»}@|]+)/g)) { const k = `H${m[1]}`; if (!hebrewLex.has(k)) hebrewLex.set(k, { lemma: m[2].trim(), gloss: m[3].trim() }); }
const translitOf = k => { const m = translits.get(k); return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : ''; };
for (const words of tagnt.verses.values()) for (const w of words) {
  if (!w.strong) continue;
  if (!greekLex.has(w.strong)) greekLex.set(w.strong, { lemma: w.lemma, gloss: w.lemmaGloss, na28: 0, tr: 0 });
  const e = greekLex.get(w.strong);
  if (w.editions.includes('NA28')) e.na28++;
  if (w.editions.includes('TR')) e.tr++;
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

// Batches spanning many chapters (spec §8.7, v0.22). ai/: AI-suggested, labelled, never settled.
// curated/: readings curated by the owner, each with a named published source (not AI). A group with
// "join": true keeps its exact group id, so it joins a seed group of the same name.
const aiByChapter = new Map();
// v0.32: curated statements of what the text itself says (checkable in the text).
const statements = [];
for (const dir of ['ai', 'curated']) if (existsSync(dir)) for (const f of (await readdir(dir)).filter(n => n.endsWith('.json')).sort()) {
  const batch = await json(`${dir}/${f}`);
  if (dir === 'curated') statements.push(...(batch.statements || []));
  for (const g of batch.groups) for (const [book, c1, v1, c2, v2] of g.passages) for (let c = c1; c <= c2; c++) {
    const key = `${book}/${c}`;
    if (!aiByChapter.has(key)) aiByChapter.set(key, []);
    aiByChapter.get(key).push({ g, batch, curated: dir === 'curated', from: c === c1 ? v1 : 1, to: c === c2 ? v2 : 0, group: g.join ? g.group : `${g.group}-${book}` });
  }
}

// Spec v0.23: saved AI suggestions copied from the app (ai/export/<BOOK>.json, by
// scripts/fetch-ai-export.mjs). Merged as AI-suggested, unreviewed tags; never settled.
const exportByChapter = new Map();
if (existsSync('ai/export')) for (const f of (await readdir('ai/export')).filter(n => n.endsWith('.json')).sort()) {
  const data = await json(`ai/export/${f}`);
  for (const c of data.chapters || []) {
    const key = `${data.book}/${c.chapter}`;
    if (!exportByChapter.has(key)) exportByChapter.set(key, []);
    exportByChapter.get(key).push(c);
  }
}

// v0.28: Form families. The kind table becomes Form's family level: specific forms are labelled
// "Family › form", and verses with no specific form get the family alone, so the two never stack.
const KIND_TO_FAMILY = { narrative: 'narrative', law: 'law', poetry: 'poetry', wisdom: 'wisdom', prophecy: 'prophecy', gospel: 'narrative', epistle: 'letter', apocalyptic: 'apocalyptic' };
const FAMILY_LABEL = { narrative: 'Narrative', law: 'Law', poetry: 'Poetry', wisdom: 'Wisdom', prophecy: 'Prophecy', letter: 'Letter', apocalyptic: 'Apocalyptic' };
function formWithFamilies(forms, kinds, last) {
  const named = (forms || []).map(t => (FAMILY_LABEL[t.category] && !String(t.label).includes('›') ? { ...t, label: `${FAMILY_LABEL[t.category]} › ${t.label}` } : t));
  const kind = (kinds || [])[0];
  if (!kind || !KIND_TO_FAMILY[kind.category]) return named;
  const family = KIND_TO_FAMILY[kind.category];
  const label = kind.category === 'gospel' ? 'Gospel narrative' : FAMILY_LABEL[family];
  const covered = new Set();
  for (const t of named) for (let v = t.start; v <= Math.min(t.end, last); v++) covered.add(v);
  const fill = [];
  for (let v = 1; v <= last; v++) {
    if (covered.has(v)) continue;
    const prev = fill.at(-1);
    if (prev && prev.end === v - 1) prev.end = v;
    else fill.push({ category: family, label, start: v, end: v, status: 'SETTLED', source: 'bz-genre', witnesses: 1 });
  }
  return [...named, ...fill].sort((a, b) => a.start - b.start || b.end - a.end);
}

// ---- 3. Build ---------------------------------------------------------------------------
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(SEED, out, { recursive: true });
// v0.22: fold any seed files of the retired layers into the merged ones (imagery → figures, mode → genre).
const MERGED = { imagery: 'figures', mode: 'genre' };
for (const [from, to] of Object.entries(MERGED)) {
  const dir = `${out}/layers/${from}`;
  if (!existsSync(dir)) continue;
  for (const book of await readdir(dir)) for (const f of await readdir(`${dir}/${book}`)) {
    const target = `${out}/layers/${to}/${book}/${f}`;
    const add = JSON.parse(await readFile(`${dir}/${book}/${f}`, 'utf8'));
    const have = existsSync(target) ? JSON.parse(await readFile(target, 'utf8')) : [];
    await save(target, [...have, ...add].sort((a, b) => a.start - b.start));
  }
  await rm(dir, { recursive: true, force: true });
}
for (const entry of Object.values(seedCoverage)) for (const [from, to] of Object.entries(MERGED)) if (from in entry) { if (!entry[to]) entry[to] = entry[from]; delete entry[from]; }

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
    for (const tr of ['KJV', 'WEB', 'BSB']) {
      const verses = t[tr][ch];
      if (!verses?.length) throw Error(`Missing ${tr} text for ${key}`);
      await save(`${out}/text/${tr}/${id}/${ch}.json`, { book: id, ch, verses: tr === 'KJV' ? withCounts(verses) : verses });
    }
  } else {
    // Curated seed chapters carry their own KJV and WEB; the BSB (v0.36) is always generated.
    const verses = (await bookText(id)).BSB[ch];
    if (!verses?.length) throw Error(`Missing BSB text for ${key}`);
    await save(`${out}/text/BSB/${id}/${ch}.json`, { book: id, ch, verses });
  }
  // Layers from canonical sources, unless the seed already provides that layer.
  const notes = await bookNotes(id);
  const kjv = (await bookText(id)).KJV[ch];
  const extras = await bookExtras(id);
  const last = kjv.at(-1).number;
  const setting = extras.setting.map(s => ({ category: 'context', label: `${s.kind}, according to unfoldingWord: ${s.sentence}`, start: 1, end: last, status: 'SINGLE_PROPOSAL', source: 'uw-tn', witnesses: 1, detail: s.detail }));
  const poetry = [...(acrostic[id]?.[ch] || []), ...(extras.lines[ch] || []), ...(notes.poetry[ch] || [])];
  // v0.32: one source's authorship, dates and chronology are views, never settled.
  const said = statements.filter(x => x.layer === 'history' && x.book === id && x.ch === ch).map(x => ({ category: x.category, label: x.label, start: 1, end: last, status: 'SETTLED', source: x.source, witnesses: 1, detail: x.detail, statement: 'text' }));
  const history = [...said, ...setting, ...(dated[id]?.[ch] || []).map(t => ({ ...t, status: 'SINGLE_PROPOSAL' }))];
  const generated = {
    // v0.22: "Figures & images" holds both rhetorical figures and metaphor/image families, and
    // "Ways of reading" (id genre) holds both the kind of writing and how it refers (former Mode).
    figures: [...(notes.figures[ch] || []), ...(notes.imagery[ch] || [])].sort((a, b) => a.start - b.start), poetry,
    // v0.28: Ways of reading holds how a passage is taken; the kind table (narrative, poetry, law…)
    // fills Form at family level instead.
    genre: figurativeMode(extras.outline[ch], notes.imagery[ch] || [], last),
    intertext: xref[id]?.[ch], places: geo[id]?.[ch], concordance: rareWords(kjv), reception: [...(henry[id]?.[ch] || []), ...writersTag(id, ch, last)],
    structure: extras.outline[ch], history, themes: topical[id]?.[ch],
    form: formWithFamilies(formsFor(id, ch, kjv, extras.noteForms), genreFor(id, ch), last),
    original: hebrew[id]?.[ch] || greek[id]?.[ch], grammar: parsing[id]?.[ch] || greekParsing[id]?.[ch], manuscripts: ketiv[id]?.[ch] || greekVariants[id]?.[ch],
    nature: natureTags(kjv), objects: objectTags(kjv),
    names: (names[id]?.[ch] || []).filter(t => t.category !== 'speaker'),
    voice: [...(names[id]?.[ch] || []).filter(t => t.category === 'speaker'), ...(extras.voice[ch] || []), ...speechFormulas(kjv)].sort((a, b) => a.start - b.start),
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
    const span = { start: Math.min(a.from, last), end: Math.min(end, last), status: 'CONTESTED', group: a.group, ...(a.g.title ? { group_title: a.g.title } : {}) };
    const tags = a.g.options.map(o => (a.curated
      ? { category: o.category, label: o.label, ...span, source: o.source, witnesses: 1, detail: o.detail, curated: a.batch.batch }
      : { category: o.category, label: o.label, ...span, method: 'ai-suggested', reasoning: o.reasoning, drafted: a.batch.drafted, batch: a.batch.batch }));
    await save(file, [...existing, ...tags]);
    if (!entry[a.g.layer]) entry[a.g.layer] = tags[0].category;
  }
  for (const c of exportByChapter.get(key) || []) {
    const layer = registry.layers.find(l => l.id === c.layer);
    if (!layer) continue;
    const cats = new Set(layer.categories.map(x => x.id));
    const file = `${out}/layers/${layer.id}/${id}/${ch}.json`;
    const existing = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : [];
    const known = new Set(existing.map(t => `${t.start}|${t.end}|${t.label}`));
    const tags = c.tags
      .filter(t => cats.has(t.category) && typeof t.reasoning === 'string' && t.reasoning.trim().length >= 10 && Number.isInteger(t.start) && Number.isInteger(t.end) && t.start >= 1 && t.start <= last)
      .map(t => ({ category: t.category, label: String(t.label).slice(0, 120), start: t.start, end: Math.min(Math.max(t.start, t.end), last),
        status: t.status === 'CONTESTED' && t.group ? 'CONTESTED' : 'SINGLE_PROPOSAL', ...(t.status === 'CONTESTED' && t.group ? { group: t.group } : {}),
        method: 'ai-suggested', reasoning: t.reasoning, drafted: t.drafted, model: t.model, review_state: t.review_state || 'UNREVIEWED', ...(t.attribution === 'unverified' ? { attribution: 'unverified' } : {}), batch: 'app-export' }))
      .filter(t => !known.has(`${t.start}|${t.end}|${t.label}`));
    // A contested group needs two readings; a lone survivor becomes a single proposal.
    const sizes = tags.reduce((m, t) => (t.group ? m.set(t.group, (m.get(t.group) || 0) + 1) : m), new Map());
    for (const t of tags) if (t.group && sizes.get(t.group) < 2) { t.status = 'SINGLE_PROPOSAL'; delete t.group; }
    if (!tags.length) continue;
    await save(file, [...existing, ...tags].sort((a, b) => a.start - b.start));
    if (!entry[layer.id]) entry[layer.id] = tags[0].category;
  }
  // v0.28: retired kind categories in Ways of reading are mapped (narrative → told as history,
  // apocalyptic → vision) or left out (poetry, law, wisdom, prophecy, gospel, letter: shown by Form).
  { const file = `${out}/layers/genre/${key}.json`, map = registry.retired_categories?.genre || {};
    if (existsSync(file)) {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      let tags = raw.flatMap(t => (t.category in map ? (map[t.category] ? [{ ...t, category: map[t.category] }] : []) : [t]));
      const sizes = tags.reduce((m, t) => (t.status === 'CONTESTED' && t.group ? m.set(t.group, (m.get(t.group) || 0) + 1) : m), new Map());
      tags = tags.map(t => (t.status === 'CONTESTED' && t.group && sizes.get(t.group) < 2 ? (({ group, group_title, ...rest }) => ({ ...rest, status: 'SINGLE_PROPOSAL' }))(t) : t));
      if (tags.length) { await save(file, tags); entry.genre = tags[0].category; } else { await rm(file); delete entry.genre; }
    } }
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
  focus: focusBooks,
  queue: { order: [...(focusBooks.length ? [`focus: ${focusBooks.join(', ')}`] : []), 'reader requests', 'top 200 passages', `popular books: ${config.popular_books.join(', ')}`, 'everything else'], requests: requests.length, next: remaining.slice(0, 25), remaining: remaining.length },
};
await save(`${out}/progress.json`, progress);

// Chapter packs (speed): one file per chapter with every layer, card-only detail text moved to a
// separate details file loaded when a card opens. build.json stamps the release so the app fetches
// matching files after an update. The per-layer files stay for the AI server and older clients.
const BUILD = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
let packs = 0, packBytes = 0;
const overviewByBook = new Map(), textByKey = new Map();
for (const [key, entry] of Object.entries(ordered)) {
  const layersOut = {}, details = {};
  // Spec v0.25: every span stays inside the chapter's real verses (no "to the end" markers reach the app).
  const textFile = `${out}/text/KJV/${key}.json`;
  const last = existsSync(textFile) ? JSON.parse(await readFile(textFile, 'utf8')).verses.at(-1)?.number || 1 : 1;
  for (const layer of Object.keys(entry)) {
    if (!entry[layer]) continue;
    const file = `${out}/layers/${layer}/${key}.json`;
    if (!existsSync(file)) continue;
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const tags = raw.map(t => (t.end > last || t.start > last ? { ...t, start: Math.min(t.start, last), end: Math.min(t.end, last) } : t));
    if (tags.some((t, i) => t !== raw[i])) await save(file, tags);
    layersOut[layer] = tags.map((t, i) => {
      if (!t.detail) return t;
      (details[layer] ||= {})[i] = t.detail;
      const { detail, ...rest } = t;
      return { ...rest, k: i, d: 1 };
    });
  }
  const pack = JSON.stringify({ build: BUILD, key, layers: layersOut });
  packBytes += pack.length;
  await save(`${out}/packs/${key}.json`, JSON.parse(pack));
  if (Object.keys(details).length) await save(`${out}/details/${key}.json`, details);
  packs++;
  // Spec v0.24: chapter overview from the same tags (with detail text, which overviews do not use).
  const [ob, oc] = key.split('/');
  // Whole-chapter notes (reception, translation compare) are not overview items.
  const full = Object.fromEntries(Object.entries(layersOut).map(([k, v]) => [k, ['reception', 'translation'].includes(k) ? [] : v]));
  await save(`${out}/overview/${key}.json`, chapterOverview(ob, +oc, full, last));
  if (!overviewByBook.has(ob)) overviewByBook.set(ob, []);
  overviewByBook.get(ob).push({ ch: +oc, layers: full });
  if (existsSync(textFile)) textByKey.set(key, JSON.parse(await readFile(textFile, 'utf8')).verses);
}
const genreLabels = Object.fromEntries(Object.entries(FAMILY_LABEL)); // v0.28: book overview kinds come from Form families
for (const [b, chs] of overviewByBook) await save(`${out}/overview/${b}.json`, bookOverview(b, chs.sort((x, y) => x.ch - y.ch), genreLabels));
// Spec v0.33: maps and background per book.
const maps = await placeMaps(`${CACHE}/openbible/ancient.jsonl`, books);
const easton = await loadEaston(`${CACHE}/theographic/easton.json`);
await save(`${out}/geo/basemap.json`, await json(`${SEED}/geo/basemap.json`));
for (const [b, chs] of overviewByBook) {
  const list = (maps[b] || []).map(p => ({ ...p, ch: Object.fromEntries(Object.entries(p.ch).filter(([c]) => chs.some(x => x.ch === +c))) })).filter(p => Object.keys(p.ch).length);
  await save(`${out}/geo/books/${b}.json`, { source: 'openbible-geo', places: list });
  await save(`${out}/background/${b}.json`, background(b, chs.map(c => ({ ...c, verses: textByKey.get(`${b}/${c.ch}`) || [] })), easton, list, dated[b]));
}
await save(`${out}/build.json`, { build: BUILD, generated: progress.generated, chapters: Object.keys(ordered).length });
console.log(`Chapter packs: ${packs} (${(packBytes / 1e6).toFixed(1)} MB raw); build ${BUILD}.`);

// Whole-Bible concordance: one file per Strong's number (first 500 occurrences, with the total).
let lexFiles = 0;
// Spec v0.36: how each translation renders each Strong's number, for the word card's "translated as".
// Neighbouring words linked to the same original word count as one rendering ("one and only").
const renderings = new Map();
for (const b of books) {
  const t = await bookText(b.id);
  for (const tr of ['KJV', 'WEB', 'BSB']) for (const verses of Object.values(t[tr] || {})) for (const v of verses) {
    let run = null;
    const flush = () => { if (!run) return; const k = run.strong.replace(/^([HG])0*(\d+).*$/, '$1$2'); if (!renderings.has(k)) renderings.set(k, { KJV: new Map(), WEB: new Map(), BSB: new Map() }); const m = renderings.get(k)[tr]; const phrase = run.words.join(' ').toLowerCase().replace(/[^\p{L}’' -]/gu, '').trim(); if (phrase) m.set(phrase, (m.get(phrase) || 0) + 1); run = null; };
    for (const w of v.words) { if (!w.strong) { flush(); continue; } if (run && run.strong === w.strong) run.words.push(w.text); else { flush(); run = { strong: w.strong, words: [w.text] }; } }
    flush();
  }
}
const renderingsOf = k => { const r = renderings.get(k); if (!r) return undefined; const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 12); const out = {}; for (const tr of ['KJV', 'WEB', 'BSB']) if (r[tr].size) out[tr] = top(r[tr]); return out; };
for (const [strong, list] of occurrences) {
  await save(`${out}/library/lexicon/${strong}.json`, { scope: 'Whole Bible (KJV)', total: strongCount.get(strong), ...(greekLex.has(strong) ? { greek: { ...greekLex.get(strong), source: 'stepbible-tagnt' } } : {}), ...(translitOf(strong) ? { translit: translitOf(strong) } : {}), ...(hebrewLex.has(strong) ? { hebrew: { ...hebrewLex.get(strong), source: 'stepbible-tahot' } } : {}), ...(renderingsOf(strong) ? { renderings: renderingsOf(strong) } : {}), occurrences: { KJV: { [strong]: list } } });
  lexFiles++;
}
console.log(`Concordance index: ${lexFiles} Strong's numbers.`);
// Image index (spec v0.21): thumbnail links and licence credits only; no images are stored.
const imageIndex = [`${CACHE}/images-index.json`, `${SEED}/images-index.json`].find(f => existsSync(f));
if (imageIndex) {
  const idx = await json(imageIndex);
  const trim = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, t: v.t.split('?')[0] }]));
  await save(`${out}/library/images.json`, { ...idx, places: trim(idx.places), words: trim(idx.words) });
  console.log(`Image index: ${Object.keys(idx.places).length} places, ${Object.keys(idx.words).length} words.`);
}
// Spec v0.35: the static search index, from the text and layers just written.
// Spec v0.37: writer files and the writer list.
let writerFiles = 0;
for (const [id, data] of writerData) for (const [book, chs] of Object.entries(data)) for (const [ch, entries] of Object.entries(chs)) { await save(`${out}/commentary/${id}/${book}/${ch}.json`, entries); writerFiles++; }
await save(`${out}/commentary/writers.json`, writerMeta.sort((a, b) => a.year - b.year));
console.log(`Reception: ${writerMeta.length} writers, ${writerFiles} chapter files.`);
// Spec v0.38: the citation guard's list of named people the AI may cite.
const scholarList = await buildScholars(`${SEED}/sources.json`, writerMeta, `${SEED}/scholars-extra.json`);
await save(`${out}/scholars.json`, { about: 'Named people an AI suggestion may give as a proponent (spec v0.38). Anyone else is shown as "proponent not verified".', scholars: scholarList });
console.log(`Scholar list: ${scholarList.length} names.`);
const searchStats = await buildSearchIndex(out, books);
console.log(`BSB verses: ${bsbStats.tables} with word links, ${bsbStats['plain-fallback']} plain text, ${bsbStats.omitted} left out.`);
console.log(`Search index: ${searchStats.verses} verses; word stems KJV ${searchStats.stems.KJV}, WEB ${searchStats.stems.WEB}; ${searchStats.strongs} Strong's numbers; ${searchStats.names} names.`);
await writeFile(`${out}/.nojekyll`, '');
console.log(`Built ${builtCount} chapters (${Object.keys(ordered).length}/${total}; budget ${allowed}). Next: ${remaining.slice(0, 5).join(', ') || 'none'}.`);
