// Downloads the open source datasets into .cache/ (skipped when already present).
// Polite fetching: identifying User-Agent, sequential requests, nothing re-downloaded.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { buildImageIndex } from './lib/images.mjs';

const UA = 'bible-zoom-data-build/0.2 (+https://github.com/peter-jeans/bible-zoom-data)';
const CACHE = '.cache';
const registry = JSON.parse(await readFile('seed/bible/registry.json', 'utf8'));

async function download(url, file) {
  if (existsSync(file)) return false;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw Error(`Download failed (${res.status}): ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

await mkdir(`${CACHE}/tn`, { recursive: true });
const bibles = { kjv: 'https://ebible.org/Scriptures/eng-kjv2006_usfm.zip', web: 'https://ebible.org/Scriptures/eng-web_usfm.zip' };
for (const [name, url] of Object.entries(bibles)) {
  if (await download(url, `${CACHE}/${name}.zip`) || !existsSync(`${CACHE}/${name}`)) {
    execFileSync('unzip', ['-oq', `${CACHE}/${name}.zip`, '-d', `${CACHE}/${name}`]);
    console.log(`Fetched ${name}`);
  }
}
await download('https://git.door43.org/unfoldingWord/en_tn/raw/branch/master/LICENSE.md', `${CACHE}/tn/LICENSE.md`);
await mkdir(`${CACHE}/openbible`, { recursive: true });
if (await download('https://a.openbible.info/data/cross-references.zip', `${CACHE}/openbible/xref.zip`) || !existsSync(`${CACHE}/openbible/xref`)) {
  execFileSync('unzip', ['-oq', `${CACHE}/openbible/xref.zip`, '-d', `${CACHE}/openbible/xref`]);
}
await download('https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl', `${CACHE}/openbible/ancient.jsonl`);
await mkdir(`${CACHE}/theographic`, { recursive: true });
for (const f of ['verses', 'people', 'events', 'easton']) await download(`https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/master/json/${f}.json`, `${CACHE}/theographic/${f}.json`);
await mkdir(`${CACHE}/naves`, { recursive: true });
await download('https://raw.githubusercontent.com/BradyStephenson/bible-data/main/NavesTopicalDictionary.csv', `${CACHE}/naves/naves.csv`);
// STEPBible TAHOT (CC BY 4.0): tagged Hebrew OT, for Original words, Grammar and ketiv/qere.
await mkdir(`${CACHE}/stepbible`, { recursive: true });
const TAHOT = { 'Gen-Deu': 'tahot-gen-deu', 'Jos-Est': 'tahot-jos-est', 'Job-Sng': 'tahot-job-sng', 'Isa-Mal': 'tahot-isa-mal' };
for (const [range, name] of Object.entries(TAHOT)) await download(`https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Translators%20Amalgamated%20OT%2BNT/TAHOT%20${range}%20-%20Translators%20Amalgamated%20Hebrew%20OT%20-%20STEPBible.org%20CC%20BY.txt`, `${CACHE}/stepbible/${name}.txt`);
// Matthew Henry's Concise Commentary (public domain), CrossWire SWORD module MHCC, for Reception.
await mkdir(`${CACHE}/sword`, { recursive: true });
if (await download('https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/MHCC.zip', `${CACHE}/sword/MHCC.zip`) || !existsSync(`${CACHE}/sword/MHCC`)) execFileSync('unzip', ['-oq', `${CACHE}/sword/MHCC.zip`, '-d', `${CACHE}/sword/MHCC`]);
// Reception writers (spec v0.37): public-domain CrossWire commentaries, and the Church Fathers collection
// (public-domain dedication; only Catena Aurea entries are used). Sefaria is fetched during the build.
for (const m of ['Wesley', 'Clarke', 'Barnes', 'JFB', 'KD', 'CalvinCommentaries']) {
  if (await download(`https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/${m}.zip`, `${CACHE}/sword/${m}.zip`) || !existsSync(`${CACHE}/sword/${m}`)) execFileSync('unzip', ['-oq', `${CACHE}/sword/${m}.zip`, '-d', `${CACHE}/sword/${m}`]);
}
if (!existsSync(`${CACHE}/hcf`)) execFileSync('git', ['clone', '-q', '--depth', '1', 'https://github.com/HistoricalChristianFaith/Commentaries-Database.git', `${CACHE}/hcf`]);
// Berean Standard Bible (public domain since 30 April 2023): plain text and translation tables (spec v0.36).
await mkdir(`${CACHE}/bsb`, { recursive: true });
for (const name of ['bsb.txt', 'bsb_tables.tsv']) await download(`https://bereanbible.com/${name}`, `${CACHE}/bsb/${name}`);
// STEPBible TAGNT (CC BY 4.0): tagged Greek NT with the wording of eight printed editions (spec v0.35).
const TAGNT = { 'Mat-Jhn': 'tagnt-mat-jhn', 'Act-Rev': 'tagnt-act-rev' };
for (const [range, name] of Object.entries(TAGNT)) await download(`https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Translators%20Amalgamated%20OT%2BNT/TAGNT%20${range}%20-%20Translators%20Amalgamated%20Greek%20NT%20-%20STEPBible.org%20CC-BY.txt`, `${CACHE}/stepbible/${name}.txt`);
let fetched = 0;
for (const b of registry.books) {
  if (await download(`https://git.door43.org/unfoldingWord/en_tn/raw/branch/master/tn_${b.id}.tsv`, `${CACHE}/tn/tn_${b.id}.tsv`)) fetched++;
}
// Image index (spec v0.21): links and credits for openly licensed Wikimedia Commons thumbnails.
// Rebuilt weekly; a failure keeps the previous index and never stops the data build.
const IMAGES = `${CACHE}/images-index.json`;
if (!existsSync(IMAGES) || Date.now() - statSync(IMAGES).mtimeMs > 7 * 86400000) {
  try {
    const idx = await buildImageIndex(`${CACHE}/openbible/ancient.jsonl`);
    await writeFile(IMAGES, JSON.stringify(idx));
    console.log(`Image index: ${Object.keys(idx.places).length} places, ${Object.keys(idx.words).length} words.`);
  } catch (e) { console.warn(`Image index not refreshed: ${e.message}`); }
}
console.log(`Sources ready (${fetched} translation-note files downloaded this run).`);
