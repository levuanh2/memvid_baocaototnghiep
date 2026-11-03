# Human acceptance sheets (NVDA, Narrator, Android, iPhone)

Short run sheets for the two human-only gates of Round 8.5:

- **E4**, screen readers: `../round8-5-release-prep/human-acceptance-tests.md`
  §E4 and `../round8-4-qa-evidence/accessibility-manual-checklist.md`.
- **E3**, first tap after a fast flick: `../round8-5-release-prep/human-acceptance-tests.md`
  §E3.

The acceptance criteria are unchanged; these sheets only make them quicker to
run. A result counts only when a named person ran it on a real device and
filled in the sheet. Chromium emulation, DevTools touch mode, axe or the
accessibility tree are **not** results. Until a sheet is filled in, its gate
is **NOT VERIFIED**.

## Before every sheet

1. Use a disposable QA account. Never a real user's account or data.
2. Record the build: open `https://studymap.space/`, view source, and copy
   `<meta name="studymap-build" content="…">`, and the `revision` from
   `https://api.studymap.space/health`. Record both. They differ when the
   newest `main` commit did not change `FE/` (Render only rebuilds on `FE/`
   changes). Expected on 2026-11-03: frontend `2d283aa384f2…`, backend
   `d1cb795bd04a…`, or later `main` SHAs if released since. The UI under test
   is the frontend SHA.
3. Create disposable test data first: one collection, one map with a
   summary, one chat with a few messages, one finished quiz (including one
   short-answer question).
4. **Per-row evidence is the result.** For each reader, make a copy of
   `../round8-4-qa-evidence/accessibility-manual-checklist.md` and fill in its
   column for every row: what was spoken, and PASS, FAIL or N/A. Attach that
   copy (plus C1 below). The S1/S2 tables only summarise it; a total such as
   `29/29` without the filled checklist is not evidence.
5. **Row 4.6 uses a test build, not production.** All other rows run on the
   production SHA from step 2. Row 4.6 needs the Library Action Matrix flag
   ON, which exists only in a test build (local real stack or a preview).
   Record that build's SHA and URL separately. Never switch the flag on in
   production.

## Sheet S1: NVDA on Windows with Chrome

Start: install NVDA from nvaccess.org, open Chrome, press Ctrl+Alt+N. Speech
on, screen visible. Browse mode (default) for reading; press Tab for controls.

Run every row of the checklist (§1 Quiz, §2 Result, §3 ReviewGuide, §4
Library, §5 Export Studio, §6 destructive dialogs), plus the chat row below.
Write what was **spoken**, not what you expected.

| Field | Value |
|---|---|
| Tester / date (UTC) | |
| Windows / NVDA / Chrome versions | |
| Frontend SHA (meta) / backend SHA (`/health`) | |
| Row 4.6 test build SHA / URL (flag ON) | |
| Filled checklist copy attached (link or file) | |
| Rows PASS / N/A / FAIL (checklist 1.1–6.4 + C1 = 29) | __ / __ / __ |
| FAIL rows (id: what was spoken) | |
| Result | PASS / FAIL |

Extra row C1 (chat history dialog): open the chat menu "Tùy chọn cuộc trò
chuyện", choose "Xóa lịch sử chat", press Escape. Expected: the dialog
closes and NVDA announces focus on "Tùy chọn cuộc trò chuyện".

## Sheet S2: Narrator on Windows with Edge

Start: open Edge, press Ctrl+Win+Enter. Use Caps Lock+Space to switch scan
mode if needed.

Same rows as S1 (checklist 1.1–6.4 + C1).

| Field | Value |
|---|---|
| Tester / date (UTC) | |
| Windows build / Edge version | |
| Frontend SHA (meta) / backend SHA (`/health`) | |
| Row 4.6 test build SHA / URL (flag ON) | |
| Filled checklist copy attached (link or file) | |
| Rows PASS / N/A / FAIL (29) | __ / __ / __ |
| FAIL rows (id: what was spoken) | |
| Result | PASS / FAIL |

E4 passes when every row is PASS in both S1 and S2, or each FAIL has an
accepted and tracked exception. VoiceOver is optional (only if the hardware
exists). Releasing with one reader only requires the release owner to accept
the risk for the other in writing.

## Sheet S3: Android phone, Chrome, fast flick (E3)

Real phone, no USB emulation, no desktop browser in device mode.

1. Open a mind map. Choose **Xuất sơ đồ**, then **Các node được chọn**, then
   **Chọn trên canvas**.
2. Fast-flick the canvas with one finger, lifting while it still moves.
3. About 1 s later, tap a branch dot **once**. Note whether it toggled.
4. Repeat steps 2–3 until you have 5 attempts.
5. Control: pan slowly, stop, lift, tap a dot once. 5 attempts.

| Field | Value |
|---|---|
| Tester / date (UTC) | |
| Phone model / Android / Chrome versions | |
| Build SHA | |
| Flick: toggled on the 1st tap | __ / 5 |
| Slow pan: toggled on the 1st tap | __ / 5 |
| Notes (which attempt missed, screen recording link if any) | |
| Result | PASS / FAIL |

## Sheet S4: iPhone, Safari, fast flick (E3)

Same steps as S3, on a real iPhone with Safari.

| Field | Value |
|---|---|
| Tester / date (UTC) | |
| iPhone model / iOS version | |
| Build SHA | |
| Flick: toggled on the 1st tap | __ / 5 |
| Slow pan: toggled on the 1st tap | __ / 5 |
| Notes | |
| Result | PASS / FAIL |

E3 rule, unchanged: 5/5 on both rows of both phones is PASS. Any first-tap
miss after a flick is FAIL and opens a product fix (also toggle on
`pointerup` for `pointerType === "touch"`, de-duplicated against the click).
