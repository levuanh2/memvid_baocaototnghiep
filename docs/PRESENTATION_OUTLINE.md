# Presentation Outline

14 slides. Screenshot suggestions are placeholders — capture real ones
from the running app before presenting; none exist in this repo yet
(see `README.md#screenshots` for the shot list).

## 1. Title
**Key message**: MemVidX — a RAG-based study platform, not just a chatbot.
**Screenshot**: Landing page hero.
**Talking points**: Name, one-line pitch, presenter/context (thesis/demo).

## 2. The Problem
**Key message**: Studying a long document today means re-reading it every
time, with no way to track what's actually understood.
**Screenshot**: none (text/diagram slide).
**Talking points**: The re-read problem, the "chat with your PDF" tools
that stop at Q&A and don't help you track progress or test yourself.

## 3. What MemVidX Does
**Key message**: One document, five ways to engage with it — chat,
summarize, map, question, quiz — all sharing context.
**Screenshot**: Workspace with the AI Tutor panel open.
**Talking points**: Upload once, use every surface without re-explaining
what you're looking at.

## 4. Architecture at a Glance
**Key message**: Two services, provider-agnostic AI, two data stores
bridged on purpose.
**Screenshot**: System Context diagram (`docs/ARCHITECTURE.md`).
**Talking points**: React/Vite + Flask, LangGraph pipelines, Postgres +
legacy SQLite bridged by `source_stem`/`document_id`, fail-open Redis.

## 5. AI Pipeline
**Key message**: Hybrid retrieval, optional precision stages, multi-provider.
**Screenshot**: AI Pipeline diagram.
**Talking points**: BM25+FAISS+RRF, optional reranking, optional
NLI-based contradiction filtering, four LLM providers behind one
interface (Ollama/Gemini/Groq/FPT AI).

## 6. Document Chat with Citations
**Key message**: Every answer is traceable back to the source text.
**Screenshot**: Workspace chat with a citation chip.
**Talking points**: Click a citation, see the exact chunk it came from.

## 7. Summary + MindMap
**Key message**: Two shapes of the same content — linear summary, visual
map.
**Screenshot**: Summary modal + Mindmap side by side.
**Talking points**: Background jobs with progress/cancel, exportable
mindmap image.

## 8. StudyMap
**Key message**: A dedicated knowledge graph for exploring structure.
**Screenshot**: StudyMap with a focused branch.
**Talking points**: Layouts, search, focus mode, presentation mode.

## 9. Study Context — the Architectural Idea
**Key message**: One broadcast layer means every surface knows what
you're looking at without re-fetching or re-explaining.
**Screenshot**: none, or a small diagram (Document → Surface → Topic →
Question → Chat breadcrumb).
**Talking points**: Not a second data store — components keep their own
state, Context only carries IDs. This is why clicking a suggested
question elsewhere in the app lands you in chat with it already asked.

## 10. AI Tutor Panel
**Key message**: A tutor that already knows what you're looking at.
**Screenshot**: Tutor panel with Context Card + Quick Actions.
**Talking points**: Live context, quick actions route into the same chat
composer everything else uses — no second chat state.

## 11. Learning Analytics
**Key message**: Progress, coverage, and a review queue — computed, not
fetched.
**Screenshot**: Learning Dashboard on the Study Library page.
**Talking points**: Everything here derives from data the page already
loaded; zero additional network calls for any of it.

## 12. Quiz, Grading, Review
**Key message**: Closing the loop — test yourself, see what's weak, get
routed to it.
**Screenshot**: Quiz result + review queue.
**Talking points**: Automatic grading, mastery-banded review queue.

## 13. Engineering Quality
**Key message**: This isn't just features — it's tested, measured, and
documented.
**Screenshot**: none (metrics slide).
**Talking points**: 831 frontend tests / ~2009 backend tests, 60.7%
bundle-size reduction (measured, not estimated), a documented security
posture with honestly-stated known gaps, zero secrets in git history
(verified, not assumed).

## 14. Known Limitations + Roadmap
**Key message**: What's honestly not done yet, and what's next.
**Screenshot**: none.
**Talking points**: Rate limiting currently ineffective on the free-tier
deploy, CORS wildcard (deliberate, documented), no security headers yet,
AI-latency benchmarks not measured yet. Roadmap: split the backend's
largest file, close the security gaps, measure latency.
