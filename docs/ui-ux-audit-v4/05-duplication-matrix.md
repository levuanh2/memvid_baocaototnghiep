# StudyMap duplication and entry-point matrix

Audit date: 2026-10-25  
Baseline: `4f228ef9d1e34f8bac59f37a3792fc859400cb64`

This matrix distinguishes harmful duplication from useful contextual shortcuts. “Canonical” means the location that should own the complete workflow; it does not imply removing every secondary entry point.

## Matrix

| Feature | Every observed UI entry point | Owner component(s) | Same or different behavior | Actual user need | Recommended canonical location | Disposition | Migration / regression risk |
|---|---|---|---|---|---|---|---|
| Chat | Workspace header tab; document-card “Hỏi AI”; Tutor “ask” actions; command palette | `MainLayout.jsx`, `StudyCard.jsx` / `DocumentList.jsx`, `TutorPanel.jsx`, `CommandPalette.jsx`, `ChatArea.jsx` | Different launch context, same destination. Document-card action should preselect one source; tutor action can prefill context. | Ask generally or ask about a known document/concept. | Workspace Chat tab owns the conversation. | **Keep contextual shortcuts**, but show the inherited source/context before sending. | High: removing card/tutor shortcuts adds friction; inconsistent preselection can ask against the wrong source. |
| Mind Map mode | Workspace header tab; document-card “Sơ đồ”; learning-card “Sơ đồ tư duy”; command palette | `MainLayout.jsx`, `StudyCard.jsx`, `DocumentList.jsx`, `CommandPalette.jsx`, `MindElixirView.jsx` | Header switches mode using current sources; document card supplies a specific document. | Open maps globally or create/open one for a known document. | Workspace Mind Map mode owns viewing/editing. | **Keep document shortcut**, relabel header as the global workspace and preserve source handoff. | High: map identity and selected-source state can diverge. |
| Summary mode | Workspace header tab; document-card “Tóm tắt”; right inspector artifact tab/list; command palette | `MainLayout.jsx`, `StudyCard.jsx`, `DocumentList.jsx`, `SidebarRight.jsx`, `SummaryPane.jsx`, `CommandPalette.jsx` | Header uses workspace sources; card is document-scoped; inspector is contextual preview/history. | Generate, open, or inspect summaries without losing current work. | Workspace Summary mode owns generation and full reading. | **Keep card shortcut and inspector preview**; avoid presenting preview as a second library. | Medium-high: background jobs and selected summary identity must survive relocation. |
| Study library / Documents | `/app/study` header; “Phòng đọc” back-link from study pages; card sections; no observed entry in workspace StudyMap menu | `DocumentList.jsx`, `StudyShell.jsx`, `MainLayout.jsx`, `StudyToolsMenu.jsx` | The study route is a full library; workspace sidebar is only a source picker. | Find owned documents and resume learning. | Study library page. | **Relocate/add a clear library destination** to the StudyMap menu; do not turn the source picker into the full library. | Medium: routing and back behavior; avoid losing workspace state. |
| Tutor / Timeline / Knowledge | StudyMap header menu; tabs in the right context inspector; command palette search/actions | `StudyToolsMenu.jsx`, `SidebarRight.jsx`, `TutorPanel.jsx`, `ResearchTimeline.jsx`, `KnowledgePanel.jsx` / `KnowledgeDashboard.jsx`, `CommandPalette.jsx` | Same underlying contextual surfaces reached from global menu, inspector tabs, or search. | Open a tool globally, or switch tools while inspecting current evidence/node. | Right context inspector owns active tool state. | **Keep header and command shortcuts**; treat them as open/switch commands, not separate product areas. | High: focus restoration, inspector mount state, and current Study Context are coupled. |
| Source selection | Workspace sidebar row checkboxes/select-all; mobile source drawer; learning-library bulk selection; generator shows “documents in use” | `SidebarLeft.jsx`, `MainLayout.jsx`, `DocumentList.jsx`, `StudyCard.jsx`, `GuidedMindmapDialog.jsx` | Workspace selection sets chat/map/summary scope. Library bulk selection appears document-management-oriented. Generator reflects but does not own scope. | Choose evidence scope versus select records for bulk library actions. | Workspace `SidebarLeft` for AI scope; study library for management selection. | **Keep both but separate vocabulary/state** (“Nguồn đang dùng” vs “Chọn tài liệu để quản lý”). | High: merging these states could silently broaden AI scope or bulk operations. |
| Source search/filter | Workspace “Tìm trong tài liệu” + advanced filter; study library search/sort/filter; command palette global search; timeline search | `SidebarLeft.jsx`, `DocumentList.jsx`, `CollectionSidebar.jsx`, `CommandPalette.jsx`, `ResearchTimeline.jsx` | Different corpora and intents: current sources, learning assets, global navigation, historical events. | Narrow the current task without losing location. | Local search stays local; command palette remains global. | **Keep**, but name the search domain consistently in placeholder and accessible name. | Medium: consolidating would blur scope and surprise users. |
| Mind-map generation | Empty-state “Tạo sơ đồ tư duy”; map library “Tạo sơ đồ mới”; document-card “Sơ đồ”; right inspector create action; toolbar “Tạo lại” | `WorkspaceEmptyState.jsx`, `ModeLibraryMenu.jsx`, `StudyCard.jsx`, `SidebarRight.jsx`, `MindElixirView.jsx`, `GuidedMindmapDialog.jsx` | Create paths use cache/current sources; “Tạo lại” is force/regenerate and may replace an existing map. | Create first map, create another map, or replace current map intentionally. | Guided create dialog owns creation; map toolbar owns regenerate. | **Keep create shortcuts; keep regenerate separate and explicit.** Never merge labels while force semantics differ. | Very high: accidental regeneration can overwrite unsaved map edits. |
| Saved map library | Mind-map toolbar selector/library; right inspector saved artifact list; document-card map shortcut | `MindElixirView.jsx`, `ModeLibraryMenu.jsx`, `SidebarRight.jsx`, `StudyCard.jsx` | Toolbar is authoritative selection; inspector/card provide contextual discovery. | Find the right saved map globally or from a document. | Toolbar `ModeLibraryMenu` in Mind Map mode. | **Keep contextual links**, but route them into the canonical selector and visibly identify the active map. | High: A→B→A selection and inspector state have existing lifecycle complexity. |
| Export | Mind-map toolbar `Xuất sơ đồ`; Export Studio four-step rail; no duplicate menu entry observed | `MindElixirView.jsx`, `ExportStudioDialog.jsx` | One entry, one complete workflow. | Export current map with chosen scope/format/appearance. | Existing toolbar entry. | **Keep canonical as-is**; only consider an optional repeat-last-export shortcut based on evidence. | High: scope, geometry, appearance, async PDF jobs, and downloads are tightly coupled. |
| Appearance controls | Map toolbar `Giao diện`; Export Studio appearance mode/presets/colors | `AppearanceEditorDrawer.jsx`, `AppearanceControls.jsx`, `ExportStudioDialog.jsx`, `MindElixirView.jsx` | Deliberately different: persistent map appearance versus export-only override, with an “apply to map” bridge. | Style the map itself or style one exported artifact. | Map toolbar owns persistent appearance; Export Studio owns one-off appearance. | **Keep both.** Strengthen “saved to map” versus “this file only” state language. | Very high: merging can persist temporary export settings or omit saved custom appearance. |
| Evidence / context panels | Always-present/right-collapsible answer evidence; citation chip opens evidence; node selection opens map details; StudyMap menu opens Tutor/Timeline/Knowledge in same shell | `ChatArea.jsx`, `MainLayout.jsx`, `SidebarRight.jsx`, mind-map inspector components | One shell hosts multiple context types; triggers are legitimately contextual. | Inspect the current claim/node without losing the primary workspace. | `SidebarRight` is canonical shell; citation/node are open-and-focus triggers. | **Keep shared shell**, but collapse or explain empty evidence and preserve clear active-tab/title state. | High: Chat, Summary, Tutor, map details, and timeline share mount/focus state. |
| Study actions per document | Full card: primary “Tiếp tục · Quiz” plus Summary/Map/Quiz/Practice/Ask AI/Details; same full card repeated under many sections | `DocumentList.jsx`, `StudyCard.jsx` | Each card copy invokes the same document-scoped action. Duplication is caused by repeated record rendering, not legitimate context. | Resume the most relevant activity and access secondary tools. | One canonical card in one result collection; compact “continue” references elsewhere. | **Merge repeated records**; keep one primary resume action and contextual secondary actions. | Medium-high: sections, selection, analytics, and scroll anchors currently assume repeated cards. |
| Theme controls | Landing theme toggle; desktop workspace light/dark segmented buttons; phone action inside overflow/StudyMap menu | landing components, `MainLayout.jsx`, `StudyToolsMenu.jsx`, shared theme state | Same preference exposed in context-appropriate containers. | Change theme where the header has available space. | Shared theme state, local presentation. | **Keep** as responsive shortcuts; only one visible control per viewport/context. | Medium: theme changes affect mind-map render/link lifecycle. |
| Conversation controls | Rename, new conversation, overflow menu in chat header; contextual history via timeline/command palette | `ChatArea.jsx`, `MainLayout.jsx`, `ResearchTimeline.jsx`, `CommandPalette.jsx` | Direct conversation management versus historical search. | Start/manage current thread or return to prior work. | Chat header owns current-thread actions; timeline/search owns discovery. | **Keep**, but make saved/current conversation restoration visible after reload. | High: reload persistence and source-context binding are sensitive. |

## Confirmed duplication findings

### UX-017 · P1 · Repeated full document cards are harmful duplication

The same record and its complete action set are rendered in several simultaneous sections. This is not a contextual shortcut because every copy carries nearly identical behavior and selection controls. It created 823 visible interactive controls in the audited desktop state and repeated the same document several times in the mobile accessibility tree.

Evidence: [desktop library](screenshots/ux-05-two-documents-uploaded.png) and [mobile library](screenshots/ux-32-mobile-study-above-fold.png).

Recommendation: one canonical result list, with compact “Continue,” “Needs quiz,” and similar modules linking/scrolling to that record or applying a filter.

### UX-018 · P2 · “StudyMap” is both a product-area label and a tools-menu label

Users looking for the StudyMap learning library encounter a menu containing only Tutor, Timeline, and Knowledge. The menu is internally coherent as “Công cụ học,” but the trigger label implies a broader destination.

Evidence: [header menu](screenshots/ux-38-study-tools-menu.png).

Recommendation: retain the shortcuts but add the canonical learning-library destination or narrow the trigger label to “Công cụ học.”

### UX-019 · P2 · Create and regenerate are correctly separate but visually adjacent

“Tạo sơ đồ mới,” empty-state “Tạo sơ đồ tư duy,” and “Tạo lại” are not equivalent. The first two create; the last forces replacement/regeneration. This duplication is legitimate only while labels and confirmation preserve that distinction.

Recommendation: keep all three contextual paths and regression-test source handoff plus unsaved-edit confirmation.

### UX-020 · P2 · Appearance duplication is legitimate and should remain scoped

The persistent “Giao diện” drawer and Export Studio appearance step meet different needs. The export UI already says “Dùng giao diện của sơ đồ” versus “Tùy chỉnh riêng bản xuất,” so removal would increase friction.

Recommendation: keep both; verify that “Áp dụng cho sơ đồ” is the only path that persists export overrides.

## Canonical information architecture implied by current behavior

This is not a redesign proposal; it records the ownership model already present in code and observed behavior:

- Workspace tabs own Chat, Mind Map, and Summary work.
- The left workspace sidebar owns active AI source scope.
- The right inspector owns evidence and contextual learning tools.
- The study library owns document discovery and resume actions.
- The map toolbar owns map identity, persistent appearance, regenerate, and export.
- Contextual shortcuts are valuable when they pass a document/node/citation into one of those owners and visibly confirm the inherited context.

## Validation needed before consolidation

- Confirm whether study-library bulk selection currently affects AI source selection. The UI does not explain whether these are shared states.
- Confirm all document-card shortcuts preserve ownership and return location.
- Verify map and summary library deep links across reload and A→B→A switching.
- Instrument which Export Studio presets/formats are repeated before adding a fast path.
