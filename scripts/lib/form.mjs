// Form engine (spec v0.6 §5.10, v0.9 §8.8). Labels come only from the registry's form vocabulary.
// Three kinds of evidence, kept apart by status:
//  - TABLE: standard passages for a form (Bible Zoom form table) -> SETTLED, one witness (bz-forms).
//  - CLASSIFICATION: psalm types after Gunkel, where scholars differ -> SINGLE_PROPOSAL (bz-forms).
//  - RULE: text patterns (begat, Woe, I saw, Thou shalt…) and unfoldingWord flags -> SINGLE_PROPOSAL,
//    method "rule" (or SETTLED with source uw-tn where unfoldingWord names the form).

// [book, startCh, startV, endCh, endV (0 = end of chapter), family, form]
const TABLE = [
  ['GEN', 12, 1, 12, 3, 'narrative', 'call narrative'],
  ['GEN', 18, 1, 18, 15, 'narrative', 'theophany'],
  ['GEN', 28, 10, 28, 22, 'narrative', 'theophany'],
  ['GEN', 32, 22, 32, 32, 'narrative', 'theophany'],
  ['EXO', 3, 1, 4, 17, 'narrative', 'call narrative'],
  ['EXO', 3, 1, 3, 6, 'narrative', 'theophany'],
  ['EXO', 19, 16, 19, 25, 'narrative', 'theophany'],
  ['EXO', 20, 1, 20, 17, 'law', 'apodictic law'],
  ['EXO', 21, 1, 23, 19, 'law', 'casuistic law'],
  ['LEV', 1, 1, 7, 0, 'law', 'ritual instruction'],
  ['LEV', 11, 1, 16, 0, 'law', 'ritual instruction'],
  ['DEU', 5, 6, 5, 21, 'law', 'apodictic law'],
  ['JDG', 6, 11, 6, 24, 'narrative', 'call narrative'],
  ['1SA', 3, 1, 3, 21, 'narrative', 'call narrative'],
  ['1KI', 19, 9, 19, 18, 'narrative', 'theophany'],
  ['JOB', 3, 1, 42, 6, 'wisdom', 'wisdom dialogue'],
  ['PRO', 10, 1, 22, 16, 'wisdom', 'proverb'],
  ['PRO', 25, 1, 29, 0, 'wisdom', 'proverb'],
  ['ISA', 6, 1, 6, 13, 'narrative', 'call narrative'],
  ['JER', 1, 4, 1, 19, 'narrative', 'call narrative'],
  ['EZK', 1, 1, 3, 15, 'narrative', 'call narrative'],
  ['JER', 13, 1, 13, 11, 'prophecy', 'symbolic act'],
  ['JER', 19, 1, 19, 13, 'prophecy', 'symbolic act'],
  ['EZK', 4, 1, 5, 4, 'prophecy', 'symbolic act'],
  ['HOS', 1, 2, 1, 9, 'prophecy', 'symbolic act'],
  ['MAT', 1, 1, 1, 17, 'narrative', 'genealogy'],
  ['MAT', 1, 18, 2, 0, 'narrative', 'infancy narrative'],
  ['LUK', 1, 5, 2, 52, 'narrative', 'infancy narrative'],
  ['LUK', 3, 23, 3, 38, 'narrative', 'genealogy'],
  ['MAT', 4, 18, 4, 22, 'narrative', 'call narrative'],
  ['MRK', 1, 16, 1, 20, 'narrative', 'call narrative'],
  ['LUK', 5, 1, 5, 11, 'narrative', 'call narrative'],
  ['JHN', 1, 35, 1, 51, 'narrative', 'call narrative'],
  ['MAT', 5, 1, 7, 0, 'narrative', 'speech or sermon'],
  ['LUK', 6, 20, 6, 49, 'narrative', 'speech or sermon'],
  ['MAT', 17, 1, 17, 8, 'narrative', 'theophany'],
  ['ACT', 2, 14, 2, 36, 'narrative', 'speech or sermon'],
  ['ACT', 7, 2, 7, 53, 'narrative', 'speech or sermon'],
  ['ACT', 13, 16, 13, 41, 'narrative', 'speech or sermon'],
  ['ACT', 17, 22, 17, 31, 'narrative', 'speech or sermon'],
  ['ACT', 9, 1, 9, 19, 'narrative', 'call narrative'],
  ['MAT', 26, 1, 27, 0, 'narrative', 'passion narrative'],
  ['MRK', 14, 1, 15, 0, 'narrative', 'passion narrative'],
  ['LUK', 22, 1, 23, 0, 'narrative', 'passion narrative'],
  ['JHN', 18, 1, 19, 0, 'narrative', 'passion narrative'],
  ['MAT', 28, 1, 28, 0, 'narrative', 'resurrection account'],
  ['MRK', 16, 1, 16, 8, 'narrative', 'resurrection account'],
  ['LUK', 24, 1, 24, 0, 'narrative', 'resurrection account'],
  ['JHN', 20, 1, 21, 0, 'narrative', 'resurrection account'],
  ['LUK', 1, 46, 1, 55, 'poetry', 'hymn of praise'],
  ['LUK', 1, 68, 1, 79, 'poetry', 'hymn of praise'],
  ['LUK', 2, 29, 2, 32, 'poetry', 'hymn of praise'],
  ['EXO', 15, 1, 15, 21, 'poetry', 'hymn of praise'],
  ['SNG', 1, 1, 8, 0, 'poetry', 'love song'],
  ['EPH', 5, 21, 6, 9, 'letter', 'household code'],
  ['COL', 3, 18, 4, 1, 'letter', 'household code'],
  ['1PE', 2, 18, 3, 7, 'letter', 'household code'],
  ['GAL', 5, 19, 5, 23, 'letter', 'vice or virtue list'],
  ['ROM', 1, 29, 1, 31, 'letter', 'vice or virtue list'],
  ['1CO', 6, 9, 6, 10, 'letter', 'vice or virtue list'],
  ['COL', 3, 5, 3, 14, 'letter', 'vice or virtue list'],
  ['2TI', 3, 2, 3, 5, 'letter', 'vice or virtue list'],
];

// Psalm types after Hermann Gunkel's form-critical classification (scholars differ on many psalms).
const PSALM_TYPES = {
  'royal psalm': [2, 18, 20, 21, 45, 72, 89, 101, 110, 132, 144],
  'lament': [3, 4, 5, 6, 7, 12, 13, 17, 22, 25, 26, 27, 28, 31, 35, 38, 39, 42, 43, 44, 51, 54, 55, 56, 57, 59, 60, 61, 64, 69, 70, 71, 74, 79, 80, 83, 86, 88, 90, 94, 102, 109, 120, 130, 137, 140, 141, 142, 143],
  'hymn of praise': [8, 19, 29, 33, 65, 67, 68, 96, 98, 100, 103, 104, 105, 111, 113, 114, 117, 135, 136, 145, 146, 147, 148, 149, 150],
  'thanksgiving': [30, 32, 34, 40, 41, 66, 92, 116, 118, 138],
  'wisdom psalm': [1, 37, 49, 73, 112, 119, 127, 128, 133],
};

const EPISTLES = new Set(['ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD']);
const PROPHETS = new Set(['ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL']);
const LAWBOOKS = new Set(['EXO', 'LEV', 'NUM', 'DEU']);
const GOSPELS = new Set(['MAT', 'MRK', 'LUK', 'JHN']);

const textOf = v => v.words.map(w => w.text).join(' ');
const tag = (family, form, start, end, extra) => ({ category: family, label: form, start, end, ...extra });
const table = { status: 'SETTLED', source: 'bz-forms', witnesses: 1 };
const rule = (name, detail) => ({ status: 'SINGLE_PROPOSAL', method: 'rule', rule: name, source: 'bz-forms', witnesses: 1, detail });

// Runs of verses matching a test (allowing `gap` non-matching verses inside a run), at least `min` matches.
function runs(verses, test, min, gap = 0) {
  const out = []; let cur = null;
  const close = () => { if (cur && cur.hits >= min) out.push({ start: cur.start, end: cur.end }); cur = null; };
  for (const v of verses) {
    if (!test(textOf(v))) continue;
    if (cur && v.number - cur.end <= gap + 1) { cur.end = v.number; cur.hits++; } else { close(); cur = { start: v.number, end: v.number, hits: 1 }; }
  }
  close();
  return out;
}

// unfoldingWord flags that name a form: parables and proverbs. Returns { [ch]: tags[] }.
export function formsFromNotes(tsv) {
  const out = {};
  const lines = tsv.split(/\r?\n/);
  const head = lines[0].split('\t');
  const [cRef, cSup] = [head.indexOf('Reference'), head.indexOf('SupportReference')];
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    const sup = f[cSup] || '';
    const kind = /figs-parables/.test(sup) ? ['narrative', 'parable'] : /writing-proverbs/.test(sup) ? ['wisdom', 'proverb'] : null;
    const ref = /^(\d+):(\d+)(?:-(\d+))?$/.exec(f[cRef] || '');
    if (!kind || !ref) continue;
    const list = (out[+ref[1]] ||= []);
    const start = +ref[2], end = +(ref[3] || ref[2]);
    if (!list.some(t => t.label === kind[1] && t.start === start)) list.push(tag(kind[0], kind[1], start, end, { status: 'SETTLED', source: 'uw-tn', witnesses: 1 }));
  }
  return out;
}

export function formsFor(book, ch, verses, noteForms = {}) {
  const last = verses.at(-1)?.number || 0;
  if (!last) return [];
  const out = [];
  for (const [b, c1, v1, c2, v2, family, form] of TABLE) {
    if (b !== book || ch < c1 || ch > c2) continue;
    const start = ch === c1 ? v1 : 1, end = ch === c2 && v2 ? Math.min(v2, last) : last;
    if (start <= end) out.push(tag(family, form, start, end, table));
  }
  if (book === 'PSA') for (const [form, list] of Object.entries(PSALM_TYPES)) if (list.includes(ch))
    out.push(tag('poetry', form, 1, last, { status: 'SINGLE_PROPOSAL', source: 'bz-forms', witnesses: 1, detail: `Classified as a ${form} following Hermann Gunkel's form-critical psalm types; scholars classify some psalms differently.` }));
  // Rules over the KJV text.
  for (const r of runs(verses, t => /\bbegat\b|\bbare unto\b|\bwere born\b/.test(t) || (t.match(/\bson of\b/g) || []).length >= 2 || /\bthe sons of \w+[;:,]/.test(t), 3, 1))
    if (!out.some(t => t.label === 'genealogy' && t.start <= r.start && t.end >= r.end)) out.push(tag('narrative', 'genealogy', r.start, r.end, rule('genealogy-pattern', 'Found by a rule: a run of verses listing descent ("begat", "the sons of", "son of … son of").')));
  if (PROPHETS.has(book)) {
    for (const v of verses) if (/^(?:\W*)Woe\b|\bWoe (?:unto|to)\b/.test(textOf(v))) out.push(tag('prophecy', 'woe oracle', v.number, v.number, rule('woe-formula', 'Found by a rule: the verse opens a "Woe…" saying.')));
    for (const v of verses) if (/\bI saw\b|\bI looked, and,? behold\b|\bin the visions? of\b|\bshewed me\b/.test(textOf(v))) out.push(tag('prophecy', 'vision report', v.number, v.number, rule('vision-formula', 'Found by a rule: the verse reports something the prophet saw ("I saw", "behold", "he shewed me").')));
  }
  if (book === 'DAN' || book === 'REV' || book === 'ZEC') for (const v of verses) if (/\bI (?:saw|beheld|looked)\b|\bshewed me\b/.test(textOf(v)) && !out.some(t => t.label === 'vision report' && t.start === v.number)) out.push(tag('prophecy', 'vision report', v.number, v.number, rule('vision-formula', 'Found by a rule: the verse reports a vision ("I saw", "I beheld").')));
  if (LAWBOOKS.has(book)) {
    for (const r of runs(verses, t => /^(?:\W*)(?:And )?(?:if|when) (?:a|any) (?:man|woman|soul|ox|person)\b/i.test(t), 1)) if (!out.some(t => t.label === 'casuistic law' && t.start <= r.start && t.end >= r.end)) out.push(tag('law', 'casuistic law', r.start, r.end, rule('if-a-man', 'Found by a rule: a case law ("If a man…", "When any soul…").')));
    for (const r of runs(verses, t => /\bThou shalt (?:not )?\w+/.test(t), 2)) if (!out.some(t => t.category === 'law' && t.start <= r.start && t.end >= r.end)) out.push(tag('law', 'apodictic law', r.start, r.end, rule('thou-shalt', 'Found by a rule: a run of direct commands ("Thou shalt…").')));
  }
  if (GOSPELS.has(book)) for (const v of verses) if (/\b(?:healed|made whole|was cleansed|cast out (?:the )?devils?|received (?:his )?sight|raised (?:him|her) up|walked on the sea)\b/i.test(textOf(v))) out.push(tag('narrative', 'miracle story', v.number, v.number, rule('miracle-vocabulary', 'Found by a rule: the verse reports a healing, exorcism or other miracle.')));
  if (EPISTLES.has(book)) {
    if (ch === 1) out.push(tag('letter', 'opening and greeting', 1, Math.min(last, ['HEB', '1JN', 'JAS'].includes(book) ? 1 : 3), rule('letter-opening', 'Found by a rule: the opening verses of a letter (sender, recipients, greeting).')));
    if (ch === 1) for (const v of verses.slice(0, 12)) if (/\bI thank (?:my )?God\b|\bWe give thanks\b|\bBlessed be the God\b/.test(textOf(v))) { out.push(tag('letter', 'thanksgiving', v.number, v.number, rule('letter-thanksgiving', 'Found by a rule: the letter\'s opening thanksgiving or blessing.'))); break; }
  }
  if (EPISTLES.has(book)) for (const v of verses) if (/\b[Gg]race (?:be )?with (?:you|thee)\b|\bThe grace of (?:our |the )?Lord\b/.test(textOf(v))) out.push(tag('letter', 'closing and benediction', v.number, v.number, rule('benediction', 'Found by a rule: a closing grace or blessing.')));
  for (const v of verses) if (/\b(?:unto|to) this day\b|\btherefore (?:the name (?:of (?:it|that place|the place|the city|the well))? ?(?:was|is) called|was (?:the name of )?(?:it|that place) called|(?:he|she|they) called the name)\b/i.test(textOf(v))) out.push(tag('narrative', 'etiological note', v.number, v.number, rule('etiology-formula', 'Found by a rule: "unto this day" or "therefore it was called…" explains a name, custom or landmark (cf. Brevard Childs on the "until this day" formula).')));
  for (const t of noteForms[ch] || []) if (!out.some(x => x.label === t.label && x.start === t.start)) out.push(t);
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

// Voice engine (spec v0.6 §5.10): unfoldingWord notes that mark direct speech (quote margins) and
// background asides by the narrator. Returns { [ch]: tags[] }.
export function voiceFromNotes(tsv) {
  const out = {};
  const lines = tsv.split(/\r?\n/);
  const head = lines[0].split('\t');
  const [cRef, cSup, cNote] = [head.indexOf('Reference'), head.indexOf('SupportReference'), head.indexOf('Note')];
  const clean = s => s.replace(/\\n/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/Alternate translation:.*$/i, '').replace(/\s+/g, ' ').trim();
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    const sup = f[cSup] || '';
    const ref = /^(\d+):(\d+)(?:-(\d+))?$/.exec(f[cRef] || '');
    if (!ref) continue;
    const ch = +ref[1], start = +ref[2], end = +(ref[3] || ref[2]);
    const list = (out[ch] ||= []);
    if (/writing-background/.test(sup)) {
      const note = clean(f[cNote] || '');
      const first = (/^(.+?[.!?])(\s|$)/.exec(note)?.[1] || note).slice(0, 110);
      if (!list.some(t => t.category === 'aside' && t.start === start)) list.push({ category: 'aside', label: 'Narrator’s aside (background)', summary: first, start, end, status: 'SETTLED', source: 'uw-tn', witnesses: 1, detail: note.slice(0, 400) });
    } else if (/writing-quotations/.test(sup)) {
      if (!list.some(t => t.category === 'quotation' && t.start === start)) list.push({ category: 'quotation', label: 'Direct speech begins', start, end: start, status: 'SETTLED', source: 'uw-tn', witnesses: 1, detail: 'unfoldingWord marks a quotation (speech introduced by a quote margin) here.' });
    }
  }
  return out;
}

// Speech formulas (spec v0.10 §5.11). Rule-found; the category explanations give the readings.
export function speechFormulas(verses) {
  const out = [];
  const R = [
    ['messenger', /\bThus saith the LORD\b|\bthus saith the Lord GOD\b|\bThus saith the LORD of hosts\b/i, 'Messenger formula: “Thus saith the LORD”'],
    ['speech-formula', /\b(?:the LORD|God) (?:spake|said|called) unto (?:Moses|Aaron|Joshua)\b/i, 'Narrative speech formula: “the LORD spake unto …, saying”'],
    ['word-event', /\bthe word of the LORD came\b|\bthe word of the LORD that came\b|\bThe word of the LORD which came\b/i, 'Word-event formula: “the word of the LORD came”'],
  ];
  for (const v of verses) {
    const t = textOf(v);
    for (const [cat, re, label] of R) if (re.test(t)) out.push({ category: cat, label, start: v.number, end: v.number, status: 'SINGLE_PROPOSAL', method: 'rule', rule: `${cat}-formula`, source: 'bz-forms', witnesses: 1, detail: 'Found by a rule. Open the layer card for what this formula is and how it is read.' });
  }
  return out;
}
