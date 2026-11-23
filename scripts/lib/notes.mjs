// Turns unfoldingWord Translation Notes (TSV) into Bible Zoom tags for three layers:
// figures (rhetorical figures only), imagery (metaphor/simile notes) and poetry (parallelism).
// Translation-technique notes (abstract nouns, active/passive, etc.) are not figures and are skipped.
import { imageFamily } from './imagery.mjs';
export const FIGURE_FAMILY = {
  metaphor: 'comparison', simile: 'comparison', exmetaphor: 'comparison',
  metonymy: 'substitution', synecdoche: 'substitution', euphemism: 'substitution',
  personification: 'personification', apostrophe: 'personification',
  hyperbole: 'emphasis', litotes: 'emphasis', doublet: 'emphasis', hendiadys: 'emphasis', merism: 'emphasis',
  reduplication: 'emphasis', doublenegatives: 'emphasis', exclamations: 'emphasis',
  ellipsis: 'omission',
  rquestion: 'question', irony: 'question', hypo: 'question',
  idiom: 'idiom',
};
const NAMES = {
  metaphor: 'Metaphor', simile: 'Simile', exmetaphor: 'Extended metaphor', metonymy: 'Metonymy', synecdoche: 'Synecdoche',
  euphemism: 'Euphemism', personification: 'Personification', apostrophe: 'Apostrophe', hyperbole: 'Hyperbole', litotes: 'Litotes',
  doublet: 'Doublet', hendiadys: 'Hendiadys', merism: 'Merism', reduplication: 'Repetition', doublenegatives: 'Double negative',
  exclamations: 'Exclamation', ellipsis: 'Ellipsis', rquestion: 'Rhetorical question', irony: 'Irony', hypo: 'Hypothetical',
  idiom: 'Idiom', parallelism: 'Parallelism',
};

function clean(note) {
  return note
    .replace(/\\n/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|\*|`/g, '')
    .replace(/Alternate translation:.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstSentence(text, max) {
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  let s = (m ? m[1] : text).trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return s;
}

// Returns { figures: {ch: tags[]}, imagery: {...}, poetry: {...} }
export function notesToTags(tsv) {
  const out = { figures: {}, imagery: {}, poetry: {} };
  const seen = new Set();
  const lines = tsv.split(/\r?\n/);
  const head = lines[0].split('\t');
  const col = n => head.indexOf(n);
  const [cRef, cId, cSup, cNote] = [col('Reference'), col('ID'), col('SupportReference'), col('Note')];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    const sup = /figs-([a-z]+)/.exec(f[cSup] || '')?.[1];
    if (!sup) continue;
    const ref = /^(\d+):(\d+)(?:-(\d+))?$/.exec(f[cRef] || '');
    if (!ref) continue;
    const ch = +ref[1], start = +ref[2], end = +(ref[3] || ref[2]);
    const text = clean(f[cNote] || '');
    const summary = firstSentence(text, 110);
    const detail = text.length > 400 ? text.slice(0, 399).replace(/\s+\S*$/, '') + '…' : text;
    const base = { start, end, status: 'SETTLED', source: 'uw-tn', witnesses: 1, ref: f[cId] };
    const push = (layer, tag) => {
      const key = `${layer}|${ch}|${start}|${end}|${tag.category}|${tag.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      (out[layer][ch] ||= []).push(tag);
    };
    if (sup === 'parallelism') push('poetry', { ...base, category: 'parallelism', label: `Parallelism: ${summary}`, detail });
    const family = FIGURE_FAMILY[sup];
    if (family) push('figures', { ...base, category: family, label: `${NAMES[sup]}: ${summary}`, figure: NAMES[sup], detail });
    if (sup === 'metaphor' || sup === 'simile' || sup === 'exmetaphor') {
      const fam = imageFamily(text);
      push('imagery', { ...base, category: fam.id, label: `${fam.label}: ${summary}`, figure: NAMES[sup], family: fam.label, detail });
    }
  }
  for (const layer of Object.values(out)) for (const tags of Object.values(layer)) tags.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}
