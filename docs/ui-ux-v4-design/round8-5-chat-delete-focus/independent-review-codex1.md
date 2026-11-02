# Independent review — R84-A11Y-02 chat delete-history focus

## Disclosure

Independent read-only review of branch `fix/studymap-v4-chat-delete-focus`, commit `cb530bb2c539fc4986e3f61b68183b58dbb4c03b`, in worktree `E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r85-chat-delete-focus`.

I did not author the change. I made no code changes, stash operations, or commits. The repository has no `.understand-anything/knowledge-graph.json`, so review used the commit diff and direct dependency inspection; no graph or diff overlay was generated because the task is read-only.

## Verdict: APPROVE

The fix is correctly scoped and solves the reachable focus-loss defect for both Escape and the **Huỷ** button. The cancel-only state flag prevents the new effect from changing the successful-delete path. The parent effect runs after the dialog DOM has been removed and after the shared Modal's cleanup has had its chance to restore focus, so it fills the exact gap left by the unmounted menu item without fighting a valid restoration target.

No blocking, high, or medium findings.

## Findings

### LOW — Two defensive focus branches are not directly proved by the new tests

Evidence: `FE/src/components/Layout/ChatArea.jsx:430-439`; `FE/src/components/Layout/ChatArea.deleteHistoryFocus.test.jsx:68-116`.

The implementation explicitly preserves a valid current focus (`activeElement !== body`) and falls back to the composer when the menu trigger is missing/disabled, but the four tests do not exercise either branch. They prove the normal lost-focus path for Escape/Huỷ, success, and failure-then-Escape.

There is also a runtime invariant worth recording: the menu trigger is disabled for `loading || pendingReview` (`ChatArea.jsx:837-840`), while the composer is disabled for those same states plus transcription (`:1128`). Therefore, if the trigger becomes disabled through normal component state, `refocusComposer()` correctly refuses to focus the disabled textarea (`:382-386`). The fallback call is safe but cannot produce composer focus in that exact state. This is not a reachable regression in the reviewed flow—the dialog can only be opened while `loading/pendingReview` are false (`:415-419`), and the modal prevents starting another chat action—but the comment “or on the composer when that button is disabled” is stronger than the actual state invariant.

Non-blocking follow-up: add one test that moves focus to another persistent control before cancel and asserts it is not stolen, plus one that marks the trigger unavailable while leaving the textarea focusable and asserts composer fallback. If product requires a focus destination when both trigger and composer are disabled, choose another enabled control rather than weakening `refocusComposer()`.

## Correctness review

### Escape and Huỷ

- Both paths use the same `huyXoaLichSu` callback (`ChatArea.jsx:426-429`, `:1156-1163`).
- Escape reaches it through shared `Modal`'s window listener (`FE/src/components/ui/Modal.jsx:27-32`) because `DestructiveConfirmDialog` passes `onCancel` as `onClose` whenever deletion is not in flight (`FE/src/components/ui/DestructiveConfirmDialog.jsx:67-76`).
- The Huỷ footer button calls the same callback directly (`DestructiveConfirmDialog.jsx:73-77`).
- While a delete is in flight, `onClose` is removed and the cancel button is disabled, preserving the existing duplicate/abort protection (`DestructiveConfirmDialog.jsx:51-64`, `:71-85`).

### Focus only when lost

The cancel flag is set before closing (`ChatArea.jsx:426-429`). On the subsequent render, the effect runs only when the dialog is closed and the flag is set (`:430-432`). It clears the one-shot flag before taking action, then returns without moving focus if a non-body element already owns it (`:432-436`). This avoids stealing focus restored by another mechanism.

The check is intentionally narrow (`document.body` represents the observed lost-focus state). In ordinary browser/jsdom behavior, removing the focused modal control makes `document.activeElement` become body. No evidence was found of this app producing an `<html>` active element in this lifecycle.

### Effect ordering versus Modal cleanup

On cancel, React removes the portal DOM during commit. The shared Modal's passive cleanup then tries to focus the element captured when it opened (`Modal.jsx:40-50`). In this flow that captured element is not the persistent kebab trigger: the focused “Xóa lịch sử chat” menu item is unmounted in the same transition that opens the dialog (`ChatArea.jsx:415-419`, `:843-866`). Modal correctly refuses to focus a detached element via `document.contains(prev)` (`Modal.jsx:46-49`).

Passive unmount cleanup runs before updated passive effects, so ChatArea's effect sees the final state after Modal restoration. If Modal ever restores a valid element, ChatArea's `activeElement !== body` guard preserves it; otherwise ChatArea focuses the persistent trigger. There is no cleanup/effect focus ping-pong.

### Success path unchanged

The commit does not alter `xoaLichSuThat` except by surrounding context. Success still clears messages/context/evidence, closes the dialog, shows notice, and calls `refocusComposer()` (`ChatArea.jsx:445-457`). The cancel-only ref remains false on success, so the new effect does nothing. The test asserts exactly one API call after a double click, dialog closure, and textarea focus (`ChatArea.deleteHistoryFocus.test.jsx:89-100`).

Duplicate-submit protection remains owned by the unchanged shared dialog (`DestructiveConfirmDialog.jsx:34-64`).

### Failure then cancel

On failure, `xoaLichSuThat` throws without closing or clearing chat state (`ChatArea.jsx:445-450`). The unchanged shared dialog catches the error, keeps the dialog open, re-enables actions, and clears its in-flight ref (`DestructiveConfirmDialog.jsx:51-64`). A later Escape or Huỷ therefore reaches the same cancel callback and focus restoration. The test proves failure + Escape (`ChatArea.deleteHistoryFocus.test.jsx:102-116`); Huỷ shares the already-tested callback and has no separate branch.

## Regression-risk review

- **New chat:** unchanged; it still closes the menu, rotates the session, clears state/evidence, and focuses the composer (`ChatArea.jsx:388-397`). The new cancel effect is gated by its false ref and cannot run this path.
- **Clear context:** unchanged async/error behavior and pre-await composer focus (`ChatArea.jsx:399-413`). Again, the cancel ref remains false.
- **Touch/coarse pointer:** existing composer focus continues to be skipped for coarse pointers (`ChatArea.jsx:382-386`, `:684`). The new normal cancel path focuses a button, not the textarea, so it cannot summon the soft keyboard. A pointer-triggered cancel may leave the kebab button focused, which is valid modal focus restoration; focus-visible styling should remain browser-input-modality dependent.
- **Other modal users:** `Modal.jsx` and `DestructiveConfirmDialog.jsx` are byte-unchanged in this commit. Behavior is local to ChatArea via its `onCancel` callback and refs.
- **Rendering/state blast radius:** two refs do not cause renders; the effect depends only on `xacNhanXoaLichSu`. No query, streaming, evidence, image, or selection logic changed.

## Test assessment

Executed as requested:

```text
cd FE
npx vitest run src/components/Layout/ChatArea.deleteHistoryFocus.test.jsx
```

Result: **1 file passed, 4 tests passed**.

Additional targeted regression run:

```text
npx vitest run \
  src/components/Layout/ChatArea.deleteHistoryFocus.test.jsx \
  src/components/Layout/ChatArea.contextRow.test.jsx \
  src/components/Layout/ChatArea.touchTargets.test.jsx
```

Result: **3 files passed, 11 tests passed**.

### Would the new tests fail without the fix?

Yes, by direct test/control-flow inspection; no temporary checkout or stash was used.

Before `cb530bb`, opening delete unmounted the focused menu item and mounted the portal. Modal captured/restored body because the original item no longer existed; there was no persistent-trigger ref or post-cancel effect. Therefore these assertions would fail on the parent commit:

- Escape returns focus to `trigger` (`ChatArea.deleteHistoryFocus.test.jsx:69-77`).
- Huỷ returns focus to `trigger` (`:79-87`).
- Failure followed by Escape returns focus to `trigger` (`:102-116`).

The success test (`:89-100`) is primarily regression coverage and should pass without this fix because successful deletion already called `refocusComposer()` and shared duplicate-submit protection already existed.

The tests are credible for the reported bug: they explicitly focus the transient menu item before opening the modal (`:43-60`), use both close mechanisms, verify no delete on cancel, and cover success and recoverable failure. They do not fully prove the two defensive branches documented in the LOW finding, but that gap does not invalidate the fix.
