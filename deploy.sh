#!/usr/bin/env bash
#
# Production deploy for wanderingloyalty.com
# (Cloudways / DigitalOcean, "Moon Whale Media" server). Symfony 8.1, a static
# band site + contact mailer — no database. GitHub is the source of truth; this
# refuses to deploy anything not committed and pushed.
#
# Usage:
#   ./deploy.sh                 # sync + remote composer/cache steps
#   SKIP_REMOTE=1 ./deploy.sh   # sync files only
#
set -euo pipefail

SSH_HOST="cloudways"
REMOTE_ROOT="/home/master/applications/fqwftxndwn/public_html"   # Cloudways app "wandering-loyalty"
REMOTE_PHP="php8.4"                                              # Symfony 8.1 requires PHP >= 8.4.1
REMOTE_COMPOSER="/usr/local/bin/composer"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
STAGING_URL="phpstack-1647922-6571861.cloudwaysapps.com"        # Cloudways staging host (OPcache reset)

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mDEPLOY ABORTED: %s\033[0m\n' "$*" >&2; exit 1; }

reset_opcache() {
  say "Resetting OPcache"
  ssh "$SSH_HOST" "printf '%s' '<?php if(function_exists(\"opcache_reset\"))opcache_reset();' > '$REMOTE_ROOT/public/_ocreset.php'"
  curl -sk -m 15 "https://$STAGING_URL/_ocreset.php" >/dev/null 2>&1 || true
  ssh "$SSH_HOST" "rm -f '$REMOTE_ROOT/public/_ocreset.php'"
}

# --- 1. Safety guards ---------------------------------------------------------
say "Verifying git state"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "$DEPLOY_BRANCH" ] || die "on branch '$branch', expected '$DEPLOY_BRANCH'"
[ -z "$(git status --porcelain)" ] || die "uncommitted changes — commit & push first"
git fetch -q origin "$DEPLOY_BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$DEPLOY_BRANCH")" ] \
  || die "local $DEPLOY_BRANCH != origin/$DEPLOY_BRANCH — push (or pull) before deploying"
echo "$DEPLOY_BRANCH @ $(git rev-parse --short HEAD) — clean and pushed"

# --- 2. Sync code -------------------------------------------------------------
say "Rsyncing to $SSH_HOST:$REMOTE_ROOT"
rsync -az --omit-dir-times --no-perms --no-owner --no-group --human-readable --delete \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.idea' \
  --exclude 'node_modules' \
  --exclude 'vendor' \
  --exclude '/var/' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude '.DS_Store' \
  --exclude 'tests' \
  ./ "$SSH_HOST:$REMOTE_ROOT/"

say "Normalizing public/ permissions on server"
ssh "$SSH_HOST" "chmod -R a+rX '$REMOTE_ROOT/public' 2>/dev/null || true"

if [ "${SKIP_REMOTE:-0}" = "1" ]; then
  reset_opcache
  say "SKIP_REMOTE=1 — files synced, skipping remote steps"
  exit 0
fi

# --- 3. First-deploy guard: server must have a prod .env.local ----------------
if ! ssh "$SSH_HOST" "test -f '$REMOTE_ROOT/.env.local'"; then
  die "no .env.local on server — create it (APP_ENV=prod, APP_SECRET, MAILER_DSN, CONTACT_*, TURNSTILE_*)"
fi

# --- 4. Remote: deps + prod cache ---------------------------------------------
say "Running remote composer install + cache warm"
ssh "$SSH_HOST" "REMOTE_ROOT='$REMOTE_ROOT' REMOTE_PHP='$REMOTE_PHP' REMOTE_COMPOSER='$REMOTE_COMPOSER' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_ROOT"
APP_ENV=prod "$REMOTE_PHP" "$REMOTE_COMPOSER" install --no-dev --optimize-autoloader --no-interaction --no-progress
"$REMOTE_PHP" bin/console cache:clear  --env=prod --no-debug
"$REMOTE_PHP" bin/console cache:warmup --env=prod --no-debug
echo "remote deploy steps complete"
REMOTE

reset_opcache

say "Deploy complete — $DEPLOY_BRANCH @ $(git rev-parse --short HEAD) live"
