// Spec v0.23 §8.7: copy the app's saved AI suggestions into this repository, so they are kept in the
// open data with history and served free. Reads the app's public, read-only export
// (READY, not rejected, tags only) and writes ai/export/<BOOK>.json. The build merges these files
// as AI-suggested, unreviewed tags. Any failure keeps the last committed copy and never stops the build.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = (process.env.AI_EXPORT_URL || 'https://bible-zoom.base44.app/api/ai-export').replace(/\/$/, '');
const DIR = 'ai/export';
const UA = 'BibleZoomDataBuild/1.0 (https://github.com/peter-jeans/bible-zoom-data; open-data build)';

async function get(url, tries = 3) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(e => ({ ok: false, statusText: e.message }));
    if (res.ok) return res.json();
    last = res.status ? `HTTP ${res.status}` : res.statusText;
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`${url}: ${last}`);
}

try {
  const index = await get(BASE);
  if (index?.schema !== 'bible-zoom-ai-export-index/1') throw new Error('unexpected index format');
  await mkdir(DIR, { recursive: true });
  const books = Object.keys(index.books || {}).filter(b => /^[1-3A-Z][A-Z]{2}$/.test(b) && index.books[b] > 0).sort();
  let written = 0, tags = 0;
  for (const book of books) {
    const data = await get(`${BASE}?book=${book}`);
    if (data?.schema !== 'bible-zoom-ai-export/1' || data.book !== book || !Array.isArray(data.chapters)) throw new Error(`unexpected format for ${book}`);
    const chapters = data.chapters
      .filter(c => Number.isInteger(c.chapter) && typeof c.layer === 'string' && Array.isArray(c.tags) && c.tags.length)
      .sort((a, b) => a.chapter - b.chapter || a.layer.localeCompare(b.layer));
    if (!chapters.length) continue;
    tags += chapters.reduce((n, c) => n + c.tags.length, 0);
    // No timestamp in the file, so an unchanged export makes no commit.
    await writeFile(`${DIR}/${book}.json`, JSON.stringify({ schema: data.schema, book, source: 'Bible Zoom app (Base44), saved AI suggestions', ai_vocab_version: data.ai_vocab_version, chapters }) + '\n');
    written++;
  }
  // A book whose results were all rejected or removed drops out of the export.
  for (const f of existsSync(DIR) ? await readdir(DIR) : []) if (f.endsWith('.json') && !books.includes(f.replace(/\.json$/, ''))) await rm(`${DIR}/${f}`);
  console.log(`AI export: ${written} book(s), ${tags} tag(s).`);
} catch (e) {
  console.log(`::warning title=AI export::Could not fetch the app's AI export (${e.message}). Keeping the last committed copy.`);
}
