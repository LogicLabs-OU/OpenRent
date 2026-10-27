#!/usr/bin/env sh
# Creates .env from .env.example (if missing) and fills in fresh secrets.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
tmp=$(mktemp)
# Each secret is filled once and kept on later runs: a new encryption key would make every stored
# provider credential unreadable, a new MinIO password would lock the stored files out.
fill() {
  grep -q "^$1=.\+" .env && return 0
  grep -v "^$1=" .env > "$tmp" || true
  echo "$1=$2" >> "$tmp"
  mv "$tmp" .env
}
fill OPENRENT_ENCRYPTION_KEY "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
fill OPENRENT_SESSION_SECRET "$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')"
fill MINIO_ROOT_PASSWORD "$(head -c 24 /dev/urandom | base64 | tr -d '\n=+/')"
echo "Secrets are in .env (existing ones were kept). Keep OPENRENT_ENCRYPTION_KEY safe: provider credentials are encrypted with it."
