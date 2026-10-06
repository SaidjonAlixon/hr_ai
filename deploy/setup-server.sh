#!/usr/bin/env bash
# Toza Ubuntu 24.04 serverni bir martalik tayyorlash (root sifatida):
#   curl -fsSL https://raw.githubusercontent.com/SaidjonAlixon/hr_ai/main/deploy/setup-server.sh -o setup.sh
#   sudo HR_DOMAIN=hr.example.uz CERT_EMAIL=admin@example.uz bash setup.sh
#
# Qayta ishga tushirsa xavfsiz (mavjud narsalarni buzmaydi).
set -euo pipefail

HR_DOMAIN="${HR_DOMAIN:?HR_DOMAIN kerak, masalan HR_DOMAIN=hr.example.uz}"
CERT_EMAIL="${CERT_EMAIL:-}"
REPO_URL="${REPO_URL:-https://github.com/SaidjonAlixon/hr_ai.git}"
APP_DIR="${APP_DIR:-/opt/hr_ai}"
APP_USER="${APP_USER:-hrapp}"
DB_NAME="${DB_NAME:-hr}"
DB_USER="${DB_USER:-hr}"

if [[ $EUID -ne 0 ]]; then
  echo "root sifatida ishga tushiring (sudo)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Paketlar"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ca-certificates gnupg ufw fail2ban nginx \
  certbot python3-certbot-nginx \
  unattended-upgrades qemu-guest-agent rsync build-essential

# PG_MAJOR=17 — Neon’dagi versiya bilan bir xil bo‘lsin (Neon SQL: SELECT version();)
PG_MAJOR="${PG_MAJOR:-}"
if [[ -n "$PG_MAJOR" ]]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y "postgresql-$PG_MAJOR" "postgresql-client-$PG_MAJOR"
else
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable --now qemu-guest-agent || true
timedatectl set-timezone Asia/Tashkent

echo "==> Node.js 24 + pnpm + pm2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm@10.15.1 pm2

echo "==> Swap (build paytida xotira yetishmasin)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Firewall: faqat SSH, HTTP, HTTPS"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
systemctl enable --now fail2ban

echo "==> Ilova foydalanuvchisi: $APP_USER"
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"

echo "==> PostgreSQL"
PG_VER="$(ls /etc/postgresql | sort -V | tail -n1)"
PG_CONF_D="/etc/postgresql/$PG_VER/main/conf.d"
mkdir -p "$PG_CONF_D"
cat > "$PG_CONF_D/hr-tuning.conf" <<'CONF'
# 4 vCPU / 8 GB RAM uchun
listen_addresses = 'localhost'
max_connections = 100
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 512MB
work_mem = 16MB
wal_buffers = 16MB
random_page_cost = 1.1
effective_io_concurrency = 200
checkpoint_completion_target = 0.9
max_wal_size = 2GB
log_min_duration_statement = 1000
timezone = 'Asia/Tashkent'
CONF
systemctl restart postgresql

DB_PASS_FILE="/root/.hr-db-password"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  DB_PASS="$(openssl rand -hex 24)"
  echo "$DB_PASS" > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
DB_PASS="$(cat "$DB_PASS_FILE" 2>/dev/null || true)"

echo "==> Kod: $APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/deploy/vps.env.example" "$APP_DIR/.env"
  if [[ -n "$DB_PASS" ]]; then
    sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?sslmode=disable#" "$APP_DIR/.env"
  fi
  sed -i "s#^PUBLIC_APP_URL=.*#PUBLIC_APP_URL=https://$HR_DOMAIN#" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo "==> nginx"
# Mavjud konfiguratsiyaga tegilmaydi — unda certbot qo‘shgan HTTPS bloklari bor
if [[ ! -f /etc/nginx/sites-available/hr.conf ]]; then
  sed -e "s#HR_DOMAIN#$HR_DOMAIN#g" -e "s#APP_DIR#$APP_DIR#g" \
    "$APP_DIR/deploy/nginx/hr.conf" > /etc/nginx/sites-available/hr.conf
fi
ln -sf /etc/nginx/sites-available/hr.conf /etc/nginx/sites-enabled/hr.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
# nginx statik fayllarni o‘qiy olishi uchun
chmod o+x "$(dirname "$APP_DIR")" "$APP_DIR"

if [[ -n "$CERT_EMAIL" ]]; then
  echo "==> HTTPS (Let's Encrypt)"
  certbot --nginx -d "$HR_DOMAIN" --redirect --agree-tos -m "$CERT_EMAIL" -n || \
    echo "OGOHLANTIRISH: certbot muvaffaqiyatsiz — DNS A yozuvi shu serverga qaraganini tekshirib, qayta ishga tushiring"
fi

echo "==> pm2 avtomatik ishga tushish"
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

echo "==> pm2 log aylanishi (disk to‘lmasin)"
sudo -iu "$APP_USER" pm2 install pm2-logrotate >/dev/null
sudo -iu "$APP_USER" pm2 set pm2-logrotate:max_size 20M >/dev/null
sudo -iu "$APP_USER" pm2 set pm2-logrotate:retain 14 >/dev/null
sudo -iu "$APP_USER" pm2 set pm2-logrotate:compress true >/dev/null

echo "==> Zaxira (har 6 soatda) va watchdog (har 2 daqiqada)"
mkdir -p /var/backups/hr
chown "$APP_USER:$APP_USER" /var/backups/hr
chmod 700 /var/backups/hr
for f in /var/log/hr-backup.log /var/log/hr-watchdog.log; do
  touch "$f"
  chown "$APP_USER:$APP_USER" "$f"
done
cat > /etc/logrotate.d/hr <<'ROT'
/var/log/hr-backup.log /var/log/hr-watchdog.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
ROT
{
  crontab -u "$APP_USER" -l 2>/dev/null | grep -vE 'backup-db.sh|watchdog.sh' || true
  echo "15 */6 * * * $APP_DIR/deploy/backup-db.sh >> /var/log/hr-backup.log 2>&1"
  echo "*/2 * * * * $APP_DIR/deploy/watchdog.sh >> /var/log/hr-watchdog.log 2>&1"
} | crontab -u "$APP_USER" -

cat <<DONE

==============================================================
 Server tayyor.
 Keyingi qadamlar (VPS.md da batafsil):
   1) $APP_DIR/.env ni to‘ldiring (Vercel’dagi kalitlar):  nano $APP_DIR/.env
   2) Neon’dan ma’lumotni ko‘chiring (VPS.md, 4-bo‘lim)
   3) Ishga tushiring:  sudo -iu $APP_USER bash $APP_DIR/deploy/deploy.sh
 DB parol: $DB_PASS_FILE
==============================================================
DONE
