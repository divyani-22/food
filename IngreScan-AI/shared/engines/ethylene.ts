/**
 * Ethylene companion-storage engine (pure, deterministic, no I/O).
 *
 * Ratings follow the ethylene production / sensitivity classes published by
 * UC Davis Postharvest Technology (Kader, "Postharvest Technology of
 * Horticultural Crops"). Production classes are mapped as:
 *   very low (<0.1 uL/kg/h) -> "none", low -> "low", moderate -> "moderate",
 *   high and very high -> "high".
 * Sensitivity ratings summarise the typical documented damage. Where the
 * evidence is mixed (potatoes) no alert is ever raised.
 *
 * No numeric "x% faster" claims are made: there is no reliable general figure.
 */

export type EthyleneLevel = "none" | "low" | "moderate" | "high";
export type EthyleneSeverity = "info" | "warning";
export type EthyleneAlertKind = "damage" | "ripening";
export type StorageSpace = "fridge" | "freezer" | "pantry";

export interface EthyleneProfile {
  /** Canonical key, e.g. "bell_pepper". */
  key: string;
  displayName: string;
  production: EthyleneLevel;
  sensitivity: EthyleneLevel;
  /** Climacteric fruit: produces much more ethylene as it ripens. */
  ripeningDependent: boolean;
  /** Fruit that ripens/softens in response to ethylene (alerts become "ripening" kind). */
  ripensWithEthylene: boolean;
  /** Typical damage when exposed (empty when sensitivity is none/low and unremarkable). */
  damage: string;
  /** True when evidence on ethylene effects is mixed; such items never raise alerts. */
  mixedEvidence: boolean;
  note: string;
  source: string;
}

export interface EthyleneItemInput {
  name: string;
  storageLocation?: StorageSpace | string | null;
  daysLeft?: number | null;
}

export interface EthyleneAlert {
  id: string;
  severity: EthyleneSeverity;
  kind: EthyleneAlertKind;
  storageLocation: StorageSpace;
  producer: { key: string; name: string };
  sensitive: { key: string; name: string };
  title: string;
  advice: string;
  damage: string;
  source: string;
}

const SOURCE = "UC Davis Postharvest Technology";

type Def = {
  key: string;
  name: string;
  p: EthyleneLevel;
  s: EthyleneLevel;
  ripeDep?: boolean;
  ripens?: boolean;
  damage?: string;
  mixed?: boolean;
  note?: string;
  syn: string[];
};

const DEFS: Def[] = [
  // --- FreshGuard classes ---
  { key: "apple", name: "Apple", p: "high", s: "moderate", damage: "loss of firmness and mealy texture", note: "Apples are strong ethylene producers.", syn: ["apple", "seb"] },
  { key: "banana", name: "Banana", p: "moderate", s: "high", ripeDep: true, ripens: true, damage: "faster ripening, browning and softening", note: "Output rises sharply as bananas ripen.", syn: ["banana", "plantain", "kela"] },
  { key: "bell_pepper", name: "Bell pepper", p: "none", s: "moderate", damage: "faster colour change, softening and calyx (stem end) deterioration", syn: ["bell pepper", "capsicum", "sweet pepper", "green pepper", "red pepper", "yellow pepper", "shimla mirch", "paprika pepper"] },
  { key: "carrot", name: "Carrot", p: "none", s: "moderate", damage: "bitter taste (isocoumarin build-up)", syn: ["carrot", "gajar"] },
  { key: "cucumber", name: "Cucumber", p: "low", s: "high", damage: "yellowing of the green skin and faster decay", syn: ["cucumber", "kheera", "khira", "gherkin"] },
  { key: "mango", name: "Mango", p: "moderate", s: "high", ripeDep: true, ripens: true, damage: "faster ripening and softening", note: "Output rises as mangoes ripen.", syn: ["mango", "aam"] },
  { key: "orange", name: "Orange", p: "none", s: "low", damage: "", note: "Citrus fruit is non-climacteric with very low ethylene output.", syn: ["orange", "mandarin", "tangerine", "clementine", "satsuma", "santra", "mosambi", "sweet lime"] },
  { key: "potato", name: "Potato", p: "none", s: "low", mixed: true, damage: "", note: "Ethylene effects on potatoes are mixed (can suppress sprouting but may affect quality), so no alert is raised.", syn: ["potato", "aloo", "batata"] },
  { key: "strawberry", name: "Strawberry", p: "none", s: "low", damage: "", note: "Non-climacteric; not meaningfully affected by ethylene.", syn: ["strawberry"] },
  { key: "tomato", name: "Tomato", p: "moderate", s: "moderate", ripeDep: true, ripens: true, damage: "faster ripening and softening", note: "Output rises as tomatoes ripen.", syn: ["tomato", "tamatar"] },
  // --- Strong producers (ripening fruit) ---
  { key: "avocado", name: "Avocado", p: "high", s: "high", ripeDep: true, ripens: true, damage: "faster ripening, then over-softening", note: "Output is highest when ripe.", syn: ["avocado"] },
  { key: "pear", name: "Pear", p: "high", s: "high", ripeDep: true, ripens: true, damage: "faster ripening, then mealy or soft flesh", syn: ["pear", "nashpati"] },
  { key: "peach", name: "Peach", p: "high", s: "high", ripeDep: true, ripens: true, damage: "faster softening", syn: ["peach", "nectarine", "aadu"] },
  { key: "plum", name: "Plum", p: "high", s: "high", ripeDep: true, ripens: true, damage: "faster softening", syn: ["plum", "aloo bukhara", "apricot", "prune plum"] },
  { key: "kiwi", name: "Kiwi", p: "high", s: "high", ripeDep: true, ripens: true, damage: "rapid softening", syn: ["kiwi", "kiwifruit", "kiwi fruit", "chinese gooseberry"] },
  { key: "melon", name: "Melon (cantaloupe, muskmelon)", p: "high", s: "moderate", ripeDep: true, damage: "faster softening", syn: ["melon", "cantaloupe", "muskmelon", "honeydew", "kharbuja", "rockmelon"] },
  { key: "papaya", name: "Papaya", p: "high", s: "high", ripeDep: true, ripens: true, damage: "faster ripening and softening", syn: ["papaya", "papita"] },
  // --- Sensitive vegetables ---
  { key: "spinach", name: "Spinach", p: "none", s: "high", damage: "yellowing leaves and faster wilting", syn: ["spinach", "palak", "baby spinach"] },
  { key: "kale", name: "Kale", p: "none", s: "high", damage: "yellowing and wilting", syn: ["kale", "collard", "collard greens", "chard", "swiss chard", "silverbeet", "mustard greens", "sarson"] },
  { key: "lettuce", name: "Lettuce", p: "none", s: "high", damage: "russet spotting (brown spots) and yellowing", syn: ["lettuce", "romaine", "iceberg", "salad leaves", "mixed greens", "rocket", "arugula", "salad greens"] },
  { key: "broccoli", name: "Broccoli", p: "none", s: "high", damage: "yellowing of florets", syn: ["broccoli"] },
  { key: "cauliflower", name: "Cauliflower", p: "none", s: "moderate", damage: "yellowing and loss of leaves", syn: ["cauliflower", "gobi", "phool gobi"] },
  { key: "cabbage", name: "Cabbage", p: "none", s: "high", damage: "yellowing and loss of outer leaves", syn: ["cabbage", "patta gobi", "bok choy", "pak choi", "napa cabbage", "chinese cabbage"] },
  { key: "brussels_sprout", name: "Brussels sprouts", p: "none", s: "high", damage: "yellowing", syn: ["brussels sprout", "brussel sprout"] },
  { key: "herbs", name: "Leafy herbs (parsley, cilantro)", p: "none", s: "high", damage: "yellowing and wilting", syn: ["parsley", "cilantro", "coriander leaves", "fresh coriander", "dhania", "dill", "mint", "pudina"] },
  { key: "asparagus", name: "Asparagus", p: "none", s: "high", damage: "toughening (woody texture)", syn: ["asparagus"] },
  { key: "green_bean", name: "Green beans", p: "none", s: "moderate", damage: "yellowing and faster decay", syn: ["green bean", "string bean", "french bean", "snake bean"] },
  { key: "zucchini", name: "Zucchini / summer squash", p: "none", s: "moderate", damage: "yellowing and faster decay", syn: ["zucchini", "courgette", "summer squash", "tinda"] },
  { key: "eggplant", name: "Eggplant", p: "none", s: "moderate", damage: "browning and calyx deterioration", syn: ["eggplant", "aubergine", "brinjal", "baingan"] },
  { key: "watermelon", name: "Watermelon", p: "low", s: "moderate", damage: "loss of firmness and off-flavour", syn: ["watermelon", "tarbooz"] },
  { key: "lemon_lime", name: "Lemon / lime", p: "none", s: "moderate", damage: "yellowing of green limes and faster decay", syn: ["lemon", "lime", "nimbu", "key lime"] },
  // --- Low / no concern ---
  { key: "grape", name: "Grapes", p: "none", s: "low", damage: "", syn: ["grape", "angoor"] },
  { key: "berry", name: "Berries (blueberry, raspberry, blackberry)", p: "low", s: "low", damage: "", syn: ["blueberry", "raspberry", "blackberry", "cranberry", "berries", "mixed berries"] },
  { key: "onion", name: "Onion", p: "none", s: "low", damage: "", note: "Dry onions are only weakly affected.", syn: ["onion", "pyaz", "shallot", "red onion"] },
  { key: "garlic", name: "Garlic", p: "none", s: "low", damage: "", syn: ["garlic", "lehsun"] },
  { key: "sweet_potato", name: "Sweet potato", p: "none", s: "low", damage: "", syn: ["sweet potato", "yam", "shakarkandi"] },
  { key: "celery", name: "Celery", p: "none", s: "low", damage: "", syn: ["celery"] },
  { key: "mushroom", name: "Mushroom", p: "none", s: "low", damage: "", syn: ["mushroom"] },
  { key: "pumpkin", name: "Pumpkin / winter squash", p: "low", s: "low", damage: "", syn: ["pumpkin", "butternut squash", "winter squash", "kaddu"] },
  { key: "pineapple", name: "Pineapple", p: "low", s: "low", damage: "", syn: ["pineapple", "ananas"] },
];

const LEVEL: Record<EthyleneLevel, number> = { none: 0, low: 1, moderate: 2, high: 3 };

export const ETHYLENE_TABLE: ReadonlyArray<EthyleneProfile> = DEFS.map((d) => ({
  key: d.key,
  displayName: d.name,
  production: d.p,
  sensitivity: d.s,
  ripeningDependent: !!d.ripeDep,
  ripensWithEthylene: !!d.ripens,
  damage: d.damage ?? "",
  mixedEvidence: !!d.mixed,
  note: d.note ?? "",
  source: SOURCE,
}));

// ---------------------------------------------------------------------------
// Name normalisation and lookup (Map-based: immune to "__proto__" style keys)
// ---------------------------------------------------------------------------

const MAX_NAME = 120;

/** Lowercase, strip accents, keep ASCII letters and spaces only. */
function norm(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .slice(0, MAX_NAME * 2)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function singular(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter(Boolean)
    .slice(0, 24)
    .map(singular);
}

const BY_KEY = new Map<string, EthyleneProfile>();
for (const p of ETHYLENE_TABLE) BY_KEY.set(p.key, p);

// phrase (singularised tokens joined) -> key
const PHRASES = new Map<string, string>();
const MAX_PHRASE_LEN = 4;
for (const d of DEFS) {
  for (const syn of d.syn) {
    const t = tokens(syn).join(" ");
    if (t && !PHRASES.has(t)) PHRASES.set(t, d.key);
  }
}
const SINGLE_WORDS = Array.from(PHRASES.keys()).filter((k) => !k.includes(" "));

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (la === lb) {
      i++;
      j++;
    } else if (la > lb) i++;
    else j++;
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Processed forms do not behave like fresh produce. */
const PROCESSED = new Set([
  "juice", "sauce", "jam", "puree", "powder", "dried", "dry", "canned", "tinned", "frozen", "chip",
  "pickle", "pickled", "ketchup", "paste", "cake", "pie", "oil", "vinegar", "flavour", "flavor", "flavoured",
  "flavored", "syrup", "jelly", "yogurt", "yoghurt", "smoothie", "soup", "cereal", "bar", "candy",
  // baked goods, confectionery, drinks and spices that merely name a fruit/herb ("banana bread", "mint tea",
  // "red pepper flakes"). "cooky" is what singular() makes of "cookies".
  "bread", "muffin", "cookie", "cooky", "biscuit", "chocolate", "tea", "cream", "flake", "extract", "essence", "toothpaste",
]);

/** Resolve a free-text grocery name to a canonical key, or null. */
export function canonicalProduceKey(name: string): string | null {
  const toks = tokens(name);
  if (toks.length === 0) return null;
  if (toks.some((t) => PROCESSED.has(t))) return null;
  const whole = toks.join(" ");
  const direct = PHRASES.get(whole);
  if (direct) return direct;
  // longest contiguous phrase contained in the name
  for (let len = Math.min(MAX_PHRASE_LEN, toks.length); len >= 1; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const hit = PHRASES.get(toks.slice(i, i + len).join(" "));
      if (hit) return hit;
    }
  }
  // typo tolerance: single-word names of 5+ letters, unique best match. Never for multi-word names:
  // "free range eggs" must not become orange, "grade A eggs" grape, "beach towel" peach.
  if (toks.length === 1) {
    const found = new Set<string>();
    for (const t of toks) {
      if (t.length < 5) continue;
      for (const w of SINGLE_WORDS) {
        if (w.length >= 5 && editDistanceAtMostOne(t, w)) {
          const k = PHRASES.get(w);
          if (k) found.add(k);
        }
      }
    }
    if (found.size === 1) return Array.from(found)[0];
  }
  return null;
}

/** Ethylene profile for UI badges; null when the item is not in the table. */
export function ethyleneProfile(name: string): EthyleneProfile | null {
  const key = canonicalProduceKey(name);
  return key ? (BY_KEY.get(key) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Pair analysis
// ---------------------------------------------------------------------------

function space(loc: unknown): StorageSpace {
  return loc === "pantry" || loc === "freezer" || loc === "fridge" ? loc : "fridge";
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function buildAlert(
  prod: EthyleneProfile,
  sens: EthyleneProfile,
  loc: StorageSpace,
  urgent: boolean,
): EthyleneAlert {
  const score = LEVEL[prod.production] + LEVEL[sens.sensitivity];
  const kind: EthyleneAlertKind = sens.ripensWithEthylene ? "ripening" : "damage";
  const severity: EthyleneSeverity = kind === "damage" && score >= 5 ? "warning" : "info";
  const ripeNote = prod.ripeningDependent ? " This is especially true once it is ripe." : "";
  const where = loc === "pantry" ? "on the counter or in the pantry" : "in the fridge";
  let advice: string;
  let title: string;
  if (kind === "ripening") {
    title = `${prod.displayName} may speed up ripening of ${lowerFirst(sens.displayName)}`;
    advice =
      loc === "fridge"
        ? `Cold slows ripening, but ${lowerFirst(prod.displayName)} still gives off ethylene.${ripeNote} ` +
          `If you want ${lowerFirst(sens.displayName)} to last, keep them in separate drawers or bags. ` +
          `If it is still hard and you want it to ripen, take both out and put them together in a closed paper bag at room temperature.`
        : `If you want ${lowerFirst(sens.displayName)} to ripen sooner, keep it with ${lowerFirst(prod.displayName)} in a closed paper bag.${ripeNote} ` +
          `If you want it to last, store them apart ${where}.`;
  } else {
    title = `Keep ${lowerFirst(prod.displayName)} away from ${lowerFirst(sens.displayName)}`;
    advice =
      `Store ${lowerFirst(prod.displayName)} and ${lowerFirst(sens.displayName)} apart: use a different drawer or shelf, ` +
      `or keep ${lowerFirst(prod.displayName)} in a sealed bag or container.${ripeNote}`;
  }
  if (urgent) advice += ` ${sens.displayName} is close to its date, so use it soon.`;
  const damage =
    kind === "ripening"
      ? `May cause ${sens.damage || "faster ripening"}.`
      : `May cause ${sens.damage}.`;
  return {
    id: `ethylene:${loc}:${prod.key}>${sens.key}`,
    severity,
    kind,
    storageLocation: loc,
    producer: { key: prod.key, name: prod.displayName },
    sensitive: { key: sens.key, name: sens.displayName },
    title,
    advice,
    damage,
    source: SOURCE,
  };
}

/**
 * Alerts for pairs stored in the same space (default fridge). Frozen items are
 * ignored. Potatoes never raise alerts (mixed evidence).
 */
export function analyzeEthyleneStorage(items: EthyleneItemInput[]): EthyleneAlert[] {
  if (!Array.isArray(items)) return [];
  const bySpace = new Map<StorageSpace, Map<string, { profile: EthyleneProfile; urgent: boolean }>>();
  for (const it of items.slice(0, 500)) {
    if (!it || typeof it !== "object") continue;
    const loc = space((it as EthyleneItemInput).storageLocation);
    if (loc === "freezer") continue;
    const profile = ethyleneProfile((it as EthyleneItemInput).name);
    if (!profile || profile.mixedEvidence) continue;
    const dl = (it as EthyleneItemInput).daysLeft;
    const urgent = typeof dl === "number" && Number.isFinite(dl) && dl >= 0 && dl <= 2;
    let m = bySpace.get(loc);
    if (!m) bySpace.set(loc, (m = new Map()));
    const prev = m.get(profile.key);
    m.set(profile.key, { profile, urgent: urgent || !!prev?.urgent });
  }

  const alerts = new Map<string, EthyleneAlert>();
  bySpace.forEach((m, loc) => {
    const entries = Array.from(m.values());
    for (const a of entries) {
      for (const b of entries) {
        if (a === b) continue;
        const prod = a.profile;
        const sens = b.profile;
        if (LEVEL[prod.production] < 2 || LEVEL[sens.sensitivity] < 2) continue;
        const kind = sens.ripensWithEthylene ? "ripening" : "damage";
        // mutual ripening pairs (e.g. banana + avocado) produce one alert
        if (kind === "ripening" && prod.ripensWithEthylene && LEVEL[sens.production] >= 2) {
          if (prod.key > sens.key) continue;
        }
        const alert = buildAlert(prod, sens, loc, b.urgent);
        alerts.set(alert.id, alert);
      }
    }
  });

  return Array.from(alerts.values()).sort((x, y) => {
    if (x.severity !== y.severity) return x.severity === "warning" ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}
