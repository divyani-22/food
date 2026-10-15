/**
 * Personal health interaction alerts (pure, deterministic, no LLM, no I/O).
 *
 * The engine only FLAGS concerns. It never states that a food is "safe" for a
 * condition: the absence of an alert means nothing was matched, not that the
 * product is suitable. Every alert carries a disclaimer.
 *
 * Nutrient inputs are grams per 100 g (or per 100 ml when isBeverage is true).
 * Cut-offs are the UK Food Standards Agency front-of-pack "high" thresholds
 * (strictly greater than): food - sugars 22.5, salt 1.5, saturates 5, fat 17.5;
 * drinks - sugars 11.25, salt 0.75, saturates 2.5, fat 8.75 (g/100 ml).
 */

export type HealthSeverity = "info" | "caution" | "warning";
export type HealthAppliesToKind = "condition" | "allergy" | "medication" | "diet";

export const HEALTH_DISCLAIMER =
  "This is general information based on ingredient and label matching, not medical advice. " +
  "It cannot see your full history, doses or product recipe changes. " +
  "Please check with your doctor, pharmacist or registered dietitian before changing your diet or medication. " +
  "Do not stop, skip or change a prescribed medicine because of this alert.";

export interface HealthAlert {
  id: string;
  severity: HealthSeverity;
  title: string;
  message: string;
  /** Matched ingredient(s), nutrient or allergen tag. */
  trigger: string;
  reason: string;
  source: string;
  /** Canonical condition / medication / diet label the alert relates to. */
  appliesTo: string;
  appliesToKind: HealthAppliesToKind;
  disclaimer: string;
}

export interface HealthIngredient {
  name: string;
  category?: string | null;
  riskLevel?: string | null;
}

export interface HealthNutriments {
  sugars?: number | null;
  salt?: number | null;
  sodium?: number | null;
  saturatedFat?: number | null;
  fat?: number | null;
  [k: string]: number | null | undefined;
}

export interface HealthMedicationInput {
  name: string;
  isCurrent?: boolean | null;
  dosage?: string | null;
}

export interface HealthInput {
  ingredients: Array<HealthIngredient | string>;
  nutriments?: HealthNutriments | null;
  isBeverage?: boolean;
  allergensTags?: string[] | null;
  profile?: { dietType?: string | null; [k: string]: unknown } | null;
  conditions?: string[] | null;
  medications?: HealthMedicationInput[] | null;
  dietType?: string | null;
}

export const FSA_THRESHOLDS = {
  food: { sugars: 22.5, salt: 1.5, saturates: 5, fat: 17.5 },
  drink: { sugars: 11.25, salt: 0.75, saturates: 2.5, fat: 8.75 },
} as const;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const MAX_TEXT = 200;
const MAX_ITEMS = 300;

export function normText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .slice(0, MAX_TEXT * 2)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

function singular(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

export function tokenize(s: unknown): string[] {
  return normText(s)
    .split(" ")
    .filter(Boolean)
    .slice(0, 40)
    .map(singular);
}

/** Printable ASCII only, trimmed and capped; safe to echo into output. */
export function asciiClean(s: unknown, max = 60): string {
  if (typeof s !== "string") return "";
  return s
    .slice(0, max * 4)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function codesOf(raw: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:e|ins)\s?-?\s?(\d{3,4})/g;
  const lower = raw.slice(0, MAX_TEXT * 2).toLowerCase();
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(lower)) && guard++ < 50) out.add(m[1]);
  return out;
}

interface Ing {
  raw: string;
  norm: string;
  toks: string[];
  codes: Set<string>;
}

function prepIngredient(x: unknown): Ing | null {
  const name = typeof x === "string" ? x : x && typeof x === "object" ? (x as HealthIngredient).name : "";
  if (typeof name !== "string" || !name.trim()) return null;
  const clipped = name.slice(0, MAX_TEXT);
  return { raw: asciiClean(clipped, 48) || "ingredient", norm: normText(clipped), toks: tokenize(clipped), codes: codesOf(clipped) };
}

interface Term {
  phrase: string[];
  code?: string;
  plain: string;
}

function compileTerm(t: string): Term {
  const c = /^(?:e|ins)(\d{3,4})$/.exec(t);
  if (c) return { phrase: [], code: c[1], plain: t };
  return { phrase: tokenize(t), plain: normText(t) };
}

export function hasPhraseTokens(toks: string[], phrase: string[]): boolean {
  return hasPhrase(toks, phrase);
}

function hasPhrase(toks: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || phrase.length > toks.length) return false;
  for (let i = 0; i + phrase.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (toks[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** "gluten free", "no added sugar", "without egg", "lactose-free" etc. */
function negated(ing: Ing, term: Term): boolean {
  if (!term.plain) return false;
  const n = ` ${ing.norm} `;
  const p = term.plain;
  if (n.includes(` ${p} free `) || n.includes(` ${p}free `) || n.includes(` free from ${p} `)) return true;
  if (n.includes(` no ${p} `) || n.includes(` no added ${p} `) || n.includes(` without ${p} `) || n.includes(` non ${p} `)) return true;
  if (p === "sugar" && (n.includes(" unsweetened ") || n.includes(" sugarfree "))) return true;
  return false;
}

function matches(ing: Ing, term: Term): boolean {
  if (term.code) return ing.codes.has(term.code) || ing.toks.includes(`e${term.code}`);
  if (!hasPhrase(ing.toks, term.phrase)) return false;
  return !negated(ing, term);
}

interface Group {
  terms: string[];
  sev: HealthSeverity;
  note?: string;
  /** Skip an ingredient when any of these tokens (singularised) are present anywhere. */
  unless?: string[];
  /** Skip a match when the token directly before it is one of these (e.g. "coconut" milk). */
  qual?: string[];
}

interface CompiledGroup extends Group {
  compiled: Term[];
  unlessSet: Set<string>;
  qualSet: Set<string>;
}

function compileGroups(gs: Group[]): CompiledGroup[] {
  return gs.map((g) => ({
    ...g,
    compiled: g.terms.map(compileTerm),
    unlessSet: new Set((g.unless ?? []).map((u) => singular(normText(u)))),
    qualSet: new Set((g.qual ?? []).map((u) => singular(normText(u)))),
  }));
}

function positions(toks: string[], phrase: string[]): number[] {
  const out: number[] = [];
  if (phrase.length === 0) return out;
  for (let i = 0; i + phrase.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (toks[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

function groupHit(ing: Ing, g: CompiledGroup): boolean {
  if (g.unlessSet.size > 0 && ing.toks.some((t) => g.unlessSet.has(t))) return false;
  for (const term of g.compiled) {
    if (term.code) {
      if (matches(ing, term)) return true;
      continue;
    }
    if (negated(ing, term)) continue;
    for (const pos of positions(ing.toks, term.phrase)) {
      if (g.qualSet.size > 0 && pos > 0 && g.qualSet.has(ing.toks[pos - 1])) continue;
      if (g.qualSet.size > 0 && pos > 1 && ing.toks[pos - 1] === "free" && (ing.toks[pos - 2] === "dairy" || ing.toks[pos - 2] === "milk")) continue;
      if (term.phrase.length === 1 && term.phrase[0] === "cream" && ing.toks[pos + 1] === "of" && ing.toks[pos + 2] === "tartar") continue;
      return true;
    }
  }
  return false;
}

const SEV_RANK: Record<HealthSeverity, number> = { info: 0, caution: 1, warning: 2 };

// ---------------------------------------------------------------------------
// Condition / medication detection
// ---------------------------------------------------------------------------

type CondKey =
  | "diabetes" | "prediabetes" | "hypertension" | "celiac" | "gluten_sens" | "wheat_allergy" | "lactose"
  | "dairy_allergy" | "peanut" | "tree_nut" | "soy" | "egg" | "shellfish" | "fish" | "pregnancy" | "ckd"
  | "cholesterol" | "gout" | "sesame";
type MedKey = "warfarin" | "statin_strong" | "statin_atorva" | "ccb_felodipine" | "raas" | "maoi" | "levothyroxine";
type DietKey = "vegan" | "veg";
type Key = CondKey | MedKey | DietKey;

const LABEL: Record<Key, string> = {
  diabetes: "diabetes",
  prediabetes: "prediabetes",
  hypertension: "high blood pressure",
  celiac: "celiac disease",
  gluten_sens: "gluten sensitivity",
  wheat_allergy: "wheat allergy",
  lactose: "lactose intolerance",
  dairy_allergy: "milk/dairy allergy",
  peanut: "peanut allergy",
  tree_nut: "tree nut allergy",
  soy: "soy allergy",
  egg: "egg allergy",
  shellfish: "shellfish allergy",
  fish: "fish allergy",
  pregnancy: "pregnancy",
  ckd: "chronic kidney disease",
  cholesterol: "high cholesterol / heart health",
  gout: "gout",
  sesame: "sesame allergy",
  ccb_felodipine: "felodipine/nifedipine",
  warfarin: "warfarin-type anticoagulant",
  statin_strong: "simvastatin/lovastatin",
  statin_atorva: "atorvastatin",
  raas: "ACE inhibitor / ARB / potassium-sparing diuretic",
  maoi: "MAOI antidepressant",
  levothyroxine: "levothyroxine",
  vegan: "vegan diet",
  veg: "vegetarian diet",
};

const COND_PATTERNS: Array<[CondKey, RegExp]> = [
  ["prediabetes", /\b(pre ?diabet|borderline diabet|impaired (fasting )?glucose)/],
  ["diabetes", /(\bdiabet|\b(t1d|t2d|t1dm|t2dm|dm|dm1|dm2|niddm|iddm|gdm|type (1|2|i|ii|one|two)|sugar patient|sugar problem|high sugar)\b)/],
  ["hypertension", /\b(hypertens\w*|htn|high (blood pressure|bp)|bp)\b/],
  ["celiac", /\b(celiac|coeliac|sprue)\b/],
  ["gluten_sens", /(gluten (intoleran|sensitiv|allerg)|non ?celiac|\bncgs\b|wheat (intoleran|sensitiv)|gluten free diet)/],
  ["wheat_allergy", /wheat allerg/],
  ["lactose", /(lactose|dairy intoleran|milk intoleran)/],
  ["dairy_allergy", /(\b(milk|dairy|cow|casein|whey)\b[a-z ]{0,14}allerg|allerg[a-z ]{0,14}\b(milk|dairy|casein|whey)\b|\bcmpa\b)/],
  ["peanut", /\b(peanut|groundnut|arachis)/],
  ["tree_nut", /(\btree nut|\bnuts?\b|almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia)/],
  ["soy", /\b(soy|soya|soybean|soyabean)/],
  ["egg", /\beggs?\b/],
  ["shellfish", /(shellfish|crustacean|shrimp|prawn|\bcrab\b|lobster|mollus|\bseafood\b)/],
  ["fish", /\b(fish|seafood)\b/],
  ["pregnancy", /(pregnan|expecting|expectant|gestation|prenatal|antenatal|trimester)/],
  ["ckd", /(\bckd\b|chronic kidney|kidney (disease|failure|impairment)|renal (disease|failure|impairment|insufficiency)|\besrd\b|dialysis|nephropathy)/],
  ["cholesterol", /(cholesterol|hyperlipid|dyslipid|\bldl\b|triglycerid|heart disease|coronary|\bcad\b|cardiovascular|\bcvd\b)/],
  ["gout", /(\bgout|hyperuric|uric acid)/],
  ["sesame", /(\bsesame|\btahini|\bgingelly)/],
];

export function detectConditions(conditions: unknown): Set<CondKey> {
  const out = new Set<CondKey>();
  if (!Array.isArray(conditions)) return out;
  for (const c of conditions.slice(0, 50)) {
    if (typeof c !== "string") continue;
    let t = ` ${normText(c)} `;
    if (!t.trim()) continue;
    const lowBp = /\b(low (blood pressure|bp)|hypotens)/.test(t);
    for (const [key, re] of COND_PATTERNS) {
      let text = t;
      if (key === "diabetes") text = t.replace(/pre ?diabet\w*/g, " ").replace(/diabet\w* insipidus/g, " ");
      if (key === "hypertension" && lowBp) continue;
      if (re.test(text)) out.add(key);
    }
    if (/\bnuts?\b/.test(t) && !/tree nut/.test(t)) out.add("peanut");
    if (/\bseafood\b/.test(t)) {
      out.add("fish");
      out.add("shellfish");
    }
  }
  return out;
}

const MED_NAMES: Array<[MedKey, string[]]> = [
  ["warfarin", ["warfarin", "coumadin", "jantoven", "marevan", "acenocoumarol", "sintrom", "nicoumalone", "acitrom", "phenprocoumon", "marcoumar"]],
  ["statin_strong", ["simvastatin", "zocor", "lovastatin", "mevacor", "altoprev", "vytorin"]],
  ["ccb_felodipine", ["felodipine", "plendil", "nifedipine", "adalat", "procardia"]],
  ["statin_atorva", ["atorvastatin", "lipitor"]],
  ["raas", [
    "lisinopril", "zestril", "prinivil", "enalapril", "vasotec", "ramipril", "altace", "tritace", "captopril", "perindopril",
    "benazepril", "lotensin", "quinapril", "accupril", "fosinopril", "trandolapril", "losartan", "cozaar", "valsartan", "diovan",
    "telmisartan", "micardis", "olmesartan", "benicar", "candesartan", "atacand", "irbesartan", "avapro", "spironolactone",
    "aldactone", "eplerenone", "inspra", "amiloride", "triamterene",
  ]],
  ["maoi", ["phenelzine", "nardil", "tranylcypromine", "parnate", "isocarboxazid", "marplan", "maoi"]],
  ["levothyroxine", ["levothyroxine", "thyroxine", "synthroid", "levoxyl", "euthyrox", "eltroxin", "unithroid", "thyronorm", "tirosint"]],
];

export function detectMedications(meds: unknown): Set<MedKey> {
  const out = new Set<MedKey>();
  if (!Array.isArray(meds)) return out;
  for (const m of meds.slice(0, 50)) {
    if (!m || typeof m !== "object") continue;
    const mm = m as HealthMedicationInput;
    if (mm.isCurrent === false) continue;
    const toks = normText(mm.name).split(" ").filter(Boolean);
    for (const [key, names] of MED_NAMES) {
      if (toks.some((t) => names.some((n) => t === n || (n.length >= 6 && t.startsWith(n))))) out.add(key);
    }
    if (/\bace inhibitor|\bangiotensin receptor|\bpotassium sparing/.test(normText(mm.name))) out.add("raas");
  }
  return out;
}

function detectDiet(d: unknown): DietKey | null {
  if (typeof d !== "string") return null;
  const t = normText(d);
  if (t === "vegan") return "vegan";
  if (t === "veg" || t === "vegetarian") return "veg";
  return null;
}

// ---------------------------------------------------------------------------
// Term tables
// ---------------------------------------------------------------------------

const PLANT_QUAL = ["coconut", "almond", "soy", "soya", "oat", "rice", "cashew", "hemp", "peanut", "cocoa", "cacao", "shea", "nut", "hazelnut", "walnut", "plant", "vegan", "bean", "squash", "vegetable", "nondairy", "sunflower", "pea"];

const GLUTEN_FLOUR_QUAL = ["rice", "corn", "maize", "gram", "chickpea", "besan", "almond", "coconut", "potato", "tapioca", "buckwheat", "sorghum", "jowar", "bajra", "ragi", "millet", "quinoa", "amaranth", "cassava", "soy", "oat", "lentil", "arrowroot", "singhara", "kuttu", "gluten", "wheat", "barley", "rye", "spelt"];

const GLUTEN_GROUPS: Group[] = [
  { terms: ["wheat", "barley", "rye", "malt", "malted", "semolina", "suji", "sooji", "durum", "spelt", "triticale", "farro", "kamut", "einkorn", "bulgur", "couscous", "seitan", "gluten", "atta", "maida", "graham", "wheat starch"], sev: "warning" },
  { terms: ["oat", "oats", "oatmeal", "rolled oats"], sev: "caution", note: "Oats are often cross-contaminated with gluten during growing or processing; only oats labelled gluten-free are generally recommended for celiac disease." },
  { terms: ["flour"], sev: "caution", note: "Unspecified flour is often wheat.", unless: GLUTEN_FLOUR_QUAL },
  { terms: ["soy sauce", "soya sauce", "teriyaki", "beer", "lager", "stout", "ale"], sev: "caution", note: "Soy sauce is usually brewed with wheat and beer is usually made from barley, so they are normally not gluten free unless labelled gluten free (Coeliac UK).", unless: ["ginger", "root", "alcohol", "nonalcoholic"] },
  { terms: ["bread", "breadcrumb", "bun", "pav", "roti", "chapati", "naan", "paratha", "pita", "pasta", "noodle", "spaghetti", "macaroni", "biscuit", "cracker"], sev: "caution", note: "Bread, pasta and baked goods are usually made with wheat unless labelled gluten-free.", unless: ["rice", "gluten", "corn", "gram", "lentil", "chickpea", "glass", "buckwheat", "millet", "ragi", "jowar", "bajra"] },
];

const DAIRY_CORE = ["milk", "milk powder", "skimmed milk", "condensed milk", "evaporated milk", "milk solids", "cream", "butter", "buttermilk", "cheese", "cheddar", "mozzarella", "parmesan", "ricotta", "mascarpone", "brie", "camembert", "feta", "yogurt", "yoghurt", "curd", "dahi", "lassi", "kefir", "ghee", "paneer", "khoa", "khoya", "mawa", "whey", "casein", "caseinate", "lactose", "lactalbumin", "lactoglobulin", "ice cream", "custard"];

const SUGAR_TERMS = [
  "sugar", "cane sugar", "brown sugar", "icing sugar", "castor sugar", "coconut sugar", "invert sugar", "invert syrup", "sucrose", "dextrose",
  "glucose", "glucose syrup", "glucose fructose", "fructose", "maltose", "maltodextrin", "high fructose corn syrup", "hfcs", "corn syrup",
  "rice syrup", "malt syrup", "maple syrup", "agave", "date syrup", "honey", "jaggery", "gur", "gud", "molasses", "treacle", "panela",
  "fruit juice concentrate", "cane juice", "evaporated cane juice", "sugar syrup", "syrup", "demerara", "muscovado",
];

const MEAT_TERMS = ["meat", "chicken", "beef", "pork", "lamb", "mutton", "turkey", "duck", "bacon", "ham", "sausage", "salami", "pepperoni", "veal", "venison", "meat extract", "fish", "anchovy", "tuna", "salmon", "shrimp", "prawn", "crab", "lobster", "fish sauce", "worcestershire", "gelatin", "gelatine", "lard", "tallow", "suet", "animal fat", "bone broth", "chicken stock", "beef stock"];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  keys: Key[];
  kind: HealthAppliesToKind;
  title: string;
  message: string;
  reason: string;
  source: string;
  groups: CompiledGroup[];
  /** Open Food Facts allergen tags (without the "en:" prefix) that also trigger this rule. */
  tags?: string[];
  tagSev?: HealthSeverity;
  /** Only evaluate when no salt/sodium nutrient is known. */
  needsNoSalt?: boolean;
}

function rule(r: Omit<Rule, "groups"> & { groups: Group[] }): Rule {
  return { ...r, groups: compileGroups(r.groups) };
}

const RULES: Rule[] = [
  // ----- Diabetes / prediabetes -----
  rule({
    id: "glycemic.added_sugar", keys: ["diabetes", "prediabetes"], kind: "condition",
    title: "Added or concentrated sugar source",
    message: "This product lists a sugar or sugar-like ingredient. Carbohydrate and sugar intake is usually managed as part of a diabetes care plan, so you may want to check the label and consider asking your clinician or dietitian how it fits.",
    reason: "Free sugars and concentrated sweeteners (including honey, jaggery, syrups, maltodextrin and glucose-fructose syrups) can raise blood glucose quickly.",
    source: "NHS (free sugars); American Diabetes Association (nutrition guidance)",
    groups: [{ terms: SUGAR_TERMS, sev: "caution", note: "Maltodextrin, dextrose and glucose syrups are rapidly digested carbohydrates." }],
  }),
  // ----- Hypertension / CKD sodium contributors -----
  rule({
    id: "sodium.additives", keys: ["hypertension", "ckd"], kind: "condition",
    title: "Sodium-containing additive or cured meat",
    message: "This product lists an ingredient that adds sodium or is typically high in salt. If you are limiting salt, you may want to check the nutrition label.",
    reason: "Sodium-containing additives (monosodium glutamate, ribonucleotides, sodium benzoate, sodium nitrite/nitrate) and cured meats add to total salt intake; WHO recommends adults keep salt under 5 g per day.",
    source: "WHO (sodium intake guideline); NHS (salt in your diet)",
    groups: [
      { terms: ["monosodium glutamate", "msg", "e621", "e627", "e631", "e635", "sodium benzoate", "e211", "sodium nitrite", "e250", "sodium nitrate", "e251"], sev: "info" },
      { terms: ["bacon", "ham", "salami", "pepperoni", "cured", "corned beef"], sev: "info", note: "Cured and processed meats are typically high in salt." },
    ],
  }),
  rule({
    id: "sodium.salt_listed", keys: ["hypertension", "ckd"], kind: "condition",
    title: "Salt or salty seasoning listed",
    message: "Salt or a salty seasoning is listed and no salt value was available to check. Consider looking at the salt per 100 g on the label.",
    reason: "High salt intake is linked to raised blood pressure; WHO recommends adults keep salt under 5 g per day.",
    source: "WHO (sodium intake guideline); NHS (salt in your diet)",
    needsNoSalt: true,
    groups: [{ terms: ["salt", "salted", "sea salt", "rock salt", "black salt", "kala namak", "sodium chloride", "soy sauce", "fish sauce", "bouillon", "stock cube", "brine"], sev: "info" }],
  }),
  // ----- Cholesterol -----
  rule({
    id: "lipid.trans_fat", keys: ["cholesterol"], kind: "condition",
    title: "Possible trans fat or hydrogenated fat",
    message: "This product lists a hydrogenated fat. Partially hydrogenated oils can contain industrially produced trans fat, which you may want to limit if you are managing cholesterol or heart health.",
    reason: "Industrially produced trans fats raise LDL cholesterol; WHO has called for their elimination. Fully hydrogenated fats are mainly saturated.",
    source: "WHO (trans fat elimination); NHS (cholesterol)",
    groups: [
      { terms: ["partially hydrogenated", "vanaspati"], sev: "caution" },
      { terms: ["hydrogenated"], sev: "info", note: "Check whether the fat is partially or fully hydrogenated." },
    ],
  }),
  rule({
    id: "lipid.saturated_fat_sources", keys: ["cholesterol"], kind: "condition",
    title: "Saturated fat source listed",
    message: "This product lists an ingredient that is a notable source of saturated fat. If you are managing cholesterol, you may want to check the saturates per 100 g on the label.",
    reason: "Replacing saturated fat with unsaturated fat is generally advised to help lower LDL cholesterol.",
    source: "NHS (cholesterol: eating more healthily)",
    groups: [{ terms: ["palm oil", "palm kernel", "coconut oil", "butter", "ghee", "lard", "tallow", "suet", "dripping", "cream", "animal fat", "beef fat", "pork fat"], sev: "info", qual: PLANT_QUAL.filter((q) => q !== "coconut") }],
  }),
  // ----- Gluten -----
  rule({
    id: "allergy.gluten.celiac", keys: ["celiac"], kind: "condition",
    title: "Gluten-containing ingredient",
    message: "This product lists an ingredient that contains or may contain gluten. People with celiac disease are advised to avoid gluten completely; consider checking for a certified gluten-free label and asking your clinician or dietitian.",
    reason: "Wheat, barley, rye and their derivatives (including malt, semolina/suji, spelt, triticale) contain gluten.",
    source: "Celiac Disease Foundation; NHS (coeliac disease)",
    tags: ["gluten", "wheat"], tagSev: "warning",
    groups: GLUTEN_GROUPS,
  }),
  rule({
    id: "allergy.gluten.sensitivity", keys: ["gluten_sens"], kind: "condition",
    title: "Gluten-containing ingredient",
    message: "This product lists an ingredient that contains or may contain gluten, which you have noted you may react to. Consider checking the label.",
    reason: "Wheat, barley, rye and their derivatives contain gluten.",
    source: "Celiac Disease Foundation; NHS (coeliac disease)",
    tags: ["gluten", "wheat"], tagSev: "caution",
    groups: GLUTEN_GROUPS.map((g) => ({ ...g, sev: (g.sev === "warning" ? "caution" : "info") as HealthSeverity })),
  }),
  rule({
    id: "allergy.wheat", keys: ["wheat_allergy"], kind: "allergy",
    title: "Wheat-containing ingredient",
    message: "This product lists wheat or a wheat-derived ingredient. Wheat is a major allergen; please check the label and your allergy plan.",
    reason: "Listed ingredient matches wheat or a wheat-derived ingredient.",
    source: "FDA (major food allergens)",
    tags: ["wheat", "gluten"], tagSev: "warning",
    groups: [
      { terms: ["wheat", "semolina", "suji", "sooji", "durum", "spelt", "atta", "maida", "bulgur", "couscous", "seitan", "graham", "triticale", "kamut", "einkorn", "farro"], sev: "warning" },
      { terms: ["soy sauce", "soya sauce", "teriyaki"], sev: "caution", note: "Soy sauce is usually brewed with wheat." },
    ],
  }),
  // ----- Dairy -----
  rule({
    id: "allergy.milk", keys: ["dairy_allergy"], kind: "allergy",
    title: "Milk or dairy-derived ingredient",
    message: "This product lists a milk or dairy-derived ingredient. Milk is a major allergen; please check the label and your allergy plan.",
    reason: "Listed ingredient matches milk, milk protein (casein, whey) or a milk product.",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["milk"], tagSev: "warning",
    groups: [{ terms: DAIRY_CORE, sev: "warning", qual: PLANT_QUAL }],
  }),
  rule({
    id: "intolerance.lactose", keys: ["lactose"], kind: "condition",
    title: "Lactose-containing ingredient",
    message: "This product lists an ingredient that may contain lactose. Tolerance varies from person to person; consider checking the label or asking your clinician or dietitian.",
    reason: "Milk, cream, milk powders and whey contain lactose. Butter, ghee, hard cheeses and fermented dairy usually contain less, but tolerance varies.",
    source: "NHS (lactose intolerance)",
    tags: ["milk"], tagSev: "caution",
    groups: [
      { terms: ["lactose", "milk", "milk powder", "skimmed milk", "condensed milk", "evaporated milk", "milk solids", "cream", "ice cream", "whey", "buttermilk", "cottage cheese", "ricotta", "mascarpone", "cream cheese"], sev: "caution", qual: PLANT_QUAL },
      { terms: ["butter", "ghee", "cheese", "cheddar", "parmesan", "yogurt", "yoghurt", "curd", "dahi", "kefir"], sev: "info", note: "Butter, ghee, aged cheese and fermented dairy usually contain less lactose, but tolerance varies.", qual: PLANT_QUAL },
    ],
  }),
  // ----- Other allergies -----
  rule({
    id: "allergy.peanut", keys: ["peanut"], kind: "allergy",
    title: "Peanut-containing ingredient",
    message: "This product lists peanut or an ingredient that may contain peanut. Please check the label and your allergy plan.",
    reason: "Listed ingredient matches peanut (groundnut, arachis).",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["peanuts", "peanut"], tagSev: "warning",
    groups: [
      { terms: ["peanut", "groundnut", "arachis", "monkey nut", "goober"], sev: "warning" },
      { terms: ["mixed nut", "nut"], sev: "caution", note: "Unspecified nuts may include peanuts." },
    ],
  }),
  rule({
    id: "allergy.tree_nut", keys: ["tree_nut"], kind: "allergy",
    title: "Tree nut ingredient",
    message: "This product lists a tree nut or an ingredient that may contain tree nuts. Please check the label and your allergy plan.",
    reason: "Listed ingredient matches a tree nut (almond, cashew, walnut, pecan, pistachio, hazelnut, macadamia and similar). Coconut is not treated as a tree nut here.",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["nuts", "tree-nuts", "tree nuts"], tagSev: "warning",
    groups: [
      { terms: ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "filbert", "macadamia", "brazil nut", "pine nut", "pinenut", "praline", "marzipan", "nougat", "gianduja", "frangipane", "amaretto"], sev: "warning" },
      { terms: ["mixed nut", "nut"], sev: "caution", note: "Unspecified nuts may include tree nuts." },
    ],
  }),
  rule({
    id: "allergy.soy", keys: ["soy"], kind: "allergy",
    title: "Soy-containing ingredient",
    message: "This product lists soy or a soy-derived ingredient. Please check the label and ask your allergist how highly refined soy oil or soy lecithin apply to you.",
    reason: "Listed ingredient matches soy, soya or a soy product such as tofu, miso, tempeh or soy sauce.",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["soybeans", "soy", "soya"], tagSev: "warning",
    groups: [
      { terms: ["soy", "soya", "soybean", "soyabean", "edamame", "tofu", "tempeh", "miso", "natto", "shoyu", "tamari"], sev: "warning" },
      { terms: ["lecithin", "e322", "textured vegetable protein", "tvp"], sev: "caution", note: "Lecithin and textured vegetable protein are often, but not always, soy-derived." },
    ],
  }),
  rule({
    id: "allergy.sesame", keys: ["sesame"], kind: "allergy",
    title: "Sesame-containing ingredient",
    message: "This product lists sesame or a sesame-derived ingredient. Sesame is a major allergen; please check the label and your allergy plan.",
    reason: "Listed ingredient matches sesame, tahini, gingelly/til or a sesame-based product such as halva.",
    source: "FDA (FASTER Act: sesame is the ninth major food allergen); NHS (food allergy)",
    tags: ["sesame-seeds", "sesame"], tagSev: "warning",
    groups: [{ terms: ["sesame", "tahini", "gingelly", "til", "benne", "gomashio", "halva", "halvah"], sev: "warning" }],
  }),
  rule({
    id: "allergy.egg", keys: ["egg"], kind: "allergy",
    title: "Egg-containing ingredient",
    message: "This product lists egg or an egg-derived ingredient. Please check the label and your allergy plan.",
    reason: "Listed ingredient matches egg, egg white proteins (albumen, ovalbumin) or egg-based products such as mayonnaise or meringue.",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["eggs", "egg"], tagSev: "warning",
    groups: [{ terms: ["egg", "egg white", "egg yolk", "albumen", "ovalbumin", "ovomucoid", "ovomucin", "lysozyme", "mayonnaise", "meringue", "eggnog", "livetin"], sev: "warning" }],
  }),
  rule({
    id: "allergy.shellfish", keys: ["shellfish"], kind: "allergy",
    title: "Shellfish ingredient",
    message: "This product lists shellfish or a shellfish-derived ingredient. Please check the label and your allergy plan; molluscs are included as a precaution.",
    reason: "Listed ingredient matches crustaceans (shrimp, prawn, crab, lobster) or molluscs (clam, oyster, mussel, squid and similar).",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["crustaceans", "molluscs", "shellfish"], tagSev: "warning",
    groups: [
      { terms: ["shellfish", "shrimp", "prawn", "crab", "lobster", "crayfish", "crawfish", "langoustine", "krill", "scampi", "shrimp paste", "belacan", "terasi"], sev: "warning" },
      { terms: ["clam", "oyster", "mussel", "scallop", "squid", "calamari", "octopus", "abalone", "cuttlefish", "snail", "escargot", "seafood"], sev: "caution", note: "Molluscs are listed as a precaution; reactions vary." },
    ],
  }),
  rule({
    id: "allergy.fish", keys: ["fish"], kind: "allergy",
    title: "Fish ingredient",
    message: "This product lists fish or a fish-derived ingredient. Please check the label and your allergy plan; Worcestershire sauce and fish sauce are commonly fish-based.",
    reason: "Listed ingredient matches fish or a fish-derived product.",
    source: "FDA (major food allergens); NHS (food allergy)",
    tags: ["fish"], tagSev: "warning",
    groups: [{ terms: ["fish", "salmon", "tuna", "cod", "haddock", "tilapia", "trout", "mackerel", "sardine", "anchovy", "herring", "pollock", "halibut", "swordfish", "catfish", "surimi", "fish sauce", "fish oil", "worcestershire"], sev: "warning" }],
  }),
  // ----- Pregnancy -----
  rule({
    id: "pregnancy.mercury_fish", keys: ["pregnancy"], kind: "condition",
    title: "Fish commonly advised against in pregnancy",
    message: "This product lists a fish that is commonly advised against during pregnancy because of mercury. Consider asking your midwife or doctor.",
    reason: "Shark, swordfish, marlin, king mackerel, tilefish and orange roughy can contain higher mercury levels.",
    source: "NHS (foods to avoid in pregnancy); FDA/EPA (advice about eating fish)",
    groups: [{ terms: ["shark", "swordfish", "marlin", "king mackerel", "tilefish", "orange roughy"], sev: "warning" }],
  }),
  rule({
    id: "pregnancy.tuna", keys: ["pregnancy"], kind: "condition",
    title: "Tuna: amount may be limited in pregnancy",
    message: "Tuna is listed. Pregnancy guidance commonly limits how much tuna you eat in a week; consider checking current advice with your midwife or doctor.",
    reason: "Tuna contains more mercury than many other fish.",
    source: "NHS (foods to avoid in pregnancy)",
    groups: [{ terms: ["tuna"], sev: "info" }],
  }),
  rule({
    id: "pregnancy.listeria", keys: ["pregnancy"], kind: "condition",
    title: "Unpasteurised dairy, soft mould-ripened or blue cheese, or pate",
    message: "This product lists an item that pregnancy guidance commonly advises avoiding or cooking thoroughly because of listeria risk. Consider asking your midwife or doctor.",
    reason: "Unpasteurised milk products, soft mould-ripened cheeses (brie, camembert), soft blue cheeses and all types of pate can carry listeria.",
    source: "NHS (foods to avoid in pregnancy)",
    groups: [
      { terms: ["unpasteurised", "unpasteurized", "raw milk"], sev: "warning" },
      { terms: ["brie", "camembert", "gorgonzola", "roquefort", "danish blue", "blue cheese", "pate"], sev: "caution", note: "Cooking these until steaming hot is generally considered to remove the listeria concern." },
    ],
  }),
  rule({
    id: "pregnancy.vitamin_a", keys: ["pregnancy"], kind: "condition",
    title: "Liver or vitamin A (retinol)",
    message: "This product lists liver or a retinol form of vitamin A. Pregnancy guidance commonly advises avoiding liver products and high-dose vitamin A supplements; small fortification amounts are different, so consider asking your midwife or doctor.",
    reason: "Too much preformed vitamin A (retinol) may harm an unborn baby; liver is a very rich source.",
    source: "NHS (vitamins and supplements in pregnancy)",
    groups: [
      { terms: ["liver"], sev: "warning" },
      { terms: ["retinol", "retinyl palmitate", "retinyl acetate", "vitamin a", "vitamin a palmitate", "vitamin a acetate"], sev: "info", note: "Fortification amounts are usually small; the concern is mainly high-dose supplements.", unless: ["carotene", "betacarotene"] },
    ],
  }),
  rule({
    id: "pregnancy.caffeine", keys: ["pregnancy"], kind: "condition",
    title: "Caffeine source",
    message: "This product lists a caffeine source. Pregnancy guidance commonly suggests keeping caffeine under 200 mg per day across all sources.",
    reason: "High caffeine intake in pregnancy has been linked with low birth weight and, at high intakes, miscarriage.",
    source: "NHS (caffeine in pregnancy)",
    groups: [
      { terms: ["caffeine", "coffee", "guarana", "energy drink", "yerba mate", "matcha"], sev: "caution", unless: ["decaf", "decaffeinated"] },
      { terms: ["tea", "green tea", "black tea", "cola"], sev: "info", unless: ["herbal", "chamomile", "camomile", "rooibos", "peppermint", "ginger", "fruit", "decaf", "decaffeinated", "iced"] },
    ],
  }),
  rule({
    id: "pregnancy.alcohol", keys: ["pregnancy"], kind: "condition",
    title: "Alcohol",
    message: "This product lists alcohol. Pregnancy guidance advises not drinking alcohol; consider asking your midwife or doctor about products with alcohol as an ingredient.",
    reason: "Health authorities have not identified any amount of alcohol in pregnancy that is known to carry no risk.",
    source: "NHS (alcohol in pregnancy); UK Chief Medical Officers' guideline",
    groups: [
      { terms: ["beer", "wine", "whisky", "whiskey", "rum", "vodka", "brandy", "gin", "liqueur", "cider", "sake"], sev: "warning", unless: ["root", "ginger", "nonalcoholic", "alcohol", "vinegar"] },
      { terms: ["alcohol", "ethanol", "ethyl alcohol"], sev: "caution", unless: ["free", "nonalcoholic"] },
    ],
  }),
  rule({
    id: "pregnancy.sprouts", keys: ["pregnancy"], kind: "condition",
    title: "Raw sprouts",
    message: "Sprouts are listed. Raw sprouts are commonly advised against in pregnancy; cooking them thoroughly lowers the concern.",
    reason: "Raw sprouts have been linked with foodborne illness outbreaks.",
    source: "FDA (raw sprouts)",
    groups: [{ terms: ["alfalfa", "bean sprout", "mung bean sprout", "raw sprout", "clover sprout", "radish sprout"], sev: "info" }],
  }),
  // ----- CKD -----
  rule({
    id: "ckd.potassium", keys: ["ckd"], kind: "condition",
    title: "Potassium chloride or salt substitute",
    message: "This product lists potassium chloride or a salt substitute. Potassium limits depend on your stage and blood results, so consider asking your renal dietitian or doctor.",
    reason: "Salt substitutes are often potassium chloride, and potassium can build up when kidneys are not working well.",
    source: "National Kidney Foundation (potassium and your CKD diet)",
    groups: [{ terms: ["potassium chloride", "salt substitute", "lo salt", "losalt", "lite salt", "low sodium salt", "e508"], sev: "caution" }],
  }),
  rule({
    id: "ckd.phosphate", keys: ["ckd"], kind: "condition",
    title: "Phosphate additive",
    message: "This product lists a phosphate additive. Phosphorus limits depend on your stage and blood results, so consider asking your renal dietitian or doctor.",
    reason: "Phosphate additives are absorbed more readily than naturally occurring phosphorus.",
    source: "National Kidney Foundation (phosphorus and your CKD diet)",
    groups: [{ terms: ["phosphoric acid", "phosphate", "polyphosphate", "diphosphate", "pyrophosphate", "tripolyphosphate", "e338", "e339", "e340", "e341", "e343", "e450", "e451", "e452"], sev: "caution" }],
  }),
  // ----- Gout -----
  rule({
    id: "gout.purines", keys: ["gout"], kind: "condition",
    title: "Purine-rich food, alcohol or fructose syrup",
    message: "This product lists an item that gout guidance commonly suggests limiting. Consider asking your clinician how it fits your plan.",
    reason: "Offal, some oily fish, beer and fructose-sweetened drinks are associated with higher uric acid or gout flares.",
    source: "NHS (gout); American College of Rheumatology 2020 gout guideline",
    groups: [
      { terms: ["liver", "kidney", "offal", "organ meat", "anchovy", "sardine", "herring", "mackerel", "beer"], sev: "caution", unless: ["bean"] },
      { terms: ["high fructose corn syrup", "hfcs"], sev: "info" },
    ],
  }),
  // ----- Medications -----
  rule({
    id: "med.warfarin.vitamin_k", keys: ["warfarin"], kind: "medication",
    title: "Vitamin K-rich food",
    message: "This product lists a vitamin K-rich food. Vitamin K affects how warfarin-type medicines work. The usual advice is to keep your intake consistent rather than to avoid these foods, so consider asking your anticoagulation clinic.",
    reason: "Large changes in vitamin K intake can alter INR control.",
    source: "NHS warfarin patient guidance (consistent vitamin K intake)",
    groups: [{ terms: ["spinach", "kale", "collard", "collard green", "turnip green", "mustard green", "parsley", "chard", "swiss chard", "broccoli", "brussels sprout", "endive", "natto", "vitamin k", "vitamin k1", "vitamin k2", "phylloquinone", "menaquinone"], sev: "caution" }],
  }),
  rule({
    id: "med.warfarin.drinks",
    keys: ["warfarin"], kind: "medication",
    title: "Cranberry or grapefruit",
    message: "This product lists cranberry or grapefruit. NHS warfarin guidance advises not drinking cranberry or grapefruit juice because they can increase the effect of warfarin. Please check with your anticoagulation clinic, doctor or pharmacist.",
    reason: "Cranberry and grapefruit products can increase the effect of warfarin and the risk of bleeding.",
    source: "NHS warfarin: advice about food and drink",
    groups: [{ terms: ["cranberry", "cranberries", "grapefruit"], sev: "caution" }],
  }),
  rule({
    id: "med.ccb.grapefruit",
    keys: ["ccb_felodipine"], kind: "medication",
    title: "Grapefruit and related citrus",
    message: "This product lists grapefruit or a related citrus. Grapefruit can raise blood levels of felodipine and, to a lesser extent, nifedipine. Consider asking your pharmacist or doctor.",
    reason: "Compounds in grapefruit, pomelo and Seville (bitter) orange inhibit an intestinal enzyme (CYP3A4) that breaks down these medicines.",
    source: "FDA (Grapefruit juice and some drugs may not mix)",
    groups: [{ terms: ["grapefruit", "pomelo", "pummelo", "seville orange", "bitter orange"], sev: "caution" }],
  }),
  rule({
    id: "med.statin.grapefruit", keys: ["statin_strong"], kind: "medication",
    title: "Grapefruit and related citrus",
    message: "This product lists grapefruit or a related citrus. Grapefruit can raise blood levels of simvastatin and lovastatin; some labels advise avoiding large amounts. Consider asking your pharmacist.",
    reason: "Compounds in grapefruit, pomelo and Seville (bitter) orange inhibit an intestinal enzyme (CYP3A4) that breaks down some statins.",
    source: "FDA (Grapefruit juice and some drugs may not mix)",
    groups: [{ terms: ["grapefruit", "pomelo", "pummelo", "seville orange", "bitter orange"], sev: "caution" }],
  }),
  rule({
    id: "med.statin.atorvastatin", keys: ["statin_atorva"], kind: "medication",
    title: "Grapefruit and related citrus",
    message: "This product lists grapefruit or a related citrus. The interaction with atorvastatin is generally weaker and mainly relates to large amounts, but you may want to ask your pharmacist.",
    reason: "Grapefruit compounds can modestly raise atorvastatin levels; the effect depends on the amount consumed.",
    source: "FDA (Grapefruit juice and some drugs may not mix)",
    groups: [{ terms: ["grapefruit", "pomelo", "pummelo", "seville orange", "bitter orange"], sev: "info" }],
  }),
  rule({
    id: "med.raas.potassium", keys: ["raas"], kind: "medication",
    title: "Potassium salt substitute",
    message: "This product lists potassium chloride or a salt substitute. With ACE inhibitors, ARBs and potassium-sparing diuretics this can raise blood potassium, so consider asking your pharmacist or doctor before using it.",
    reason: "These medicines reduce potassium loss; extra potassium from salt substitutes may lead to high blood potassium (hyperkalaemia).",
    source: "NHS (medicine leaflets for ACE inhibitors, e.g. ramipril, lisinopril)",
    groups: [{ terms: ["potassium chloride", "salt substitute", "lo salt", "losalt", "lite salt", "low sodium salt", "e508"], sev: "caution" }],
  }),
  rule({
    id: "med.maoi.tyramine", keys: ["maoi"], kind: "medication",
    title: "Possible high-tyramine food",
    message: "This product lists an aged, cured or fermented food that can be high in tyramine. With MAOI antidepressants, high-tyramine foods can cause a dangerous rise in blood pressure, so please check with your prescriber or pharmacist.",
    reason: "MAOIs reduce the breakdown of tyramine, which builds up in aged, cured and fermented foods.",
    source: "Mayo Clinic (MAOIs and diet: is it necessary to restrict tyramine?)",
    groups: [
      { terms: ["aged cheese", "blue cheese", "gorgonzola", "roquefort", "stilton", "parmesan", "cheddar", "salami", "pepperoni", "dry sausage", "cured meat", "soy sauce", "miso", "tempeh", "natto", "sauerkraut", "fermented soy", "fish sauce", "yeast extract", "marmite", "vegemite", "tap beer", "draft beer"], sev: "warning" },
      { terms: ["cheese", "kimchi", "beer", "wine", "fava bean", "broad bean", "sausage", "fermented"], sev: "caution", note: "Tyramine content varies with ageing and fermentation." },
    ],
  }),
  rule({
    id: "med.levothyroxine.absorption", keys: ["levothyroxine"], kind: "medication",
    title: "May affect levothyroxine absorption",
    message: "This product lists soy, a calcium or iron source, coffee, walnuts or a fibre supplement. These can reduce absorption of levothyroxine if taken close together. Keep a consistent routine and consider asking your pharmacist about timing.",
    reason: "Soy, calcium, iron, coffee, walnuts and fibre can bind levothyroxine or reduce its absorption.",
    source: "American Thyroid Association (levothyroxine patient information)",
    groups: [{ terms: ["soy", "soya", "soybean", "calcium carbonate", "calcium citrate", "ferrous sulfate", "ferrous sulphate", "ferrous fumarate", "iron", "calcium", "coffee", "walnut", "psyllium", "cottonseed meal"], sev: "info" }],
  }),
  // ----- Diet type (informational) -----
  rule({
    id: "diet.vegan", keys: ["vegan"], kind: "diet",
    title: "Animal-derived ingredient",
    message: "This product lists an ingredient that is animal-derived, which does not match a vegan diet.",
    reason: "Matches a milk, egg, honey, meat, fish, gelatin or insect-derived ingredient.",
    source: "The Vegan Society (definition of veganism)",
    groups: [
      { terms: DAIRY_CORE.filter((t) => t !== "custard"), sev: "info", qual: PLANT_QUAL },
      { terms: ["egg", "egg white", "egg yolk", "albumen", "honey", "carmine", "cochineal", "e120", "shellac", "e904", "isinglass", ...MEAT_TERMS], sev: "info" },
    ],
  }),
  rule({
    id: "diet.veg", keys: ["veg"], kind: "diet",
    title: "Meat, fish or animal-derived ingredient",
    message: "This product lists an ingredient that is meat, fish or animal-derived, which does not match a vegetarian diet.",
    reason: "Matches a meat, fish, gelatin or animal fat ingredient.",
    source: "The Vegetarian Society (definition of vegetarian)",
    groups: [{ terms: MEAT_TERMS, sev: "info" }],
  }),
];

interface NutrientRule {
  id: string;
  keys: Key[];
  nutrient: "sugars" | "salt" | "saturates";
  title: string;
  reason: string;
  source: string;
  advice: string;
}

const NUTRIENT_RULES: NutrientRule[] = [
  { id: "nutrient.sugars_high", keys: ["diabetes", "prediabetes"], nutrient: "sugars", title: "High sugars per 100 g", advice: "Consider checking how this fits your carbohydrate plan, or asking your clinician or dietitian.", reason: "Above the UK FSA front-of-pack 'high' cut-off for sugars.", source: "UK Food Standards Agency / NHS (food labels, traffic light thresholds)" },
  { id: "nutrient.salt_high", keys: ["hypertension", "ckd"], nutrient: "salt", title: "High salt per 100 g", advice: "Consider checking how this fits your salt limit, or asking your clinician or dietitian.", reason: "Above the UK FSA front-of-pack 'high' cut-off for salt. WHO advises adults to keep salt under 5 g per day.", source: "UK Food Standards Agency / NHS (food labels); WHO (sodium intake guideline)" },
  { id: "nutrient.saturates_high", keys: ["cholesterol"], nutrient: "saturates", title: "High saturated fat per 100 g", advice: "Consider checking how this fits your plan, or asking your clinician or dietitian.", reason: "Above the UK FSA front-of-pack 'high' cut-off for saturates.", source: "UK Food Standards Agency / NHS (food labels, traffic light thresholds)" },
];

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function normTag(t: unknown): string {
  if (typeof t !== "string") return "";
  return t.slice(0, 60).toLowerCase().replace(/^[a-z]{2}:/, "").replace(/_/g, "-").trim();
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function ruleActiveKeys(r: Rule, active: Set<Key>): Key[] {
  return r.keys.filter((k) => active.has(k));
}

export function evaluateHealthAlerts(input: HealthInput): HealthAlert[] {
  if (!input || typeof input !== "object") return [];
  const conds = detectConditions(input.conditions ?? []);
  const meds = detectMedications(input.medications ?? []);
  const diet = detectDiet(input.dietType ?? input.profile?.dietType ?? null);
  const active = new Set<Key>();
  conds.forEach((c) => active.add(c));
  meds.forEach((m) => active.add(m));
  if (diet) active.add(diet);
  if (active.size === 0) return [];

  const ings: Ing[] = [];
  for (const x of Array.isArray(input.ingredients) ? input.ingredients.slice(0, MAX_ITEMS) : []) {
    const p = prepIngredient(x);
    if (p) ings.push(p);
  }
  const tags = new Set<string>();
  for (const t of Array.isArray(input.allergensTags) ? input.allergensTags.slice(0, 100) : []) {
    const n = normTag(t);
    if (n) tags.add(n);
  }
  const nut = input.nutriments && typeof input.nutriments === "object" ? input.nutriments : {};
  const sugars = num(nut.sugars);
  const sodium = num(nut.sodium);
  const salt = num(nut.salt) ?? (sodium !== null ? sodium * 2.5 : null);
  const satFat = num(nut.saturatedFat) ?? num((nut as Record<string, unknown>).saturates) ?? num((nut as Record<string, unknown>).saturated_fat);
  const th = input.isBeverage ? FSA_THRESHOLDS.drink : FSA_THRESHOLDS.food;

  const out = new Map<string, HealthAlert>();
  const push = (a: HealthAlert) => {
    const prev = out.get(a.id);
    if (!prev || SEV_RANK[a.severity] > SEV_RANK[prev.severity]) out.set(a.id, a);
  };

  for (const r of RULES) {
    const keys = ruleActiveKeys(r, active);
    if (keys.length === 0) continue;
    if (r.needsNoSalt && salt !== null) continue;

    let best: HealthSeverity | null = null;
    const hits: string[] = [];
    const notes = new Set<string>();
    for (const ing of ings) {
      if (r.id === "intolerance.lactose" && /lactose ?free|low lactose/.test(ing.norm)) continue;
      if (r.id.startsWith("allergy.gluten") && /gluten ?free/.test(ing.norm)) continue;
      let ingBest: HealthSeverity | null = null;
      let ingNote: string | undefined;
      for (const g of r.groups) {
        if (groupHit(ing, g)) {
          if (ingBest === null || SEV_RANK[g.sev] > SEV_RANK[ingBest]) {
            ingBest = g.sev;
            ingNote = g.note;
          }
        }
      }
      if (ingBest) {
        if (!hits.includes(ing.raw)) hits.push(ing.raw);
        if (ingNote) notes.add(ingNote);
        if (best === null || SEV_RANK[ingBest] > SEV_RANK[best]) best = ingBest;
      }
    }
    if (r.tags) {
      const hitTags = r.tags.filter((t) => tags.has(t));
      if (hitTags.length > 0) {
        hits.push(`allergen tag: ${hitTags[0]}`);
        const sev = r.tagSev ?? "caution";
        if (best === null || SEV_RANK[sev] > SEV_RANK[best]) best = sev;
      }
    }
    if (best === null) continue;
    const trigger = hits.slice(0, 5).join("; ") + (hits.length > 5 ? "; and more" : "");
    const message = [r.message, ...Array.from(notes)].join(" ");
    push({
      id: r.id,
      severity: best,
      title: r.title,
      message,
      trigger,
      reason: r.reason,
      source: r.source,
      appliesTo: keys.map((k) => LABEL[k]).join(", "),
      appliesToKind: r.kind,
      disclaimer: HEALTH_DISCLAIMER,
    });
  }

  for (const nr of NUTRIENT_RULES) {
    const keys = nr.keys.filter((k) => active.has(k));
    if (keys.length === 0) continue;
    const value = nr.nutrient === "sugars" ? sugars : nr.nutrient === "salt" ? salt : satFat;
    const limit = th[nr.nutrient];
    if (value === null || !(value > limit)) continue;
    const unit = input.isBeverage ? "100 ml" : "100 g";
    push({
      id: nr.id,
      severity: "caution",
      title: nr.title,
      message: `${nr.nutrient === "saturates" ? "Saturates" : nr.nutrient === "salt" ? "Salt" : "Sugars"}: ${fmt(value)} g per ${unit}, above the ${fmt(limit)} g 'high' cut-off. ${nr.advice}`,
      trigger: `${nr.nutrient} ${fmt(value)} g/${unit} (> ${fmt(limit)})`,
      reason: nr.reason,
      source: nr.source,
      appliesTo: keys.map((k) => LABEL[k]).join(", "),
      appliesToKind: "condition",
      disclaimer: HEALTH_DISCLAIMER,
    });
  }

  return Array.from(out.values()).sort((a, b) => {
    const d = SEV_RANK[b.severity] - SEV_RANK[a.severity];
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Hard conflicts for recipe generation: allergy and diet matches, plus any
 * condition-level warning (e.g. pregnancy fish). Soft cautions (sugar, salt)
 * do not count.
 */
export function findHardConflicts(
  names: string[],
  opts: { conditions?: string[] | null; dietType?: string | null },
): HealthAlert[] {
  return evaluateHealthAlerts({
    ingredients: names,
    conditions: opts.conditions ?? [],
    dietType: opts.dietType ?? null,
  }).filter((a) => a.appliesToKind === "allergy" || a.appliesToKind === "diet" || (a.appliesToKind === "condition" && a.severity === "warning") || (a.appliesToKind === "condition" && /^allergy\.gluten/.test(a.id)));
}

/** Plain-language constraints for LLM prompts, derived from conditions and diet. */
export function describeDietaryConstraints(conditions: unknown, dietType?: string | null): string[] {
  const c = detectConditions(conditions);
  const d = detectDiet(dietType);
  const out: string[] = [];
  const add = (k: CondKey, s: string) => {
    if (c.has(k)) out.push(s);
  };
  add("peanut", "No peanuts or peanut-derived ingredients.");
  add("tree_nut", "No tree nuts or ingredients that may contain them.");
  add("soy", "No soy products (tofu, soy sauce, miso, tempeh, edamame).");
  add("sesame", "No sesame, tahini or sesame oil.");
  add("egg", "No eggs or egg-derived ingredients.");
  add("shellfish", "No shellfish.");
  add("fish", "No fish or fish sauce.");
  add("dairy_allergy", "No milk or dairy ingredients (use plant-based alternatives).");
  add("lactose", "Avoid lactose-heavy ingredients (milk, cream); prefer lactose-free or plant-based alternatives.");
  add("celiac", "Strictly gluten-free: no wheat, barley, rye, malt, semolina or regular oats.");
  add("gluten_sens", "Gluten-free: no wheat, barley, rye, malt or semolina.");
  add("wheat_allergy", "No wheat or wheat-derived ingredients.");
  add("diabetes", "Keep added sugar minimal; no sugar, honey or syrups.");
  add("prediabetes", "Keep added sugar minimal; no sugar, honey or syrups.");
  add("hypertension", "Keep added salt low; no salt substitutes, no stock cubes or soy sauce.");
  add("ckd", "No potassium chloride salt substitutes; keep added salt low.");
  add("cholesterol", "Use little saturated fat; avoid butter, ghee and cream.");
  add("gout", "Avoid offal, anchovies, sardines and beer.");
  add("pregnancy", "Pregnancy: cook everything thoroughly; no raw or undercooked eggs, meat or fish, no unpasteurised dairy, no liver or pate, no alcohol, no shark, swordfish or marlin.");
  if (d === "vegan") out.push("Vegan: no meat, fish, dairy, eggs, honey or gelatin.");
  if (d === "veg") out.push("Vegetarian: no meat, fish or gelatin.");
  return out;
}
