// Image engine (spec v0.21): openly licensed thumbnails for Places, Nature and Objects & daily life.
// No images are stored. The index records, for each place or word, a Wikimedia Commons thumbnail URL
// plus the credit the licence requires (author, licence, link to the file page). Readers' browsers
// load the thumbnail straight from upload.wikimedia.org.
//
//  - Places: OpenBible's own photo for the place (a Commons file), else the Wikidata item's image (P18).
//  - Words:  the Wikipedia article chosen for each word below, then that article's free lead image.
// Every file is checked on Commons; anything without a free licence (CC0, public domain, CC BY,
// CC BY-SA, GFDL) is left out.
import { readFile } from 'node:fs/promises';
import { NATURE, OBJECTS } from './world.mjs';

const UA = 'BibleZoomDataBuild/1.0 (https://github.com/peter-jeans/bible-zoom-data; open-data build)';
const THUMB = 320;
const FREE = /^(cc0|public domain|pd\b|pd-|cc[ -]by(-sa)?\b|cc[ -]by(-sa)?[ -]\d|gfdl|attribution|no restrictions)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function api(host, params, tries = 4) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })}`;
  let last = '';
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (res?.ok) { const j = await res.json(); if (!j.error) return j; last = j.error.code || 'api error'; } else last = res ? `HTTP ${res.status}` : 'network error';
    await sleep(1500 * (i + 1));
  }
  throw new Error(`Wikimedia API failed: ${host} (${last})`);
}
const strip = html => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

// Word → Wikipedia article. Plurals fold to their singular automatically. null = too ambiguous to
// illustrate (e.g. "ark" is Noah's or the covenant's; "flesh" is rarely meat).
const ARTICLE = {
  kine: 'Cattle', cow: 'Cattle', cattle: 'Cattle', herd: 'Cattle', bullock: 'Ox', ox: 'Ox', oxen: 'Ox', bull: 'Bull', heifer: 'Heifer', calf: 'Calf',
  ass: 'Donkey', colt: 'Foal', kid: 'Goat', ewe: 'Sheep', ram: 'Sheep', lamb: 'Sheep', flock: 'Sheep', camel: 'Dromedary', swine: 'Pig',
  hart: 'Deer', hind: 'Deer', roe: 'Roe deer', roebuck: 'Roe deer', unicorn: 'Aurochs', bear: 'Syrian brown bear', fox: 'Red fox',
  dove: 'Columbidae', turtledove: 'European turtle dove', raven: 'Common raven', sparrow: 'House sparrow', ostrich: 'Common ostrich', stork: 'White stork',
  quail: 'Common quail', cock: 'Chicken', hen: 'Chicken', fowl: 'Bird', bird: 'Bird', serpent: 'Snake', viper: 'Viperidae', adder: 'Viperidae', asp: 'Egyptian cobra',
  lice: 'Louse', fly: 'Housefly', flies: 'Housefly', bee: 'Western honey bee', beast: 'Animal', dragon: 'Dragon',
  vine: 'Vitis vinifera', fig: 'Common fig', cedar: 'Cedrus libani', palm: 'Date palm', sycamore: 'Ficus sycomorus', myrtle: 'Myrtus communis',
  corn: 'Cereal', tares: 'Lolium temulentum', stubble: 'Crop residue', grass: 'Poaceae', lily: 'Lilium', thorn: 'Thorns, spines, and prickles',
  briers: 'Bramble', reed: 'Phragmites', hyssop: 'Origanum syriacum', mustard: 'Brassica nigra',
  tempest: 'Storm', thunderings: 'Thunder', lightnings: 'Lightning', brook: 'Stream', spring: 'Spring (hydrology)', fountain: 'Spring (hydrology)',
  well: 'Water well', wilderness: 'Judaean Desert', rock: 'Rock (geology)', isles: 'Island', heaven: 'Sky', heavens: 'Sky',
  loaf: 'Bread', loaves: 'Bread', oil: 'Olive oil', flesh: null, leaven: 'Leavening agent', unleavened: 'Unleavened bread', cake: 'Flatbread',
  feast: 'Banquet', supper: 'Meal', garment: 'Clothing', raiment: 'Clothing', apparel: 'Clothing', coat: 'Tunic', mantle: 'Cloak',
  girdle: 'Belt (clothing)', sandals: 'Sandal', shoe: 'Sandal', shoes: 'Sandal', mitre: 'Mitznefet', ring: 'Ring (jewellery)',
  temple: 'Temple', wall: 'Defensive wall', gate: 'City gate', barn: 'Granary', sepulchre: 'Tomb', pillar: 'Column',
  bow: 'Bow and arrow', sling: 'Sling (weapon)', nail: 'Nail (fastener)', net: 'Fishing net', hook: 'Fish hook', rod: 'Walking stick', staff: 'Walking stick', staves: 'Walking stick',
  ark: null, harp: 'Kinnor', lamp: 'Oil lamp', candlestick: 'Menorah (Temple)',
  talent: 'Talent (measurement)', penny: 'Denarius', pence: 'Denarius', mite: "Widow's mite", homer: 'Homer (unit)', omer: 'Omer (unit)',
  hin: null, bath: null, measure: null, measures: null, span: null, furlong: null, furlongs: null,
  pot: 'Pottery', vessel: 'Pottery', pitcher: 'Jug', cruse: 'Jug', bottle: 'Wineskin', basin: 'Bowl', laver: 'Brazen laver',
};

function singular(word, all) {
  for (const cut of [word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')]) if (cut !== word && all.has(cut)) return cut;
  return word;
}
export function wordArticles() {
  const out = {};
  for (const table of [NATURE, OBJECTS]) for (const [, [, words]] of Object.entries(table)) {
    const all = new Set(words);
    for (const w of words) {
      const one = singular(w, all);
      const title = w in ARTICLE ? ARTICLE[w] : one in ARTICLE ? ARTICLE[one] : one[0].toUpperCase() + one.slice(1);
      if (title) out[w] = title;
    }
  }
  return out;
}

// Commons file info (thumbnail + licence) for many files at once.
async function fileInfo(files) {
  const info = {};
  for (const batch of chunks([...new Set(files)], 50)) {
    const j = await api('commons.wikimedia.org', { action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(THUMB), titles: batch.map(f => `File:${f}`).join('|') });
    const norm = Object.fromEntries((j.query?.normalized || []).map(n => [n.to, n.from]));
    for (const p of j.query?.pages || []) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const m = ii.extmetadata || {};
      const licence = strip(m.LicenseShortName?.value);
      if (!FREE.test(licence)) continue;
      const name = (norm[p.title] || p.title).replace(/^File:/, '');
      info[name] = { t: ii.thumburl, u: ii.descriptionurl, a: strip(m.Artist?.value) || 'Unknown author', l: licence, lu: m.LicenseUrl?.value || '' };
    }
    await sleep(300);
  }
  return info;
}
const fileFromUrl = url => { const m = /commons\.wikimedia\.org\/wiki\/File:(.+)$/.exec(url || ''); return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null; };

export async function buildImageIndex(ancientFile) {
  // Places
  const placeFile = {}, placeQ = {};
  for (const line of (await readFile(ancientFile, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    const f = fileFromUrl(p.media?.thumbnail?.credit_url);
    if (f) { placeFile[p.id] = f; continue; }
    const q = Object.values(p.linked_data || {}).map(x => x?.id).find(id => /^Q\d+$/.test(id || ''));
    if (q) placeQ[p.id] = q;
  }
  // Each source is optional: if one service refuses (e.g. rate limits on shared CI addresses), the
  // others still contribute and the build carries on.
  const qFile = {}, problems = [];
  for (const batch of chunks([...new Set(Object.values(placeQ))], 50)) {
    try {
      const j = await api('www.wikidata.org', { action: 'wbgetentities', ids: batch.join('|'), props: 'claims' });
      for (const [id, e] of Object.entries(j.entities || {})) { const f = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value; if (f) qFile[id] = f; }
    } catch (e) { problems.push(e.message); break; }
    await sleep(300);
  }
  for (const [pid, q] of Object.entries(placeQ)) if (qFile[q]) placeFile[pid] = qFile[q];

  // Words
  const articles = wordArticles(), titleFile = {};
  for (const batch of chunks([...new Set(Object.values(articles))], 50)) {
    let j;
    try { j = await api('en.wikipedia.org', { action: 'query', prop: 'pageimages', piprop: 'name', pilicense: 'free', redirects: '1', titles: batch.join('|') }); } catch (e) { problems.push(e.message); break; }
    const back = {};
    for (const n of [...(j.query?.normalized || []), ...(j.query?.redirects || [])]) back[n.to] = [...(back[n.to] || []), n.from];
    for (const p of j.query?.pages || []) {
      if (!p.pageimage) continue;
      const names = [p.title, ...(back[p.title] || [])];
      for (const n of names) { titleFile[n] = p.pageimage; for (const m of back[n] || []) titleFile[m] = p.pageimage; }
    }
    await sleep(300);
  }
  const wordFile = {};
  for (const [w, title] of Object.entries(articles)) if (titleFile[title]) wordFile[w] = { f: titleFile[title].replace(/_/g, ' '), article: title };

  const info = await fileInfo([...Object.values(placeFile), ...Object.values(wordFile).map(x => x.f)]);
  const places = {}, words = {};
  for (const [pid, f] of Object.entries(placeFile)) if (info[f]) places[pid] = info[f];
  for (const [w, { f, article }] of Object.entries(wordFile)) if (info[f]) words[w] = { ...info[f], s: article };
  if (!Object.keys(places).length && !Object.keys(words).length) throw new Error(`No images found (${problems.join('; ')})`);
  return { generated: new Date().toISOString(), problems, source: 'Wikimedia Commons (via OpenBible.info, Wikidata and Wikipedia)', places, words };
}
