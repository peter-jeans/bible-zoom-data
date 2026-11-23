// Engines over STEPBible TAHOT (Translators Amalgamated Hebrew OT, Tyndale House / STEPBible.org,
// CC BY 4.0). References use English versification (the Hebrew one is in brackets), so tags line up
// with the KJV/WEB text.
//  - original():    Original words layer: the Hebrew of each verse, with transliteration and glosses.
//  - grammar():     Grammar layer: the verbs in each verse, parsed (stem, form, person, gender, number).
//  - manuscripts(): Manuscripts layer: Masoretic ketiv/qere (what is written vs what is read).
import { readFile } from 'node:fs/promises';

const STEMS = { q: 'Qal', Q: 'Qal passive', N: 'Niphal', p: 'Piel', P: 'Pual', h: 'Hiphil', H: 'Hophal', t: 'Hithpael', o: 'Polel', O: 'Polal', r: 'Hithpolel', m: 'Poel', M: 'Poal', k: 'Palel', K: 'Pulal', l: 'Pilpel', L: 'Polpal', f: 'Hithpalpel', D: 'Nithpael', j: 'Pealal', i: 'Pilel', u: 'Hothpaal', c: 'Tiphil', v: 'Hishtaphel', w: 'Nithpalel', y: 'Nithpoel', z: 'Hithpoel' };
const ARAMAIC_STEMS = { q: 'Peal', Q: 'Peil', u: 'Hithpeel', N: 'Niphal', p: 'Pael', P: 'Ithpaal', M: 'Hithpaal', a: 'Aphel', h: 'Haphel', s: 'Saphel', e: 'Shaphel', H: 'Hophal', i: 'Ithpeel', t: 'Hishtaphel', v: 'Ishtaphel', w: 'Hithaphel', o: 'Polel', z: 'Ithpoel', r: 'Hithpolel', f: 'Hithpalpel', b: 'Hephal', c: 'Tiphel', m: 'Poel', l: 'Palpel', L: 'Ithpalpel', O: 'Ithpolel', G: 'Ittaphal' };
const FORMS = { p: 'perfect', q: 'sequential perfect (weqatal)', i: 'imperfect', w: 'sequential imperfect (wayyiqtol)', h: 'cohortative', j: 'jussive', v: 'imperative', r: 'participle', s: 'passive participle', a: 'infinitive absolute', c: 'infinitive construct' };
const PGN = { 1: '1st', 2: '2nd', 3: '3rd', m: 'masc.', f: 'fem.', c: 'common', b: 'both', s: 'sing.', p: 'pl.', d: 'dual' };

// "HVqp3ms" -> "Qal perfect 3rd masc. sing."
export function parseVerb(code) {
  const m = /^([HA])V(\w)(\w)(.*)$/.exec(code);
  if (!m) return null;
  const stem = (m[1] === 'A' ? ARAMAIC_STEMS : STEMS)[m[2]] || m[2];
  const form = FORMS[m[3]] || m[3];
  const pgn = [...m[4].replace(/[^123mfcbspd]/g, '')].map(c => PGN[c]).filter(Boolean).join(' ');
  return { stem, form, text: `${stem} ${form}${pgn ? ` ${pgn}` : ''}`, aramaic: m[1] === 'A' };
}

const clean = s => (s || '').replace(/[\\/]/g, '').replace(/[֑-ֽ֯]/g, '').replace(/׃|׀|־$/g, '').trim(); // drop cantillation, keep vowels
const translit = s => (s || '').replace(/[./]/g, '').trim();

// Returns { verses: Map("BOOK|ch|v" -> words[]), kq: Map(key -> [{written, read}]) }
export async function loadTahot(files, books) {
  const ids = new Set(books.map(b => b.id));
  const osis = { get: a => (ids.has(a.toUpperCase()) ? a.toUpperCase() : null) }; // STEPBible uses USFM-style ids (Gen, Exo, Ezk…)
  const verses = new Map(), kq = new Map();
  for (const file of files) {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const m = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:\([^)]*\))?#(\d+)=([A-Za-z()]+)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)/.exec(line);
      if (!m) continue;
      const id = osis.get(m[1]);
      if (!id) continue;
      const key = `${id}|${+m[2]}|${+m[3]}`;
      const type = m[5];
      const word = { n: +m[4], type, hebrew: clean(m[6]), translit: translit(m[7]), gloss: (m[8] || '').replace(/\s+/g, ' ').trim(), strong: (m[9].match(/\{?(H\d+\w?)\}?/g) || []).map(s => s.replace(/[{}]/g, '')).pop() || '', grammar: m[10] };
      if (/^Q/.test(type)) { // read (qere) form; the written (ketiv) form is given in a variants column
        const k = /K=\s*([^\s(]+)\s*\(([^)]+)\)/.exec(line);
        if (k) {
          if (!kq.has(key)) kq.set(key, []);
          kq.get(key).push({ n: word.n, written: clean(k[2]), writtenT: translit(k[1]), read: word.hebrew, readT: word.translit, gloss: word.gloss });
        }
      }
      if (!verses.has(key)) verses.set(key, []);
      verses.get(key).push(word);
    }
  }
  return { verses, kq };
}

const byChapter = (map, fn) => {
  const out = {};
  for (const [key, val] of map) {
    const [book, ch, v] = key.split('|');
    if (+v < 1) continue; // Psalm titles (verse 0 in English numbering) have no KJV verse to anchor to
    const tag = fn(val, +v);
    if (tag) ((out[book] ||= {})[ch] ||= []).push(tag);
  }
  for (const chs of Object.values(out)) for (const tags of Object.values(chs)) tags.sort((a, b) => a.start - b.start);
  return out;
};

export function originalTags(tahot) {
  return byChapter(tahot.verses, (words, v) => {
    const hebrew = words.map(w => w.hebrew).join(' ').replace(/\s+/g, ' ');
    if (!hebrew) return null;
    const aramaic = words.some(w => /^A/.test(w.grammar));
    return {
      category: 'lemma', label: hebrew, start: v, end: v, status: 'SETTLED', source: 'stepbible-tahot', witnesses: 1, dir: 'rtl',
      language: aramaic ? 'Aramaic' : 'Hebrew',
      detail: words.map(w => `${w.translit} (${w.gloss || '—'}${w.strong ? `, ${w.strong}` : ''})`).join(' · '),
    };
  });
}

export function grammarTags(tahot) {
  return byChapter(tahot.verses, (words, v) => {
    const verbs = words.map(w => {
      const part = (w.grammar || '').split('/').map((p, i) => (i ? `${w.grammar[0]}${p}` : p)).find(p => /^[HA]V/.test(p));
      const parsed = part && parseVerb(part);
      return parsed && { word: w.translit.split('/').pop(), gloss: w.gloss.split('/').pop().trim(), ...parsed };
    }).filter(Boolean);
    if (!verbs.length) return null;
    const short = verbs.map(x => `${x.word} ${x.stem} ${x.form.replace(/ \(.*\)/, '')}`);
    return {
      category: 'morphology', label: `${verbs.length} verb${verbs.length > 1 ? 's' : ''}: ${short.join(' · ')}`, start: v, end: v,
      status: 'SETTLED', source: 'stepbible-tahot', witnesses: 1,
      detail: verbs.map(x => `${x.word} “${x.gloss}”: ${x.text}`).join('; '),
    };
  });
}

export function manuscriptTags(tahot) {
  return byChapter(tahot.kq, (pairs, v) => {
    const done = pairs.filter(p => p.read);
    if (!done.length) return null;
    return {
      category: 'variant', label: `Ketiv / Qere: ${done.map(p => `written ${p.writtenT}, read ${p.readT}`).join('; ')}`, start: v, end: v,
      status: 'SETTLED', source: 'stepbible-tahot', witnesses: 1,
      detail: `The Masoretic Text writes one form (ketiv) but marks another to be read aloud (qere): ${done.map(p => `${p.written} → ${p.read}${p.gloss ? ` (“${p.gloss}”)` : ''}`).join('; ')}.`,
    };
  });
}
