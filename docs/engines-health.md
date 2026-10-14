# Health and storage engines: ethylene, health rules, fridge rescue

Pure TypeScript modules in `IngreScan-AI/shared/engines/` (no I/O, no framework imports, deterministic; `now` is injected where time matters). Import from `@shared/engines` (client or server). Tests: `server/engines.ethylene.test.ts`, `engines.health.test.ts`, `engines.rescue.test.ts`.

All text is English and ASCII only. Health output is informational: it flags concerns and never states that a food is "safe" for anyone. Every health alert carries `HEALTH_DISCLAIMER`.

## 1. Ethylene companion storage (`ethylene.ts`)

API: `analyzeEthyleneStorage(items)`, `ethyleneProfile(name)`, `canonicalProduceKey(name)`, `ETHYLENE_TABLE`.

Ratings follow the UC Davis Postharvest Technology ethylene classes (Kader, Postharvest Technology of Horticultural Crops). Production: UC Davis "very low" is shown as `none`; low, moderate and high are kept; "very high" is shown as `high`. Sensitivity ratings summarise the commonly documented damage.

Alert rule: for two items in the same space (default fridge; freezer ignored), raise an alert when the producer is `moderate` or `high` and the other item's sensitivity is `moderate` or `high`.

- `kind: "damage"` (the sensitive item is a vegetable or non-ripening fruit): `warning` when production + sensitivity score is 5 or more (high+moderate, moderate+high, high+high), otherwise `info`.
- `kind: "ripening"` (the sensitive item is a fruit that ripens with ethylene): always `info`; the advice offers the deliberate option (closed paper bag at room temperature to ripen avocado, pear, kiwi, etc.) or separation to slow ripening. Mutual pairs (banana + avocado) produce one alert.
- No numeric "x% faster" claims are made anywhere.

| Item | Production | Sensitivity | Typical damage / note |
|---|---|---|---|
| Apple | high | moderate | loss of firmness, mealy texture |
| Banana | moderate (rises sharply when ripe) | high | faster ripening, browning |
| Mango | moderate (rises when ripe) | high | faster ripening, softening |
| Tomato | moderate (rises when ripe) | moderate | faster ripening, softening |
| Avocado | high (ripe) | high | faster ripening, over-softening |
| Pear, peach/nectarine, plum/apricot, kiwi, papaya | high | high | faster ripening / softening |
| Melon (cantaloupe, muskmelon, honeydew) | high | moderate | faster softening |
| Bell pepper (capsicum) | none | moderate | colour change, calyx deterioration |
| Carrot | none | moderate | bitter taste (isocoumarin) |
| Cucumber | low | high | yellowing, decay |
| Spinach, kale/chard/collards/mustard greens, lettuce/salad greens | none | high | yellowing, wilting, russet spotting (lettuce) |
| Broccoli, Brussels sprouts, cabbage/bok choy, leafy herbs (parsley, cilantro, dill, mint), asparagus | none | high | yellowing; asparagus toughens |
| Cauliflower, green beans, zucchini, eggplant, watermelon, lemon/lime | none to low | moderate | yellowing, decay, softening, off-flavour |
| Orange and other citrus, strawberry, grapes, berries, onion, garlic, sweet potato, celery, mushroom, pumpkin, pineapple | none to low | low | no alert |
| Potato | none | low (mixed evidence) | no alert, see omitted list |

Name matching: lowercase, accents stripped, plural/singular, longest-phrase synonyms (capsicum, aubergine, brinjal, courgette, palak, aloo, tamatar, kela, etc.), and a one-letter typo tolerance for single words of 5+ letters when the match is unique. Processed forms (juice, sauce, jam, chips, dried, frozen, canned, ketchup...) never match. Lookups use `Map`, so keys such as `__proto__` are inert.

## 2. Personal health alerts (`healthRules.ts`)

API: `evaluateHealthAlerts(input)`, `findHardConflicts(names, {conditions, dietType})`, `describeDietaryConstraints(conditions, dietType)`, `detectConditions`, `detectMedications`, `HEALTH_DISCLAIMER`, `FSA_THRESHOLDS`.

Alert shape: `{id, severity: info|caution|warning, title, message, trigger, reason, source, appliesTo, appliesToKind: condition|allergy|medication|diet, disclaimer}`. One alert per rule (matched ingredients are listed together in `trigger`, at most five). Sorted by severity then id. Only medications with `isCurrent !== false` count. Condition text is matched fuzzily (lowercase, abbreviations such as T2D, DM, HTN, high BP, CKD, coeliac, expecting; "low BP", "diabetes insipidus" and "kidney stones" are deliberately not matched). Ingredient `riskLevel` and `category` are accepted but not used by any rule.

Nutrients are per 100 g (per 100 ml with `isBeverage: true`) and compared strictly greater than the UK FSA front-of-pack "high" cut-offs. Salt is derived as sodium x 2.5 when only sodium is given.

| Cut-off (g per 100 g) | Food | Drink (per 100 ml) |
|---|---|---|
| Sugars | 22.5 | 11.25 |
| Salt | 1.5 | 0.75 |
| Saturates | 5 | 2.5 |
| Total fat (exported, not used by a rule) | 17.5 | 8.75 |

### Rules

| Rule id | Applies to | Triggers | Severity | Source |
|---|---|---|---|---|
| glycemic.added_sugar | diabetes, prediabetes | sugar, cane/brown/icing/coconut sugar, sucrose, dextrose, glucose (syrup), fructose, maltose, maltodextrin, HFCS, corn/rice/malt/maple/date syrup, agave, honey, jaggery/gur/gud, molasses, treacle, panela, fruit juice concentrate (not "sugar free", "no added sugar", "unsweetened") | caution | NHS (free sugars); ADA |
| nutrient.sugars_high | diabetes, prediabetes | sugars above cut-off | caution | UK FSA / NHS |
| sodium.additives | hypertension, CKD | MSG (E621), disodium guanylate/inosinate/ribonucleotides (E627, E631, E635), sodium benzoate (E211), sodium nitrite/nitrate (E250, E251), cured meats | info | WHO; NHS |
| sodium.salt_listed | hypertension, CKD | salt, soy sauce, fish sauce, stock cube, brine (only when no salt/sodium value given) | info | WHO; NHS |
| nutrient.salt_high | hypertension, CKD | salt above cut-off | caution | UK FSA / NHS; WHO |
| lipid.trans_fat | high cholesterol / heart disease | partially hydrogenated, vanaspati (caution); hydrogenated unspecified (info) | caution / info | WHO; NHS |
| lipid.saturated_fat_sources | high cholesterol | palm oil, coconut oil, butter, ghee, lard, tallow, suet, cream (not peanut/cocoa butter) | info | NHS |
| nutrient.saturates_high | high cholesterol | saturates above cut-off | caution | UK FSA / NHS |
| allergy.gluten.celiac / .sensitivity | celiac (warning) / gluten sensitivity (caution) | wheat, barley, rye, malt, semolina/suji, durum, spelt, triticale, farro, kamut, einkorn, bulgur, couscous, seitan, atta, maida, graham, gluten; oats (caution, contamination caveat); unspecified flour; bread, pasta, noodles, roti, biscuits (caution); OFF tags en:gluten, en:wheat; skipped when labelled gluten-free | warning / caution | Celiac Disease Foundation; NHS |
| allergy.wheat | wheat allergy | wheat-derived terms, tag en:wheat | warning | FDA; NHS |
| allergy.milk | milk/dairy allergy | milk, cream, butter, cheese, yogurt, curd, dahi, paneer, ghee, whey, casein, lactose, khoa; tag en:milk (plant milks, cocoa butter, peanut butter, cream of tartar excluded) | warning | FDA; NHS |
| intolerance.lactose | lactose intolerance | lactose, milk, milk powder, cream, whey, ice cream (caution); butter, ghee, cheese, yogurt (info) | caution / info | NHS |
| allergy.peanut, .tree_nut, .soy, .egg, .shellfish, .fish | the matching allergy (free text or allergen tag) | named allergen terms (warning); unspecified nuts, lecithin/TVP, molluscs (caution). Coconut and nutmeg are not tree nuts here. | warning / caution | FDA; NHS |
| pregnancy.mercury_fish | pregnancy | shark, swordfish, marlin, king mackerel, tilefish, orange roughy | warning | NHS; FDA/EPA |
| pregnancy.tuna | pregnancy | tuna (weekly limit exists) | info | NHS |
| pregnancy.listeria | pregnancy | unpasteurised/raw milk (warning); brie, camembert, soft blue cheeses, pate (caution) | warning / caution | NHS |
| pregnancy.vitamin_a | pregnancy | liver (warning); retinol, retinyl palmitate/acetate, vitamin A (info; beta-carotene ignored) | warning / info | NHS |
| pregnancy.caffeine | pregnancy | coffee, caffeine, guarana, energy drink, yerba mate, matcha (caution); tea, cola (info; herbal and decaf ignored) | caution / info | NHS |
| pregnancy.alcohol | pregnancy | beer, wine, spirits, liqueur, cider (warning); alcohol/ethanol (caution); root beer, ginger beer, vinegar ignored | warning / caution | NHS; UK CMO |
| pregnancy.sprouts | pregnancy | alfalfa, bean sprouts, raw sprouts | info | FDA |
| ckd.potassium | CKD | potassium chloride, salt substitute, LoSalt, E508 | caution | National Kidney Foundation |
| ckd.phosphate | CKD | phosphoric acid, phosphates, polyphosphates, E338-E341, E343, E450-E452 | caution | National Kidney Foundation |
| gout.purines | gout | liver, kidney (not kidney beans), offal, anchovy, sardine, herring, mackerel, beer (caution); HFCS (info) | caution / info | NHS; ACR 2020 gout guideline |
| med.warfarin.vitamin_k | warfarin, Coumadin, Jantoven, acenocoumarol (Sintrom, Acitrom), phenprocoumon | spinach, kale, collards, mustard/turnip greens, parsley, chard, broccoli, Brussels sprouts, endive, natto, vitamin K | caution (wording stresses consistency, not avoidance) | NHS warfarin guidance |
| med.statin.grapefruit | simvastatin, lovastatin | grapefruit, pomelo, Seville/bitter orange | caution | FDA |
| med.statin.atorvastatin | atorvastatin | same | info (weaker, amount-dependent) | FDA |
| med.raas.potassium | ACE inhibitors, ARBs, spironolactone, eplerenone, amiloride, triamterene | potassium chloride salt substitutes | caution | NHS medicine leaflets |
| med.maoi.tyramine | phenelzine, tranylcypromine, isocarboxazid | aged cheese, salami, soy sauce, miso, tempeh, natto, sauerkraut, yeast extract, tap beer (warning); cheese, kimchi, beer, wine, fava beans (caution) | warning / caution | Mayo Clinic |
| med.levothyroxine.absorption | levothyroxine (Synthroid, Euthyrox, Eltroxin, Thyronorm...) | soy, calcium and iron sources | info | American Thyroid Association |
| diet.vegan / diet.veg | dietType vegan / veg | animal-derived ingredients (diet mismatch, not health) | info | Vegan Society; Vegetarian Society |

## 3. Fridge rescue (`rescue.ts`)

API: `selectRescueItems(items, now, opts)`, `buildRescuePrompt(selection, profile?, conditions?, dietType?)`, `parseRescueRecipes(text)`, `sanitizeRecipe(recipe, selection, ctx)`, `fallbackRescueRecipes(selection, dietType?, conditions?)`, `processRescueResponse(text, selection, ctx)`.

Selection:
- Days are calendar days (UTC, or shifted by `utcOffsetMinutes`). Default window is 0..3 days left; `urgent` is sorted by days left, then title, then id (default cap 12).
- Past expiry (or status `expired`) goes to `needsInspection` with a note (look, smell; discard if mouldy, slimy or off; when in doubt throw it out; "use by" is a safety date, "best before" a quality date, per the UK FSA). These items are never offered for cooking and the sanitiser rejects any recipe that uses them.
- Status `rotten` and `consumed`, invalid dates, and (by default) freezer items are excluded, with a reason in `excluded`.

LLM round trip:
- The prompt demands a JSON object, 1-3 recipes, `timeMinutes` of 15 or less, English/ASCII only, items copied from the list, and basic food safety (poultry to 74 C / 165 F, reheat until steaming hot). Constraints are derived from the health rules (allergies, gluten, dairy, added sugar, salt, kidney, pregnancy, vegan/veg, keto). Item titles are passed as JSON data and the prompt says to ignore instructions inside them.
- The parser accepts fenced JSON, prose around JSON, a bare array, a single recipe object, trailing commas, alternate key names, numeric strings and missing fields.
- The sanitiser drops (never clamps) recipes over 15 minutes, with no or invalid time, with a step longer than 15 minutes (or "hours", "overnight"), with fewer than two steps, using items not in the selection unless listed as extras, using items that need inspection, or conflicting with allergy, gluten, diet or condition-level warnings. It strips emoji and non-ASCII text, clamps lengths and counts, and always attaches the app's own food-safety note.
- `processRescueResponse` returns at most 3 recipes, the dropped ones with reasons, and falls back to offline recipes when none survive.

Offline generator: 21 templates keyed by canonical ingredient (banana, tomato, greens, milk, yogurt, paneer/tofu, cheese, bread, cooked rice, egg, potato, onion, carrot, cabbage, bell pepper, cucumber, mushroom, broccoli/cauliflower, beans/zucchini, apple/pear, soft fruit, berries, avocado, chicken). Templates are scored by urgency-weighted coverage of items not yet covered and at most 3 are returned, each marked `source: "offline"`, 15 minutes or less. Diet and condition filters drop conflicting templates (vegan, vegetarian, keto skips high-carb dishes, allergy and gluten checks). Raw rice is never used; "rice" counts only when it looks cooked or sits in the fridge, with NHS-style rice guidance (cool quickly, fridge no more than 1 day, reheat once until steaming hot).

## 4. Deliberately omitted

- **Potato ethylene alert**: the app's tip says an apple stored with potatoes helps stop sprouting; the literature on ethylene and potatoes is mixed (sprout suppression versus quality changes such as sweetening). No alert is raised and the profile carries `mixedEvidence: true`.
- **Numeric ethylene claims** ("50% faster"): no reliable general figure exists.
- **Sensitivity of sweet potato, onion, garlic, citrus, berries, strawberry**: rated low or none because the evidence for practical home-storage damage is weak.
- **Pregnancy**: raw eggs (guidance differs by country, for example UK Lion eggs), smoked fish and sushi (guidance varies), herbal teas and licorice (not consistent), and any specific numeric caffeine tracking from ingredient lists.
- **Grapefruit with calcium channel blockers, cyclosporine and other drugs**: real interactions exist but the drug list is long and I could not confirm it to the standard required, so only statins are covered.
- **Lithium and salt consistency, NSAIDs, DOACs, St John's wort, potassium in food (not additives), SSRIs**: not confident enough about specific, ingredient-detectable rules.
- **Total fat per 100 g and keto thresholds**: no condition-specific cut-off to justify; keto is handled only in rescue-recipe filtering (high-carb dishes skipped).
- **Vegetarian and eggs**: some "veg" conventions (for example Indian labelling) exclude eggs and others include them, so eggs are not flagged for `veg`.
- **Gluten**: `rava` is not flagged (it can be rice-based); brewer's yeast is not flagged; oats are only a caution.
- **MSG codes E622 to E625**: only sodium-containing flavour enhancers (E621, E627, E631, E635) count for sodium.
- **Metformin**: no food interaction rule.
- **Heart disease and blood pressure beyond sodium/saturates/trans fat**: no other rules.

## 5. Limitations

- Matching is keyword-based on ingredient names. It cannot see recipe changes, cross-contamination, hidden ingredients, quantities or doses, and unlisted ingredients are invisible. Absence of an alert means nothing was matched, not that a product is suitable.
- Free-text condition detection is fuzzy and English-only; unusual spellings or languages are missed, and some phrases (for example a bare "nut allergy") are intentionally widened to peanut plus tree nut.
- Medication matching uses a curated list of generic and brand names; unknown brands are missed.
- Thresholds are UK FSA front-of-pack values and may not match local labelling regimes. Nutrients must be supplied per 100 g or 100 ml in grams.
- Allergen label exemptions (for example highly refined oils) are not modelled; the soy message tells the user to ask their allergist.
- The ethylene table is a general reference; real behaviour depends on ripeness, variety, temperature and ventilation. Ripening-dependent producers use a single rating.
- Rescue: durations inside step text are parsed heuristically; the offline recipes are generic templates and the LLM's extra pantry items are not restricted to a staple list (they are capped, de-duplicated and screened for conflicts only). Dates are calendar days in UTC unless an offset is given.
- None of this has been clinically validated. Sources are cited by organisation name only; the rules should be reviewed by a qualified clinician or dietitian before wider release.
