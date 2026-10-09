#!/usr/bin/env bash
# Konferensiya media-serveri (LiveKit, self-hosted) — bir martalik o‘rnatish (root sifatida):
#   sudo HR_DOMAIN=vaksinahr.uz bash deploy/livekit/install.sh
#
# Qayta ishga tushirsa xavfsiz: kalitlar saqlanib qoladi, faqat binar/konfiguratsiya yangilanadi.
set -euo pipefail

HR_DOMAIN="${HR_DOMAIN:?HR_DOMAIN kerak, masalan HR_DOMAIN=vaksinahr.uz}"
APP_DIR="${APP_DIR:-/opt/hr_ai}"
APP_USER="${APP_USER:-hrapp}"
LK_CONF="/etc/livekit.yaml"
LK_KEYS="/root/.livekit-keys"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "root sifatida ishga tushiring (sudo)" >&2
  exit 1
fi

echo "==> LiveKit server binari"
curl -sSL https://get.livekit.io | bash
command -v livekit-server >/dev/null || { echo "livekit-server o‘rnatilmadi" >&2; exit 1; }
livekit-server --version || true

echo "==> Kalitlar"
if [[ ! -f "$LK_KEYS" ]]; then
  {
    echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
    echo "LIVEKIT_API_SECRET=$(openssl rand -hex 32)"
  } > "$LK_KEYS"
  chmod 600 "$LK_KEYS"
fi
# shellcheck disable=SC1090
source "$LK_KEYS"

echo "==> Konfiguratsiya: $LK_CONF"
id livekit >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin livekit
cat > "$LK_CONF" <<CONF
# Signal (WebSocket) — faqat nginx orqali (/livekit/), tashqaridan 7880 yopiq.
port: 7880
log_level: info
rtc:
  # Ovoz/video: UDP 50000-60000, UDP yopiq tarmoqlar uchun TCP 7881
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
room:
  empty_timeout: 900
  departure_timeout: 60
  max_participants: 150
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
CONF
chown root:livekit "$LK_CONF"
chmod 640 "$LK_CONF"

echo "==> UDP buferlari (video uzilmasligi uchun)"
cat > /etc/sysctl.d/90-livekit.conf <<'SYS'
net.core.rmem_max = 5000000
net.core.wmem_max = 5000000
net.core.rmem_default = 1000000
net.core.wmem_default = 1000000
SYS
sysctl --system >/dev/null

echo "==> systemd xizmati"
cat > /etc/systemd/system/livekit.service <<'UNIT'
[Unit]
Description=LiveKit media server (VAKSINA HR konferensiya)
After=network-online.target
Wants=network-online.target

[Service]
User=livekit
Group=livekit
ExecStart=/usr/local/bin/livekit-server --config /etc/livekit.yaml
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable livekit >/dev/null
systemctl restart livekit

echo "==> Firewall: 7881/tcp, 50000-60000/udp"
ufw allow 7881/tcp >/dev/null
ufw allow 50000:60000/udp >/dev/null

echo "==> nginx /livekit/"
install -d /etc/nginx/snippets
cp "$SCRIPT_DIR/nginx-livekit.conf" /etc/nginx/snippets/livekit.conf
NGINX_SITE="/etc/nginx/sites-available/hr.conf"
if [[ -f "$NGINX_SITE" ]] && ! grep -q 'snippets/livekit' "$NGINX_SITE"; then
  cp "$NGINX_SITE" "$NGINX_SITE.bak.$(date +%s)"
  # Har bir server blokiga (HTTP va certbot qo‘shgan HTTPS) /api/ dan oldin qo‘shiladi
  sed -i 's#^\(\s*\)location /api/ {#\1include snippets/livekit.conf;\n\n\1location /api/ {#' "$NGINX_SITE"
fi
nginx -t
systemctl reload nginx

echo "==> Ilova .env: LIVEKIT_*"
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set_env() {
    local key="$1" val="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
      sed -i "s#^${key}=.*#${key}=${val}#" "$ENV_FILE"
    else
      echo "${key}=${val}" >> "$ENV_FILE"
    fi
  }
  set_env LIVEKIT_URL "wss://${HR_DOMAIN}/livekit"
  set_env LIVEKIT_API_KEY "$LIVEKIT_API_KEY"
  set_env LIVEKIT_API_SECRET "$LIVEKIT_API_SECRET"
  set_env LIVEKIT_API_HOST "http://127.0.0.1:7880"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  sudo -iu "$APP_USER" pm2 restart hr-api --update-env >/dev/null 2>&1 || \
    echo "OGOHLANTIRISH: hr-api qayta ishga tushmadi — qo‘lda: sudo -iu $APP_USER pm2 restart hr-api --update-env"
else
  echo "OGOHLANTIRISH: $ENV_FILE topilmadi — LIVEKIT_* qiymatlarini $LK_KEYS dan qo‘lda qo‘shing"
fi

sleep 2
if systemctl is-active --quiet livekit; then
  echo
  echo "=============================================================="
  echo " LiveKit ishlayapti. Tekshirish: curl -s http://127.0.0.1:7880  → OK"
  echo " Loglar: journalctl -u livekit -f"
  echo " Agar hosting panelida (Hetzner/Timeweb va h.k.) alohida firewall bo‘lsa,"
  echo " u yerda ham 7881/tcp va 50000-60000/udp ni oching."
  echo "=============================================================="
else
  echo "XATO: livekit ishga tushmadi — journalctl -u livekit -n 50" >&2
  exit 1
fi
