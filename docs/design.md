# Cauce — Design direction: «Cal y picón»

> Source of truth for visual identity (T-016). Tokens live in `src/app/globals.css`;
> primitives in `src/components/ui.tsx` and `src/components/mark.tsx`.
> Screenshots: `docs/design/`.

## Concept

Cauce is a working instrument for a coordinator in a car between sites, not a SaaS
landing page. The look borrows from two things that already work under pressure:
**the station departures board** (one dark band, big tabular times, a state per line)
and **the coordinator's own paper planning sheet** (ruled rows, margin notes, ticks).
The material is Canarian: **cal** (whitewash) for paper, **picón** (volcanic black) for ink,
**almagre** (the red earth of Canarian pottery) for the only alarm colour, **azufre**
(Timanfaya sulphur) for "waiting", and **mar** (Atlantic blue) for "flowing again".
*Cauce* means a river channel: the mark is a channel seen from above, bending to a new course.

## Typography

| Role | Face | Why |
|---|---|---|
| Interface, numbers, signage | **Archivo** (Omnibus-Type, variable `wdth` 62–125, `wght`) | A sturdy grotesque from a Latin-American foundry, very legible at 14–16 px, with a real width axis: normal width for reading, **condensed (80 %)** for labels, headings and the tablero — the signage voice — without loading a second family. Tabular lining figures for times. |
| People's words | **Newsreader** (Production Type, `opsz`) | A text serif with optical sizes. Used **only** for things people say or will read as a message: pasted WhatsApp texts, messages to send, client replies, and the ranking's reasons (the expert's notes). Rule: *sans is the system, serif is a person*. |

Both are loaded with `next/font/google` (self-hosted at build, no runtime requests to Google).
Never Inter, never system-ui as the brand face.

Scale (rem): 0.6875 eyebrow · 0.8125 meta · 0.9375 body-strong · 1.0625 voz · 1.25 · 1.75–2.5 titles
(condensed, weight 750, slight negative tracking). Utilities: `cond`, `cond-x`, `num`, `eyebrow`, `voz`.

## Colour tokens

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `cal` | `#f2efe8` | page background (whitewash in shade) | — |
| `cal-claro` | `#fbfaf6` | sheets, inputs, the top pick | — |
| `cal-hondo` | `#e8e4da` | hover / active row | — |
| `picon` | `#191816` | ink, primary buttons, the tablero | 15.4:1 on cal |
| `picon-2` | `#45423c` | secondary text | 8.7:1 |
| `picon-3` | `#6b675e` | meta, labels | 4.9:1 (AA) |
| `picon-4` | `#9c978b` | decorative only (rank 2+, empty marks) | — |
| `linea` / `linea-suave` / `linea-fuerte` | `#d8d3c7` / `#e6e2d8` / `#b5afa1` | rules, input borders | — |
| `almagre` | `#a8361c` | **something is missing**: sin cubrir, alta, destructive | 5.7:1 on cal; white on it 6.5:1 |
| `almagre-claro` | `#e0623f` | almagre on the dark tablero | 5.1:1 on picón |
| `azufre` / `azufre-texto` / `azufre-tinte` | `#c98a12` / `#7a5100` / `#f6eacb` | **waiting on someone**: mark / text / fill | text 5.8:1 on tinte |
| `mar` / `mar-claro` / `mar-tinte` | `#1d4f6e` / `#6fa6c8` / `#dce7ec` | **flowing / covered**, links, focus | 7.6:1 on cal |

Legacy Tailwind scales (`slate`, `red`, `amber`, `sky`, `emerald`, `brand`) are **remapped** onto
this palette in `@theme`, so older markup stays on-brand. New code should use the named tokens.
Note: `emerald-*` now resolves to *mar* — "covered" is blue here, not green.
WhatsApp button keeps WhatsApp green but with ink text (9:1) instead of white (2:1).

## Density & layout

- Base text 14–15 px desktop, 16 px inputs on phones (no iOS zoom). Rows ≥ 56 px on lists.
- Sheets over cards: content sits on the page separated by **rules**, not boxed in rounded white
  cards. A section is a `SectionHead` (condensed caps title on a 2 px ink rule) + ruled rows.
  `card` still exists (square-ish sheet, 1 px rule, no shadow) for forms and the composer.
- Radius 2–4 px everywhere. No shadows. One dark surface per screen at most (`tablero`).
- Grid: sidebar 240 px; content max 72 rem with 40 px gutters; 3/5 + 2/5 split on the panel,
  2/3 + 1/3 on detail pages. On phones everything is one column, `grid-cols-1` + `min-w-0`.
- Times lead rows (left column, tabular, bold) — like a timetable.

## Status (never colour alone)

Every state = **glyph + word** (`StatusBadge`, `Glyph`, `StatusMark`). No pills.

| Glyph | Meaning | Used for |
|---|---|---|
| ■ solid square | a gap | sin cubrir, incidencia abierta, servicio sin cubrir |
| ◧ half square | waiting on someone | esperando respuesta, pendiente, en curso |
| ✓ check | flowing again | cubierto, aceptada, resuelta |
| □ hollow | closed without outcome | anulado, sin cobertura, retirada |
| × cross | refused | rechazada |
| ▂▄▆ bars 1–3 | severity | baja / media / alta |

The week grid draws **one pip per service** (ink = covered, almagre = gap, azufre = waiting);
the panel's tablero draws one cell per service of the day. Counts always appear in words too.

## Iconography

- Lucide only for **verbs** (WhatsApp, copiar, enlace, cerrar sesión, menú, +) and the mobile
  bottom bar (thumb navigation, always with a label). Never decorative icons next to section
  titles, KPI labels or list rows. No sparkles/wand for "AI".
- Status uses the glyph set above, not icons.

## Motion

Colour transitions of 120 ms on hover/focus only. No entrance animations, no transforms, no
skeleton shimmer. `prefers-reduced-motion` disables all transitions.

## Components to reach for

`PageHeader` (condensed title, optional `kicker`, back link as eyebrow) · `SectionHead` ·
`Tabs` (caps, ink underline) · `StatusBadge`/`StatusMark` · `Meter` (10-cell score) ·
`CoverageStrip` · `Initials` (square tag) · `EmptyState` · utilities `card`, `tablero`, `fila`,
`link`, `btn-*`, `input`, `label`, `h-section`, `voz`, `num`, `eyebrow`.

## We never do

- Inter / system font as brand; indigo, violet or emerald accents; gradients; glass; blobs.
- Rounded-xl white cards with soft shadows as the default container.
- Pills/badges for everything; colour as the only carrier of state.
- Emoji in UI copy; decorative icons; sparkles for AI.
- Centered hero copy inside the app; "Welcome back 👋" headers; KPI tiles with icons.
- White text on WhatsApp green, or any text under 4.5:1.
- Tap targets under 44 px on phones.
