#!/bin/bash
set -euo pipefail
LOCK=/tmp/said-call-retry.lock
exec 9>"$LOCK"
flock -n 9 || exit 0
MARK=/tmp/said-call-authorized.ok
FAIL=/tmp/said-call-retry.count
[ -f "$MARK" ] && exit 0
n=$(cat "$FAIL" 2>/dev/null || echo 0)
if [ "$n" -ge 20 ]; then exit 0; fi
echo $((n+1)) > "$FAIL"
# Skip auth notice spam after first runs
export SKIP_AUTH_NOTICE=1
if [ "$n" -ge 1 ]; then
  export SKIP_AUTH_NOTICE=1
fi
node /opt/hr_ai/tmp-place-said-telegram-call.mjs && touch "$MARK"
