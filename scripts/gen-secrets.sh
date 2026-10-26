#!/usr/bin/env sh
# Creates .env from .env.example (if missing) and fills in fresh secrets.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
key=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
session=$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')
minio=$(head -c 24 /dev/urandom | base64 | tr -d '\n=+/')
tmp=$(mktemp)
sed -e "s|^OPENRENT_ENCRYPTION_KEY=.*$|OPENRENT_ENCRYPTION_KEY=$key|" -e "s|^OPENRENT_SESSION_SECRET=.*$|OPENRENT_SESSION_SECRET=$session|" .env > "$tmp"
mv "$tmp" .env
# Only fill MinIO's password once: changing it later locks the stored files out.
grep -q '^MINIO_ROOT_PASSWORD=.\+' .env || { grep -v '^MINIO_ROOT_PASSWORD=' .env > "$tmp"; echo "MINIO_ROOT_PASSWORD=$minio" >> "$tmp"; mv "$tmp" .env; }
echo "Wrote secrets to .env. Keep OPENRENT_ENCRYPTION_KEY safe: provider credentials are encrypted with it."
