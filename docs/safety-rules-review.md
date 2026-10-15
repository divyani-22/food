# Safety rules review log

First-pass audit of the shelf-life, health-interaction, ethylene and rescue rules. This is NOT a clinical or professional validation; a qualified food-safety professional and a clinician or pharmacist should still review (see docs/safety-review-checklist.md).

Method: all rules inventoried from IngreScan-AI/shared/engines/{shelfLife,healthRules,ethylene,rescue}.ts (148 shelf-life entries, 40 ethylene profiles, 36 text rules plus 3 nutrient-threshold rules in healthRules, 21 offline recipe templates plus the rescue notes and LLM prompt; about 250 rules). Cross-checked with web search. The primary sites (fsis.usda.gov, nhs.uk, FDA, UC Davis) were not reachable from this environment (DNS failure), so each source below is a search summary quoting the authority, labelled [secondary]. Where nothing was found the rule is "unsourced".

## Changes

| Rule | Old | New | Source | Confidence |
|---|---|---|---|---|
| Base shelf-life note | "use your judgement (look, smell, texture)" | "Look and smell are not a reliable safety test ... when in doubt throw it out" | USDA/FSA general guidance [secondary] | high |
| Cooked-food note | refrigerate within 1-2 h; reheat above 70 C | within 2 h (1 h if hotter than 32 C / 90 F); reheat to 74 C / 165 F; do not eat if left out over 2 h | USDA FSIS danger zone, leftovers [secondary] | high |
| Hard cheese mould margin | 1 cm | 2.5 cm (1 inch) around and below, knife out of mould; shredded/crumbled discard | USDA FSIS mould sheet [secondary] | high |
| Soft cheese note | "follow local advice" | avoid unpasteurised and mould-ripened soft cheese unless cooked steaming hot | NHS pregnancy foods (recalled) | medium |
| Cut melon note | "must be refrigerated" | refrigerate within 2 h of cutting, discard if left out longer | FDA 2 h, Health Canada melon advisory (cut melon up to 4 days) [secondary] | medium-high |
| Raita | matched to curd (7 days unopened, 4 opened) | matched to prepared-salad entry (3 days) | conservative; unsourced | medium |
| Cooked roti | default pantry, 1 day at room temperature | default fridge, pantry 0, eat within 2 h if left out | USDA 2 h rule [secondary] | medium |
| Paneer | fridge 5 (opened 3) | fridge 3 (opened 2); loose paneer is common | conservative; unsourced | medium |
| Deli meat, fresh juice, eggs, prawns, cake, naan/puri, dips | no vulnerable-group or room-temperature caution | pregnant/elderly/immunocompromised notes, 2 h rule for cream cakes and fresh breads, "normal smell does not prove safe", fresh dips 1-2 days | NHS/FDA (recalled); unsourced where noted | medium |
| Health disclaimer | "check ... before changing your diet or medication" | adds "Do not stop, skip or change a prescribed medicine because of this alert." | design rule | high |
| New rule: warfarin + cranberry/grapefruit | none | caution | NHS warfarin food and drink [secondary] | medium |
| New rule: felodipine/nifedipine + grapefruit | none | caution | FDA grapefruit page (not fetched); CMAJ/GoodRx [secondary] | medium |
| New: sesame allergy | not covered | warning on sesame, tahini, gingelly, halva, OFF tag | FDA FASTER Act: sesame is ninth major allergen [secondary] | high |
| Gluten / wheat allergy | soy sauce, beer not flagged | caution for soy sauce, teriyaki, beer, lager, stout, ale (not ginger ale) | Coeliac UK soy sauce FAQ [secondary] | medium-high |
| Levothyroxine | soy, calcium carbonate/citrate, iron salts | adds calcium, coffee, walnut, psyllium, cottonseed meal (info) | FDA label / ATA via secondary | medium |
| Simvastatin | simvastatin, lovastatin names | adds Vytorin | brand list | high |
| Rescue inspection note | "Look and smell before deciding" for past-date items | discard past use-by and all perishable past date; look/smell not reliable; only whole produce/dry goods past best-before may be considered | FSA, USDA | medium-high |
| Rescue safety note | refrigerate within 2 h | adds 1 h if hot, 74 C reheat, food can be unsafe without smelling off | USDA [secondary] | high |
| Warm spiced milk recipe | "only use milk that smells and looks normal" | relies on use-by date and refrigeration | FSA | medium |
| LLM rescue prompt | no rule on raw eggs or medicine | forbids raw/lightly cooked eggs, meat, fish and any stop/skip/change-medicine advice | design rule | high |

Every change has a test in server/engines.shelflife.test.ts, engines.health.test.ts or engines.rescue.test.ts (describe blocks "safety review corrections" / "safety review additions").

## Findings left as is

- Shelf-life figures that are shorter than USDA/FSA ranges (raw poultry 1 day, mince 1, cooked rice 1, pork/beef 3, leftovers 3, milk 4) were kept: pessimistic, not unsafe.
- "Do not refreeze after thawing" is stricter than USDA (food thawed in the fridge may be refrozen); kept.
- Fruit_info.py shelf_life_days and storage values were reviewed and left unchanged (no unsafe claim found; changing them would also require regenerating client/src/lib/fruitInfo.json, owned by another agent).
- Ethylene: no safety claims are made (quality only). Possible classification mismatches for reviewer: bell pepper (this app: none/moderate; one secondary table: low/low), kiwi as a high producer (kiwifruit is mainly highly sensitive), strawberry and watermelon values unverified. Kept because they only affect optional storage tips.
- Cooked-rice, pasta and dal shelf life is stated as a fridge figure; there is no check that user-entered expiry dates for cooked items respect it (rescue accepts whatever date the user stored).

## Rules that could not be sourced (unsourced, model memory)

Fresh paneer 2 days and paneer 3 days; raita; fermented batter 3 days; chutney, pesto, pickles opened durations; plant milk; jaggery, poha, semolina, spice and flour pantry figures; dried fruit and nut durations; ice cream 60/30 days; all UC Davis ethylene class assignments (recalled, not re-fetched); rescue smoothie and tomato-sauce leftover times; FSA front-of-pack thresholds (recalled); National Kidney Foundation potassium and phosphate rules; ACR gout guideline; atorvastatin severity.

## UI wording needed (client files not edited)

- client/src/components/features/HealthAlerts.tsx line 70 fallback text: "This is general information, not medical advice. Check with your doctor, pharmacist or dietitian before changing your diet or medication." Suggest appending: "Do not stop or change a prescribed medicine because of this alert." (The engine disclaimer now includes it, so the fallback only shows when the API returns none.)
- RescueFridge.tsx renders safetyNote and the inspection note from the engine; no change needed.
- Wherever the shelf-life estimate note is shown, it now contains the "not a reliable safety test" sentence; ensure the UI does not truncate it.
