# Boma Cloud — Design System (Master)

Source of truth for UI decisions. Page-specific deviations belong in
`design-system/pages/<page>.md` and override this file.

## 1. Product frame

Boma Cloud is a staff-only property-operations console for landlords and
property managers in Kenya. Tenants never log in.

Design test for every screen: **does this help a staff member collect rent or
run a property today?** If not, it is report-depth, not dashboard-depth.

Constraints that shape the UI:

- Money is integer KES minor units. Never floats. Never `parseFloat` on a
  stored amount.
- The business calendar is Africa/Nairobi. Show dates in `en-GB` style.
- Many users are on phones in the field, often on slow networks. Server-render
  first; client JS is a budgeted exception.
- Roles are enforced server-side. The UI may hide what a role cannot do, but
  hiding is never the security boundary.

## 2. Visual direction — "Boma 21" (21st.dev-inspired)

Dark-first, calm, dense, trustworthy. Neutral surfaces let a single emerald
accent carry the brand.

- The product defaults to dark (`class="dark"`); light is a first-class peer
  theme, not an afterthought.
- Canvas and cards are **true neutral**, never green-tinted. Emerald appears
  only in primary actions, active navigation and the wordmark.
- Structure is carried by **hairline borders** (`--hairline`, ~8–9% contrast)
  plus soft elevation tokens, not heavy dividers.
- Micro-labels (`label-micro`): Geist Mono, 10px, uppercase, wide tracking.
  Use them for KPI labels, table heads and section eyebrows.
- One static emerald **spotlight** wash may fade in on hover (CSS only). No
  pointer-tracking JS, no animated gradient borders, no gradient text.
- Glass/blur is reserved for fixed chrome (topbar, command palette). Never on
  data rows or static cards.
- Semantic colours are separate tokens. Never reuse `--primary` to mean
  "success", and never use brand green for status.
- Amber is reserved for money or work at risk. Red = confirmed loss.
- No emoji as icons. Icons: lucide only, sizes 14 / 16 / 20 / 24.

## 3. Tokens

Defined in `app/globals.css` as CSS variables, mapped through `@theme inline`.
Use the utility (`bg-success/10`, `text-danger`), never the raw variable and
never a Tailwind palette class (`text-emerald-600` is banned).

| Role | Token | Utility |
| --- | --- | --- |
| Canvas | `--background` | `bg-background` |
| Surface | `--card` | `bg-card` |
| Raised/quiet surface | `--surface` | `bg-surface` |
| Hairline | `--hairline` | `border-hairline`, `ring-hairline` |
| Brand | `--primary` | `bg-primary`, `text-primary` |
| Success | `--success` | `bg-success/10 text-success` |
| At risk | `--warning` | `bg-warning/10 text-warning` |
| Loss | `--danger` | `bg-danger/10 text-danger` |
| System | `--info` | `bg-info/10 text-info` |
| Neutral state | `--state-neutral` | `bg-state-neutral/10 text-state-neutral` |
| Always-dark panel | `--brand-panel` | `bg-brand-panel text-brand-panel-foreground` |

Data ramp: `chart-1` emerald, `chart-2` teal, `chart-3` blue, `chart-4` amber,
`chart-5` rose, `chart-6` violet. Series order is fixed; never reorder per
chart. Colour is never the only encoding — pair with labels or patterns.

**Emphasis pairs:** default `bg-X/10 text-X`. Solid `bg-X text-X-foreground`
only for a single high-emphasis element per view.

## 4. Typography

- Sans: Geist Sans (`font-sans`) for all UI text.
- Mono: Geist Mono (`font-mono`) for **every** money value, percentage delta and
  identifier. Always with `tabular-nums`.
- Scale: 11 / 12 / 13 / 14 / 16 / 20 / 24 / 30. No arbitrary sizes.
- Headings: `text-base font-semibold` inside cards; page title
  `text-xl md:text-2xl font-semibold tracking-tight`.
- Body copy: 14px default, `text-muted-foreground` for supporting text.
- Max measure for prose: 65ch.

## 5. Spacing, radius, elevation

- 8px rhythm. Card padding 16px (`px-4`), page gutter 16/24px.
- Card gap: 4px between header rule and content, 12px between cards.
- Table rows 36px default; 32px dense mode.
- Radius: `rounded-lg` (10px) controls, `rounded-2xl` (14px) cards.
- Elevation: `shadow-e1` for static cards, `shadow-e2` for popovers and
  dialogs. Elevation is soft and low-contrast — it must never read as a drop
  shadow. Hairline borders still carry most structure.

## 6. Components

Every screen composes from these. Do not fork them.

| Component | Path | Rule |
| --- | --- | --- |
| `Stat` | `components/shared/stat.tsx` | A KPI is never a naked number: period hint, optional delta, optional sparkline, optional drill link. |
| `Money` | `components/shared/money.tsx` | All amounts. Mono, tabular, sign-aware, full value in `title`. |
| `SectionCard` | `components/shared/section-card.tsx` | Reporting shell. One header rhythm. |
| `ChartFrame` | `components/charts/chart-frame.tsx` | The only chart client island. Table twin is required. |
| `PointsTable` / `ShareTable` | `components/charts/series-table.tsx` | Accessible twins for every chart. |
| `Sparkline` | `components/charts/sparkline.tsx` | Server SVG only, 2+ points. |
| `AlertBanner` | `components/shared/alert-banner.tsx` | Replaces hand-rolled tinted cards. |
| `StatusBadge` | `components/shared/status-badge.tsx` | The only place status tone is defined. |
| `DataTable` | `components/shared/data-table.tsx` | Presentational only. Sorting/paging stay server-side. |
| `EmptyState` | `components/shared/empty-state.tsx` | Every list and table needs one. |
| `PageHeader` | `components/shared/page-header.tsx` | Title + description + actions. |
| `ThemeToggle` | `components/layout/theme-toggle.tsx` | Dark default; light parity. One tap. |
| `CommandMenu` | `components/layout/command-menu.tsx` | Role-filtered module switcher. ⌘K / Ctrl+K and the topbar search pill. |

Route-level states: `app/(dashboard)/loading.tsx`, `app/(dashboard)/error.tsx`,
`app/not-found.tsx`. New segments inherit the loading shell; add a segment
`loading.tsx` only when the shape genuinely differs.

## 7. Analytics rules

The metric contract is `lib/metrics/catalog.ts`. It is not optional
documentation — it is the API every number goes through.

1. **State the basis.** Every figure is `cash-received`, `billing-period`, or
   `as-of-now`. Never compare across bases without saying so.
2. **Arrears is always as-of-now.** It ignores the window selector and says so.
3. **Unconfirmed M-Pesa is not money.** Exclude it from collected; show it as a
   separate "unconfirmed" count.
4. **Net of reversals.** Reversals are negative ledger rows; sums are already net.
5. **No delta without a like-for-like prior period.** Month-to-date vs a full
   prior month is a lie. Either align the window or omit the delta.
6. **Every KPI drills down** in ≤ 2 clicks. Every chart has a table twin and,
   where money leaves the app, an audit-logged CSV.
7. **Zero states are explicit.** "No income in this period yet" beats an empty
   frame. Partial data gets a caveat, not silence.

Chart selection:

| Question | Chart | Avoid |
| --- | --- | --- |
| Trend over time | Line / area, 12 months | < 4 points (use a stat) |
| Compare categories | Sorted horizontal bar | Unsorted bars |
| Part-to-whole | Stacked bar | Donut above 4 slices |
| Target attainment | Bullet | Gauge |
| Intensity by unit and month | Heatmap + table | Heatmap alone |
| Single headline trend | Sparkline in a `Stat` | Sparkline as a primary chart |

## 8. Accessibility gates (blocking)

- Text contrast ≥ 4.5:1; graphical/UI ≥ 3:1 in both themes.
- Colour is never the only signal — pair with text, icon or pattern.
- Focus visible on every interactive element; no `outline-none` without a
  replacement ring.
- Icon-only buttons require `aria-label`. Charts require `role="img"` +
  `aria-label`, or a data table twin.
- Tables must degrade to cards below `md` — never hide data columns silently.
- Respect `prefers-reduced-motion`; micro-interactions 150–200ms.
- Forms: visible label, inline error, error tied to the field.

## 9. Anti-patterns

- Tailwind palette classes for semantics (`text-emerald-600`, `bg-amber-500/5`).
- More than one primary button per view.
- A chart without its table twin.
- A KPI without period or basis.
- Money in a proportional font, or rounded before formatting.
- Hidden columns as the mobile strategy.
- New chart libraries. The stack is server SVG + one client island.

## 10. Change control

Token or primitive changes are made here first, then in code, then rolled out.
A page may not introduce its own colour, spacing or chart primitive — if the
system lacks something, add it to the system and update this file.
