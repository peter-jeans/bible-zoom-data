// One-off: clips Natural Earth (public domain, naturalearthdata.com) to the lands the Bible names and
// rounds it, giving seed/bible/geo/basemap.json. Run by hand; the result is checked in.
import { readFile, writeFile } from 'node:fs/promises';
const [W, S, E, N] = [-10, 8, 66, 50], read = async n => JSON.parse(await readFile(`.cache/naturalearth/${n}.json`, 'utf8')).features;
const inside = ([x, y]) => x >= W && x <= E && y >= S && y <= N;
function lines(g) { return g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []; }
function clip(list, eps) {
  const out = [];
  for (const l of list) {
    let run = [];
    for (const p of l) {
      if (!inside(p)) { if (run.length > 1) out.push(run); run = []; continue; }
      const q = p.slice(0, 2).map(v => Math.round(v * 100) / 100), last = run.at(-1);
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= eps) run.push(q);
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}
const near = g => lines(g).some(l => l.some(inside));
const rivers = (await read('ne_10m_rivers_lake_centerlines')).filter(f => f.geometry && near(f.geometry) && f.properties.scalerank <= 6);
const lakes = (await read('ne_10m_lakes')).filter(f => f.geometry && near(f.geometry) && f.properties.scalerank <= 5);
const data = { source: 'natural-earth', bounds: [W, S, E, N], coast: clip((await read('ne_50m_coastline')).flatMap(f => lines(f.geometry)), 0.06), rivers: clip(rivers.flatMap(f => lines(f.geometry)), 0.05), lakes: clip(lakes.flatMap(f => lines(f.geometry)), 0.02) };
await writeFile('seed/bible/geo/basemap.json', JSON.stringify(data));
console.log(Object.fromEntries(['coast', 'rivers', 'lakes'].map(k => [k, data[k].length])));
