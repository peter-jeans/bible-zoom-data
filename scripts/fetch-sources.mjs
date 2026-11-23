// Downloads the open source datasets into .cache/ (skipped when already present).
// Polite fetching: identifying User-Agent, sequential requests, nothing re-downloaded.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

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
let fetched = 0;
for (const b of registry.books) {
  if (await download(`https://git.door43.org/unfoldingWord/en_tn/raw/branch/master/tn_${b.id}.tsv`, `${CACHE}/tn/tn_${b.id}.tsv`)) fetched++;
}
console.log(`Sources ready (${fetched} translation-note files downloaded this run).`);
