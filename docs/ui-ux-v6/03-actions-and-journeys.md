# V6 action inventory and journey coverage

Both tables come from a read-only code review by agy at `origin/main` `db005ab`. The full reports are in the QA workspace (`v6/results/task1-agy-inventory.md`, `task2-agy-journeys.md`). **They were not independently verified line by line.** Treat the counts as a map of where to look, not as proof.

## 1. Action inventory

About 260 actions were listed across the header, source panel, chat, mind map, export studio, summary, right panel, knowledge map, quiz and practice, library, profile, public pages, the command palette and shortcuts. Each row has label, accessible name, file and line, handler, target and an equivalent elsewhere.

| Decision | Count | Notes |
|---|---|---|
| KEEP | 261 | Includes the V4.1 renames and merges already on main (D01–D35) |
| MERGE | 1 | "Hiện đã lưu trữ" exists twice in the Library on wide screens: a checkbox in the collection sidebar (`CollectionSidebar.jsx:232`) and one in the toolbar (`DocumentList.jsx`). Proposal: keep the toolbar one |
| MOVE, RENAME, REMOVE | 0 | |
| REPAIR | 0 rows, 3 notes | Chat cancel, "Luyện ngay" and "Nộp bài luyện tập" were flagged for the concurrency bugs in `01-audit.md` §3 |

What this says: after V4.1 the app has very few true duplicate actions left. The density seen in the browser (seven header controls, a document card with a dozen controls) is a **hierarchy** problem, not a duplication problem. Wave B should regroup and demote, not delete.

Caveat: the report states that all 35 items of the V4.1 duplicate matrix are resolved. That claim was not re-checked here.

## 2. Journey coverage by automated tests

"Yes" means agy found at least one automated test for the step; it does not mean the step is fully covered.

| Journey | Step | Test found |
|---|---|---|
| 1. Sign in, upload, ask | Sign in | yes |
| | Upload a document | yes |
| | Ask and get a streamed, cited answer | **not found** |
| 2. Document, summary, mind map | Choose a document | yes |
| | View and create a summary | yes |
| | Create a mind map from the summary | **not found** |
| 3. Mind map, knowledge map, back | Mind map | yes |
| | Go to the knowledge map | yes |
| | Back to the document | yes |
| 4. Document, quiz, result | Start a quiz from a document | **not found** |
| | Set up and create the quiz | yes |
| | Take the quiz | yes |
| | See the result | yes |
| 5. Library, resume | Open the library | yes |
| | Card shows the earlier session | yes |
| | "Tiếp tục" restores it | yes |
| 6. Desktop to mobile | Select on desktop | yes |
| | Resize | yes |
| | Selection is kept | yes |
| 7. Connection lost, retry | Task in progress | yes |
| | Network or server error | yes |
| | "Thử lại" and continue | partial |
| 8. Refresh or deep link | Open by deep link or refresh | yes |
| | Auth and bfcache restore | yes |
| | Right mode and data | yes |

Gaps to close with new tests (none written yet):

1. A fixture test for the chat happy path: send, stream, citation chip, evidence panel.
2. The hand-off from a summary to creating a mind map.
3. The entry from a library card to quiz setup.
4. Retry after a failure for chat and mind map (summary has it).

None of the eight journeys was walked end to end in a browser in this pass.
