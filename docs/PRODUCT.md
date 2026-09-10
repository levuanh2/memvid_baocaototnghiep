# Product

## Problem

Studying from a long document — a textbook chapter, a research paper, a
set of lecture slides — usually means re-reading the whole thing every
time you need to check something, losing track of which parts you've
actually understood, and having no easy way to test yourself against the
material without building a quiz by hand. Existing "chat with your PDF"
tools solve the first problem (ask a question, get an answer) but stop
there — they don't help you track what you've learned, revisit weak
spots, or move between reading/summarizing/mapping/testing without losing
context each time.

## Target Users

Students and researchers working through their own documents who want to
read, question, summarize, map, and test themselves on the same material
without re-explaining context every time they switch modes.

## Use Cases

- Upload a paper and ask clarifying questions with answers cited back to
  the source text.
- Generate a structured summary of a long document instead of re-reading
  it.
- Generate a mind map to see how a document's concepts relate before
  diving into detail.
- Explore a document's knowledge graph (StudyMap) to see what topics
  exist and how well you've mastered each.
- Generate a quiz from a document, take it, get graded, and get a review
  plan for what was missed.
- Come back later and see, at a glance, which documents are furthest
  along and which topics haven't been touched yet.

## User Journey

```
Upload ─▶ Summary ─▶ MindMap ─▶ Knowledge (topics/entities) ─▶ Questions
   ─▶ Chat (grounded answers) ─▶ Quiz ─▶ Review ─▶ back to Library, repeat
```

Every stage after Upload is optional and re-enterable — a user can chat
first and summarize later, or generate a quiz without ever opening the
mind map. Study Context (see `docs/ARCHITECTURE.md`) is what makes this
re-entry work: whichever surface you land on next already knows what
document/topic/question you were just looking at.

## Major Features

- **Workspace** — the chat reading room: ask questions, get cited
  answers, with an AI Tutor panel alongside it (live context card, quick
  actions, session memory of what you've recently looked at).
- **Study Library** — every uploaded document as a card: collections,
  favorites/pins, a Knowledge Panel (topics, entities, related documents,
  suggested questions), and a library-wide Learning Dashboard.
- **StudyMap** — a visual knowledge graph per document.
- **Quiz / Practice / Review** — generate a quiz, take it, get graded,
  get a mastery-banded review queue for what needs revisiting.
- **Demo Mode** — for a new user or a live demo, one click opens whichever
  real document in the library is furthest along — no upload, no
  fabricated content.

## Workflow

1. Upload a document (PDF, DOCX, PPTX, XLSX, EPUB, HTML, Markdown, TXT,
   or a scanned image).
2. It's indexed automatically; chat becomes available immediately.
3. Generate a Summary and/or Mindmap as background jobs (progress shown,
   cancellable).
4. Open the Knowledge Panel to see extracted topics/entities and
   suggested questions.
5. Ask questions in chat, or click a suggested question to ask it
   directly — answers come back cited to the source.
6. Generate a quiz, take it, get graded; weak concepts feed the review
   queue.
7. Check the Learning Dashboard to see overall progress across the whole
   library.

## Screens

Workspace (`/app`), Study Library (`/app/study`), StudyMap
(`/app/study/map/:documentId`), Quiz setup/taking/result
(`/app/study/quiz/*`), Review guide (`/app/study/review/:attemptId`),
Practice (`/app/study/practice/:quizId`), Landing (`/`), Login/Register.

## AI-Assisted Workflow

Chat, Summary, and Mindmap generation are the only surfaces that call an
LLM directly. Everything downstream of them — the Knowledge Panel's
suggested questions, the Learning Dashboard's progress/coverage numbers,
the review queue, Demo Mode's document picker, the AI Tutor's context
card — is derived from data those three surfaces (plus quiz
generation/grading) already produced, computed with plain aggregation
logic, not additional LLM calls. This was a deliberate constraint carried
through Phases 4-6 of this project: "reuse everything, no new AI calls."

## Limitations

- Suggested questions and the review queue are heuristics over existing
  data (mastery bands, topic weight), not adaptive learning algorithms.
- "Study time" shown in the Learning Dashboard is an estimated reading
  duration derived from document length, not a measured session duration
  — labeled as an estimate in the UI, not presented as a precise number.
- Tutor Memory (recent questions/topics/nodes) is session-only by design
  — it resets on refresh, it is not a persistent learning history.
- No mobile app; the web UI is responsive down to phone width but is not
  a native experience.

## Future Work

- Persistent (not session-only) learning history, if a real need for it
  emerges beyond what the Learning Dashboard already surfaces from
  server-side data.
- Adaptive review scheduling (spaced repetition) instead of the current
  mastery-band heuristic.
- Collaborative/shared study libraries.
