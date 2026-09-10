# AWS EC2 Production Deployment

Runbook for the `docker-compose.prod.yml` stack: nginx (public entrypoint +
TLS) → frontend (static SPA) / backend (Flask/Gunicorn), Supabase Postgres +
Storage kept external, FPT AI + Gemini kept external. No Ollama, no local
embedding/reranker, no Redis, no worker — mirrors `render.yaml`'s production
behavior, not `docker-compose.yml`'s local-model dev defaults.

Background/reasoning lives in `AWS_DEPLOYMENT_PLAN.md` at the repo root — this
document is the operational how-to.

## Directory structure

```
/opt/memvid/
├── app/                                 # git clone of this repo
│   ├── docker-compose.prod.yml
│   ├── docker/nginx.conf
│   └── scripts/*.sh
├── env/
│   └── .env                             # copied from .env.example.aws, filled
│                                         # in, chmod 600 — never in git
├── data/
│   ├── index/                           # FAISS index files
│   ├── memory/                          # jobs/logs/conversations/users sqlite
│   │   └── checkpoints.sqlite           # LangGraph HITL checkpointer — must
│   │                                    # exist as an EMPTY FILE before first
│   │                                    # `docker compose up` (see Deployment)
│   ├── input_docs/                      # staged uploads (durable copy is in
│   │                                    # Supabase Storage; this is scratch)
│   └── certbot/
│       ├── conf/                        # Let's Encrypt certs + account state
│       └── www/                         # HTTP-01 challenge webroot
├── logs/
│   └── nginx/                           # nginx access/error logs
└── backups/                             # created by scripts/backup.sh
```

Not bind-mounted, and deliberately so: `/tmp` inside the backend container.
Werkzeug's transient upload spooling is correctly ephemeral there — it never
needs to survive a restart.

## Environment variables

Template: `.env.example.aws` at the repo root. Copy it to `/opt/memvid/env/.env`,
fill in real values, `chmod 600`. Full classification (required / optional /
Render-only / legacy / unused) is in `AWS_DEPLOYMENT_PLAN.md` §6 — the template
itself only includes what this deployment actually needs: Supabase, FPT AI,
Gemini, auth, gunicorn, CORS. Render-only and dev/test-only variables are
intentionally omitted.

Two things worth double-checking before first boot:

- `OLLAMA_HOST` must be an **empty string**, not merely unset — `llm_factory`
  only drops Ollama from the provider chain when this is literally blank.
- `ALEMBIC_PRODUCTION_HOST` / `ALEMBIC_PRODUCTION_DB` must name the real
  Supabase host/db exactly — the migration guard refuses to run against
  production otherwise (fails closed, by design).

## Deployment

First-time setup, once per server:

```bash
sudo mkdir -p /opt/memvid/{env,data/index,data/memory,data/input_docs,data/certbot/conf,data/certbot/www,logs/nginx,backups}
sudo touch /opt/memvid/data/memory/checkpoints.sqlite
cp /opt/memvid/app/.env.example.aws /opt/memvid/env/.env
# edit /opt/memvid/env/.env with real values
chmod 600 /opt/memvid/env/.env
```

Every deploy (first time and every update) — from `/opt/memvid/app`:

```bash
scripts/deploy.sh
```

This pulls `origin/main`, builds the three images, brings the stack up, and
polls `/health` until the backend responds — see script for exact behavior.

Migrations are not run by `deploy.sh` — run them explicitly, once, before
routing traffic to a new schema version:

```bash
docker compose -f docker-compose.prod.yml --env-file /opt/memvid/env/.env \
  run --rm backend alembic upgrade head
```

## Rollback

```bash
scripts/rollback.sh <git-ref>
```

Requires an explicit commit SHA or tag — no automatic "previous commit"
guessing. Checks out the ref, rebuilds, restarts, waits for `/health`. If
health never returns, the script exits non-zero but leaves the ref checked
out — re-run `rollback.sh` with a known-good ref to recover, or investigate
with `scripts/logs.sh backend`.

Rollback only reverts code/images. A migration that ran forward before the
rollback is not automatically reversed — check `alembic history` if the
rollback target predates a schema change.

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

Same as Deployment — `scripts/deploy.sh` is the update path (git pull, build,
up, health-wait). No separate "update" script; a fresh deploy of the same
running version is a no-op beyond the git pull finding nothing new.

## Health check

```bash
scripts/health.sh
```

Checks all three services independently (backend `/health` inside the
container, frontend `:3000/`, nginx `/healthz`) and exits non-zero if any
fail. `compose ps` output is printed either way.

External uptime monitoring should hit `https://yourdomain.com/healthz`
(served directly by the nginx container, no backend round-trip) or
`https://yourdomain.com/api/health` (proxied through to the backend — use
this one if you want the check to prove the whole chain, not just nginx).

## Troubleshooting

- **A service won't start:** `scripts/logs.sh <service>` — `nginx`,
  `frontend`, or `backend`.
- **Backend healthy per Docker but app is broken:** `/health` only reports
  `query_graph_ready`/`ingest_graph_ready`, not whether AI providers are
  reachable — check `scripts/logs.sh backend` for FPT AI/Gemini call errors.
- **502/504 from nginx:** usually the backend container is still starting
  (`start_period: 15s` in the healthcheck) or a `GUNICORN_TIMEOUT` mismatch —
  confirm `.env` actually sets `GUNICORN_TIMEOUT=120` and that nginx's own
  `/api/` proxy timeouts (300s) are longer than gunicorn's.
- **HITL pause/resume not surviving a restart:** confirm
  `/opt/memvid/data/memory/checkpoints.sqlite` exists as a file (not a
  directory Docker auto-created) and is actually bind-mounted — check
  `docker inspect memvid_backend` for the mount, or `docker compose exec
  backend ls -la /app/checkpoints.sqlite`.
- **Certbot renewal fails:** confirm `/opt/memvid/data/certbot/www` is
  writable by whatever process runs certbot and matches the webroot nginx
  serves at `/.well-known/acme-challenge/` on port 80 — cert issuance and
  the app's own nginx container must agree on this path.
- **Uploads failing / index not restoring after a redeploy:** check
  `SUPABASE_URL`/`SUPABASE_SECRET_KEY` are actually set — a known-issues
  entry in this repo flagged these as possibly unset on Render at one point;
  confirm they're genuinely populated in `/opt/memvid/env/.env` before
  assuming the app is broken.
