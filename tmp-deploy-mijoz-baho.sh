#!/usr/bin/env bash
set -euo pipefail
cd /opt/hr_ai

echo "==> git pull (agar remote bog'langan bo'lsa)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git fetch --all --prune || true
  git reset --hard origin/main || true
fi

echo "==> API build"
node ./artifacts/api-server/build.mjs

echo "==> Frontend build"
FRONT_DIR="artifacts/vaksina-hr/dist"
rm -rf "$FRONT_DIR/public.next"
NODE_ENV=production pnpm exec vite build \
  --config ./artifacts/vaksina-hr/vite.config.ts \
  --outDir "/opt/hr_ai/$FRONT_DIR/public.next" \
  --emptyOutDir

echo "==> Frontend swap"
rm -rf "$FRONT_DIR/public.prev"
if [[ -d "$FRONT_DIR/public" ]]; then
  mv "$FRONT_DIR/public" "$FRONT_DIR/public.prev"
fi
mv "$FRONT_DIR/public.next" "$FRONT_DIR/public"

echo "==> pm2 restart (clean port 8080)"
# reload ba'zan eski node ni 8080 da qoldiradi → yangi jarayon EADDRINUSE + 404
if pm2 describe hr-api >/dev/null 2>&1; then
  pm2 stop hr-api || true
fi
sleep 1
fuser -k 8080/tcp 2>/dev/null || true
sleep 1
cd /opt/hr_ai
pm2 start deploy/ecosystem.config.cjs --update-env
pm2 save >/dev/null

echo "==> healthz"
for i in $(seq 1 25); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/healthz || true)"
  if [[ "$code" == "200" ]]; then
    echo "OK healthz 200"
    exit 0
  fi
  sleep 1
done
echo "WARN: healthz not ready" >&2
exit 1
