# Accessibility (WCAG 2.1 AA)

Scope: the IngreScan-AI web app (`IngreScan-AI/client`). Contrast and accessibility changes only; no behaviour changed.

## Running the audit

```
# web app (dev mode signs in automatically), optional Flask only for the QC "graded batch" state
cd IngreScan-AI && SQLITE_PATH=/tmp/a11y-1.db PORT=3470 FRESHGUARD_URL=http://127.0.0.1:5470 NODE_ENV=development node --import=tsx ./server/_core/index.ts
SQLITE_PATH=/tmp/a11y-1.db BASE_URL=http://localhost:3470 node e2e/a11y.mjs     # from the repo root
node e2e/a11y.mjs --contrast                                                     # token contrast table, no browser
```

Needs `axe-core` and `@axe-core/playwright` (dev dependencies of IngreScan-AI, resolved from `IngreScan-AI/node_modules`).
Env: `BASE_URL`, `SQLITE_PATH` (seeding; it resets the dev user's data), `REPORT` (JSON), `SHOT_DIR`, `ONLY` (scenario filter).
It scans every route in `client/src/App.tsx` plus interactive states (dialogs, selects, receipt review and its validation
errors, QC results/history/scorecard/delete dialog, scan result with alternatives and market block, profile form and
WhatsApp dialog, mobile More sheet, desktop user menu, scanner/produce/OFF tabs) at 390px and 1280px with tags
wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice, plus a custom 44px touch-target check on mobile. It then runs
keyboard, skip-link, landmark, title, reflow (320px, 640px viewport as 200% zoom), forced-colors/reduced-motion checks.
Exit code 1 on any serious/critical violation or failed check.

## Contrast decision

White on the bright orange `#ff5406` is 3.22:1. Graphite on it is only 4.16:1, so dark text does not fix it either.
We kept white-on-orange (the Foodnoms look) and deepened the fill: `--primary` is now `--fn-ember-deep #c94000`
(white text 4.98:1). Bright `#ff5406` stays for the logo, icons, dots and the floating scan button glyph (3.22:1, non-text).
The same pattern ("ink" companions) fixes green, sunset orange, red, sky blue and alert red; text-* utilities for the
bright colours resolve to the ink token on text nodes (SVG icons keep the bright colour).

| Pair | Before | After |
|---|---|---|
| white text on brand orange fill (buttons, badges) | 3.22 | 4.98 (`#c94000`) |
| orange text on white / fog (eyebrows) | 3.22 / 2.95 | 4.98 / 4.57 |
| green text on white / fog (headline accents, 26-60px bold) | 2.79 / 2.56 | 5.09 / 4.67 (`#00802e`) |
| sunset-orange text on white / fog | 2.82 / 2.59 | 5.09 / 4.67 (`#b35200`) |
| red text on white / fog | 3.66 / 3.35 | 5.18 / 4.75 (`#d12b00`) |
| white on destructive fill | 3.66 | 5.18 |
| white letter on Nutri-Score A / B / D / E fills | 2.79 / 2.72 / 3.22 / 3.98 | 5.09 / 5.12 / 4.98 / 5.42 |
| graphite text white / fog | 13.39 / 12.28 | unchanged |
| muted-foreground and placeholders white / fog | 5.33 / 4.89 | unchanged |
| focus ring vs white / fog | 3.22 / 2.95 at 50% alpha (about 1.7) | 4.98 / 4.57, solid 3px outline, 2px offset |

Regenerate with `node e2e/a11y.mjs --contrast`. Disabled controls (opacity 50%) are exempt from WCAG 1.4.3. Links: body
links are graphite with an orange underline; hover colour is Ember Deep. Status tags use graphite text with a colour dot
and always carry a text label (verified in the audit); the dot is redundant, not the sole signal.

## Results (axe nodes; 68 comparable page-states, before = original code)

| Impact | Before | After |
|---|---|---|
| critical | 8 | 0 |
| serious | 177 | 0 (+10 known Radix, below) |
| moderate | 214 (incl. 77 touch-target) | 2 heading-order (ProduceScanner) (+17 known Radix) |

The "known Radix" bucket is aria-hidden-focus / landmark-one-main / page-has-heading-one / region reported only while
a Radix Select listbox or the user dropdown is open: Radix aria-hides everything else and portals the popup outside
landmarks. Not fixable at app level; transient and screen-reader behaviour is correct.

## Rules fixed

color-contrast (all), button-name (dialog selects without labels: label/id association), aria-valid-attr-value (Tabs
`aria-controls` pointing at no panel), scrollable-region-focusable (QC results table), heading-order (empty states h2,
ingredient names h3), region / landmarks (labelled `Main` navigation, `main#main-content` on every page), skip link,
document.title per route plus polite route announcer (`RouteA11y`), visible focus indicator on every Tab stop (global
unlayered `:focus-visible`), nested interactive (Link wrapping Button became `Button asChild`, one Tab stop instead of two),
loading states with role=status, receipt error messages linked with aria-describedby, `aria-current="page"` in the sidebar,
touch targets: 44px on mobile for small buttons, icon buttons, tabs, dialog/sheet close, QC photo remove, footer and
text links, brand link. Reduced motion was already honoured globally; checked.

## Remaining

- `ProduceScanner.tsx` (not edited, owned elsewhere): `<h3>Ready for Inspection</h3>` follows the h1 with no h2
  (heading-order); change it, and the other `fn-heading-sm` h3s, to h2. Its mode toggle buttons ("Single item",
  "Scan a whole shelf") should expose `aria-pressed`. `ShelfScan.tsx`: default state audited clean; result rows
  (per-row Select) were not reachable without a model run and are unaudited.
- Input boundaries: Fog fill on white cards has about 1.1:1 contrast (WCAG 1.4.11 asks 3:1 for a control boundary
  when it is the only cue). Kept for the Foodnoms look; labels, placeholders and the focus outline identify controls.
- Not audited: camera/barcode live scanning, AI chat transcripts with streamed output, ProduceScanner results.
- 200% zoom is emulated with a 640px-wide viewport, not a real browser zoom.
