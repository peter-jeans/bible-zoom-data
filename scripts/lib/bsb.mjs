// Berean Standard Bible (spec v0.36). Public domain since 30 April 2023 (berean.bible/terms.htm).
// The text comes from the publisher's translation tables, which give, for every Hebrew or Greek word,
// its Strong's number, the English it becomes and that English's place in the verse ("BSB Sort").
// Rows are in original-language order; the verse reference appears on the first row of each verse.
// The plain text (bsb.txt) is used to check the result verse by verse and to fill any verse the
// tables leave out.
import { readFile } from 'node:fs/promises';

const clean = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// Book names as the publisher writes them -> registry ids.
export function bookIds(books) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = new Map(books.map(b => [norm(b.name), b.id]));
  for (const [alias, id] of [['psalm', 'PSA'], ['songofsongs', 'SNG'], ['songofsolomon', 'SNG']]) map.set(alias, id);
  return name => map.get(norm(name)) || null;
}

// Returns Map("BOOK|ch|v" -> [{ text, strong, lang }]) in English order, and the plain text by verse.
export async function loadBsb(tablesFile, textFile, books) {
  const idOf = bookIds(books);
  const plain = new Map();
  for (const line of (await readFile(textFile, 'utf8')).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^(.+?) (\d+):(\d+)\t(.*)$/.exec(line);
    if (!m) continue;
    const id = idOf(m[1]);
    if (id) plain.set(`${id}|${+m[2]}|${+m[3]}`, clean(m[4]));
  }
  const rows = new Map();
  let key = null, head = null;
  for (const line of (await readFile(tablesFile, 'utf8')).split(/\r?\n/)) {
    const c = line.split('\t');
    if (!head) { head = c.map(h => h.trim()); continue; }
    const col = name => c[head.indexOf(name)] ?? '';
    const ref = clean(col('VerseId'));
    if (ref) { const m = /^(.+?) (\d+):(\d+)$/.exec(ref); const id = m && idOf(m[1]); key = id ? `${id}|${+m[2]}|${+m[3]}` : null; }
    if (!key) continue;
    const english = clean(col('BSB version'));
    const sort = +col('BSB Sort');
    if (!english || english === '-' || !sort) continue;
    const lang = col('Language');
    const strong = lang === 'Greek' ? (clean(col('Str Grk')) && `G${+clean(col('Str Grk'))}`) : (clean(col('Str Heb')) && `H${+clean(col('Str Heb'))}`);
    const text = `${clean(col('begQ'))}${english}${clean(col('pnc'))}${clean(col('endQ'))}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ sort, text, strong: strong || '', lang });
  }
  const verses = new Map();
  for (const [k, list] of rows) verses.set(k, list.sort((a, b) => a.sort - b.sort));
  return { verses, plain };
}

// The words of one verse, ready for the text files: every English word carries the Strong's number of
// the original word it translates. Words that differ from the plain text are reported, not guessed.
const squash = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function bsbVerse(bsb, key) {
  const list = bsb.verses.get(key), text = bsb.plain.get(key);
  if (!list?.length) return text ? { words: text.split(' ').map(t => ({ text: t })), checked: 'plain' } : null;
  const words = [];
  // Table conventions: "vvv" marks a word whose English is given with another word; ". . ." a word
  // left untranslated; [brackets] English supplied by the translators (shown like the KJV's italics).
  let open = false;
  for (const r of list) for (const raw of r.text.replace(/\.\s\.\s\./g, ' ').split(' ').filter(Boolean)) {
    const tok = raw.replace(/vvv/g, '');
    if (!tok || /^[.\s]+$/.test(tok)) continue;
    const starts = tok.includes('['), ends = tok.includes(']');
    const t = tok.replace(/[[\]]/g, '');
    if (!t) { open = starts && !ends ? true : ends ? false : open; continue; }
    const added = open || starts;
    if (starts && !ends) open = true;
    if (ends) open = false;
    words.push({ text: t, ...(r.strong ? { strong: r.strong } : {}), ...(added ? { added: true } : {}) });
  }
  const same = !text || squash(words.map(w => w.text).join(' ')) === squash(text);
  // Where the tables don't rebuild the published wording exactly, the plain text is used, without word links.
  return same ? { words, checked: 'tables' } : { words: text.split(' ').map(t => ({ text: t })), checked: 'plain-fallback' };
}
