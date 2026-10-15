# IngreScan-AI design system

Adapted from the **Foodnoms** style reference (Refero, `styles.refero.design/style/1e7dae3b-…`):
"sunlit fruit market on white porcelain — warm orange, fresh green, and generous rounded forms".
We adapt its visual language to IngreScan; we do not copy Foodnoms content or branding.

Tokens live in `src/index.css` (`--fn-*` raw tokens → shadcn semantic tokens → Tailwind utilities).

## Reference lock (do not drift)

- White canvas (`bg-background`), **Fog `#f5f5f5`** as the second surface (`bg-fog`). App pages sit on Fog; cards are white.
- **Flat.** No `shadow-*`, no `bg-gradient-*`, no glows. Depth = Fog vs white + the 26px radius.
- **26px radius** (`rounded-3xl`) on buttons, cards, inputs, tags/badges, dialogs. Nested small elements (menu items, thumbnails inside cards) use `rounded-xl`/`rounded-2xl`.
- **Type:** Aquawax Pro → Nunito Sans fallback (loaded from Google Fonts). Body 500, labels/buttons 700, headings 700.
- **Two-tone headlines** only for hero/section titles: outcome phrase in Verdant Green (or Ember Orange), the rest Graphite. The graphite part is the longer one. Never on body copy or ordinary page titles.
- No emoji as icons — use `lucide-react`.

## Color roles

| Token / utility | Hex | Use for | Never |
|---|---|---|---|
| `primary` / `ember-orange` | #ff5406 | Filled brand buttons, logo, active nav icon + dot, large (≥22px bold) accent headings, focus ring | Small body text, backgrounds of large areas |
| `positive` / `verdant-green` | #00b33f | Fresh / safe / success / progress: dots, icons, big metrics, progress bars | Small text (fails contrast) |
| `negative` / `signal-red-orange` (`destructive`) | #ff3400 | Expired / high risk / errors / overage | Decoration |
| `caution` / `sunset-orange` | #ff6d00 | Expiring soon / moderate risk | — |
| `alert-red` | #ff001e | Severe risk only | — |
| `sky-blue`, `plum`, `iris`, `mist-blue` | | Data categories & charts only (`chart-1..5`) | UI chrome |
| `amber-ink` | #945300 | Small warm data text that must pass AA | — |
| `graphite` / `foreground` | #2f2f2f | Text, icons, dark buttons (`variant="dark"`) | — |
| `muted-foreground` | #6b6b6b | Secondary text | — |
| `fog` | #f5f5f5 | Alternate surface, inputs, tags, icon tiles | — |

Accessibility: white text on brand orange needs `ember-deep` (#c94000, 4.98:1); `primary` already maps to it. Bright brand colours as TEXT resolve to ink tokens (`verdant-ink` #00802e, `sunset-ink` #b35200, `negative-ink` #d12b00, `sky-ink`, `alert-ink`) automatically; use `bg-*-ink`/`bg-ember-deep` for fills carrying white text. See `docs/accessibility.md`.

Rule: **never chromatic text on a chromatic background.** Status = colored dot/icon + graphite text on Fog or white
(`<StatusTag tone="positive">Fresh</StatusTag>`). White text on a solid brand fill (buttons) is fine.

Nutri-Score / Eco-Score badges (solid fill, white letter): A verdant-green, B sky-blue, C amber-ink, D ember-orange, E alert-red. NOVA: 1 verdant-green, 2 sky-blue, 3 amber-ink, 4 signal-red-orange.

Replace Tailwind palette colors (`green-600`, `emerald-*`, `amber-*`, `red-*`, `blue-*`, `purple-*`, …) with the roles above.
Tinted backgrounds like `bg-green-50` become `bg-fog` (+ colored icon/dot).

## Type scale (CSS classes in index.css)

| Class | Size | Use |
|---|---|---|
| `fn-display` | 40→60px bold | Home hero only |
| `fn-heading` | 26→30px bold | Page titles, marketing section titles |
| `fn-heading-sm` | 22px bold | Card / panel titles that lead a section |
| `fn-subheading` | 17→20px medium, lh 1.6 | Lead paragraphs |
| `fn-eyebrow` | 14px bold, Ember Orange | Small label above a heading |
| `fn-metric` | (size via utility) bold tabular | Numbers, scores, counts |
| `text-sm`/`text-xs` | 14/12px | Captions, meta (`text-muted-foreground`) |

## Components

- `PageHeader` (`@/components/brand/PageHeader`): every app page starts with it (eyebrow optional, title, description, actions).
- `StatusTag` + `riskTone()` / `scoreTone()` (`@/components/brand/StatusTag`): all status chips.
- `BrandMark`: orange rounded square + white glyph + wordmark.
- `Button`: `default` (Ember Orange, brand action — one per view region), `dark` (graphite), `secondary` (fog), `outline` (white + hairline), `ghost`, `link`, `destructive`. Sizes: `sm` 36px, default 44px, `lg` 56px.
- `Card`: white, 26px radius, hairline border, no shadow. Use only when the container groups an interaction or a data block — don't wrap every paragraph.
- Inputs / selects / textareas: Fog fill, no border, white + orange ring on focus, 44px tall.
- Icon tile: `grid h-11 w-11 place-items-center rounded-2xl bg-fog` with a colored icon (`text-ember-orange`, `text-verdant-green`, …).

## Layout & spacing

- 8px base; page max width 1200px (the app shell already constrains and pads content).
- Page vertical rhythm: `space-y-8 md:space-y-10` between page blocks; card padding comes from `Card`.
- Marketing sections: `fn-section` (64px → 96px).
- Grids collapse to one column on phones; touch targets ≥ 44px; no horizontal overflow at 360px wide.
- Mobile app shell has a bottom tab bar — page content already gets bottom padding.
