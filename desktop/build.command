#!/bin/bash
# Build "Verso.app" from AuthoringTool.swift.
# Double-clickable in Finder, or run from a terminal. No npm, no Xcode project.
set -euo pipefail
cd "$(dirname "$0")"

APP="Verso.app"
BIN="Verso"

# Generate the icon if it is missing (regenerate explicitly with make-icon.command).
if [ ! -f AppIcon.icns ]; then
  echo "AppIcon.icns missing - generating..."
  ./make-icon.command
fi

echo "Compiling..."
# Kill any running copy so the binary isn't busy.
pkill -x "$BIN" 2>/dev/null || true
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -o "$APP/Contents/MacOS/$BIN" AuthoringTool.swift
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Verso</string>
  <key>CFBundleDisplayName</key><string>Verso</string>
  <key>CFBundleIdentifier</key><string>com.jameswalsh.verso</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>$BIN</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

# Ad-hoc sign so Gatekeeper lets a locally-built app run.
codesign --force --deep --sign - "$APP" 2>/dev/null || true

# Nudge Finder/Dock to pick up the new icon.
touch "$APP"

echo "Built: $(pwd)/$APP"
echo "Launch it with: open \"$APP\"   (or double-click in Finder)"
