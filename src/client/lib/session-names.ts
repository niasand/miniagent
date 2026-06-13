/**
 * Random display-name generator for new sessions.
 *
 * A new session gets "<Prefix> <Animal>" (e.g. "Lavender Otter"), picked
 * uniformly at random from the two pools below. This replaces the old
 * generic "${Agent} session" default so sessions are distinguishable in the
 * list at a glance.
 */

const NAME_PREFIXES = [
  "Rose", "Lily", "Tulip", "Iris", "Daisy", "Lavender", "Jasmine", "Peony",
  "Sunflower", "Violet", "Poppy", "Camellia", "Begonia", "Dahlia", "Azalea", "Magnolia",
  "Hyacinth", "Gardenia", "Primrose", "Marigold", "Bluebell", "Snowdrop", "Aster", "Petunia",
  "Heather", "Chamomile", "Lotus", "Orchid", "Wisteria", "Hibiscus", "Lilac", "Zinnia",
  "Cosmos", "Buttercup", "Carnation", "Ranunculus", "Anemone", "Geranium", "Narcissus", "Crocus",
  "Delphinium", "Edelweiss", "Mallow", "Verbena", "Phlox", "Salvia", "Yarrow", "Celandine",
  "Cherryblossom", "Plumeria", "Freesia", "Sweetpea", "Pansy", "Calendula", "Snapdragon", "Alyssum",
  "Heliotrope", "Lantana", "Coreopsis", "Gazania", "Campanula", "Clematis", "Periwinkle", "Tuberose",
  "Moonflower", "Forgetmenot", "Daffodil", "Briar", "Clover", "Fern", "Willow", "Maple",
  "Olive", "Ivy", "Laurel", "Myrtle", "Juniper", "Hazel", "Rowan", "Linden",
  "Bamboo", "Cedar", "Aspen", "Birch", "Rosemary", "Mint", "Sage", "Thyme",
  "Basil", "Aloe", "Sorrel", "Meadow", "Bloom", "Petal", "Blossom", "Flora",
  "Blooming", "Dewflower", "Glowpetal", "Mistbloom",
  "Protea", "Banksia", "Grevillea", "Leucospermum", "Hellebore", "Echinacea", "Nigella", "Scabiosa",
  "Monarda", "Gaillardia", "Kniphofia", "Pieris", "Kalmia", "Skimmia", "Actaea", "Saponaria",
  "Diascia", "Nemesia", "Armeria", "Bupleurum",
];

const NAME_ANIMALS = [
  "Deer", "Seal", "Owl", "Whale", "Fox", "Hedgehog", "Rabbit", "Squirrel",
  "Shiba", "Koala", "Swan", "Otter", "Panda", "Dolphin", "Peacock", "Sparrow",
  "Cat", "Kitten", "Dog", "Puppy", "Bunny", "Duck", "Duckling", "Fawn",
  "Cub", "Chick", "Penguin", "Hamster", "GuineaPig", "Ferret", "Alpaca", "Llama",
  "Wombat", "Wallaby", "Kangaroo", "Sloth", "Meerkat", "Raccoon", "Beaver", "Badger",
  "Mole", "Marmot", "Chipmunk", "Mouse", "Otterling", "Pony", "Foal", "Lamb",
  "Goat", "Kid", "Calf", "Piglet", "Piggy", "Cow", "Horse", "Donkey",
  "Robin", "Finch", "Canary", "Parrot", "Puffin", "Wren", "Lark", "Bluebird",
  "Goldfinch", "Hummingbird", "Kingfisher", "Woodpecker", "Heron", "Crane", "Flamingo", "Pelican",
  "Turtle", "Tortoise", "Frog", "Toad", "Newt", "Salamander", "Gecko", "Chameleon",
  "Seahorse", "Starfish", "Jellyfish", "Octopus", "Manatee", "Narwhal", "Beluga", "Coral",
  "Butterfly", "Ladybug", "Bumblebee", "Dragonfly", "Firefly", "Moth", "Bee", "Caterpillar",
  "Sparrowhawk", "Dove", "Lovebird", "Songbird",
  "Quokka", "Fossa", "Dugong", "Genet", "Caracal", "Serval", "Cuscus", "Kinkajou",
  "Binturong", "Margay", "Tarsier", "Ayeaye", "Saiga", "Okapi", "Coati", "Tamandua",
  "Quoll", "Muntjac", "Tenrec", "Zorilla",
];

/** Pick a random element. Guarded for empty pools (falls back to ""). */
function pickRandom<T>(pool: readonly T[]): T | "" {
  if (pool.length === 0) return "";
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Returns a fresh random "<Prefix> <Animal>" display name for a new session. */
export function randomSessionName(): string {
  const prefix = pickRandom(NAME_PREFIXES);
  const animal = pickRandom(NAME_ANIMALS);
  if (!prefix && !animal) return "";
  if (!prefix) return String(animal);
  if (!animal) return String(prefix);
  return `${prefix} ${animal}`;
}
