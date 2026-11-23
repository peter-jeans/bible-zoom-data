// Bible Zoom genre table: book-level genre with chapter-level exceptions.
// Our own compiled data (CC BY-SA 4.0), following broad scholarly consensus.
const BOOK = {
  GEN: 'narrative', EXO: 'narrative', LEV: 'law', NUM: 'narrative', DEU: 'law', JOS: 'narrative', JDG: 'narrative', RUT: 'narrative',
  '1SA': 'narrative', '2SA': 'narrative', '1KI': 'narrative', '2KI': 'narrative', '1CH': 'narrative', '2CH': 'narrative', EZR: 'narrative',
  NEH: 'narrative', EST: 'narrative', JOB: 'wisdom', PSA: 'poetry', PRO: 'wisdom', ECC: 'wisdom', SNG: 'poetry', ISA: 'prophecy',
  JER: 'prophecy', LAM: 'poetry', EZK: 'prophecy', DAN: 'prophecy', HOS: 'prophecy', JOL: 'prophecy', AMO: 'prophecy', OBA: 'prophecy',
  JON: 'narrative', MIC: 'prophecy', NAM: 'prophecy', HAB: 'prophecy', ZEP: 'prophecy', HAG: 'prophecy', ZEC: 'prophecy', MAL: 'prophecy',
  MAT: 'gospel', MRK: 'gospel', LUK: 'gospel', JHN: 'gospel', ACT: 'narrative', ROM: 'epistle', '1CO': 'epistle', '2CO': 'epistle',
  GAL: 'epistle', EPH: 'epistle', PHP: 'epistle', COL: 'epistle', '1TH': 'epistle', '2TH': 'epistle', '1TI': 'epistle', '2TI': 'epistle',
  TIT: 'epistle', PHM: 'epistle', HEB: 'epistle', JAS: 'epistle', '1PE': 'epistle', '2PE': 'epistle', '1JN': 'epistle', '2JN': 'epistle',
  '3JN': 'epistle', JUD: 'epistle', REV: 'apocalyptic',
};
// [book, fromChapter, toChapter, genre]
const RANGES = [
  ['EXO', 20, 23, 'law'], ['EXO', 25, 31, 'law'], ['EXO', 15, 15, 'poetry'],
  ['DEU', 1, 4, 'narrative'], ['DEU', 32, 33, 'poetry'], ['DEU', 34, 34, 'narrative'],
  ['JOB', 1, 2, 'narrative'], ['JOB', 42, 42, 'narrative'],
  ['ISA', 36, 39, 'narrative'], ['JER', 37, 45, 'narrative'], ['JER', 52, 52, 'narrative'],
  ['DAN', 1, 6, 'narrative'], ['DAN', 7, 12, 'apocalyptic'],
  ['JDG', 5, 5, 'poetry'], ['1SA', 2, 2, 'poetry'], ['2SA', 22, 22, 'poetry'], ['JON', 2, 2, 'poetry'], ['HAB', 3, 3, 'poetry'],
  ['MRK', 13, 13, 'apocalyptic'], ['MAT', 24, 24, 'apocalyptic'],
];
const LABEL = {
  narrative: 'Narrative', law: 'Law', wisdom: 'Wisdom', poetry: 'Poetry', prophecy: 'Prophecy', gospel: 'Gospel',
  epistle: 'Letter (epistle)', apocalyptic: 'Apocalyptic',
};
export function genreFor(book, ch) {
  const r = RANGES.find(([b, a, z]) => b === book && ch >= a && ch <= z);
  const g = r ? r[3] : BOOK[book];
  if (!g) return null;
  const label = book === 'PSA' ? 'Psalm (poetry)' : LABEL[g];
  return [{ category: g, label, start: 1, end: 9999, status: 'SETTLED', source: 'bz-genre', witnesses: 1 }];
}
