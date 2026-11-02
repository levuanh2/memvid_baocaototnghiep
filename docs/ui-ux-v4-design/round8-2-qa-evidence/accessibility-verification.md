# Accessibility verification

| Item | Value |
|---|---|
| Tree | `c02e2b9` |
| Browser | Chromium (Playwright) |
| Real environment | Production-equivalent build `:4173`, protected Flask `:8080`, disposable Postgres |
| Fixture environment | Vite harness, mocked data |

Owners:

- Agy: target size, header and popover geometry. Files: `agy/accessibility.md`, `agy/regression-r8-001-005.md`, `agy/task1-evidence.json`.
- Claude: the real-app destructive dialog. Files: `claude/destructive-dialog/`.

## 1. Compact Account control (`.account-menu__trigger`)

Agy, fixture. 12 configurations: widths 320, 375, 390, 768, 820 and 1024 px,
each in light and dark.

| Measure | Observed |
|---|---|
| Bounding box | **40×40 px** at every width and theme. Enforced by `FE/src/index.css:1176` (`width/height: 40px !important`) |
| Hit area (`elementFromPoint`) | 2,025-point grid gives the 40 px box only. **0/176** points on the perimeter of a 44×44 box hit the control |
| Gap to nearest neighbour (usage chip) | 4 px at 375–1024 px; **0 px at 320 px**, where the two controls abut |
| Free header width | 38 px at 320 (the library link is hidden at ≤ 340 px); 11 px at 375; 26 px at 390; 404–644 px at 768–1024 |

Verdict:

- **WCAG 2.2 SC 2.5.8 (AA, 24×24 px): PASS.** The 40×40 px control exceeds the minimum on its own, even at 320 px.
- **Project 44×44 px mobile target: NOT MET.** WCAG 2.5.5 is Level AAA, so this is not an AA failure. It stays an **open P2** from Round 8.1.

**Can 44 px fit without bringing back R8-001?**

According to Agy's measurements, yes. Going to 44×44 adds 4 px of width:

- 7 px would remain free at 375 px.
- At 320 px, adding a 4 px gap as well uses 8 of the 38 px of free width.
- Height is not a constraint: a 44 px control in the 56 px row leaves 6 px above and below.

Proposed CSS-only follow-up (not applied):

- inside `@media (max-width: 1100px)`: `.account-menu__trigger` at 44×44;
- inside `@media (max-width: 340px)`: `.workspace-header-actions { gap: 4px }`.

This revises Round 8.1's "no room at 320 px": that note counted the right
margin, not total header slack. The follow-up PR must re-run the R8-001
geometry suite (320–1100 px, both themes) to confirm.

## 2. Dark destructive-dialog contrast

| Run | Environment | Text | Ratio, composited | Result |
|---|---|---|---|---|
| Claude, Library collection delete | **Real** | Title `rgb(236,231,219)` | 11.70:1 | PASS |
| | | Consequence text `rgb(169,180,194)`, 13 px | 6.87:1 | PASS |
| | | Acknowledgement text `rgb(169,180,194)`, 13 px | 6.87:1 | PASS |
| Agy, `r71qa.html?view=destructive` | Fixture | Acknowledgement and description `#9CA3AF` on `#111827` | 7.15:1 | PASS (fixture) |

Real composited background:

- body `rgb(21,35,59)`
- `surface-card`
- backdrop `rgba(0,0,0,.5)`
- panel `rgb(27,42,65)`, which is opaque, so the result is `rgb(27,42,65)`

Measured after the enter transition. The verdict uses WCAG 2.2 SC 1.4.3 (AA,
4.5:1 for normal text). **PASS.**

## 3. Escape and focus restoration

| Run | Environment | Trigger reached by | Focus into dialog | DELETE on Escape | Focus after Escape | Result |
|---|---|---|---|---|---|---|
| Claude, Library "Xoá" collection | **Real** | 11 real Tab presses | Yes ("Đóng hộp thoại") | 0; the collection still exists on the server | **`<body>`**; the trigger was unmounted | **FAIL: R82-A11Y-01 (P2)** |
| Agy, "Xóa sơ đồ Alpha" | Fixture | `trigger.focus()` | Yes | 0 (no backend in the harness) | The trigger | PASS (fixture) |

Root cause of R82-A11Y-01: `CollectionSidebar.jsx:159` closes the edit form
when the dialog opens, which unmounts the trigger. `Modal.jsx:46` then skips
focus restoration because the stored element is no longer in the document.

The fix is one line: keep the form mounted until the dialog resolves. See
`claude/destructive-dialog/README.md`.

The map, summary and chat-history destructive dialogs were **not** run in the
real app (`SidebarRight.jsx`, `ChatArea.jsx`): NOT VERIFIED.

## 4. Keyboard interaction

| Surface | Environment | Result |
|---|---|---|
| Compact Account menu and StudyTools menu: open, Escape closes, focus returns (also in `mobile-theme-control`) | Fixture, and Real in the critical suite | PASS |
| Theme action through Enter and Space | Real (critical suite) | PASS |
| Library collection delete reached by Tab; Enter opens the dialog | Real | PASS |
| Focus trap inside the dialog | Real and Fixture | PASS |
| Focus restoration after the collection-delete dialog | Real | FAIL (R82-A11Y-01) |

## 5. Tablet popover targets (R8-005)

Agy, fixture.

- 768, 820 and 1024 px, light and dark: **11/11 action rows at 44 px**.
- Near the bottom of the screen the popover flips upward, with top ≥ 0 and bottom ≤ viewport height.

**PASS.**

## 6. Screen readers

**NOT VERIFIED.** No agent could hear Narrator, NVDA or VoiceOver output. DOM
and ARIA inspection is not a substitute:

- names and roles are present, such as `aria-label="Tài khoản: …"`, `role="dialog"`, `role="menu"` and `aria-live` counts;
- the spoken experience of the surfaces below was not checked.

| Surface | Status |
|---|---|
| Quiz navigation and error messages | NOT VERIFIED |
| Dialog titles and descriptions | NOT VERIFIED |
| Destructive confirmation | NOT VERIFIED |
| Library tool availability | NOT VERIFIED |
| Status updates | NOT VERIFIED |
| Focus restoration | NOT VERIFIED |

Owner: a human tester on Windows (Narrator or NVDA) and on macOS or iOS
(VoiceOver).
