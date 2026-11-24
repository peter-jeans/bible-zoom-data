// "At a glance" overviews (spec v0.24 §5.13). Small summaries per chapter and per book, computed from
// the same layer tags the canvas uses. No AI. Contested readings are counted and listed, never ranked.
// Every item keeps the layer it came from and its verse span, so the app can link to it.
const short = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const sourced = t => t.method !== 'ai-suggested';
const head = label => String(label || '').split(/[:·]/)[0].trim();
function tally(items, key, limit) {
  const m = new Map();
  for (const it of items) { const k = key(it); if (!k) continue; const e = m.get(k) || { label: k, count: 0, start: it.start }; e.count++; e.start = Math.min(e.start, it.start); m.set(k, e); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.start - b.start).slice(0, limit);
}
export function contestedGroups(layers) {
  const groups = new Map();
  for (const [layer, tags] of Object.entries(layers)) for (const t of tags) {
    if (t.status !== 'CONTESTED' || !t.group) continue;
    const id = `${layer}|${t.group}`;
    const g = groups.get(id) || { layer, group: t.group, start: t.start, end: t.end, labels: [], ai: false };
    if (!g.labels.includes(t.label)) g.labels.push(t.label);
    g.start = Math.min(g.start, t.start); g.end = Math.max(g.end, t.end); g.ai ||= t.method === 'ai-suggested';
    groups.set(id, g);
  }
  return [...groups.values()].filter(g => g.labels.length > 1).map(g => ({ ...g, count: g.labels.length, labels: g.labels.slice(0, 8).map(l => short(l, 90)) }));
}
export function chapterOverview(book, ch, layers, last) {
  // Summary lists use sourced and rule-found tags only; AI-suggested readings appear only in the
  // contested list, flagged.
  const L = id => (layers[id] || []).filter(sourced);
  const settled = t => t.status !== 'CONTESTED';
  return {
    book, ch, verses: last,
    outline: L('structure').filter(t => t.category === 'section').slice(0, 14).map(t => ({ label: short(t.label, 80), start: t.start, end: t.end })),
    kinds: {
      form: tally(L('form'), t => short(head(t.label), 50), 4),
      reading: tally(L('genre').filter(settled), t => short(t.label, 60), 3),
    },
    contested: contestedGroups(layers),
    people: tally(L('names').filter(t => !/named in the passage/i.test(t.label)), t => t.label, 6),
    places: tally(L('places'), t => head(t.label), 6),
    themes: tally(L('themes'), t => t.topic || head(t.label), 5),
    links: [...L('intertext').flatMap(t => (t.links || []).map(x => ({ ref: x.ref, votes: x.votes || 0, start: t.start })))].sort((a, b) => b.votes - a.votes).slice(0, 5),
    setting: L('history').slice(0, 3).map(t => ({ label: short(t.label, 160), start: t.start, end: Math.min(t.end, last) })),
    pictures: [...new Set([...L('nature'), ...L('objects')].flatMap(t => t.words || []))].slice(0, 8),
    counts: Object.fromEntries(Object.entries(layers).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])),
  };
}
export function bookOverview(book, chapters, genreLabels) {
  const all = chapters.flatMap(c => Object.entries(c.layers).flatMap(([layer, tags]) => tags.map(t => ({ ...t, layer, ch: c.ch }))));
  const of = id => all.filter(t => t.layer === id && sourced(t));
  const perChapter = (id, key, limit) => {
    const m = new Map();
    for (const t of of(id)) { const k = key(t); if (!k) continue; const e = m.get(k) || { label: k, chapters: new Set(), count: 0, byCh: new Map() }; e.chapters.add(t.ch); e.count++; e.byCh.set(t.ch, (e.byCh.get(t.ch) || 0) + 1); m.set(k, e); }
    return [...m.values()].sort((a, b) => b.chapters.size - a.chapters.size || b.count - a.count).slice(0, limit)
      .map(e => ({ label: e.label, chapters: e.chapters.size, first: Math.min(...e.chapters), peak: [...e.byCh.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] }));
  };
  const kindMix = new Map();
  for (const c of chapters) { const cats = new Set((c.layers.form || []).filter(sourced).map(t => t.category)); for (const k of cats) kindMix.set(k, (kindMix.get(k) || 0) + 1); }
  const linkBooks = new Map();
  for (const t of of('intertext')) for (const x of t.links || []) { const b = String(x.ref || '').split('.')[0]; if (b && b !== book) linkBooks.set(b, (linkBooks.get(b) || 0) + 1); }
  const layerChapters = {};
  for (const c of chapters) for (const [k, v] of Object.entries(c.layers)) if (v.length) layerChapters[k] = (layerChapters[k] || 0) + 1;
  return {
    book, chapters: chapters.length,
    divisions: [...of('structure').filter(t => t.category === 'division').reduce((m, t) => { const label = short(t.label, 80), e = m.get(label); if (e) { e.to = Math.max(e.to, t.ch); } else m.set(label, { label, ch: t.ch, to: t.ch, start: t.start }); return m; }, new Map()).values()].sort((a, b) => a.ch - b.ch || a.start - b.start).slice(0, 24),
    kinds: [...kindMix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ category: k, label: genreLabels[k] || k, chapters: n })),
    contested: chapters.reduce((n, c) => n + contestedGroups(c.layers).length, 0),
    people: perChapter('names', t => (/named in the passage/i.test(t.label) ? '' : t.label), 10),
    places: perChapter('places', t => head(t.label), 10),
    themes: perChapter('themes', t => t.topic || head(t.label), 8),
    links: [...linkBooks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([b, n]) => ({ book: b, count: n })),
    setting: (chapters[0]?.layers.history || []).filter(t => t.category === 'context').slice(0, 3).map(t => ({ label: short(t.label, 160) })),
    layer_chapters: layerChapters,
  };
}
