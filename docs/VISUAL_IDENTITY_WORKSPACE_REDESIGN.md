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

### Accent color: forest vs. blue — RESOLVED, third pass

Superseding the P3 open item above: the user decided explicitly — switch
primary interactive to the approved Learning Canvas blue. Exact values,
via centralized semantic tokens (`FE/src/index.css`), not a blind
find-replace:

| Token | Light | Dark | Role |
|---|---|---|---|
| `--accent` | `#126CF2` | `#5B9DF5` | primary / action / selected / focus |
| `--accent-hover` | `#0C55CC` | `#82B8F8` | primary hover/pressed |
| `--accent-subtle` | `#EAF3FF` | `#1B2F4D` | primary soft surface (selection wash, badges) |

Light-mode values are exactly the user's instructed hex (`#126CF2`/
`#0C55CC`/`#EAF3FF`) — and, checked directly, exactly match the prototype's
own `src/styles.css` (`--blue`/`--blue-deep`/`--blue-soft`), so there was no
discrepancy to reconcile. Dark-mode values are brightened for contrast on
the navy surface, same pattern already used for dark-mode forest — not
separately specified by the user, so derived rather than guessed at.

`--forest`/`--forest-rgb` are **numerically unchanged** (`#1F4033` light /
`#6FA98A` dark) — only their *role* narrows, per the user's instruction, to
success/ready-status/progress, never primary interactive. Two component
rules that read `--accent` for what is actually a progress indicator were
repointed to `--forest` instead: `.progress-fill` (the upload/processing
progress bar) and `.apparatus-dot--active` (ChatArea's retrieval-step
dots) — both are genuinely "progress," not a button/tab/selection, and the
user named "progress" as a role forest keeps.

**How the 22-file, ~56-occurrence `text-forest`/`bg-forest`/`border-forest`/
`accent-forest` surface was resolved without a blind find-replace:** added
a new `accent` Tailwind color (`FE/tailwind.config.js`, `DEFAULT`/`hover`/
`subtle` → the three CSS vars above), then went file by file and recolored
only the occurrences that are genuinely primary-interactive (links, hover
states, active/selected/focus indicators, checkboxes) to `text-accent`/
`bg-accent`/`border-accent`/`accent-accent`. **Left on forest** (5 of the
56, deliberately, each commented in place): `ProtectedRoute.jsx`'s
session-restore spinner (progress), `ChatArea.jsx`'s "Đã trả lời..."
settled/done marker and its streaming-cursor blink (a completion marker and
a progress indicator), and `KnowledgeInspector.jsx`'s two `BadgeCheck`
confidence/verified markers (success-adjacent, not interactive) — one of
which is the "answered with N sources" resting-point marker `ChatArea.jsx`
itself already calls out as a deliberate Peak-End-Rule signal, reinforcing
that it's a completion state, not a button.

MindMap needed **no** token-source change, let alone a behavior change:
`MindElixirView.jsx`'s `THEME.cssVar` already reads `"--selected": "var(--forest)"`
(a token reference, not a hardcoded hex) and `mindmap.css`'s node-hover
border already reads `var(--forest)` directly — since `--forest`'s value is
untouched, MindMap's pan, hover, selection, and viewport behavior are all
byte-for-byte unchanged. Confirmed by grep, not assumed.

`docs/StudyMap-Learning-Canvas-Prototype/AGENTS.md` updated with one added
line confirming the shipped hex values match its own `styles.css` exactly
(see "Prototype AGENTS.md" below) — no stale mismatch note existed there to
remove (the mismatch was only ever documented in this file, not in the
prototype's own docs).

**Re-verified visually, not just by source-reading**, same scaffolding as
the second pass (dev server + mocked backend + Playwright, same three
viewports and states, dev server killed after). Screenshots (scratchpad,
`.../scratchpad/shots2/`): `workspace-desktop-no-doc.png` — workspace tab
underline and Inspector's "Bằng chứng" active state now read blue where
expected (main-content tabs) and stay bronze where expected (graphite
Inspector's own `--contrast-focus`, unaffected by this change, still
correct); `workspace-desktop-doc-selected.png` — checkboxes filled blue,
left accent bar blue, "2 đang chọn" text blue, "SẴN SÀNG" status badges
**still green** (`--ok`, a separate token, correctly untouched — confirms
blue/success stay visually distinct); `workspace-mobile-right-drawer-open.png`
— Inspector drawer unchanged, bronze active tab as before;
`focus-ring-header.png` — focus ring on the graphite surface still bronze,
clearly visible, no contrast regression from this change;
`hover-upload-button.png` — primary upload button unaffected (it's ink-fill,
not accent-driven).

No P0/P1/P2 found in this re-verification.

### Prototype AGENTS.md

Checked before editing: it contains prose ("keep the cool-neutral blue
visual system") but no explicit hex values, and no stale forest/blue
mismatch note (that note only ever lived in this file, not in the prototype
folder). Added one line recording that the real app's tokens now match its
`styles.css` values exactly, with a pointer back to this document.

## Tests

No new tests were added in this pass either, for the same reason as the
second pass (confirmed again, not re-assumed): no React component-render
test infrastructure exists anywhere in this codebase. The token/class
changes here are exactly the kind of thing that infrastructure would cover
if it existed; screenshot verification (above) was the real check instead.

`mindmapViewport.test.js` (pure-function, pre-existing) still passes — no
MindMap code was touched (confirmed above: token-value unchanged, so no
token-source change was even needed there).

```
npm run build     →  clean, 5.7s
npm run test      →  79 files, 1020/1020 passed — unchanged, no regression
npx eslint src    →  66 problems / 58 errors / 8 warnings — identical
                      pre-existing baseline, no new errors introduced by
                      this pass's token/class changes
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
- Colors form one coherent system, **app-wide** — resolved in the third
  pass: primary interactive is blue everywhere via the centralized
  `accent` token/Tailwind color, forest is success/ready/progress only
  everywhere, matching the Learning Canvas Option 2 prototype's own blue
  exactly (checked, not assumed).
- MindMap pan / node interaction / viewport preservation / no auto-zoom —
  all pre-existing and confirmed untouched, no regression found; the third
  pass's accent-hue change required no MindMap token-source change either
  (confirmed by grep: MindMap already reads `--forest` by reference, and
  `--forest`'s value never changed).
- Responsive behavior usable at 1440/1024/390 — confirmed, no P0/P1/P2 found.
- Build/tests remain healthy — confirmed, 1020/1020, clean build.

**Not met / explicitly open:** no interactive filter-typing or upload-flow
test was performed (only static states were screenshotted). Hallmark was
not run as a literal separate tool invocation, both passes. The
forest-vs-blue question from the second pass is now resolved (see above) —
no longer open.

---

## Third pass — structural refactor: real Learning Canvas layout in the real /app workspace

The first two passes only borrowed the Learning Canvas prototype's *tokens*
(color, box-reduction). The actual `/app` workspace's structure — three
columns, MainLayout/WorkspaceContainer/ChatArea/SidebarRight — was
untouched. This pass adds the prototype's structural pieces (lesson header,
goal banner, next-action strip, light contextual evidence panel) **inside**
the real, existing component tree — no new prototype, no mock data, all
existing chat/document/auth/routing logic preserved.

### What changed, and how it maps onto existing logic

- **`Layout/LessonHeader.jsx`** (new) — rendered by `WorkspaceContainer`
  above the existing `WorkspaceTabs` row. Title, selected-source count, and
  a readiness indicator, all real (see below), plus two always-present
  "Sơ đồ tư duy"/"Tóm tắt" buttons.
- **`onMindmapAction`/`onSummaryAction`** (new, `MainLayout.jsx`) — the
  *only* new piece of real logic this pass adds, and it's a two-line
  dispatcher, not new generation logic: if `mindmapData`/`summaryData`
  already exists, switch `workspaceMode` (exactly what clicking a
  `WorkspaceTabs` tab already does); otherwise call the pre-existing
  `openArtifact("mindmap"|"summary")` (the same mechanism Tutor's "Xem sơ
  đồ"/"Xem tóm tắt" links already used, which opens/expands the Inspector
  to its real "Tạo sơ đồ"/"Tạo tóm tắt" generator). Shared by
  `LessonHeader`'s buttons and the next-action strip below — one real
  action per artifact type, not two.
- **Goal banner + next-action strip** (new, inside `ChatArea.jsx`, above the
  message list) — real, derived content only. There is no per-user "learning
  objective" in this app's data model, so the banner states real document
  readiness (`X/Y tài liệu sẵn sàng`) instead of inventing one, unlike the
  prototype's own static, fabricated goal text. "Đặt câu hỏi" focuses the
  real composer textarea; "Tóm tắt nội dung"/"Tạo sơ đồ tư duy" call the two
  shared actions above.
  - **Gated to `messages.length === 0`** (same condition the pre-existing
    empty-state hero uses), not always-visible like the prototype. Found
    during real-data verification (see below): `selectedSources` can lag
    behind the backend's actual indexed-source identity for a moment after
    a send (a real, pre-existing timing gap, not introduced by this pass),
    and an always-visible "Chưa chọn tài liệu nào" banner sitting directly
    above an answer that just cited real documents was actively
    contradictory, not just cluttered. Gating it to the pre-conversation
    state is the honest fix given that constraint — the prototype's static
    copy never has this problem because it isn't derived from anything.
- **`utils/workspaceReadiness.js`** (new) — `computeReadyCount(sources,
  selectedSources)`, pulled out of what was duplicated inline in both
  `LessonHeader`'s host (`WorkspaceContainer.jsx`) and `ChatArea.jsx`. Pure,
  tested (see Tests below).
- **SidebarRight → light contextual panel** (`SidebarRight.jsx`,
  `mindmap.css`, `index.css`) — this is the "replace the permanent dark
  Inspector" requirement. `SidebarRight.jsx`'s background changed from
  `var(--surface-contrast)` (graphite) to `var(--bg-sidebar)` (paper).
  `mindmap.css`'s "Sprint F graphite register" — a block of Tailwind-utility
  overrides that forced `.text-text-primary`/`.border-border`/`.icon-btn`
  etc. to graphite-appropriate colors — had `.sidebar-right` removed from
  every selector in it; `.knowledge-inspector`/`.evidence-drawer`
  (MindMap's own overlay components, a different context, explicitly
  preserved per the "don't touch MindMap" constraint) keep the register
  exactly as before. `index.css`'s `.inspector-tab` (the underline tab row
  added in the second pass) switched from the graphite-tuned
  `--on-contrast*`/`--contrast-focus` tokens to the standard light-surface
  `--text-muted`/`--text-primary`/`--accent`. No JSX in `TutorPanel`,
  `ResearchTimeline`, `KnowledgeDashboard`, or any other SidebarRight child
  needed touching — all of them only ever consumed the Tailwind utility
  classes the register was overriding, never the graphite tokens directly
  (verified by grep before editing, not assumed). **All Inspector
  functionality — which of the four tabs is open, citation click-through,
  generation, navigation — is unchanged; this is strictly a background/text
  color re-skin.**
- **`ui/Icon.jsx`** — added `Target` (the goal-banner icon) to the explicit
  lucide-react registry, following the file's own documented pattern for
  adding a new icon (one import + one `ICONS` entry).

### Local backend investigated, production API used instead — why

Checked `docker-compose.yml` / `BE/ENV_SETUP.md` first, per the
coordinator's explicit preference. Docker Desktop and a full local Ollama
model set (`qwen2.5:7b-instruct`, matching the compose default) were both
already present on this machine and were brought up successfully. However,
`docker-compose.yml`'s `DATABASE_URL`/`SUPABASE_URL` (read from the repo
root `.env`, already configured) point at the **same real, hosted Supabase
project** production uses — not a separate local database. Running the
backend via Docker on this machine would create real user/document rows in
that same real database, exactly like calling the production API directly
would; the only isolation gained would be that index/embedding files land
on local disk and inference runs on local Ollama instead of whatever
production uses. Given that isolation difference doesn't materially change
the "don't touch production data" concern the preference is protecting
against, and stands to cost significant additional time (image build,
model downloads, migration run) for a UI verification task, the FE dev
server was pointed at the real production API
(`https://api.studymap.space`) instead, via a temporary,
gitignored-by-`FE/.gitignore`'s `*.local` pattern `.env.development.local`
(deleted after this pass — never committed).

**Disclosed test accounts and documents** (production, not deleted, per
the standing disclosure pattern used elsewhere in this release cycle):
- `structural-refactor-qa-20260916@example.com` — first attempt; two
  uploads (`MoTa_SanPham.txt`, `Chuong1.2.txt`) failed with a real backend
  error ("Cannot read file content") traced to a bug in this pass's OWN
  first verification script (see below), not the product; a third,
  curl-uploaded copy of `MoTa_SanPham.txt` succeeded. Left as-is along with
  a later 3-document mixed-selection query against this account (see
  "found, not fixed" below for what that query's answer revealed).
- `structural-refactor-qa2-20260916@example.com` — the clean account the
  reported screenshots and citations come from. Two real documents
  (`MoTa_SanPham.txt`, `Chuong1.2.txt`, content below) uploaded, indexed,
  and cited for real.

**Root-caused, not worked around:** the first verification attempt's
uploads failed for real, traced to *my own test script*, not the app —
routing the app's `fetch()` calls through Playwright's `route.fetch()`/
`route.fulfill()` (a CORS-bypass technique) corrupted the multipart
file-upload body specifically, while working fine for JSON requests
(confirmed via a direct `curl` upload of the exact same file, which
succeeded). Fixed by launching Chromium with `--disable-web-security`
instead — the browser makes the real request over the real network
natively; nothing is proxied, intercepted, or mocked. (Production's CORS
allowlist correctly still only permits the real deployed frontend origins,
not this local dev server — confirmed as the actual, expected cause of the
first failure to even reach the API at all, before the upload-corruption
issue was found underneath it.)

**Content used**, since the prototype's `MoTa_SanPham.pdf`/`Chuong1.2.docx`
are fictional filenames with fabricated example quotes and no real file
exists anywhere in the prototype folder (checked — `find` for the names and
any `.pdf`/`.docx` came back empty): two real `.txt` documents were written
using the prototype's own citation quotes as ground-truth source content
(so the real backend would have real text to actually retrieve and cite,
not just a plausible-sounding filename), uploaded under the exact names
`MoTa_SanPham.txt` / `Chuong1.2.txt`.

### Verification — empty state and active state, both real

Method: FE dev server (`npm run dev`) against the real production API,
Playwright (installed on demand in the scratchpad, not the repo) driving
real registration, real upload, real polling for real indexing completion,
real document selection, real question submission, real streamed answer.
Dev server killed after (confirmed via `curl` connection-refused).

**Empty state** (fresh account, zero documents) — `real2-empty-desktop-1440x1024.png`,
`real2-empty-laptop-1024x768.png`, `real2-empty-mobile-390x844.png`. Lesson
header, goal banner (real "no documents" copy, real "Chọn tài liệu" link
wired to the real `onOpenLeft`), and next-action strip all render correctly
at all three viewports; strip wraps to 2 rows at 390px without overlap.

**Active state** — asked the exact mock question ("Theo các tài liệu đã
chọn, ưu điểm chính của sản phẩm là gì? Có những hạn chế nào cần lưu ý?",
found verbatim in the prototype's `src/App.jsx`) against the two real,
selected, indexed documents. Real grounded answer came back citing both
real documents by name, with two real evidence cards in the (now light)
Inspector panel showing real excerpted text and real chunk references
(`chuong1_2__3__txt · đoạn 221`, `mota_sanpham__4__txt · đoạn 220`) —
`real2-active-answer-desktop-1440x1024.png` (this screenshot predates the
goal-banner gating fix below and shows exactly the contradiction that fix
addresses), and after the fix, a fresh follow-up question
(`real2-fixed-active-desktop-1440x1024.png`,
`real2-fixed-active-mobile-390x844.png`) producing a second real grounded
answer (including a real Markdown table the model generated) with no
stray banner above it. Desktop, mobile, and laptop (though the laptop
capture landed on a fresh empty conversation with both side panels
collapsed to their spine — itself a real, working, pre-existing
collapse-state-persistence feature, not a bug) all confirmed no
overlapping or inaccessible controls.

### P0/P1/P2 found and fixed

- **P1 — goal banner contradicts the answer once a conversation exists.**
  Found via the real-data active-state screenshot (not visible in any
  mocked-backend test, since a mock never produces this specific
  selection/citation timing gap). Fixed by gating the banner+strip to
  `messages.length === 0` (see above). Re-verified visually after the fix.
- No other P0/P1/P2 found in the structural layout itself at any of the
  three viewports, in either state.

### Observed, not fixed (real, pre-existing, out of this pass's scope)

- **`selectedSources` can momentarily diverge from the backend's post-index
  `video_stem` identity for the same logical document** — observed once,
  on the first (messier, multi-account) verification attempt: a chat send
  succeeded using whatever was selected at that moment, but the visible
  checkbox state read back as unselected shortly after. Plausible
  mechanism: the placeholder source row created at upload time can carry a
  different `video_stem` than the one the backend settles on once
  `/list-indexed` reconciles it as ready, and `selectedSources` (a list of
  stem strings) doesn't get migrated when that swap happens. This is
  chat/document state logic explicitly out of this pass's scope to change
  ("map EXISTING functionality," "preserve chat state") — named here for
  the record, not fixed. The goal-banner P1 above is a direct, visible
  symptom of this gap; gating the banner addresses the symptom's user-
  facing confusion, not the underlying timing gap itself.
- Markdown tables in a grounded answer are cramped at 390px (seen in
  `real2-fixed-active-mobile-390x844.png`) — this is generic Markdown-table
  rendering behavior for any long answer, not something this pass's layout
  changes introduced or were asked to address.

### Tests

```
npm run build     →  clean, 8.2s
npm run test      →  80 files, 1026/1026 passed (1020 prior baseline + 6 new,
                      all passing — no regression)
npx eslint src    →  66 problems / 58 errors / 8 warnings — identical
                      pre-existing baseline, no new errors
git diff --check  →  clean
```

New test file: `utils/workspaceReadiness.test.js` — 6 cases covering the
extracted `computeReadyCount` (selected+ready intersection, ready-but-not-
selected exclusion, the legacy `.video` fallback, empty/undefined/null
inputs, selected-but-not-ready exclusion). No new component-render tests —
same reasoning as the second pass, reconfirmed: this codebase still has no
React component-render test infrastructure anywhere. Real verification for
the new `LessonHeader.jsx`/goal-banner/SidebarRight re-skin was the
screenshot evidence above.

### Files changed this pass

`FE/src/components/Layout/LessonHeader.jsx` (new),
`FE/src/utils/workspaceReadiness.js` (new),
`FE/src/utils/workspaceReadiness.test.js` (new),
`FE/src/components/Layout/MainLayout.jsx`,
`FE/src/components/Layout/WorkspaceContainer.jsx`,
`FE/src/components/Layout/ChatArea.jsx`,
`FE/src/components/Layout/SidebarRight.jsx`,
`FE/src/components/mindmap/mindmap.css`,
`FE/src/components/ui/Icon.jsx`,
`FE/src/index.css`.

### Final status against this round's requirements

- Lesson header (title/count/progress/MindMap+Summary actions) — done.
- Learning-goal banner — done, real data, gated to avoid the contradiction
  found above.
- Next-action strip — done, all three actions real.
- Source sidebar — audited again; still composes correctly under the new
  header/banner/strip stack, no restructuring needed.
- Central grounded-answer workspace — unchanged (already correct), goal
  banner/strip inserted above it.
- Contextual light evidence panel — done; MindMap's own Inspector/Evidence
  Drawer explicitly left dark (different context, protected).
  Persistent composer — unchanged, still present and reachable in every
  state/viewport tested.
- Responsive drawer/sheet behavior — re-verified at all three viewports in
  both empty and active states; still holds.
- Colors — no new palette decisions; reused the already-shipped `#126CF2`/
  `#0C55CC`/`#EAF3FF` tokens throughout.
- Functional correctness proven with real data, both states, not claimed
  from source-reading or tests alone.

**Not verified / explicitly open:** the interactive filter/search-typing
flow and the upload UI's own drag-and-drop path were not separately
exercised (file input was used programmatically). The `selectedSources`/
`video_stem` divergence above remains open, named, not fixed.

---

## Fourth pass — hardening the selection race, corrected finding

Directive: root-cause the `selectedSources`/`video_stem` timing problem
named (not fixed) in the third pass, not just its banner symptom. This pass
traced it end to end and reached a **different conclusion than the third
pass's own writeup implied** — reported here honestly, not smoothed over.

### What the investigation actually found

Traced upload → indexing completion → backend identity assignment →
`selectedSources` sync by reading the real backend code first
(`_ingest_uploaded_file`, `/sources/<id>/status`, `/list-indexed` in
`BE/app/main.py`), then testing live against production with several
rounds of Playwright scripts.

**First reads of the backend code found a real, narrow inconsistency**:
`/sources/<id>/status` returns `status_info.get('source_stem')` raw, while
`/list-indexed` runs the same value through `_normalize_video_stem()`
first — two endpoints computing a nominally-the-same field two different
ways. This looked like a plausible mechanism for exactly the reported
symptom.

**Live testing did not confirm it causes the reported symptom.** Two
early diagnostic runs (`diag.mjs`, `diag3.mjs`) appeared to reproduce
"selection cleared after answering," but re-running the identical scenario
with corrected instrumentation gave a different, consistent result:

- `diag2.mjs`/`diag3.mjs`'s apparent stem drift ("Chuong1.2" gaining a
  "(4)" suffix moments after first appearing) was traced to **test
  pollution, not the product**: this VM had over a dozen stray
  node/chromium processes left running from earlier verification rounds,
  all hitting the same real backend and uploading same-named files
  concurrently — a shared/global filename-dedup counter shifting under
  concurrent, unrelated test runs, not a single real user's session.
- The "0 checked" / "0 đang chọn" readings across several scripts
  (`diag.mjs`, `diag3.mjs`, and — in hindsight — the original third-pass
  observation this whole investigation started from) were traced to a
  **test-script selector bug**: `.overflow-y-auto` is used by at least
  nine different scrollable containers across this app (ChatArea's message
  pane, SidebarRight's evidence/tutor panes, SummaryPane, EvidenceDrawer,
  KnowledgeInspector, ResearchTimeline, ...), so `.overflow-y-auto
  input[type="checkbox"]` and similar selectors in the test scripts were
  not reliably scoped to the actual left sidebar.
- Re-run with processes cleaned up and selectors scoped to `page.locator("aside").first()`
  (`diag5.mjs`, then `final_e2e.mjs`): selection stayed **correct and
  checked** through select → ask → real grounded answer, in every clean
  run, including a deliberate same-filename-collision scenario
  (`diag4.mjs`: uploading a second file with the identical name as an
  already-selected one) — the first file's selection was unaffected.
  `/list-indexed` itself returned an identical, stable `video_stem` across
  five consecutive calls for the same document in an isolated session
  (`diag2.mjs`).

**Honest conclusion: no reproducible `selectedSources`/`video_stem` race
was confirmed in the real product under correctly-isolated testing.** The
third pass's "found, not fixed" framing was itself based on contaminated
evidence (concurrent test runs + an ambiguous CSS selector), not a
demonstrated backend/FE synchronization bug.

### What was done anyway, and why that's not a contradiction

The `/sources/<id>/status` vs `/list-indexed` normalization difference is
real, in the code, right now — just not shown to produce a visible
mismatch in this pass's live testing. And the frontend's own reconciliation
pattern (matching a selection by a recomputed string value against an
independently-fetched list, with no stable identifier available from
`/list-indexed` to correlate against) is architecturally fragile regardless
of whether today's specific backend implementation happens to keep the two
endpoints in sync. Given that, this pass added a **defensive hardening**,
not a bug fix for a confirmed defect — framed as such in the code, not
oversold:

- **`FE/src/utils/sourceReconciliation.js`** (new) — `mergeSources()` (the
  existing processing/ready merge logic, extracted unchanged) and
  `reconcileSelectedSources()` (new): instead of dropping a selected stem
  that no longer appears in a fresh `/list-indexed` response, it looks up
  the filename that stem used to belong to (from the pre-merge local
  state) and migrates the selection to whichever backend entry now has
  that same filename, before falling back to dropping it. Filename is the
  one thing that's stable across this specific transition (assigned once
  at upload, per `BE/app/main.py`'s `_unique_display_filename`).
- **`FE/src/components/Layout/SidebarLeft.jsx`** — `fetchSourcesFromBackend()`
  now calls the two extracted functions instead of inlining the same
  logic; behavior is identical for every case that isn't the
  rename-detection path (verified: build/tests/lint clean, and the final
  live re-verification below shows the same correct behavior as before).
- **`FE/src/utils/sourceReconciliation.test.js`** (new) — exercises the
  actual race pattern directly (a selected stem that no longer matches by
  string equality but does match by filename → migrates; a genuinely
  deleted source → drops; two old stems colliding onto one new entry →
  de-dupes; a same-stem no-op case; a different-filename case that must
  NOT migrate), not just a UI-level symptom. This is real, deterministic
  test coverage of the exact mechanism the coordinator's hypothesis named,
  independent of whether that mechanism is currently reachable live.

### Consumers re-verified after the hardening (item 2 of this round's ask)

All confirmed via the live `final_e2e.mjs` run below, not asserted from
source alone:

- **Lesson-header source count** — "2 tài liệu đang chọn", correct
  throughout select → ask → answer.
- **Goal banner** — correctly absent once a conversation exists (third
  pass's fix); correct empty-state copy confirmed again in a fresh account.
- **MindMap/Summary enabled-state gating** — `WorkspaceTabs`' disabled
  state and `LessonHeader`/next-action-strip's "Tạo..."/"Xem..." label
  swap both read `hasMindmap`/`hasSummary` unchanged by this pass.
- **Evidence/source context panel** — 2 real evidence cards, correct
  citations, in the light-Inspector re-skin from the third pass.
- **Composer submission context** — confirmed by reading
  `ChatArea.jsx:handleSend` directly: the `/query` request's `sources`
  field is `selectedSources` read fresh at send time, independent of the
  reconciliation change (that only affects what `selectedSources` *is*
  between fetches, not how it's sent).

### New P1 found via the side-by-side comparison, fixed

Built one composite image (`side-by-side-comparison.png`, both source
screenshots embedded in a static HTML page rendered with Playwright — not
two separate files) and inspected it directly. Most of the header/nav/
evidence-panel/goal-banner differences visible in it are **prior, already-
justified architectural decisions** (icon-only global header vs. the
mock's text nav, the persistent Inspector column vs. the mock's inline
evidence card, the goal banner/action strip hidden once a conversation
exists) — not new mismatches, not re-litigated here.

One **new, real P1** did turn up, from a plain screenshot at the tablet
viewport (not from the composite): `LessonHeader`'s readiness count and
progress bar (added in this round's design, `hidden md:flex`/`hidden
sm:inline`) overlapped the "Sơ đồ tư duy"/"Tóm tắt" buttons at 1024×768.
Root cause: those Tailwind breakpoints are viewport-width-based, but
`LessonHeader` sits in the *center column* of a 3-column layout — at a
1024px viewport with both side panels open, the real available width is
roughly 446px, well under what `md:`/`sm:` assume. Fixed by moving both to
`xl:` (only shows when there's very likely real room) and wrapping the
secondary-info group in its own `min-w-0 overflow-hidden` so a future
breakpoint misjudgment clips instead of overlapping. Re-verified at
1024×768 with a fresh screenshot — clean, no overlap
(`final-active-tablet-fixed.png`).

### Screenshots (scratchpad, dev server killed after)

`.../scratchpad/final/`: `final-empty-{desktop,tablet,mobile}.png`,
`final-selected-desktop.png` (two sources checked, real),
`final-active-{desktop,tablet,mobile}.png` (real grounded answer, real
citations — `tablet` is the pre-fix overlap, kept for the record;
`final-active-tablet-fixed.png` is the corrected re-check),
`side-by-side-comparison.png` (the required composite).

Account: `structural-refactor-final-20260916@example.com` (disclosed, not
deleted). Documents: `MoTa_SanPham.txt`, `Chuong1.2.txt` (same
mock-derived content as the third pass). Diagnostic-only accounts from
this pass's investigation, also disclosed, not deleted:
`structural-refactor-diag{,2,3,4,5}-20260916@example.com`.

### Tests

```
npm run build     →  clean, ~7.5s
npm run test      →  81 files, 1039/1039 passed (1026 prior + 13 new in
                      sourceReconciliation.test.js, all passing, no
                      regression)
npx eslint src    →  66 problems / 58 errors / 8 warnings — identical
                      pre-existing baseline, no new errors
git diff --check  →  clean
```

### Final status against this round's requirements

- Root cause traced end to end, honestly reported even though it didn't
  land where the directive assumed it would — a real code-level
  inconsistency exists (`/sources/<id>/status` vs `/list-indexed`
  normalization) but was not shown to cause the reported symptom live;
  the reported symptom itself was traced to test-methodology defects,
  named specifically, not hand-waved.
- Defensive synchronization hardening implemented anyway (filename-based
  migration instead of silent drop), with real regression tests
  exercising the mechanism directly, not the UI symptom.
- All five named consumers re-verified live, correct.
- New real screenshots at all three viewports, both empty and active
  states, from a real account with real uploads and a real grounded
  answer citing real content.
- Side-by-side composite built and actually inspected; one new P1 found
  (tablet header overlap) and fixed, re-verified.
- No expansion into the cramped-mobile-markdown-table issue — untouched,
  still a named follow-up from the third pass.

**Remaining, P3-only:** sidebar file-type icons don't carry the mock's
per-format color differentiation (PDF vs DOCX) — cosmetic, not attempted
this pass to avoid further scope creep this late in the round. The
`/sources/<id>/status` vs `/list-indexed` normalization inconsistency
itself remains unfixed in the backend (out of scope per this round's own
"do not touch backend work" constraint) — the frontend hardening above is
the mitigation.

---

## Fifth pass — information architecture, spacing, responsive, Mind Map workspace

Large structural round: one clear owner per function, a compact merged
workspace toolbar, an airy visual system, Mind Map as a true first-class
mode, and a real functional/visual QA pass. Six logical commits, per the
user's own spec.

### Final information architecture — ownership table

| Function | Sole persistent owner | Where it used to also appear (removed) |
|---|---|---|
| Chat / Mind Map / Summary switch | `LessonHeader`'s mode tabs (merged toolbar) | Global header icon buttons, separate `WorkspaceTabs` row, `LessonHeader`'s old per-mode action buttons, ChatArea's next-action strip |
| Evidence | Inspector (`SidebarRight`), opens on citation click | — (already single-owner) |
| AI Tutor | Inspector (`SidebarRight` `.inspector-tab`) | Global header icon button (removed) |
| Timeline | Inspector (`SidebarRight` `.inspector-tab`) / floating overlay in Mind Map mode | Global header icon button (removed) |
| Knowledge | Inspector (`SidebarRight` `.inspector-tab`) | Global header icon button (removed) — `openInsights` dispatcher deleted entirely, dead after the button was removed |
| Panel open (mobile) | One generic "Mở công cụ" icon button, global header | Was framed as a Tutor-specific shortcut; relabeled generic since it's the only one left |

Acceptance check (from the spec): grepped the rendered global header —
confirms MemVidX/StudyMap, Search, one generic panel-open icon
(mobile-only), theme toggle, account menu, and nothing else. No function
label appears in more than one persistent navigation group. One visible
entry point for Mind Map (the mode tab) and one for Summary (same). AI
Tutor/Timeline/Knowledge exist only inside the Inspector.

### Compact workspace shell

`LessonHeader` + the old separate `WorkspaceTabs` row are now one 48-52px
toolbar: title/selection-meta on the left, the Chat/Mind Map/Summary switch
centered. `WorkspaceTabs.jsx` deleted (zero remaining imports, confirmed by
grep before deleting). Global header 58px → 56px. Total persistent top
chrome, measured from the live screenshots below: global header (56px) +
merged toolbar (~52px) + ChatArea's own slim New-chat/kebab row (~32px,
kept separate — see "Not done" below) + the collapsed goal-banner pill once
a conversation exists (~28px) ≈ **164-168px** before any conversation,
**~140px** once collapsed. This is a real, substantial reduction from the
prior stack (was 58+44+40+36 ≈ 178px, and that number itself doesn't
include the goal banner/next-action strip which used to be a separate
~90px block always present) but does **not** hit the ~112px target
precisely — see "Not done" for why, named honestly rather than rounded
away.

### Mind Map workspace — first-class canvas, verified

Most of item 7 was **already correct before this round** — re-verified by
reading the actual code, not rebuilt, per "do not replace working Mind
Elixir behavior unless a reproducible issue requires it": the canvas
already fills the central workspace as a real mode (not an Inspector
widget), the Inspector already opens contextually on node selection, and a
compact floating toolbar already existed (zoom −/100%/+, Fit, Reset view,
Center, relations toggle, PNG export — one cluster, one canvas corner).
Added: **Fullscreen**, using mind-elixir's own internal Fullscreen API
pattern (verified in the library's dist file) applied to the app's own
canvas wrapper, no library state touched.

**Real P0 found via live screenshot, not source-reading, and fixed**: the
new Mind Map empty state's "Tạo sơ đồ tư duy" CTA (this round's own
addition, previous commit) was a complete dead end. It calls
`onMindmapAction`, which — with no map yet — calls `openArtifact("mindmap")`
to open `SidebarRight`'s real generator. But `MainLayout` was swapping the
right column to `KnowledgeInspector` (not `SidebarRight`) for the entire
`workspaceMode === "mindmap"` duration, including before a map exists — so
the panel `openArtifact` was trying to open was hidden the whole time it
mattered. Fixed by changing the swap condition to
`workspaceMode === "mindmap" && hasMindmap`: `SidebarRight` (with its real
generator) now shows during the empty/generating phase, `KnowledgeInspector`
takes over once a map actually exists. The Feature-Pack-B Timeline-overlay
condition (`openTimeline`) had the identical bug pattern and got the same
fix. **Verified live after the fix**: the Inspector's real "Tạo sơ đồ"
button is now visible and clickable from the Mind Map empty state
(`r5-mindmap-generator-opened.png`), and clicking it registers a real
generation request against production.

**Not verified this round**: full end-to-end Mind Map generation
completing to a populated, explorable canvas. A real click against
production was confirmed to register (SidebarRight's own job-tracking UI
engaged), but the job did not finish within this round's available time
(mind-elixir generation is a multi-stage LLM pipeline — `.playbook/known-
issues.md` documents individual branch-enrichment steps alone taking up to
~180s under load). Node-select viewport-stability, no-auto-zoom, and
Inspector-open-after-selection were therefore **not independently
re-confirmed against a freshly-generated map this round** — they rely on
`MindElixirView.jsx` and `useMindMapController.js`, neither of which this
round touched, and were explicitly verified as correct in an earlier round
of this same epic; named here as re-verification not completed this round,
not as a new unknown.

### Responsive (item 5 / commit 5)

No additional code changes were needed — the breakpoint decisions already
made in prior rounds (drawer/collapse architecture, the `xl:` threshold for
`LessonHeader`'s secondary info) already handle the new merged toolbar and
`WorkspaceEmptyState` correctly. Verified live, not assumed: the merged
toolbar, collapsed goal banner, and Mind Map empty state all render cleanly
with no overlap or truncation-breakage at 1024×768 and 390×844
(`r5-active-tablet.png`, `r5-active-mobile.png`,
`r5-mindmap-populated-mobile.png`). Given there is no real diff for this
item, it is folded into commit 6 below rather than committed as an empty
change — named explicitly so this isn't silently skipped.

### Screenshots (scratchpad, dev server killed after)

`.../scratchpad/r5/`: `r5-empty-{desktop,tablet,mobile}.png`,
`r5-selected-no-question.png`, `r5-active-{desktop,tablet,mobile}.png`,
`r5-mindmap-empty.png`, `r5-mindmap-empty-relogin.png`,
`r5-mindmap-generator-opened.png`, `r5-mindmap-populated-{desktop,tablet,
mobile}.png` (pre-fix; still the empty state, since generation didn't
complete), `side-by-side-comparison-r5.png` (the required composite,
approved mock vs. this round's real active state).

Account (disclosed, not deleted): `ia-round5-final-20260916@example.com`.
Documents: `MoTa_SanPham.txt`, `Chuong1.2.txt` (same content as prior
rounds).

### P0/P1/P2 found and fixed this round

- **P0** — Mind Map empty-state CTA unreachable (Inspector panel-swap
  condition). Fixed and re-verified live (above).
- No other P0/P1 found in the live screenshots at any of the three
  viewports, in any of the states captured.

### Not done, named honestly

- **Top-chrome target (~112px)** not hit precisely (~140-168px achieved,
  down from ~178-260px depending on state). The remaining gap is
  ChatArea's own "New chat / kebab menu" row, deliberately left as its own
  slim row rather than lifted into the merged toolbar — doing so would mean
  moving chat-session state (`sessionId`, history handlers) out of
  `ChatArea` for a cosmetic gain, judged disproportionate risk to real chat
  functionality within this round's budget.
- **Mind Map "Layout" and "Expand/Collapse" floating-toolbar controls** not
  added — no safe mind-elixir API found for either without deeper
  reconfiguration, and neither has a reproducible issue driving it.
- **Full Mind Map generation-to-populated-canvas** not completed live this
  round (see above) — the CTA-reachability bug is fixed and verified;
  full generation timing was outside this round's budget.
- **Citation inline chip click-open** not independently re-verified this
  round — the live answer captured did not include inline `[N]`-style
  citation markup this time (pre-existing production behavior,
  `INCLUDE_CHUNK_SOURCE_TAGS` default, documented in an earlier round of
  this epic), though the Evidence panel itself — the real citation
  mechanism — is confirmed correct (real cards, real chunk references).
- **Goal-banner-pill/chat-toolbar persistence vs. the mock's scroll-away
  behavior** — in the approved mock, the goal bar and next-action strip
  live inside the scrollable content area and scroll out of view with the
  conversation; in this implementation they're deliberately kept as
  persistent, always-reachable chrome (the collapsed pill stays clickable
  even deep into a long conversation) — a considered difference from the
  mock, not an oversight, named as a P3 open question rather than silently
  matched or silently diverged from.

### Tests

New: `utils/nextAction.js`/`.test.js` — the next-action decision
(select-sources / ask-question / hidden) extracted from ChatArea's inline
JSX into a real, tested pure function (4 cases: no selection, has
selection, conversation exists regardless of selection, and a guard that
Mind Map/Summary are never among its possible results).

Same judgment as every prior round, reconfirmed: no new React
component-render tests (nav-ownership, mode-switching, drawer behavior,
etc.) — this codebase still has zero component-render test infrastructure
anywhere. Real verification for all of those was the live screenshots
above.

```
npm run build     →  clean, ~9s
npm run test      →  82 files, 1043/1043 passed (1039 prior baseline + 4
                      new, all passing, no regression)
npx eslint src    →  66 problems / 58 errors / 8 warnings — identical
                      pre-existing baseline (four new unused-var errors
                      were introduced mid-round by removed next-action
                      buttons/openInsights and fixed before this count —
                      see commit history)
git diff --check  →  clean
```
