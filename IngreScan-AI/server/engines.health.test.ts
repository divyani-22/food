import { describe, it, expect } from "vitest";
import {
  evaluateHealthAlerts,
  detectConditions,
  detectMedications,
  describeDietaryConstraints,
  findHardConflicts,
  HEALTH_DISCLAIMER,
  FSA_THRESHOLDS,
  type HealthInput,
} from "../shared/engines/healthRules";

const ids = (r: ReturnType<typeof evaluateHealthAlerts>) => r.map((a) => a.id);
const ev = (i: Partial<HealthInput>) => evaluateHealthAlerts({ ingredients: [], conditions: [], ...i } as HealthInput);

function assertClean(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).toMatch(/^[\x20-\x7e]*$/);
  expect(json).not.toMatch(/\bsafe\b/i);
}

describe("condition and medication detection", () => {
  it.each([
    ["Type 2 diabetes", "diabetes"],
    ["T2D", "diabetes"],
    ["DM", "diabetes"],
    ["diabetic", "diabetes"],
    ["gestational diabetes", "diabetes"],
    ["prediabetes", "prediabetes"],
    ["Pre-diabetes", "prediabetes"],
    ["HTN", "hypertension"],
    ["high BP", "hypertension"],
    ["BP", "hypertension"],
    ["High blood pressure", "hypertension"],
    ["Hypertension", "hypertension"],
    ["Coeliac", "celiac"],
    ["celiac disease", "celiac"],
    ["gluten intolerance", "gluten_sens"],
    ["lactose intolerant", "lactose"],
    ["milk allergy", "dairy_allergy"],
    ["allergic to milk", "dairy_allergy"],
    ["peanut allergy", "peanut"],
    ["tree nuts", "tree_nut"],
    ["soya allergy", "soy"],
    ["egg allergy", "egg"],
    ["shrimp allergy", "shellfish"],
    ["fish allergy", "fish"],
    ["Pregnant", "pregnancy"],
    ["expecting", "pregnancy"],
    ["CKD", "ckd"],
    ["chronic kidney disease", "ckd"],
    ["High cholesterol", "cholesterol"],
    ["gout", "gout"],
  ])("%s -> %s", (text, key) => {
    expect(detectConditions([text]).has(key as never)).toBe(true);
  });

  it("does not over-match", () => {
    expect(detectConditions(["diabetes insipidus"]).has("diabetes")).toBe(false);
    expect(detectConditions(["pre-diabetes"]).has("diabetes")).toBe(false);
    expect(detectConditions(["low BP"]).has("hypertension")).toBe(false);
    expect(detectConditions(["low blood pressure"]).has("hypertension")).toBe(false);
    expect(detectConditions(["kidney stones"]).has("ckd")).toBe(false);
    expect(detectConditions(["eggplant preference"]).has("egg")).toBe(false);
    expect(detectConditions(["asthma", "migraine"]).size).toBe(0);
  });

  it("treats a generic nut allergy as peanut and tree nut", () => {
    const c = detectConditions(["nut allergy"]);
    expect(c.has("peanut")).toBe(true);
    expect(c.has("tree_nut")).toBe(true);
  });

  it("handles several conditions in one string", () => {
    const c = detectConditions(["Type 2 diabetes, hypertension and high cholesterol"]);
    expect(c.has("diabetes") && c.has("hypertension") && c.has("cholesterol")).toBe(true);
  });

  it.each([
    ["Coumadin 5mg", "warfarin"],
    ["Jantoven", "warfarin"],
    ["WARFARIN sodium", "warfarin"],
    ["Acitrom 2", "warfarin"],
    ["Simvastatin 20 mg", "statin_strong"],
    ["Lipitor", "statin_atorva"],
    ["Losartan 50mg", "raas"],
    ["Ramipril", "raas"],
    ["Spironolactone", "raas"],
    ["Nardil", "maoi"],
    ["Synthroid 75mcg", "levothyroxine"],
    ["Thyronorm", "levothyroxine"],
  ])("medication %s -> %s", (name, key) => {
    expect(detectMedications([{ name }]).has(key as never)).toBe(true);
  });

  it("only counts current medications and ignores metformin", () => {
    expect(detectMedications([{ name: "warfarin", isCurrent: false }]).size).toBe(0);
    expect(detectMedications([{ name: "warfarin", isCurrent: true }]).size).toBe(1);
    expect(detectMedications([{ name: "warfarin" }]).size).toBe(1);
    expect(detectMedications([{ name: "Metformin 500mg" }]).size).toBe(0);
    expect(detectMedications(null)).toEqual(new Set());
  });
});

describe("diabetes and sugar", () => {
  it("flags added sugar synonyms", () => {
    const r = ev({ conditions: ["Type 2 diabetes"], ingredients: [{ name: "Water" }, { name: "Maltodextrin" }, { name: "High Fructose Corn Syrup" }, { name: "Jaggery" }, { name: "Honey" }] });
    const a = r.find((x) => x.id === "glycemic.added_sugar")!;
    expect(a).toBeDefined();
    expect(a.severity).toBe("caution");
    expect(a.trigger).toContain("Maltodextrin");
    expect(a.trigger).toContain("Jaggery");
    expect(a.appliesTo).toBe("diabetes");
    expect(a.appliesToKind).toBe("condition");
    expect(a.source).toMatch(/NHS|American Diabetes Association/);
  });

  it.each(["Dextrose", "Glucose syrup", "Invert sugar", "Cane sugar", "Sucrose", "Gur", "Molasses", "Agave syrup", "sugars"])("flags %s", (n) => {
    expect(ids(ev({ conditions: ["diabetic"], ingredients: [{ name: n }] }))).toContain("glycemic.added_sugar");
  });

  it("does not flag sugar-free claims", () => {
    for (const n of ["Sugar free sweetener", "no added sugar", "Unsweetened soy milk", "sugar-free"]) {
      expect(ids(ev({ conditions: ["diabetes"], ingredients: [{ name: n }] })), n).not.toContain("glycemic.added_sugar");
    }
  });

  it("does nothing without the condition", () => {
    expect(ev({ ingredients: [{ name: "Sugar" }] })).toEqual([]);
    expect(ev({ conditions: ["asthma"], ingredients: [{ name: "Sugar" }] })).toEqual([]);
  });

  it("applies FSA sugar thresholds strictly (food)", () => {
    expect(FSA_THRESHOLDS.food.sugars).toBe(22.5);
    expect(ids(ev({ conditions: ["diabetes"], nutriments: { sugars: 22.5 } }))).not.toContain("nutrient.sugars_high");
    expect(ids(ev({ conditions: ["diabetes"], nutriments: { sugars: 22.51 } }))).toContain("nutrient.sugars_high");
    expect(ids(ev({ conditions: ["prediabetes"], nutriments: { sugars: 40 } }))).toContain("nutrient.sugars_high");
  });

  it("uses the lower drink thresholds", () => {
    expect(ids(ev({ conditions: ["diabetes"], isBeverage: true, nutriments: { sugars: 11.25 } }))).not.toContain("nutrient.sugars_high");
    const r = ev({ conditions: ["diabetes"], isBeverage: true, nutriments: { sugars: 11.26 } });
    expect(ids(r)).toContain("nutrient.sugars_high");
    expect(r[0].message).toContain("100 ml");
  });

  it("ignores invalid nutrient values", () => {
    for (const v of [NaN, Infinity, -5, "30" as unknown as number, null, undefined]) {
      expect(ids(ev({ conditions: ["diabetes"], nutriments: { sugars: v } }))).not.toContain("nutrient.sugars_high");
    }
  });
});

describe("hypertension and salt", () => {
  it("applies FSA salt thresholds strictly", () => {
    expect(ids(ev({ conditions: ["HTN"], nutriments: { salt: 1.5 } }))).not.toContain("nutrient.salt_high");
    expect(ids(ev({ conditions: ["HTN"], nutriments: { salt: 1.51 } }))).toContain("nutrient.salt_high");
    expect(ids(ev({ conditions: ["HTN"], isBeverage: true, nutriments: { salt: 0.76 } }))).toContain("nutrient.salt_high");
  });

  it("derives salt from sodium (salt = sodium x 2.5)", () => {
    expect(ids(ev({ conditions: ["HTN"], nutriments: { sodium: 0.61 } }))).toContain("nutrient.salt_high");
    expect(ids(ev({ conditions: ["HTN"], nutriments: { sodium: 0.4 } }))).not.toContain("nutrient.salt_high");
  });

  it("flags MSG and nitrite additives by name and by code", () => {
    for (const n of ["Monosodium Glutamate", "Flavour enhancer (E621)", "INS 621", "Sodium Nitrite", "E250", "sodium benzoate"]) {
      expect(ids(ev({ conditions: ["high blood pressure"], ingredients: [{ name: n }] })), n).toContain("sodium.additives");
    }
  });

  it("does not flag non-sodium glutamates", () => {
    expect(ids(ev({ conditions: ["HTN"], ingredients: [{ name: "E622" }, { name: "Magnesium diglutamate (E625)" }] }))).not.toContain("sodium.additives");
  });

  it("notes salt in the ingredients only when no salt data exists", () => {
    expect(ids(ev({ conditions: ["HTN"], ingredients: [{ name: "Sea salt" }] }))).toContain("sodium.salt_listed");
    expect(ids(ev({ conditions: ["HTN"], ingredients: [{ name: "Sea salt" }], nutriments: { salt: 0.3 } }))).not.toContain("sodium.salt_listed");
  });
});

describe("celiac and gluten", () => {
  it("flags wheat, barley, malt, semolina as warning for celiac", () => {
    const r = ev({ conditions: ["Coeliac"], ingredients: [{ name: "Wheat Flour" }, { name: "Barley malt extract" }, { name: "Suji" }] });
    const a = r.find((x) => x.id === "allergy.gluten.celiac")!;
    expect(a.severity).toBe("warning");
    expect(a.source).toContain("Celiac Disease Foundation");
  });

  it("gives gluten sensitivity a lower severity", () => {
    const a = ev({ conditions: ["gluten sensitivity"], ingredients: [{ name: "rye" }] }).find((x) => x.id === "allergy.gluten.sensitivity")!;
    expect(a.severity).toBe("caution");
  });

  it("includes the oats caveat and respects gluten-free labels", () => {
    const a = ev({ conditions: ["celiac"], ingredients: [{ name: "Rolled oats" }] }).find((x) => x.id === "allergy.gluten.celiac")!;
    expect(a.severity).toBe("caution");
    expect(a.message).toMatch(/oats/i);
    expect(ids(ev({ conditions: ["celiac"], ingredients: [{ name: "Gluten free oats" }] }))).toEqual([]);
  });

  it("does not flag buckwheat or rice flour", () => {
    expect(ev({ conditions: ["celiac"], ingredients: [{ name: "Buckwheat flour" }, { name: "Rice flour" }, { name: "Maltodextrin" }] })).toEqual([]);
  });

  it("flags unspecified flour as a caution", () => {
    expect(ev({ conditions: ["celiac"], ingredients: [{ name: "Flour" }] })[0].severity).toBe("caution");
  });

  it("uses allergen tags with the en: prefix", () => {
    const r = ev({ conditions: ["celiac"], allergensTags: ["en:gluten"] });
    expect(r[0].severity).toBe("warning");
    expect(r[0].trigger).toContain("en:gluten".replace("en:", ""));
    expect(ev({ conditions: ["celiac"], allergensTags: ["en:milk"] })).toEqual([]);
  });
});

describe("dairy, lactose and other allergies", () => {
  it("separates dairy allergy from lactose intolerance", () => {
    const allergy = ev({ conditions: ["milk allergy"], ingredients: [{ name: "Whey protein" }, { name: "Butter" }] });
    expect(allergy[0].id).toBe("allergy.milk");
    expect(allergy[0].severity).toBe("warning");
    const lactose = ev({ conditions: ["lactose intolerant"], ingredients: [{ name: "Butter" }, { name: "Ghee" }] });
    expect(lactose[0].severity).toBe("info");
    const lactose2 = ev({ conditions: ["lactose intolerant"], ingredients: [{ name: "Skimmed milk powder" }] });
    expect(lactose2[0].severity).toBe("caution");
  });

  it("does not treat plant milks, cocoa butter or cream of tartar as dairy", () => {
    const r = ev({ conditions: ["milk allergy"], ingredients: [{ name: "Coconut milk" }, { name: "Soy milk" }, { name: "Cocoa butter" }, { name: "Peanut butter" }, { name: "Cream of tartar" }, { name: "Oat milk" }] });
    expect(r).toEqual([]);
  });

  it("still flags milk chocolate and dairy milk", () => {
    expect(ids(ev({ conditions: ["milk allergy"], ingredients: [{ name: "Milk chocolate" }] }))).toContain("allergy.milk");
    expect(ids(ev({ conditions: ["milk allergy"], ingredients: [{ name: "Dairy Milk" }] }))).toContain("allergy.milk");
  });

  it("respects lactose-free labels for lactose intolerance only", () => {
    expect(ev({ conditions: ["lactose intolerance"], ingredients: [{ name: "Lactose free milk" }] })).toEqual([]);
    expect(ids(ev({ conditions: ["milk allergy"], ingredients: [{ name: "Lactose free milk" }] }))).toContain("allergy.milk");
  });

  it("flags peanut, tree nut but not coconut", () => {
    expect(ids(ev({ conditions: ["peanut allergy"], ingredients: [{ name: "Peanut oil" }] }))).toContain("allergy.peanut");
    expect(ids(ev({ conditions: ["tree nut allergy"], ingredients: [{ name: "Cashew paste" }] }))).toContain("allergy.tree_nut");
    expect(ev({ conditions: ["tree nut allergy"], ingredients: [{ name: "Coconut" }, { name: "Nutmeg" }, { name: "Butternut squash" }] })).toEqual([]);
    expect(ev({ conditions: ["nut allergy"], ingredients: [{ name: "Almond milk" }] }).map((a) => a.id)).toContain("allergy.tree_nut");
  });

  it("treats unspecified nuts as a caution", () => {
    const a = ev({ conditions: ["peanut allergy"], ingredients: [{ name: "Mixed nuts" }] })[0];
    expect(a.severity).toBe("caution");
  });

  it("flags soy, egg, fish and shellfish, not eggplant", () => {
    expect(ids(ev({ conditions: ["soy allergy"], ingredients: [{ name: "Soy lecithin" }, { name: "Tofu" }] }))).toContain("allergy.soy");
    expect(ids(ev({ conditions: ["egg allergy"], ingredients: [{ name: "Egg white powder" }, { name: "Mayonnaise" }] }))).toContain("allergy.egg");
    expect(ev({ conditions: ["egg allergy"], ingredients: [{ name: "Eggplant" }] })).toEqual([]);
    expect(ids(ev({ conditions: ["fish allergy"], ingredients: [{ name: "Worcestershire sauce" }] }))).toContain("allergy.fish");
    const sf = ev({ conditions: ["shellfish allergy"], ingredients: [{ name: "Prawns" }, { name: "Mussels" }] });
    expect(sf[0].severity).toBe("warning");
    expect(ev({ conditions: ["shellfish allergy"], ingredients: [{ name: "Mussels" }] })[0].severity).toBe("caution");
  });

  it("matches allergen tags for allergies", () => {
    for (const [cond, tag, id] of [
      ["peanut allergy", "en:peanuts", "allergy.peanut"],
      ["egg allergy", "en:eggs", "allergy.egg"],
      ["soy allergy", "en:soybeans", "allergy.soy"],
      ["milk allergy", "en:milk", "allergy.milk"],
      ["fish allergy", "en:fish", "allergy.fish"],
      ["shellfish allergy", "en:crustaceans", "allergy.shellfish"],
      ["tree nut allergy", "en:nuts", "allergy.tree_nut"],
    ]) {
      expect(ids(ev({ conditions: [cond], allergensTags: [tag] })), cond).toContain(id);
    }
  });
});

describe("pregnancy", () => {
  it("flags mercury fish, soft cheese, liver, caffeine and alcohol", () => {
    const r = ev({ conditions: ["Pregnant"], ingredients: [{ name: "Swordfish" }, { name: "Brie" }, { name: "Chicken liver pate" }, { name: "Coffee" }, { name: "Red wine" }] });
    for (const id of ["pregnancy.mercury_fish", "pregnancy.listeria", "pregnancy.vitamin_a", "pregnancy.caffeine", "pregnancy.alcohol"]) {
      expect(ids(r), id).toContain(id);
    }
    expect(r[0].severity).toBe("warning");
    expect(r.every((a) => a.source.includes("NHS") || a.source.includes("FDA"))).toBe(true);
  });

  it("is conservative about tea, herbal tea, retinol and beta-carotene", () => {
    expect(ev({ conditions: ["pregnant"], ingredients: [{ name: "Herbal tea" }, { name: "Chamomile tea" }, { name: "Vitamin A (as beta carotene)" }, { name: "Brussels sprouts" }] })).toEqual([]);
    expect(ev({ conditions: ["pregnant"], ingredients: [{ name: "Black tea" }] })[0].severity).toBe("info");
    expect(ev({ conditions: ["pregnant"], ingredients: [{ name: "Vitamin A palmitate" }] })[0].severity).toBe("info");
  });

  it("flags unpasteurised products and raw sprouts", () => {
    expect(ids(ev({ conditions: ["expecting"], ingredients: [{ name: "Unpasteurised goat milk" }] }))).toContain("pregnancy.listeria");
    expect(ids(ev({ conditions: ["expecting"], ingredients: [{ name: "Alfalfa sprouts" }] }))).toContain("pregnancy.sprouts");
  });

  it("does not treat root beer or ginger beer as alcohol", () => {
    expect(ev({ conditions: ["pregnant"], ingredients: [{ name: "Root beer" }, { name: "Ginger beer" }, { name: "Wine vinegar" }] })).toEqual([]);
  });

  it("limits tuna as info only", () => {
    expect(ev({ conditions: ["pregnant"], ingredients: [{ name: "Tuna" }] })[0].severity).toBe("info");
  });
});

describe("kidney, cholesterol and gout", () => {
  it("flags potassium chloride and phosphate additives for CKD", () => {
    const r = ev({ conditions: ["CKD"], ingredients: [{ name: "Potassium chloride" }, { name: "Phosphoric acid" }, { name: "E450" }] });
    expect(ids(r)).toEqual(expect.arrayContaining(["ckd.potassium", "ckd.phosphate"]));
    expect(r.every((a) => a.severity === "caution")).toBe(true);
  });

  it("flags trans fat and saturated fat sources", () => {
    const r = ev({ conditions: ["high cholesterol"], ingredients: [{ name: "Partially hydrogenated soybean oil" }, { name: "Palm oil" }, { name: "Peanut butter" }] });
    expect(r.find((a) => a.id === "lipid.trans_fat")!.severity).toBe("caution");
    const sat = r.find((a) => a.id === "lipid.saturated_fat_sources")!;
    expect(sat.trigger).toContain("Palm oil");
    expect(sat.trigger).not.toContain("Peanut butter");
    expect(ev({ conditions: ["cholesterol"], ingredients: [{ name: "Hydrogenated vegetable oil" }] })[0].severity).toBe("info");
  });

  it("applies saturates thresholds strictly", () => {
    expect(ids(ev({ conditions: ["high cholesterol"], nutriments: { saturatedFat: 5 } }))).not.toContain("nutrient.saturates_high");
    expect(ids(ev({ conditions: ["high cholesterol"], nutriments: { saturatedFat: 5.1 } }))).toContain("nutrient.saturates_high");
    expect(ids(ev({ conditions: ["high cholesterol"], isBeverage: true, nutriments: { saturatedFat: 2.6 } }))).toContain("nutrient.saturates_high");
  });

  it("flags purine-rich items for gout but not kidney beans", () => {
    expect(ids(ev({ conditions: ["gout"], ingredients: [{ name: "Sardines" }, { name: "Beer" }] }))).toContain("gout.purines");
    expect(ev({ conditions: ["gout"], ingredients: [{ name: "Kidney beans" }] })).toEqual([]);
  });
});

describe("medication interactions", () => {
  it("warfarin with vitamin K greens is a caution about consistency", () => {
    const a = ev({ medications: [{ name: "Coumadin 5 mg" }], ingredients: [{ name: "Spinach" }, { name: "Kale" }] })[0];
    expect(a.id).toBe("med.warfarin.vitamin_k");
    expect(a.severity).toBe("caution");
    expect(a.message).toMatch(/consistent/i);
    expect(a.appliesToKind).toBe("medication");
  });

  it("ignores stopped medications", () => {
    expect(ev({ medications: [{ name: "warfarin", isCurrent: false }], ingredients: [{ name: "Spinach" }] })).toEqual([]);
  });

  it("statins with grapefruit: simvastatin stronger than atorvastatin", () => {
    const sim = ev({ medications: [{ name: "simvastatin" }], ingredients: [{ name: "Grapefruit juice" }] })[0];
    const ato = ev({ medications: [{ name: "Atorvastatin" }], ingredients: [{ name: "Grapefruit juice" }] })[0];
    expect(sim.severity).toBe("caution");
    expect(ato.severity).toBe("info");
    expect(ato.message).toMatch(/weaker|large amounts/i);
    expect(ids(ev({ medications: [{ name: "simvastatin" }], ingredients: [{ name: "Pomelo" }] }))).toContain("med.statin.grapefruit");
  });

  it("ACE inhibitors / ARBs with potassium salt substitutes", () => {
    for (const med of ["Lisinopril", "Losartan 50mg", "Spironolactone"]) {
      expect(ids(ev({ medications: [{ name: med }], ingredients: [{ name: "Potassium chloride" }] })), med).toContain("med.raas.potassium");
    }
  });

  it("MAOIs with tyramine foods", () => {
    const r = ev({ medications: [{ name: "Phenelzine" }], ingredients: [{ name: "Aged cheddar" }, { name: "Soy sauce" }] });
    expect(r[0].id).toBe("med.maoi.tyramine");
    expect(r[0].severity).toBe("warning");
    expect(r[0].source).toContain("Mayo Clinic");
  });

  it("levothyroxine is info only", () => {
    const a = ev({ medications: [{ name: "Synthroid" }], ingredients: [{ name: "Soy protein isolate" }] })[0];
    expect(a.severity).toBe("info");
  });

  it("metformin produces no alerts", () => {
    expect(ev({ medications: [{ name: "Metformin" }], ingredients: [{ name: "Sugar" }, { name: "Spinach" }] })).toEqual([]);
  });
});

describe("diet type", () => {
  it("flags animal-derived ingredients for vegan and vegetarian", () => {
    const vegan = ev({ dietType: "vegan", ingredients: [{ name: "Honey" }, { name: "Whey" }, { name: "Almond milk" }] });
    expect(vegan[0].appliesToKind).toBe("diet");
    expect(vegan[0].trigger).toContain("Honey");
    expect(vegan[0].trigger).not.toContain("Almond");
    expect(ids(ev({ dietType: "veg", ingredients: [{ name: "Gelatin" }] }))).toContain("diet.veg");
    expect(ev({ dietType: "veg", ingredients: [{ name: "Milk" }, { name: "Paneer" }] })).toEqual([]);
    expect(ev({ dietType: "non_veg", ingredients: [{ name: "Chicken" }] })).toEqual([]);
  });

  it("reads dietType from the profile", () => {
    expect(ids(ev({ profile: { dietType: "vegan" }, ingredients: [{ name: "Gelatine" }] }))).toContain("diet.vegan");
  });
});

describe("structure, sorting and robustness", () => {
  it("every alert has all fields and the disclaimer", () => {
    const r = ev({
      conditions: ["T2D", "HTN", "pregnant", "celiac", "peanut allergy"],
      medications: [{ name: "Warfarin" }],
      ingredients: [{ name: "Wheat flour" }, { name: "Peanuts" }, { name: "Sugar" }, { name: "Spinach" }, { name: "Swordfish" }, { name: "MSG" }],
      nutriments: { sugars: 30, salt: 2 },
    });
    expect(r.length).toBeGreaterThan(5);
    for (const a of r) {
      for (const k of ["id", "severity", "title", "message", "trigger", "reason", "source", "appliesTo", "appliesToKind", "disclaimer"] as const) {
        expect(a[k], `${a.id}.${k}`).toBeTruthy();
      }
      expect(a.disclaimer).toBe(HEALTH_DISCLAIMER);
    }
    assertClean(r);
  });

  it("sorts by severity then id, without duplicate ids", () => {
    const r = ev({
      conditions: ["T2D", "HTN", "pregnant", "celiac", "peanut allergy"],
      ingredients: [{ name: "Wheat flour" }, { name: "Peanuts" }, { name: "Sugar" }, { name: "Swordfish" }, { name: "MSG" }, { name: "Coffee" }],
    });
    const rank = { warning: 0, caution: 1, info: 2 } as const;
    for (let i = 1; i < r.length; i++) expect(rank[r[i - 1].severity]).toBeLessThanOrEqual(rank[r[i].severity]);
    expect(new Set(ids(r)).size).toBe(r.length);
  });

  it("never claims anything is safe and the disclaimer says it is not advice", () => {
    expect(HEALTH_DISCLAIMER).toMatch(/not medical advice/i);
    const r = ev({ conditions: ["celiac", "pregnant", "T2D", "CKD", "gout", "HTN", "high cholesterol", "milk allergy"], medications: [{ name: "warfarin" }, { name: "phenelzine" }], ingredients: [{ name: "Wheat" }, { name: "Brie" }, { name: "Sugar" }, { name: "Potassium chloride" }, { name: "Beer" }, { name: "Spinach" }, { name: "Palm oil" }, { name: "Milk" }] });
    assertClean(r);
  });

  it("is deterministic and order independent", () => {
    const base = { conditions: ["T2D", "celiac"], ingredients: [{ name: "Wheat" }, { name: "Sugar" }, { name: "Honey" }] };
    const a = ev(base);
    const b = ev({ ...base, ingredients: [...base.ingredients].reverse() });
    expect(a.map((x) => [x.id, x.severity])).toEqual(b.map((x) => [x.id, x.severity]));
    expect(ev(base)).toEqual(a);
  });

  it("handles empty and malformed input", () => {
    expect(ev({})).toEqual([]);
    expect(evaluateHealthAlerts(null as unknown as HealthInput)).toEqual([]);
    expect(evaluateHealthAlerts({} as HealthInput)).toEqual([]);
    expect(ev({ conditions: ["diabetes"], ingredients: [] })).toEqual([]);
    expect(ev({ conditions: ["diabetes"], ingredients: [null, undefined, 5, {}, { name: 7 }, ""] as never })).toEqual([]);
    expect(ev({ conditions: [null, 5, {}] as never, ingredients: [{ name: "sugar" }] })).toEqual([]);
    expect(ev({ conditions: "diabetes" as never, ingredients: [{ name: "sugar" }] })).toEqual([]);
  });

  it("accepts plain string ingredients", () => {
    expect(ids(ev({ conditions: ["diabetes"], ingredients: ["sugar"] as never }))).toContain("glycemic.added_sugar");
  });

  it("is safe against hostile strings and prototype keys", () => {
    const evil = ["__proto__", "constructor", "prototype", "toString", "\u{1F600}", "\u7CD6", "x".repeat(200_000)];
    expect(() => ev({ conditions: evil, ingredients: evil.map((name) => ({ name })), medications: evil.map((name) => ({ name })), allergensTags: evil })).not.toThrow();
    expect(ev({ conditions: evil, ingredients: evil.map((name) => ({ name })), medications: evil.map((name) => ({ name })), allergensTags: evil })).toEqual([]);
    const nut = JSON.parse('{"__proto__": {"sugars": 99}, "constructor": 5}');
    expect(ev({ conditions: ["diabetes"], nutriments: nut })).toEqual([]);
    expect(({} as Record<string, unknown>).sugars).toBeUndefined();
  });

  it("strips non-ASCII from echoed triggers", () => {
    const r = ev({ conditions: ["diabetes"], ingredients: [{ name: "Sugar \u{1F36C} \u7CD6" }] });
    expect(r[0].trigger).toBe("Sugar");
    assertClean(r);
  });

  it("caps the number of listed triggers", () => {
    const names = Array.from({ length: 30 }, (_, i) => ({ name: `sugar ${i}` }));
    const a = ev({ conditions: ["diabetes"], ingredients: names })[0];
    expect(a.trigger.split(";").length).toBeLessThanOrEqual(6);
  });

  it("handles unicode accents in ingredient names", () => {
    expect(ids(ev({ conditions: ["pregnant"], ingredients: [{ name: "Pâté de foie" }] }))).toContain("pregnancy.listeria");
  });
});

describe("dietary constraint helpers", () => {
  it("describes constraints in plain English", () => {
    const c = describeDietaryConstraints(["peanut allergy", "celiac", "T2D"], "vegan");
    expect(c.join(" ")).toMatch(/peanut/i);
    expect(c.join(" ")).toMatch(/gluten/i);
    expect(c.join(" ")).toMatch(/Vegan/);
    expect(describeDietaryConstraints([], null)).toEqual([]);
    expect(describeDietaryConstraints("x", "keto")).toEqual([]);
  });

  it("finds hard conflicts only (not sugar or salt cautions)", () => {
    expect(findHardConflicts(["peanut oil"], { conditions: ["peanut allergy"] })).toHaveLength(1);
    expect(findHardConflicts(["sugar", "salt"], { conditions: ["diabetes", "HTN"] })).toEqual([]);
    expect(findHardConflicts(["cheese"], { conditions: [], dietType: "vegan" })).toHaveLength(1);
    expect(findHardConflicts(["wheat"], { conditions: ["celiac"] })).toHaveLength(1);
    expect(findHardConflicts(["rolled oats"], { conditions: ["celiac"] })).toHaveLength(1);
    expect(findHardConflicts(["swordfish"], { conditions: ["pregnant"] })).toHaveLength(1);
  });
});
