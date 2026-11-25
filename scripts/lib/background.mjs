// Maps and background for the overview cards (spec v0.33). Open sources only, nothing written by AI.
//  - placeMaps():   per book, every place named with its sites, OpenBible's score and the chapters.
//  - background():  per book, peoples, regions, everyday life (with Easton's, 1897) and dated events.
import { readFile } from 'node:fs/promises';
import { OSIS } from './openbible.mjs';
import { NATURE, OBJECTS } from './world.mjs';

const clean = s => String(s || '').replace(/<[^>]+>/g, '').trim();
const round = n => Math.round(n * 1000) / 1000;
// A site counts as well supported at half of OpenBible's scale (0–1000) with no rival at half its score.
export const SUPPORTED = 500;

export async function placeMaps(file, books) {
  const ids = new Map(OSIS.map((o, i) => [o, books[i].id]));
  const out = {};
  for (const line of (await readFile(file, 'utf8')).trim().split('\n')) {
    const p = JSON.parse(line);
    const sites = [];
    for (const i of p.identifications || []) {
      const at = (i.resolutions || []).find(r => /^-?[\d.]+,-?[\d.]+$/.test(r.lonlat || ''));
      const score = i.score?.time_total ?? 0;
      if (!at || score <= 0) continue;
      const [x, y] = at.lonlat.split(',').map(Number).map(round);
      if (sites.some(s => s.x === x && s.y === y)) continue;
      sites.push({ name: clean(i.description) || p.friendly_id, x, y, score });
    }
    sites.sort((a, b) => b.score - a.score);
    const status = !sites.length ? 'unknown' : sites[0].score >= SUPPORTED && !(sites[1]?.score >= sites[0].score * 0.5) ? 'supported' : 'uncertain';
    const refs = {};
    for (const osis of JSON.parse(p.extra || '{}').osises || []) {
      const m = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)/.exec(osis), b = m && ids.get(m[1]);
      if (!b) continue;
      const chs = (refs[b] ||= {}); (chs[m[2]] ||= new Set()).add(m[3]);
    }
    for (const [b, chs] of Object.entries(refs)) (out[b] ||= []).push({
      id: p.id, name: p.friendly_id.replace(/\s+\d+$/, ''), type: p.types?.[0] || 'place', status, sites,
      ch: Object.fromEntries(Object.entries(chs).map(([c, v]) => [c, v.size])),
    });
  }
  const total = p => Object.values(p.ch).reduce((a, b) => a + b, 0);
  for (const list of Object.values(out)) list.sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
  return out;
}

// Peoples are found by a rule: capitalised "-ite(s)" names and a short list, in the KJV text.
const PEOPLE = /\b(?:[A-Z][a-z]{2,}ites?|Philistines?|Egyptians?|Chaldeans?|Chaldees|Assyrians?|Syrians?|Babylonians?|Persians?|Medes|Ethiopians?|Arabians?|Sabeans|Grecians?|Greeks?|Romans?|Samaritans?|Galatians?|Cretians|Scythians?|Galileans?|Jews?|Hebrews?|Zidonians|Sidonians|Cherethims?|Anakims?|Rephaims?|Emims|Gittites?|Libyans)\b/g;
const NOT_PEOPLE = /^(Areopagites?|Nazarites?|Hypocrites?|Favou?rites?|Parasites?|Levites?)$/;
const singular = w => (/(ites|ans|ines|eans|ews|eeks|ims)$/.test(w) ? w.replace(/s$/, '') : w);
const plural = w => (/(Mede|Chaldee|Cretian|Sabean|Libyan|Emim|Zidonian|Sidonian)s$/.test(w) ? w : /s$/.test(w) ? w : `${w}s`);

// Word → Easton's headword, where they differ. Plurals fold to the singular automatically.
const HEAD = { kine: 'cow', cattle: 'cattle', oxen: 'ox', herd: 'herd', herds: 'herd', loaves: 'loaf', pence: 'penny', staves: 'staff', calves: 'calf', wolves: 'wolf', mice: 'mouse', leaves: 'leaf', tares: 'tares' };
const LIFE = [['animal', NATURE], ['plant', NATURE], ['food', OBJECTS], ['tool', OBJECTS], ['money', OBJECTS]];
// Words whose commonest KJV use is not the thing itself (seed = offspring, flesh = body…).
const SKIP = new Set('seed seeds flesh fruit fruits branch branches root roots measure measures span bath ark beast beasts herb hart ass rod roe hind fowl fowls'.split(' '));
const plain = s => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
// Easton's headwords that are a person or another sense, not the thing named.
const WRONG_SENSE = new Set('ram wine ark flock ear pen cup cock bee ant net hook hen owl staff rod tower'.split(' '));
function brief(text, max = 300) {
  // _italics_ marks are dropped too.
  // Bracketed Scripture references are dropped; sentences are kept whole. An abbreviation ("Rev. 16:13",
  // "Heb. bakar") does not end a sentence, and an entry that no longer reads cleanly is left out.
  let t = plain(text).replace(/_/g, ""), was;
  do { was = t; t = t.replace(/\s*\([^()]*\)/g, ''); } while (t !== was);
  t = t.replace(/\s+([,.;:])/g, '$1').trim();
  const parts = t.split(/(?<=[a-z”’)]{3}[.!?])\s+(?=[A-Z“])/);
  let out = '';
  for (const p of parts) {
    if (/\b(?:Heb|Gr|Lat|Comp|Arab|Rev|Matt|Mark|Luke|Isa|Jer|Ezek|Deut|Josh|Judg|Sam|Kings|Chr|Ps|Prov|Job|Ex|Gen|Lev|Num|Cor|Heb|Dan|Hos|Amos|Zech)\.$/.test(p)) break;
    if ((out + p).length > max) break;
    out += `${out ? ' ' : ''}${p}`;
  }
  return out.length >= 30 && /[.!?]$/.test(out) && !/^[,.;:]|[,;]{2}|,\./.test(out) ? out : '';
}
export async function loadEaston(file) {
  const m = new Map();
  for (const e of JSON.parse(await readFile(file, 'utf8'))) { const k = e.fields.dictLookup?.toLowerCase(); if (!k || WRONG_SENSE.has(k) || m.has(k)) continue; const t = brief(e.fields.dictText); if (t) m.set(k, t); }
  return m;
}
const stem = w => HEAD[w] || w;
export function background(book, chapters, easton, places, events) {
  // chapters: [{ ch, verses (KJV), layers }]
  const people = new Map(), life = new Map();
  for (const { ch, verses, layers } of chapters) {
    for (const v of verses) for (const m of new Set(v.words.map(w => w.text).join(' ').match(PEOPLE) || [])) {
      if (NOT_PEOPLE.test(m)) continue;
      const k = plural(singular(m)), e = people.get(k) || { label: k, chapters: new Set(), count: 0 };
      e.chapters.add(ch); e.count++; people.set(k, e);
    }
    for (const t of [...(layers.nature || []), ...(layers.objects || [])]) for (const w of t.words || []) {
      if (SKIP.has(w)) continue;
      let one = stem(w); if (one === w && w.endsWith('s') && [...Object.values(NATURE), ...Object.values(OBJECTS)].some(([, l]) => l.includes(w.slice(0, -1)))) one = w.slice(0, -1);
      const k = `${t.category}|${one}`, e = life.get(k) || { category: t.category, word: one, pic: w, chapters: new Set(), count: 0 };
      e.chapters.add(ch); e.count++; if (w === one) e.pic = w; life.set(k, e);
    }
  }
  const rank = list => list.sort((a, b) => b.count - a.count || Math.min(...a.chapters) - Math.min(...b.chapters)).map(({ chapters: c, ...e }) => ({ ...e, chapters: c.size, first: Math.min(...c) }));
  const regions = (places || []).filter(p => ['region', 'people group'].includes(p.type)).slice(0, 10).map(p => ({ id: p.id, label: p.name, chapters: Object.keys(p.ch).length, first: Math.min(...Object.keys(p.ch).map(Number)) }));
  const seen = new Set();
  return {
    book,
    peoples: rank([...people.values()]).slice(0, 12), regions,
    life: LIFE.map(([cat, table]) => ({ category: cat, label: table[cat][0], items: rank([...life.values()].filter(e => e.category === cat)).slice(0, 6).map(({ category, ...e }) => ({ ...e, ...(easton.get(e.word) ? { easton: easton.get(e.word) } : {}) })) })).filter(g => g.items.length),
    events: chapters.flatMap(({ ch }) => (events?.[ch] || []).map(t => ({ label: t.label, ch, start: t.start }))).filter(e => !seen.has(e.label) && seen.add(e.label)).slice(0, 16),
    routes: [], // No openly licensed source of proposed routes has been found (checked 2026-11-25).
  };
}
