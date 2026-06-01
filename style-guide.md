# RaceWorld Style Guide

Derived from F1 Manager 24 visual reference. All values are implementation-ready.

---

## Color Palette

### Surfaces
| Token | Hex | Usage |
|---|---|---|
| `surface-base` | `#0F1419` | Page background |
| `surface-card` | `#1E2431` | Cards, panels |
| `surface-raised` | `#2A3142` | Modals, tooltips, dropdowns |
| `surface-hover` | `#303848` | Hovered card state |

### Text
| Token | Hex | Usage |
|---|---|---|
| `text-primary` | `#E8EAED` | Body, default values |
| `text-secondary` | `#A0A9B8` | Subtitles, metadata |
| `text-muted` | `#6B7280` | Labels, placeholders |
| `text-inverse` | `#0F1419` | Text on bright accent backgrounds |

### Accents
| Token | Hex | Usage |
|---|---|---|
| `accent-cyan` | `#00D9FF` | Primary CTA, progress bars, highlights |
| `accent-cyan-dim` | `#009CB8` | Hover state of cyan, secondary fills |
| `accent-red` | `#DC143C` | Section pipes, negative rank badges, warnings |
| `accent-purple` | `#A855F7` | Chart segments, secondary indicators |
| `accent-yellow` | `#FCD34D` | Chart segments, tertiary indicators |

### Semantic
| Token | Hex | Usage |
|---|---|---|
| `positive` | `#10B981` | Positive values, gains, "Finished" badge |
| `negative` | `#DC143C` | Negative values, losses, last-place ranks |
| `neutral` | `#6B7280` | Neutral state |

---

## Typography

**Font family:** Inter (fallback: system-ui, sans-serif)

### Scale
| Role | Size | Weight | Case | Letter-spacing |
|---|---|---|---|---|
| Screen heading | 22–26px | 800 | ALL-CAPS | +0.8px |
| Section heading | 16–18px | 700 | ALL-CAPS | +0.5px |
| Card title | 14–16px | 600 | Title Case | 0 |
| Body | 13–15px | 400 | Sentence | 0 |
| Label / small | 11–13px | 500 | ALL-CAPS or Sentence | +0.3px |
| Stat value | 14–18px | 700 | — | 0 |

### Numeric formatting
- Race positions use superscript ordinals: 1<sup>ST</sup>, 3<sup>RD</sup>
- Race round numbers are zero-padded: `01`, `02`, ... `24`
- Stat values are bold; their labels are `text-secondary`

---

## Spacing & Layout

**Base unit:** 4px

| Name | Value | Usage |
|---|---|---|
| `xs` | 4px | Icon padding, tight gaps |
| `sm` | 8px | Inline spacing, badge padding |
| `md` | 16px | Card padding, grid gutters |
| `lg` | 24px | Section gaps |
| `xl` | 32–40px | Major section separators |

**Grid:** 2–3 column layouts, variable-height cards, content-driven (not uniform row heights). Gutters: 16px.

---

## Cards & Panels

```
border-radius: 12px          (large cards)
border-radius: 8px           (small cards, buttons)
border-radius: 4–6px         (badges, chips)
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4)
background: surface-card
```

No visible stroke borders — depth is conveyed entirely by background color steps (`surface-base` → `surface-card` → `surface-raised`).

Hover state: background shifts to `surface-hover` + optional cyan glow:
```
box-shadow: 0 8px 20px rgba(0, 217, 255, 0.12)
```

---

## Section Headers

A colored vertical pipe precedes every section title.

```
[pipe]  SECTION TITLE

pipe:
  width: 3–4px
  height: 20–24px
  background: accent-red    (default)  or  accent-cyan  (data sections)
  border-radius: 2px
  margin-right: 10px

title:
  font-size: 16–18px
  font-weight: 700
  letter-spacing: 0.5px
  text-transform: uppercase
  color: text-primary
```

---

## Buttons

### Primary (CTA)
```
background: accent-cyan
color: text-inverse
font-weight: 700
font-size: 14–16px
text-transform: uppercase
padding: 14px 24px
border-radius: 8px
trailing icon: chevron-right (>>) at 18px
hover: background → accent-cyan-dim
```

### Secondary
```
background: surface-raised
color: text-primary
font-weight: 500
font-size: 13–15px
padding: 12px 20px
border-radius: 8px
hover: background → surface-hover
```

---

## Badges & Status Chips

All badges: `border-radius: 4–6px`, `font-weight: 600`, `font-size: 11–13px`, `text-transform: uppercase`, `padding: 4px 8px`.

| Badge | Background | Text |
|---|---|---|
| NEW | `accent-cyan` | `text-inverse` |
| Finished | `positive` | `#FFFFFF` |
| Upgrading | `accent-red` | `#FFFFFF` |
| DSQ / disqualified | `#1A1A1A` | `#FFFFFF` |

---

## Performance / Rank Bars

Horizontal stat bars used for car and driver performance rankings.

```
Bar track:   background surface-raised, height 28px, border-radius 4px
Bar fill:    gradient accent-cyan → accent-cyan-dim (left to right)
Rank badge:  right-aligned inside bar
  - 1st–3rd:    background accent-cyan,  color text-inverse
  - 4th–10th:   background surface-hover, color text-primary
  - 11th+:      background accent-red,    color #FFFFFF
Label:       left of bar, text-secondary, 13px
```

---

## Race Round Grid (Contributions)

Used to show which races a driver/car has contributed to.

```
Each cell: circle, diameter 40px, border-radius 50%
Default:    background surface-raised, color text-muted
Active:     background accent-cyan, color text-inverse
Future:     background surface-card, color text-muted, dashed border 1px surface-hover
Font:       700, 13px, zero-padded number
```

---

## Donut / Ring Charts

Used for mentality, personal situation, team health summaries.

```
Stroke width: 8–10px
Track color:  surface-raised
Segments:     accent-cyan, accent-purple, accent-yellow (in order)
Center label: font-weight 700, text-primary
Caption:      font-weight 500, text-secondary, below center label
```

---

## Icons

- Style: **outline** (not filled), 1.5–2px stroke
- Inline size: 16–20px (matches line-height)
- Button icon size: 18–24px
- Color: inherits from surrounding text token unless accented
- Recommended library: Lucide or Phosphor (outline variants)

---

## Decorative / Background Elements

- **Large background swooshes / chevrons:** white at 5–8% opacity, positioned right-side, purely decorative. Shapes are F1-inspired: forward-angled slashes and double-chevrons (>>).
- **Circuit silhouettes:** single-stroke white line-art of circuit layouts, used in race preview cards. Stroke: 1.5px, color: `text-muted` or `text-secondary`.
- **Pattern textures:** subtle dot-grid or cross-hatch overlays at very low opacity (~4%) on section backgrounds for visual depth.

---

## Colour Coding Reference (Standings / Results)

Matches the GDD-specified Wikipedia F1 convention, adapted to this palette:

| Result | Background | Text |
|---|---|---|
| 1st (Win) | `#D4AC00` (gold-yellow) | `text-inverse` |
| 2nd | `#9E9E9E` (silver-grey) | `text-inverse` |
| 3rd | `#C0622B` (burnt orange) | `#FFFFFF` |
| 4th–10th | `#1A4A2E` (dark green) | `#6EE7A0` |
| 11th+ | `#0D2A3A` (dark blue) | `#7ECFEA` |
| DNF (retirement) | `#3A1A4A` (dark purple) | `#C084FC` |
| DSQ | `#1A1A1A` (near black) | `#FFFFFF` |
