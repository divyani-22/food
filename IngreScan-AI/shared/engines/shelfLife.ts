/**
 * Default shelf-life estimator for common grocery items.
 *
 * PURE module: no I/O, no framework imports, deterministic. Time is injected
 * through `now`. Safe to import from both the server and the React client.
 *
 * IMPORTANT (food safety): every number here is a conservative PLANNING
 * ESTIMATE, rounded toward the low end of widely published guidance (USDA
 * FoodKeeper, UK FSA / NHS, FSSAI / ICMR-NIN household guidance). It is never a
 * substitute for a use-by / best-before date printed on the pack, and it never
 * says a food is safe. Freezer figures are QUALITY figures: food kept
 * continuously at -18 C stays safe indefinitely, it just degrades.
 * When a name cannot be matched confidently the function returns null instead
 * of guessing.
 */

export type ShelfLifeLocation = "fridge" | "freezer" | "pantry";
export type ShelfLifeConfidence = "high" | "medium" | "low";
/** Mirrors the CATEGORIES values used by client FridgeTracker. */
export type ShelfLifeCategory =
  | "Dairy"
  | "Produce"
  | "Meat"
  | "Grains"
  | "Snacks"
  | "Beverages"
  | "Condiments"
  | "Other";

export interface ShelfLifeDays {
  fridge?: number;
  freezer?: number;
  pantry?: number;
}

export interface ShelfLifeEntry {
  key: string;
  synonyms: readonly string[];
  category: ShelfLifeCategory;
  defaultLocation: ShelfLifeLocation;
  /** Days per location when unopened / as bought. 0 = do not store there. */
  days: Readonly<ShelfLifeDays>;
  /** Overrides applied on top of `days` once the pack is opened / cut / cooked. */
  openedDays?: Readonly<ShelfLifeDays>;
  note?: string;
  confidence: ShelfLifeConfidence;
  /** Key of the entry to use when the name says cooked / leftover etc. */
  cookedVariant?: { key: string; markers?: readonly string[] };
}

export interface ShelfLifeOptions {
  /** Where the user will store it. Defaults to the entry's default location. */
  location?: ShelfLifeLocation;
  /** Pack already opened / item already cut. */
  opened?: boolean;
  /** Injected clock; the expiry date is computed from the UTC calendar date. */
  now?: Date;
  /** Lowest confidence accepted (default "low"). */
  minConfidence?: ShelfLifeConfidence;
}

export interface ShelfLifeEstimate {
  days: number;
  /** YYYY-MM-DD (UTC calendar date of `now` plus `days`). */
  expiryDate: string;
  location: ShelfLifeLocation;
  category: ShelfLifeCategory;
  matchedKey: string;
  confidence: ShelfLifeConfidence;
  /** 0..1 name-match quality (1 = every meaningful word explained). */
  matchScore: number;
  /** True when the requested location had no usable figure and another was used. */
  locationFallback: boolean;
  /** Always true: this is an estimate, never a guarantee. */
  isEstimate: true;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Table                                                                */
/* ------------------------------------------------------------------ */

type D = ShelfLifeDays;
function E(
  key: string,
  category: ShelfLifeCategory,
  defaultLocation: ShelfLifeLocation,
  confidence: ShelfLifeConfidence,
  days: D,
  synonyms: string[],
  extra: { opened?: D; note?: string; cooked?: { key: string; markers?: string[] } } = {},
): ShelfLifeEntry {
  return {
    key,
    synonyms,
    category,
    defaultLocation,
    days,
    openedDays: extra.opened,
    note: extra.note,
    confidence,
    cookedVariant: extra.cooked,
  };
}

const COOKED_TEXT =
  "Cooked food: cool quickly and refrigerate within 2 hours (within 1 hour if the room is hotter than 32 C / 90 F), reheat until steaming hot all the way through (74 C / 165 F) and reheat only once. Do not eat cooked food that has been left out for more than 2 hours.";

export const SHELF_LIFE_TABLE: readonly ShelfLifeEntry[] = [
  /* ---------------- Produce: fruit ---------------- */
  E("apple", "Produce", "fridge", "high", { fridge: 21, pantry: 5, freezer: 0 }, ["apple", "seb"], {
    opened: { fridge: 3, pantry: 1 },
  }),
  E("banana", "Produce", "pantry", "high", { pantry: 4, fridge: 5, freezer: 90 }, ["banana", "kela", "plantain"], {
    note: "Ripens quickly at room temperature; peel before freezing.",
  }),
  E("orange", "Produce", "fridge", "high", { fridge: 21, pantry: 7 }, ["orange", "mandarin", "tangerine", "kinnow", "mosambi", "sweet lime", "citrus"], {
    opened: { fridge: 2, pantry: 0 },
  }),
  E("lemon", "Produce", "fridge", "high", { fridge: 21, pantry: 7 }, ["lemon", "lime", "nimbu", "nimboo"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("grape", "Produce", "fridge", "high", { fridge: 7, pantry: 1 }, ["grape", "angoor"], {
    note: "Wash just before eating.",
  }),
  E("strawberry", "Produce", "fridge", "high", { fridge: 3, freezer: 180, pantry: 0 }, ["strawberry"], {
    note: "Discard any with mould; mould spreads quickly in a punnet.",
  }),
  E("blueberry", "Produce", "fridge", "medium", { fridge: 7, freezer: 180, pantry: 0 }, ["blueberry", "cranberry"]),
  E("raspberry", "Produce", "fridge", "medium", { fridge: 2, freezer: 180, pantry: 0 }, ["raspberry", "blackberry", "mulberry"]),
  E("mango", "Produce", "pantry", "medium", { pantry: 4, fridge: 5, freezer: 180 }, ["mango", "aam"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("watermelon", "Produce", "pantry", "medium", { pantry: 7, fridge: 14 }, ["watermelon", "tarbooz"], {
    opened: { fridge: 3, pantry: 0 },
    note: "Cut melon must be refrigerated within 2 hours of cutting; throw it away if it was left out longer.",
  }),
  E("muskmelon", "Produce", "fridge", "medium", { fridge: 5, pantry: 3 }, ["muskmelon", "cantaloupe", "melon", "kharbuja"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("papaya", "Produce", "pantry", "medium", { pantry: 3, fridge: 4 }, ["papaya", "papita"], {
    opened: { fridge: 2, pantry: 0 },
  }),
  E("pineapple", "Produce", "pantry", "medium", { pantry: 2, fridge: 5 }, ["pineapple", "ananas"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("pomegranate", "Produce", "fridge", "medium", { fridge: 21, pantry: 7 }, ["pomegranate", "anar"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("guava", "Produce", "pantry", "low", { pantry: 3, fridge: 5 }, ["guava", "amrud"]),
  E("avocado", "Produce", "pantry", "medium", { pantry: 4, fridge: 3 }, ["avocado"], {
    opened: { fridge: 2, pantry: 0 },
    note: "Days are for a ripe avocado; unripe fruit ripens at room temperature.",
  }),
  E("pear", "Produce", "pantry", "medium", { pantry: 4, fridge: 5 }, ["pear", "nashpati"]),
  E("peach", "Produce", "fridge", "medium", { fridge: 3, pantry: 2 }, ["peach", "plum", "nectarine", "apricot", "aadu"]),

  /* ---------------- Produce: vegetables ---------------- */
  E("tomato", "Produce", "pantry", "medium", { pantry: 3, fridge: 5 }, ["tomato", "tamatar"], {
    opened: { fridge: 2, pantry: 0 },
  }),
  E("onion", "Produce", "pantry", "high", { pantry: 30, fridge: 30 }, ["onion", "pyaz", "pyaaz", "kanda"], {
    opened: { fridge: 5, pantry: 0 },
    note: "Cut or peeled onion: refrigerate in a closed container.",
  }),
  E("potato", "Produce", "pantry", "high", { pantry: 21 }, ["potato", "aloo", "aalu"], {
    opened: { fridge: 3, pantry: 0 },
    note: "Store cool, dark and dry. Discard green or sprouting potatoes.",
  }),
  E("sweet_potato", "Produce", "pantry", "medium", { pantry: 14 }, ["sweet potato", "shakarkandi", "yam"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("garlic", "Produce", "pantry", "medium", { pantry: 30, fridge: 30 }, ["garlic", "lehsun", "lasun"], {
    opened: { fridge: 7, pantry: 0 },
    note: "Peeled or crushed garlic: refrigerate and use within a week.",
  }),
  E("ginger", "Produce", "fridge", "medium", { fridge: 21, pantry: 7, freezer: 180 }, ["ginger", "adrak"], {
    opened: { fridge: 7, pantry: 0 },
  }),
  E("carrot", "Produce", "fridge", "high", { fridge: 21, pantry: 3 }, ["carrot", "gajar"]),
  E("cucumber", "Produce", "fridge", "high", { fridge: 7, pantry: 2 }, ["cucumber", "kheera", "kakdi"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("bell_pepper", "Produce", "fridge", "high", { fridge: 5, pantry: 2 }, ["bell pepper", "capsicum", "shimla mirch", "sweet pepper"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("green_chilli", "Produce", "fridge", "medium", { fridge: 7, pantry: 2, freezer: 90 }, ["green chilli", "hari mirch", "chilli", "chili", "mirchi", "jalapeno"]),
  E("spinach", "Produce", "fridge", "high", { fridge: 3, pantry: 0 }, ["spinach", "palak"], {
    note: "Leafy greens go limp and slimy quickly; discard if slimy.",
  }),
  E("coriander", "Produce", "fridge", "medium", { fridge: 5, pantry: 0 }, ["coriander leaf", "fresh coriander", "coriander", "cilantro", "dhania", "dhaniya", "parsley"]),
  E("mint", "Produce", "fridge", "medium", { fridge: 5, pantry: 0 }, ["mint", "pudina", "basil", "tulsi"]),
  E("fenugreek_leaves", "Produce", "fridge", "medium", { fridge: 3, pantry: 0 }, ["fenugreek leaf", "methi", "dill", "suva", "sarson", "amaranth leaf"]),
  E("lettuce", "Produce", "fridge", "high", { fridge: 5, pantry: 0 }, ["lettuce", "iceberg", "romaine", "rocket", "arugula", "kale"], {
    note: "Bagged salad: follow the use-by date and eat within 2-3 days of opening.",
  }),
  E("salad_mix", "Produce", "fridge", "medium", { fridge: 4, pantry: 0 }, ["salad mix", "salad leaves", "baby leaves", "bagged salad", "salad bag"], {
    opened: { fridge: 2 },
    note: "Follow the use-by date on the bag.",
  }),
  E("cabbage", "Produce", "fridge", "high", { fridge: 14, pantry: 2 }, ["cabbage", "patta gobi", "band gobi", "bandh gobi"], {
    opened: { fridge: 5 },
  }),
  E("cauliflower", "Produce", "fridge", "high", { fridge: 5, pantry: 1 }, ["cauliflower", "gobi", "gobhi", "phool gobi"], {
    opened: { fridge: 3 },
  }),
  E("broccoli", "Produce", "fridge", "high", { fridge: 4, pantry: 1 }, ["broccoli"], { opened: { fridge: 3 } }),
  E("okra", "Produce", "fridge", "medium", { fridge: 3, pantry: 1 }, ["okra", "bhindi", "lady finger", "ladyfinger"]),
  E("eggplant", "Produce", "fridge", "medium", { fridge: 4, pantry: 2 }, ["eggplant", "brinjal", "baingan", "aubergine"]),
  E("green_peas", "Produce", "fridge", "medium", { fridge: 3, freezer: 180, pantry: 0 }, ["green pea", "pea", "matar", "peas in pod"], {
    note: "Frozen peas: keep frozen; once thawed, use within 1-2 days.",
  }),
  E("green_beans", "Produce", "fridge", "medium", { fridge: 4, freezer: 180, pantry: 1 }, ["green bean", "french bean", "beans", "farasbi", "cluster bean", "gavar"]),
  E("mushroom", "Produce", "fridge", "high", { fridge: 4, pantry: 0, freezer: 0 }, ["mushroom"], {
    note: "Store loosely in a paper bag; discard if slimy.",
  }),
  E("corn", "Produce", "fridge", "medium", { fridge: 2, freezer: 180, pantry: 1 }, ["corn on the cob", "sweet corn", "corn cob", "bhutta", "maize", "corn"], {
    note: "Fresh corn loses sweetness quickly; use within 2 days.",
  }),
  E("beetroot", "Produce", "fridge", "medium", { fridge: 10, pantry: 3 }, ["beetroot", "beet", "chukandar"]),
  E("radish", "Produce", "fridge", "medium", { fridge: 7, pantry: 2 }, ["radish", "mooli", "daikon", "turnip", "shalgam"]),
  E("pumpkin", "Produce", "pantry", "medium", { pantry: 30, fridge: 30 }, ["pumpkin", "kaddu", "butternut", "squash"], {
    opened: { fridge: 4, pantry: 0 },
  }),
  E("bottle_gourd", "Produce", "fridge", "low", { fridge: 5, pantry: 2 }, ["bottle gourd", "lauki", "doodhi", "ghiya"]),
  E("bitter_gourd", "Produce", "fridge", "low", { fridge: 4, pantry: 2 }, ["bitter gourd", "karela", "bitter melon"]),
  E("celery", "Produce", "fridge", "medium", { fridge: 7, pantry: 0 }, ["celery", "leek"]),
  E("zucchini", "Produce", "fridge", "medium", { fridge: 5, pantry: 1 }, ["zucchini", "courgette", "tinda", "ridge gourd", "turai", "tori"]),
  E("spring_onion", "Produce", "fridge", "medium", { fridge: 5, pantry: 0 }, ["spring onion", "green onion", "scallion", "hara pyaz"]),
  E("curry_leaves", "Produce", "fridge", "medium", { fridge: 5, freezer: 90, pantry: 1 }, ["curry leaf", "kadi patta", "kadhi patta", "kadipatta"]),

  /* ---------------- Dairy & eggs ---------------- */
  E("milk", "Dairy", "fridge", "high", { fridge: 4, freezer: 90, pantry: 0 }, ["milk", "doodh", "dudh", "whole milk", "cow milk", "buffalo milk", "toned milk", "skimmed milk"], {
    opened: { fridge: 3 },
    note: "The use-by date on the pack always wins. Pouch milk is normally good for 2-3 days; boil loose milk before use.",
  }),
  E("uht_milk", "Dairy", "pantry", "medium", { pantry: 90, fridge: 90, freezer: 0 }, ["uht milk", "long life milk", "tetra pack milk", "tetra milk", "shelf stable milk"], {
    opened: { fridge: 3, pantry: 0 },
    note: "Unopened shelf-stable milk is fine at room temperature until the printed date; refrigerate once opened.",
  }),
  E("curd", "Dairy", "fridge", "high", { fridge: 7, freezer: 60, pantry: 0 }, ["curd", "dahi", "yogurt", "yoghurt", "greek yogurt", "greek yoghurt", "curd cup", "set curd", "probiotic curd"], {
    opened: { fridge: 4 },
    note: "Homemade curd turns sour in a few days; discard if mould or off smell appears.",
  }),
  E("buttermilk", "Dairy", "fridge", "medium", { fridge: 4, pantry: 0 }, ["buttermilk", "butter milk", "chaas", "chaach", "lassi", "mattha", "chhaas"], {
    opened: { fridge: 2 },
  }),
  E("paneer", "Dairy", "fridge", "medium", { fridge: 3, freezer: 60, pantry: 0 }, ["paneer", "cottage cheese indian", "chhena"], {
    opened: { fridge: 2 },
    note: "Fresh unpackaged paneer: use within 2 days. Keep covered, ideally submerged in clean water, and refrigerated.",
  }),
  E("hard_cheese", "Dairy", "fridge", "high", { fridge: 60, freezer: 90, pantry: 0 }, ["cheddar", "parmesan", "gouda", "swiss cheese", "emmental", "edam", "gruyere", "hard cheese", "cheese block", "pecorino", "manchego", "cheese"], {
    opened: { fridge: 21 },
    note: "Mould on hard cheese can be cut off with a margin of at least 2.5 cm (1 inch) around and below the mould, keeping the knife out of the mould; soft, shredded or crumbled cheeses with mould must be discarded.",
  }),
  E("processed_cheese", "Dairy", "fridge", "high", { fridge: 60, freezer: 0, pantry: 0 }, ["processed cheese", "cheese slice", "cheese spread", "cheese cube", "cheese tin", "cheese singles"], {
    opened: { fridge: 21 },
  }),
  E("mozzarella", "Dairy", "fridge", "medium", { fridge: 10, freezer: 60, pantry: 0 }, ["mozzarella", "pizza cheese", "shredded cheese", "grated cheese", "burrata"], {
    opened: { fridge: 5 },
  }),
  E("cream_cheese", "Dairy", "fridge", "medium", { fridge: 14, freezer: 0, pantry: 0 }, ["cream cheese", "mascarpone"], {
    opened: { fridge: 10 },
  }),
  E("cottage_cheese", "Dairy", "fridge", "medium", { fridge: 10, freezer: 0, pantry: 0 }, ["cottage cheese", "ricotta", "quark"], {
    opened: { fridge: 5 },
  }),
  E("soft_cheese", "Dairy", "fridge", "medium", { fridge: 14, freezer: 0, pantry: 0 }, ["feta", "brie", "camembert", "goat cheese", "blue cheese", "soft cheese", "halloumi"], {
    opened: { fridge: 5 },
    note: "Soft and blue cheeses are higher risk for Listeria. Pregnant, elderly and immunocompromised people should avoid unpasteurised and mould-ripened soft cheeses (or eat them only when cooked until steaming hot) and follow local advice.",
  }),
  E("butter", "Dairy", "fridge", "high", { fridge: 60, freezer: 180, pantry: 0 }, ["butter", "makhan", "salted butter", "unsalted butter", "white butter", "table butter"], {
    opened: { fridge: 30 },
  }),
  E("ghee", "Dairy", "pantry", "medium", { pantry: 180, fridge: 180 }, ["ghee", "clarified butter", "desi ghee", "cow ghee"], {
    opened: { pantry: 90, fridge: 180 },
    note: "Use a dry clean spoon; discard if it smells rancid.",
  }),
  E("eggs", "Dairy", "fridge", "high", { fridge: 21, pantry: 0, freezer: 0 }, ["egg", "anda", "eggs", "dozen eggs", "farm eggs", "brown egg", "white egg", "free range egg"], {
    cooked: { key: "boiled_egg", markers: ["boiled", "hard", "cooked", "hardboiled"] },
    note: "Keep refrigerated; discard cracked eggs. Do not freeze in the shell. Cook eggs until the white and yolk are firm for babies, pregnant, elderly and immunocompromised people.",
  }),
  E("boiled_egg", "Dairy", "fridge", "high", { fridge: 7, pantry: 0, freezer: 0 }, ["boiled egg", "hard boiled egg", "hardboiled egg", "egg boiled", "hard boil egg"], {
    note: "Hard-boiled eggs: refrigerate within 2 hours and use within a week.",
  }),
  E("cream", "Dairy", "fridge", "medium", { fridge: 7, freezer: 60, pantry: 0 }, ["cream", "fresh cream", "heavy cream", "whipping cream", "double cream", "single cream", "malai", "cream pack"], {
    opened: { fridge: 3 },
  }),
  E("sour_cream", "Dairy", "fridge", "medium", { fridge: 14, freezer: 0, pantry: 0 }, ["sour cream", "creme fraiche"], { opened: { fridge: 7 } }),
  E("ice_cream", "Dairy", "freezer", "high", { freezer: 60, fridge: 0, pantry: 0 }, ["ice cream", "gelato", "kulfi", "frozen dessert", "ice cream tub"], {
    opened: { freezer: 30 },
    note: "Do not refreeze if it has melted.",
  }),
  E("condensed_milk", "Dairy", "pantry", "medium", { pantry: 180, fridge: 180 }, ["condensed milk", "+milkmaid", "evaporated milk"], {
    opened: { fridge: 5, pantry: 0 },
    note: "Once opened, transfer to a clean covered container and refrigerate.",
  }),
  E("milk_powder", "Dairy", "pantry", "medium", { pantry: 180, fridge: 180 }, ["milk powder", "dairy whitener", "whitener", "creamer", "skimmed milk powder", "full cream milk powder"], {
    opened: { pantry: 90, fridge: 90 },
    note: "Keep dry and tightly closed. Prepared (reconstituted) milk must be treated as fresh milk.",
  }),
  E("plant_milk", "Beverages", "fridge", "low", { fridge: 7, pantry: 90 }, ["almond milk", "soy milk", "soya milk", "oat milk", "rice milk", "plant milk", "cashew milk"], {
    opened: { fridge: 5, pantry: 0 },
    note: "Assumes a chilled carton. A sealed shelf-stable (UHT) carton can be kept in the pantry until its printed date; refrigerate after opening.",
  }),
  E("coconut_milk", "Condiments", "pantry", "medium", { pantry: 180, fridge: 180 }, ["coconut milk", "coconut cream", "nariyal doodh"], {
    opened: { fridge: 3, pantry: 0 },
  }),
  E("tofu", "Dairy", "fridge", "medium", { fridge: 10, freezer: 90, pantry: 0 }, ["tofu", "bean curd", "soya paneer"], {
    opened: { fridge: 3 },
    note: "Opened tofu: store in fresh water and change the water daily.",
  }),

  /* ---------------- Meat, fish, poultry ---------------- */
  E("chicken", "Meat", "fridge", "high", { fridge: 1, freezer: 180, pantry: 0 }, ["chicken", "murgh", "poultry", "chicken breast", "chicken thigh", "chicken leg", "chicken wing", "whole chicken", "curry cut chicken", "chicken drumstick", "chicken curry cut", "turkey", "chicken tikka raw"], {
    cooked: { key: "cooked_meat" },
    note: "Raw poultry: cook or freeze on the day of purchase, no later than 1-2 days. Never wash raw chicken; keep it below other foods. Cook to 74 C (165 F).",
  }),
  E("ground_meat", "Meat", "fridge", "high", { fridge: 1, freezer: 90, pantry: 0 }, ["mince", "minced meat", "keema", "qeema", "ground beef", "ground meat", "ground chicken", "ground turkey", "ground pork", "ground lamb", "minced chicken", "minced beef", "minced lamb", "minced mutton", "minced pork", "chicken mince", "mutton mince", "chicken keema", "mutton keema", "beef mince", "pork mince", "lamb mince", "burger patty raw"], {
    cooked: { key: "cooked_meat" },
    note: "Minced meat spoils faster than whole cuts; use on the day of purchase or the next day. Cook to 71 C (160 F).",
  }),
  E("beef", "Meat", "fridge", "high", { fridge: 3, freezer: 180, pantry: 0 }, ["beef", "steak", "beef steak", "roast beef", "veal", "buffalo meat", "carabeef"], {
    cooked: { key: "cooked_meat" },
    note: "Raw beef cuts: 3-5 days at most in a fridge at or below 4 C; lower end used here.",
  }),
  E("pork", "Meat", "fridge", "high", { fridge: 3, freezer: 120, pantry: 0 }, ["pork", "pork chop", "pork loin", "pork belly", "pork ribs"], {
    cooked: { key: "cooked_meat" },
    note: "Raw pork cuts: 3-5 days at most; lower end used here.",
  }),
  E("mutton", "Meat", "fridge", "medium", { fridge: 2, freezer: 180, pantry: 0 }, ["mutton", "lamb", "goat meat", "goat", "gosht", "lamb chop", "lamb leg"], {
    cooked: { key: "cooked_meat" },
    note: "Cut mutton or lamb: use within 2 days (large roasts or chops up to 3).",
  }),
  E("bacon", "Meat", "fridge", "high", { fridge: 7, freezer: 30, pantry: 0 }, ["bacon", "pork bacon", "turkey bacon"], {
    opened: { fridge: 5 },
  }),
  E("sausage", "Meat", "fridge", "high", { fridge: 2, freezer: 60, pantry: 0 }, ["sausage", "raw sausage", "chicken sausage", "pork sausage", "bratwurst"], {
    note: "Fresh (raw) sausages: 1-2 days. Precooked or smoked sausages keep longer, follow the pack.",
  }),
  E("hot_dog", "Meat", "fridge", "medium", { fridge: 14, freezer: 60, pantry: 0 }, ["hot dog", "frankfurter", "wiener", "cocktail sausage", "cooked sausage"], {
    opened: { fridge: 7 },
  }),
  E("fish", "Meat", "fridge", "high", { fridge: 1, freezer: 60, pantry: 0 }, ["fish", "machli", "salmon", "rohu", "pomfret", "hilsa", "sardine", "mackerel", "bangda", "basa", "tilapia", "seer fish", "surmai", "fish fillet", "catla", "tuna fresh", "cod", "bombil", "fish steak"], {
    cooked: { key: "cooked_fish" },
    note: "Raw fish: cook or freeze on the day of purchase, no later than 1-2 days. Keep very cold (on ice or the coldest shelf).",
  }),
  E("prawns", "Meat", "fridge", "high", { fridge: 1, freezer: 90, pantry: 0 }, ["prawn", "shrimp", "jhinga", "crab", "lobster", "squid", "calamari", "shellfish", "seafood", "mussel", "oyster", "clam"], {
    cooked: { key: "cooked_fish" },
    note: "Raw shellfish: use within 1-2 days. Discard if the smell is strong or the shells of live shellfish stay open; a normal smell does not prove it is safe.",
  }),
  E("canned_fish", "Meat", "pantry", "medium", { pantry: 365, fridge: 0 }, ["canned tuna", "tuna can", "canned sardine", "canned salmon", "canned fish", "tuna tin", "sardine tin", "tinned tuna", "tinned fish"], {
    opened: { fridge: 3, pantry: 0 },
    note: "Discard cans that are bulging, leaking or badly dented. Once opened, move to a covered container and refrigerate.",
  }),
  E("deli_meat", "Meat", "fridge", "high", { fridge: 14, freezer: 60, pantry: 0 }, ["deli meat", "cold cut", "ham", "salami", "pepperoni", "luncheon meat", "sliced turkey", "sliced chicken", "cold cuts", "pastrami", "mortadella", "chicken slices", "chicken ham"], {
    opened: { fridge: 4 },
    note: "Sliced deli meat is a Listeria risk: once opened keep very cold and use within 3-5 days. Pregnant, elderly and immunocompromised people should follow local advice (commonly: eat only if cooked until steaming hot).",
  }),
  E("cooked_meat", "Meat", "fridge", "high", { fridge: 3, freezer: 60, pantry: 0 }, ["cooked chicken", "cooked meat", "roast chicken", "grilled chicken", "fried chicken", "tandoori chicken", "cooked mutton", "cooked beef", "cooked lamb", "leftover chicken", "rotisserie chicken", "roasted chicken", "cooked pork", "kebab", "tikka"], {
    note: COOKED_TEXT,
  }),
  E("cooked_fish", "Meat", "fridge", "high", { fridge: 3, freezer: 60, pantry: 0 }, ["cooked fish", "fried fish", "grilled fish", "cooked prawn", "cooked shrimp", "fish fry", "fish curry", "prawn curry", "leftover fish"], {
    note: COOKED_TEXT,
  }),

  /* ---------------- Cooked leftovers / dishes ---------------- */
  E("cooked_rice", "Grains", "fridge", "high", { fridge: 1, freezer: 30, pantry: 0 }, ["cooked rice", "leftover rice", "steamed rice", "fried rice", "biryani", "pulao", "pilaf", "khichdi", "jeera rice", "curd rice", "lemon rice", "egg fried rice", "veg biryani"], {
    note: "Cooked rice can carry Bacillus cereus spores: cool within 1 hour, refrigerate and eat within 1 day. Reheat once, until steaming hot.",
  }),
  E("cooked_pasta", "Grains", "fridge", "high", { fridge: 3, freezer: 60, pantry: 0 }, ["cooked pasta", "cooked noodles", "leftover pasta", "cooked spaghetti", "leftover noodles"], {
    note: COOKED_TEXT,
  }),
  E("cooked_dal", "Other", "fridge", "high", { fridge: 3, freezer: 60, pantry: 0 }, ["cooked dal", "dal tadka", "dal fry", "dal makhani", "sambar", "rasam", "rajma masala", "chole masala", "cooked lentils", "cooked beans", "leftover dal"], {
    note: COOKED_TEXT,
  }),
  E("cooked_dish", "Other", "fridge", "high", { fridge: 3, freezer: 60, pantry: 0 }, ["curry", "gravy", "korma", "sabzi", "sabji", "bhaji", "stew", "butter chicken", "paneer butter masala", "palak paneer", "kadai paneer", "shahi paneer", "matar paneer", "paneer curry", "chicken curry", "egg curry", "mutton curry", "leftovers", "leftover", "cooked food", "cooked vegetables", "tikka masala", "paneer tikka", "homemade soup", "cooked", "meal", "thali", "ready meal", "tiffin"], {
    note: COOKED_TEXT,
  }),
  E("pizza", "Other", "fridge", "medium", { fridge: 3, freezer: 60, pantry: 0 }, ["pizza", "cooked pizza", "leftover pizza", "pizza slice"], {
    note: "Cooked pizza: refrigerate within 2 hours. Frozen packaged pizza: follow the pack, usually quality-best within 2 months.",
  }),
  E("batter", "Other", "fridge", "low", { fridge: 3, freezer: 0, pantry: 0 }, ["dosa batter", "idli batter", "batter", "dosa idli batter", "uttapam batter"], {
    note: "Fermented batter keeps its quality for a few days; discard if it smells sharply sour or shows pink or black spots.",
  }),
  E("deli_salad", "Other", "fridge", "medium", { fridge: 3, freezer: 0, pantry: 0 }, ["raita", "coleslaw", "potato salad", "egg salad", "tuna salad", "chicken salad", "pasta salad", "deli salad", "fruit salad", "cut fruit", "fruit cup"], {
    note: "Prepared salads and cut fruit: keep cold and use within 3 days (cut fruit sooner).",
  }),
  E("hummus", "Other", "fridge", "medium", { fridge: 14, freezer: 0, pantry: 0 }, ["hummus", "dip", "guacamole", "salsa fresh", "tzatziki", "baba ganoush"], {
    opened: { fridge: 4 },
    note: "Figures are for sealed shop-bought dips (follow the use-by date). Freshly made dips keep only 1-2 days refrigerated.",
  }),

  /* ---------------- Bakery & grains ---------------- */
  E("bread", "Grains", "pantry", "high", { pantry: 4, fridge: 7, freezer: 90 }, ["bread", "loaf", "sliced bread", "pav", "bun", "brown bread", "white bread", "sandwich bread", "multigrain bread", "milk bread", "toast bread", "sourdough", "baguette", "bagel", "burger bun", "hot dog bun", "dinner roll", "bread roll", "bread loaf"], {
    note: "Discard the whole loaf if any mould is visible: it spreads invisibly through soft bread.",
  }),
  E("roti", "Grains", "fridge", "medium", { pantry: 0, fridge: 3, freezer: 30 }, ["roti", "chapati", "chapatti", "phulka", "fulka", "tandoori roti", "rumali roti", "khakhra fresh"], {
    note: "Cooked rotis: eat within a few hours at room temperature (no more than 2 hours), otherwise refrigerate and reheat once until steaming hot.",
  }),
  E("naan", "Grains", "pantry", "medium", { pantry: 2, fridge: 5, freezer: 90 }, ["naan", "paratha", "kulcha", "parantha", "thepla", "puri", "poori", "bhatura", "tortilla", "wrap", "pita", "flatbread", "lachha paratha", "malabar paratha", "roomali"], {
    note: "Frozen packaged parathas: keep frozen and cook from frozen as per pack. Fresh or chilled: follow the use-by date. Freshly cooked puri, bhatura or paratha should not stay at room temperature for more than 2 hours.",
  }),
  E("cake", "Grains", "fridge", "low", { fridge: 3, pantry: 2, freezer: 60 }, ["cake", "pastry", "muffin", "cupcake", "brownie", "doughnut", "donut", "croissant", "cream cake", "pastries", "eclair", "danish"], {
    note: "Fresh bakery items, especially cream or custard cakes, should be refrigerated and eaten within 2-3 days. Shelf-stable packaged cakes: follow the pack date. Never leave cream or custard cakes at room temperature for more than 2 hours.",
  }),
  E("biscuit", "Snacks", "pantry", "medium", { pantry: 60, fridge: 0 }, ["biscuit", "cookie", "cracker", "cream cracker", "rusk", "wafer", "digestive", "bikis", "marie", "glucose biscuit", "+oreo", "+hide and seek", "+bourbon", "+parle g", "+monaco", "+jim jam", "+krackjack", "+marie gold", "khari", "toast", "nankhatai", "biscotti", "cream biscuit", "cookie pack"], {
    opened: { pantry: 21 },
    note: "Keep opened packs in an airtight container.",
  }),
  E("chips", "Snacks", "pantry", "medium", { pantry: 60, fridge: 0 }, ["chip", "crisp", "potato chip", "namkeen", "bhujia", "sev", "mixture", "+kurkure", "+lays", "+bingo", "+pringles", "+doritos", "+cheetos", "+uncle chipps", "nachos", "popcorn", "murukku", "chakli", "makhana", "banana chips", "papad", "snack", "puffs", "puffed rice", "bhel", "farsan", "chivda", "wafers"], {
    opened: { pantry: 7 },
    note: "Opened packs go stale in about a week; reseal tightly.",
  }),
  E("nuts", "Snacks", "pantry", "medium", { pantry: 90, fridge: 180, freezer: 180 }, ["almond", "cashew", "walnut", "pistachio", "peanut", "badam", "kaju", "akhrot", "pista", "nuts", "mixed nuts", "groundnut", "hazelnut", "pecan", "trail mix", "roasted peanut", "dry fruit", "dry fruits"], {
    opened: { pantry: 60 },
    note: "Discard nuts that smell rancid or taste bitter.",
  }),
  E("dried_fruit", "Snacks", "pantry", "medium", { pantry: 90, fridge: 180 }, ["raisin", "kishmish", "dried fig", "anjeer", "dried date", "khajoor", "dates dried", "dried apricot", "prune", "dried cranberry", "dried fruit", "dried mango", "date"], {
    opened: { pantry: 60 },
  }),
  E("chocolate", "Snacks", "pantry", "medium", { pantry: 120, fridge: 120 }, ["chocolate", "dark chocolate", "milk chocolate", "white chocolate", "+cadbury", "+dairy milk", "+kitkat", "+kit kat", "+snickers", "+milky bar", "+milkybar", "toffee", "candy", "gems", "perk", "five star", "munch", "nutella", "chocolate bar", "chocolate spread", "eclairs", "lollipop", "mints"], {
    opened: { pantry: 60 },
    note: "Keep away from heat. A white bloom on chocolate is harmless fat or sugar bloom.",
  }),
  E("jam", "Condiments", "pantry", "medium", { pantry: 180, fridge: 180 }, ["jam", "jelly", "marmalade", "fruit spread", "preserve", "mixed fruit jam", "spread"], {
    opened: { fridge: 90, pantry: 30 },
    note: "Discard if mould appears on the surface.",
  }),
  E("honey", "Condiments", "pantry", "high", { pantry: 365, fridge: 365 }, ["honey", "shahad", "madhu", "maple syrup", "syrup", "golden syrup"], {
    opened: { pantry: 365 },
    note: "Honey does not spoil but should never be given to babies under 12 months. Crystallised honey is still fine.",
  }),
  E("peanut_butter", "Condiments", "pantry", "medium", { pantry: 180, fridge: 180 }, ["peanut butter", "almond butter", "nut butter", "sunflower seed butter", "tahini"], {
    opened: { pantry: 60, fridge: 90 },
  }),
  E("sugar", "Other", "pantry", "high", { pantry: 365 }, ["sugar", "cheeni", "shakkar", "brown sugar", "icing sugar", "powdered sugar", "caster sugar", "sugar cube", "mishri", "sweetener"], {
    note: "Sugar does not spoil; keep dry. The figure reflects a quality horizon only.",
  }),
  E("salt", "Other", "pantry", "high", { pantry: 365 }, ["salt", "namak", "rock salt", "sendha namak", "black salt", "kala namak", "iodised salt", "sea salt"], {
    note: "Salt does not spoil; keep dry. The figure reflects a quality horizon only.",
  }),
  E("jaggery", "Other", "pantry", "medium", { pantry: 180 }, ["jaggery", "gur", "gud"], { opened: { pantry: 90 } }),
  E("flour_atta", "Grains", "pantry", "medium", { pantry: 90, fridge: 180, freezer: 180 }, ["atta", "wheat flour", "whole wheat flour", "chakki atta", "multigrain atta", "ragi flour", "jowar flour", "bajra flour", "makki flour", "cornflour", "corn flour", "rice flour", "gram flour", "oat flour"], {
    opened: { pantry: 60 },
    note: "Whole-grain flours go rancid sooner and attract weevils in humid weather; store airtight.",
  }),
  E("flour_refined", "Grains", "pantry", "medium", { pantry: 120, fridge: 180 }, ["maida", "all purpose flour", "refined flour", "plain flour", "self raising flour", "bread flour", "baking flour"], {
    opened: { pantry: 90 },
  }),
  E("besan", "Grains", "pantry", "medium", { pantry: 90, fridge: 180 }, ["besan", "chickpea flour", "sattu"], { opened: { pantry: 60 } }),
  E("rice_raw", "Grains", "pantry", "high", { pantry: 365 }, ["rice", "basmati", "basmati rice", "chawal", "sona masoori", "ponni", "parboiled rice", "raw rice", "boiled rice", "jasmine rice", "idli rice", "matta rice", "kolam rice", "ambemohar", "rice bag", "long grain rice"], {
    opened: { pantry: 180 },
    cooked: { key: "cooked_rice", markers: ["cooked", "leftover", "steamed", "fried"] },
    note: "Uncooked white rice keeps well if dry and airtight. Brown rice has oils and keeps about 6 months.",
  }),
  E("brown_rice", "Grains", "pantry", "medium", { pantry: 180 }, ["brown rice", "red rice", "black rice", "wild rice"], { opened: { pantry: 90 } }),
  E("dal_dry", "Grains", "pantry", "high", { pantry: 365 }, ["dal", "lentil", "moong", "toor", "arhar", "masoor", "urad", "chana", "chana dal", "moong dal", "toor dal", "masoor dal", "urad dal", "rajma", "chickpea", "kabuli chana", "kala chana", "lobia", "black eyed pea", "kidney bean", "dried bean", "soya chunk", "soya nugget", "dried peas", "whole moong", "split pea", "pulses"], {
    opened: { pantry: 180 },
    cooked: { key: "cooked_dal", markers: ["cooked", "leftover"] },
    note: "Dry pulses keep for a long time when dry and airtight; check for weevils.",
  }),
  E("pasta_dry", "Grains", "pantry", "high", { pantry: 365 }, ["pasta", "spaghetti", "macaroni", "penne", "fusilli", "vermicelli", "semiya", "farfalle", "lasagne", "lasagna sheets", "couscous"], {
    opened: { pantry: 180 },
    cooked: { key: "cooked_pasta", markers: ["cooked", "leftover"] },
  }),
  E("noodles_instant", "Snacks", "pantry", "medium", { pantry: 180 }, ["instant noodle", "+maggi", "ramen", "cup noodle", "noodle", "+yippee", "top ramen", "hakka noodle", "egg noodle", "rice noodle"], {
    cooked: { key: "cooked_pasta", markers: ["cooked", "leftover"] },
  }),
  E("poha", "Grains", "pantry", "medium", { pantry: 180 }, ["poha", "flattened rice", "beaten rice", "murmura", "chura", "aval"], { opened: { pantry: 90 } }),
  E("semolina", "Grains", "pantry", "medium", { pantry: 90 }, ["rava", "suji", "sooji", "semolina", "upma rava", "bombay rava", "dalia", "broken wheat", "daliya"], { opened: { pantry: 60 } }),
  E("oats", "Grains", "pantry", "high", { pantry: 180 }, ["oat", "rolled oat", "oatmeal", "porridge oat", "quick oat", "steel cut oat", "instant oat", "muesli", "granola"], { opened: { pantry: 90 } }),
  E("cereal", "Grains", "pantry", "medium", { pantry: 90 }, ["cereal", "cornflake", "corn flake", "breakfast cereal", "chocos", "froot loops", "wheat flake", "cream of wheat", "chocos cereal", "special k"], { opened: { pantry: 30 } }),
  E("spice_ground", "Condiments", "pantry", "medium", { pantry: 365 }, ["turmeric", "haldi", "chilli powder", "chili powder", "red chilli powder", "cumin powder", "coriander powder", "dhania powder", "garam masala", "masala powder", "chaat masala", "curry powder", "amchur", "amchoor", "pav bhaji masala", "sambar powder", "sambar masala", "kitchen king", "biryani masala", "chicken masala powder", "paprika", "black pepper powder", "ground spice", "hing", "asafoetida", "spice mix", "meat masala", "chana masala powder", "turmeric powder", "haldi powder", "onion powder", "garlic powder", "ginger powder", "dry ginger", "saunth", "dry mango powder", "kasuri methi", "mustard powder", "pepper powder", "tandoori masala"], {
    opened: { pantry: 180 },
    note: "Spices stay safe but lose flavour. Discard if damp, clumped or mouldy.",
  }),
  E("spice_whole", "Condiments", "pantry", "medium", { pantry: 365 }, ["cumin", "jeera", "mustard seed", "rai", "cardamom", "elaichi", "clove", "laung", "cinnamon", "dalchini", "black pepper", "kali mirch", "peppercorn", "bay leaf", "tej patta", "star anise", "fennel", "saunf", "ajwain", "carom", "fenugreek seed", "methi dana", "coriander seed", "sesame", "til", "poppy seed", "khus khus", "dry red chilli", "saffron", "kesar", "nutmeg", "jaiphal", "whole spice", "flax seed", "chia seed", "dried chilli", "kashmiri chilli", "mace", "javitri", "herb dried", "oregano", "dried herb", "mixed herb", "chilli flake", "pizza seasoning", "seasoning"], {
    opened: { pantry: 365 },
    note: "Whole spices stay good longest in an airtight container away from light.",
  }),
  E("tea", "Beverages", "pantry", "medium", { pantry: 365 }, ["tea", "chai", "green tea", "black tea", "tea bag", "tea powder", "chai patti", "tea leaf", "masala tea", "tulsi tea", "herbal tea", "assam tea", "darjeeling", "red label", "taj mahal tea", "chamomile", "iced tea mix"], { opened: { pantry: 180 } }),
  E("coffee", "Beverages", "pantry", "medium", { pantry: 180 }, ["coffee", "ground coffee", "coffee powder", "instant coffee", "coffee bean", "+nescafe", "+bru", "filter coffee", "coffee pod", "cocoa powder", "cocoa", "hot chocolate", "horlicks", "bournvita", "boost", "complan", "malt drink", "malted drink", "health drink"], { opened: { pantry: 60 } }),
  E("cooking_oil", "Condiments", "pantry", "medium", { pantry: 365 }, ["oil", "cooking oil", "vegetable oil", "sunflower oil", "mustard oil", "groundnut oil", "peanut oil", "refined oil", "coconut oil", "rice bran oil", "soybean oil", "sesame oil", "til oil", "olive oil", "extra virgin olive oil", "canola oil", "palm oil", "cooking spray", "gingelly oil", "corn oil"], {
    opened: { pantry: 180 },
    note: "Discard oil that smells rancid or paint-like. Keep away from heat and light.",
  }),
  E("vinegar", "Condiments", "pantry", "high", { pantry: 365 }, ["vinegar", "apple cider vinegar", "white vinegar", "balsamic", "rice vinegar", "malt vinegar", "sirka", "balsamic vinegar"], { opened: { pantry: 365 } }),

  /* ---------------- Sauces & condiments ---------------- */
  E("ketchup", "Condiments", "pantry", "high", { pantry: 180, fridge: 180 }, ["ketchup", "tomato ketchup", "tomato sauce", "catsup"], { opened: { pantry: 30, fridge: 90 } }),
  E("mayonnaise", "Condiments", "pantry", "high", { pantry: 90, fridge: 90 }, ["mayonnaise", "mayo", "eggless mayonnaise", "salad dressing", "dressing", "ranch", "veg mayo", "thousand island", "caesar dressing"], {
    opened: { pantry: 0, fridge: 60 },
    note: "Refrigerate after opening.",
  }),
  E("mustard_sauce", "Condiments", "pantry", "medium", { pantry: 365 }, ["mustard", "mustard sauce", "kasundi", "yellow mustard", "dijon"], { opened: { fridge: 180, pantry: 30 } }),
  E("soy_sauce", "Condiments", "pantry", "high", { pantry: 365 }, ["soy sauce", "soya sauce", "chilli sauce", "chili sauce", "hot sauce", "schezwan sauce", "szechuan sauce", "schezwan chutney", "green chilli sauce", "red chilli sauce", "sriracha", "tabasco", "worcestershire", "worcestershire sauce", "oyster sauce", "fish sauce", "barbecue sauce", "bbq sauce", "sweet chilli sauce", "peri peri sauce", "tamarind sauce", "steak sauce", "teriyaki"], {
    opened: { pantry: 90, fridge: 180 },
  }),
  E("pasta_sauce", "Condiments", "pantry", "medium", { pantry: 180 }, ["pasta sauce", "pizza sauce", "marinara", "arrabbiata", "tomato pasta sauce", "red sauce", "white sauce jar", "curry sauce jar", "simmer sauce", "cooking sauce", "ready sauce"], { opened: { fridge: 5, pantry: 0 } }),
  E("pesto", "Condiments", "pantry", "low", { pantry: 180 }, ["pesto", "pesto sauce", "jarred pesto"], { opened: { fridge: 5, pantry: 0 } }),
  E("pickle", "Condiments", "pantry", "medium", { pantry: 180 }, ["pickle", "achaar", "achar", "mango pickle", "lime pickle", "mixed pickle", "garlic pickle", "chilli pickle", "gherkin", "olive", "jalapeno pickled", "pickled onion", "pickled cucumber", "lemon pickle", "avakaya", "gongura pickle"], {
    opened: { fridge: 90, pantry: 30 },
    note: "Use a dry clean spoon; discard if mould or an off smell appears.",
  }),
  E("chutney", "Condiments", "pantry", "low", { pantry: 120 }, ["chutney", "mint chutney", "tamarind chutney", "imli chutney", "coconut chutney", "green chutney", "bottled chutney"], { opened: { fridge: 14, pantry: 0 }, note: "Freshly made chutney keeps only 2-3 days refrigerated; this figure is for sealed commercial jars." }),
  E("tomato_puree", "Condiments", "pantry", "medium", { pantry: 180 }, ["tomato puree", "tomato paste", "tomato pulp", "puree", "ginger garlic paste", "garlic paste", "ginger paste", "curry paste", "tamarind paste", "tamarind", "imli", "kokum", "schezwan paste", "red chilli paste", "paste"], { opened: { fridge: 5, pantry: 0 } }),
  E("canned_veg", "Other", "pantry", "medium", { pantry: 365 }, ["canned", "tinned", "canned corn", "canned beans", "baked beans", "canned chickpeas", "canned mushroom", "canned vegetable", "canned tomato", "chopped tomato", "canned peas", "canned fruit", "canned pineapple", "canned soup", "tinned tomato", "tinned beans", "canned jackfruit", "mango pulp", "alphonso pulp", "fruit pulp", "canned peach", "fruit cocktail", "canned food", "tin food", "canned bean", "canned chick pea", "kidney beans canned", "canned sweetcorn", "tinned sweetcorn", "tinned soup", "baby corn canned"], {
    opened: { fridge: 3, pantry: 0 },
    note: "Discard cans that are bulging, leaking or badly dented. Once opened, transfer to a covered container and refrigerate; acidic fruit and tomatoes keep up to 5 days.",
  }),
  E("soup_packet", "Other", "pantry", "medium", { pantry: 180 }, ["instant soup", "soup mix", "soup packet", "soup cup", "knorr soup", "maggi soup", "cup a soup", "ready soup", "soup cube", "stock cube", "bouillon", "soup powder"], { opened: { pantry: 60 } }),

  /* ---------------- Beverages ---------------- */
  E("juice", "Beverages", "fridge", "low", { fridge: 10, pantry: 90 }, ["juice", "packaged juice", "fruit juice", "orange juice", "apple juice", "mango juice", "real juice", "mixed fruit juice", "pomegranate juice", "grape juice", "guava juice", "litchi juice", "fruit drink", "frooti", "maaza", "aam panna", "nectar", "cordial", "+tropicana", "+real fruit power"], {
    opened: { fridge: 5, pantry: 0 },
    note: "Assumes chilled juice; a sealed shelf-stable carton can be kept in the pantry until its printed date. Keep about 3-5 days once opened.",
  }),
  E("fresh_juice", "Beverages", "fridge", "medium", { fridge: 2, pantry: 0, freezer: 0 }, ["fresh juice", "cold coffee", "iced coffee", "frappe", "cold pressed juice", "cold pressed", "sugarcane juice", "sugar cane juice", "fresh orange juice", "fresh lime soda", "freshly squeezed juice", "chilled juice", "ganne ka ras", "nariyal pani fresh", "tender coconut", "smoothie", "milkshake", "shake", "coconut water fresh"], {
    note: "Unpasteurised or freshly pressed juice is a higher-risk food: keep cold and drink within 1-2 days. Young children, pregnant, elderly and immunocompromised people should avoid unpasteurised juice.",
  }),
  E("soft_drink", "Beverages", "pantry", "medium", { pantry: 90 }, ["soft drink", "cola", "soda", "coke", "coca cola", "pepsi", "sprite", "fanta", "thums up", "limca", "7up", "mountain dew", "mirinda", "tonic water", "ginger ale", "energy drink", "red bull", "monster", "sparkling water", "club soda", "carbonated drink", "cold drink", "soda water", "diet coke", "lemonade", "ice tea", "iced tea", "sting", "gatorade", "electrolyte drink", "sports drink"], {
    opened: { fridge: 3, pantry: 1 },
    note: "Opened fizzy drinks go flat within days.",
  }),
  E("water_bottled", "Beverages", "pantry", "medium", { pantry: 365 }, ["bottled water", "mineral water", "drinking water", "packaged drinking water", "bisleri", "aquafina", "kinley", "bisleri water", "aquafina water", "kinley water", "spring water", "alkaline water", "himalayan water", "evian"], {
    opened: { fridge: 3, pantry: 1 },
    note: "The date on the bottle takes precedence; once opened, drink within a few days.",
  }),

  /* ---------------- Frozen ---------------- */
  E("frozen_veg", "Produce", "freezer", "high", { freezer: 180, fridge: 0, pantry: 0 }, ["frozen vegetable", "frozen mixed vegetable", "mixed vegetable", "frozen veg", "mixed veg", "frozen corn", "frozen peas", "frozen spinach", "frozen broccoli", "frozen beans", "frozen cauliflower", "frozen carrot", "frozen okra", "frozen sweetcorn", "frozen bhindi", "frozen palak", "frozen matar", "peas frozen", "frozen fruit", "frozen berry", "frozen mango", "frozen mix", "stir fry mix", "frozen stir fry", "frozen potato", "frozen sprouts"], {
    note: "Keep continuously frozen. Do not refreeze once thawed.",
  }),
  E("french_fries", "Snacks", "freezer", "medium", { freezer: 90, fridge: 0, pantry: 0 }, ["french fries", "fries", "frozen fries", "potato wedges", "hash brown", "frozen chips", "frozen potato fries", "potato smileys", "aloo tikki frozen", "mccain fries"]),
  E("frozen_snack", "Snacks", "freezer", "medium", { freezer: 60, fridge: 0, pantry: 0 }, ["nugget", "chicken nugget", "momos", "momo", "dumpling", "spring roll", "samosa frozen", "frozen samosa", "tikki", "frozen kebab", "frozen snack", "veg nugget", "cheese ball", "frozen pizza", "fish finger", "frozen cutlet", "cutlet", "frozen burger", "burger patty", "veg patty", "chicken popcorn", "chicken strips", "chicken fingers", "falafel", "frozen paratha", "ready to cook", "ready to fry", "frozen ready", "dim sum", "frozen momo", "frozen dumpling", "frozen meal", "frozen entree", "tv dinner", "frozen lasagne", "gyoza", "wonton"], {
    note: "Keep continuously frozen; cook thoroughly from frozen following the pack instructions.",
  }),
] as const;

/* ------------------------------------------------------------------ */
/* Normalisation                                                        */
/* ------------------------------------------------------------------ */

const MAX_NAME_CHARS = 200;
const MAX_TOKENS = 40;

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  tmt: "tomato",
  tomatos: "tomato",
  chkn: "chicken",
  chk: "chicken",
  ckn: "chicken",
  bnls: "boneless",
  bnl: "boneless",
  sknls: "skinless",
  brst: "breast",
  thgh: "thigh",
  mlk: "milk",
  btr: "butter",
  bttr: "butter",
  chs: "cheese",
  chse: "cheese",
  chdr: "cheddar",
  mozz: "mozzarella",
  parm: "parmesan",
  yog: "yogurt",
  ygrt: "yogurt",
  yghrt: "yogurt",
  yogrt: "yogurt",
  brd: "bread",
  bnna: "banana",
  bnn: "banana",
  bananna: "banana",
  strwbry: "strawberry",
  strwb: "strawberry",
  onn: "onion",
  ptato: "potato",
  potatoe: "potato",
  crt: "carrot",
  cucmbr: "cucumber",
  cuc: "cucumber",
  grn: "green",
  chli: "chilli",
  chilly: "chilli",
  chillies: "chilli",
  veg: "vegetable",
  vegs: "vegetable",
  vegetables: "vegetable",
  frz: "frozen",
  frzn: "frozen",
  froz: "frozen",
  fzn: "frozen",
  org: "organic",
  orgn: "organic",
  orgnc: "organic",
  wh: "whole",
  whl: "whole",
  swt: "sweet",
  pnut: "peanut",
  oj: "orange juice",
  grd: "ground",
  prk: "pork",
  slmn: "salmon",
  spnch: "spinach",
  appl: "apple",
  orng: "orange",
  lmn: "lemon",
  avo: "avocado",
  avcdo: "avocado",
  brocc: "broccoli",
  caulifl: "cauliflower",
  cabg: "cabbage",
  mshrm: "mushroom",
  mushrm: "mushroom",
  ckies: "cookies",
  cke: "cake",
  bsc: "biscuit",
  biscut: "biscuit",
  pnr: "paneer",
  paner: "paneer",
  panir: "paneer",
  dhai: "dahi",
  lrg: "large",
  lg: "large",
  sm: "small",
  med: "medium",
  dz: "dozen",
  ww: "whole wheat",
  wholemeal: "whole wheat",
};

const FROZEN_TOKENS = new Set(["frozen", "freezer", "deepfrozen"]);
const OPENED_TOKENS = new Set(["opened", "leftover", "leftovers"]);

/**
 * Brand and packaging words that never affect shelf life. They are removed
 * entirely before matching (names AND synonyms go through the same filter).
 * Brands that imply a product (Cadbury, Maggi, Kurkure ...) are NOT here; they
 * are "open tail" synonyms of the relevant entry instead.
 */
const NOISE = new Set([
  "the", "of", "and", "with", "in", "for", "a", "an", "to", "by", "from", "pack", "packet", "pkt", "pouch", "bottle", "btl",
  "tin", "jar", "box", "tub", "tray", "carton", "tetra", "tetrapak", "combo", "offer", "new", "value", "each", "ea", "pc",
  "pcs", "unit", "nos", "no", "mrp", "rs", "inr", "approx", "net", "wt", "flavour", "flavor", "flavoured", "flavored",
  "style", "size", "qty", "quantity", "x", "ltr", "kg", "gm", "gms", "g", "ml", "l", "oz", "lb", "lbs", "gram", "grams",
  "litre", "liter", "litres", "liters", "gallon", "gal", "quart", "qt", "pint", "pt", "fl", "dozen", "doz", "ct", "count", "pieces", "piece", "ready", "special", "best",
  "taaza", "tazza", "shakti", "gold", "brand", "super", "ultra", "mega", "max", "plus", "fresho", "premium", "select",
  "selects", "choice", "classic", "signature", "everyday", "essential", "essentials", "daily", "farm", "homestyle",
  "amul", "nestle", "britannia", "parle", "haldiram", "haldirams", "aashirvaad", "tata", "sampann", "patanjali", "mdh",
  "everest", "catch", "mtr", "kissan", "heinz", "kellogg", "quaker", "nandini", "aavin", "heritage", "epigamia", "verka",
  "gowardhan", "sudha", "vijaya", "licious", "freshtohome", "suguna", "godrej", "bigbasket", "bb", "blinkit", "zepto",
  "instamart", "dmart", "tesco", "sainsburys", "sainsbury", "asda", "morrisons", "waitrose", "aldi", "lidl", "walmart",
  "kroger", "kirkland", "daawat", "kohinoor", "sundrop", "dhara", "gemini", "lipton", "cavin", "cavins", "yakult", "danone",
  "kraft", "philadelphia", "president", "lurpak", "anchor", "cravendale", "yeo", "arla", "weikfield", "funfoods", "borges",
  "mccain", "venky", "venkys", "keventers", "hershey", "hersheys", "slurrp", "cornitos", "pillsbury", "hellmann",
  "hellmanns", "nutralite", "dabur", "hamdard", "packaged", "packed", "sealed", "family", "party", "washed", "cleaned",
  "trimmed",
]);

/**
 * Descriptive words that may stay unexplained in front of OR behind the
 * matched product noun without lowering confidence ("Red Onion", "Rice
 * Basmati", "Whole Wheat Bread", "Banana Robusta"). They are kept in the token
 * stream (so synonyms such as "brown rice" can use them) but never block a match.
 */
const SOFT_TRAILING = new Set<string>([
  "fresh", "organic", "whole", "large", "small", "medium", "big", "mini", "jumbo", "local", "desi", "hybrid", "loose", "raw",
  "ripe", "regular", "plain", "original", "natural", "pure", "lite", "light", "fine", "extra", "sliced", "diced", "chopped",
  "grated", "peeled", "boneless", "skinless", "seedless", "red", "yellow", "white", "green", "brown", "black", "toned",
  "full", "double", "skimmed", "semi", "pasteurised", "pasteurized", "homogenised", "homogenized", "standardised",
  "standardized", "cut", "imported", "domestic", "sweet", "robusta", "nendran", "kashmiri", "alphonso", "kesar", "totapuri",
  "langra", "dasheri", "shimla", "fuji", "gala", "royal", "granny", "smith", "baby", "bunch", "halves", "half", "loaf",
  "slice", "fillet", "stick", "block", "wedge", "cube", "cooked", "frozen", "opened", "leaf", "green", "greens", "wheat", "multigrain",
  "seeded", "grain", "pro", "nature", "mixed", "dry", "dried", "instant", "ground", "powdered", "roasted", "salted",
  "unsalted", "sprouted", "split", "polished", "unpolished", "refined", "unrefined", "ordinary", "mature", "mild", "strong", "vintage", "fillet", "steak_cut",
]);

const IRREGULAR_SINGULAR: Readonly<Record<string, string>> = {
  leaves: "leaf",
  loaves: "loaf",
  halves: "half",
  knives: "knife",
  mangoes: "mango",
  tomatoes: "tomato",
  potatoes: "potato",
  avocados: "avocado",
  berries: "berry",
  cherries: "cherry",
  cookies: "cookie",
  brownies: "brownie",
  veggies: "veggie",
  smoothies: "smoothie",
  pastries: "pastry",
  chillies: "chilli",
  chilies: "chili",
  chilis: "chili",
  anchovies: "anchovy",
  pies: "pie",
  ties: "tie",
  cheeses: "cheese",
  hummus: "hummus",
  asparagus: "asparagus",
  couscous: "couscous",
  molasses: "molasses",
  swiss: "swiss",
  citrus: "citrus",
  lassi: "lassi",
  gas: "gas",
  bus: "bus",
  chips: "chip",
  oats: "oat",
  peas: "pea",
  beans: "bean",
  jeans: "jean",
  dates: "date",
  glass: "glass",
  grass: "grass",
  class: "class",
  guava: "guava",
  tikka: "tikka",
  pita: "pita",
  pasta: "pasta",
  pizza: "pizza",
  kheera: "kheera",
  tofu: "tofu",
};

export function singularizeToken(t: string): string {
  if (t.length <= 3) return t;
  if (Object.prototype.hasOwnProperty.call(IRREGULAR_SINGULAR, t)) return IRREGULAR_SINGULAR[t];
  if (t.endsWith("ies") && t.length > 4) return t.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("oes")) return t.slice(0, -2);
  if (t.endsWith("ss") || t.endsWith("us") || t.endsWith("is")) return t;
  if (t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/** Phrases removed before tokenising (multi-word brands and label claims). */
const PHRASE_REMOVALS: readonly RegExp[] = [
  /\bmother\s+dairy\b/g,
  /\bgood\s+day\b/g,
  /\bpaper\s+boat\b/g,
  /\breal\s+good\b/g,
  /\bindia\s+gate\b/g,
  /\bbrooke\s+bond\b/g,
  /\btasty\s+treat\b/g,
  /\bgreat\s+value\b/g,
  /\buncle\s+chipps\b/g,
  /\bmilky\s+mist\b/g,
  /\borganic\s+valley\b/g,
  /\bbb\s+royal\b/g,
  /\bfull\s+cream\b/g,
  /\bfull\s+fat\b/g,
  /\bdouble\s+toned\b/g,
  /\bsemi\s+skimmed\b/g,
  /\blow\s+fat\b/g,
  /\breduced\s+fat\b/g,
  /\bfat\s+free\b/g,
  /\bsugar\s*free\b/g,
  /\bno\s+added\s+sugar\b/g,
  /\bgluten\s*free\b/g,
  /\blactose\s*free\b/g,
  /\bready\s+to\s+(?:eat|cook|drink)\b/g,
  /\b(?:best|use)\s+before\b/g,
];

const SIZE_REGEXES: readonly RegExp[] = [
  /\b\d+(?:\.\d+)?\s*(?:kgs?|gms?|grams?|mg|ml|ltrs?|litres?|liters?|oz|lbs?|pcs?|pieces?|packs?|ct|count|dozen|doz|nos|units?|pk|g|l)\b/g,
  /\b\d+(?:\.\d+)?\s*%/g,
  /\b(?:x|qty)\s*\d+\b/g,
  /\b\d+\s*x\b/g,
];

/** Combining diacritical marks U+0300..U+036F, built from code points to keep the source pure ASCII. */
const COMBINING_MARKS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

function foldAscii(s: string): string {
  return s.normalize("NFKD").replace(COMBINING_MARKS, "");
}

export interface NormalizedName {
  tokens: string[];
  frozen: boolean;
  openedHint: boolean;
}

export function normalizeFoodName(raw: unknown): NormalizedName {
  const empty: NormalizedName = { tokens: [], frozen: false, openedHint: false };
  if (typeof raw !== "string") return empty;
  let s = raw.length > MAX_NAME_CHARS ? raw.slice(0, MAX_NAME_CHARS) : raw;
  s = foldAscii(s).toLowerCase();
  s = s.replace(/&/g, " and ").replace(/['`]/g, "");
  for (const re of PHRASE_REMOVALS) s = s.replace(re, " ");
  for (const re of SIZE_REGEXES) s = s.replace(re, " ");
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\b\d+\b/g, " ");
  const rawTokens = s.split(" ").filter(Boolean).slice(0, MAX_TOKENS);
  let frozen = false;
  let openedHint = false;
  const out: string[] = [];
  for (const t0 of rawTokens) {
    let parts = [Object.prototype.hasOwnProperty.call(ABBREVIATIONS, t0) ? ABBREVIATIONS[t0] : t0];
    if (parts[0].includes(" ")) parts = parts[0].split(" ");
    for (const t of parts) {
      if (FROZEN_TOKENS.has(t)) {
        frozen = true;
        // keep the token: some entries ("frozen veg") list it as a synonym word
      }
      if (OPENED_TOKENS.has(t)) openedHint = true;
      out.push(singularizeToken(t));
    }
  }
  return { tokens: out, frozen, openedHint };
}

/* ------------------------------------------------------------------ */
/* Matching index                                                       */
/* ------------------------------------------------------------------ */

interface IndexedSynonym {
  entryIndex: number;
  tokens: string[];
  /** Brand-style synonym ("+cadbury"): words after it are accepted (flavour names). */
  openTail: boolean;
}

const NOISE_SINGULAR = new Set(Array.from(NOISE).map(singularizeToken));
const SOFT_TRAILING_SINGULAR = new Set(Array.from(SOFT_TRAILING).map(singularizeToken));

/**
 * Tokens that are removed from a name before matching. Frozen/cooked markers
 * are kept (synonyms may use them) but noise/brand words are dropped.
 */
function stripNoise(tokens: string[]): string[] {
  return tokens.filter((t) => !NOISE_SINGULAR.has(t));
}

function normalizeSynonym(syn: string): string[] {
  const n = normalizeFoodName(syn).tokens;
  // Synonyms are authored as full words; drop only the same noise as names,
  // but never reduce a synonym to nothing.
  const stripped = stripNoise(n);
  return stripped.length > 0 ? stripped : n;
}

const INDEX: Map<string, IndexedSynonym[]> = new Map();
const ENTRY_BY_KEY: Map<string, ShelfLifeEntry> = new Map();
const ENTRY_ORDER: Map<string, number> = new Map();

(function buildIndex() {
  SHELF_LIFE_TABLE.forEach((entry, entryIndex) => {
    ENTRY_BY_KEY.set(entry.key, entry);
    ENTRY_ORDER.set(entry.key, entryIndex);
    const seen = new Set<string>();
    const syns = [entry.key.replace(/_/g, " "), ...entry.synonyms];
    for (const rawSyn of syns) {
      const openTail = rawSyn.startsWith("+");
      const syn = openTail ? rawSyn.slice(1) : rawSyn;
      const toks = normalizeSynonym(syn);
      if (toks.length === 0) continue;
      const sig = toks.join(" ") + (openTail ? "+" : "");
      if (seen.has(sig)) continue;
      seen.add(sig);
      const first = toks[0];
      const bucket = INDEX.get(first);
      const rec: IndexedSynonym = { entryIndex, tokens: toks, openTail };
      if (bucket) bucket.push(rec);
      else INDEX.set(first, [rec]);
    }
  });
})();

interface Candidate {
  entryIndex: number;
  start: number;
  end: number; // exclusive
  openTail: boolean;
}

function findCandidates(tokens: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const bucket = INDEX.get(tokens[i]);
    if (!bucket) continue;
    for (const rec of bucket) {
      const len = rec.tokens.length;
      if (i + len > tokens.length) continue;
      let ok = true;
      for (let k = 1; k < len; k++) {
        if (tokens[i + k] !== rec.tokens[k]) {
          ok = false;
          break;
        }
      }
      if (ok) out.push({ entryIndex: rec.entryIndex, start: i, end: i + len, openTail: rec.openTail });
    }
  }
  return out;
}

const CONF_RANK: Record<ShelfLifeConfidence, number> = { low: 0, medium: 1, high: 2 };
const CONF_BY_RANK: ShelfLifeConfidence[] = ["low", "medium", "high"];

function downgrade(c: ShelfLifeConfidence): ShelfLifeConfidence {
  return CONF_BY_RANK[Math.max(0, CONF_RANK[c] - 1)];
}

/** Words whose presence means the item is not a plain food (checked by isFoodItem). */
const NON_FOOD_PHRASES: readonly string[] = [
  "carry bag", "carrybag", "plastic bag", "paper bag", "shopping bag", "reusable bag", "grocery bag", "garbage bag",
  "trash bag", "bin bag", "bin liner", "delivery fee", "delivery charge", "handling fee", "handling charge",
  "packaging fee", "packaging charge", "packing charge", "platform fee", "convenience fee", "service charge",
  "service fee", "surge fee", "small cart fee", "rain fee", "donation", "bottle deposit", "carrier bag",
  "gift card", "gift wrap", "toilet paper", "toilet roll", "paper towel", "kitchen roll", "kitchen towel",
  "face cream", "hand cream", "body lotion", "shaving cream", "shaving foam", "sun cream", "sunscreen", "face wash",
  "hair oil", "baby oil", "body oil", "engine oil", "baby powder", "talcum powder", "washing powder", "detergent powder",
  "baby wipes", "wet wipes", "cling film", "aluminium foil", "aluminum foil", "tin foil", "dish wash", "dishwash",
  "dish soap", "hand wash", "hand soap", "body wash", "pet food", "dog food", "cat food", "bird seed", "cat litter",
  "air freshener", "room freshener", "mosquito repellent", "light bulb", "ice pack", "sanitary pad", "sanitary napkin",
  "tooth paste", "tooth brush", "mouth wash", "nail polish", "lip balm", "lip stick", "hair color", "hair colour",
  "fabric softener", "floor cleaner", "toilet cleaner", "glass cleaner", "surface cleaner", "bathroom cleaner",
  "dog treat", "cat treat", "pet treat", "baking tray", "food container", "lunch box", "water bottle empty",
];
/** Tokens that are non-food on their own, regardless of other words. */
const NON_FOOD_STRONG = new Set([
  "detergent", "soap", "shampoo", "conditioner", "tissue", "napkin", "toothpaste", "toothbrush", "deodorant", "perfume",
  "razor", "diaper", "nappy", "bleach", "disinfectant", "sanitizer", "sanitiser", "cleaner", "dettol", "lizol", "harpic",
  "battery", "bulb", "matchbox", "lighter", "broom", "mop", "scrubber", "lotion", "moisturiser", "moisturizer", "facewash",
  "handwash", "mouthwash", "floss", "earbud", "bandage", "plaster", "medicine", "charger", "cable", "notebook", "stapler",
  "envelope", "lottery", "newspaper", "magazine", "fee", "surcharge", "levy", "postage", "shipping", "parcel", "voucher",
  "tampon", "condom", "kleenex", "freshener", "repellent", "insecticide", "mortein", "garbage", "trash", "dishwash",
  "dishwashing", "toiletry", "detol", "domex", "colin",
]);
/** Tokens that are only non-food when nothing in the name looks like food. */
const NON_FOOD_WEAK = new Set([
  "bag", "sponge", "wipe", "pad", "cotton", "candle", "gift", "cutlery", "spoon", "fork", "plate", "straw", "toothpick",
  "tablet", "capsule", "supplement", "vitamin", "polish", "pen", "pencil", "stamp", "foil", "liner", "bin", "tide", "ariel",
  "surf", "rin", "vim", "deposit", "toy", "match", "cup", "glass", "bowl", "container", "lid", "wrapper", "sticker",
]);

/** Phrases that look non-food by token but are food. Removed before the non-food token check. */
const FOOD_PHRASE_EXCEPTIONS: readonly string[] = [
  "tea bag", "teabag", "bag of", "bagged salad", "salad bag", "bag salad", "rice bag", "cotton candy", "cottonseed oil",
  "baking soda", "maple syrup", "golden syrup", "rose syrup", "sugar syrup", "protein bar", "vitamin water", "paper boat",
  "cup noodle", "soup cup", "fruit cup", "curd cup", "yogurt cup", "cup cake", "cup a soup", "bag of chips", "ice cream cup",
  "wheel of cheese", "surf clam",
];

const normPhrase = (p: string): string => p.split(" ").map(singularizeToken).join(" ");
const NON_FOOD_PHRASES_N: string[] = NON_FOOD_PHRASES.map(normPhrase);
const FOOD_PHRASE_EXCEPTIONS_N: string[] = FOOD_PHRASE_EXCEPTIONS.map(normPhrase);

function containsPhrase(joined: string, phrase: string): boolean {
  return (" " + joined + " ").includes(" " + phrase + " ");
}

/**
 * Classify a line-item name.
 * "non_food" is returned only on positive evidence (detergent, fees, bags ...).
 * "unknown" means neither the food table nor the non-food lists recognised it.
 */
export function classifyFoodItem(name: unknown): "food" | "non_food" | "unknown" {
  if (typeof name !== "string") return "unknown";
  const text = foldAscii(name.slice(0, MAX_NAME_CHARS))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!text) return "unknown";
  let probe = " " + text.split(" ").map(singularizeToken).join(" ") + " ";
  for (const ex of FOOD_PHRASE_EXCEPTIONS_N) {
    probe = probe.split(" " + ex + " ").join(" ");
  }
  probe = probe.trim();
  for (const ph of NON_FOOD_PHRASES_N) {
    if (containsPhrase(probe, ph)) return "non_food";
  }
  const toks = probe.split(" ").filter(Boolean);
  for (const t of toks) {
    if (NON_FOOD_STRONG.has(t)) return "non_food";
  }
  const hasWeak = toks.some((t) => NON_FOOD_WEAK.has(t));
  const match = matchFood(name);
  if (match) return "food";
  return hasWeak ? "non_food" : "unknown";
}

/** True unless the name is positively recognised as a non-food item. */
export function isFoodItem(name: unknown): boolean {
  return classifyFoodItem(name) !== "non_food";
}

interface FoodMatch {
  entry: ShelfLifeEntry;
  score: number;
  confidence: ShelfLifeConfidence;
  frozen: boolean;
  openedHint: boolean;
  cookedMarker: boolean;
  tokens: string[];
  variantKey: string | null;
}

const GENERAL_COOKED_MARKERS = new Set(["cooked", "leftover", "leftovers", "grilled", "roasted", "fried", "steamed", "tandoori", "roast"]);

function matchFood(name: unknown): FoodMatch | null {
  const norm = normalizeFoodName(name);
  if (norm.tokens.length === 0) return null;
  // Keep cooking-method words before noise stripping so they can be seen.
  const allTokens = norm.tokens;
  const tokens = stripNoise(allTokens);
  if (tokens.length === 0) return null;
  const candidates = findCandidates(tokens);
  if (candidates.length === 0) return null;
  // Head-final rule: the product noun is the right-most matched span; for the
  // same end position the longest span wins ("peanut butter" beats "butter");
  // ties break on table order for determinism.
  candidates.sort(
    (a, b) => b.end - a.end || (b.end - b.start) - (a.end - a.start) || a.entryIndex - b.entryIndex,
  );
  const best = candidates[0];
  // Anything after the matched span must be a harmless variety word. Otherwise
  // the span is only a modifier ("apple pie", "butter scotch").
  if (!best.openTail) {
    for (let i = best.end; i < tokens.length; i++) {
      if (!SOFT_TRAILING_SINGULAR.has(tokens[i])) return null;
    }
  }
  // Unexplained words before the span lower the score.
  const covered = new Array<boolean>(tokens.length).fill(false);
  for (const c of candidates) for (let i = c.start; i < c.end; i++) covered[i] = true;
  let unknownLeading = 0;
  for (let i = 0; i < best.start; i++) {
    if (!covered[i] && !SOFT_TRAILING_SINGULAR.has(tokens[i])) unknownLeading++;
  }
  if (unknownLeading >= 4) return null;
  const score = Math.max(0, 1 - 0.15 * unknownLeading);
  if (score < 0.5) return null;
  let entry = SHELF_LIFE_TABLE[best.entryIndex];
  let confidence: ShelfLifeConfidence = entry.confidence;
  if (unknownLeading >= 2) confidence = downgrade(confidence);
  // A very short fragment (<3 letters in the matched span) is never trusted.
  const matchedText = tokens.slice(best.start, best.end).join("");
  if (matchedText.length < 3) return null;

  // Cooked variant handling.
  let variantKey: string | null = null;
  let cookedMarker = false;
  if (entry.cookedVariant) {
    const markers = new Set(entry.cookedVariant.markers ?? Array.from(GENERAL_COOKED_MARKERS));
    cookedMarker = allTokens.some((t) => markers.has(t));
    if (cookedMarker) {
      const variant = ENTRY_BY_KEY.get(entry.cookedVariant.key);
      if (variant) {
        variantKey = variant.key;
        entry = variant;
        confidence = CONF_RANK[confidence] < CONF_RANK[variant.confidence] ? confidence : variant.confidence;
      }
    }
  }
  return {
    entry,
    score,
    confidence,
    frozen: norm.frozen,
    openedHint: norm.openedHint,
    cookedMarker,
    tokens,
    variantKey,
  };
}

/* ------------------------------------------------------------------ */
/* Estimation                                                           */
/* ------------------------------------------------------------------ */

const LOCS: ShelfLifeLocation[] = ["fridge", "pantry", "freezer"];

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** YYYY-MM-DD for the UTC calendar date of `now` plus `days`. */
export function addDaysIso(now: Date, days: number): string {
  const base = Number.isFinite(now.getTime()) ? now : new Date(0);
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + Math.trunc(days)));
  return `${d.getUTCFullYear().toString().padStart(4, "0")}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function validNow(now: Date | undefined): Date {
  if (now instanceof Date && Number.isFinite(now.getTime())) return now;
  return new Date();
}

function effectiveTable(entry: ShelfLifeEntry, opened: boolean): ShelfLifeDays {
  return opened && entry.openedDays ? { ...entry.days, ...entry.openedDays } : { ...entry.days };
}

export function estimateShelfLife(name: string, options: ShelfLifeOptions = {}): ShelfLifeEstimate | null {
  const minConf = options.minConfidence ?? "low";
  if (classifyFoodItem(name) === "non_food") return null;
  const m = matchFood(name);
  if (!m) return null;
  if (CONF_RANK[m.confidence] < CONF_RANK[minConf]) return null;

  const entry = m.entry;
  const opened = options.opened === true || (options.opened === undefined && m.openedHint && !m.cookedMarker);
  const table = effectiveTable(entry, opened);
  const notes: string[] = ["Estimate only: a date printed on the pack always wins. Look and smell are not a reliable safety test because harmful bacteria can be present without any change, so when in doubt throw it out."];
  let fallback = false;

  // Choose location.
  let loc: ShelfLifeLocation;
  const requested = options.location;
  if (requested && LOCS.includes(requested)) {
    loc = requested;
  } else if (m.frozen && table.freezer !== undefined && table.freezer > 0) {
    loc = "freezer";
  } else if (table[entry.defaultLocation] !== undefined && (table[entry.defaultLocation] as number) > 0) {
    loc = entry.defaultLocation;
  } else {
    loc = LOCS.find((l) => (table[l] ?? 0) > 0) ?? entry.defaultLocation;
  }

  let days = table[loc];
  if (days === undefined) {
    // No figure for the requested location.
    if (loc === "pantry" && (entry.defaultLocation === "fridge" || entry.defaultLocation === "freezer")) {
      days = 0;
    } else {
      const alt = (table[entry.defaultLocation] ?? 0) > 0 ? entry.defaultLocation : LOCS.find((l) => (table[l] ?? 0) > 0);
      if (alt) {
        notes.push(`No dependable figure for ${loc} storage; showing the ${alt} estimate instead.`);
        loc = alt;
        days = table[alt] as number;
        fallback = true;
      } else {
        days = 0;
      }
    }
  }
  if (days === 0) {
    notes.push(
      loc === "pantry"
        ? "Not suitable for storage at room temperature: refrigerate or freeze, or use today."
        : loc === "fridge"
          ? "Not recommended for the fridge in this form; use soon."
          : "Not recommended for freezing; quality suffers badly.",
    );
  }
  if (entry.note) notes.push(entry.note);
  if (loc === "freezer" && days > 0) {
    notes.push("Freezer figure is for quality; food kept continuously at -18 C stays safe. Do not refreeze after thawing.");
  }
  if (opened && entry.openedDays) notes.push("Figure is for an opened or cut pack.");
  if (m.frozen && loc !== "freezer" && !fallback) {
    notes.push("Item looks frozen but a non-freezer location was requested.");
  }

  const confidence = fallback || days === 0 ? downgrade(m.confidence) : m.confidence;
  const now = validNow(options.now);
  return {
    days,
    expiryDate: addDaysIso(now, days),
    location: loc,
    category: entry.category,
    matchedKey: entry.key,
    confidence,
    matchScore: Math.round(m.score * 100) / 100,
    locationFallback: fallback,
    isEstimate: true,
    note: notes.join(" "),
  };
}

/** Look up a table entry by canonical key (for UIs and tests). */
export function getShelfLifeEntry(key: string): ShelfLifeEntry | undefined {
  return ENTRY_BY_KEY.get(key);
}

/** Names the table index knows (canonical keys), in table order. */
export function listShelfLifeKeys(): string[] {
  return SHELF_LIFE_TABLE.map((e) => e.key);
}
