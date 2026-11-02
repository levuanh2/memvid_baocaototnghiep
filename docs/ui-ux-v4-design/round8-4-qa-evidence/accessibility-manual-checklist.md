# Screen-reader release gate: manual checklist

**Status: NOT VERIFIED.** Nobody has run StudyMap V4 with a screen reader and
listened to the output. DOM checks, the Chromium accessibility tree and axe
are useful, but they do not replace this gate. It stays NOT VERIFIED until a
human tester fills in the result columns below.

| Item | Value |
|---|---|
| Owner | Human accessibility tester (not an agent) |
| Build under test | The production commit shown by `/health` `revision` and `<meta name="studymap-build">` (Round 8.4B). Record it here before you start |
| Environment | A disposable QA account on production, or the local real stack described in `../round8-2-qa-evidence/README.md`. Never use a real user's account |

## Setup

| Reader | Platform | Browser | How to start |
|---|---|---|---|
| Narrator | Windows 11 | Edge or Chrome | Ctrl+Win+Enter |
| NVDA (latest) | Windows 11 | Chrome or Firefox | Install from nvaccess.org; Ctrl+Alt+N |
| VoiceOver | macOS, or iOS if hardware is available | Safari | Cmd+F5 on macOS; Settings > Accessibility on iOS |

Work with speech on and the screen visible. For each row, record exactly what
was **spoken**, not what you expected. Use PASS, FAIL or N/A, and add a note
for anything that is FAIL or confusing.

## Checks

### 1. Quiz navigation and errors (`/app/study/quiz/:quizId`)

| # | Action | Expected speech or behaviour | Narrator | NVDA | VoiceOver |
|---|---|---|---|---|---|
| 1.1 | Land on the page | Page title and quiz name announced; question 1 of N announced | | | |
| 1.2 | Tab or arrow through the answer options | Each option is announced with its role (radio) and state (selected or not selected) | | | |
| 1.3 | Choose an answer | The new state is announced; the save state ("Đã lưu" or equivalent) is announced through a live region without stealing focus | | | |
| 1.4 | Next and Previous | Focus moves to the new question heading; the new question number is announced | | | |
| 1.5 | Go offline (devtools) and answer | The autosave error is announced once (role alert or status), and is not repeated on every keystroke | | | |
| 1.6 | Submit with unanswered questions | The warning is announced and focus moves into the confirmation | | | |

### 2. Result page (`/app/study/result/:attemptId`)

| # | Action | Expected | Narrator | NVDA | VoiceOver |
|---|---|---|---|---|---|
| 2.1 | Land after submit (objective quiz) | Score announced as text (for example "8/10, 80%"), not only as a chart or colour | | | |
| 2.2 | Quiz with a short-answer question (asynchronous grading) | The pending state is announced; no score is announced before grading finishes; completion is announced through a live region | | | |
| 2.3 | Move through the per-question review | Correct or incorrect is spoken as text, not conveyed by colour alone; feedback is read | | | |
| 2.4 | "Nguồn: N đoạn" | Read as plain text. It is not a link, so it must not be announced as one | | | |

### 3. ReviewGuide (`/app/study/review/:attemptId`)

| # | Action | Expected | Narrator | NVDA | VoiceOver |
|---|---|---|---|---|---|
| 3.1 | Land on the page | Heading structure is navigable with H or the rotor; each topic is a heading | | | |
| 3.2 | "Luyện ngay (5 câu)" | Button name includes the action; the busy state "Đang soạn…" is announced | | | |
| 3.3 | Review task list | Read as a list with an item count | | | |

### 4. Library actions (`/app/study`)

| # | Action | Expected | Narrator | NVDA | VoiceOver |
|---|---|---|---|---|---|
| 4.1 | Landmarks | "Bộ lọc thư viện" is announced as a complementary or navigation region | | | |
| 4.2 | Collection filter buttons | Pressed state is announced (aria-pressed) | | | |
| 4.3 | Edit a collection, then "Xoá" | The dialog title, target name and consequence are read; focus is inside the dialog | | | |
| 4.4 | Escape | The dialog closes; focus is announced on "Xoá" again | | | |
| 4.5 | Confirm the delete (disposable collection) | Focus is announced on the next collection, or on "Tạo bộ sưu tập"; it does not go silent | | | |
| 4.6 | Bulk selection and actions (also with the Library Action Matrix flag ON, in a test build only) | The selection count is announced; disabled actions say why | | | |

### 5. Export Studio (open "Xuất sơ đồ" from a map)

| # | Action | Expected | Narrator | NVDA | VoiceOver |
|---|---|---|---|---|---|
| 5.1 | Open | Dialog name "Xuất sơ đồ" and subtitle announced | | | |
| 5.2 | Section rail (Nội dung, Định dạng, ...) | Current section announced (aria-current) | | | |
| 5.3 | Scope radios | Group label and the selected option announced | | | |
| 5.4 | Export | "Đang xuất…" and then "Đã xuất: <file>" announced; an error is announced if the export fails | | | |
| 5.5 | Escape while exporting | Nothing closes; the reason is not hidden | | | |

### 6. Destructive dialogs (disposable data only)

| # | Dialog | Expected: open / Escape / confirm | Narrator | NVDA | VoiceOver |
|---|---|---|---|---|---|
| 6.1 | Delete collection (Library) | Title, consequence and checkbox read; Escape returns to "Xoá"; after delete, focus lands on a neighbour | | | |
| 6.2 | Delete map (right sidebar) | Same | | | |
| 6.3 | Delete summary (right sidebar) | Same | | | |
| 6.4 | Clear chat history (chat menu) | Same. See `destructive-dialog-matrix.md` for the measured focus behaviour first | | | |

## Sign-off

| Reader | Tester | Date | Build SHA | Result | Notes |
|---|---|---|---|---|---|
| Narrator | | | | | |
| NVDA | | | | | |
| VoiceOver | | | | | |

The gate passes only when every row is PASS or has an accepted, tracked
exception. One reader is enough for a conditional release only if the release
owner explicitly accepts the risk for the others.
