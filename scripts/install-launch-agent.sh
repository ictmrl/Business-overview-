#!/bin/bash
# Run Tutorise HQ in the background whenever you log in to your Mac.
# Undo with: scripts/install-launch-agent.sh --uninstall
set -e
LABEL="uk.tutorise.dashboard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$1" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; echo "Removed $LABEL"; exit 0
fi
NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "Node.js not found"; exit 1; }
(cd "$DIR" && [ -d node_modules ] || npm install --omit=dev)
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.tutorise-dashboard"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server/index.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.tutorise-dashboard/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.tutorise-dashboard/server.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. Tutorise HQ is running at http://localhost:4747 and will start at login."
