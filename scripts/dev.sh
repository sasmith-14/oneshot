#!/usr/bin/env bash
# Run the whole stack locally: fake provider (:8701), OneShot API (:8700), one worker.
# Ctrl-C stops all three. State lives in ./var (delete it to start fresh).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p var
export ONESHOT_DB="${ONESHOT_DB:-var/oneshot.db}" ONESHOT_PROVIDER_URL="${ONESHOT_PROVIDER_URL:-http://127.0.0.1:8701}"
trap 'trap - EXIT; kill 0' INT TERM EXIT
uv run fakeprovider --port 8701 --db var/provider.db &
uv run oneshot serve --port 8700 &
sleep 1
uv run oneshot worker &
echo "OneShot API: http://127.0.0.1:8700/docs   provider: http://127.0.0.1:8701   (Ctrl-C to stop)"
wait
