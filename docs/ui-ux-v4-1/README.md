# StudyMap V4.1: UX audit and consolidation plan

| Item | Value |
|---|---|
| Date | 2026-11-03 |
| Code audited | `main` `ec4d1afbd1a2551643c3ffaa8a307b0e779d9d0e`; frontend identical to production `studymap-build` `2d283aa` (no `FE/` change since) |
| Method | Source inventory (3 agent passes + Claude), real app rendered with the API mocked (no production login or data), click-through checks for every suspected dead action |
| Status | Audit and plan only. No product code changed, nothing merged or deployed, Library flag untouched |
| V4 release | Still CONDITIONAL (Round 8.6); this audit does not change that verdict |

## Files

| File | Content |
|---|---|
| `01-function-inventory.md` | 13 routes, 15 screens, 10 function groups, primary/secondary actions, live vs unmounted vs flagged |
| `02-duplicate-function-matrix.md` | 35 entries D01–D35 with source, behavior, evidence and KEEP/MERGE/MOVE/RENAME/DISCLOSE/REMOVE |
| `03-ux-audit.md` | Findings by screen with P0/P1/P2, accessibility risks, coverage table |
| `04-simplified-information-architecture.md` | Two places, one name per feature, navigation levels, action hierarchy, journeys |
| `05-before-after-proposals.md` | B1–B10 with evidence, sketch, risk and scope |
| `06-implementation-roadmap.md` | P0/P1/P2 PR plan with effort, risk, tests and acceptance criteria |
| `evidence/` | 236 screenshots, control inventories, the capture and verification scripts (`evidence/README.md`) |
| `_work/inv-*.md` | Raw line-level inventories from the agents (A1+A5 Codex, A3 AGY, A4 Codex); A2 Library was done by Claude in `01`–`03`. Where they disagree with `01`–`03`, the numbered files win (for example A3 lists `SidebarRight` "+ Tạo sơ đồ" as live; it is behind `legacyInspectorSurfacesEnabled = false`) |

## Executive summary

StudyMap has 13 routes and 10 function groups. Most screens already have one
clear primary action (quiz setup, quiz taking, review guide, practice). The
confusion is concentrated in three places: the reading room's Summary and
Mind map modes, the Library (flag OFF), and naming.

Three findings are **product defects, not taste**, found by clicking through
the real app: Summary mode cannot create or open a summary (a regression from
`99258df`, 2026-10-04), the mind-map create button does nothing when the
Guided capability is off, and Library buttons "Tóm tắt" / "Sơ đồ tư duy" open
chat mode. All three are small fixes to existing wiring.

The biggest clarity win without touching architecture is naming: two map
features share four names, the header menu is called by the product name, and
two upload buttons use two words.

## Top 10 (priority order)

| # | Finding | Priority | Evidence |
|---|---|---|---|
| 1 | Summary mode: "Tạo tóm tắt" does nothing and saved summaries cannot be opened (regression `99258df`) | P0 | `03` §1, `verify-cta__summary__*.json`, `verify-summary__existing__workspace.json` |
| 2 | Library "Tóm tắt" / "Sơ đồ tư duy" open the reading room in chat mode (no `tab`) | P0 | D04, `verify-summary__library-card.json` |
| 3 | Mind map: centre create button is dead when the Guided capability is off (production value NOT VERIFIED) | P0 (conditional) | D03, `verify-cta__mindmap__disabled.json` |
| 4 | Two map features, four names ("Sơ đồ", "Sơ đồ tư duy", "Bản đồ học tập", "Sơ đồ kiến thức") | P1 | D05, `library__1440__light.jpg`, `studymap__1440__light.jpg` |
| 5 | Library (production) renders each document up to 5 times across 7 sections (6 documents → 26 cards) | P1 | D06, `library__1440__light.json` |
| 6 | Study tools hidden behind a "StudyMap ▾" menu (bare chevron on phones); the right panel's own tabs are disabled | P1 | D10, `workspace-tools-menu__*.jpg` |
| 7 | Library card repeats the same six words as chips and buttons; "Tiếp tục · Hỏi AI" next to "Hỏi AI" | P1 | D07, D08 |
| 8 | Export Studio: step rail + presets + scopes + footer with two forward buttons ("Tiếp tục", "Xuất PNG"); "Áp dụng cho sơ đồ" saves to server inside export | P1 | D17, D18, `workspace-map-export__1440__light.jpg` |
| 9 | Phones: Library header hides its title and cuts "Xem thử"; chat says "Chọn tài liệu bên trái" where there is no left column; usage indicator over the export dialog | P1 | `library__320__light.jpg`, `workspace-chat__390__light.jpg`, `workspace-map-export__390__light.jpg` |
| 10 | After a quiz the main button reviews wrong answers, the plan (which leads to practice) is secondary; four kinds of % without units; "Hôm nay / Ngày mai" imply a schedule that does not exist | P1 | D31, D32, `quiz-result__1440__light.jpg` |

## Kept as is

Three-mode switch in the reading room; source selection and evidence panel;
exact-node and branch export semantics and the Export Studio scopes; quiz
setup, taking and submit confirmation; review guide practice (quick and
custom); destructive-action dialogs; Command Palette and shortcuts; the
Library Action Matrix design (only its rollout is pending); Library flag OFF
in production; all backend contracts.

## Decisions needed from the owner

| ID | Decision | Options |
|---|---|---|
| O1 | Product name in the UI | MemVidX or StudyMap (the other disappears from screens) |
| O2 | Map names | Proposed "Sơ đồ tư duy" (editable map) and "Bản đồ kiến thức" (structure tree) |
| O3 | Library | Roll out the Action Matrix after P1-3 and checklist row 4.6, or keep flag OFF and ship the interim single list (P1-4b) |
| O4 | Right panel | Re-enable its tab row (P1-2), or keep the header menu as the only door and just rename it |
| O5 | Quiz result next step | Plan first (proposed) or wrong answers first (today) |
| O6 | Order | `06` "Order" section, starting with the three P0 fixes |
| O7 | Removals proposed | Only duplicates with identical behavior: hidden "Lưu" copy (D16), "Hỏi AI về khái niệm này" (D25), interim duplicate Library sections (D06). No feature is removed |

P0-1 to P0-3 restore broken behavior. They could ship as V4 hotfixes ahead of
the rest of V4.1, but that is the owner's call.

## Not verified

- Production behavior with real data and real server flags (Guided
  capability, summary jobs): no authorised test account was available, so
  production was not logged into.
- Screen-reader and real-device results: still Round 8.6 sheets S1–S4.
- Mind-map editing gestures (drag, rename) were read from code, not exercised.
