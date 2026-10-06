#!/usr/bin/env bash
# Yangi kodni serverga chiqarish:  bash deploy/deploy.sh
# Git'dan oxirgi main → build → frontend almashtirish → API qayta ishga tushirish.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${DEPLOY_BRANCH:-main}"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "XATO: $APP_DIR/.env topilmadi (deploy/vps.env.example dan nusxa oling)" >&2
  exit 1
fi

echo "==> Git: $BRANCH"
# GitHub’ga ulanish ba’zan uziladi — 3 marta urinamiz
for i in 1 2 3; do
  timeout 90 git fetch --prune origin && break
  [[ $i == 3 ]] && { echo "XATO: GitHub’dan kod olinmadi" >&2; exit 1; }
  echo "    qayta urinish ($i)..."
  sleep 5
done
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "    commit: $(git log --oneline -1)"

echo "==> pnpm install"
pnpm install --frozen-lockfile --prod=false || pnpm install --no-frozen-lockfile --prod=false

echo "==> Frontend build (eski versiya build tugaguncha ishlab turadi)"
FRONT_DIR="artifacts/vaksina-hr/dist"
rm -rf "$FRONT_DIR/public.next"
NODE_ENV=production pnpm exec vite build \
  --config ./artifacts/vaksina-hr/vite.config.ts \
  --outDir "$APP_DIR/$FRONT_DIR/public.next" \
  --emptyOutDir

echo "==> API build"
node ./artifacts/api-server/build.mjs

echo "==> Frontendni almashtirish"
rm -rf "$FRONT_DIR/public.prev"
if [[ -d "$FRONT_DIR/public" ]]; then
  mv "$FRONT_DIR/public" "$FRONT_DIR/public.prev"
fi
mv "$FRONT_DIR/public.next" "$FRONT_DIR/public"

echo "==> API qayta ishga tushirish"
if pm2 describe hr-api >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save >/dev/null

echo "==> Tekshiruv"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/healthz || true)"
  if [[ "$code" == "200" ]]; then
    echo "    API ishlayapti (healthz 200)"
    exit 0
  fi
  sleep 1
done
echo "OGOHLANTIRISH: API 20 soniyada javob bermadi — pm2 logs hr-api --lines 100" >&2
exit 1
