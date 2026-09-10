# AWS EC2 Production Deployment

Runbook for the `docker-compose.prod.yml` stack: **backend only**
(Flask/Gunicorn monolith, unchanged app code). Supabase Postgres + Storage
kept external, FPT AI + Gemini kept external. No Ollama, no local
embedding/reranker, no Redis, no worker.

**Frontend stays permanently on Render Static Site**, deployed and
configured there — out of scope for this document and this compose file.
The only thing that ties the two together is CORS on the backend side and
`VITE_API_BASE`/`VITE_API_URL` on the Render side (see CORS, below).

Background/reasoning lives in `AWS_DEPLOYMENT_PLAN.md` at the repo root —
written for the earlier backend+frontend-on-EC2 design and not fully
updated for this backend-only split; treat it as historical context, this
document is the current operational how-to.

## Directory structure

```
/opt/memvid/
├── app/                                 # git clone of this repo
│   ├── docker-compose.prod.yml
│   └── scripts/*.sh
├── env/
│   └── .env                             # copied from .env.example.aws, filled
│                                         # in, chmod 600 — never in git
├── data/
│   ├── index/                           # FAISS index files
│   ├── memory/                          # jobs/logs/conversations/users sqlite
│   │   └── checkpoints.sqlite           # LangGraph HITL checkpointer —
│   │                                    # scripts/deploy.sh (via
│   │                                    # ensure_data_layout in _lib.sh)
│   │                                    # creates this as an empty FILE
│   │                                    # automatically if it's missing, and
│   │                                    # self-heals if Docker previously
│   │                                    # auto-created it as an empty
│   │                                    # directory — no manual step needed
│   └── input_docs/                      # staged uploads (durable copy is in
│                                         # Supabase Storage; this is scratch)
└── backups/                             # created by scripts/backup.sh
```

Not bind-mounted, and deliberately so: `/tmp` inside the backend container.
Werkzeug's transient upload spooling is correctly ephemeral there — it never
needs to survive a restart.

## Network

The backend container publishes `8080` directly to the host — there is no
nginx or reverse proxy in front of it in this compose file anymore. The
Render frontend (and any browser) talks to it cross-origin, directly on
that port.

This changes what the EC2 security group needs, compared to any earlier
plan that assumed nginx/Certbot on this box: **open the backend's port
(8080, or whatever it's fronted by) to the internet; 80/443 aren't used by
this compose file at all.**

**TLS is out of scope for this compose file.** Backend-on-Render-frontend
means the browser calls the EC2 backend directly and cross-origin — if that
call is `https://`, plain `http://backend-ip:8080` will fail with a
mixed-content error from the Render page. If HTTPS is needed in front of
the backend, it has to be added outside this compose file — an AWS ALB with
an ACM certificate is the standard fit for "one EC2 instance, no ECS/K8s."
That's a separate, deliberate infrastructure decision, not something this
runbook implements.

## Environment variables

Template: `.env.example.aws` at the repo root. Copy it to `/opt/memvid/env/.env`,
fill in real values, `chmod 600`. The template only includes what this
backend-only deployment actually needs: Supabase, FPT AI, Gemini, auth,
gunicorn, CORS. Render-only, dev/test-only, and (now) frontend-build-only
variables are intentionally omitted — `VITE_API_BASE` in particular is
Render's concern now, not this file's.

`scripts/deploy.sh` validates every variable in `_lib.sh`'s `REQUIRED_ENV_VARS`
list is present and non-empty **before** it builds anything — a missing
secret fails the deploy immediately instead of failing partway through a
build or, worse, after the container is already up. Run the same check on
its own with `scripts/validate-env.sh`.

Two things worth double-checking before first boot:

- `OLLAMA_HOST` must be an **empty string**, not merely unset — `llm_factory`
  only drops Ollama from the provider chain when this is literally blank.
- `ALEMBIC_PRODUCTION_HOST` / `ALEMBIC_PRODUCTION_DB` must name the real
  Supabase host/db exactly — the migration guard refuses to run against
  production otherwise (fails closed, by design).

## CORS (the piece that actually connects Render to EC2)

Since frontend and backend are on different origins now, `CORS_ORIGINS`
matters more than it used to — this is a real cross-origin browser call,
not same-origin-behind-nginx. Set it to the exact Render frontend URL once
known (e.g. `https://studymap-web.onrender.com`); `*` is the current
default but is the weaker posture of the two.

On the Render side (not this repo's concern to deploy, but relevant to get
right): `VITE_API_BASE` (or `VITE_API_URL` — `FE/src/utils/api.js` accepts
either) must be set to this backend's public origin, with **no** `/api`
suffix — `apiUrl()` builds requests as `base + path` against the Flask
app's bare routes (e.g. `/health`, `/query`) directly, it does not expect
or use an `/api/` prefix. Nothing about this changed with the frontend move
— there was never an nginx path-rewrite the frontend code actually depended
on.

## Deployment

First-time setup, once per server — just enough for `deploy.sh` to take over
from here (it creates every data directory and file itself):

```bash
sudo mkdir -p /opt/memvid/env
sudo chown "$USER":"$USER" /opt/memvid
cp /opt/memvid/app/.env.example.aws /opt/memvid/env/.env
# edit /opt/memvid/env/.env with real values
chmod 600 /opt/memvid/env/.env
```

Every deploy (first time and every update) — from `/opt/memvid/app`:

```bash
scripts/deploy.sh
```

`deploy.sh` runs, in this exact order, and stops at the first failure:

1. **Validate environment** — every required variable present and non-empty.
2. **Ensure data layout** — creates every bind-mounted directory/file that's
   missing (including `checkpoints.sqlite`, as an empty file, self-healing
   if Docker previously auto-created it as a directory).
3. **Sync code** — fetches `origin/main` and resets the local clone to match
   it exactly, regardless of what branch/commit it was previously on (this
   is what makes rollback safe — see Rollback below). Aborts if the clone
   has real uncommitted changes; `MEMVID_FORCE_RESET=1 scripts/deploy.sh`
   overrides that.
4. **Build** the backend image.
5. **Migrate** — `python -m scripts.run_migrations --moi-truong production`
   runs as part of every deploy, not as a separate manual step. This is the
   repo's only sanctioned production migration entry point (see Migrations,
   below) — **never** call bare `alembic upgrade head` against production,
   it bypasses the safety checks below and fails closed on
   `TEST_DATABASE_URL chưa đặt` instead. Safe to re-run: it no-ops when the
   schema is already current.
6. **Start** the backend (`compose up -d`).
7. **Health check** — `scripts/health.sh`; the deploy fails (non-zero exit)
   if the backend is unhealthy.

## Migrations

`BE/scripts/run_migrations.py` is the repo's only sanctioned way to run
Alembic against a real database — `deploy.sh` calls it, nothing here calls
bare `alembic` directly. It exists because of a real incident
(`BE/shared/migration_guard.py`'s docstring: 2026-09-05, a bare Alembic
invocation outside pytest silently targeted production and wiped a column's
contents on 22 rows). The guard is fail-closed by design:

- Default target is **test**, and it requires `TEST_DATABASE_URL` — there is
  no fallback to `DATABASE_URL`. Production is reached only by explicitly
  passing `--moi-truong production` **and** having `ALEMBIC_ALLOW_PRODUCTION=1`
  set for that one invocation.
- Even then, `ALEMBIC_PRODUCTION_HOST`/`ALEMBIC_PRODUCTION_DB` (from
  `.env`) must name the real target exactly, and the check runs a second
  time against the *live* connection's `current_database()` — a connection
  string can lie (pooler routing, `PGDATABASE` overrides); the server it
  actually reaches cannot.
- `BE/alembic/env.py` enforces the same check independently, so it holds
  even if something ever calls Alembic a different way.

`deploy.sh` passes `ALEMBIC_ALLOW_PRODUCTION=1` only to that one
`compose run` (via `-e`), never as a line in `.env` — the same shape
`render.yaml`'s `buildCommand` uses. A standing `ALEMBIC_ALLOW_PRODUCTION=1`
in the env file would make the "does the caller actually mean production"
check permanently true, which defeats the point of it.

## Rollback

```bash
scripts/rollback.sh <git-ref>
```

Requires an explicit commit SHA or tag — no automatic "previous commit"
guessing. Aborts if the clone has uncommitted changes. Checks out the ref
(**detached HEAD, intentionally** — the script logs this explicitly so it
reads as expected behavior, not a broken state), rebuilds, restarts, waits
for `/health`. If health never returns, the script exits non-zero but leaves
the ref checked out — investigate with `scripts/logs.sh backend`, or roll
forward again with a known-good ref.

The detached HEAD never lingers into the next deploy: `scripts/deploy.sh`'s
sync-code step unconditionally resets the local clone to `origin/main`
before building, regardless of what ref it finds checked out. Running
`deploy.sh` after a rollback is the normal way back to the latest code.

Rollback only reverts backend code/images. A migration that ran forward
before the rollback is not automatically reversed — check `alembic history`
if the rollback target predates a schema change. It also has nothing to do
with the frontend — that's a separate rollback on Render if ever needed.

## Backup

```bash
scripts/backup.sh
```

Tars `/opt/memvid/data` (index, memory/sqlite, checkpoints, input_docs) into
`/opt/memvid/backups/memvid-data-<timestamp>.tar.gz`. Does **not** back up
Postgres or Supabase Storage — those are Supabase-managed and backed up on
Supabase's own schedule, not from this instance.

Run on a cron schedule per your retention needs — nothing here schedules it
automatically.

## Restore

```bash
scripts/restore.sh /opt/memvid/backups/memvid-data-<timestamp>.tar.gz
```

Destructive — stops the stack, moves the current `data/` dir aside (kept as
`data.pre-restore-<timestamp>`, not deleted), extracts the archive, restarts.
Prompts for confirmation unless run with a trailing `--yes`.

## Updating

Same as Deployment — `scripts/deploy.sh` is the update path (sync, build,
migrate, up, health-check). No separate "update" script; a fresh deploy of
the same running version is a no-op beyond the git sync finding nothing new.

## Health check

```bash
scripts/health.sh
```

Checks the backend's `/health` (from inside the container) and exits
non-zero on failure. `compose ps` output is printed either way.

External uptime monitoring should hit the backend's public URL directly
(`http://<host>:8080/health`, or through whatever fronts it if you've added
an ALB). Frontend uptime is Render's own concern now, not this instance's.

## Troubleshooting

- **Backend won't start:** `scripts/logs.sh backend`.
- **Backend healthy per Docker but app is broken:** `/health` only reports
  `query_graph_ready`/`ingest_graph_ready`, not whether AI providers are
  reachable — check `scripts/logs.sh backend` for FPT AI/Gemini call errors.
- **Browser blocks the API call from the Render page (mixed content /
  CORS):** two separate things to check — (1) if the Render page is
  `https://` and the backend URL is plain `http://`, the browser blocks it
  before CORS is even evaluated; the backend needs to be behind something
  that terminates TLS (see Network, above). (2) If it's a CORS error
  specifically (not mixed content), confirm `CORS_ORIGINS` in
  `/opt/memvid/env/.env` actually names the Render frontend's exact origin
  (or is still `*` during initial testing).
- **HITL pause/resume not surviving a restart:** `deploy.sh` creates
  `/opt/memvid/data/memory/checkpoints.sqlite` automatically, but if it was
  ever created by hand or by an older deploy, confirm it's actually a file,
  not a directory: `docker compose exec backend ls -la /app/checkpoints.sqlite`.
  If it's a directory, `scripts/deploy.sh` (via `ensure_data_layout`) fixes
  it automatically on the next run, but only if the directory is empty —
  a non-empty one makes the script stop and ask a human to look, rather
  than guess.
- **Uploads failing / index not restoring after a redeploy:** check
  `SUPABASE_URL`/`SUPABASE_SECRET_KEY` are actually set — a known-issues
  entry in this repo flagged these as possibly unset on Render at one point;
  confirm they're genuinely populated in `/opt/memvid/env/.env` before
  assuming the app is broken.
