#!/usr/bin/env bash
# Renew the TLS certificate and reload nginx to pick up the refreshed files.
#
# Uses webroot mode, not standalone: by the time renewal matters, nginx
# already owns :80/:443 permanently, so standalone (bootstrap-tls.sh's
# method) would conflict with it. certbot only requests the ACME challenge
# through the compose stack's own webroot mount — no nginx.conf changes.
#
# Safe to re-run: certbot renew only actually renews when the certificate is
# close to expiry. Meant to run on a schedule — see docs/AWS_DEPLOYMENT.md
# for the crontab line.
#
# Usage: scripts/renew-tls.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

log "checking certificate for renewal (webroot)"
docker run --rm \
  -v "$CERTBOT_CONF_DIR:/etc/letsencrypt" \
  -v "$CERTBOT_WWW_DIR:/var/www/certbot" \
  certbot/certbot renew \
  --webroot -w /var/www/certbot \
  --quiet

log "reloading nginx to pick up any renewed certificate"
compose exec -T nginx nginx -s reload

log "renewal check complete"
