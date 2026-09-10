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
│   │   └── checkpoints.sqlite           # LangGraph HITL checkpointer —
│   │                                    # scripts/deploy.sh (via
│   │                                    # ensure_data_layout in _lib.sh)
│   │                                    # creates this as an empty FILE
│   │                                    # automatically if it's missing, and
│   │                                    # self-heals if Docker previously
│   │                                    # auto-created it as an empty
│   │                                    # directory — no manual step needed
│   ├── input_docs/                      # staged uploads (durable copy is in
│   │                                    # Supabase Storage; this is scratch)
│   └── certbot/
│       ├── conf/                        # Let's Encrypt certs + account state
│       │                                # (see TLS bootstrap, below)
│       └── www/                         # HTTP-01 challenge webroot (renewal only)
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

`scripts/deploy.sh` validates every variable in `_lib.sh`'s `REQUIRED_ENV_VARS`
list is present and non-empty **before** it builds anything — a missing
secret fails the deploy immediately instead of failing partway through a
build or, worse, after containers are already up. Run the same check on its
own with `scripts/validate-env.sh`.

Two things worth double-checking before first boot:

- `OLLAMA_HOST` must be an **empty string**, not merely unset — `llm_factory`
  only drops Ollama from the provider chain when this is literally blank.
- `ALEMBIC_PRODUCTION_HOST` / `ALEMBIC_PRODUCTION_DB` must name the real
  Supabase host/db exactly — the migration guard refuses to run against
  production otherwise (fails closed, by design).
- `CERTBOT_DOMAIN` must match whatever `VITE_API_BASE` points at, and
  `CERTBOT_EMAIL` must be a real, reachable address — Let's Encrypt sends
  expiry warnings there if renewal ever starts failing.

## Deployment

First-time setup, once per server — just enough for `deploy.sh` to take over
from here (it creates every data directory and file itself):

```bash
sudo mkdir -p /opt/memvid/env
sudo chown "$USER":"$USER" /opt/memvid
cp /opt/memvid/app/.env.example.aws /opt/memvid/env/.env
# edit /opt/memvid/env/.env with real values, including CERTBOT_DOMAIN/CERTBOT_EMAIL
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
4. **Build** the three images.
5. **Migrate** — `alembic upgrade head` runs as part of every deploy, not as
   a separate manual step. Safe to re-run: it no-ops when the schema is
   already current.
6. **TLS bootstrap** — `scripts/bootstrap-tls.sh` runs automatically,
   idempotent (does nothing once a certificate exists). See TLS bootstrap
   below for what it actually does on a brand new server.
7. **Start** the stack (`compose up -d`).
8. **Health checks** — backend, frontend, and nginx checked independently
   (`scripts/health.sh`); the deploy fails (non-zero exit) if any one of
   them is unhealthy, even if the other two are fine.

## TLS bootstrap

`docker/nginx.conf` requires a certificate to already exist on disk before
nginx will even start — a missing `ssl_certificate` file is a fatal
config-load error for the whole process, not just the HTTPS server block.
That's a problem on a brand new server: the normal way to get a certificate
(ACME HTTP-01 challenge over webroot) needs nginx already running on `:80`
to serve it.

`scripts/bootstrap-tls.sh` breaks that deadlock: on a server with no
certificate yet, it runs `certbot certonly --standalone` — certbot's own
temporary listener on `:80`, entirely separate from the compose stack — so
nginx is never asked to start without a certificate already in place.
`--cert-name memvid` pins the on-disk path to exactly what `docker/nginx.conf`
expects (`/etc/letsencrypt/live/memvid/...`), regardless of which domain
`CERTBOT_DOMAIN` names — so a future domain change never requires editing
`docker/nginx.conf`.

This runs automatically as step 6 of `scripts/deploy.sh` and is a no-op once
a certificate exists — safe on every subsequent deploy.

**Renewal** is a different script, `scripts/renew-tls.sh`, because it needs
a different method: by the time renewal matters, nginx already owns `:80`
permanently, so standalone mode would conflict with it. Renewal uses webroot
mode instead (nginx already serves `/.well-known/acme-challenge/` from
`data/certbot/www`, unchanged from the original nginx.conf), then reloads
nginx to pick up the refreshed files. Not run automatically — schedule it,
e.g. via crontab:

```
0 3 * * 1 cd /opt/memvid/app && scripts/renew-tls.sh >> /opt/memvid/logs/renew-tls.log 2>&1
```

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
- **HITL pause/resume not surviving a restart:** `deploy.sh` creates
  `/opt/memvid/data/memory/checkpoints.sqlite` automatically, but if it was
  ever created by hand or by an older deploy, confirm it's actually a file,
  not a directory: `docker compose exec backend ls -la /app/checkpoints.sqlite`.
  If it's a directory, `scripts/deploy.sh` (via `ensure_data_layout`) fixes
  it automatically on the next run, but only if the directory is empty —
  a non-empty one makes the script stop and ask a human to look, rather
  than guess.
- **Nginx won't start on a brand new server:** almost certainly the TLS
  bootstrap didn't run or failed — check `scripts/logs.sh nginx` for a
  `cannot load certificate` error, then run `scripts/bootstrap-tls.sh`
  directly to see the certbot output (it's swallowed inside `deploy.sh`'s
  step 6 otherwise). Common causes: `CERTBOT_DOMAIN` doesn't actually point
  at this server's IP yet (DNS not propagated), or port 80 wasn't reachable
  from the internet when certbot's standalone listener tried to bind it
  (check the security group).
- **Certbot renewal fails:** confirm `/opt/memvid/data/certbot/www` is
  writable by whatever process runs `scripts/renew-tls.sh` and matches the
  webroot nginx serves at `/.well-known/acme-challenge/` on port 80 — cert
  issuance and the app's own nginx container must agree on this path. Renewal
  uses webroot mode, not standalone (see TLS bootstrap) — if it's failing
  with a port-80-in-use error, something is trying to use standalone mode
  again, which conflicts with nginx already running.
- **Uploads failing / index not restoring after a redeploy:** check
  `SUPABASE_URL`/`SUPABASE_SECRET_KEY` are actually set — a known-issues
  entry in this repo flagged these as possibly unset on Render at one point;
  confirm they're genuinely populated in `/opt/memvid/env/.env` before
  assuming the app is broken.
