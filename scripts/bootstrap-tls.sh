#!/usr/bin/env bash
# One-time TLS certificate bootstrap — breaks the nginx startup deadlock.
#
# docker/nginx.conf requires a certificate to already exist at
# /etc/letsencrypt/live/memvid/{fullchain,privkey}.pem before the nginx
# process will start at all (a missing ssl_certificate file is a fatal
# config-load error, not a soft failure). But the normal ACME webroot
# challenge needs nginx already running on :80 to serve it — so on a brand
# new server, nginx can never start, which means it can never obtain the
# cert it needs to start. Chicken-and-egg.
#
# Fix: get the FIRST certificate with certbot's standalone mode — its own
# temporary listener on :80, completely independent of the compose stack —
# so nginx is never asked to start without a cert already in place. No
# nginx.conf edits, ever: --cert-name memvid keeps the on-disk path fixed
# regardless of which domain is configured.
#
# Idempotent: does nothing if a certificate already exists. Called
# automatically by deploy.sh before `compose up`; safe to run standalone too.
#
# Renewal afterwards uses scripts/renew-tls.sh (webroot method — nginx owns
# :80 by then, so standalone would conflict with it).
#
# Usage: scripts/bootstrap-tls.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

CERT_PATH="$CERTBOT_CONF_DIR/live/$CERT_NAME/fullchain.pem"

if [ -f "$CERT_PATH" ]; then
  log "certificate already exists at $CERT_PATH — skipping bootstrap"
  exit 0
fi

require_env_file
DOMAIN="$(env_value CERTBOT_DOMAIN)"
EMAIL="$(env_value CERTBOT_EMAIL)"
[ -n "$DOMAIN" ] || die "CERTBOT_DOMAIN not set in $ENV_FILE"
[ -n "$EMAIL" ]  || die "CERTBOT_EMAIL not set in $ENV_FILE"

mkdir -p "$CERTBOT_CONF_DIR" "$CERTBOT_WWW_DIR"

# Free :80 in case a previous half-finished deploy left nginx running.
if compose ps nginx 2>/dev/null | grep -q .; then
  log "stopping nginx to free :80 for standalone issuance"
  compose stop nginx || true
fi

log "requesting certificate for $DOMAIN (cert-name=$CERT_NAME) via standalone mode"
docker run --rm \
  -p 80:80 \
  -v "$CERTBOT_CONF_DIR:/etc/letsencrypt" \
  -v "$CERTBOT_WWW_DIR:/var/www/certbot" \
  certbot/certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  -m "$EMAIL" \
  --cert-name "$CERT_NAME" \
  -d "$DOMAIN"

[ -f "$CERT_PATH" ] || die "certbot reported success but $CERT_PATH is still missing"
log "certificate obtained: $CERT_PATH"
