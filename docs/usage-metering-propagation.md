# Usage reservation propagation inventory

This inventory is the pre-change audit for PR #47. `provider_actual` means the
provider response exposes official counters. `estimated` is never labelled as
provider usage. Deterministic/local-only work is `zero_ai_usage`.

| Feature | HTTP route | Execution boundary | Sync/async | Provider | Usage available | Reservation owner |
|---|---|---|---|---|---|---|
| Chat/Ask non-stream | `POST /query` | `query_graph.generate_answer_node` -> `qa_chain.answer_with_document_context` | background thread; result polling | configured chat provider | `provider_actual` on LangChain/FPT response; gateway currently `unknown/blocker` | authenticated route user |
| Chat/Ask stream | `POST /query`, `GET /query-stream/<job_id>` | `query_graph.generate_answer_node` -> `qa_chain.answer_with_document_context_stream`; SSE endpoint polls durable job output | provider generation in background, client SSE | configured chat provider | final provider chunk can be `provider_actual`; disconnect does not cancel background job; gateway currently `unknown/blocker` | authenticated route user |
| Query rewrite / conversation rewrite / LLM rerank | `POST /query` | retrieval nodes and cache judge | background | configured chat provider | `provider_actual` when returned; otherwise `unknown/blocker` | parent query operation |
| Query exact cache hit / single-flight follower | `POST /query` | `_get_cached_query` / `_single_flight_try` | background | none | `zero_ai_usage` | authenticated route user; zero-token audit event |
| Query semantic cache judge | `POST /query` | `llm_cache.semantic_lookup` -> `judge_reuse` | background | configured chat provider | `provider_actual` when the judge returns official counters; a judged hit is only labelled free when the whole operation remains zero-token | parent query operation |
| Upload extraction / parsing / chunking | `POST /upload-file`, `/upload`, `/upload-multiple` | `_run_ingest_job` -> `ingest_graph` deterministic nodes | RQ worker or daemon thread | none | `zero_ai_usage` | authenticated uploader |
| Upload cleaning/enrichment | same upload routes | `ingest_graph.Normalize` / `domains.ingest.enrich` when enabled | RQ worker or daemon thread | configured chat provider | `provider_actual` when counters exist | authenticated uploader, persisted with ingest job |
| Upload embedding | same upload routes | `ingest_graph.EmbedAndIndex` -> vector store / `FptEmbeddings` or local encoder | RQ worker or daemon thread | FPT embedding or local BGE/Ollama | FPT `usage` is `provider_actual` when present, otherwise `unknown/blocker`; local embedding is `zero_ai_usage`/unmetered, never provider actual | authenticated uploader, persisted with ingest job |
| Upload memory-tree summaries | same upload routes | `ingest_graph.BuildMemoryTree` -> `memory.tree` | RQ worker or daemon thread | configured chat provider | `provider_actual` when counters exist | authenticated uploader, persisted with ingest job |
| Summary | `POST /generate-summary`, `GET /summary-status/<job_id>` | `run_summary_job` -> `summary_graph` -> summary pipeline | RQ worker or daemon thread | configured summary provider | multiple `provider_actual` attempts; cache hit is `zero_ai_usage` | authenticated route user, persisted with job |
| MindMap V2 | `POST /generate-mindmap`, `GET /mindmap-status/<job_id>` | `run_mindmap_job` -> `mindmap_graph` -> outline/enrich/relations | RQ worker or daemon thread | configured mind-map provider | multiple `provider_actual` attempts; cache hit is `zero_ai_usage` | authenticated route user, persisted with job |
| Guided MindMap V3 | same mind-map routes | PostgreSQL guided job -> `guided_worker.run_once` -> `run_mindmap_job` | durable worker | configured mind-map provider | multiple `provider_actual` attempts; cached durable completion is `zero_ai_usage` | guided PostgreSQL job owner |
| Retry | query/summary/mind-map/upload worker paths | provider fallback or durable job retry | async | provider per attempt | each provider-returned counter is `provider_actual`; attempt id must be stable and unique | parent reservation; separate execution-attempt key |
| Export PNG/JPEG/SVG/PDF/DOCX/XLSX | mind-map export routes | export worker | async | none | `zero_ai_usage` | no reservation |

## Required propagation shape

The route creates one `UsageReservationContext`, serializes its safe fields into
the durable job record/arguments, and reconstructs it in the worker. Provider
calls receive that context explicitly together with a deterministic attempt id.
No prompt, question, answer, document text, credential, header, or cookie enters
the usage ledger.

## Rollout and verification

- Alembic chain: `20260923_guided_job_force_flag` ->
  `20261001_usage_ledger` -> `20261001_job_usage_ctx`; one head only.
- The ledger downgrade is intentionally forward-only. It does not drop quota
  history or live reservations; destructive removal requires a separate,
  reviewed migration after every reservation is terminal.
- PostgreSQL 16 integration covers Free/Plus/Pro entitlements, reserve, commit,
  release, overage, UTC monthly rollover, lease expiry, ownership, recent
  events, malformed rollback, and capability contracts.
- Spawned OS-process tests cover quota races, identical idempotency keys,
  concurrent commits, process death, lease recovery, and restart completion.
- Browser QA covers the 80% warning state, desktop/mobile bounds, Escape close,
  and the production build. Evidence is stored in
  `docs/qa-screenshots/usage-metering/`.
- `USAGE_ENFORCEMENT_ENABLED` remains off. Enabling it is a separate rollout
  decision after required CI and production-provider sampling are green.

## Usage-source policy

- `provider`: only counters returned by the remote provider response.
- `estimated`: local Ollama counters or explicitly estimated usage; UI always
  labels these as `Ước tính`.
- `system`: zero-token cache/audit events.
- Deterministic extraction, parsing, chunking, hierarchy repair, persistence,
  and export are not AI token usage.

## Known limits

- The optional gRPC LLM gateway protobuf does not expose token usage. It is not
  configured in the current production monolith and remains
  `unknown/blocker`; do not enable it under hard quota enforcement until the
  contract carries official counters.
- FPT embeddings are metered only when the response includes an official
  `usage` object. A response without counters stays unmetered/unknown rather
  than being presented as provider actual.
- Cohere/FPT rerank APIs in this code expose relevance/search-unit results, not
  token counters. Local cross-encoder rerank is unmetered local computation;
  the optional LLM reranker is metered through the chat provider boundary.
