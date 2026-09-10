# Demo Script

6-minute walkthrough. Assumes the presenter has an account with at least
one already-processed document in the library (Demo Mode needs this —
it never fabricates content, so a document with a ready summary/mindmap
should be prepared beforehand rather than relying on live upload-and-wait
timing during the demo itself).

## 0:00 – 0:30 — Introduction

"This is MemVidX — upload a document, then chat, summarize, mind-map, and
quiz yourself on it, with every AI answer traceable back to the source
text. I'll walk through one document end to end."

Show: Landing page, then log in, land on the Study Library.

## 0:30 – 1:00 — Upload (brief, not live-waited)

"Uploading is a normal file picker — PDF, Word, PowerPoint, Excel, EPUB,
Markdown, plain text, or a scanned image. It gets indexed automatically;
I've already got one ready so we're not staring at a progress bar."

Show: the upload button, then cut to an already-indexed document card. If
doing this live end-to-end, upload a short document (1-3 pages) ahead of
time so indexing has already finished by demo time.

## 1:00 – 1:45 — Summary

Click the ready document's Summary. "Structure-aware summary, generated
as a background job — you can watch it build, and cancel if you change
your mind. This one's already done."

Show: the Summary modal, scroll through a section.

## 1:45 – 2:30 — MindMap

Open the same document's Mindmap. "Same idea, different shape — an
auto-generated mind map you can export as an image."

Show: Mindmap modal, zoom/pan briefly.

## 2:30 – 3:15 — StudyMap

Navigate to the StudyMap knowledge graph for this document. "This is a
separate, node-based knowledge graph — you can search it, focus on one
branch, and switch layouts. It's built for exploring structure, not
reading top to bottom."

Show: StudyMap page, use search, click a node to focus.

## 3:15 – 3:45 — Knowledge Panel

Back on the Study Library card, expand the Knowledge Panel. "Every
document gets extracted topics and entities, and a few suggested
questions generated deterministically from that — no extra AI call per
view."

Show: topics list, entity pills, suggested question chips.

## 3:45 – 4:30 — Tutor + Questions

Click a suggested question — it lands in the Workspace chat, already
asked. "Clicking a suggested question drops straight into chat with the
question pre-filled and already sent. And here's the AI Tutor panel next
to it — it always shows what you're currently looking at, and has quick
actions like Explain or Quiz-me that go straight into this same chat."

Show: Workspace, the answer with its citation, then open the Tutor tab
and click one Quick Action.

## 4:30 – 5:00 — Analytics

Back to the Study Library, scroll to the Learning Dashboard. "This is
computed entirely from data already loaded on this page — no extra
fetches. Coverage across artifacts, which topics haven't been assessed
yet, and a review queue banded by how well you know each one."

Show: progress bars, the "Cần chú ý" (needs attention) section, the
review queue's Today/Tomorrow/Later columns.

## 5:00 – 5:30 — Review

Open a quiz result for a previously-taken quiz (or take a short one live
if time allows). "Grading happens automatically, and weak concepts feed
directly into that review queue you just saw."

Show: Quiz result screen, then the review guide for one weak concept.

## 5:30 – 6:00 — Conclusion

"Everything you just saw — the tutor's context, the suggested questions,
the analytics — comes from the same three real AI calls: chat, summary,
and mindmap generation. Nothing downstream of those makes an extra LLM
call; it's all derived from data already there. That was a deliberate
constraint through the whole build, and it's why the whole thing stays
fast and cheap to run."

Show: back to Landing or Workspace, end on the product wordmark.
