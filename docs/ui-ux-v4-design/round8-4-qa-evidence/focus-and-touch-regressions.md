# Focus after collection deletion, and mobile touch selection

| Item | Value |
|---|---|
| Source revision | `origin/main` `2479a32` plus branch `fix/studymap-v4-round8-4-qa-hardening` |
| Environment | Vitest with jsdom; Chromium through Playwright with the Vite fixture harness on `:5311`, `--workers=1`; real-app run in `destructive-dialog-matrix.md` |
| Owners | Claude (focus fix and touch-spec integration); Agy (first touch spec, negative control and screenshots, `agy/`) |

## 1. Focus after a successful collection delete (pre-existing P3)

**Before.** Cancelling already returned focus to "Xoá" (Round 8.3,
R82-A11Y-01). On a successful delete, though, the edit form and its "Xoá"
button vanish together with the collection. `Modal` restores focus only to an
element still in the document, so focus fell to `<body>`.

**Fix (`FE/src/components/study/CollectionSidebar.jsx`).** The shared `Modal`
and `DestructiveConfirmDialog` are unchanged. The fix is an effect in the
sidebar that runs only when the collection being edited disappears from
`boSuuTap`, which means it was really deleted. It then:

1. clears the edit state;
2. moves focus, **only if focus was lost to `<body>`**, to:
   1. the next collection's filter button (`data-collection-id`);
   2. otherwise the previous collection;
   3. otherwise "Tạo bộ sưu tập".

While the DELETE is in flight, or after it fails, the list is unchanged, so
the effect does nothing.

| Scenario | Expected | Observed (Vitest `CollectionSidebar.focusRestore.test.jsx`) | Status |
|---|---|---|---|
| Cancel with Escape | Dialog closes; 0 delete calls; focus on "Xoá" | As expected | PASS |
| Delete succeeds (A, B; delete A) | Exactly 1 call; dialog closes; A gone; focus on B's filter button | As expected | PASS |
| Delete the last item (A, B; delete B) | Focus on A | As expected | PASS |
| Delete the only collection | Focus on "Tạo bộ sưu tập" | As expected | PASS |
| In flight | Exactly 1 call; dialog open; focus not moved to the sidebar | As expected | PASS |
| Failure | Dialog open; error text shown; trigger and list unchanged; focus not moved to the sidebar; Escape afterwards returns focus to "Xoá" | As expected | PASS |
| Without the fix (`git show HEAD:` copy) | The new tests fail | 3 of 4 tests fail | Confirms the tests bite |
| Real Chromium (real Flask and Postgres) | Same behaviour in the real app | See `destructive-dialog-matrix.md`, Library collection row | Pending Agy's run |

**Separate observation, not changed.** While a delete is in flight,
`DestructiveConfirmDialog` disables its buttons and removes the close button,
so focus can drop out of the dialog. That is a shared-component behaviour. It
is recorded in `destructive-dialog-matrix.md` for real-browser measurement and
was not modified here.

## 2. Touch selection on the mobile MindMap at 390 px

New spec: `FE/e2e-fixture/mobile-touch-selection.spec.js`. Agy wrote it, and
Claude integrated it. It is added to the blocking Fixture Smoke CI job.

- Context: `viewport 390×844`, `hasTouch: true`, `isMobile: true`,
  `deviceScaleFactor: 3`. Verified in the page: `navigator.maxTouchPoints = 1`
  and `(pointer: coarse)` matches.
- Flow:
  1. Enter branch selection.
  2. **Pan with a real one-finger touch gesture** (Chrome DevTools Protocol
     `Input.dispatchTouchEvent`).
  3. Assert both target markers are inside the viewport and hit-testable,
     with no toolbar occlusion.
  4. `locator.tap()` branch 1, then branch 2.
  5. Assert the exact checked IDs are `fixture-map-a-m0-s0-l0` and
     `fixture-map-a-m0-s0-l1`.
  6. Assert the selection count reads "1 node đã tick" and then
     "2 node đã tick".
  7. Assert no horizontal overflow and `scrollY` unchanged.
  8. Assert the selection bar and the Export Studio controls are inside the
     viewport.
  9. In Export Studio, assert the scope is `selected_branches`, the summary
     reads "2 node đã chọn · 1 node cha tự thêm · 3 node được xuất", and both
     the config summary and the preview show "3 node".
- Screenshots go to Playwright's per-test output folder. They are not written
  into the repository.
- Existing coverage is preserved: mouse selection (`marker-click-resolution`)
  and keyboard selection (`branch-export-visual`). The obsolete "Real clicks"
  comment in `branch-export-visual.spec.js` is corrected to describe the
  keyboard (Space) selection. This is a comment-only change.

| Run | Expected | Observed | Status |
|---|---|---|---|
| Agy, first version (pan done with `page.mouse`) ×5, plus alongside `branch-export-visual` and `marker-click-resolution` | Pass | 5/5; 10/10 | PASS. The pan was not a touch gesture, so Claude replaced it |
| Agy negative control (tap marker 1 twice) | Fail | Fails: `aria-checked` "false" on marker 2 | Confirms the test bites |
| Claude, integrated version with a touch pan, ×5, `--fail-on-flaky-tests` | Pass | **5 passed** | PASS |
| Claude negative control on the integrated version | Fail | Fails: expected "true", received "false" | Confirms the test bites |
| Smoke set ×3 (before the touch spec was added) | 0 failures | 570/570 | PASS |

## 3. R84-TOUCH-01: first tap after a fast touch flick is swallowed (NOT VERIFIED on a real device)

Found while replacing the mouse pan with a real touch pan.

| Gesture before the tap | First tap on a marker | Evidence |
|---|---|---|
| Mouse drag | Toggles | Taps give `true, false, true` |
| Fast touch flick, tap 300 ms later | **Ignored**; the second tap toggles | Taps give `false, true, false` |
| Fast touch flick, tap 2500 ms later | **Ignored** | First tap `false` |
| Slow touch pan that rests 400 ms before lifting | Toggles | First tap `true` |

Event log for the ignored tap:

- `pointerdown`, `touchstart`, `gotpointercapture`, `pointerup`,
  `lostpointercapture` and `touchend` all fire on the marker's dot;
- **no `mousedown`, `mouseup` or `click` is synthesised**;
- the marker listens for `click` (`FE/src/utils/mindmapBranchSelectionMode.js:70`).

`.map-container` has `touch-action: none`. The app's own handlers do not stop
these events.

**Reading.** The missing click comes from Chromium's gesture handling: a tap
that cancels an active fling does not produce a click. Headless touch
emulation appears to keep the fling alive indefinitely (2.5 s did not clear
it), so this may be an emulation artefact. **On a real phone, the fling stops
after its animation, and a later tap may work normally.**

**Status: NOT VERIFIED.** It cannot be called a product defect from emulation
alone.

- **Owner:** human tester on a real Android Chrome and an iOS Safari device.
- **Next action:**
  1. Open a map at a phone width and enter "Chọn các node muốn xuất".
  2. Flick the canvas fast.
  3. About 1 s later, tap a branch dot once.
  4. Record whether it toggles.
- **If it reproduces on hardware:** a small fix is to also toggle on
  `pointerup` for `pointerType === "touch"`, deduplicated against the
  following `click`. That is a product change and needs approval.

The CI spec uses a deliberate pan, which comes to rest before the finger
lifts, so it tests the selection contract rather than this emulation edge
case. The spec comment links to this section.
