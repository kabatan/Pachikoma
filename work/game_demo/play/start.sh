#!/bin/sh
# 遊ぶための起動: ./work/game_demo/play/start.sh [ポート=8800]  → ブラウザで表示されるURLを開く
cd "$(dirname "$0")/../../.." || exit 1
PORT="${1:-8800}"
echo "http://127.0.0.1:$PORT/game_demo/play/index.html  (Ctrl+C で停止)"
exec node work/game_demo/play/serve.mjs "$PORT"
