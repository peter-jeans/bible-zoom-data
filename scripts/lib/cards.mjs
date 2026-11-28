// Study cards in the open data (spec v0.41). The app exports approved cards (scripts/fetch-cards-export.mjs
// writes cards/export.json); the build checks each one again and publishes it:
//   cards/index.json            → every card (id, kind, title, topic, passages) and passage → card ids
//   cards/<kind>/<id>.json      → one card
// A card is left out, with a warning, if its content no longer matches the fingerprint it was approved
// with, a reference is wrong, or it names someone who is not on the scholar list.
// The fingerprint, references and index follow the app's src/lib/studyCards.js; change both together.
import { webcrypto } from 'node:crypto';

const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Same rule as the app's citation guard (src/lib/citationGuard.js).
export function verifiedProponent(text, scholars = []) {
  const t = plain(text);
  if (!t.trim()) return null;
  for (const s of scholars) {
    if (!s?.surname || s.surname.length < 3) continue;
    const m = new RegExp(`(^|[^A-Za-z])${esc(s.surname)}(?![A-Za-z])`).exec(t);
    if (!m) continue;
    if (!s.given) return s;
    const after = /^,?\s*((?:[A-Z][a-z]*\.?\s*){1,3})/.exec(t.slice(m.index + m[0].length))?.[1] || '';
    const before = /((?:[A-Z][a-z]*\.?\s+){1,3})$/.exec(t.slice(0, m.index + m[1].length))?.[1] || '';
    const near = `${before} ${after}`.match(/[A-Z]/g) || [];
    if (!near.length || near.includes(s.given[0].toUpperCase())) return s;
  }
  return null;
}

export function parseRef(ref) {
  const m = /^([1-3A-Z][A-Z]{2}) (\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(String(ref || '').trim());
  if (!m) return null;
  const ch = +m[2], v = m[3] ? +m[3] : null;
  if (m[5]) return { book: m[1], ch, v, endCh: +m[4], endV: +m[5] };
  if (m[4]) return v ? { book: m[1], ch, v, endCh: ch, endV: +m[4] } : { book: m[1], ch, v: null, endCh: +m[4], endV: null };
  return { book: m[1], ch, v, endCh: ch, endV: v };
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const publicFields = c => ({ card_id: c.card_id, kind: c.kind, title: c.title, passages: c.passages || [], traditions: c.traditions || [], content: c.content || {} });
export async function cardHash(card) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(publicFields(card))));
  return Buffer.from(digest).toString('hex');
}

const proponents = c => [...(c.content?.proponents || []), ...(c.content?.readings || []).flatMap(r => r.proponents || []), ...(c.content?.answers || []).flatMap(a => a.proponents || [])].filter(p => p?.name);

// Returns the problems that keep a card out of the open data.
export async function recheck(card, books, scholars) {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(card.card_id || '')) problems.push('bad id');
  if (!['question', 'approach', 'scenario', 'fit', 'tour'].includes(card.kind)) problems.push(`unknown kind ${card.kind}`);
  if (await cardHash(card) !== card.hash) problems.push('content differs from what was approved');
  const byId = new Map(books.map(b => [b.id, b]));
  for (const ref of [...(card.passages || []), ...(card.content?.readings || []).flatMap(r => r.key_texts || [])]) {
    const r = parseRef(ref), b = r && byId.get(r.book);
    if (!b || r.ch < 1 || r.endCh > b.chapters || r.endCh < r.ch) problems.push(`bad reference ${ref}`);
  }
  for (const p of proponents(card)) if (!verifiedProponent(p.name, scholars)) problems.push(`${p.name} not on the scholar list`);
  if (card.kind === 'question' && (card.content?.readings || []).length < 2) problems.push('fewer than two readings');
  return problems;
}

export function cardIndex(cards) {
  const passages = {};
  for (const c of cards) for (const ref of c.passages || []) {
    const r = parseRef(ref); if (!r) continue;
    (passages[`${r.book} ${r.ch}`] ||= []).push({ id: c.card_id, kind: c.kind, v: r.v || 1 });
  }
  return { schema: 'bible-zoom-cards-index/1', cards: cards.map(c => ({ id: c.card_id, kind: c.kind, title: c.title, topic: c.content?.topic || null, passages: c.passages || [] })), passages };
}
