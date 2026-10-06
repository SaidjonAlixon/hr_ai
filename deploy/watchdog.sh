#!/usr/bin/env bash
# API osilib qolsa (jarayon tirik, lekin javob bermaydi) — qayta ishga tushirish.
# pm2 yiqilgan jarayonni o‘zi ko‘taradi; bu skript faqat «qotib qolgan» holat uchun.
# cron (hrapp):  */2 * * * * /opt/hr_ai/deploy/watchdog.sh >> /var/log/hr-watchdog.log 2>&1
set -uo pipefail

check() {
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8080/api/healthz)" == "200" ]]
}

check && exit 0
sleep 15
check && exit 0

echo "[$(date -Is)] healthz javob bermadi — hr-api qayta ishga tushirilmoqda"
pm2 restart hr-api --update-env >/dev/null 2>&1 || pm2 start /opt/hr_ai/deploy/ecosystem.config.cjs
sleep 10
check && echo "[$(date -Is)] tiklandi" || echo "[$(date -Is)] HALI HAM ISHLAMAYAPTI — pm2 logs hr-api"
