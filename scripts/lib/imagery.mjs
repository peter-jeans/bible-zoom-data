// Mechanistic image-family classifier: assigns each metaphor/simile note to an image family by
// keyword rules (first matching family in this order wins). No AI. Unmatched notes fall back to
// the general "image" category. Rules are data, so they can be tuned without code changes.
export const FAMILIES = [
  ['pastoral', 'Shepherd and flock', ['shepherd', 'sheep', 'flock', 'lamb', 'lambs', 'pasture', 'pastures', 'sheepfold', 'fold', 'ewe', 'ram', 'rams', 'herd', 'goats?']],
  ['light', 'Light and darkness', ['light', 'lights', 'darkness', 'dark', 'lamp', 'lamps', 'sun', 'moon', 'stars?', 'shine', 'shines', 'shining', 'night', 'dawn', 'morning', 'glory', 'bright', 'blind', 'blindness']],
  ['water', 'Water', ['water', 'waters', 'river', 'rivers', 'rain', 'sea', 'seas', 'flood', 'floods', 'fountain', 'spring', 'springs', 'well', 'stream', 'streams', 'thirst', 'thirsty', 'drink', 'wash', 'washed', 'dew', 'waves?', 'deep']],
  ['plants', 'Plants and harvest', ['vine', 'vines', 'vineyard', 'tree', 'trees', 'fruit', 'fruits', 'seed', 'seeds', 'harvest', 'grain', 'branch', 'branches', 'root', 'roots', 'flower', 'flowers', 'grass', 'plant', 'planted', 'olive', 'fig', 'thorns?', 'wheat', 'chaff', 'reap', 'sow', 'sows', 'sown', 'cedar', 'leaf', 'leaves', 'weeds?']],
  ['refuge', 'Rock and refuge', ['rock', 'fortress', 'shield', 'stronghold', 'refuge', 'tower', 'shelter', 'hiding', 'wings?', 'shadow', 'cliff', 'horn']],
  ['warfare', 'War and weapons', ['sword', 'swords', 'arrow', 'arrows', 'bow', 'battle', 'war', 'army', 'armies', 'weapon', 'weapons', 'spear', 'fight', 'conquer', 'armor', 'armour', 'enemy', 'enemies', 'attack', 'trap', 'snare', 'net', 'pit']],
  ['kingship', 'King and kingdom', ['king', 'kings', 'kingdom', 'throne', 'crown', 'reign', 'reigns', 'scepter', 'sceptre', 'rule', 'rules', 'ruler', 'master', 'servant', 'servants', 'slave', 'slaves']],
  ['family', 'Family and marriage', ['father', 'son', 'sons', 'children', 'child', 'bride', 'bridegroom', 'husband', 'wife', 'mother', 'brother', 'brothers', 'sister', 'marriage', 'married', 'birth', 'womb', 'adultery', 'prostitute', 'harlot', 'daughter', 'daughters', 'offspring', 'labor', 'pains']],
  ['building', 'House and building', ['house', 'houses', 'building', 'build', 'built', 'temple', 'foundation', 'foundations', 'stone', 'stones', 'door', 'doors', 'gate', 'gates', 'cornerstone', 'tent', 'tents', 'dwelling', 'wall', 'walls', 'pillar', 'pillars', 'city']],
  ['fire', 'Fire', ['fire', 'burn', 'burns', 'burning', 'burned', 'flame', 'flames', 'smoke', 'furnace', 'ashes', 'consume', 'consumes', 'refine', 'refined', 'smelt']],
  ['food', 'Food and drink', ['bread', 'food', 'cup', 'feast', 'eat', 'eats', 'eaten', 'meat', 'milk', 'honey', 'wine', 'salt', 'hunger', 'hungry', 'table', 'meal', 'taste', 'swallow', 'devour', 'devours', 'leaven', 'yeast']],
  ['animals', 'Animals', ['lion', 'lions', 'eagle', 'eagles', 'dog', 'dogs', 'wolf', 'wolves', 'serpent', 'snake', 'snakes', 'bird', 'birds', 'ox', 'oxen', 'horse', 'horses', 'bear', 'locust', 'locusts', 'beast', 'beasts', 'dove', 'doves', 'fox', 'foxes', 'calf', 'bull', 'bulls', 'deer', 'viper', 'vipers', 'worm', 'moth']],
  ['clothing', 'Clothing', ['garment', 'garments', 'clothe', 'clothed', 'clothes', 'clothing', 'robe', 'robes', 'dress', 'dressed', 'wear', 'naked', 'sackcloth', 'belt', 'girdle', 'cloak']],
  ['journey', 'Path and journey', ['path', 'paths', 'way', 'ways', 'walk', 'walks', 'walked', 'road', 'journey', 'stumble', 'stumbles', 'run', 'runs', 'race', 'steps?', 'wander', 'wanders', 'lead', 'leads', 'led', 'feet', 'foot']],
  ['body', 'Body', ['hand', 'hands', 'arm', 'arms', 'eye', 'eyes', 'face', 'heart', 'hearts', 'mouth', 'tongue', 'tongues', 'head', 'ear', 'ears', 'lips', 'bones', 'bowels', 'blood', 'flesh', 'neck', 'stiff-necked', 'breath', 'nose', 'nostrils', 'belly']],
  ['death', 'Sleep and death', ['sleep', 'sleeps', 'asleep', 'death', 'die', 'dies', 'died', 'grave', 'dead', 'sheol', 'dust', 'perish']],
];
const RULES = FAMILIES.map(([id, label, words]) => [id, label, new RegExp(`\\b(${words.join('|')})\\b`, 'i')]);

export function imageFamily(text) {
  for (const [id, label, re] of RULES) if (re.test(text)) return { id, label };
  return { id: 'image', label: 'Other images' };
}
