// Engines over Theographic Bible Metadata (Robert Rouse, CC BY-SA 4.0, viz.bible):
//  - names():  Names & speakers layer: the people named in each verse (sourced), plus a speaker
//              rule over WEB quotation marks (rule-based proposal, never settled).
//  - events(): Historical setting layer: dated events, using Theographic's traditional chronology.
import { readFile } from 'node:fs/promises';
import { OSIS } from './openbible.mjs';

const firstSentence = (s = '', max = 220) => {
  const t = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  let out = (m ? m[1] : t);
  if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return out;
};
const year = y => { const n = Math.round(+y); return !Number.isFinite(n) ? '' : n < 0 ? `${-n} BC` : `AD ${n}`; };

export async function loadTheographic(dir, books) {
  const read = async f => JSON.parse(await readFile(`${dir}/${f}.json`, 'utf8'));
  const [verses, people, events] = [await read('verses'), await read('people'), await read('events')];
  const osisToId = new Map(OSIS.map((o, i) => [o, books[i].id]));
  const verseRef = new Map();
  for (const v of verses) {
    const [o, ch, vs] = v.fields.osisRef.split('.');
    if (osisToId.has(o)) verseRef.set(v.id, { book: osisToId.get(o), ch: +ch, v: +vs, people: v.fields.people || [] });
  }
  const person = new Map(people.map(p => [p.id, p.fields]));
  return { verseRef, person, events };
}

const DIVINE = ['Yahweh', 'God', 'the LORD', 'Jesus', 'the Lord'];
const SAY = '(?:said|says|answered|asked|replied|called|cried|spoke|commanded|declared|prayed|sang|wrote)';

// Returns { [BOOK]: { [ch]: tags[] } }. webText(book, ch) gives WEB verses for the speaker rule.
export function names(data, webText) {
  const out = {};
  const byVerse = new Map();
  for (const [, r] of data.verseRef) if (r.people.length) byVerse.set(`${r.book}|${r.ch}|${r.v}`, r);
  for (const [key, r] of byVerse) {
    const seen = new Set(), list = [];
    for (const id of r.people) {
      const p = data.person.get(id);
      if (!p?.name || seen.has(p.name)) continue;
      seen.add(p.name); list.push(p);
    }
    if (!list.length) continue;
    const [book, ch, v] = key.split('|');
    const shown = list.slice(0, 4).map(p => p.name);
    ((out[book] ||= {})[ch] ||= []).push({
      category: 'name', label: shown.join(' · ') + (list.length > 4 ? ` +${list.length - 4}` : ''),
      start: +v, end: +v, status: 'SETTLED', source: 'theographic', witnesses: 1,
      people: list.map(p => p.slug),
      detail: list.slice(0, 6).map(p => `${p.name}${p.dictText?.[0] ? ` — ${firstSentence(p.dictText[0], 160)}` : ''}`).join(' '),
    });
  }
  // Speaker rule: a verse that opens a quotation (“) with "<Name> said/answered…" before it, where
  // <Name> is a person named in that verse or a divine name. Proposal only.
  for (const book of Object.keys(out)) for (const ch of Object.keys(out[book])) {
    const verses = webText(book, +ch) || [];
    for (const vs of verses) {
      const text = vs.words.map(w => w.text).join(' ');
      const q = text.indexOf('“');
      if (q < 0) continue;
      const before = text.slice(Math.max(0, q - 90), q);
      const r = byVerse.get(`${book}|${ch}|${vs.number}`);
      const candidates = [...DIVINE, ...(r ? r.people.map(id => data.person.get(id)?.name).filter(Boolean) : [])]
        .sort((a, b) => b.length - a.length);
      let speaker = null;
      for (const n of candidates) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${esc}\\b[^“.]{0,40}\\b${SAY}\\b[^“]{0,40}$`).test(before) || new RegExp(`\\b${SAY}\\s+${esc}\\b[^“]{0,20}$`).test(before)) { speaker = n; break; }
      }
      if (!speaker) continue;
      out[book][ch].push({
        category: 'speaker', label: `Speaker: ${speaker.replace(/^the /, 'The ')}`, start: vs.number, end: vs.number,
        status: 'SINGLE_PROPOSAL', method: 'rule', rule: 'quote-attribution', source: 'web-text', witnesses: 1,
        detail: 'Found by a rule: a quotation opens after this name and a speech verb ("said", "answered"…). Rules can be wrong; check the text.',
      });
    }
  }
  for (const chs of Object.values(out)) for (const tags of Object.values(chs)) tags.sort((a, b) => a.start - b.start || (a.category === 'speaker') - (b.category === 'speaker'));
  return out;
}

// Returns { [BOOK]: { [ch]: tags[] } } for dated events, clipped to each chapter.
export function events(data) {
  const out = {};
  for (const e of data.events) {
    const f = e.fields;
    if (!f.verses?.length || !f.title) continue;
    const refs = f.verses.map(id => data.verseRef.get(id)).filter(Boolean);
    const byCh = new Map();
    for (const r of refs) {
      const k = `${r.book}|${r.ch}`;
      const cur = byCh.get(k) || { start: r.v, end: r.v };
      byCh.set(k, { start: Math.min(cur.start, r.v), end: Math.max(cur.end, r.v) });
    }
    const when = f.startDate ? year(f.startDate) : '';
    for (const [k, span] of byCh) {
      const [book, ch] = k.split('|');
      ((out[book] ||= {})[ch] ||= []).push({
        category: 'event', label: when ? `${f.title} · ${when}` : f.title, ...span,
        status: 'SETTLED', source: 'theographic', witnesses: 1,
        detail: `${f.title}${when ? `, dated ${when} in Theographic’s traditional chronology (dates are disputed; other chronologies differ)` : ''}.${f.notes ? ` ${firstSentence(f.notes, 240)}` : ''}`,
      });
    }
  }
  for (const chs of Object.values(out)) for (const tags of Object.values(chs)) tags.sort((a, b) => a.start - b.start);
  return out;
}

// Book-level setting from the unfoldingWord book introduction: authorship and date sections.
export function bookSetting(tsv) {
  const lines = tsv.split(/\r?\n/);
  const head = lines[0].split('\t');
  const intro = lines.find(l => l.split('\t')[head.indexOf('Reference')] === 'front:intro');
  if (!intro) return [];
  const text = intro.split('\t')[head.indexOf('Note')].replace(/\\n/g, '\n');
  const tags = [];
  const sections = text.split(/\n(?=#{2,4}\s)/);
  for (const s of sections) {
    const h = /^#{2,4}\s+(.*)/.exec(s)?.[1] || '';
    const kind = /who wrote|author/i.test(h) ? 'Authorship' : /when (was|were|did)|date|written/i.test(h) ? 'Date' : null;
    if (!kind || tags.some(t => t.kind === kind)) continue;
    const body = s.split('\n').slice(1).join(' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
    if (!body) continue;
    tags.push({ kind, sentence: firstSentence(body.replace(/\s*\((?:[1-3]?\s?[A-Z][a-z]+\.?\s[\d:–—\-,;\s]+|see [^)]*)+\)/g, ''), 200), detail: body.length > 600 ? body.slice(0, 599).replace(/\s+\S*$/, '') + '…' : body });
  }
  return tags;
}
