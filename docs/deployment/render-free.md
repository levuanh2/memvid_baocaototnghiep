# Deploying StudyMap AI on Render (Free tier)

This describes the deployment defined by `render.yaml` at the repository root.
It targets **Render's Free Web Service** — roughly 0.5 CPU, 512 MB RAM, an
ephemeral filesystem, and automatic spin-down after ~15 minutes of inactivity.

Those three limits decide almost every setting in the blueprint. Read
[What does not work on Free](#what-does-not-work-on-free) before promising this
deployment to anyone; a meaningful part of the product is degraded here, and the
blueprint is configured to degrade *visibly* rather than to crash.

---

## Architecture

```
GitHub
   │
   ├── GitHub Actions (.github/workflows/ci.yml)
   │      ├── backend-tests     pytest + Postgres service container
   │      ├── frontend          vitest + vite build (+ lint, report-only)
   │      └── docker-*          image build & compose smoke
   │
   └── Render Blueprint (render.yaml)
          │
          ├──────────────► studymap-web   (static site, free)
          │                   Vite build, SPA rewrite to index.html
          │
          └──────────────► studymap-api   (web service, free)
                              │
                              ├── Flask + Gunicorn  (app.main:app)
                              │
                              ├── Gemini API        ← external LLM
                              ├── Supabase Postgres ← business data
                              └── Supabase Storage  ← uploaded documents

          Embeddings / reranker / NLI: NOT loaded on Free.
          SKIP_MODEL_LOAD=1 replaces them with FakeEmbeddings.
```

---

## 1. GitHub repository setup

The blueprint deploys from `main` on `github.com/levuanh2/memvid_baocaototnghiep`.

1. Push the branch containing `render.yaml`.
2. Nothing else is required for CI — `.github/workflows/ci.yml` runs on every
   push and pull request to `main` and needs **no repository secrets**. The
   backend suite brings its own throwaway Postgres as a service container and
   runs with `SKIP_MODEL_LOAD=1`, so it needs no API keys and downloads no
   model weights.

## 2. Render Blueprint deployment

1. Render Dashboard → **New** → **Blueprint**.
2. Select this repository. Render reads `render.yaml` from the root.
3. Render prompts for the five `sync: false` values (see
   [Environment variables](#environment-variables)). Fill them in before the
   first build — the build runs `alembic upgrade head` and needs `DATABASE_URL`.
4. Apply. Render creates `studymap-api` (free web service) and `studymap-web`
   (free static site).
5. When `studymap-api` is live, copy its URL
   (e.g. `https://studymap-api.onrender.com`) into `studymap-web`'s
   `VITE_API_BASE`, then redeploy the frontend. Vite inlines that value at
   **build** time, so a restart alone will not pick it up.

## 3. Environment variables

Enter secret values in **Render Dashboard → the service → Environment**.
Never commit them: not to `render.yaml`, not to workflow YAML, not to `.env`.

### Secret — Render prompts for these (`sync: false`)

| Key | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → connection string. **Which database this points at is not recorded anywhere in this repository and is currently unconfirmed — see [database-boundary.md](database-boundary.md) before any corpus or index work.** Use the **session pooler (port 5432)**; the transaction pooler (6543) cannot run alembic's multi-statement DDL. Percent-encode the password (`#` → `%23`). |
| `SUPABASE_URL` | `https://<project_ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API keys → secret key |
| `GEMINI_API_KEY` | Google AI Studio. Must be an **AI Studio API key** (`AIza…`, 39 chars), not an OAuth access token (`AQ.…`) — the latter fails with `ACCESS_TOKEN_TYPE_UNSUPPORTED`. |
| `VITE_API_BASE` | On `studymap-web` only: the `studymap-api` URL. |

`AUTH_SECRET` is also secret but is **not** prompted — Render generates it once
(`generateValue: true`), never displays it, and never stores it in git.

### Non-secret — set by the blueprint

Runtime/server: `PYTHON_VERSION=3.11`, `WEB_CONCURRENCY=1`,
`GUNICORN_TIMEOUT=120`, `CORS_ORIGINS=*`.

Free-tier switch: `SKIP_MODEL_LOAD=1`.

State paths: `DATA_DIR=/tmp/studymap`, `JOBS_DB_PATH`, `LOG_DB_PATH`,
`CONVERSATIONS_DB_PATH` (all ephemeral).

AI provider: `OLLAMA_HOST=""`, `OLLAMA_WARMUP=0`,
`GEMINI_CHAT_MODEL=gemini-2.5-flash`, `LLM_MAX_TOKENS=8192`,
`AI_TIMEOUT_SEC=110` and the three per-feature timeouts.

Retrieval: `RERANK_ENABLED=0`, `NLI_ENABLED=0`, `LATE_CHUNKING=0`,
`EMBEDDING_WARMUP_ENABLED=0`, `CRAG_ENABLED=0`, `HYBRID_TOP_K=6`,
`HITL_ENABLED=0`.

Auth: `AUTH_REQUIRE_SECRET=true`, `AUTH_PROTECT_APP_APIS=true`,
`AUTH_TOKEN_TTL_SEC=604800`.

Queue/storage: `REDIS_URL=""`, `QUEUE_ENABLED=false`,
`CONVERSATION_CONTEXT_ENABLED=true`, `SUPABASE_STORAGE_BUCKET=documents`.

### Deliberately absent

`HF_HOME` and `USERS_DB_PATH` are not set. No code reads `USERS_DB_PATH`
(accounts live in Postgres), and with `SKIP_MODEL_LOAD=1` nothing ever writes a
HuggingFace cache. Setting them would look load-bearing and would not be.

## 4. How external AI is configured

There is no new provider abstraction — the existing one is driven by
environment variables and this deployment just picks a different branch of it.

`app/clients/llm_factory.py` builds `PROVIDERS` at import:

```python
if (os.getenv("OLLAMA_HOST") or "").strip() or (not has_any_remote):
    PROVIDERS.append("ollama")
if has_gemini:
    PROVIDERS.append("gemini")
```

An **empty** `OLLAMA_HOST` is therefore load-bearing, not cosmetic: it is the
only thing that removes `ollama` from the list. Leave it at its default and
every LLM call tries a non-existent Ollama first, waits out the timeout, and
only then falls through to Gemini.

```
Local development
→ OLLAMA_HOST=http://localhost:11434, no GEMINI_API_KEY
→ PROVIDERS = ["ollama"], local weights via sentence-transformers

Render Free
→ OLLAMA_HOST="", GEMINI_API_KEY set, SKIP_MODEL_LOAD=1
→ PROVIDERS = ["gemini"], embeddings = FakeEmbeddings (no download)
```

Embeddings are already lazy (`get_embeddings()` loads on first use, not at
import), so `SKIP_MODEL_LOAD=1` keeps boot free of any download. **There is no
external embedding provider in this codebase** — adding one would be a new
feature, not a deployment change, so on Free the embedding path is stubbed
rather than outsourced. That is the single biggest limitation below.

## 5. Health check

```
GET /health   →   200 {"status": "ok", "mode": "ci"|"normal", ...}
```

Already implemented at `BE/app/main.py:793` — no new endpoint was added, and the
committed URL-map snapshot (`BE/tests/snapshots/url_map.json`) is unchanged.
It touches no LLM, no database, no model and no API key, so it stays green while
degraded features are failing — which is exactly what a health check is for, and
also why a green `/health` is *not* evidence that retrieval works.

`render.yaml` points `healthCheckPath` at it. CI boots the app under gunicorn
and curls the same path, so a broken start command fails a pull request instead
of a deploy.

### Reading the live configuration

`render.yaml` marks every sensitive value `sync: false`, so the repository never records
what production is actually running, and no Render read API returns environment variable
values. Ask the service itself:

```bash
curl -s https://<api-host>/api/config/status | jq
```

It reports names and flags only — `ingest_origin`, the active LLM provider list, the
embedding identity (provider / model / strategy) and whether it is enabled, the rerank
backend, the vision model, `index_persistence_enabled`, `skip_model_load`, and whether an
FPT key is **present**. It never returns a secret value.

Use this before drawing any conclusion about production behaviour. Two audits in this
repository reached opposite conclusions by inferring configuration instead of reading it.

## 6. Expected commands

```
buildCommand:  pip install --upgrade pip &&
               pip install -r requirements.txt &&
               python scripts/build_proto.py &&
               alembic upgrade head

startCommand:  gunicorn -w ${WEB_CONCURRENCY:-1} -b 0.0.0.0:${PORT:-8080} \
               --timeout ${GUNICORN_TIMEOUT:-120} app.main:app
```

`rootDir` is `BE`, so both run there. Notes:

- **Never `flask run`.** Gunicorn serves `app.main:app`, the same WSGI target
  `BE/Dockerfile` uses.
- `python scripts/build_proto.py` regenerates the gRPC stubs. `shared/proto/gen/`
  is gitignored, so a fresh clone has none. Nothing on the boot path imports
  them (the gateway clients are lazy, behind `LLM_GATEWAY_ADDR`), but this keeps
  parity with the Docker image.
- Migrations run at **build** time, not in `startCommand`. Render's
  `preDeployCommand` is a paid feature; build-time is the closest free
  equivalent, because a failed build leaves the previous deploy serving. In
  `startCommand` a bad migration would instead take the service down and re-run
  on every cold start.

## 7. Triggering a redeploy

- **Automatic:** `autoDeploy: true` — every push to `main` redeploys both services.
- **Manual:** Dashboard → service → **Manual Deploy** → *Deploy latest commit*,
  or *Clear build cache & deploy* when dependencies misbehave.
- After changing `render.yaml`, push it and re-sync the blueprint from the
  Dashboard so Render picks up the new service definition.

---

## What does not work on Free

Listed plainly, because a deployment that quietly does less than the product
promises is worse than one that is honestly limited.

### Embedding-backed retrieval — degraded, not broken

`SKIP_MODEL_LOAD=1` makes `get_embeddings()` return
`FakeEmbeddings(size=384)`. Vectors are generated, so nothing raises, but they
carry no semantic meaning. Consequences:

- RAG chat answers and their citations are not grounded in real similarity.
- Semantic search returns arbitrary ordering.
- Ingest builds a FAISS index of meaningless vectors.
- Reranking (`RERANK_ENABLED=0`) and NLI verification (`NLI_ENABLED=0`) are off.

Gemini-backed generation — quiz, summary, mindmap, study-map — still works,
because those call the LLM with supplied context rather than the embedding model.

The reason is arithmetic, not preference: the smallest workable encoder
(`intfloat/multilingual-e5-small`) needs ~470 MB resident, and the box has 512 MB
total including Flask, Gunicorn and torch.

### Ephemeral filesystem

Free has **no Persistent Disk** (the blueprint creates none — it is a paid
feature). `DATA_DIR=/tmp/studymap` is wiped on every deploy, restart and
spin-down. Therefore:

- FAISS index files do not survive; anything ingested is gone after a restart.
- `jobs.sqlite`, `logs.sqlite`, `conversations.sqlite` do not survive — job
  history and logs reset.
- Uploaded originals are safe **only** because they go to Supabase Storage, and
  business data is safe because it is in Supabase Postgres.

### Background jobs

`QUEUE_ENABLED=false` runs jobs in in-process daemon threads (same code, same
RQ-compatible dotted callables in `app.main` — those are untouched). No Redis
and no worker service is created; neither is free. So:

- A job dies with the instance on spin-down or redeploy, mid-flight.
- Long generation on 0.5 CPU may exceed the 120 s Gunicorn timeout.
- Job status is lost on restart because the ledger is on the ephemeral disk.

### Spin-down

After ~15 minutes idle the service stops. The next request pays a cold start
(imports torch and the LangChain stack), typically tens of seconds. The first
request after idling may time out at the client; the second usually succeeds.

### Build weight — verify on first deploy

`requirements.txt` pulls `torch==2.5.1+cpu`, `faiss-cpu`,
`sentence-transformers` and `transformers`: roughly 1.5–2.5 GB installed. They
are imported but, with `SKIP_MODEL_LOAD=1`, never used to load weights.
Removing them would need real code changes and is out of scope here.

**This has not been verified against a live Free build.** If the build exceeds
Render's free build resources, the options are, in order of preference:
upgrade to a paid instance type (below), or introduce a slimmed requirements
file for deployment only — which requires first proving that no boot-path import
needs torch/faiss.

### OCR

The native Python runtime has no `tesseract` binary (the Docker image installs
one). Image-based document ingest will not OCR on this deployment.

---

## Upgrading to paid infrastructure

The previous paid blueprint is recorded here so it is not lost. To restore full
functionality, change `studymap-api` in `render.yaml`:

```yaml
    runtime: docker            # instead of: python
    plan: standard             # 2 GB RAM — or `pro` (4 GB) for bge-m3
    dockerfilePath: ./BE/Dockerfile
    dockerContext: ./BE
    preDeployCommand: "alembic upgrade head"   # move out of buildCommand
    dockerCommand: 'sh -c "mkdir -p $DATA_DIR/index $DATA_DIR/memory $DATA_DIR/input_docs $HF_HOME && exec gunicorn -w ${WEB_CONCURRENCY:-1} -b 0.0.0.0:${PORT:-8080} --timeout ${GUNICORN_TIMEOUT:-900} app.main:app"'
    disk:
      name: studymap-data
      mountPath: /var/data
      sizeGB: 10
```

and the environment:

| Key | Free | Paid |
|---|---|---|
| `SKIP_MODEL_LOAD` | `1` | remove it |
| `EMBEDDING_MODEL_NAME` | unset | `intfloat/multilingual-e5-small` (standard) or `BAAI/bge-m3` (pro) |
| `LATE_CHUNKING` | `0` | `0` for e5-small (512-token cap), `1` only with bge-m3 |
| `DATA_DIR` | `/tmp/studymap` | `/var/data` |
| `HF_HOME` | unset | `/var/data/hf` — the disk keeps weights across deploys, so the model downloads once |
| `RERANK_ENABLED` / `NLI_ENABLED` | `0` | `1` on `pro`; both together exceed `standard` |
| `CRAG_ENABLED` | `0` | `1` (`CRAG_REWRITE_MAX=2`) |
| `GUNICORN_TIMEOUT`, `*_LLM_TIMEOUT_SEC` | `120` / `110` | `900` / `300` |

**Changing the embedding model invalidates the FAISS index** — the vector
dimension changes. Delete the index when switching, or retrieval fails on a
dimension mismatch.

Optional once paid: a Redis instance plus a background worker service running
the existing RQ callables, and `QUEUE_ENABLED=true`, so jobs survive restarts.
