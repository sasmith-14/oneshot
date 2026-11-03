#!/usr/bin/env bash
# Run the whole stack locally: fake provider (:8701), OneShot API (:8700), one worker,
# and the web console's dev server (:5173, hot reload) if its dependencies are installed.
# Ctrl-C stops everything. State lives in ./var (delete it to start fresh).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p var
export ONESHOT_DB="${ONESHOT_DB:-var/oneshot.db}" ONESHOT_PROVIDER_URL="${ONESHOT_PROVIDER_URL:-http://127.0.0.1:8701}"
# Lab mode turns on the console's chaos/process-control routes. Local development only.
export ONESHOT_LAB="${ONESHOT_LAB:-1}"
trap 'trap - EXIT; kill 0' INT TERM EXIT
uv run fakeprovider --port 8701 --db var/provider.db &
uv run oneshot serve --port 8700 &
sleep 1
uv run oneshot worker &
if [ -d web/node_modules ]; then
  (cd web && npm run dev -- --clearScreen false) &
  echo "Web console (dev, hot reload): http://127.0.0.1:5173/ui/"
else
  echo "Web console: run 'make web-install' once for the dev server, or 'make web-build' to serve it at :8700/ui/"
fi
echo "OneShot API: http://127.0.0.1:8700/docs   console (built): http://127.0.0.1:8700/ui/   provider: http://127.0.0.1:8701   (Ctrl-C to stop)"
wait
