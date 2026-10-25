# StudyMap design-system inventory

Audit date: 2026-10-25  
Baseline: `main` at `4f228ef9d1e34f8bac59f37a3792fc859400cb64`  
Scope: read-only inventory of the live frontend and `FE/src`; this is not a redesign proposal.

## Method and evidence

- Inspected the live app in Chromium at all requested widths from 320 to 1920 px, in light and dark themes. Evidence files use the prefix `screenshots/codex1-visual-`.
- Compared rendered screens with `FE/src/index.css`, `FE/tailwind.config.js`, component CSS, and the shared UI primitives.
- Contrast values below use WCAG relative luminance from the actual CSS token values, not visual estimation.
- Static census of `FE/src/**/*.{js,jsx,css}` found 204 hard-coded hex occurrences in 23 files, 132 arbitrary spacing/size utilities in 34 files, 77 arbitrary-radius utilities in 26 files, and 23 arbitrary text-size utilities in 9 files. Some hard-coded colors are legitimate map/export data; the count is an inventory signal, not a blanket defect.

## 1. Current color roles

| Role | Light | Dark | Current observed use |
|---|---:|---:|---|
| Base canvas | `#F4F8FC` | `#15233B` | Landing, workspace and Study page field |
| Sidebar | `#FEFEFE` | `#1B2A41` | Workspace side panels |
| Card/panel | `#FFFFFF` | `#1B2A41` | Cards, dialogs, Study records |
| Elevated/input | `#F1F6FB` | `#101B2E` | Inputs and wells |
| Hover/subtle | `#EAF3FF` | `#223251` | Selected and hover surfaces |
| Primary text | `#102A5D` | `#ECE7DB` | Headings/body |
| Secondary text | `#5B7096` | `#A9B4C2` | Supporting text |
| Muted text | `#8294B1` | `#6B7689` | Metadata, placeholder, disabled/support copy |
| Interactive accent | `#126CF2` | `#5B9DF5` | Buttons, links, selection, focus |
| Seal/provenance/error | `#F1333A` | `#D86A53` | Wordmark accent, citations, errors |
| Success/forest | `#1F4033` | `#6FA98A` | Ready/success/progress; also some selection remnants |
| Bronze | `#A06A3B` | `#C99A6C` | Study metrics and apparatus accents |
| Warning | `#F39A1B` | `#D6A547` | Warnings/stale-map state |

There is also a theme-invariant graphite register: `--surface-contrast #26241F`, `--on-contrast #EDE8DA`, `--on-contrast-muted #A79E8C`, and `--contrast-focus #C99A6C`. It is described as an inspector/evidence material but the current workspace inspector is rendered on the normal light/dark panel surface. This leaves a second surface vocabulary in the token set with limited visible ownership.

### Measured contrast matrix

| Pair | Ratio | Result for normal text |
|---|---:|---|
| Light primary / base | 13.02:1 | Pass |
| Light secondary / base | 4.68:1 | Pass, narrowly |
| Light muted / base | 2.89:1 | Fail |
| Light muted / card | 3.08:1 | Fail |
| Light accent / white | 4.72:1 | Pass |
| White / light accent | 4.72:1 | Pass |
| Seal / white | 3.98:1 | Fail for small text; pass for large text/UI graphics |
| Bronze / white | 4.55:1 | Pass, narrowly |
| Dark primary / base | 12.74:1 | Pass |
| Dark secondary / base | 7.48:1 | Pass |
| Dark muted / base | 3.43:1 | Fail |
| Dark muted / card | 3.15:1 | Fail |
| Dark accent / card | 5.22:1 | Pass as foreground |
| White / dark accent | 2.77:1 | Fail |
| Dark seal / card | 4.20:1 | Fail for small text |
| Dark forest / card | 5.31:1 | Pass |
| Graphite muted / graphite | 5.84:1 | Pass |

The primary-button declaration always uses `color: #FFFFFF`; that works in light mode but fails against the brightened dark accent. Muted text is a semantic role used at small sizes, so its failures are not theoretical edge cases.

## 2. Duplicate and contradictory color contracts

1. `--accent` is blue, while comments around `--seal`, `--forest`, `::selection`, and Tailwind still describe earlier stages of a forest-first “Signature Contract.” One comment says seal and accent have the same value “today”; they no longer do. Another says accent “flips to forest”; current values are blue in both themes.
2. `.btn-primary` and `.btn-seal` both render the same blue action treatment. The latter name and its comment describe mutually incompatible histories (seal, then forest, now blue). The public API therefore communicates a color role that is no longer true.
3. `--seal` and `--err` share the same value in both themes although provenance and error are conceptually different. The visual result is intentional-looking red on the landing page, but system consumers cannot vary those roles independently.
4. `brand.DEFAULT`, `seal`, and `--brand-rgb` all resolve to the same red; `--seal` separately duplicates the same hex. Four names cover two conceptual roles and one value.
5. Selection is split: most interactive controls use blue `--accent`, while text selection and some MindMap selection affordances use forest. This is visible as a blue-dominant application with isolated green selection/status moments.
6. `--bg-card`, `--bg-panel`, and (in dark mode) `--bg-sidebar` are value aliases. Keeping role names is reasonable, but there is no documented rule for when a component owns “card” versus “panel.”

## 3. Typography system

The configured system has three voices:

- Display/reading: Spectral, Georgia, serif.
- Body/instrument: Inter, system UI, sans-serif.
- Metadata/apparatus: IBM Plex Mono, monospace.

Configured semantic scale:

| Token | Size / line-height | Intended role |
|---|---|---|
| `display` | `clamp(2.6rem, 5vw, 4.4rem)` / 1.05 | Landing hero |
| `h1` | 2.25rem / 1.15 | Page title |
| `h2` | 1.5rem / 1.25 | Section title |
| `h3` | 1.2rem / 1.3 | Subsection |
| `title` | 1.0625rem / 1.35, 600 | Card/component title |
| `subtitle` | 0.9375rem / 1.45 | Title support line |
| `body-lg` | 1rem / 1.7 | Long-form prose |
| `body` | 0.875rem / 1.55 | Dense UI body |
| `small` | 0.8125rem / 1.5 | Secondary UI |
| `label` | 0.8rem / 1.4, tracking .06em | Label |
| `caption` | 0.71875rem / 1.45 | Caption |
| `metadata` | 0.65625rem / 1.4, tracking .12em | Uppercase apparatus label |
| `mono` | 0.8125rem / 1.4 | Figures/IDs |

The scale itself is coherent. Adoption is incomplete: 23 arbitrary text values remain, `font-display` appears 71 times, `font-mono` 125 times, and `font-body` only twice because Inter is inherited from `body`. The resulting UI uses the serif not only for editorial titles but also for document names and map-node labels, while many high-density toolbars use very small mono labels. That weakens the boundary between “reading voice” and “instrument voice.”

## 4. Spacing and density

- Tailwind's full default spacing scale remains active, with only `4.5` (18 px), `6.5` (26 px), and `18` (72 px) added.
- 132 arbitrary spacing or dimension utilities remain across 34 files. They include widths and heights required by canvas/layout code, but also modal widths, panel heights and local padding values.
- Workspace chrome targets a dense 28/32/36/40 px control rhythm. The live metrics include 28 px theme controls and kebab buttons, 32 px panel/filter controls, 36 px attachment/shortcut controls, and 40 px primary toolbar controls.
- Study screens use roomier cards and 44 px-oriented actions, producing an observable density step when moving from `/app` to `/app/study`.
- At 768–820 px the desktop/tablet workspace still reserves both side columns. The center reading column becomes roughly 239 px wide in the audited state, while the mobile composition below 768 px is materially more usable.

The system has no explicit density token or compact/comfortable component mode. Density is currently encoded in local sizes and breakpoint branches.

## 5. Radius scale

Configured token: `rounded-control: 3px`. Actual source census:

| Radius class | Occurrences |
|---|---:|
| `rounded` | 34 |
| `rounded-full` | 33 |
| `rounded-control` | 19 |
| `rounded-[3px]` | 3 |
| `rounded-[4px]` | 11 |
| `rounded-[5px]` | 4 |
| `rounded-[6px]` | 17 |
| `rounded-[7px]` | 19 |
| `rounded-[8px]` | 12 |
| `rounded-[9px]` | 3 |
| `rounded-[10px]` | 4 |
| `rounded-[12px]` | 2 |
| `rounded-[14px]` | 1 |
| `rounded-[16px]` | 1 |

This is the clearest token-governance gap: a nominal 3 px control ceiling coexists with a near-continuous 3–16 px range. The live product visibly mixes square-ish apparatus controls, 7–8 px buttons/cards, and fully rounded segmented controls.

Recommended canonical scale for consolidation (not a new art direction): `control`, `card`, `dialog`, and `pill/full`, with each existing value mapped to one of those semantic owners before any visual value is changed.

## 6. Elevation, borders and surfaces

- Two elevation tokens exist: `--shadow-card` and `--shadow-card-hover`; Tailwind adds `shadow-header`.
- `.surface-card` applies a border, radius 8 px and shadow, and changes both border and shadow on hover. This same primitive is used for interactive cards and non-interactive result/error containers, so hover elevation can imply clickability where none exists.
- Dialogs use a shared `Modal` with border and no shadow token. Export Studio supplies its own full-height modal composition and CSS. Workspace drawers and popovers use separate local shadow/border patterns.
- Light borders are navy at 14%/24% alpha; dark borders are cream at 10%/20%. Inputs are only slightly different from their surrounding surfaces. Boundaries are visually quiet but frequently below the 3:1 non-text contrast threshold unless another cue (label, fill, shadow) carries identification.

## 7. Icons

- Canonical library: `lucide-react` through `components/ui/Icon.jsx`.
- The wrapper fixes a 16 px default size and 1.75 stroke width and uses an explicit registry, giving the core application a consistent line style.
- Live sizes vary mainly from 14 to 20 px. This is appropriate for hierarchy, but there are no semantic icon-size tokens.
- Exceptions remain in specialist map libraries and export previews. MindElixir/D3 generated glyphs, custom SVG markers, quotation symbols and the MemVidX seal do not use the Lucide wrapper.
- Compact header navigation becomes icon-only below 1024 px. Although accessible names exist in inspected DOM, visual meaning depends heavily on icon recognition.

## 8. Breakpoints and responsive regimes

Tailwind defaults used in JSX: `sm` 640, `md` 768, `lg` 1024 (51, 13 and 55 prefix occurrences respectively). CSS adds bespoke cutoffs at 480, 520, 640, 700, 760, 767, 900, 1023 and 1100 px.

Current regimes are therefore not a single scale:

- Workspace drawers switch at 768 px.
- Global header compacts below 1024 px.
- MindMap CSS has additional 480/640/700/1100 rules.
- Export Studio switches at 900/760/520 px.
- Some layout calculations encode 1280-related behavior in JavaScript/tests.

The breakpoints are individually explainable, but together they create several transition zones (700–768, 900–1024, 1024–1100) where components change at different times. The 768/820 evidence shows the practical cost.

## 9. Component inventory and states

| Family | Current implementations | State coverage observed | Inventory issue |
|---|---|---|---|
| Buttons | `.btn-primary`, `.btn-seal`, `.btn-secondary`, `.btn-danger`, `.pill-action`, `.icon-btn` plus local Tailwind buttons | hover, active, focus-visible, disabled | Primary/seal duplicate; many local size/radius overrides |
| Tabs | `.pill-tab`, `.pill-tab--sub`, `.inspector-tab`, header segmented tabs | default, hover, active, focus | Three visual tab dialects plus header-specific implementation |
| Fields | `.input-surface`, `.header-search`, native checkbox/select, local map/export fields | placeholder, focus/focus-within, invalid in forms, disabled | No shared field shell for label/help/error/success |
| Cards | `.surface-card`, StudyCard, evidence cards, map nodes | default, hover, selected/status through local classes | Interactive and passive cards share hover elevation |
| Status | badge-ready/processing/error, `Badge.jsx`, toast types, job progress, inline alerts | ready, processing, error, success | Duplicate badge routes and inconsistent prominence |
| Dialogs | `Modal.jsx`, profile, password, appearance; Export Studio custom shell | open, close, footer, scroll; responsive varies | Appearance and export have unrelated navigation/footer grammar |
| Popovers | Account menu, source filter, Study tools, mode/library menus | open/closed, hover | Different widths, radii and row heights |
| Empty/error | Workspace empty, Study empty, StudyShell error, map empty, export failures | empty, loading, failure, retry | Error layouts vary from centered editorial empty state to small upper-left card |
| Loading | Spinner, pulse skeletons, job progress | indeterminate, percentage, cancel in some jobs | No shared skeleton geometry or progress composition |
| Maps | MindElixir workspace map; react-d3-tree StudyMap | selection, zoom, pan, fit, export | Two distinct toolbars, node languages and canvas behaviors |

## 10. Recommended canonical ownership

These recommendations consolidate the existing system without choosing a future visual direction:

1. One `Button` API with `primary`, `secondary`, `danger`, `ghost`, and `icon` variants; retire the misleading `btn-seal` name after mapping consumers.
2. One `Field` composition owning label, input/select/textarea, hint, validation and disabled/read-only states.
3. One semantic radius scale with explicit component ownership; prohibit new arbitrary radii except canvas-generated shapes.
4. One `Card` base with an explicit `interactive` flag so passive errors/results do not gain hover elevation.
5. One `Tabs` component with `primary` and `subtle` levels; inspector/header variants should consume those levels rather than re-specify active indicators.
6. One `StatusBadge` and one `InlineStatus` for success/warning/error/processing; keep toasts for transient events only.
7. One responsive `Dialog/Sheet` frame with size variants; Export Studio can keep its workflow body while sharing frame, close, title and footer rules.
8. One `EmptyState`/`ErrorState` composition with density variants, consistent icon/title/body/action hierarchy.
9. One `Toolbar` sizing contract (compact 32, default 40, touch 44+) used by workspace, both map renderers and export.
10. Document color-role ownership separately from raw values: interaction, provenance, success, warning and error must remain independently addressable even when values temporarily match.

## 11. Inventory conclusion

The codebase has the ingredients of a design system—semantic color tokens, a named type scale, shared focus/disabled rules, a Lucide registry and common modal/card primitives. The unfinished part is governance: old and new color narratives coexist, semantic names no longer match rendered roles, radius/density/breakpoint decisions remain local, and specialist workflows bypass shared component grammar. The live inconsistency is therefore traceable to system seams rather than a lack of design work.
