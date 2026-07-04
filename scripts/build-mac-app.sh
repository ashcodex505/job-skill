#!/usr/bin/env bash
# Builds "Resume Tracker.app" — a native macOS app bundle that starts the
# local Next.js server (if not already running) and opens the UI.
#
# Usage:
#   npm run app:build              # builds dist/Resume Tracker.app
#   npm run app:build -- --install # also copies it to /Applications (Spotlight)
#
# Why not Tauri/Electron: this is a localhost-server app for one machine.
# A 5 KB launcher bundle gives the same Spotlight/Dock experience with zero
# extra runtime. See docs/architecture.md.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Resume Tracker"
PORT="${RESUME_TRACKER_PORT:-3141}"
DIST="$PROJECT_DIR/dist"
APP="$DIST/$APP_NAME.app"

echo "==> Building production bundle (next build)…"
(cd "$PROJECT_DIR" && npm run build)

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>local.resume-tracker</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/launcher" <<LAUNCHER
#!/usr/bin/env bash
# Launcher for $APP_NAME: starts the local server if needed, opens the UI.
set -u
PROJECT_DIR="$PROJECT_DIR"
PORT=$PORT
URL="http://localhost:\$PORT"

# Make Homebrew/nvm-installed node visible in the GUI app environment.
export PATH="/opt/homebrew/bin:/usr/local/bin:\$HOME/.local/bin:\$PATH"
[ -s "\$HOME/.nvm/nvm.sh" ] && . "\$HOME/.nvm/nvm.sh" >/dev/null 2>&1

if curl -sf -o /dev/null "\$URL/api/vault"; then
  open "\$URL"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "Resume Tracker" message "Node.js/npm not found. Install Node and rebuild the app." as critical'
  exit 1
fi

mkdir -p "\$PROJECT_DIR/data"
LOG="\$PROJECT_DIR/data/app.log"
cd "\$PROJECT_DIR"
PORT=\$PORT nohup npm run start >> "\$LOG" 2>&1 &

for _ in \$(seq 1 60); do
  if curl -sf -o /dev/null "\$URL/api/vault"; then
    open "\$URL"
    exit 0
  fi
  sleep 0.5
done

osascript -e 'display alert "Resume Tracker" message "Server did not start within 30s. Check data/app.log." as critical'
exit 1
LAUNCHER
chmod +x "$APP/Contents/MacOS/launcher"

echo "==> Built: $APP"

if [[ "${1:-}" == "--install" ]]; then
  echo "==> Installing to /Applications (Spotlight will index it)…"
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP" "/Applications/$APP_NAME.app"
  echo "==> Done. Press ⌘-Space and type 'Resume Tracker'."
else
  echo "    Run 'npm run app:build -- --install' to copy it to /Applications."
fi
