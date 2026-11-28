// Scholar list for the citation guard (spec v0.38). An AI suggestion may name a proponent only if that
// person is on this list: the named authors and editors in the source list, the Reception writers, and
// any names the owner adds in seed/bible/scholars-extra.json. Organisations are not people and are left out.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ORGS = /committee|contributors|bible zoom|openbible|tyndale|natural earth|unfoldingword|photographers|bible hub|discovery bible|stepbible|ebible|viz\.bible|data by|crosswire|sefaria|council|glossa|pseudo|ancient greek expositor|works/i;
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function people(text) {
  const out = [];
  const inner = [...text.matchAll(/\(in ([^)]+?),? eds?\.\)/g)].map(m => m[1]);
  const main = text.replace(/\([^)]*\)/g, ' ');
  for (const part of [main, ...inner].flatMap(t => t.split(/;|,| and /))) {
    const name = part.replace(/\s+/g, ' ').trim();
    if (!name || ORGS.test(name) || !/[A-Z][a-z]/.test(name)) continue;
    const words = name.split(' ').filter(w => /^[A-Z]/.test(w));
    if (!words.length) continue;
    out.push(name);
  }
  return out;
}

export async function buildScholars(sourcesFile, writersList, extraFile) {
  const sources = JSON.parse(await readFile(sourcesFile, 'utf8'));
  const names = new Set();
  for (const s of Array.isArray(sources) ? sources : sources.sources) for (const n of people(s.author || '')) names.add(n);
  for (const w of writersList) if (w.person !== false) for (const n of w.name.split(/ and |, /)) if (!ORGS.test(n)) names.add(n.replace(/\s*\(.*\)/, '').trim());
  if (existsSync(extraFile)) for (const n of JSON.parse(await readFile(extraFile, 'utf8')).names || []) names.add(n);
  return [...names].filter(Boolean).sort().map(name => {
    const words = plain(name).replace(/ of [A-Z].*$| the [A-Z].*$/, '').split(' ').filter(Boolean);
    const surname = words.at(-1), given = words.slice(0, -1).map(w => w[0]).join('');
    return { name, surname, given };
  });
}
