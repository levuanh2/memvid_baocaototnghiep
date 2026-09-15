# Visual Identity Workspace Redesign

Scope: FE-only, `release/p0-p0.5-verification`. Driven by the "StudyMap Visual
Identity Reset + Workspace Simplification + MindMap Pan Fix" epic, using
`docs/StudyMap-Learning-Canvas-Prototype` as the concrete design reference.

## What this pass found first

Before changing anything, the codebase turned out to already be a mature,
Hallmark-audited design system (`FE/src/index.css`'s "Phòng đọc" /
`docs/UI_IMPLEMENTATION_PLAN.md`'s "Signature Contract"), not a raw
AI-generated first draft. Several things the epic assumed were missing or
broken were already implemented, verified against the actual code before
touching anything:

| Epic assumption | Actual state found |
|---|---|
| MindMap pan/drag is broken/incomplete | Already implemented: `MindElixirView.jsx` configures `mouseSelectionButton: 2` + `editable: true`, which — verified against `node_modules/mind-elixir/dist/MindElixir.js`'s own `handlePointerDown` — routes left-drag on empty canvas to the library's native pan, right-drag to box-select. `mindmap.css` already has `cursor: grab` / `:active { cursor: grabbing }` with correct selector specificity so node cursors stay `pointer`. A floating zoom/fit/reset control cluster already exists ("Sprint Omega"). **No pan code was added — doing so would have built a second, competing transform system, which the epic itself says not to do.** |
| Selecting/expanding a node auto-zooms or resets viewport | Not found. `toCenter()`/`scaleFit()` are wired only to explicit user-triggered buttons ("Căn giữa"/zoom controls), never to node selection or Inspector open/close. `mindmapViewport.js` + its existing test already cover viewport preservation. |
| UI is dominated by serif display type | Body default is already Inter (sans); `Spectral` (serif) is opt-in via `.font-display`, used for headings/wordmark/reading content only, not navigation chrome. |
| Buttons are permanently bordered boxes everywhere | Largely already fixed by prior work (`.pill-action`, `.icon-btn` — border is `1px solid transparent` at rest, appears only on hover/focus; comments cite this as "Sprint K: buttons disappear until needed"). |

What genuinely matched the epic's complaint, confirmed by reading the actual
render code (not just the screenshot): the global header
(`Layout/MainLayout.jsx`) and the right Inspector (`Layout/SidebarRight.jsx`)
both exposed **the same four controls** — Gia sư AI / Dòng thời gian / Kiến
thức (+ Search in the header, Bằng chứng in the Inspector) — at equal visual
weight, and the palette's primary accent was still red (`--accent: #B23A2E`),
contradicting "red is provenance/error only."

## Changes made

### 1. Palette reset — completed the pre-existing Wave 2 migration

`FE/src/index.css` and `FE/tailwind.config.js` already had a fully-built,
dark-mode-aware, contrast-verified token system with a `--forest` accent
explicitly documented as the intended replacement for the red `--accent`
(comment: *"Primary action = forest (Signature Contract §1)"*) — the flip
itself just hadn't been executed yet ("Wave 2: value is STILL seal-red for
now"). This pass completed exactly that, rather than inventing a new palette
from scratch or copying the prototype's blue literally (which would have
introduced a **third** accent hue alongside the already-shipped forest usage
in MindMap's selection ring and text `::selection` — a worse outcome than
finishing the flip already in flight):

- `--accent` / `--accent-light` (light: `#B23A2E`→`#1F4033`, dark:
  `#D86A53`→`#6FA98A`): now forest, not red. This is the general
  action/selection channel — buttons, tabs, focus rings, inputs, progress,
  theme toggle, `answer-option--selected`.
- `--seal` / `--brand-rgb` (Tailwind `text-seal`/`bg-brand`/`border-brand`):
  **unchanged, stays red.** Verified this is used only for the MemVidX
  wordmark's "X" accent and citation/provenance components (`cite-chip`,
  `evidence-frame`, `seal-meter`, `cite-block`) — matching the epic's "red is
  semantic only, not brand" requirement (provenance is a distinct, deliberate
  semantic already, not literal error/danger) while also matching the
  prototype reference's own approved pattern ("restrained red brand accents"
  — `design-qa.md` explicitly marks this as a pass, not a defect).
- `--ok` / `--warn` / `--err`: unchanged (already correctly green/amber/red).
- Base surfaces (`--bg-base/sidebar/card/elevated/panel/hover`): moved from
  warm beige/paper (`#ECE7DB` family) to a cool off-white/slate family
  (`#F5F7FA`/`#FFFFFF`/`#EEF1F6`) in light mode, per the epic's "cool
  neutral, not beige" direction. Dark mode was already navy/cool — untouched.
- `--text-primary`/`--text-secondary`: **unchanged** — already navy-charcoal
  and cool slate, exactly matching the epic's ask.
- `--text-muted`: cooled slightly (`#8A8475`→`#7C879C`) to match the new
  cool surfaces (was warm/khaki-tinted).
- Scrollbar thumb/hover: re-derived from forest instead of the old red.
- The Inspector's graphite surface (`--surface-contrast`/`--on-contrast*`)
  was **left as-is** — it's a deliberate register (not beige, not
  brick-red-branded) that was already contrast-verified specifically against
  the forest accent (`--contrast-focus`, a bronze tuned to 6.14:1 on
  graphite, exists precisely because forest itself measured 1.36:1 there) —
  i.e. it was already built anticipating this exact flip. Satisfies the
  epic's own escape hatch: "Dark Inspector may remain only if it genuinely
  integrates with the new palette."

No component file needed a hex-value edit — everything already consumed the
semantic tokens, so the whole app recolors from these two blocks.

### 2. Duplicate navigation — Inspector owns the four views, header owns the shortcut

`Layout/SidebarRight.jsx`: the four top tabs (Bằng chứng / Gia sư AI / Dòng
thời gian / Kiến thức) were on `.pill-tab` — permanently bordered+filled, the
literal "four boxed buttons" the epic names. Added a new `.inspector-tab`
class (`index.css`) — underline-on-active, border-free at rest, using the
already-verified `--contrast-focus` token for the active indicator on the
graphite surface — and switched these four buttons to it. One tier heavier
than the existing `.pill-tab--sub` (nested artifact tabs), so the two levels
stay visually distinct.

`Layout/MainLayout.jsx`: the header's Gia sư AI / Dòng thời gian / Kiến thức
buttons are the *same* views, existing there so they're reachable even when
the Inspector panel is collapsed, with real keyboard shortcuts (Ctrl+/,
Alt+T) — a real, distinct function, not pure duplication, so they were kept
rather than deleted. Demoted from `.pill-action` (icon+label) to `.icon-btn`
(icon-only, tooltip carries the label), matching the icon-only treatment the
same file already uses for its mobile search button. Search and the
StudyMap workspace-switch link (genuine Level-1/global items) were left at
full weight.

Net effect: the same feature no longer reads as two independent,
equal-weight navigation bars — the Inspector is the labeled owner, the header
is a lightweight shortcut into it.

## Not done in the first pass, closed out below

- ~~Left sidebar box-reduction~~ — audited and visually verified in the second
  pass (below): already correct, no code change needed.
- ~~Responsive workspace pass~~ / ~~micro-interaction pass~~ — verified in the
  second pass at the three mandated viewports.
- ~~Visual review (screenshots)~~ — done in the second pass; see below.
- **Hallmark skill gate** — still not invoked as a literal separate tool
  pass; its goals were applied directly against real render code and real
  screenshots instead, for the same reason as the first pass (the codebase's
  own prior sprints were already Hallmark-driven).
- **New component-render tests for navigation ownership / sidebar / drawer
  behavior** — still not added; see "Tests" below for why, confirmed by a
  full-codebase search this pass, not just a judgment call on two files.

---

## Second pass — Learning Canvas Option 2, sidebar, responsive, micro-interactions, visual QA

Confirmed `docs/StudyMap-Learning-Canvas-Prototype/AGENTS.md`: *"Selected
visual: Product Design ideation option 2, 'Learning Canvas'."* There is only
one build in that folder (`src/App.jsx` + `src/styles.css`) — it **is**
Option 2, already unambiguous, no other option folder to choose between.

### Visual verification method

No `chromium-cli`/Playwright was preinstalled. Installed on demand:
`npx -y playwright install chromium` (reused an already-cached browser
binary) + `npm install playwright@1.63.0` in the scratchpad dir (not the
repo) for scripting. Started `FE`'s own Vite dev server (`npm run dev`,
port 5173) and, separately, the prototype's own dev server (`npm run dev`,
port 5180) after `npm install` inside that folder (neither `node_modules`
was committed to the repo). Both were **killed** at the end of this pass —
confirmed via `curl` returning connection-refused on both ports.

The real backend (`VITE_API_URL`/`.env.local` → `http://localhost:8080`) is
not reachable from this sandbox. Rather than attempt a real account against
an unreachable host, `page.route()` mocked exactly three endpoints
(`/auth/me`, `/auth/login`, `/list-indexed`) with canned local JSON — no
real network call, no real account, no real data touched anywhere. This is
different from, and more conservative than, the disposable-test-account
pattern used elsewhere in this repo's production release-gate work; it was
chosen because the real backend was unreachable, not as a downgrade.

Screenshots (scratchpad, not committed — paths as captured this session):
`.../scratchpad/shots/`
- `workspace-desktop-no-doc.png` (1440×1024)
- `workspace-laptop-no-doc.png` (1024×768)
- `workspace-mobile-no-doc.png` (390×844)
- `workspace-desktop-doc-selected.png` — 2 sources selected, one with a
  deliberately long filename to exercise truncation
- `workspace-mobile-left-drawer-open.png`, `workspace-mobile-right-drawer-open.png`
- `workspace-desktop-sidebar-collapsed.png` — the `PanelSpine` "book spine"
  state
- `focus-ring-header.png`, `hover-upload-button.png`
- `prototype-option2-desktop.png` — the actual Learning Canvas Option 2
  prototype, rendered live, for direct side-by-side comparison

### 1. Left sidebar (Part 1)

**Finding: already correct, matching Learning Canvas Option 2's structure
closely — no code change made.** Verified by screenshot, not just reading
the source:

- Document hierarchy: checkbox → file-type icon → name → chunk count +
  status badge, flat rows with a hairline bottom border (`SidebarLeft.jsx`'s
  own "Wave 3" comment: replaced a 4-side-bordered-card design with this
  flat-row treatment previously — already done, not new).
- Selection state: left accent bar (3px, `var(--accent)`) + a 6% background
  tint — one signal, not three. Confirmed in the screenshot: selecting 2
  sources shows exactly this, "2 đang chọn" updates, "Chọn tất cả" checkbox
  reflects state correctly.
- Status labels: worded badges ("SẴN SÀNG"/"Đang xử lý"/"Lỗi"), not color
  alone.
- Filtering: the search input live-filters the list (existing client-side
  filter in `SidebarLeft.jsx`); not re-verified interactively this pass
  (typing into it) — visually present and correctly styled.
- Add-document action: `.btn-primary` (ink-fill) when the shelf is empty,
  demotes to `.btn-secondary` once documents exist — confirmed both states.
- **Truncation / overflow**: tested deliberately with a long filename
  (`Chuong_1_Tong_quan_he_thong_phan_tan_va_du_lieu_lon.docx`) — renders as
  `Chuong_1_Tong_...` on one line via CSS `truncate` + `min-w-0` on the
  flex chain, full name on hover via `title`. No horizontal scrollbar at
  any of the three viewports or the collapsed state.
- Collapse behavior: `PanelSpine` renders a 34px "book spine" column with a
  vertical label and a count badge (screenshot:
  `workspace-desktop-sidebar-collapsed.png`) — clean, no overlap, no
  overflow.

The one real difference from the Option 2 prototype is **hue**, not
structure — see "Accent color: forest vs. the prototype's blue" below.

### 2. Responsive (Part 2)

Existing responsive architecture (confirmed before touching anything, per
the coordinator's instruction not to invent a new one): `MainLayout.jsx`
already has a `panel.drawer` boolean (narrow widths → left/right columns
become overlay drawers with a `bg-black/40 backdrop-blur-sm` scrim) vs.
`panel.collapsed.{left,right}` (wide widths → columns collapse to a
`PanelSpine`). This is already exactly an "intentional drawer/sheet
pattern," not something to invent.

Verified at all three mandated viewports, screenshots above:

| Viewport | Result |
|---|---|
| 1440×1024 (desktop) | 3-column layout (sidebar / workspace / Inspector) — no overlap, no overflow, header buttons all fit on one row. |
| 1024×768 (laptop/tablet) | Same 3-column layout, still fits — header row does not wrap or overflow at this width. |
| 390×844 (mobile) | Single-column: hamburger (left drawer) + brand + StudyMap icon + search icon + right-panel icon + avatar, all on one row, no overlap. Left drawer opens as a scrim + panel overlay, correctly readable, close button reachable. Right drawer (Inspector) opens the same way — the new `.inspector-tab` underline row also renders correctly at this width (tabs wrap to two lines inside the fixed-width drawer, still legible, active tab still clearly indicated). |

No P0/P1/P2 responsive issue found at any of the three viewports. Composer,
header, sidebar, and Inspector never overlapped or became unreachable in
any state tested (no-doc, doc-selected, both drawers, collapsed spine).

### 3. Micro-interactions (Part 3)

Spot-checked rather than exhaustively enumerated (existing infrastructure
already covers this broadly — every shared primitive in `index.css` already
has `:hover`/`:focus-visible`/`:active`/`:disabled` rules, and a global
`prefers-reduced-motion` block collapses all transitions/animations to near
zero):

- Focus ring: tabbed to a footer sub-tab inside the graphite Inspector,
  confirmed a clearly visible bronze (`--contrast-focus`) ring — the token
  chosen specifically for contrast on that dark surface (see first pass) is
  visible in practice, not just on paper (`focus-ring-header.png`).
  Confirms the palette reset did not break focus visibility.
- Hover: confirmed on the upload button (`hover-upload-button.png`) —
  border/color shift only, no motion.
- No new animation was added anywhere this pass; nothing here needed fixing.

### Accent color: forest vs. the prototype's blue — found, not fixed, and why

`AGENTS.md` in the prototype folder explicitly says *"Keep the cool-neutral
blue visual system"* for Option 2 — a real, documented mismatch against
what the first pass shipped (forest green, completing this app's own
separate, pre-existing "Signature Contract" plan; see first pass above).

Investigated converting to blue properly before deciding against it this
pass: `grep`-ing the whole `FE/src` tree for `text-forest`/`bg-forest`/
`border-forest`/`accent-forest` (the Tailwind utility class that most of the
app — not just this workspace — already uses directly as its action color,
independent of the `--accent` CSS variable touched in the first pass) found
**22 files**: `Login.jsx`, `Register.jsx`, `Landing.jsx`, `QuizSetup.jsx`,
`StudyMapView.jsx`, `DocumentList.jsx`, `KnowledgeDashboard.jsx`, and more —
essentially the whole app's accent, not just the 3-file workspace scope
this epic and the coordinator's message have both scoped work to. `--forest`
itself is also directly consumed by MindMap's own CSS (`mindmap.css`'s node
hover border, `MindElixirView`'s selection ring, `::selection`) — the
coordinator explicitly said not to touch MindMap work absent a regression,
and MindMap has none here.

Given that real scope (a whole-app-wide, ~22-file recolor, not a
workspace-scoped fix) versus the actual severity (a hue preference — the
epic's own "indigo/cobalt/blue-violet" direction was written as a
recommendation, not an absolute requirement; the hard requirement, "red
must not be brand," is fully satisfied either way; forest is already
coherent, contrast-verified, and shipped), this reads as a **P3 open design
decision**, not a P0/P1/P2 defect this pass is obligated to fix
unilaterally. Flagged here explicitly rather than silently kept or silently
changed — a human call on whether to spend a dedicated, properly-scoped pass
converting the whole app from forest to blue.

## Tests

No new tests were added this pass. Confirmed before deciding that, not
assumed: `find src -iname "*.test.jsx"` across the **entire** `FE/src` tree
returns nothing — this codebase has **zero** React component-render tests
anywhere (`MainLayout`/`SidebarRight`/`SidebarLeft` included), only pure
logic/util tests (1020 of them). Building React Testing Library-style
render infrastructure from scratch, for the first time in this codebase,
to cover one visual/structural assertion, was judged disproportionate to
the change — consistent with the same judgment call made in the first pass,
now confirmed by an exhaustive search rather than inspection of two files.
Real verification for this pass was the screenshot evidence above instead.

`mindmapViewport.test.js` (pure-function, pre-existing) still passes — no
MindMap code was touched, so no new coverage was needed there either.

```
npm run build     →  clean, 5.7s (no source changed this pass; re-run to confirm)
npm run test      →  79 files, 1020/1020 passed — unchanged from the first-pass
                      and RC2 baselines, no regression
npx eslint src    →  58 errors / 8 warnings — identical pre-existing baseline,
                      no new errors (no source changed this pass)
git diff --check  →  clean
```

## Final status against the epic's exit criteria

- Beige/brick-red Claude-like identity gone — done (first pass).
- Red is semantic (provenance/wordmark), not brand — done (first pass).
- Global header has fewer competing controls — done (first pass), visually
  confirmed this pass.
- Inspector no longer reads as boxed buttons in a dark rectangle — done
  (first pass), visually confirmed this pass (underline tabs, no box).
- Duplicate navigation resolved — done (first pass), visually confirmed.
- Left sidebar box chrome — confirmed already low-chrome; no change needed.
- Primary workspace hierarchy obvious — visually confirmed at all 3
  viewports.
- Colors form one coherent system — true for the workspace scope touched;
  **not** true app-wide, since the wider app still reads `--forest` as green
  while this workspace's `--accent` is also forest (same hue, consistent) —
  the *inconsistency* is the unresolved forest-vs-blue question above, not
  a mismatch introduced by this pass.
- MindMap pan / node interaction / viewport preservation / no auto-zoom —
  all pre-existing and confirmed untouched, no regression found.
- Responsive behavior usable at 1440/1024/390 — confirmed, no P0/P1/P2 found.
- Build/tests remain healthy — confirmed, 1020/1020, clean build.

**Not met / explicitly open:** the prototype's specific blue hue (see
above — a named, reasoned, human-decidable gap, not an oversight). No
interactive filter-typing or upload-flow test was performed (only static
states were screenshotted). Hallmark was not run as a literal separate tool
invocation.
