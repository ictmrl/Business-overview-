#!/bin/bash
# Double-click in Finder to start Tutorise HQ and open it in your browser.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install it from https://nodejs.org or with: brew install node"
  read -r -p "Press Enter to close…"; exit 1
fi
# Install (or update) dependencies when they are missing or package-lock.json has changed since the last install.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm install --omit=dev; fi
PORT="${PORT:-4747}"
if curl -s -o /dev/null "http://localhost:$PORT/api/auth/status"; then
  open "http://localhost:$PORT"; exit 0
fi
(sleep 1.5 && open "http://localhost:$PORT") &
exec node server/index.js
