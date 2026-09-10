# Release Notes — v1.0

## Highlights

MemVidX v1.0 turns a document chat tool into a full study workspace:
every learning surface (Chat, Summary, MindMap, Knowledge, Suggested
Questions, AI Tutor, Learning Analytics) now shares one context instead
of operating in isolation, and a new Learning Dashboard shows progress
across the whole library without any additional AI calls.

## Major Features

- **Study Context** — one broadcast layer for the current
  document/topic/entity/summary/node/question/learning-mode selection,
  read by every study surface.
- **Knowledge Panel** — per-document topics, entities, related documents,
  and deterministic suggested questions.
- **StudyMap** — a react-d3-tree knowledge graph with layout switching,
  search, focus mode, presentation mode, and export.
- **AI Tutor panel** — live context card, quick actions, session-only
  Tutor Memory, wired into the existing chat composer (no second chat
  state).
- **Learning Dashboard** — progress/coverage, weak-topic detection, a
  mastery-banded review queue, and library-wide insights, all derived
  client-side from data already loaded.
- **Demo Mode** — opens the best already-processed real document with one
  click; never shows fabricated content.

## Engineering Improvements

- Route-level code splitting: main JS bundle cut 60.7% (565.93kB →
  223.34kB, measured).
- Shared `Modal.jsx` gained a real focus trap, auto-focus, and
  focus-restore — fixing 5 dialog components at once instead of one at a
  time.
- Added the app's first top-level error boundary and unhandled-rejection
  logging (neither existed before this release — verified by grep).
- Deduplicated backend single-flight/overload helper functions
  (verified behavior-equivalent by direct execution across every edge
  case, not just code review).
- Removed dead state and a dead prop from the largest frontend component
  (`ChatArea.jsx`), each confirmed unused before removal, not guessed.

## Testing

831 frontend tests passing across 65 files (all pure-logic — this
codebase does not use component/DOM testing). ~2009 backend test
functions across 198 files (CI-verified on every push with a real
Postgres service container; could not be run locally this session due to
an unrelated local environment version mismatch — see `docs/BENCHMARK.md`).

## Known Limitations

- General API rate limiting is ineffective on the current free-tier
  deployment (fails open without Redis).
- `CORS_ORIGINS="*"` in production — deliberate, documented, not yet
  tightened.
- No nginx security headers (CSP, X-Frame-Options) yet.
- Backend Docker image runs as root.
- No LICENSE file exists in this repository yet.
- AI-pipeline latency was not measured this release.

Full detail: `docs/RELEASE_CHECKLIST.md`, `docs/SECURITY_SUMMARY.md`.

## Upgrade Notes

No database schema changes, no backend API changes, and no AI/prompt
changes were made in this release cycle (verified against the diff, not
assumed) — this release is additive frontend work plus a
documentation/audit pass. No migration steps are required.
