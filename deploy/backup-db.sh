#!/usr/bin/env bash
# Zaxira: Postgres dump + yuklangan fayllar + .env (maxfiy kalitlar).
# cron (hrapp):  15 */6 * * * /opt/hr_ai/deploy/backup-db.sh >> /var/log/hr-backup.log 2>&1
# Tiklash:       pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" /var/backups/hr/db-YYYYMMDD-HHMM.dump
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hr}"
KEEP_DAYS="${KEEP_DAYS:-14}"
KEEP_WEEKLY_DAYS="${KEEP_WEEKLY_DAYS:-90}"
STAMP="$(date +%Y%m%d-%H%M)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -n1 | cut -d= -f2- | tr -d "\"'")"
fi
if [[ -z "$DATABASE_URL" ]]; then
  echo "XATO: DATABASE_URL topilmadi" >&2
  exit 1
fi
# pg_dump `sslmode=disable` dan boshqa noma’lum parametrlarni yoqtirmaydi
DUMP_URL="${DATABASE_URL%%\?*}"

umask 077
mkdir -p "$BACKUP_DIR/weekly"
chmod 700 "$BACKUP_DIR"

echo "[$(date -Is)] DB dump boshlandi"
pg_dump --format=custom --compress=6 --no-owner --file "$BACKUP_DIR/db-$STAMP.dump.part" "$DUMP_URL"
# Buzilgan dump saqlanmasin — ro‘yxatini o‘qib ko‘ramiz
pg_restore --list "$BACKUP_DIR/db-$STAMP.dump.part" >/dev/null
mv "$BACKUP_DIR/db-$STAMP.dump.part" "$BACKUP_DIR/db-$STAMP.dump"
echo "[$(date -Is)] DB dump: $(du -h "$BACKUP_DIR/db-$STAMP.dump" | cut -f1)"

UPLOADS="$APP_DIR/artifacts/api-server/uploads"
if [[ -d "$UPLOADS" ]] && [[ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" uploads
  echo "[$(date -Is)] uploads: $(du -h "$BACKUP_DIR/uploads-$STAMP.tar.gz" | cut -f1)"
fi

cp "$APP_DIR/.env" "$BACKUP_DIR/env-latest"

# Yakshanba kungi birinchi nusxa — uzoq muddatga
if [[ "$(date +%u)" == "7" ]] && ! ls "$BACKUP_DIR/weekly/db-$(date +%Y%m%d)"-*.dump >/dev/null 2>&1; then
  cp "$BACKUP_DIR/db-$STAMP.dump" "$BACKUP_DIR/weekly/"
  [[ -f "$BACKUP_DIR/uploads-$STAMP.tar.gz" ]] && cp "$BACKUP_DIR/uploads-$STAMP.tar.gz" "$BACKUP_DIR/weekly/"
  echo "[$(date -Is)] haftalik nusxa saqlandi"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR/weekly" -type f -mtime +"$KEEP_WEEKLY_DAYS" -delete

# Ixtiyoriy: serverdan tashqariga nusxa (server yo‘qolsa ham zaxira qoladi)
if [[ -n "${BACKUP_RSYNC_TARGET:-}" ]]; then
  rsync -a "$BACKUP_DIR/" "$BACKUP_RSYNC_TARGET"
  echo "[$(date -Is)] tashqi nusxa: $BACKUP_RSYNC_TARGET"
fi

echo "[$(date -Is)] tayyor ($(df -h "$BACKUP_DIR" | awk 'NR==2{print $4}') bo‘sh joy)"
