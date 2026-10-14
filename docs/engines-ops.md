# Engines operations guide: shelf life, receipt parser, produce QC

Scope: `IngreScan-AI/shared/engines/shelfLife.ts`, `receiptParser.ts`, `qcGrading.ts` (re-exported from `shared/engines/index.ts`).
All three are pure (no I/O, no framework imports, deterministic; time is injected as `now`), so the server and the React client can import them.
Tests: `server/engines.shelflife.test.ts`, `server/engines.receipt.test.ts`, `server/engines.qc.test.ts`.

## 1. Shelf-life estimator

### What it returns
`estimateShelfLife(name, { location?, opened?, now?, minConfidence? })` returns `{ days, expiryDate, location, category, matchedKey, confidence, matchScore, locationFallback, isEstimate: true, note }`, or `null` when there is no confident match or the item is non-food. `expiryDate` is `YYYY-MM-DD`: the UTC calendar date of `now` plus `days` (a user ahead of UTC therefore gets a date that is at most one day early, which is the safe direction).
`isFoodItem(name)` is false only on positive evidence of a non-food item (detergent, carry bag, delivery fee, tissue, pet food ...). `classifyFoodItem` also returns `"unknown"`.

### Sources and conservatism policy
The table (about 150 canonical entries, 100+ distinct grocery items across produce, dairy and eggs, meat/fish/poultry raw and cooked, bakery and Indian breads, cooked leftovers, deli, packaged staples, frozen, condiments, beverages, Indian groceries) is a set of conservative planning figures informed by widely published guidance: USDA FoodKeeper, UK FSA / NHS, and FSSAI / ICMR-NIN household guidance. The figures were written from knowledge of those ranges, not copied from a licensed dataset, and have not been re-verified against the live documents. Rules applied:

- Use the lower end of a published range, then round down (raw poultry 1 day against a published 1-2 days; cooked rice 1 day; cooked meat and dal 3 days; raw mince 1 day).
- Opened or cut items get a shorter figure than sealed ones (`openedDays`).
- Freezer figures are quality horizons, never safety limits (food at -18 C stays safe). The note says so.
- Perishables with no safe room-temperature figure return `days: 0` for the pantry (expiry today) with a warning.
- Every result carries `isEstimate: true` and a note beginning "Estimate only: check any date printed on the pack".
- A printed date always wins over this tool.
- Indefinitely stable items (sugar, salt, honey) get 365 days as a quality horizon only.

### Confidence policy
- `high`: well-documented items with narrow ranges (raw meat, eggs, milk, bread, common vegetables).
- `medium`: usable but variable (regional produce, paneer, spices, flours, juices).
- `low`: genuinely uncertain (some gourds, batter, chutney, pesto, fresh-baked cakes). Included so the UI can still pre-fill a date, always labelled low.
- Final confidence is the entry confidence, lowered one level when two or more unexplained words precede the product noun, or when a location fallback was used. `minConfidence` filters.

### Matching rules (why "butterscotch" is not butter)
1. Names are lower-cased, accent-folded, size/brand/packaging noise is removed, receipt abbreviations expanded (TMT, CHKN, BNLS, WH MLK ...), plurals reduced.
2. Whole-token phrase matching only. "butterscotch" is a single token, so it never matches "butter".
3. Head-final rule: the right-most matched phrase is the product noun; at equal position the longest phrase wins. So "milk chocolate" is chocolate, "peanut butter" is peanut butter, "cream cracker" is a biscuit, "tomato ketchup" is ketchup.
4. If any word after the matched phrase is not a harmless variety word, the match is rejected ("apple pie", "butter scotch", "egg roll", "cream roll" return null).
5. Four or more unexplained leading words reject the match; two or three lower confidence.
6. Brand synonyms that imply a product (Cadbury, Maggi, Kurkure, Oreo) are "open tail" synonyms so flavour names may follow.
7. "frozen" switches to the freezer figure; "cooked / leftover / grilled / fried" switch raw meat, fish, rice, pasta and dal to the cooked entries.

## 2. Receipt parser

`parseReceiptText(text, { now? })` returns `{ items, skipped: [{line, reason}], currency?, store?, warnings }`. Never throws. Output is ASCII only (rupee, euro and pound symbols are mapped to codes; emoji and other non-ASCII characters are removed). Limits: 200,000 characters, 3,000 lines, 300 characters per line, 200 items.

### Supported
- Quantities: `2 x`, `x2`, `2x`, `Qty: 2`, `2 pcs`, `2 @ 3.50`, `1.5 kg`, `500 g`, `1 dozen` (becomes 12 pcs), `(Pack of 6)` (kept as pack size).
- Prices: `Rs.`, `INR`, rupee sign, `$`, euro, pound, `GBP`, thousands commas (`1,250.50`, Indian `1,25,000`), decimal comma (`3,50`), `40/-`, trailing tax-flag letters (`3.49 F`), unit/qty/total triples (`Milk 30.00 2 60.00`).
- Weight-priced produce and meat (`1.52 lb @ 0.59 /lb  0.90`, `0.745 kg @ 1.20/kg`): the weight becomes the quantity. Loose produce or meat given as `Onion (1 kg) x 1` is also recorded by weight.
- Continuation lines: name, then quantity line, then price line (Instamart style); `Qty: n` on the following line; wrapped names ending in `-`, `/` or `&`.
- Pipe-separated columns, double spaces, stray symbols, `O`/`0` and `l`/`1` confusion inside numeric tokens that contain a decimal point or are all digits and O (a warning is added).
- Skipped with a reason: `total`, `tax`, `discount` (also negative amounts), `fee` (delivery, handling, packaging, platform, service, bag, tip), `payment`, `address`, `phone`, `order_id`, `date`, `header`, `non_food`, `no_price`, `unparseable`.
- Duplicate lines are merged (quantities and prices summed). Plain shopping lists (fewer than two priced lines) are parsed line by line, with comma or semicolon splitting.
- Store detection: Blinkit, Zepto, BigBasket, Swiggy Instamart, JioMart, DMart, Amazon (Fresh), Walmart, Instacart, Tesco, Sainsbury's, Asda, Morrisons, Waitrose, Aldi, Lidl, Co-op, Kroger, Costco, Whole Foods and a few more.
- Fixtures in the tests are modelled on typical layouts of these services; they are not copies of real receipts, and real layouts change.

### LLM / vision path
`RECEIPT_EXTRACTION_PROMPT` and `buildReceiptExtractionMessages(textOrImageUrl)` produce chat messages (system + user, text or `image_url`) compatible with `server/_core/llm.ts`. Receipt text is wrapped in `<receipt>` markers, marker look-alikes are removed, and the prompt tells the model receipt content is data, not instructions. `sanitizeReceiptItems(unknown)` validates the model JSON (object, bare array, fenced or chatty string): coerces numbers, clamps quantity to 10,000 and price to 1,000,000, limits names to 80 ASCII characters, drops empty/non-food/junk entries, merges duplicates, caps at 200. `enrichReceiptItems` adds category, location and estimated expiry.

### Unsupported or weak
- Non-English receipts (the item names stay unmatched, so no expiry estimate); right-to-left and CJK scripts are stripped.
- Tables where item names and prices are on different, unaligned lines (OCR column splitting); the parser only joins a name line with the details/price lines directly after it.
- Multi-buy deals and per-line discounts are skipped, not subtracted from the item price.
- Taxes are not allocated to lines; `price` is the printed line total.
- Handwritten receipts, receipts with item codes only, and heavily corrupted OCR (letters replacing letters inside words, for example `M!lk`).
- Currency is only detected when a symbol or code appears; a bare decimal-comma receipt gets no currency.
- No verification that item prices sum to the printed total.

## 3. Produce QC grading

### Photo grade (`gradePhoto`)
Evaluated in this order, first match wins:

| Step | Condition (defaults) | Grade |
|---|---|---|
| 1 | malformed input (unknown status, NaN, outside 0-100) | REVIEW |
| 2 | confidence < 50 | REVIEW |
| 3 | status rotten | REJECT |
| 4 | p_fresh < 30 | REJECT |
| 5 | status fresh, p_fresh >= 80, confidence >= 60 | A |
| 6 | otherwise | B |

Rationale: a low-confidence classification is not evidence for or against the produce, so it goes to a human instead of being silently accepted or rejected. Conflicting signals (rotten with high p_fresh, fresh with very low p_fresh) are rejected and flagged `status_conflict`. All thresholds are configurable and are echoed in the output; inconsistent overrides are repaired.

### Lot verdict (`summarizeBatch`)
Shares are percentages of all photos submitted, REVIEW photos included.

- ACCEPT: A+B >= 90% and REJECT <= 5% and REVIEW <= 10%.
- REJECT_LOT: REJECT > 20% (checked first).
- INSPECT: not accepted and REVIEW > 10%, or an empty batch.
- ACCEPT_WITH_DISCOUNT: everything else (REJECT between 5% and 20%, REVIEW within limit).

Output contains counts, percentages (1 decimal), mean/median/min/max p_fresh, per-fruit breakdown, a Wilson 95% interval for the REJECT share, `checks[]` (each rule, actual value, limit, pass/fail), the rule text, and `statisticalNote`: fewer than 20 photos is flagged as not statistically representative (the verdict is still produced, but is provisional). The 90/5/10/20 values are defaults chosen as a transparent starting point, not an industry standard: tune them per commodity and contract.

### Vendor scorecard
`vendorScorecard(batches)` groups by vendor (case-insensitive). Reports batch count, mean-of-batches A%, pooled A%, A+B%, pooled rejection and review rate, lot reject rate, verdict counts, trend and rank. Trend needs >= 3 graded batches: later half versus earlier half mean A%, +/- 5 points for improving/declining (ordered by `receivedAt` when every batch has one). Rank: lowest pooled rejection rate, then highest pooled A%, then name.

### CSV
`toCsv(rows, columns?)` is RFC 4180 (CRLF, quoting, doubled quotes). String cells beginning with `=`, `+`, `-`, `@`, tab or CR (also after leading whitespace) get a leading single quote; typed numbers are written as numbers; NaN/Infinity become empty cells; control characters are stripped; cells are capped at 32,000 characters and 200 columns. `batchReportCsv`, `batchPhotosCsv`, `vendorScorecardCsv` build on it. Note that the quote prefix alters the value for any string that legitimately starts with `-` (for example `-5` as text).

## 4. Limitations
- Shelf-life numbers are estimates from memory of published guidance, not a validated dataset; they have had no review by a food-safety professional. They ignore actual storage temperature, pack condition, and purchase date (the date starts at "today").
- Matching is rule-based; unusual spellings, regional names and compound dishes may return null or a conservative neighbour. Unknown trailing words cause rejection, which trades recall for safety.
- Cooked-dish handling is generic (3 days, rice 1 day).
- Photo grades inherit all errors of the freshness classifier and the photo quality; photos are a sample, and a lot verdict is not a substitute for inspection.
- Nothing here is medical or regulatory advice. Pregnant, elderly and immunocompromised people should follow official guidance for high-risk foods.

## 5. Deliberately omitted
Fresh-made Indian sweets (mithai, khoya, rasgulla, gulab jamun; tinned versions differ widely), atta/dough, packaged sandwiches and rolls, sprouts-as-ready-meal, alcohol, baby formula and baby food, supplements and protein powders, pet food, smoked/cured fish, home-canned and fermented foods, raw milk and unpasteurised dairy specifics, wild game, bone broth, sushi and raw seafood dishes, fresh pasta and fresh noodles, tinda/drumstick/other regional vegetables where sources disagree, and exotic fruit (kiwi, dragon fruit, lychee) where no confident figure was available. Unmatched items return `null` and the UI should ask for a manual date.
