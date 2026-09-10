# Changelog

All notable changes to this project are documented here. Grouped by the
phase they were built in, sourced directly from `git log` — every entry
below corresponds to a real commit, not a summary written from memory.

## [v1.0] — Release

### Phase 1 — Study Library Foundation
`e3265b6` → `4ce59dd` (2026-09-09)

- `feat(study-library): add AI-first document library foundation` (`e3265b6`)
- `feat(study-library): add collections and smart library organization` (`84895d7`)
- `chore(herdr): integrate study workspace bridge` (`12d863a`)
- `feat(study): add document knowledge projection layer` (`146352f`)
- `feat(study): add deterministic suggested question engine` (`4ce59dd`)

Established the Study Library (`/app/study`): document collections, a
server-computed "knowledge projection" per document (topics, entities,
readiness), and a deterministic (non-LLM) Suggested Question engine that
derives questions from existing topic/entity/mastery data rather than
generating new ones.

### Phase 2 — MindMap Experience
`ecaff9e` → `071d5b0` (2026-09-09)

- `feat(studymap): add renderer-independent layout abstraction` (`ecaff9e`)
- `feat(studymap): add search and focus mode` (`e8b7d68`)
- `feat(studymap): add presentation mode; spike bulk collapse and stop` (`37f7749`)
- `feat(studymap): add export, keyboard zoom, and a11y pass` (`071d5b0`)

Built out the StudyMap knowledge-graph viewer (`/app/study/map/:id`,
react-d3-tree): pluggable layouts, in-tree search with keyboard navigation,
focus mode (ancestor/descendant highlighting), a presentation mode, image
export, and an accessibility pass.

### Phase 1C.2b / 4A — Knowledge Panel + Study Context
`96e76d6` → `56db3c8` (2026-09-10)

- `feat(study): add shared Study Context` (`96e76d6`)
- `feat(study): wire Summary and MindMap into Study Context` (`e742737`)
- `feat(study): wire Suggested Questions into Chat via Study Context` (`ad9ccc9`)
- `feat(study): complete Study Knowledge Panel` (`fb1bfc7`)
- `feat(study): remember selected Suggested Question` (`911c804`)
- `feat(study): wire Knowledge topics/entities into Study Context` (`99b3e36`)
- `feat(study): make Continue Learning context-aware` (`56db3c8`)

Introduced **Study Context** — a single React context broadcasting the
current selection (document/topic/entity/summary/node/question/mode)
across every study surface, replacing per-surface local guessing. Built
the Knowledge Panel inside each document card (topics, related documents,
suggested questions, AI summary preview, context-aware Continue Learning),
all reusing existing fetched data — no new endpoints.

### Phase 4B — Workspace Interaction Layer
`a9cea1b` → `f269398` (2026-09-10)

- `fix(workspace): unify study interactions through Study Context` (`a9cea1b`)
- `feat(workspace): synchronize summary, knowledge and mindmap selections` (`91da94a`)
- `feat(workspace): add unified breadcrumb and tutor context routing` (`f269398`)

Connected every existing learning surface (Summary, MindMap, Knowledge,
Suggested Questions, Continue Learning) through Study Context as the one
source of truth, and added a workspace breadcrumb (Document › Surface ›
Topic › Question) derived purely from context state, never from the URL.

### Phase 4C — AI Tutor Panel
`95c2d00` → `09fb370` (2026-09-10)

- `feat(workspace): add AI Tutor panel shell` (`95c2d00`)
- `feat(workspace): wire AI Tutor to Study Context and chat` (`09fb370`)

Added the AI Tutor panel to the Workspace: a live Context Card, Quick
Actions (Explain / Summarize / Quiz-in-chat / open Mindmap / open
Summary), session-only Tutor Memory (recent questions/topics/nodes, not
persisted), and Suggested Questions sourced from Study Context — reusing
the existing chat composer as the single dispatch point, no new AI calls.

### Phase 5 — Learning Analytics & Review
`7cc716b` → `58f4063` (2026-09-10)

- `feat(learning): add learning progress aggregation` (`7cc716b`)
- `feat(learning): add review dashboard` (`ab626e0`)
- `feat(learning): integrate learning dashboard into Study Library` (`81dee41`)
- `fix(learning): correct false claim about the 'chat' journey stage` (`58f4063`)

Added a Learning Dashboard to the Study Library: artifact coverage,
weak-topic detection, a mastery-banded review queue (Today/Tomorrow/Later),
and library-wide insights (most-studied topic, largest document, etc.) —
entirely derived from already-fetched data, zero new backend calls.

### Phase 6 — Production Readiness
`afa02fa` → `588af55` (2026-09-10)

- `fix(accessibility): add focus trap/restore to shared Modal, fix QuizTaking dialog` (`afa02fa`)
- `feat(demo): add Demo Mode entry point to Study Library` (`223cacc`)
- `perf(app): route-level code splitting` (`dbb6d05`)
- `docs(product): add SECURITY.md` (`32a844a`)
- `fix(observability): add top-level error boundary and unhandled-rejection log` (`588af55`)

Shared `Modal.jsx` gained a real focus trap and focus-restore (fixing 5
dialogs at once). Added Demo Mode — opens an already-processed real
document, never fabricated content. Route-level `React.lazy()` cut the
main JS bundle by 60.7% (565.93kB → 223.34kB, measured). Added the app's
first top-level error boundary and unhandled-rejection logging. Wrote
`docs/SECURITY.md`.

### Release preparation — Final Freeze, Release Audit, Release Package
`cb911e9` → present (2026-09-10)

- `refactor(shared): extract query-text helpers; remove dead state/prop in ChatArea` (`cb911e9`)
- `refactor(shared): deduplicate single-flight/overload env+log helpers` (`9ee2b4c`)
- `docs(release): add v1.0 release checklist` (`8e1e6d7`)

A full repository cleanup pass (dead-code removal, helper deduplication —
verified by direct execution, not assumed) and a release-readiness audit
(secret scan, dependency/config/deployment review) producing
`docs/RELEASE_CHECKLIST.md`. Verdict: **READY WITH KNOWN LIMITATIONS**
(see that document for the full list). This changelog and the rest of the
`docs/` release package were generated in the same pass.

## Foundation (pre-dates this changelog's phase numbering)

The backend this project is built on already carried substantial history
before Phase 1 above: hybrid BM25+FAISS retrieval, a Memory Tree query
router, LangGraph ingest/query/mindmap pipelines, an evaluation harness
(E0–E7 experiment ladder), multi-provider LLM/embedding/rerank support
(Ollama, Gemini, Groq, and FPT AI), NKS SSO authentication, and a
StudyMap Postgres schema (quizzes, attempts, concept mastery, review
plans). 169 commits total in this repository as of this release, spanning
2026-08-20 to 2026-09-10; the phases above are the most recent chapter —
the frontend "AI Learning Workspace" built on top of that backend.
