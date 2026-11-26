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

// ---- Greek New Testament (spec v0.35): STEPBible TAGNT (Translators Amalgamated Greek NT, Tyndale
// House Cambridge / STEPBible.org, CC BY 4.0), the companion to TAHOT in the same format. Each word
// lists the printed editions that contain it, so edition differences become the NT Manuscripts layer.
export const EDITIONS = {
  NA28: 'Nestle-Aland 28th edition (2012)', NA27: 'Nestle-Aland 27th edition (1993)', Tyn: 'Tyndale House Greek NT (2017)',
  SBL: 'SBL Greek NT (2010)', WH: 'Westcott and Hort (1881)', Treg: 'Tregelles (1857–72)', TR: 'Textus Receptus (behind the KJV)', Byz: 'Byzantine text (Robinson-Pierpont)',
};
const ALL_EDITIONS = Object.keys(EDITIONS);
export const greekStrong = s => { const m = /G0*(\d+)/.exec(s || ''); return m ? `G${m[1]}` : ''; };

// Returns { verses: Map("BOOK|ch|v" -> words[]) }. A word: { n, type, greek, translit, gloss, strong,
// morph, lemma, lemmaGloss, editions[] }. Uppercase letters in the type (N, K, O) mark editions groups
// whose wording differs in meaning; lowercase ones only in spelling.
export async function loadTagnt(files, books) {
  const ids = new Set(books.map(b => b.id));
  const verses = new Map();
  for (const file of files) {
    for (const line of (await readFile(file, 'utf8')).normalize('NFC').split('\n')) {
      const m = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:\([^)]*\))?#(\d+)=([A-Za-z]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)/.exec(line);
      if (!m) continue;
      const id = m[1].toUpperCase();
      if (!ids.has(id)) continue;
      const key = `${id}|${+m[2]}|${+m[3]}`;
      const g = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(m[6].trim()) || [null, m[6].trim(), ''];
      const [sm, morph = ''] = m[8].split('=');
      const [lemma = '', lemmaGloss = ''] = m[9].split('=');
      const word = {
        n: +m[4], type: m[5], greek: g[1].trim(), translit: g[2].trim(), gloss: m[7].replace(/\s+/g, ' ').trim().replace(/[,.;:·]+$/, ''),
        strong: greekStrong(sm), morph: morph.trim(), lemma: lemma.split(',').pop().trim(), lemmaGloss: lemmaGloss.trim(),
        editions: m[10].split('+').map(s => s.trim()).filter(e => ALL_EDITIONS.includes(e)),
      };
      if (!verses.has(key)) verses.set(key, []);
      verses.get(key).push(word);
    }
  }
  return { verses };
}

// Words of the modern critical text (NA28); verses found only in other editions fall back to those.
const mainText = words => { const na = words.filter(w => w.editions.includes('NA28')); return na.length ? na : words; };
const plain = s => s.replace(/\[\[|\]\]|[[\]]/g, '').replace(/\s+/g, ' ').trim();

export function greekOriginalTags(tagnt) {
  return byChapter(tagnt.verses, (all, v) => {
    const words = mainText(all);
    const greek = plain(words.map(w => w.greek).join(' '));
    if (!greek) return null;
    return {
      category: 'lemma', label: greek, start: v, end: v, status: 'SETTLED', source: 'stepbible-tagnt', witnesses: 1, dir: 'ltr', language: 'Greek',
      detail: words.map(w => `${plain(w.translit)} (${w.gloss || '—'}${w.strong ? `, ${w.strong}` : ''})`).join(' · '),
    };
  });
}

// Robinson morphology codes (as used by TAGNT) in plain words: "V-AAI-3S" -> "verb, aorist active indicative, 3rd singular".
const TENSE = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect', '2A': 'second aorist', '2R': 'second perfect', '2F': 'second future', '2L': 'second pluperfect' };
const VOICE = { A: 'active', M: 'middle', P: 'passive', E: 'middle or passive', D: 'middle deponent', O: 'passive deponent', N: 'middle or passive deponent', Q: 'impersonal active', X: 'no voice' };
const MOOD = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle', R: 'imperative participle' };
const CASE = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
const NUM = { S: 'singular', P: 'plural' };
const GEN = { M: 'masculine', F: 'feminine', N: 'neuter' };
const POS = { N: 'noun', A: 'adjective', T: 'article', P: 'personal pronoun', R: 'relative pronoun', C: 'reciprocal pronoun', D: 'demonstrative pronoun', K: 'correlative pronoun', I: 'interrogative pronoun', X: 'indefinite pronoun', Q: 'correlative or interrogative pronoun', F: 'reflexive pronoun', S: 'possessive pronoun', ADV: 'adverb', CONJ: 'conjunction', COND: 'conditional', PRT: 'particle', PREP: 'preposition', INJ: 'interjection', ARAM: 'Aramaic word', HEB: 'Hebrew word', 'N-PRI': 'proper noun', 'A-NUI': 'number', 'N-LI': 'letter', 'N-OI': 'noun (indeclinable)' };
const caseNumGen = s => { const m = /^([NGDAV])([SP])([MFN])?/.exec(s || ''); return m ? [CASE[m[1]], NUM[m[2]], GEN[m[3]]].filter(Boolean).join(' ') : ''; };
export function parseGreek(code) {
  if (!code) return null;
  if (/\+/.test(code)) { const first = parseGreek(code.split('+')[0].trim()); return { pos: 'combined word', text: `two words written as one${first ? ` (${first.text} + another)` : ''}` }; }
  if (POS[code]) return { pos: POS[code], text: POS[code] };
  const parts = code.split('-');
  if (parts[0] === 'V') {
    const t = /^(2?[PIFARL])([AMPEDONQX])([ISONMPR])$/.exec(parts[1] || '');
    if (!t) return { pos: 'verb', text: 'verb' };
    const rest = parts[2] || '';
    const person = /^([123])([SP])$/.exec(rest);
    const tail = person ? `${person[1] === '1' ? '1st' : person[1] === '2' ? '2nd' : '3rd'} ${NUM[person[2]]}` : caseNumGen(rest);
    return { pos: 'verb', verb: true, text: `verb, ${TENSE[t[1]]} ${VOICE[t[2]]} ${MOOD[t[3]]}${tail ? `, ${tail}` : ''}` };
  }
  const pos = POS[parts[0]] || POS[`${parts[0]}-${parts[1]}`];
  if (!pos) return { pos: code, text: code };
  const cng = caseNumGen(parts[1]);
  return { pos, text: cng ? `${pos}, ${cng}` : pos };
}

export function greekGrammarTags(tagnt) {
  return byChapter(tagnt.verses, (all, v) => {
    const words = mainText(all).map(w => ({ w, p: parseGreek(w.morph) })).filter(x => x.p);
    if (!words.length) return null;
    const verbs = words.filter(x => x.p.verb);
    const short = verbs.map(({ w, p }) => `${plain(w.translit)} ${p.text.replace(/^verb, /, '').split(',')[0]}`);
    return {
      category: 'morphology', label: verbs.length ? `${verbs.length} verb${verbs.length > 1 ? 's' : ''}: ${short.join(' · ')}` : `${words.length} words parsed`, start: v, end: v,
      status: 'SETTLED', source: 'stepbible-tagnt', witnesses: 1,
      detail: words.map(({ w, p }) => `${plain(w.translit)} “${w.gloss}”: ${p.text} (${w.morph})`).join('; '),
    };
  });
}

// Edition differences that change the wording (uppercase type letters), grouped by the set of
// editions that contain them. Shown side by side, never ranked.
const nameList = eds => eds.map(e => (e === 'TR' ? 'Textus Receptus' : e === 'Byz' ? 'Byzantine' : e === 'Treg' ? 'Tregelles' : e === 'WH' ? 'Westcott-Hort' : e === 'Tyn' ? 'Tyndale House' : e)).join(', ');
export function greekVariantTags(tagnt) {
  return byChapter(tagnt.verses, (words, v) => {
    const differ = words.filter(w => /[NKO]/.test(w.type) && w.type !== 'NKO' && w.editions.length && w.editions.length < ALL_EDITIONS.length);
    if (!differ.length) return null;
    const groups = new Map();
    for (const w of differ) { const k = w.editions.join('+'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
    const bracketed = words.some(w => /\[\[/.test(w.greek));
    const parts = [...groups.entries()].map(([k, ws]) => {
      const inn = k.split('+'), out = ALL_EDITIONS.filter(e => !inn.includes(e));
      return { inn, out, greek: plain(ws.map(w => w.greek).join(' ')), english: ws.map(w => w.gloss).join(' ') };
    });
    const whole = differ.length === words.length;
    return {
      category: 'variant', start: v, end: v, status: 'SETTLED', source: 'stepbible-tagnt', witnesses: 1,
      label: whole ? `Edition difference: this verse is in ${nameList(parts[0].inn)}, not in ${nameList(parts[0].out)}` : `Edition difference: ${parts.length} place${parts.length > 1 ? 's' : ''} where printed Greek texts differ`,
      detail: `${parts.map(p => `“${p.english}” (${p.greek}) is in ${nameList(p.inn)}; not in ${nameList(p.out)}`).join('. ')}.${bracketed ? ' Double brackets [[ ]] in the editions mark words their editors judge to be a later addition, printed for its long use.' : ''} A printed edition is a scholar's text built from many handwritten manuscripts; editions differ where the manuscripts differ. They are listed here side by side, not ranked.`,
    };
  });
}
