#!/bin/bash
# Double-click in Finder to start Tutorise HQ and open it in your browser.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install it from https://nodejs.org or with: brew install node"
  read -r -p "Press Enter to close…"; exit 1
fi
[ -d node_modules ] || npm install --omit=dev
PORT="${PORT:-4747}"
if curl -s -o /dev/null "http://localhost:$PORT/api/auth/status"; then
  open "http://localhost:$PORT"; exit 0
fi
(sleep 1.5 && open "http://localhost:$PORT") &
exec node server/index.js
