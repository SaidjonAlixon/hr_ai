#!/usr/bin/env bash
# Neon → lokal Postgres to‘liq nusxa (lokal baza ustidan yoziladi, Neon faqat o‘qiladi).
#   sudo -iu hrapp NEON_URL='postgresql://...neon.tech/neondb?sslmode=require' bash /opt/hr_ai/deploy/migrate-from-neon.sh
# NEON_URL — Direct (hostda "-pooler" yo‘q) connection string.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEON_URL="${NEON_URL:?NEON_URL kerak}"
LOCAL_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -n1 | cut -d= -f2- | tr -d "\"'")"
LOCAL_URL="${LOCAL_URL%%\?*}"
DUMP="/tmp/neon-$(date +%Y%m%d-%H%M).dump"

echo "==> Neon dump"
time pg_dump --format=custom --no-owner --no-acl -f "$DUMP" "$NEON_URL"
ls -lh "$DUMP"

echo "==> Lokal bazaga tiklash"
pg_restore --clean --if-exists --no-owner --no-acl -d "$LOCAL_URL" "$DUMP" 2>&1 | grep -v -E 'neon_superuser|^$' | tail -n 10 || true

echo "==> Solishtirish (Neon / lokal)"
for t in users employees attendance_records face_profiles notifications; do
  a="$(psql "$NEON_URL" -tAc "select count(*) from $t" 2>/dev/null || echo '-')"
  b="$(psql "$LOCAL_URL" -tAc "select count(*) from $t" 2>/dev/null || echo '-')"
  printf '  %-22s neon=%-8s local=%-8s %s\n' "$t" "$a" "$b" "$([[ "$a" == "$b" ]] && echo OK || echo FARQ)"
done
psql "$LOCAL_URL" -tAc "select 'lokal baza hajmi: ' || pg_size_pretty(pg_database_size(current_database()))"
rm -f "$DUMP"
