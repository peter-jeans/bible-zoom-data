// World › Nature and World › Objects & daily life (spec v0.9 §8.8): words for animals, plants,
// weather, landforms and the sky; and for food, clothing, buildings, tools and weapons, money and
// measures, and vessels, found in the KJV text by a fixed word list. One tag per verse per category,
// listing the words found. Found by a rule (mentions include figurative uses).

const L = s => s.split(/\s*,\s*/);
export const NATURE = {
  animal: ['Animals', L('lion, lions, lamb, lambs, sheep, ram, rams, ewe, goat, goats, kid, kids, ox, oxen, bullock, bullocks, bull, bulls, heifer, calf, calves, cattle, cow, kine, ass, asses, colt, mule, mules, camel, camels, horse, horses, dog, dogs, swine, bear, bears, wolf, wolves, fox, foxes, leopard, deer, hart, hind, roe, roebuck, unicorn, behemoth, leviathan, dove, doves, turtledove, raven, ravens, eagle, eagles, sparrow, sparrows, owl, owls, ostrich, stork, quail, cock, hen, serpent, serpents, viper, vipers, adder, asp, scorpion, scorpions, locust, locusts, grasshopper, grasshoppers, ant, bee, bees, hornet, hornets, moth, worm, worms, frog, frogs, lice, flies, fly, fish, fishes, whale, whales, dragon, dragons, beast, beasts, fowl, fowls, flock, flocks, herd, herds, birds')],
  plant: ['Plants', L('vine, vines, vineyard, vineyards, grape, grapes, fig, figs, olive, olives, cedar, cedars, oak, oaks, palm, palms, willow, willows, sycamore, myrtle, almond, almonds, pomegranate, pomegranates, wheat, barley, corn, tares, chaff, straw, stubble, grass, herb, herbs, flower, flowers, lily, lilies, rose, thorn, thorns, thistle, thistles, briers, reed, reeds, hyssop, mustard, seed, seeds, tree, trees, branch, branches, root, roots, leaf, leaves, fruit, fruits, forest, garden, gardens')],
  weather: ['Weather', L('rain, rains, snow, hail, frost, dew, cloud, clouds, wind, winds, whirlwind, storm, tempest, thunder, thunderings, lightning, lightnings, drought, flood, floods')],
  landform: ['Land and water', L('mountain, mountains, hill, hills, valley, valleys, river, rivers, brook, brooks, stream, streams, sea, seas, lake, spring, springs, fountain, fountains, well, wells, wilderness, desert, plain, plains, rock, rocks, cave, caves, dust, sand, island, isles')],
  sky: ['Sky', L('sun, moon, star, stars, heaven, heavens, firmament')],
};
export const OBJECTS = {
  food: ['Food and drink', L('bread, loaf, loaves, wine, oil, honey, milk, butter, cheese, meat, flesh, salt, leaven, unleavened, cake, cakes, manna, pottage, vinegar, water, feast, supper')],
  clothing: ['Clothing', L('garment, garments, robe, robes, coat, coats, cloak, mantle, sackcloth, linen, girdle, sandals, shoes, shoe, raiment, apparel, veil, turban, mitre, ephod, crown, crowns, ring, rings, bracelet, bracelets')],
  building: ['Buildings', L('house, houses, tent, tents, tabernacle, temple, altar, altars, tower, towers, wall, walls, gate, gates, door, doors, city, cities, palace, palaces, barn, barns, sepulchre, tomb, prison, synagogue, roof, pillar, pillars')],
  tool: ['Tools and weapons', L('sword, swords, spear, spears, bow, bows, arrow, arrows, shield, shields, sling, axe, axes, plough, ploughshares, sickle, hammer, nail, nails, net, nets, hook, rod, staff, staves, yoke, chariot, chariots, ship, ships, ark, cart, harp, harps, trumpet, trumpets, lamp, lamps, candlestick')],
  money: ['Money and measures', L('shekel, shekels, talent, talents, penny, pence, mite, mites, silver, gold, cubit, cubits, ephah, homer, hin, omer, bath, measure, measures, span, furlong, furlongs')],
  vessel: ['Vessels', L('cup, cups, bowl, bowls, basin, pot, pots, pitcher, pitchers, jar, bottle, bottles, cruse, vessel, vessels, basket, baskets, laver, censer')],
};

// v0.33: words that are usually something else in the KJV are kept only where the underlying Hebrew or
// Greek word (its Strong's number) is the real thing: "rose of Sharon" but not "rose up".
const ONLY = Object.fromEntries(Object.entries({
  rose: 'H2261', bear: 'H1677 H1678 G715', bears: 'H1677', fly: 'H2070', flies: 'H2070 H6157',
  well: 'H875 H953 H4599 H4726 H5869 G4077 G5421', wells: 'H875 H953 H4599 H5869 G4077',
  bow: 'H7198 G5115', bows: 'H7198', spring: 'H4161 H4726 H5869 H1530',
}).map(([w, s]) => [w, new Set(s.split(' '))]));
// Words dropped where the underlying word is plainly another thing (month, palm of the hand, greeting…).
const NOT = Object.fromEntries(Object.entries({
  plain: 'H8535', moon: 'H2320', palm: 'H3709', palms: 'H3709 G4475', hail: 'G5463 G5464', fish: 'H1770', nails: 'H2953 H6856', leaves: 'H1817',
}).map(([w, s]) => [w, new Set(s.split(' '))]));
// "ayin" (H5869) is both "eye" and "spring": "pleased Absalom well" carries it too, so a well needs an article.
const ARTICLE = new Set(['a', 'the', 'this', 'that', 'dragon']);
function keep(word, token, before) {
  if (word === 'flies' && before === 'of') return true; // "swarms of flies": the number sits on "swarms"
  if (/^bows?$/.test(word) && !token.strong && ['his', 'their'].includes(before)) return true; // "bendeth his bow"
  if (ONLY[word]) return ONLY[word].has(token.strong) && (token.strong !== 'H5869' || word === 'wells' || ARTICLE.has(before));
  return !NOT[word]?.has(token.strong);
}
const bare = t => String(t || '').toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '').replace(/[’']s$/, '');

function scan(verses, table, layerSource) {
  const sets = Object.fromEntries(Object.entries(table).map(([cat, [, words]]) => [cat, new Set(words)]));
  const out = [];
  for (const v of verses) {
    const tokens = v.words.flatMap((w, i) => w.text.split(/[-\s—–]+/).map(t => ({ w, t: bare(t), before: bare(v.words[i - 1]?.text) }))).filter(x => x.t);
    for (const [cat, set] of Object.entries(sets)) {
      const found = [...new Set(tokens.filter(x => set.has(x.t) && keep(x.t, x.w, x.before)).map(x => x.t))];
      if (!found.length) continue;
      out.push({
        category: cat, label: `${table[cat][0]}: ${found.slice(0, 5).join(', ')}${found.length > 5 ? '…' : ''}`, start: v.number, end: v.number,
        status: 'SINGLE_PROPOSAL', method: 'rule', rule: 'word-list', source: layerSource, witnesses: 1, words: found,
        detail: `Found by a rule: the KJV text of this verse mentions ${found.join(', ')}. Mentions include figurative uses.`,
      });
    }
  }
  return out;
}

export const natureTags = verses => scan(verses, NATURE, 'bz-world');
export const objectTags = verses => scan(verses, OBJECTS, 'bz-world');
