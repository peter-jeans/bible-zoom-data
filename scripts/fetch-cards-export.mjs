// Spec v0.41: copy the app's approved study cards into this repository (cards/export.json), so they are
// kept in the open data with history and served free. Reads the app's public, read-only export, which
// gives approved cards only (no drafts, verification or review notes). Any failure keeps the last
// committed copy and never stops the build.
import { mkdir, writeFile } from 'node:fs/promises';

const URL_ = process.env.CARDS_EXPORT_URL || 'https://bible-zoom.base44.app/api/cards-export';
const UA = 'BibleZoomDataBuild/1.0 (https://github.com/peter-jeans/bible-zoom-data; open-data build)';

try {
  let data, last = '';
  for (let i = 0; i < 3 && !data; i++) {
    const res = await fetch(URL_, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(e => ({ ok: false, statusText: e.message }));
    if (res.ok) data = await res.json(); else { last = res.status ? `HTTP ${res.status}` : res.statusText; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
  if (!data) throw new Error(last);
  if (data.schema !== 'bible-zoom-cards-export/1' || !Array.isArray(data.cards)) throw new Error('unexpected format');
  await mkdir('cards', { recursive: true });
  // No timestamp in the file, so an unchanged export makes no commit.
  const cards = data.cards.filter(c => c && typeof c.card_id === 'string').sort((a, b) => a.card_id.localeCompare(b.card_id));
  await writeFile('cards/export.json', JSON.stringify({ schema: data.schema, source: 'Bible Zoom app (Base44), approved study cards', cards }, null, 1) + '\n');
  console.log(`Cards export: ${cards.length} approved card(s).`);
} catch (e) {
  console.log(`::warning title=Cards export::Could not fetch the app's cards export (${e.message}). Keeping the last committed copy.`);
}
